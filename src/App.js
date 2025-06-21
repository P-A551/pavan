import React, { useState, useEffect, createContext, useContext } from 'react';
import { initializeApp } from 'firebase/app';
import {
  getAuth,
  signInAnonymously,
  signInWithCustomToken,
  onAuthStateChanged,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
} from 'firebase/auth';
import {
  getFirestore,
  doc,
  setDoc,
  onSnapshot,
  collection,
  addDoc,
  query,
  // Removed orderBy as it causes index issues without proper Firestore indexes.
  // orderBy,
} from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';

// Declare global variables for ESLint at the very top, after all imports
/* global __app_id */
/* global __firebase_config */
/* global __initial_auth_token */

// Define context for authentication and user data
const AuthContext = createContext(null);

function App() {
  const [db, setDb] = useState(null);
  const [auth, setAuth] = useState(null);
  const [functions, setFunctions] = useState(null); // State for Firebase Functions instance
  const [user, setUser] = useState(null); // Firebase user object
  const [userId, setUserId] = useState(null); // Our derived user ID
  const [currentPage, setCurrentPage] = useState('login'); // 'login', 'signup', 'home', 'facts', 'advanced', 'vedicSigns', 'services', 'reviews', 'nakshatras'
  const [loading, setLoading] = useState(true);
  const [appInitError, setAppInitError] = useState(''); // State for app initialization errors
  const [defaultLanguage, setDefaultLanguage] = useState('en'); // Default to English
  const [userData, setUserData] = useState(null); // User profile data from Firestore

  useEffect(() => {
    // Define the async function inside useEffect
    const initializeFirebase = async () => {
      try {
        const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
        const firebaseConfigRaw = typeof __firebase_config !== 'undefined' ? __firebase_config : '{}';
        let firebaseConfig;

        // Parse Firebase config JSON
        try {
          firebaseConfig = JSON.parse(firebaseConfigRaw);
        } catch (parseError) {
          console.error("Failed to parse firebaseConfig:", parseError);
          setAppInitError("Invalid Firebase configuration provided. Please check __firebase_config.");
          setLoading(false);
          return;
        }

        // Check if Firebase config is empty
        if (Object.keys(firebaseConfig).length === 0) {
          setAppInitError("Firebase configuration is empty. Please ensure __firebase_config is set.");
          setLoading(false);
          return;
        }

        // Initialize Firebase App
        const app = initializeApp(firebaseConfig);
        const firestoreDb = getFirestore(app);
        const firebaseAuth = getAuth(app);
        const firebaseFunctions = getFunctions(app); // Get Firebase Functions instance

        // Store initialized Firebase services in state
        setDb(firestoreDb);
        setAuth(firebaseAuth);
        setFunctions(firebaseFunctions); // Set Firebase Functions instance

        // Authenticate the user using custom token or anonymously
        try {
          if (typeof __initial_auth_token !== 'undefined' && __initial_auth_token) {
            await signInWithCustomToken(firebaseAuth, __initial_auth_token);
            console.log("Signed in with custom token.");
          } else {
            await signInAnonymously(firebaseAuth);
            console.log("Signed in anonymously.");
          }
        } catch (authError) {
          console.error("Firebase initial authentication error:", authError);
          setAppInitError(`Authentication failed: ${authError.message}. Please check Firebase setup.`);
          // Fallback to anonymous sign-in if custom token fails, as a last resort
          try {
            await signInAnonymously(firebaseAuth);
          } catch (anonFallbackError) {
            console.error("Anonymous authentication fallback also failed:", anonFallbackError);
          }
        }

        // Set up listener for Firebase authentication state changes
        const unsubscribe = onAuthStateChanged(firebaseAuth, (currentUser) => {
          if (currentUser) {
            setUser(currentUser);
            setUserId(currentUser.uid); // Set the user ID from the authenticated user
            console.log("Auth state changed, user:", currentUser.uid);

            // Fetch user-specific profile data from Firestore
            const userDocRef = doc(firestoreDb, `artifacts/${appId}/users/${currentUser.uid}/profile/data`);
            const unsubscribeSnapshot = onSnapshot(userDocRef, (docSnap) => {
              if (docSnap.exists()) {
                const data = docSnap.data();
                setUserData(data);
                setDefaultLanguage(data.defaultLanguage || 'en'); // Set default language from user profile
                setCurrentPage('home'); // Navigate to home page after loading user data
                console.log("User data loaded:", data);
              } else {
                setUserData(null); // No user data found
                setDefaultLanguage('en'); // Default to English if no profile data
                // If user just signed up and no profile data yet, or existing user without profile
                setCurrentPage('home'); // Go to home to allow filling details
                console.log("No user data found, going to home.");
              }
              setLoading(false); // Stop loading once auth and data fetch attempt are complete
            }, (error) => {
              console.error("Error fetching user data snapshot:", error);
              setAppInitError(`Error loading user profile: ${error.message}`);
              setLoading(false);
            });
            return () => unsubscribeSnapshot(); // Clean up Firestore snapshot listener on unmount
          } else {
            // If no user is authenticated, reset user states and navigate to login
            setUser(null);
            setUserId(null);
            setUserData(null);
            setDefaultLanguage('en');
            setCurrentPage('login');
            setLoading(false); // Stop loading
            console.log("Auth state changed, no user.");
          }
        });

        return () => unsubscribe(); // Clean up auth state listener on unmount
      } catch (error) {
        console.error("Firebase initialization failed:", error);
        setAppInitError(`App initialization failed: ${error.message}. Please refresh.`);
        setLoading(false);
      }
    };

    initializeFirebase(); // Call the async function
  }, []); // Empty dependency array ensures this effect runs only once on component mount

  // Handle user logout
  const handleLogout = async () => {
    if (auth) {
      try {
        await signOut(auth);
        setCurrentPage('login'); // Navigate to login page after logout
      } catch (error) {
        console.error("Error logging out:", error);
      }
    }
  };

  // Handle change in default language and update Firestore
  const handleLanguageChange = async (lang) => {
    setDefaultLanguage(lang); // Update local state immediately for responsiveness
    if (db && userId) { // Only update Firestore if DB and user ID are available
      const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
      const userDocRef = doc(db, `artifacts/${appId}/users/${userId}/profile/data`);
      try {
        await setDoc(userDocRef, { defaultLanguage: lang }, { merge: true }); // Merge to only update language
        console.log("Default language updated in Firestore.");
      } catch (error) { // Ensure 'error' is caught and used within this block
        console.error("Error updating language in Firestore:", error);
      }
    } else {
      console.warn("Cannot update language in Firestore: DB or userId not available.");
    }
  };

  // Display loading screen while Firebase initializes
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gradient-to-r from-purple-800 to-indigo-900 text-white">
        <div className="text-2xl font-semibold">Loading Astrology App...</div>
        {appInitError && <p className="text-red-300 text-center mt-4">{appInitError}</p>}
      </div>
    );
  }

  // Display critical application error if initialization failed
  if (appInitError && !loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-gradient-to-r from-purple-800 to-indigo-900 text-white p-4">
        <h1 className="text-3xl font-bold mb-4">Application Error</h1>
        <p className="text-red-300 text-lg text-center">{appInitError}</p>
        <p className="mt-4 text-center">Please ensure Firebase is correctly configured and refresh the page.</p>
      </div>
    );
  }

  return (
    // Provide authentication and user data via context to child components
    // Added a darker, more aesthetic background gradient here
    <AuthContext.Provider value={{ db, auth, user, userId, handleLogout, setCurrentPage, defaultLanguage, handleLanguageChange, userData, setUserData, functions }}>
      <div className="min-h-screen bg-gradient-to-br from-indigo-950 via-purple-900 to-black text-white font-inter">
        {/* Header with user ID and logout button, visible only when logged in */}
        {userId && (
          <header className="p-4 bg-purple-900 shadow-lg flex justify-between items-center rounded-b-lg">
            <span className="text-sm md:text-base">User ID: {userId}</span>
            <div className="flex items-center space-x-4">
              <LanguageSelector />
              <button
                onClick={handleLogout}
                className="bg-red-600 hover:bg-red-700 text-white py-2 px-4 rounded-lg shadow-md transition duration-300 ease-in-out transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-opacity-75"
              >
                Logout
              </button>
            </div>
          </header>
        )}

        {/* Main content area, displaying different pages based on `currentPage` state */}
        <main className="container mx-auto p-4 md:p-8 flex items-center justify-center min-h-[calc(100vh-80px)]"> {/* Adjusted min-h for header */}
          {currentPage === 'login' && <LoginPage />}
          {currentPage === 'signup' && <SignupPage />}
          {currentPage === 'home' && <HomePage />}
          {currentPage === 'facts' && <AstrologyFacts />}
          {currentPage === 'advanced' && <AdvancedAstrology />}
          {currentPage === 'vedicSigns' && <VedicAstrologySigns />}
          {currentPage === 'services' && <ServicesPage />}
          {currentPage === 'reviews' && <ReviewsRatingsPage />}
          {currentPage === 'nakshatras' && <NakshatrasPage />} {/* New page */}
        </main>
      </div>
    </AuthContext.Provider>
  );
}

// Language Selector Component for choosing the UI language
function LanguageSelector() {
  const { defaultLanguage, handleLanguageChange } = useContext(AuthContext);

  const languages = [
    { code: 'en', name: 'English' },
    { code: 'hi', name: 'हिंदी' },
    { code: 'te', name: 'తెలుగు' },
    { code: 'ml', name: 'മലയാളം' },
    { code: 'ta', name: 'தமிழ்' },
    { code: 'kn', name: 'ಕನ್ನಡ' },
  ];

  return (
    <select
      value={defaultLanguage}
      onChange={(e) => handleLanguageChange(e.target.value)}
      className="p-2 rounded-lg bg-purple-700 text-white border border-purple-600 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent cursor-pointer"
    >
      {languages.map((lang) => (
        <option key={lang.code} value={lang.code}>
          {lang.name}
        </option>
      ))}
    </select>
  );
}

// Login Page component (email/password login remains for security)
function LoginPage() {
  const { auth, setCurrentPage } = useContext(AuthContext);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(''); // Correctly defined and used here
  const [loading, setLoading] = useState(false);

  // Handles user login
  const handleLogin = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    if (!auth) {
      setError("Firebase Auth not initialized. Please refresh the page.");
      setLoading(false);
      return;
    }
    try {
      await signInWithEmailAndPassword(auth, email, password);
      // Auth state change listener in App.js will handle navigation to 'home'
    } catch (err) {
      console.error("Login error:", err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-purple-700 p-8 rounded-2xl shadow-xl max-w-md w-full border border-purple-600">
      <h2 className="text-3xl font-bold text-center mb-6 text-white">Login</h2>
      <form onSubmit={handleLogin} className="space-y-6">
        <div>
          <label className="block text-white text-sm font-semibold mb-2" htmlFor="email">
            Email
          </label>
          <input
            type="email"
            id="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full p-3 rounded-lg bg-purple-600 text-white border border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-400 focus:border-transparent"
            placeholder="your@example.com"
            required
          />
        </div>
        <div>
          <label className="block text-white text-sm font-semibold mb-2" htmlFor="password">
            Password
          </label>
          <input
            type="password"
            id="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full p-3 rounded-lg bg-purple-600 text-white border border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-400 focus:border-transparent"
            placeholder="••••••••"
            required
          />
        </div>
        {error && <p className="text-red-300 text-sm mt-2">{error}</p>}
        <button
          type="submit"
          disabled={loading}
          className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-6 rounded-lg shadow-md transition duration-300 ease-in-out transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-opacity-75 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? 'Logging In...' : 'Login'}
        </button>
        <p className="text-center text-sm text-white mt-4">
          Don't have an account?{' '}
          <button
            type="button"
            onClick={() => setCurrentPage('signup')}
            className="text-blue-300 hover:text-blue-200 font-semibold transition duration-200"
          >
            Sign Up
          </button>
        </p>
      </form>
      {/* Note about Mobile Number/OTP: Firebase Phone Auth requires additional setup (reCAPTCHA, phone number verification)
          and is generally more complex to implement and test in a simple embedded environment like this.
          It is recommended to refer to Firebase documentation for full Phone Auth setup if desired. */}
    </div>
  );
}

// Signup Page component
function SignupPage() {
  const { auth, db, setCurrentPage, setUserData } = useContext(AuthContext);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Handles user signup and initializes user data in Firestore
  const handleSignup = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    if (!auth || !db) {
      setError("Firebase not initialized. Please refresh the page.");
      setLoading(false);
      return;
    }
    try {
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);
      const userUid = userCredential.user.uid;
      const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
      const userDocRef = doc(db, `artifacts/${appId}/users/${userUid}/profile/data`);

      // Initialize user data in Firestore with default values
      const initialUserData = {
        email: email,
        defaultLanguage: 'en',
        birthDate: '',
        birthTime: '',
        birthPlace: '',
      };
      await setDoc(userDocRef, initialUserData); // Create new user profile document
      setUserData(initialUserData); // Update context with newly created user data
      // Auth state change listener in App.js will handle navigation to 'home'
    } catch (err) {
      console.error("Signup error:", err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-purple-700 p-8 rounded-2xl shadow-xl max-w-md w-full border border-purple-600">
      <h2 className="text-3xl font-bold text-center mb-6 text-white">Sign Up</h2>
      <form onSubmit={handleSignup} className="space-y-6">
        <div>
          <label className="block text-white text-sm font-semibold mb-2" htmlFor="signup-email">
            Email
          </label>
          <input
            type="email"
            id="signup-email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full p-3 rounded-lg bg-purple-600 text-white border border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-400 focus:border-transparent"
            placeholder="your@example.com"
            required
          />
        </div>
        <div>
          <label className="block text-white text-sm font-semibold mb-2" htmlFor="signup-password">
            Password
          </label>
          <input
            type="password"
            id="signup-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full p-3 rounded-lg bg-purple-600 text-white border border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-400 focus:border-transparent"
            placeholder="••••••••"
            required
          />
          <p className="text-sm text-gray-300 mt-1">Minimum 6 characters</p>
        </div>
        {error && <p className="text-red-300 text-sm mt-2">{error}</p>}
        <button
          type="submit"
          disabled={loading}
          className="w-full bg-green-600 hover:bg-green-700 text-white font-bold py-3 px-6 rounded-lg shadow-md transition duration-300 ease-in-out transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-opacity-75 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? 'Signing Up...' : 'Sign Up'}
        </button>
        <p className="text-center text-sm text-white mt-4">
          Already have an account?{' '}
          <button
            type="button"
            onClick={() => setCurrentPage('login')}
            className="text-blue-300 hover:text-blue-200 font-semibold transition duration-200"
          >
            Login
          </button>
        </p>
      </form>
    </div>
  );
}

// Home Page component: Allows user to input birth details, save them, and send via email
function HomePage() {
  // Destructure values from AuthContext
  const { db, userId, setCurrentPage, userData, setUserData, defaultLanguage, functions } = useContext(AuthContext);
  const [birthDate, setBirthDate] = useState('');
  const [birthTime, setBirthTime] = useState('');
  const [birthPlace, setBirthPlace] = useState('');
  const [message, setMessage] = useState('');
  const [loadingSave, setLoadingSave] = useState(false);
  const [loadingEmail, setLoadingEmail] = useState(false); // Loading state specifically for email sending

  // Populate form fields with existing user data on component mount or userData change
  useEffect(() => {
    if (userData) {
      setBirthDate(userData.birthDate || '');
      setBirthTime(userData.birthTime || '');
      setBirthPlace(userData.birthPlace || '');
    }
  }, [userData]);

  // Handles saving birth details to Firestore
  const handleSaveDetails = async (e) => {
    e.preventDefault();
    if (!db || !userId) {
      setMessage('Error: User not authenticated. Please log in.');
      return;
    }
    setLoadingSave(true);
    setMessage(''); // Clear previous messages
    try {
      const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
      const userDocRef = doc(db, `artifacts/${appId}/users/${userId}/profile/data`);
      const updatedUserData = {
        ...userData, // Preserve existing data like email, language
        birthDate,
        birthTime,
        birthPlace,
      };
      await setDoc(userDocRef, updatedUserData, { merge: true }); // Use merge to only update specific fields
      setUserData(updatedUserData); // Update local context state
      setMessage('Birth details saved successfully!');
    } catch (error) {
      console.error("Error saving birth details:", error);
      setMessage(`Failed to save details: ${error.message}`);
    } finally {
      setLoadingSave(false);
      setTimeout(() => setMessage(''), 3000); // Clear message after 3 seconds
    }
  };

  // Handles sending customer details via a Firebase Cloud Function
  const handleSendEmail = async () => {
    if (!functions) { // Check if Firebase Functions is initialized
      setMessage("Email functionality not initialized. Please refresh the page.");
      setTimeout(() => setMessage(''), 3000);
      return;
    }
    if (!userData || !userData.birthDate || !userData.birthTime || !userData.birthPlace) {
      setMessage(getTranslation('saveDetailsFirst')); // Prompt user to save details first
      setTimeout(() => setMessage(''), 3000);
      return;
    }

    setLoadingEmail(true); // Start email sending loading state
    setMessage(''); // Clear previous messages

    try {
      // Create a callable Cloud Function reference
      const sendCustomerDetails = httpsCallable(functions, 'sendCustomerDetails'); // 'sendCustomerDetails' is the name of your Cloud Function

      // Invoke the Cloud Function with customer data
      const result = await sendCustomerDetails({
        userId: userId,
        email: userData.email, // Use email from userData, which comes from authentication/profile
        birthDate: userData.birthDate, // This DOB is for astrological calculations, not authentication.
        birthTime: userData.birthTime,
        birthPlace: userData.birthPlace,
        defaultLanguage: userData.defaultLanguage,
      });

      // Check the result from the Cloud Function
      if (result.data && result.data.success) {
        setMessage(getTranslation('emailSentSuccess'));
      } else {
        setMessage(`${getTranslation('emailSentFail')} ${result.data.error || 'Unknown error'}`);
      }
    } catch (error) {
      console.error("Error calling Cloud Function:", error);
      setMessage(`${getTranslation('emailSentFail')} ${error.message}`);
    } finally {
      setLoadingEmail(false); // End email sending loading state
      setTimeout(() => setMessage(''), 5000); // Clear message after 5 seconds
    }
  };

  // Localization function for dynamic text based on selected language
  const getTranslation = (key) => {
    const translations = {
      en: {
        welcome: "Welcome to Astro Insights",
        enterDetails: "Enter Your Birth Details",
        birthDate: "Date of Birth",
        birthTime: "Time of Birth",
        birthPlace: "Place of Birth",
        saveDetails: "Save Details",
        sendEmail: "Send Details via Email",
        viewFacts: "View Astrological Facts",
        advancedAstrology: "Astrology vs. Modern Science",
        vedicSigns: "Vedic Astrology Signs and Their Importance",
        myServices: "Explore Our Services",
        customerReviews: "Customer Reviews & Ratings",
        nakshatras: "General Details About 27 Nakshatras (Stars)", // New translation
        detailsSaved: "Birth details saved successfully!",
        failedToSave: "Failed to save details:",
        notAuthenticated: "Error: User not authenticated. Please log in.",
        saveDetailsFirst: "Please save your birth details first before sending via email.",
        emailSending: "Sending email...",
        emailSentSuccess: "Email sent successfully!",
        emailSentFail: "Failed to send email:",
      },
      hi: {
        welcome: "एस्ट्रो इनसाइट्स में आपका स्वागत है",
        enterDetails: "अपनी जन्म विवरण दर्ज करें",
        birthDate: "जन्म तिथि",
        birthTime: "जन्म समय",
        birthPlace: "जन्म स्थान",
        saveDetails: "विवरण सहेजें",
        sendEmail: "विवरण ईमेल द्वारा भेजें",
        viewFacts: "ज्योतिषीय तथ्य देखें",
        advancedAstrology: "ज्योतिष बनाम आधुनिक विज्ञान",
        vedicSigns: "वैदिक ज्योतिष राशियाँ और उनका महत्व",
        myServices: "हमारी सेवाएँ देखें",
        customerReviews: "ग्राहक समीक्षाएँ और रेटिंग",
        nakshatras: "27 नक्षत्रों (सितारों) के बारे में सामान्य विवरण", // New translation
        detailsSaved: "जन्म विवरण सफलतापूर्वक सहेजा गया!",
        failedToSave: "विवरण सहेजने में विफल रहा:",
        notAuthenticated: "त्रुटि: उपयोगकर्ता प्रमाणित नहीं है। कृपया लॉग इन करें।",
        saveDetailsFirst: "ईमेल द्वारा भेजने से पहले कृपया अपनी जन्म विवरण सहेजें।",
        emailSending: "ईमेल भेजा जा रहा है...",
        emailSentSuccess: "ईमेल सफलतापूर्वक भेजा गया!",
        emailSentFail: "ईमेल भेजने में विफल:",
      },
      te: {
        welcome: "జ్యోతిష్య అంతర్దృష్టికి స్వాగతం",
        enterDetails: "మీ జనన వివరాలను నమోదు చేయండి",
        birthDate: "పుట్టిన తేదీ",
        birthTime: "పుట్టిన సమయం",
        birthPlace: "పుట్టిన స్థలం",
        saveDetails: "వివరాలను సేవ్ చేయండి",
        sendEmail: "ఇమెయిల్ ద్వారా వివరాలను పంపండి",
        viewFacts: "జ్యోతిష్య వాస్తవాలను చూడండి",
        advancedAstrology: "జ్యోతిష్యం vs. ఆధునిక విజ్ఞానం",
        vedicSigns: "వేద జ్యోతిష్య రాశులు మరియు వాటి ప్రాముఖ్యత",
        myServices: "మా సేవలను అన్వేషించండి",
        customerReviews: "కస్టమర్ సమీక్షలు & రేటింగ్‌లు",
        nakshatras: "27 నక్షత్రాల (నక్షత్రాలు) గురించి సాధారణ వివరాలు", // New translation
        detailsSaved: "పుట్టిన వివరాలు విజయవంతంగా సేవ్ చేయబడ్డాయి!",
        failedToSave: "వివరాలను సేవ్ చేయడంలో విఫలమైంది:",
        notAuthenticated: "ఎర్రర్: వినియోగదారు ప్రమాణీకరించబడలేదు. దయచేసి లాగిన్ అవ్వండి.",
        saveDetailsFirst: "ఇమెయిల్ ద్వారా పంపే ముందు దయచేసి మీ పుట్టిన వివరాలను సేవ్ చేయండి.",
        emailSending: "ఇమెయిల్ పంపబడుతోంది...",
        emailSentSuccess: "ఇమెయిల్ విజయవంతంగా పంపబడింది!",
        emailSentFail: "ఇమెయిల్ పంపడంలో విఫలమైంది:",
      },
      ml: {
        welcome: "ജ്യോതിഷ സ്ഥിതിവിവരക്കണക്കുകളിലേക്ക് സ്വാഗതം",
        enterDetails: "നിങ്ങളുടെ ജനന വിശദാംശങ്ങൾ നൽകുക",
        birthDate: "ജനനത്തീയതി",
        birthTime: "ജനന സമയം",
        birthPlace: "ജനന സ്ഥലം",
        saveDetails: "വിശദാംശങ്ങൾ സംരക്ഷിക്കുക",
        sendEmail: "വിശദാംശങ്ങൾ ഇമെയിൽ വഴി അയയ്ക്കുക",
        viewFacts: "ജ്യോതിഷ വസ്തുതകൾ കാണുക",
        advancedAstrology: "ജ്യോതിഷം vs. ആധുനിക ശാസ്ത്രം",
        vedicSigns: "വേദ ജ്യോതിഷ രാശികളും അവയുടെ പ്രാധാന്യവും",
        myServices: "ഞങ്ങളുടെ സേവനങ്ങൾ പര്യവേക്ഷണം ചെയ്യുക",
        customerReviews: "ഉപഭോക്തൃ അവലോകനങ്ങളും റേറ്റിംഗുകളും",
        nakshatras: "27 നക്ഷത്രങ്ങളെക്കുറിച്ചുള്ള പൊതുവായ വിവരങ്ങൾ", // New translation
        detailsSaved: "ജനന വിശദാംശങ്ങൾ വിജയകരമായി സംരക്ഷിച്ചു!",
        failedToSave: "വിശദാംശങ്ങൾ സംരക്ഷിക്കുന്നതിൽ പരാജയപ്പെട്ടു:",
        notAuthenticated: "പിശക്: ഉപയോക്താവ് പ്രാമാണീകരിച്ചിട്ടില്ല. ദയവായി ലോഗിൻ ചെയ്യുക.",
        saveDetailsFirst: "ഇമെയിൽ വഴി അയയ്‌ക്കുന്നതിന് മുമ്പ് ദയവായി നിങ്ങളുടെ ജനന വിശദാംശങ്ങൾ സംരക്ഷിക്കുക.",
        emailSending: "ഇമെയിൽ അയച്ചുകൊണ്ടിരിക്കുന്നു...",
        emailSentSuccess: "ഇമെയിൽ വിജയകരമായി അയച്ചു!",
        emailSentFail: "ഇമെയിൽ അയക്കുന്നതിൽ പരാജയപ്പെട്ടു:",
      },
      ta: {
        title: "ஜோதிட நுண்ணறிவுகளுக்கு வரவேற்கிறோம்",
        enterDetails: "உங்கள் பிறப்பு விவரங்களை உள்ளிடவும்",
        birthDate: "பிறந்த தேதி",
        birthTime: "பிறந்த நேரம்",
        birthPlace: "பிறந்த இடம்",
        saveDetails: "விவரங்களைச் சேமிக்கவும்",
        sendEmail: "விவரங்களை மின்னஞ்சல் வழியாக அனுப்பவும்",
        viewFacts: "ஜோதிட உண்மைகளைப் பார்க்கவும்",
        advancedAstrology: "ஜோதிடம் vs. நவீன அறிவியல்",
        vedicSigns: "வேத ஜோதிட ராசிகள் மற்றும் அவற்றின் முக்கியத்துவம்",
        myServices: "எங்கள் சேவைகளை ஆராயுங்கள்",
        customerReviews: "வாடிக்கையாளர் மதிப்புரைகள் மற்றும் மதிப்பீடுகள்",
        nakshatras: "27 நட்சத்திரங்கள் பற்றிய பொதுவான விவரங்கள்", // New translation
        detailsSaved: "பிறப்பு விவரங்கள் வெற்றிகரமாக சேமிக்கப்பட்டன!",
        failedToSave: "விவரங்களைச் சேமிக்க முடியவில்லை:",
        notAuthenticated: "பிழை: பயனர் அங்கீகரிக்கப்படவில்லை. தயவுசெய்து உள்நுழையவும்.",
        saveDetailsFirst: "மின்னஞ்சல் மூலம் அனுப்பும் முன் உங்கள் பிறப்பு விவரங்களைச் சேமிக்கவும்.",
        emailSending: "மின்னஞ்சல் அனுப்பப்படுகிறது...",
        emailSentSuccess: "மின்னஞ்சல் வெற்றிகரமாக அனுப்பப்பட்டது!",
        emailSentFail: "மின்னஞ்சல் அனுப்ப முடியவில்லை:",
      },
      kn: {
        title: "ಜ್ಯೋತಿಷ್ಯ ಒಳನೋಟಗಳಿಗೆ ಸ್ವಾಗತ",
        enterDetails: "ನಿಮ್ಮ ಜನ್ಮ ವಿವರಗಳನ್ನು ನಮೂದಿಸಿ",
        birthDate: "ಜನ್ಮ ದಿನಾಂಕ",
        birthTime: "ಜನ್ಮ ಸಮಯ",
        birthPlace: "ಜನ್ಮ ಸ್ಥಳ",
        saveDetails: "ವಿವರಗಳನ್ನು ಉಳಿಸಿ",
        sendEmail: "ಇಮೇಲ್ ಮೂಲಕ ವಿವರಗಳನ್ನು ಕಳುಹಿಸಿ",
        viewFacts: "ಜ್ಯೋತಿಷ್ಯ ಸಂಗತಿಗಳನ್ನು ವೀಕ್ಷಿಸಿ",
        advancedAstrology: "ಜ್ಯೋತಿಷ್ಯ vs. ಆಧುನಿಕ ವಿಜ್ಞಾನ",
        vedicSigns: "ವೈದಿಕ ಜ್ಯೋತಿಷ್ಯ ಚಿಹ್ನೆಗಳು ಮತ್ತು ಅವುಗಳ ಪ್ರಾಮುಖ್ಯತೆ",
        myServices: "ನಮ್ಮ ಸೇವೆಗಳನ್ನು ಅನ್ವೇಷಿಸಿ",
        customerReviews: "ಗ್ರಾಹಕ ವಿಮರ್ಶೆಗಳು ಮತ್ತು ರೇಟಿಂಗ್‌ಗಳು",
        nakshatras: "27 ನಕ್ಷತ್ರಗಳ ಬಗ್ಗೆ ಸಾಮಾನ್ಯ ವಿವರಗಳು", // New translation
        detailsSaved: "ಜನ್ಮ ವಿವರಗಳನ್ನು ಯಶಸ್ವಿಯಾಗಿ ಉಳಿಸಲಾಗಿದೆ!",
        failedToSave: "ವಿವರಗಳನ್ನು ಉಳಿಸಲು ವಿಫಲವಾಗಿದೆ:",
        notAuthenticated: "ದೋಷ: ಬಳಕೆದಾರರನ್ನು ದೃಢೀಕರಿಸಲಾಗಿಲ್ಲ. ದಯವಿಟ್ಟು ಲಾಗಿನ್ ಮಾಡಿ.",
        saveDetailsFirst: "ಇಮೇಲ್ ಮೂಲಕ ಕಳುಹಿಸುವ ಮೊದಲು ದಯವಿಟ್ಟು ನಿಮ್ಮ ಜನ್ಮ ವಿವರಗಳನ್ನು ಉಳಿಸಿ.",
        emailSending: "ಇಮೇಲ್ ಕಳುಹಿಸಲಾಗುತ್ತಿದೆ...",
        emailSentSuccess: "ಇಮೇಲ್ ಯಶಸ್ವಿಯಾಗಿ ಕಳುಹಿಸಲಾಗಿದೆ!",
        emailSentFail: "ಇಮೇಲ್ ಕಳುಹಿಸಲು ವಿಫಲವಾಗಿದೆ:",
      },
    };
    return translations[defaultLanguage]?.[key] || translations['en'][key];
  };

  return (
    <div className="bg-purple-700 p-8 rounded-2xl shadow-xl max-w-3xl w-full border border-purple-600">
      <h2 className="text-3xl font-bold text-center mb-6 text-white">
        {getTranslation('welcome')}
      </h2>

      {/* Form for entering and saving birth details */}
      <form onSubmit={handleSaveDetails} className="space-y-6 mb-8">
        <h3 className="text-xl font-semibold text-white mb-4">
          {getTranslation('enterDetails')}
        </h3>
        <div>
          <label className="block text-white text-sm font-semibold mb-2" htmlFor="birthDate">
            {getTranslation('birthDate')}
          </label>
          <input
            type="date"
            id="birthDate"
            value={birthDate}
            onChange={(e) => setBirthDate(e.target.value)}
            className="w-full p-3 rounded-lg bg-purple-600 text-white border border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-400 focus:border-transparent"
            required
          />
        </div>
        <div>
          <label className="block text-white text-sm font-semibold mb-2" htmlFor="birthTime">
            {getTranslation('birthTime')}
          </label>
          <input
            type="time"
            id="birthTime"
            value={birthTime}
            onChange={(e) => setBirthTime(e.target.value)}
            className="w-full p-3 rounded-lg bg-purple-600 text-white border border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-400 focus:border-transparent"
            required
          />
        </div>
        <div>
          <label className="block text-white text-sm font-semibold mb-2" htmlFor="birthPlace">
            {getTranslation('birthPlace')}
          </label>
          <input
            type="text"
            id="birthPlace"
            value={birthPlace}
            onChange={(e) => setBirthPlace(e.target.value)}
            className="w-full p-3 rounded-lg bg-purple-600 text-white border border-purple-500 focus:outline-none focus:ring-2 focus:ring-purple-400 focus:border-transparent"
            placeholder="e.g., London, UK"
            required
          />
        </div>
        {/* Display feedback messages (success/error) for saving */}
        {message && (
          <p className={`text-sm mt-2 ${message.includes('success') ? 'text-green-300' : 'text-red-300'}`}>
            {message}
          </p>
        )}
        <button
          type="submit"
          disabled={loadingSave}
          className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3 px-6 rounded-lg shadow-md transition duration-300 ease-in-out transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-opacity-75 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loadingSave ? 'Saving...' : getTranslation('saveDetails')}
        </button>
      </form>

      {/* Button to send customer details via email (Cloud Function) */}
      <button
        onClick={handleSendEmail}
        disabled={loadingEmail} // Disable button while email is being sent
        className="w-full bg-purple-500 hover:bg-purple-600 text-white font-bold py-3 px-6 rounded-lg shadow-md transition duration-300 ease-in-out transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-purple-400 focus:ring-opacity-75 mt-4 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {loadingEmail ? (
          <div className="flex items-center justify-center">
            <svg className="animate-spin h-5 w-5 mr-3 text-white" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            {getTranslation('emailSending')}
          </div>
        ) : (
          getTranslation('sendEmail')
        )}
      </button>

      {/* Navigation buttons to other sections */}
      <div className="flex flex-col md:flex-row justify-around gap-4 mt-8">
        <button
          onClick={() => setCurrentPage('facts')}
          className="flex-1 bg-yellow-600 hover:bg-yellow-700 text-white font-bold py-3 px-6 rounded-lg shadow-md transition duration-300 ease-in-out transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-yellow-500 focus:ring-opacity-75"
        >
          {getTranslation('viewFacts')}
        </button>
        <button
          onClick={() => setCurrentPage('advanced')}
          className="flex-1 bg-teal-600 hover:bg-teal-700 text-white font-bold py-3 px-6 rounded-lg shadow-md transition duration-300 ease-in-out transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-teal-500 focus:ring-opacity-75"
        >
          {getTranslation('advancedAstrology')}
        </button>
        <button
          onClick={() => setCurrentPage('vedicSigns')}
          className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-6 rounded-lg shadow-md transition duration-300 ease-in-out transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-opacity-75"
        >
          {getTranslation('vedicSigns')}
        </button>
        <button
          onClick={() => setCurrentPage('services')}
          className="flex-1 bg-green-600 hover:bg-green-700 text-white font-bold py-3 px-6 rounded-lg shadow-md transition duration-300 ease-in-out transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-opacity-75"
        >
          {getTranslation('myServices')}
        </button>
        <button
          onClick={() => setCurrentPage('reviews')}
          className="flex-1 bg-purple-500 hover:bg-purple-600 text-white font-bold py-3 px-6 rounded-lg shadow-md transition duration-300 ease-in-out transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-purple-400 focus:ring-opacity-75"
        >
          {getTranslation('customerReviews')}
        </button>
        <button
          onClick={() => setCurrentPage('nakshatras')}
          className="flex-1 bg-pink-600 hover:bg-pink-700 text-white font-bold py-3 px-6 rounded-lg shadow-md transition duration-300 ease-in-out transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-pink-500 focus:ring-opacity-75"
        >
          {getTranslation('nakshatras')}
        </button>
      </div>
    </div>
  );
}

// Astrology Facts Page component: Fetches and displays astrological facts using Gemini API
function AstrologyFacts() {
  const { setCurrentPage, defaultLanguage } = useContext(AuthContext);
  const [facts, setFacts] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Localization function for dynamic text
  const getTranslation = (key) => {
    const translations = {
      en: {
        title: "Astrological Facts",
        loading: "Generating facts...",
        back: "Back to Home",
        error: "Failed to load facts. Please try again.",
      },
      hi: {
        title: "ज्योतिषीय तथ्य",
        loading: "तथ्यों का निर्माण हो रहा है...",
        back: "होम पर वापस",
        error: "तथ्य लोड करने में विफल। कृपया पुन: प्रयास करें।",
      },
      te: {
        title: "జ్యోతిష్య వాస్తవాలు",
        loading: "వాస్తవాలను ఉత్పత్తి చేస్తోంది...",
        back: "హోమ్‌కు తిరిగి వెళ్ళు",
        error: "వాస్తవాలను లోడ్ చేయడంలో విఫలమైంది. దయచేసి మళ్ళీ ప్రయత్నించండి.",
      },
      ml: {
        title: "ജ്യോതിഷ വസ്തുതകൾ",
        loading: "വസ്തുതകൾ സൃഷ്ടിക്കുന്നു...",
        back: "ഹോമിലേക്ക് തിരികെ",
        error: "വസ്തുതകൾ ലോഡ് ചെയ്യുന്നതിൽ പരാജയപ്പെട്ടു. ദയവായി വീണ്ടും ശ്രമിക്കുക.",
      },
      ta: {
        title: "ஜோதிட உண்மைகள்",
        loading: "உண்மைகளை உருவாக்குகிறது...",
        back: "முகப்புக்கு திரும்பு",
        error: "உண்மைகளை ஏற்ற முடியவில்லை. மீண்டும் முயற்சிக்கவும்.",
      },
      kn: {
        title: "ಜ್ಯೋತಿಷ್ಯ ಸಂಗತಿಗಳು",
        loading: "ಸಂಗತಿಗಳನ್ನು ರಚಿಸಲಾಗುತ್ತಿದೆ...",
        back: "ಮನೆಗೆ ಹಿಂತಿರುಗಿ",
        error: "ಸಂಗತಿಗಳನ್ನು ಲೋಡ್ ಮಾಡಲು ವಿಫಲವಾಗಿದೆ. ದയatcplease ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.",
      },
    };
    return translations[defaultLanguage]?.[key] || translations['en'][key];
  };

  // Effect hook to fetch astrological facts when component mounts or language changes
  useEffect(() => {
    const fetchFacts = async () => {
      setLoading(true);
      setError('');
      try {
        // Construct the prompt to include the specific facts you provided
        const specificFacts = [
          "Except for Rahu and Ketu, each of the Navagrahas rules one day of the week.",
          "Every Hindu temple includes Navagrahas as sub-deities.",
          "Lord Ganesha is always worshipped first, followed by the Navagrahas.",
          "Rahu and Ketu are not actual planets; they are shadow points in the sky.",
          "Navagraha idols are placed in temples to protect both the temple and the visitors.",
          "If two Grahas are placed in different mandapas (temple platforms), they must not face each other.",
          "The Sun (Surya) is the son of Kashyap and Aditi and is considered a visible form of God.",
          "The Moon (Chandra) is a fertility god and was married to 27 daughters of Daksha Prajapati (the 27 Nakshatras).",
          "Mars (Mangal) is also known as Bhauma, the son of Earth.",
          "Mercury (Budha) was born from the Moon and Tara.",
          "Shukra Dasha lasts for 20 years. If Venus (Shukra) is well-placed in a horoscope, it brings prosperity, comfort, and luxury.",
          "Shani (Saturn) is the son of the Sun and his wife Chhaya.",
          "During the Samudra Manthan, Lord Vishnu (as Mohini) separated Rahu’s head, creating Rahu and Ketu as two different entities."
        ].map(fact => `* ${fact}`).join('\n'); // Format them as markdown list items

        const prompt = `Provide the following astrological facts:\n${specificFacts}\n\nAlso, provide some more interesting and engaging astrological facts in ${defaultLanguage} language. Format them as a list of bullet points.`;

        const chatHistory = [{ role: "user", parts: [{ text: prompt }] }];
        const payload = { contents: chatHistory };
        const apiKey = ""; // API key is handled by the environment for Gemini API calls
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;

        const response = await fetch(apiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        const result = await response.json();
        if (result.candidates && result.candidates.length > 0 &&
            result.candidates[0].content && result.candidates[0].content.parts &&
            result.candidates[0].content.parts.length > 0) {
          const text = result.candidates[0].content.parts[0].text;
          setFacts(text);
        } else {
          setError(getTranslation('error'));
        }
      } catch (err) {
        console.error("Error fetching astrological facts:", err);
        setError(getTranslation('error') + `: ${err.message}`);
      } finally {
        setLoading(false);
      }
    };

    fetchFacts();
  }, [defaultLanguage]); // Re-fetch when `defaultLanguage` changes

  return (
    <div className="bg-purple-700 p-8 rounded-2xl shadow-xl max-w-3xl w-full border border-purple-600">
      <h2 className="text-3xl font-bold text-center mb-6 text-white">
        {getTranslation('title')}
      </h2>

      {/* Loading indicator for Gemini API call */}
      {loading && (
        <div className="flex items-center justify-center text-blue-300">
          <svg className="animate-spin h-5 w-5 mr-3 text-blue-300" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          {getTranslation('loading')}
        </div>
      )}
      {/* Error message display */}
      {error && <p className="text-red-300 mt-4 text-center">{error}</p>}
      {facts && (
        <div className="bg-purple-600 p-6 rounded-lg text-white prose prose-invert max-w-none">
          <div dangerouslySetInnerHTML={{ __html: facts.replace(/\n/g, '<br>') }} />
        </div>
      )}

      {/* Button to navigate back to Home page */}
      <button
        onClick={() => setCurrentPage('home')}
        className="mt-8 w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-6 rounded-lg shadow-md transition duration-300 ease-in-out transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-opacity-75"
      >
        {getTranslation('back')}
      </button>
    </div>
  );
}

// Advanced Astrology Page component: Fetches and displays content on "Astrology vs. Modern Science" using Gemini API
function AdvancedAstrology() {
  const { setCurrentPage, defaultLanguage } = useContext(AuthContext);
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Localization function for dynamic text
  const getTranslation = (key) => {
    const translations = {
      en: {
        title: "Astrology: Far Advanced than Today's Science?",
        loading: "Generating content...",
        back: "Back to Home",
        error: "Failed to load content. Please try again.",
      },
      hi: {
        title: "ज्योतिष: आज के विज्ञान से कहीं आगे?",
        loading: "सामग्री का निर्माण हो रहा है...",
        back: "होम पर वापस",
        error: "सामग्री लोड करने में विफल। कृपया पुन: प्रयास करें।",
      },
      te: {
        title: "జ్యోతిష్యం: నేటి సైన్స్ కంటే చాలా ఆధునికమా?",
        loading: "కంటెంట్‌ను ఉత్పత్తి చేస్తోంది...",
        back: "హోమ్‌కు తిరిగి వెళ్ళు",
        error: "కంటెంట్‌ను లోడ్ చేయడంలో విఫలమైంది. దయచేసి మళ్ళీ ప్రయత్నించండి.",
      },
      ml: {
        title: "ജ്യോതിഷം: ഇന്നത്തെ ശാസ്ത്രത്തേക്കാൾ വളരെ മുന്നിലാണോ?",
        loading: "ഉള്ളടക്കം സൃഷ്ടിക്കുന്നു...",
        back: "ഹോമിലേക്ക് തിരികെ",
        error: "ഉള്ളടക്കം ലോഡ് ചെയ്യുന്നതിൽ പരാജയപ്പെട്ടു. ദയവായി വീണ്ടും ശ്രമിക്കുക.",
      },
      ta: {
        title: "ஜோதிடம்: இன்றைய அறிவியலை விட மிகவும் மேம்பட்டதா?",
        loading: "உள்ளடக்கத்தை உருவாக்குகிறது...",
        back: "முகப்புக்கு திரும்பு",
        error: "உண்மைகளை ஏற்ற முடியவில்லை. மீண்டும் முயற்சிக்கவும்.",
      },
      kn: {
        title: "ಜ್ಯೋತಿಷ್ಯ: ಇಂದಿನ ವಿಜ್ಞಾನಕ್ಕಿಂತ ಹೆಚ್ಚು ಮುಂದುವರಿದಿದೆಯೇ?",
        loading: "ವಿಷಯವನ್ನು ರಚಿಸಲಾಗುತ್ತಿದೆ...",
        back: "ಮನೆಗೆ ಹಿಂತಿರುಗಿ",
        error: "ವಿಷಯವನ್ನು ಲೋಡ್ ಮಾಡಲು ವಿಫಲವಾಗಿದೆ. ದಯatcplease ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.",
      },
    };
    return translations[defaultLanguage]?.[key] || translations['en'][key];
  };

  // Effect hook to fetch content when component mounts or language changes
  useEffect(() => {
    const fetchContent = async () => {
      setLoading(true);
      setError('');
      try {
        const prompt = `Write an essay in ${defaultLanguage} language explaining the perspective that astrology is far advanced than today's science. Focus on philosophical, historical, and conceptual arguments rather than scientific proof. Structure it with an high level introduction, a few paragraphs, and a conclusion.`;
        const chatHistory = [{ role: "user", parts: [{ text: prompt }] }];
        const payload = { contents: chatHistory };
        const apiKey = ""; // API key is handled by the environment for Gemini API calls
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;

        const response = await fetch(apiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        const result = await response.json();
        if (result.candidates && result.candidates.length > 0 &&
            result.candidates[0].content && result.candidates[0].content.parts &&
            result.candidates[0].content.parts.length > 0) {
          const text = result.candidates[0].content.parts[0].text;
          setContent(text);
        } else {
          setError(getTranslation('error'));
        }
      } catch (err) {
        console.error("Error fetching advanced astrology content:", err);
        setError(getTranslation('error') + `: ${err.message}`);
      } finally {
        setLoading(false);
      }
    };

    fetchContent();
  }, [defaultLanguage]); // Re-fetch when `defaultLanguage` changes

  return (
    <div className="bg-purple-700 p-8 rounded-2xl shadow-xl max-w-3xl w-full border border-purple-600">
      <h2 className="text-3xl font-bold text-center mb-6 text-white">
        {getTranslation('title')}
      </h2>

      {/* Loading indicator for Gemini API call */}
      {loading && (
        <div className="flex items-center justify-center text-blue-300">
          <svg className="animate-spin h-5 w-5 mr-3 text-blue-300" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          {getTranslation('loading')}
        </div>
      )}
      {/* Error message display */}
      {error && <p className="text-red-300 mt-4 text-center">{error}</p>}
      {content && (
        <div className="bg-purple-600 p-6 rounded-lg text-white prose prose-invert max-w-none">
          <div dangerouslySetInnerHTML={{ __html: content.replace(/\n/g, '<br>') }} />
        </div>
      )}

      {/* Button to navigate back to Home page */}
      <button
        onClick={() => setCurrentPage('home')}
        className="mt-8 w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-6 rounded-lg shadow-md transition duration-300 ease-in-out transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-opacity-75"
      >
        {getTranslation('back')}
      </button>
    </div>
  );
}

// Vedic Astrology Signs and Their Importance Component
function VedicAstrologySigns() {
  const { setCurrentPage, defaultLanguage } = useContext(AuthContext);

  const getTranslation = (key) => {
    const translations = {
      en: {
        title: "Vedic Astrology Signs and Their Importance",
        intro: "In Vedic astrology, there are 12 zodiac signs, 9 planets (Navagrahas), 12 houses, and 27 lunar constellations (Nakshatras). Here’s a simple breakdown:",
        zodiacSignsTitle: "The 12 Zodiac Signs (Rashi):",
        mesha: "Mesha (Aries) – Bold and energetic",
        vrishabha: "Vrishabha (Taurus) – Stable and loyal",
        mithuna: "Mithuna (Gemini) – Communicative and curious",
        karka: "Karka (Cancer) – Emotional and nurturing",
        simha: "Simha (Leo) – Proud and strong",
        kanya: "Kanya (Virgo) – Practical and perfectionist",
        tula: "Tula (Libra) – Balanced and charming",
        vrischika: "Vrischika (Scorpio) – Deep and powerful",
        dhanu: "Dhanu (Sagittarius) – Adventurous and wise",
        makara: "Makara (Capricorn) – Disciplined and hardworking",
        kumbha: "Kumbha (Aquarius) – Innovative and independent",
        meena: "Meena (Pisces) – Sensitive and artistic",
        zodiacConclusion: "Each sign is ruled by a planet and has its own qualities. Predictions are made by studying the placement of planets in these signs at the time of birth.",
        navagrahasTitle: "The Navagrahas – 9 Planetary Influencers",
        navagrahasIntro: "The Navagrahas are:",
        sun: "Sun (Surya)",
        moon: "Moon (Chandra)",
        mars: "Mars (Mangal)",
        mercury: "Mercury (Budh)",
        jupiter: "Jupiter (Guru)",
        venus: "Venus (Shukra)",
        saturn: "Saturn (Shani)",
        rahu: "Rahu (North Node of Moon)",
        ketu: "Ketu (South Node of Moon)",
        navagrahasConclusion: "These planets influence various parts of our lives – from health and career to love and destiny. Astrologers check their positions in your birth chart to offer predictions.",
        back: "Back to Home",
      },
      hi: {
        title: "वैदिक ज्योतिष राशियाँ और उनका महत्व",
        intro: "वैदिक ज्योतिष में, 12 राशियाँ, 9 ग्रह (नवग्रह), 12 भाव और 27 नक्षत्र हैं। यहाँ एक सरल विवरण दिया गया है:",
        zodiacSignsTitle: "12 राशियाँ (राशि):",
        mesha: "मेष (Aries) – साहसी और ऊर्जावान",
        vrishabha: "वृषभ (Taurus) – स्थिर और वफादार",
        mithuna: "मिथुन (Gemini) –Bबातचीत करने वाला और जिज्ञासु",
        karka: "कर्क (Cancer) – भावुक और पोषण करने वाला",
        simha: "सिंह (Leo) – गर्वित और मजबूत",
        kanya: "कन्या (Virgo) – व्यावहारिक और पूर्णतावादी",
        tula: "तुला (Libra) – संतुलित और आकर्षक",
        vrischika: "वृश्चिक (Scorpio) – गहरा और शक्तिशाली",
        dhanu: "धनु (Sagittarius) – साहसी और बुद्धिमान",
        makara: "मकर (Capricorn) – अनुशासित और मेहनती",
        kumbha: "कुंभ (Aquarius) – अभिनव और स्वतंत्र",
        meena: "मीन (Pisces) – संवेदनशील और कलात्मक",
        zodiacConclusion: "प्रत्येक राशि का एक ग्रह स्वामी होता है और उसके अपने गुण होते हैं। जन्म के समय इन राशियों में ग्रहों की स्थिति का अध्ययन करके भविष्यवाणियां की जाती हैं।",
        navagrahasTitle: "नवग्रह – 9 ग्रहों का प्रभाव",
        navagrahasIntro: "नवग्रह हैं:",
        sun: "सूर्य (Surya)",
        moon: "चंद्रमा (Chandra)",
        mars: "मंगल (Mangal)",
        mercury: "बुध (Budh)",
        jupiter: "बृहस्पति (Guru)",
        venus: "शुक्र (Shukra)",
        saturn: "शनि (Shani)",
        rahu: "राहु (चंद्रमा का उत्तरी नोड)",
        ketu: "केतु (चंद्रमा का दक्षिणी नोड)",
        navagrahasConclusion: "ये ग्रह हमारे जीवन के विभिन्न हिस्सों को प्रभावित करते हैं – स्वास्थ्य और करियर से लेकर प्रेम और भाग्य तक। ज्योतिषी भविष्यवाणियां करने के लिए आपकी जन्म कुंडली में उनकी स्थिति की जांच करते हैं।",
        back: "होम पर वापस",
      },
      te: {
        title: "వేద జ్యోతిష్య రాశులు మరియు వాటి ప్రాముఖ్యత",
        intro: "వేద జ్యోతిష్యశాస్త్రంలో, 12 రాశులు, 9 గ్రహాలు (నవగ్రహాలు), 12 భావాలు మరియు 27 చంద్ర నక్షత్రాలు (నక్షత్రాలు) ఉన్నాయి. ఇక్కడ ఒక సాధారణ వివరణ ఉంది:",
        zodiacSignsTitle: "12 రాశులు:",
        mesha: "మేష (Aries) – ధైర్యవంతులు మరియు శక్తివంతులు",
        vrishabha: "వృషభ (Taurus) – స్థిరంగా మరియు నమ్మకమైన",
        mithuna: "మిథున (Gemini) – సంభాషణాత్మక మరియు ఆసక్తిగల",
        karka: "కర్క (Cancer) – భావోద్వేగ మరియు పోషించే",
        simha: "సింహ (Leo) – గర్వంగా మరియు బలంగా",
        kanya: "కన్య (Virgo) – ఆచరణాత్మక మరియు పరిపూర్ణమైన",
        tula: "తుల (Libra) – సమతుల్య మరియు ఆకర్షణీయమైన",
        vrischika: "వృశ్చిక (Scorpio) – లోతైన మరియు శక్తివంతమైన",
        dhanu: "ధనుస్సు (Sagittarius) – సాహసోపేత మరియు జ్ఞానవంతులు",
        makara: "మకర (Capricorn) – క్రమశిక్షణ మరియు కష్టపడే",
        kumbha: "కుంభ (Aquarius) – వినూత్న మరియు స్వతంత్ర",
        meena: "మీన (Pisces) – సున్నితమైన మరియు కళాత్మక",
        zodiacConclusion: "ప్రతి రాశికి ఒక గ్రహం అధిపతిగా ఉంటుంది మరియు దానికి దాని స్వంత గుణాలు ఉంటాయి. జన్మ సమయంలో ఈ రాశులలో గ్రహాల స్థానాన్ని అధ్యయనం చేయడం ద్వారా అంచనాలు వేయబడతాయి.",
        navagrahasTitle: "నవగ్రహాలు – 9 గ్రహ ప్రభావాలు",
        navagrahasIntro: "నవగ్రహాలు:",
        sun: "సూర్యుడు (Surya)",
        moon: "చంద్రుడు (Chandra)",
        mars: "అంగారకుడు (Mangal)",
        mercury: "బుధుడు (Budh)",
        jupiter: "గురువు (Guru)",
        venus: "శుక్రుడు (Shukra)",
        saturn: "శని (Shani)",
        rahu: "రాహువు (చంద్రుని ఉత్తర నోడ్)",
        ketu: "కేతువు (చంద్రుని దక్షిణ నోడ్)",
        navagrahasConclusion: "ఈ గ్రహాలు ఆరోగ్యం మరియు వృత్తి నుండి ప్రేమ మరియు విధి వరకు మన జీవితంలోని వివిధ భాగాలను ప్రభావితం చేస్తాయి. జ్యోతిష్యులు అంచనాలు అందించడానికి మీ జనన చార్ట్‌లో వాటి స్థానాలను తనిఖీ చేస్తారు.",
        back: "హోమ్‌కు తిరిగి వెళ్ళు",
      },
      ml: {
        title: "വേദ ജ്യോതിഷ രാശികളും അവയുടെ പ്രാധാന്യവും",
        intro: "വേദ ജ്യോതിഷത്തിൽ, 12 രാശികൾ, 9 ഗ്രഹങ്ങൾ (നവഗ്രഹങ്ങൾ), 12 ഭാവങ്ങൾ, 27 ചാന്ദ്ര നക്ഷത്രസമൂഹങ്ങൾ (നക്ഷത്രങ്ങൾ) എന്നിവയുണ്ട്. ഒരു ലളിതമായ വിശകലനം ഇതാ:",
        zodiacSignsTitle: "12 രാശികൾ (രാശി):",
        mesha: "മേടം (Aries) – ധീരനും ഊർജ്ജസ്വലനും",
        vrishabha: "ഇടവം (Taurus) – സ്ഥിരവും വിശ്വസ്തനും",
        mithuna: "മിഥുനം (Gemini) – സംഭാഷണ പ്രിയനും കൗതുകിയും",
        karka: "കർക്കടകം (Cancer) – വൈകാരികനും പരിപോഷിപ്പിക്കുന്നവനും",
        simha: "ചിങ്ങം (Leo) – അഭിമാനിയും ശക്തനും",
        kanya: "കന്നി (Virgo) – പ്രായോഗികനും പൂർണ്ണതാവാദിയും",
        tula: "തുലാം (Libra) – സന്തുലിതനും ആകർഷകനും",
        vrischika: "വൃശ്ചികം (Scorpio) – ആഴമേറിയവനും ശക്തനും",
        dhanu: "ധനു (Sagittarius) – സാഹസികനും ജ്ഞാനിയും",
        makara: "മകരം (Capricorn) – അച്ചടക്കമുള്ളവനും കഠിനാധ്വാനിയും",
        kumbha: "കുംഭം (Aquarius) – നൂതനവും സ്വതന്ത്രനും",
        meena: "മീനം (Pisces) – സംവേദനക്ഷമനും കലാകാരനും",
        zodiacConclusion: "ഓരോ രാശിക്കും ഒരു ഗ്രഹത്തിന്റെ ഭരണം ഉണ്ട്, അതിന് അതിൻ്റേതായ ഗുണങ്ങളുമുണ്ട്. ജനനസമയത്ത് ഈ രാശികളിൽ ഗ്രഹങ്ങളുടെ സ്ഥാനം പഠിച്ച് പ്രവചനങ്ങൾ നടത്തുന്നു.",
        navagrahasTitle: "നവഗ്രഹങ്ങൾ – 9 ഗ്രഹ സ്വാധീനക്കാർ",
        navagrahasIntro: "നവഗ്രഹങ്ങൾ ഇവയാണ്:",
        sun: "സൂര്യൻ (Surya)",
        moon: "ചന്ദ്രൻ (Chandra)",
        mars: "ചൊവ്വ (Mangal)",
        mercury: "ബുധൻ (Budh)",
        jupiter: "വ്യാഴം (Guru)",
        venus: "ശുക്രൻ (Shukra)",
        saturn: "ശനി (Shani)",
        rahu: "രാഹു (ചന്ദ്രന്റെ വടക്കേ നോഡ്)",
        ketu: "കേതു (ചന്ദ്രന്റെ തെക്കേ നോഡ്)",
        navagrahasConclusion: "ഈ ഗ്രഹങ്ങൾ നമ്മുടെ ജീവിതത്തിന്റെ വിവിധ ഭാഗങ്ങളെ സ്വാധീനിക്കുന്നു – ആരോഗ്യം, തൊഴിൽ മുതൽ സ്നേഹം, വിധി വരെ. പ്രവചനങ്ങൾ നൽകുന്നതിന് ജ്യോതിഷികൾ നിങ്ങളുടെ ജനന ചാർട്ടിലെ അവരുടെ സ്ഥാനങ്ങൾ പരിശോധിക്കുന്നു.",
        back: "ഹോമിലേക്ക് തിരികെ",
      },
      ta: {
        title: "ஜோதிட நுண்ணறிவுகளுக்கு வரவேற்கிறோம்",
        intro: "வேத ஜோதிடத்தில், 12 ராசிகள், 9 கிரகங்கள் (நவக்கிரகங்கள்), 12 வீடுகள் மற்றும் 27 நட்சத்திரங்கள் உள்ளன. இங்கே ஒரு எளிய விளக்கம்:",
        zodiacSignsTitle: "12 ராசிகள்:",
        mesha: "மேஷம் (Aries) – துணிச்சலான மற்றும் ஆற்றல் மிக்க",
        vrishabha: "ரிஷபம் (Taurus) – நிலையான மற்றும் விசுவாசமான",
        mithuna: "மிதுனம் (Gemini) – தொடர்பு மற்றும் ஆர்வமுள்ள",
        karka: "கடகம் (Cancer) – உணர்ச்சிவசப்பட்ட மற்றும் வளர்ப்பு",
        simha: "சிம்மம் (Leo) – பெருமை மற்றும் வலிமையான",
        kanya: "கன்னி (Virgo) – நடைமுறை மற்றும் பரிபூரணமான",
        tula: "துலாம் (Libra) – சமநிலையான மற்றும் கவர்ச்சிகரமான",
        vrischika: "விருச்சிகம் (Scorpio) – ஆழமான மற்றும் சக்திவாய்ந்த",
        dhanu: "தனுசு (Sagittarius) – சாகச மற்றும் ஞானமுள்ள",
        makara: "மகரம் (Capricorn) – ஒழுக்கமான மற்றும் கடின உழைப்பாளி",
        kumbha: "கும்பம் (Aquarius) – புதுமையான மற்றும் சுதந்திரமான",
        meena: "மீனம் (Pisces) – உணர்திறன் மற்றும் கலைத்திறன்",
        zodiacConclusion: "ஒவ்வொரு ராசியும் ஒரு கிரகத்தால் ஆளப்படுகிறது மற்றும் அதன் சொந்த குணங்களைக் கொண்டுள்ளது. பிறக்கும் நேரத்தில் இந்த ராசிகளில் கிரகங்களின் நிலையைப் படிப்பதன் மூலம் கணிப்புகள் செய்யப்படுகின்றன.",
        navagrahasTitle: "நவக்கிரகங்கள் – 9 கிரகங்களின் செல்வாக்கு",
        navagrahasIntro: "நவக்கிரகங்கள்:",
        sun: "சூரியன் (Surya)",
        moon: "சந்திரன் (Chandra)",
        mars: "செவ்வாய் (Mangal)",
        mercury: "புதன் (Budh)",
        jupiter: "குரு (Guru)",
        venus: "சுக்கிரன் (Shukra)",
        saturn: "சனி (Shani)",
        rahu: "ராகு (சந்திரனின் வடக்கு முனை)",
        ketu: "கேது (சந்திரனின் தெற்கு முனை)",
        navagrahasConclusion: "இந்த கிரகங்கள் நமது வாழ்க்கையின் பல்வேறு பகுதிகளை பாதிக்கின்றன – ஆரோக்கியம் மற்றும் தொழில் முதல் அன்பு மற்றும் விதி வரை. ஜோதிடர்கள் கணிப்புகளை வழங்க உங்கள் பிறப்பு அட்டவணையில் அவற்றின் நிலைகளை சரிபார்க்கிறார்கள்.",
        back: "முகப்புக்கு திரும்பு",
      },
      kn: {
        title: "ಜ್ಯೋತಿಷ್ಯ ಒಳನೋಟಗಳಿಗೆ ಸ್ವಾಗತ",
        enterDetails: "ನಿಮ್ಮ ಜನ್ಮ ವಿವರಗಳನ್ನು ನಮೂದಿಸಿ",
        birthDate: "ಜನ್ಮ ದಿನಾಂಕ",
        birthTime: "ಜನ್ಮ ಸಮಯ",
        birthPlace: "ಜನ್ಮ ಸ್ಥಳ",
        saveDetails: "ವಿವರಗಳನ್ನು ಉಳಿಸಿ",
        sendEmail: "ಇಮೇಲ್ ಮೂಲಕ ವಿವರಗಳನ್ನು ಕಳುಹಿಸಿ",
        viewFacts: "ಜ್ಯೋತಿಷ್ಯ ಸಂಗತಿಗಳನ್ನು ವೀಕ್ಷಿಸಿ",
        advancedAstrology: "ಜ್ಯೋತಿಷ್ಯ vs. ಆಧುನಿಕ ವಿಜ್ಞಾನ",
        vedicSigns: "ವೈದಿಕ ಜ್ಯೋತಿಷ್ಯ ಚಿಹ್ನೆಗಳು ಮತ್ತು ಅವುಗಳ ಪ್ರಾಮುಖ್ಯತೆ",
        myServices: "ನಮ್ಮ ಸೇವೆಗಳನ್ನು ಅನ್ವೇಷಿಸಿ",
        customerReviews: "ಗ್ರಾಹಕ ವಿಮರ್ಶೆಗಳು ಮತ್ತು ರೇಟಿಂಗ್‌ಗಳು",
        nakshatras: "27 ನಕ್ಷತ್ರಗಳ ಬಗ್ಗೆ ಸಾಮಾನ್ಯ ವಿವರಗಳು", // New translation
        detailsSaved: "ಜನ್ಮ ವಿವರಗಳನ್ನು ಯಶಸ್ವಿಯಾಗಿ ಉಳಿಸಲಾಗಿದೆ!",
        failedToSave: "ವಿವರಗಳನ್ನು ಉಳಿಸಲು ವಿಫಲವಾಗಿದೆ:",
        notAuthenticated: "ದೋಷ: ಬಳಕೆದಾರರನ್ನು ದೃಢೀಕರಿಸಲಾಗಿಲ್ಲ. ದಯವಿಟ್ಟು ಲಾಗಿನ್ ಮಾಡಿ.",
        saveDetailsFirst: "ಇಮೇಲ್ ಮೂಲಕ ಕಳುಹಿಸುವ ಮೊದಲು ದಯವಿಟ್ಟು ನಿಮ್ಮ ಜನ್ಮ ವಿವರಗಳನ್ನು ಉಳಿಸಿ.",
        emailSending: "ಇಮೇಲ್ ಕಳುಹಿಸಲಾಗುತ್ತಿದೆ...",
        emailSentSuccess: "ಇಮೇಲ್ ಯಶಸ್ವಿಯಾಗಿ ಕಳುಹಿಸಲಾಗಿದೆ!",
        emailSentFail: "ಇಮೇಲ್ ಕಳುಹಿಸಲು ವಿಫಲವಾಗಿದೆ:",
      },
    };
    return translations[defaultLanguage]?.[key] || translations['en'][key];
  };

  return (
    <div className="bg-purple-700 p-8 rounded-2xl shadow-xl max-w-3xl w-full border border-purple-600">
      <h2 className="text-3xl font-bold text-center mb-6 text-white">
        {getTranslation('title')}
      </h2>

      <div className="text-lg text-white mb-6">
        <p className="mb-4">{getTranslation('intro')}</p>

        <h3 className="text-2xl font-semibold mb-3">{getTranslation('zodiacSignsTitle')}</h3>
        <ul className="list-disc list-inside space-y-2 mb-4">
          <li><strong>{getTranslation('mesha')}</strong></li>
          <li><strong>{getTranslation('vrishabha')}</strong></li>
          <li><strong>{getTranslation('mithuna')}</strong></li>
          <li><strong>{getTranslation('karka')}</strong></li>
          <li><strong>{getTranslation('simha')}</strong></li>
          <li><strong>{getTranslation('kanya')}</strong></li>
          <li><strong>{getTranslation('tula')}</strong></li>
          <li><strong>{getTranslation('vrischika')}</strong></li>
          <li><strong>{getTranslation('dhanu')}</strong></li>
          <li><strong>{getTranslation('makara')}</strong></li>
          <li><strong>{getTranslation('kumbha')}</strong></li>
          <li><strong>{getTranslation('meena')}</strong></li>
        </ul>
        <p className="mb-6">{getTranslation('zodiacConclusion')}</p>

        <h3 className="text-2xl font-semibold mb-3">{getTranslation('navagrahasTitle')}</h3>
        <p className="mb-4">{getTranslation('navagrahasIntro')}</p>
        <ul className="list-disc list-inside space-y-2 mb-4">
          <li><strong>{getTranslation('sun')}</strong></li>
          <li><strong>{getTranslation('moon')}</strong></li>
          <li><strong>{getTranslation('mars')}</strong></li>
          <li><strong>{getTranslation('mercury')}</strong></li>
          <li><strong>{getTranslation('jupiter')}</strong></li>
          <li><strong>{getTranslation('venus')}</strong></li>
          <li><strong>{getTranslation('saturn')}</strong></li>
          <li><strong>{getTranslation('rahu')}</strong></li>
          <li><strong>{getTranslation('ketu')}</strong></li>
        </ul>
        <p>{getTranslation('navagrahasConclusion')}</p>
      </div>

      <button
        onClick={() => setCurrentPage('home')}
        className="mt-8 w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-6 rounded-lg shadow-md transition duration-300 ease-in-out transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-opacity-75"
      >
        {getTranslation('back')}
      </button>
    </div>
  );
}

// Services Page component: Explains the types of astrology services offered
function ServicesPage() {
  const { setCurrentPage, defaultLanguage } = useContext(AuthContext);
  const [services, setServices] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const getTranslation = (key) => {
    const translations = {
      en: {
        title: "Our Astrology Services",
        loading: "Loading services information...",
        back: "Back to Home",
        error: "Failed to load services. Please try again.",
      },
      hi: {
        title: "हमारी ज्योतिष सेवाएँ",
        loading: "सेवाओं की जानकारी लोड हो रही है...",
        back: "होम पर वापस",
        error: "सेवाएं लोड करने में विफल। कृपया पुन: प्रयास करें।",
      },
      te: {
        title: "మా జ్యోతిష్య సేవలు",
        loading: "సేవల సమాచారం లోడ్ అవుతోంది...",
        back: "హోమ్‌కు తిరిగి వెళ్ళు",
        error: "సేవలను లోడ్ చేయడంలో విఫలమైంది. దయచేసి మళ్ళీ ప్రయత్నించండి.",
      },
      ml: {
        title: "ഞങ്ങളുടെ ജ്യോതിഷ സേവനങ്ങൾ",
        loading: "സേവന വിവരങ്ങൾ ലോഡ് ചെയ്യുന്നു...",
        back: "ഹോമിലേക്ക് തിരികെ",
        error: "സേവനങ്ങൾ ലോഡ് ചെയ്യുന്നതിൽ പരാജയപ്പെട്ടു. ദയവായി വീണ്ടും ശ്രമിക്കുക.",
      },
      ta: {
        title: "எங்கள் ஜோதிட சேவைகள்",
        loading: "சேவை தகவலை ஏற்றுகிறது...",
        back: "முகப்புக்கு திரும்பு",
        error: "சேவைகளை ஏற்ற முடியவில்லை. மீண்டும் முயற்சிக்கவும்.",
      },
      kn: {
        title: "ನಮ್ಮ ಜ್ಯೋತಿಷ್ಯ ಸೇವೆಗಳು",
        loading: "ಸೇವಾ ಮಾಹಿತಿಯನ್ನು ಲೋಡ್ ಮಾಡಲಾಗುತ್ತಿದೆ...",
        back: "ಮನೆಗೆ ಹಿಂತಿರುಗಿ",
        error: "ಸೇವೆಗಳನ್ನು ಲೋಡ್ ಮಾಡಲು ವಿಫಲವಾಗಿದೆ. ದಯವಿಟ್ಟು ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.",
      },
    };
    return translations[defaultLanguage]?.[key] || translations['en'][key];
  };

  useEffect(() => {
    const fetchServices = async () => {
      setLoading(true);
      setError('');
      try {
        const prompt = `Provide a detailed explanation of common astrology services in ${defaultLanguage} language. Include services like:
          * Natal Chart Reading: Understanding individual personality, strengths, and challenges based on birth details.
          * Compatibility Analysis (Synastry): Assessing romantic or business compatibility between individuals.
          * Predictive Astrology (Dashas, Transits): Forecasting future events and periods based on planetary movements.
          * Remedial Astrology: Suggesting remedies (gems, mantras, rituals) to mitigate negative planetary influences.
          * Vastu Shastra Consultation: Guidance on architectural science for harmony and prosperity.
          * Career & Finance Astrology: Insights into professional success and financial well-being.
          * Health Astrology: Understanding predispositions to health issues and suggesting astrological remedies.
          Format the response with clear headings and bullet points for each service, and include a brief introductory and concluding paragraph.`;

        const chatHistory = [{ role: "user", parts: [{ text: prompt }] }];
        const payload = { contents: chatHistory };
        const apiKey = "";
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;

        const response = await fetch(apiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        const result = await response.json();
        if (result.candidates && result.candidates.length > 0 &&
            result.candidates[0].content && result.candidates[0].content.parts &&
            result.candidates[0].content.parts.length > 0) {
          const text = result.candidates[0].content.parts[0].text;
          setServices(text);
        } else {
          setError(getTranslation('error'));
        }
      } catch (err) {
        console.error("Error fetching services content:", err);
        setError(getTranslation('error') + `: ${err.message}`);
      } finally {
        setLoading(false);
      }
    };
    fetchServices();
  }, [defaultLanguage]);


  return (
    <div className="bg-purple-700 p-8 rounded-2xl shadow-xl max-w-3xl w-full border border-purple-600">
      <h2 className="text-3xl font-bold text-center mb-6 text-white">
        {getTranslation('title')}
      </h2>

      {loading && (
        <div className="flex items-center justify-center text-blue-300">
          <svg className="animate-spin h-5 w-5 mr-3 text-blue-300" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          {getTranslation('loading')}
        </div>
      )}
      {error && <p className="text-red-300 mt-4 text-center">{error}</p>}
      {services && (
        <div className="bg-purple-600 p-6 rounded-lg text-white prose prose-invert max-w-none">
          <div dangerouslySetInnerHTML={{ __html: services.replace(/\n/g, '<br>') }} />
        </div>
      )}

      <button
        onClick={() => setCurrentPage('home')}
        className="mt-8 w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-6 rounded-lg shadow-md transition duration-300 ease-in-out transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-opacity-75"
      >
        {getTranslation('back')}
      </button>
    </div>
  );
}

// Reviews and Ratings Page Component: Allows users to submit reviews and view existing ones
function ReviewsRatingsPage() {
  const { db, userId, user, defaultLanguage, functions } = useContext(AuthContext);
  const [reviewText, setReviewText] = useState('');
  const [rating, setRating] = useState(0);
  const [reviews, setReviews] = useState([]);
  const [message, setMessage] = useState('');
  const [loadingSubmit, setLoadingSubmit] = useState(false);
  const [loadingReviews, setLoadingReviews] = useState(true);
  const [errorReviews, setErrorReviews] = useState('');

  const getTranslation = (key) => {
    const translations = {
      en: {
        title: "Customer Reviews & Ratings",
        submitReview: "Submit Your Review",
        yourRating: "Your Rating:",
        yourReview: "Your Review:",
        postReview: "Post Review",
        reviewsHeading: "What Our Customers Say:",
        noReviews: "No reviews yet. Be the first to share your experience!",
        back: "Back to Home",
        success: "Review submitted successfully!",
        errorSubmit: "Failed to submit review:",
        errorFetch: "Failed to load reviews:",
        charactersRemaining: "characters remaining",
        loginToReview: "Please log in to submit a review.",
        reviewPlaceholder: "Share your experience...",
      },
      hi: {
        title: "ग्राहक समीक्षाएँ और रेटिंग",
        submitReview: "अपनी समीक्षा सबमिट करें",
        yourRating: "आपकी रेटिंग:",
        yourReview: "आपकी समीक्षा:",
        postReview: "समीक्षा पोस्ट करें",
        reviewsHeading: "हमारे ग्राहक क्या कहते हैं:",
        noReviews: "अभी तक कोई समीक्षा नहीं। अपनी प्रतिक्रिया देने वाले पहले व्यक्ति बनें!",
        back: "होम पर वापस",
        success: "समीक्षा सफलतापूर्वक सबमिट की गई!",
        errorSubmit: "समीक्षा सबमिट करने में विफल:",
        errorFetch: "समीक्षाएं लोड करने में विफल:",
        charactersRemaining: "वर्ण शेष",
        loginToReview: "समीक्षा सबमिट करने के लिए कृपया लॉग इन करें।",
        reviewPlaceholder: "अपना अनुभव साझा करें...",
      },
      te: {
        title: "కస్టమర్ సమీక్షలు & రేటింగ్‌లు",
        submitReview: "మీ సమీక్షను సమర్పించండి",
        yourRating: "మీ రేటింగ్:",
        yourReview: "మీ సమీక్ష:",
        postReview: "సమీక్షను పోస్ట్ చేయండి",
        reviewsHeading: "మా కస్టమర్లు ఏమి చెబుతారు:",
        noReviews: "ఇప్పటివరకు సమీక్షలు లేవు. మీ అనుభవాన్ని పంచుకున్న మొదటి వ్యక్తిగా ఉండండి!",
        back: "హోమ్‌కు తిరిగి వెళ్ళు",
        success: "సమీక్ష విజయవంతంగా సమర్పించబడింది!",
        errorSubmit: "సమీక్షను సమర్పించడంలో విఫలమైంది:",
        errorFetch: "సమీక్షలను లోడ్ చేయడంలో విఫలమైంది:",
        charactersRemaining: "అక్షరాలు మిగిలి ఉన్నాయి",
        loginToReview: "సమీక్షను సమర్పించడానికి దయచేసి లాగిన్ అవ్వండి.",
        reviewPlaceholder: "మీ అనుభవాన్ని పంచుకోండి...",
      },
      ml: {
        title: "ഉപഭോക്തൃ അവലോകനങ്ങളും റേറ്റിംഗുകളും",
        submitReview: "നിങ്ങളുടെ അവലോകനം സമർപ്പിക്കുക",
        yourRating: "നിങ്ങളുടെ റേറ്റിംഗ്:",
        yourReview: "നിങ്ങളുടെ അവലോകനം:",
        postReview: "അവലോകനം പോസ്റ്റ് ചെയ്യുക",
        reviewsHeading: "ഞങ്ങളുടെ ഉപഭോക്താക്കൾ പറയുന്നത്:",
        noReviews: "അവലോകനങ്ങൾ ലഭ്യമല്ല. നിങ്ങളുടെ അനുഭവം പങ്കിടുന്ന ആദ്യ വ്യക്തിയാകൂ!",
        back: "ഹോമിലേക്ക് തിരികെ",
        success: "അവലോകനം വിജയകരമായി സമർപ്പിച്ചു!",
        errorSubmit: "അവലോകനം സമർപ്പിക്കുന്നതിൽ പരാജയപ്പെട്ടു:",
        errorFetch: "അവലോകനങ്ങൾ ലോഡ് ചെയ്യുന്നതിൽ പരാജയപ്പെട്ടു:",
        charactersRemaining: "അക്ഷരങ്ങൾ ബാക്കിയുണ്ട്",
        loginToReview: "ഒരു അവലോകനം സമർപ്പിക്കാൻ ദയവായി ലോഗിൻ ചെയ്യുക.",
        reviewPlaceholder: "നിങ്ങളുടെ അനുഭവം പങ്കിടുക...",
      },
      ta: {
        title: "வாடிக்கையாளர் மதிப்புரைகள் மற்றும் மதிப்பீடுகள்",
        submitReview: "உங்கள் மதிப்பாய்வைச் சமர்ப்பிக்கவும்",
        yourRating: "உங்கள் மதிப்பீடு:",
        yourReview: "உங்கள் மதிப்பாய்வு:",
        postReview: "மதிப்பாய்வை இடுகையிடவும்",
        reviewsHeading: "எங்கள் வாடிக்கையாளர்கள் என்ன சொல்கிறார்கள்:",
        noReviews: "இதுவரை மதிப்புரைகள் இல்லை. உங்கள் அனுபவத்தைப் பகிர்ந்து கொள்ள முதல் நபராக இருங்கள்!",
        back: "முகப்புக்கு திரும்பு",
        success: "மதிப்பாய்வு வெற்றிகரமாகச் சமர்ப்பிக்கப்பட்டது!",
        errorSubmit: "மதிப்பாய்வைச் சமர்ப்பிக்க முடியவில்லை:",
        errorFetch: "மதிப்பாய்வுகளை ஏற்ற முடியவில்லை:",
        charactersRemaining: "எழுத்துக்கள் மீதமுள்ளன",
        loginToReview: "மதிப்பாய்வைச் சமர்ப்பிக்க உள்நுழையவும்.",
        reviewPlaceholder: "உங்கள் அனுபவத்தைப் பகிரவும்...",
      },
      kn: {
        title: "ಗ್ರಾಹಕರ ವಿಮರ್ಶೆಗಳು ಮತ್ತು ರೇಟಿಂಗ್‌ಗಳು",
        submitReview: "ನಿಮ್ಮ ವಿಮರ್ಶೆಯನ್ನು ಸಲ್ಲಿಸಿ",
        yourRating: "ನಿಮ್ಮ ರೇಟಿಂಗ್:",
        yourReview: "ನಿಮ್ಮ ವಿಮರ್ಶೆ:",
        postReview: "ವಿಮರ್ಶೆ ಪೋಸ್ಟ್ ಮಾಡಿ",
        reviewsHeading: "ನಮ್ಮ ಗ್ರಾಹಕರು ಏನನ್ನು ಹೇಳುತ್ತಾರೆ:",
        noReviews: "ಇನ್ನೂ ಯಾವುದೇ ವಿಮರ್ಶೆಗಳಿಲ್ಲ. ನಿಮ್ಮ ಅನುಭವವನ್ನು ಹಂಚಿಕೊಳ್ಳಲು ಮೊದಲಿಗರಾಗಿರಿ!",
        back: "ಮನೆಗೆ ಹಿಂತಿರುಗಿ",
        success: "ವಿಮರ್ಶೆಯನ್ನು ಯಶಸ್ವಿಯಾಗಿ ಸಲ್ಲಿಸಲಾಗಿದೆ!",
        errorSubmit: "ವಿಮರ್ಶೆಯನ್ನು ಸಲ್ಲಿಸಲು ವಿಫಲವಾಗಿದೆ:",
        errorFetch: "ವಿಮರ್ಶೆಗಳನ್ನು ಲೋಡ್ ಮಾಡಲು ವಿಫಲವಾಗಿದೆ:",
        charactersRemaining: "ಅಕ್ಷರಗಳು ಉಳಿದಿವೆ",
        loginToReview: "ವಿಮರ್ಶೆಯನ್ನು ಸಲ್ಲಿಸಲು ದಯವಿಟ್ಟು ಲಾಗಿನ್ ಮಾಡಿ.",
        reviewPlaceholder: "ನಿಮ್ಮ ಅನುಭವವನ್ನು ಹಂಚಿಕೊಳ್ಳಿ...",
      },
    };
    return translations[defaultLanguage]?.[key] || translations['en'][key];
  };

  useEffect(() => {
    // Listener for real-time updates to reviews from Firestore
    if (db) {
      setLoadingReviews(true);
      setErrorReviews('');
      try {
        const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
        const reviewsCollectionRef = collection(db, `artifacts/${appId}/public/data/reviews`);
        // Order by timestamp, though `orderBy` needs index in Firestore, commenting for now
        const q = query(reviewsCollectionRef); // Removed orderBy to avoid index requirement
        const unsubscribe = onSnapshot(q, (snapshot) => {
          const fetchedReviews = snapshot.docs.map(doc => ({
            id: doc.id,
            ...doc.data(),
            timestamp: doc.data().timestamp?.toDate().toLocaleString() // Convert Firestore timestamp to readable string
          }));
          setReviews(fetchedReviews);
          setLoadingReviews(false);
        }, (error) => {
          console.error("Error fetching reviews:", error);
          setErrorReviews(`${getTranslation('errorFetch')} ${error.message}`);
          setLoadingReviews(false);
        });
        return () => unsubscribe(); // Cleanup the listener
      } catch (e) {
        console.error("Error setting up reviews listener:", e);
        setErrorReviews(`${getTranslation('errorFetch')} ${e.message}`);
        setLoadingReviews(false);
      }
    }
  }, [db, defaultLanguage]); // Added defaultLanguage to dependencies of useEffect for getTranslation

  const handleSubmitReview = async (e) => {
    e.preventDefault();
    if (!user || !db) {
      setMessage(getTranslation('loginToReview'));
      setTimeout(() => setMessage(''), 3000);
      return;
    }
    if (!reviewText.trim() || rating === 0) {
      setMessage("Please provide both a rating and a review.");
      setTimeout(() => setMessage(''), 3000);
      return;
    }

    setLoadingSubmit(true);
    setMessage('');
    try {
      const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
      const reviewsCollectionRef = collection(db, `artifacts/${appId}/public/data/reviews`);
      await addDoc(reviewsCollectionRef, {
        userId: userId,
        userName: user.email || 'Anonymous', // Use user email if available, otherwise Anonymous
        rating: rating,
        reviewText: reviewText,
        timestamp: new Date(),
      });
      setMessage(getTranslation('success'));
      setReviewText('');
      setRating(0);
    } catch (error) {
      console.error("Error submitting review:", error);
      setMessage(`${getTranslation('errorSubmit')} ${error.message}`);
    } finally {
      setLoadingSubmit(false);
      setTimeout(() => setMessage(''), 3000);
    }
  };

  const maxReviewLength = 500;
  const charactersRemaining = maxReviewLength - reviewText.length;

  return (
    <div className="bg-purple-700 p-8 rounded-2xl shadow-xl max-w-3xl w-full border border-purple-600">
      <h2 className="text-3xl font-bold text-center mb-6 text-white">
        {getTranslation('title')}
      </h2>

      {/* Review Submission Form */}
      {user ? (
        <form onSubmit={handleSubmitReview} className="space-y-6 mb-8 p-6 bg-purple-600 rounded-lg shadow-inner">
          <h3 className="text-xl font-semibold text-white mb-4">{getTranslation('submitReview')}</h3>
          <div>
            <label className="block text-white text-sm font-semibold mb-2">{getTranslation('yourRating')}</label>
            <div className="flex items-center space-x-1">
              {[1, 2, 3, 4, 5].map((star) => (
                <span
                  key={star}
                  className={`text-3xl cursor-pointer ${star <= rating ? 'text-yellow-400' : 'text-gray-400'}`}
                  onClick={() => setRating(star)}
                >
                  ★
                </span>
              ))}
            </div>
          </div>
          <div>
            <label className="block text-white text-sm font-semibold mb-2" htmlFor="reviewText">
              {getTranslation('yourReview')}
            </label>
            <textarea
              id="reviewText"
              value={reviewText}
              onChange={(e) => setReviewText(e.target.value.slice(0, maxReviewLength))}
              className="w-full p-3 rounded-lg bg-purple-500 text-white border border-purple-400 focus:outline-none focus:ring-2 focus:ring-purple-300 focus:border-transparent"
              rows="4"
              placeholder={getTranslation('reviewPlaceholder')}
              required
            ></textarea>
            <p className="text-right text-sm text-gray-300 mt-1">
              {charactersRemaining} {getTranslation('charactersRemaining')}
            </p>
          </div>
          {message && (
            <p className={`text-sm mt-2 ${message.includes('success') ? 'text-green-300' : 'text-red-300'}`}>
              {message}
            </p>
          )}
          <button
            type="submit"
            disabled={loadingSubmit || !reviewText.trim() || rating === 0}
            className="w-full bg-indigo-600 hover:bg-indigo-700 text-white font-bold py-3 px-6 rounded-lg shadow-md transition duration-300 ease-in-out transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-opacity-75 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loadingSubmit ? 'Submitting...' : getTranslation('postReview')}
          </button>
        </form>
      ) : (
        <p className="text-center text-red-300 text-lg mb-8">{getTranslation('loginToReview')}</p>
      )}

      {/* Display Existing Reviews */}
      <h3 className="text-2xl font-bold text-white mb-6">{getTranslation('reviewsHeading')}</h3>
      {loadingReviews && (
        <div className="flex items-center justify-center text-blue-300">
          <svg className="animate-spin h-5 w-5 mr-3 text-blue-300" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          Loading reviews...
        </div>
      )}
      {errorReviews && <p className="text-red-300 mt-4 text-center">{errorReviews}</p>}
      {!loadingReviews && reviews.length === 0 && (
        <p className="text-center text-gray-300">{getTranslation('noReviews')}</p>
      )}
      <div className="space-y-6">
        {reviews.map((review) => (
          <div key={review.id} className="bg-purple-600 p-6 rounded-lg shadow-md border border-purple-500">
            <div className="flex items-center mb-2">
              <span className="text-yellow-400 text-xl font-bold mr-2">
                {'★'.repeat(review.rating)}
              </span>
              <span className="text-gray-300">({review.rating}/5)</span>
            </div>
            <p className="text-white text-lg mb-2">{review.reviewText}</p>
            <p className="text-sm text-gray-400">
              By {review.userName} on {review.timestamp}
            </p>
          </div>
        ))}
      </div>

      <button
        onClick={() => setCurrentPage('home')}
        className="mt-8 w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-6 rounded-lg shadow-md transition duration-300 ease-in-out transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-opacity-75"
      >
        {getTranslation('back')}
      </button>
    </div>
  );
}

// Nakshatras Page Component: Displays general details about 27 Nakshatras (Stars)
function NakshatrasPage() {
  const { setCurrentPage, defaultLanguage } = useContext(AuthContext);
  const [nakshatrasContent, setNakshatrasContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const getTranslation = (key) => {
    const translations = {
      en: {
        title: "27 Nakshatras (Stars) in Vedic Astrology",
        intro: "Nakshatras, or lunar mansions, are crucial in Vedic astrology, offering a more precise understanding of an individual's personality, destiny, and timing of events than zodiac signs alone. There are 27 Nakshatras, each spanning 13 degrees 20 minutes of the zodiac, and each is ruled by a specific planet and associated with unique characteristics and deities.",
        loading: "Generating Nakshatras details...",
        back: "Back to Home",
        error: "Failed to load Nakshatras details. Please try again.",
      },
      hi: {
        title: "वैदिक ज्योतिष में 27 नक्षत्र (सितारे)",
        intro: "नक्षत्र, या चंद्र हवेली, वैदिक ज्योतिष में महत्वपूर्ण हैं, जो केवल राशियों की तुलना में किसी व्यक्ति के व्यक्तित्व, भाग्य और घटनाओं के समय की अधिक सटीक समझ प्रदान करते हैं। 27 नक्षत्र हैं, प्रत्येक 13 डिग्री 20 मिनट के राशि चक्र में फैला हुआ है, और प्रत्येक एक विशिष्ट ग्रह द्वारा शासित है और अद्वितीय विशेषताओं और देवताओं से जुड़ा हुआ है।",
        loading: "नक्षत्रों का विवरण उत्पन्न हो रहा है...",
        back: "होम पर वापस",
        error: "नक्षत्रों का विवरण लोड करने में विफल। कृपया पुन: प्रयास करें।",
      },
      te: {
        title: "వేద జ్యోతిష్యశాస్త్రంలో 27 నక్షత్రాలు (నక్షత్రాలు)",
        intro: "నక్షత్రాలు లేదా చంద్ర మందిరాలు వేద జ్యోతిష్యశాస్త్రంలో కీలకమైనవి, రాశిచక్రాల కంటే ఒక వ్యక్తి యొక్క వ్యక్తిత్వం, విధి మరియు సంఘటనల సమయాన్ని మరింత ఖచ్చితంగా అర్థం చేసుకోవడానికి వీలు కల్పిస్తాయి. 27 నక్షత్రాలు ఉన్నాయి, ప్రతి ఒక్కటి రాశిచక్రంలో 13 డిగ్రీల 20 నిమిషాలు విస్తరించి ఉంటుంది, మరియు ప్రతి ఒక్కటి ఒక నిర్దిష్ట గ్రహం ద్వారా పాలించబడుతుంది మరియు ప్రత్యేక లక్షణాలు మరియు దేవతలతో సంబంధం కలిగి ఉంటుంది.",
        loading: "నక్షత్రాల వివరాలు ఉత్పత్తి అవుతున్నాయి...",
        back: "హోమ్‌కు తిరిగి వెళ్ళు",
        error: "నక్షత్రాల వివరాలను లోడ్ చేయడంలో విఫలమైంది. దయచేసి మళ్ళీ ప్రయత్నించండి.",
      },
      ml: {
        title: "വേദ ജ്യോതിഷത്തിലെ 27 നക്ഷത്രങ്ങൾ",
        intro: "നക്ഷത്രങ്ങൾ, അല്ലെങ്കിൽ ചാന്ദ്ര മാളികകൾ, വേദ ജ്യോതിഷത്തിൽ നിർണായകമാണ്, രാശിചിഹ്നങ്ങളേക്കാൾ ഒരു വ്യക്തിയുടെ വ്യക്തിത്വം, വിധി, സംഭവങ്ങളുടെ സമയം എന്നിവയെക്കുറിച്ച് കൂടുതൽ കൃത്യമായ ധാരണ നൽകുന്നു. 27 നക്ഷത്രങ്ങളുണ്ട്, ഓരോന്നിനും രാശിചക്രത്തിന്റെ 13 ഡിഗ്രി 20 മിനിറ്റ് വ്യാപിച്ചുകിടക്കുന്നു, ഓരോന്നിനും ഒരു പ്രത്യേക ഗ്രഹത്തിന്റെ ഭരണം ഉണ്ട് കൂടാതെ അതുല്യമായ സ്വഭാവസവിശേഷതകളും ദേവതകളും ഇതിന് ബന്ധപ്പെട്ടിരിക്കുന്നു.",
        loading: "നക്ഷത്ര വിവരങ്ങൾ സൃഷ്ടിക്കുന്നു...",
        back: "ഹോമിലേക്ക് തിരികെ",
        error: "നക്ഷത്ര വിവരങ്ങൾ ലോഡ് ചെയ്യുന്നതിൽ പരാജയപ്പെട്ടു. ദയവായി വീണ്ടും ശ്രമിക്കുക.",
      },
      ta: {
        title: "வேத ஜோதிடத்தில் 27 நட்சத்திரங்கள்",
        intro: "நட்சத்திரங்கள், அல்லது சந்திர மாளிகைகள், வேத ஜோதிடத்தில் முக்கியமானவை, ராசி அறிகுறிகளை விட ஒரு நபரின் ஆளுமை, விதி மற்றும் நிகழ்வுகளின் நேரம் பற்றிய துல்லியமான புரிதலை வழங்குகின்றன. 27 நட்சத்திரங்கள் உள்ளன, ஒவ்வொன்றும் ராசிச்சக்கரத்தில் 13 டிகிரி 20 நிமிடங்கள் பரவி, ஒவ்வொன்றும் ஒரு குறிப்பிட்ட கிரகத்தால் ஆளப்பட்டு, தனித்துவமான குணாதிசயங்கள் மற்றும் தெய்வங்களுடன் தொடர்புடையது.",
        loading: "நட்சத்திரங்கள் விவரங்களை உருவாக்குகிறது...",
        back: "முகப்புக்கு திரும்பு",
        error: "நட்சத்திரங்கள் விவரங்களை ஏற்ற முடியவில்லை. மீண்டும் முயற்சிக்கவும்.",
      },
      kn: {
        title: "ವೈದಿಕ ಜ್ಯೋತಿಷ್ಯದಲ್ಲಿ 27 ನಕ್ಷತ್ರಗಳು",
        intro: "ನಕ್ಷತ್ರಗಳು, ಅಥವಾ ಚಂದ್ರನ ರಾಶಿಗಳು, ವೈದಿಕ ಜ್ಯೋತಿಷ್ಯದಲ್ಲಿ ನಿರ್ಣಾಯಕವಾಗಿವೆ, ರಾಶಿಚಕ್ರ ಚಿಹ್ನೆಗಳಿಗಿಂತ ಹೆಚ್ಚಾಗಿ ಒಬ್ಬ ವ್ಯಕ್ತಿಯ ವ್ಯಕ್ತಿತ್ವ, ಅದೃಷ್ಟ ಮತ್ತು ಘಟನೆಗಳ ಸಮಯದ ಬಗ್ಗೆ ಹೆಚ್ಚು ನಿಖರವಾದ ತಿಳುವಳಿಕೆಯನ್ನು ನೀಡುತ್ತವೆ. 27 ನಕ್ಷತ್ರಗಳಿವೆ, ಪ್ರತಿಯೊಂದೂ ರಾಶಿಚಕ್ರದ 13 ಡಿಗ್ರಿ 20 ನಿಮಿಷಗಳನ್ನು ವ್ಯಾಪಿಸುತ್ತದೆ, ಮತ್ತು ಪ್ರತಿಯೊಂದೂ ನಿರ್ದಿಷ್ಟ ಗ್ರಹದಿಂದ ಆಳಲ್ಪಡುತ್ತದೆ ಮತ್ತು ಅನನ್ಯ ಗುಣಲಕ್ಷಣಗಳು ಮತ್ತು ದೇವತೆಗಳೊಂದಿಗೆ ಸಂಬಂಧ ಹೊಂದಿದೆ.",
        loading: "ನಕ್ಷತ್ರಗಳ ವಿವರಗಳನ್ನು ರಚಿಸಲಾಗುತ್ತಿದೆ...",
        back: "ಮನೆಗೆ ಹಿಂತಿರುಗಿ",
        error: "ನಕ್ಷತ್ರಗಳ ವಿವರಗಳನ್ನು ಲೋಡ್ ಮಾಡಲು ವಿಫಲವಾಗಿದೆ. ದಯವಿಟ್ಟು ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.",
      },
    };
    return translations[defaultLanguage]?.[key] || translations['en'][key];
  };

  useEffect(() => {
    const fetchNakshatras = async () => {
      setLoading(true);
      setError('');
      try {
        const prompt = `Provide general details about the 27 Nakshatras (Stars) in Vedic Astrology in ${defaultLanguage} language. Include their names and a very brief, one-sentence description for each, along with their ruling planet. Organize this as a list. Also, include an introductory paragraph and a concluding remark about their significance.`;

        const chatHistory = [{ role: "user", parts: [{ text: prompt }] }];
        const payload = { contents: chatHistory };
        const apiKey = "";
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;

        const response = await fetch(apiUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });

        const result = await response.json();
        if (result.candidates && result.candidates.length > 0 &&
            result.candidates[0].content && result.candidates[0].content.parts &&
            result.candidates[0].content.parts.length > 0) {
          const text = result.candidates[0].content.parts[0].text;
          setNakshatrasContent(text);
        } else {
          setError(getTranslation('error'));
        }
      } catch (err) {
        console.error("Error fetching Nakshatras content:", err);
        setError(getTranslation('error') + `: ${err.message}`);
      } finally {
        setLoading(false);
      }
    };
    fetchNakshatras();
  }, [defaultLanguage]);

  return (
    <div className="bg-purple-700 p-8 rounded-2xl shadow-xl max-w-3xl w-full border border-purple-600">
      <h2 className="text-3xl font-bold text-center mb-6 text-white">
        {getTranslation('title')}
      </h2>

      {loading && (
        <div className="flex items-center justify-center text-blue-300">
          <svg className="animate-spin h-5 w-5 mr-3 text-blue-300" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          {getTranslation('loading')}
        </div>
      )}
      {error && <p className="text-red-300 mt-4 text-center">{error}</p>}
      {nakshatrasContent && (
        <div className="bg-purple-600 p-6 rounded-lg text-white prose prose-invert max-w-none">
          <div dangerouslySetInnerHTML={{ __html: nakshatrasContent.replace(/\n/g, '<br>') }} />
        </div>
      )}

      <button
        onClick={() => setCurrentPage('home')}
        className="mt-8 w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-6 rounded-lg shadow-md transition duration-300 ease-in-out transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-opacity-75"
      >
        {getTranslation('back')}
      </button>
    </div>
  );
}

export default App;
