
// Injected global variable fallbacks at the top of the file
window.__app_id = window.__app_id || 'default-app-id';
window.__firebase_config = window.__firebase_config || '{}';
window.__initial_auth_token = window.__initial_auth_token || '';

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
  collection, // Import collection for reviews
  addDoc,     // Import addDoc for adding reviews
  query,      // Import query for querying reviews
  orderBy,    // Import orderBy for sorting reviews
} from 'firebase/firestore';
import { getFunctions, httpsCallable } from 'firebase/functions';


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
    // Initialize Firebase services
    const initializeFirebase = async () => {
      try {
        // Retrieve app ID and Firebase config from global variables provided by the environment
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

    initializeFirebase();
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
      } catch (error) {
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
  const [error, setError] = useState('');
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
        welcome: "ஜோதிட நுண்ணறிவுகளுக்கு வரவேற்கிறோம்",
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
        error: "ಸಂಗತಿಗಳನ್ನು ಲೋಡ್ ಮಾಡಲು ವಿಫಲವಾಗಿದೆ. ದಯatcplease ಮತ್ತೆ ಪ್ರಯತ್ನించండి.",
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
        error: "ವಿಷಯವನ್ನು ಲೋಡ್ ಮಾಡಲು ವಿಫಲವಾಗಿದೆ. ದಯವಿಟ್ಟು ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.",
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
        const prompt = `Write an essay in ${defaultLanguage} language explaining the perspective that astrology is far advanced than today's science. Focus on philosophical, historical, and conceptual arguments rather than scientific proof. Structure it with an introduction, a few paragraphs, and a conclusion.`;
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
        title: "வேத ஜோதிட ராசிகள் மற்றும் அவற்றின் முக்கியத்துவம்",
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
        intro: "ವೈದಿಕ ಜ್ಯೋತಿಷ್ಯದಲ್ಲಿ, 12 ರಾಶಿ ಚಿಹ್ನೆಗಳು, 9 ಗ್ರಹಗಳು (ನವಗ್ರಹಗಳು), 12 ಮನೆಗಳು ಮತ್ತು 27 ಚಂದ್ರ ನಕ್ಷತ್ರಪುಂಜಗಳು (ನಕ್ಷತ್ರಗಳು) ಇವೆ. ಇಲ್ಲಿ ಸರಳ ವಿಭಜನೆ ಇದೆ:",
        zodiacSignsTitle: "12 ರಾಶಿ ಚಿಹ್ನೆಗಳು (ರಾಶಿ):",
        mesha: "ಮೇಷ (Aries) – ಧೈರ್ಯಶಾಲಿ ಮತ್ತು ಶಕ್ತಿಶಾಲಿ",
        vrishabha: "ವೃಷಭ (Taurus) – ಸ್ಥಿರ ಮತ್ತು ನಿಷ್ಠಾವಂತ",
        mithuna: "ಮಿಥುನ (Gemini) – ಸಂವಹನಶೀಲ ಮತ್ತು ಕುತೂಹಲಕಾರಿ",
        karka: "ಕರ್ಕಾಟಕ (Cancer) – ಭಾವನಾತ್ಮಕ ಮತ್ತು ಪೋಷಿಸುವ",
        simha: "ಸಿಂಹ (Leo) – ಹೆಮ್ಮೆ ಮತ್ತು ಬಲಶಾಲಿ",
        kanya: "ಕನ್ಯಾ (Virgo) – ಪ್ರಾಯೋಗಿಕ ಮತ್ತು ಪರಿಪೂರ್ಣತಾವಾದಿ",
        tula: "ತುಲಾ (Libra) – ಸಮತೋಲಿತ ಮತ್ತು ಆಕರ್ಷಕ",
        vrischika: "ವೃಶ್ಚಿಕ (Scorpio) – ಆಳವಾದ ಮತ್ತು ಶಕ್ತಿಶಾಲಿ",
        dhanu: "ಧನು (Sagittarius) – ಸಾಹಸಮಯ ಮತ್ತು ಬುದ್ಧಿವಂತ",
        makara: "ಮಕರ (Capricorn) – ಶಿಸ್ತಿನ ಮತ್ತು ಕಷ್ಟಪಟ್ಟು ದುಡಿಯುವ",
        kumbha: "ಕುಂಭ (Aquarius) – ನವೀನ ಮತ್ತು ಸ್ವತಂತ್ರ",
        meena: "ಮೀನ (Pisces) – ಸಂವೇದನಾಶೀಲ ಮತ್ತು ಕಲಾತ್ಮಕ",
        zodiacConclusion: "ಪ್ರತಿ ರಾಶಿ ಚಿಹ್ನೆಯನ್ನು ಒಂದು ಗ್ರಹವು ಆಳುತ್ತದೆ ಮತ್ತು ಅದರದೇ ಆದ ಗುಣಗಳನ್ನು ಹೊಂದಿದೆ. ಜನ್ಮ ಸಮಯದಲ್ಲಿ ಈ ಚಿಹ್ನೆಗಳಲ್ಲಿ ಗ್ರಹಗಳ ಸ್ಥಾನವನ್ನು ಅಧ್ಯಯನ ಮಾಡುವ ಮೂಲಕ ಭವಿಷ್ಯವಾಣಿಗಳನ್ನು ಮಾಡಲಾಗುತ್ತದೆ.",
        navagrahasTitle: "ನವಗ್ರಹಗಳು – 9 ಗ್ರಹ ಪ್ರಭಾವಿಗಳು",
        navagrahasIntro: "ನವಗ್ರಹಗಳು:",
        sun: "ಸೂರ್ಯ (Surya)",
        moon: "ಚಂದ್ರ (Chandra)",
        mars: "ಮಂಗಳ (Mangal)",
        mercury: "ಬುಧ (Budh)",
        jupiter: "ಗುರು (Guru)",
        venus: "ಶುಕ್ರ (Shukra)",
        saturn: "ಶನಿ (Shani)",
        rahu: "ರಾಹು (ಚಂದ್ರನ ಉತ್ತರ ನೋಡ್)",
        ketu: "ಕೇತು (ಚಂದ್ರನ ದಕ್ಷಿಣ ನೋಡ್)",
        navagrahasConclusion: "ಈ ಗ್ರಹಗಳು ನಮ್ಮ ಜೀವನದ ವಿವಿಧ ಭಾಗಗಳನ್ನು ಪ್ರಭಾವಿಸುತ್ತವೆ – ಆರೋಗ್ಯ ಮತ್ತು ವೃತ್ತಿಯಿಂದ ಪ್ರೀತಿ ಮತ್ತು ಅದೃಷ್ಟದವರೆಗೆ. ಭವಿಷ್ಯವಾಣಿಗಳನ್ನು ನೀಡಲು ಜ್ಯೋತಿಷಿಗಳು ನಿಮ್ಮ ಜನ್ಮ ಚಾರ್ಟ್‌ನಲ್ಲಿ ಅವರ ಸ್ಥಾನಗಳನ್ನು ಪರಿಶೀಲಿಸುತ್ತಾರೆ.",
        back: "ಮನೆಗೆ ಹಿಂತಿರುಗಿ",
      },
    };
    return translations[defaultLanguage]?.[key] || translations['en'][key];
  };

  return (
    <div className="bg-purple-700 p-8 rounded-2xl shadow-xl max-w-3xl w-full border border-purple-600">
      <h2 className="text-3xl font-bold text-center mb-6 text-white">
        {getTranslation('title')}
      </h2>

      <div className="bg-purple-600 p-6 rounded-lg text-white prose prose-invert max-w-none">
        <p className="mb-4">{getTranslation('intro')}</p>

        <h3 className="text-2xl font-semibold text-white mb-3">
          {getTranslation('zodiacSignsTitle')}
        </h3>
        <ul className="list-disc list-inside space-y-2 mb-4">
          <li>{getTranslation('mesha')}</li>
          <li>{getTranslation('vrishabha')}</li>
          <li>{getTranslation('mithuna')}</li>
          <li>{getTranslation('karka')}</li>
          <li>{getTranslation('simha')}</li>
          <li>{getTranslation('kanya')}</li>
          <li>{getTranslation('tula')}</li>
          <li>{getTranslation('vrischika')}</li>
          <li>{getTranslation('dhanu')}</li>
          <li>{getTranslation('makara')}</li>
          <li>{getTranslation('kumbha')}</li>
          <li>{getTranslation('meena')}</li>
        </ul>
        <p className="mb-6">{getTranslation('zodiacConclusion')}</p>

        <h3 className="text-2xl font-semibold text-white mb-3">
          {getTranslation('navagrahasTitle')}
        </h3>
        <p className="mb-2">{getTranslation('navagrahasIntro')}</p>
        <ul className="list-disc list-inside space-y-2 mb-4">
          <li>{getTranslation('sun')}</li>
          <li>{getTranslation('moon')}</li>
          <li>{getTranslation('mars')}</li>
          <li>{getTranslation('mercury')}</li>
          <li>{getTranslation('jupiter')}</li>
          <li>{getTranslation('venus')}</li>
          <li>{getTranslation('saturn')}</li>
          <li>{getTranslation('rahu')}</li>
          <li>{getTranslation('ketu')}</li>
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

// NEW COMPONENT: Services Page
function ServicesPage() {
  const { setCurrentPage, defaultLanguage } = useContext(AuthContext);

  const getTranslation = (key) => {
    const translations = {
      en: {
        title: "Our Astrology Services",
        intro: "We offer personalized astrological guidance to help you navigate various aspects of your life. Our services include insights into:",
        life: "Life Path and General Well-being: Understand your true potential and life's purpose.",
        health: "Health and Vitality: Astrological insights into well-being and preventive measures.",
        wealth: "Wealth and Financial Prosperity: Guidance on career, investments, and financial growth.",
        education: "Education and Learning: Best academic paths and intellectual development.",
        marriage: "Marriage and Relationships: Compatibility, timing for significant relationships, and marital harmony.",
        partnerCharacter: "Character of Life Partner: Insights into the nature and compatibility of your prospective partner.",
        lifeBasement: "Foundational Life Aspects: Deep understanding of core life areas and their astrological influences.",
        business: "Business Ventures and Career: Identifying suitable business fields and career opportunities.",
        back: "Back to Home",
      },
      hi: {
        title: "हमारी ज्योतिष सेवाएँ",
        intro: "हम आपके जीवन के विभिन्न पहलुओं को नेविगेट करने में आपकी मदद करने के लिए व्यक्तिगत ज्योतिषीय मार्गदर्शन प्रदान करते हैं। हमारी सेवाओं में शामिल हैं:",
        life: "जीवन पथ और सामान्य कल्याण: अपनी वास्तविक क्षमता और जीवन के उद्देश्य को समझें।",
        health: "स्वास्थ्य और जीवन शक्ति: कल्याण और निवारक उपायों में ज्योतिषीय अंतर्दृष्टि।",
        wealth: "धन और वित्तीय समृद्धि: करियर, निवेश और वित्तीय विकास पर मार्गदर्शन।",
        education: "शिक्षा और सीखना: सर्वोत्तम शैक्षणिक मार्ग और बौद्धिक विकास।",
        marriage: "विवाह और रिश्ते: अनुकूलता, महत्वपूर्ण रिश्तों के लिए समय, और वैवाहिक सद्भाव।",
        partnerCharacter: "जीवनसाथी का चरित्र: आपके संभावित साथी के स्वभाव और अनुकूलता में अंतर्दृष्टि।",
        lifeBasement: "मौलिक जीवन पहलू: मुख्य जीवन क्षेत्रों और उनके ज्योतिषीय प्रभावों की गहरी समझ।",
        business: "व्यवसाय उद्यम और करियर: उपयुक्त व्यावसायिक क्षेत्रों और करियर के अवसरों की पहचान करना।",
        back: "होम पर वापस",
      },
      te: {
        title: "మా జ్యోతిష్య సేవలు",
        intro: "మీ జీవితంలోని వివిధ అంశాలను నావిగేట్ చేయడానికి మీకు సహాయపడటానికి మేము వ్యక్తిగతీకరించిన జ్యోతిష్య మార్గదర్శకత్వాన్ని అందిస్తాము. మా సేవలు వీటిపై అంతర్దృష్టులను కలిగి ఉంటాయి:",
        life: "జీవిత మార్గం మరియు సాధారణ శ్రేయస్సు: మీ నిజమైన సామర్థ్యాన్ని మరియు జీవిత లక్ష్యాన్ని అర్థం చేసుకోండి.",
        health: "ఆరోగ్యం మరియు జీవశక్తి: శ్రేయస్సు మరియు నివారణ చర్యలలో జ్యోతిష్య అంతర్దృష్టులు.",
        wealth: "సంపద మరియు ఆర్థిక శ్రేయస్సు: వృత్తి, పెట్టుబడులు మరియు ఆర్థిక వృద్ధిపై మార్గదర్శకత్వం.",
        education: "విద్య మరియు అభ్యాసం: ఉత్తమ విద్యా మార్గాలు మరియు మేధో అభివృద్ధి.",
        marriage: "వివాహం మరియు సంబంధాలు: అనుకూలత, ముఖ్యమైన సంబంధాలకు సమయం మరియు వైవాహిక సామరస్యం.",
        partnerCharacter: "జీవిత భాగస్వామి స్వభావం: మీ కాబోయే భాగస్వామి స్వభావం మరియు అనుకూలతపై అంతర్దృష్టులు.",
        lifeBasement: "ప్రాథమిక జీవిత అంశాలు: ప్రధాన జీవిత ప్రాంతాలు మరియు వాటి జ్యోతిష్య ప్రభావాలపై లోతైన అవగాహన.",
        business: "వ్యాపార వెంచర్లు మరియు వృత్తి: తగిన వ్యాపార రంగాలు మరియు వృత్తి అవకాశాలను గుర్తించడం.",
        back: "హోమ్‌కు తిరిగి వెళ్ళు",
      },
      ml: {
        title: "ഞങ്ങളുടെ ജ്യോതിഷ സേവനങ്ങൾ",
        intro: "നിങ്ങളുടെ ജീവിതത്തിന്റെ വിവിധ വശങ്ങളിൽ സഞ്ചരിക്കാൻ നിങ്ങളെ സഹായിക്കുന്നതിന് ഞങ്ങൾ വ്യക്തിഗത ജ്യോതിഷ മാർഗ്ഗനിർദ്ദേശം വാഗ്ദാനം ചെയ്യുന്നു. ഞങ്ങളുടെ സേവനങ്ങളിൽ ഉൾപ്പെടുന്നു:",
        life: "ജീവിത പാതയും പൊതുവായ ക്ഷേമവും: നിങ്ങളുടെ യഥാർത്ഥ സാധ്യതയും ജീവിത ലക്ഷ്യവും മനസ്സിലാക്കുക.",
        health: "ആരോഗ്യവും ഊർജ്ജസ്വലതയും: ക്ഷേമത്തെയും പ്രതിരോധ നടപടികളെയും കുറിച്ചുള്ള ജ്യോതിഷ ഉൾക്കാഴ്ചകൾ.",
        wealth: "സമ്പത്തും സാമ്പത്തിക അഭിവൃദ്ധിയും: തൊഴിൽ, നിക്ഷേപങ്ങൾ, സാമ്പത്തിക വളർച്ച എന്നിവയെക്കുറിച്ചുള്ള മാർഗ്ഗനിർദ്ദേശം.",
        education: "വിദ്യാഭ്യാസവും പഠനവും: മികച്ച അക്കാദമിക് പാതകളും ബൗദ്ധിക വികസനവും.",
        marriage: "വിവാഹവും ബന്ധങ്ങളും: അനുയോജ്യത, പ്രധാനപ്പെട്ട ബന്ധങ്ങൾക്കുള്ള സമയം, വൈവാഹിക ഐക്യം.",
        partnerCharacter: "ജീവിത പങ്കാളിയുടെ സ്വഭാവം: നിങ്ങളുടെ വരാനിരിക്കുന്ന പങ്കാളിയുടെ സ്വഭാവത്തെയും അനുയോജ്യതയെയും കുറിച്ചുള്ള ഉൾക്കാഴ്ചകൾ.",
        lifeBasement: "അടിസ്ഥാനപരമായ ജീവിത വശങ്ങൾ: പ്രധാന ജീവിത മേഖലകളെയും അവയുടെ ജ്യോതിഷ സ്വാധീനങ്ങളെയും കുറിച്ചുള്ള ആഴത്തിലുള്ള ധാരണ.",
        business: "ബിസിനസ്സ് സംരംഭങ്ങളും തൊഴിലും: അനുയോജ്യമായ ബിസിനസ്സ് മേഖലകളും തൊഴിൽ അവസരങ്ങളും തിരിച്ചറിയുന്നു.",
        back: "ഹോമിലേക്ക് തിരികെ",
      },
      ta: {
        title: "எங்கள் ஜோதிட சேவைகள்",
        intro: "உங்கள் வாழ்க்கையின் பல்வேறு அம்சங்களை வழிநடத்த உங்களுக்கு உதவ தனிப்பயனாக்கப்பட்ட ஜோதிட வழிகாட்டுதலை நாங்கள் வழங்குகிறோம். எங்கள் சேவைகளில் பின்வருவன பற்றிய நுண்ணறிவுகள் அடங்கும்:",
        life: "வாழ்க்கைப் பாதை மற்றும் பொது நல்வாழ்வு: உங்கள் உண்மையான திறனையும் வாழ்க்கையின் நோக்கத்தையும் புரிந்து கொள்ளுங்கள்.",
        health: "ஆரோக்கியம் மற்றும் உயிர்ச்சத்து: நல்வாழ்வு மற்றும் தடுப்பு நடவடிக்கைகள் பற்றிய ஜோதிட நுண்ணறிவுகள்.",
        wealth: "செல்வம் மற்றும் நிதி செழிப்பு: தொழில், முதலீடுகள் மற்றும் நிதி வளர்ச்சி பற்றிய வழிகாட்டுதல்.",
        education: "கல்வி மற்றும் கற்றல்: சிறந்த கல்விப் பாதைகள் மற்றும் அறிவுசார் வளர்ச்சி.",
        marriage: "திருமணம் மற்றும் உறவுகள்: இணக்கம், முக்கிய உறவுகளுக்கான நேரம் மற்றும் திருமண நல்லிணக்கம்.",
        partnerCharacter: "வாழ்க்கைத் துணையின் குணம்: உங்கள் வருங்கால துணையின் தன்மை மற்றும் இணக்கம் பற்றிய நுண்ணறிவுகள்.",
        lifeBasement: "அடிப்படை வாழ்க்கை அம்சங்கள்: முக்கிய வாழ்க்கை பகுதிகள் மற்றும் அவற்றின் ஜோதிட தாக்கங்கள் பற்றிய ஆழமான புரிதல்.",
        business: "வணிக முயற்சிகள் மற்றும் தொழில்: பொருத்தமான வணிகத் துறைகள் மற்றும் தொழில் வாய்ப்புகளை கண்டறிதல்.",
        back: "முகப்புக்கு திரும்பு",
      },
      kn: {
        title: "ನಮ್ಮ ಜ್ಯೋತಿಷ್ಯ ಸೇವೆಗಳು",
        intro: "ನಿಮ್ಮ ಜೀವನದ ವಿವಿಧ ಅಂಶಗಳನ್ನು ನ್ಯಾವಿಗೇಟ್ ಮಾಡಲು ನಿಮಗೆ ಸಹಾಯ ಮಾಡಲು ನಾವು ವೈಯಕ್ತಿಕಗೊಳಿಸಿದ ಜ್ಯೋತಿಷ್ಯ ಮಾರ್ಗದರ್ಶನವನ್ನು ನೀಡುತ್ತೇವೆ. ನಮ್ಮ ಸೇವೆಗಳು ಈ ಕೆಳಗಿನವುಗಳ ಬಗ್ಗೆ ಒಳನೋಟಗಳನ್ನು ಒಳಗೊಂಡಿವೆ:",
        life: "ಜೀವನ ಮಾರ್ಗ ಮತ್ತು ಸಾಮಾನ್ಯ ಯೋಗಕ್ಷೇಮ: ನಿಮ್ಮ ನಿಜವಾದ ಸಾಮರ್ಥ್ಯ ಮತ್ತು ಜೀವನದ ಉದ್ದೇಶವನ್ನು ಅರ್ಥಮಾಡಿಕೊಳ್ಳಿ.",
        health: "ಆರೋಗ್ಯ ಮತ್ತು ಚೈತನ್ಯ: ಯೋಗಕ್ಷೇಮ ಮತ್ತು ತಡೆಗಟ್ಟುವ ಕ್ರಮಗಳ ಬಗ್ಗೆ ಜ್ಯೋತಿಷ್ಯ ಒಳನೋಟಗಳು.",
        wealth: "ಸಂಪತ್ತು ಮತ್ತು ಆರ್ಥಿಕ ಸಮೃದ್ಧಿ: ವೃತ್ತಿ, ಹೂಡಿಕೆಗಳು ಮತ್ತು ಆರ್ಥಿಕ ಬೆಳವಣಿಗೆಯ ಕುರಿತು ಮಾರ್ಗದರ್ಶನ.",
        education: "ಶಿಕ್ಷಣ ಮತ್ತು ಕಲಿಕೆ: ಉತ್ತಮ ಶೈಕ್ಷಣಿಕ ಮಾರ್ಗಗಳು ಮತ್ತು ಬೌದ್ಧಿಕ ಅಭಿವೃದ್ಧಿ.",
        marriage: "ವಿವಾಹ ಮತ್ತು ಸಂಬಂಧಗಳು: ಹೊಂದಾಣಿಕೆ, ಪ್ರಮುಖ ಸಂಬಂಧಗಳಿಗೆ ಸಮಯ ಮತ್ತು ವೈವಾಹಿಕ ಸಾಮರಸ್ಯ.",
        partnerCharacter: "ಜೀವನ ಸಂಗಾತಿಯ ಗುಣ: ನಿಮ್ಮ ನಿರೀಕ್ಷಿತ ಸಂಗಾತಿಯ ಸ್ವಭಾವ ಮತ್ತು ಹೊಂದಾಣಿಕೆಯ ಬಗ್ಗೆ ಒಳನೋಟಗಳು.",
        lifeBasement: "ಮೂಲಭೂತ ಜೀವನ ಅಂಶಗಳು: ಪ್ರಮುಖ ಜೀವನ ಕ್ಷೇತ್ರಗಳು ಮತ್ತು ಅವುಗಳ ಜ್ಯೋತಿಷ್ಯ ಪ್ರಭಾವಗಳ ಬಗ್ಗೆ ಆಳವಾದ ತಿಳುವಳಿಕೆ.",
        business: "ವ್ಯಾಪಾರ ಉದ್ಯಮಗಳು ಮತ್ತು ವೃತ್ತಿ: ಸೂಕ್ತವಾದ ವ್ಯಾಪಾರ ಕ್ಷೇತ್ರಗಳು ಮತ್ತು ವೃತ್ತಿ ಅವಕಾಶಗಳನ್ನು ಗುರುತಿಸುವುದು.",
        back: "ಮನೆಗೆ ಹಿಂತಿರುಗಿ",
      },
    };
    return translations[defaultLanguage]?.[key] || translations['en'][key];
  };

  return (
    <div className="bg-purple-700 p-8 rounded-2xl shadow-xl max-w-3xl w-full border border-purple-600">
      <h2 className="text-3xl font-bold text-center mb-6 text-white">
        {getTranslation('title')}
      </h2>

      <div className="bg-purple-600 p-6 rounded-lg text-white prose prose-invert max-w-none">
        <p className="mb-4">{getTranslation('intro')}</p>
        <ul className="list-disc list-inside space-y-2">
          <li><strong>{getTranslation('life')}</strong></li>
          <li><strong>{getTranslation('health')}</strong></li>
          <li><strong>{getTranslation('wealth')}</strong></li>
          <li><strong>{getTranslation('education')}</strong></li>
          <li><strong>{getTranslation('marriage')}</strong></li>
          <li><strong>{getTranslation('partnerCharacter')}</strong></li>
          <li><strong>{getTranslation('lifeBasement')}</strong></li>
          <li><strong>{getTranslation('business')}</strong></li>
        </ul>
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

// NEW COMPONENT: Reviews and Ratings Page
function ReviewsRatingsPage() {
  const { db, userId, user, setCurrentPage, defaultLanguage } = useContext(AuthContext);
  const [reviews, setReviews] = useState([]);
  const [newReview, setNewReview] = useState('');
  const [newRating, setNewRating] = useState(0);
  const [submitMessage, setSubmitMessage] = useState('');
  const [loadingReviews, setLoadingReviews] = useState(true);
  const [submittingReview, setSubmittingReview] = useState(false);

  // Localization function for dynamic text
  const getTranslation = (key) => {
    const translations = {
      en: {
        title: "Customer Reviews & Ratings",
        leaveReview: "Leave a Review",
        yourRating: "Your Rating:",
        yourReview: "Your Review:",
        submitReview: "Submit Review",
        noReviews: "No reviews yet. Be the first to share your experience!",
        submitSuccess: "Review submitted successfully!",
        submitError: "Failed to submit review:",
        loading: "Loading reviews...",
        fetchingError: "Failed to load reviews. Please try again.",
        loggedInAs: "Logged in as:",
        back: "Back to Home",
        ratingInvalid: "Please select a rating (1-5 stars).",
        reviewEmpty: "Please enter your review.",
      },
      hi: {
        title: "ग्राहक समीक्षाएँ और रेटिंग",
        leaveReview: "एक समीक्षा छोड़ें",
        yourRating: "आपकी रेटिंग:",
        yourReview: "आपकी समीक्षा:",
        submitReview: "समीक्षा जमा करें",
        noReviews: "अभी तक कोई समीक्षा नहीं। अपना अनुभव साझा करने वाले पहले व्यक्ति बनें!",
        submitSuccess: "समीक्षा सफलतापूर्वक जमा की गई!",
        submitError: "समीक्षा जमा करने में विफल:",
        loading: "समीक्षाएं लोड हो रही हैं...",
        fetchingError: "समीक्षाएं लोड करने में विफल। कृपया पुन: प्रयास करें।",
        loggedInAs: "के रूप में लॉग इन है:",
        back: "होम पर वापस",
        ratingInvalid: "कृपया एक रेटिंग (1-5 सितारे) चुनें।",
        reviewEmpty: "कृपया अपनी समीक्षा दर्ज करें।",
      },
      te: {
        title: "కస్టమర్ సమీక్షలు & రేటింగ్‌లు",
        leaveReview: "ఒక సమీక్షను వ్రాయండి",
        yourRating: "మీ రేటింగ్:",
        yourReview: "మీ సమీక్ష:",
        submitReview: "సమీక్షను సమర్పించండి",
        noReviews: "ఇంకా సమీక్షలు లేవు. మీ అనుభవాన్ని పంచుకున్న మొదటి వ్యక్తి మీరే!",
        submitSuccess: "సమీక్ష విజయవంతంగా సమర్పించబడింది!",
        submitError: "సమీక్షను సమర్పించడంలో విఫలమైంది:",
        loading: "సమీక్షలు లోడ్ అవుతున్నాయి...",
        fetchingError: "సమీక్షలను లోడ్ చేయడంలో విఫలమైంది. దయచేసి మళ్ళీ ప్రయత్నించండి.",
        loggedInAs: "లాగిన్ అయినట్లు:",
        back: "హోమ్‌కు తిరిగి వెళ్ళు",
        ratingInvalid: "దయచేసి రేటింగ్‌ను (1-5 నక్షత్రాలు) ఎంచుకోండి.",
        reviewEmpty: "దయచేసి మీ సమీక్షను నమోదు చేయండి.",
      },
      ml: {
        title: "ഉപഭോക്തൃ അവലോകനങ്ങളും റേറ്റിംഗുകളും",
        leaveReview: "ഒരു അവലോകനം രേഖപ്പെടുത്തുക",
        yourRating: "നിങ്ങളുടെ റേറ്റിംഗ്:",
        yourReview: "നിങ്ങളുടെ അവലോകനം:",
        submitReview: "അവലോകനം സമർപ്പിക്കുക",
        noReviews: "ഇതുവരെ അവലോകനങ്ങൾ ഇല്ല. നിങ്ങളുടെ അനുഭവം പങ്കിടുന്ന ആദ്യത്തെ ആളാകൂ!",
        submitSuccess: "അവലോകനം വിജയകരമായി സമർപ്പിച്ചു!",
        submitError: "അവലോകനം സമർപ്പിക്കുന്നതിൽ പരാജയപ്പെട്ടു:",
        loading: "അവലോകനങ്ങൾ ലോഡ് ചെയ്യുന്നു...",
        fetchingError: "അവലോകനങ്ങൾ ലോഡ് ചെയ്യുന്നതിൽ പരാജയപ്പെട്ടു. ദയവായി വീണ്ടും ശ്രമിക്കുക.",
        loggedInAs: "ലോഗിൻ ചെയ്തത്:",
        back: "ഹോമിലേക്ക് തിരികെ",
        ratingInvalid: "ദയവായി ഒരു റേറ്റിംഗ് (1-5 നക്ഷത്രങ്ങൾ) തിരഞ്ഞെടുക്കുക.",
        reviewEmpty: "ദയവായി നിങ്ങളുടെ അവലോകനം നൽകുക.",
      },
      ta: {
        title: "வாடிக்கையாளர் மதிப்புரைகள் மற்றும் மதிப்பீடுகள்",
        leaveReview: "ஒரு மதிப்பாய்வை எழுதுங்கள்",
        yourRating: "உங்கள் மதிப்பீடு:",
        yourReview: "உங்கள் மதிப்பாய்வு:",
        submitReview: "மதிப்பாய்வைச் சமர்ப்பி",
        noReviews: "இன்னும் மதிப்புரைகள் இல்லை. உங்கள் அனுபவத்தைப் பகிர்ந்து கொள்ளும் முதல் நபராக இருங்கள்!",
        submitSuccess: "மதிப்பாய்வு வெற்றிகரமாக சமர்ப்பிக்கப்பட்டது!",
        submitError: "மதிப்பாய்வைச் சமர்ப்பிக்க முடியவில்லை:",
        loading: "மதிப்புரைகளை ஏற்றுகிறது...",
        fetchingError: "மதிப்புரைகளை ஏற்ற முடியவில்லை. மீண்டும் முயற்சிக்கவும்.",
        loggedInAs: "உள்நுழைந்துள்ளது:",
        back: "முகப்புக்கு திரும்பு",
        ratingInvalid: "தயவுசெய்து ஒரு மதிப்பீட்டை (1-5 நட்சத்திரங்கள்) தேர்ந்தெடுக்கவும்.",
        reviewEmpty: "தயவுசெய்து உங்கள் மதிப்பாய்வை உள்ளிடவும்.",
      },
      kn: {
        title: "ಗ್ರಾಹಕ ವಿಮರ್ಶೆಗಳು ಮತ್ತು ರೇಟಿಂಗ್‌ಗಳು",
        leaveReview: "ವಿಮರ್ಶೆ ಬರೆಯಿರಿ",
        yourRating: "ನಿಮ್ಮ ರೇಟಿಂಗ್:",
        yourReview: "ನಿಮ್ಮ ವಿಮರ್ಶೆ:",
        submitReview: "ವಿಮರ್ಶೆಯನ್ನು ಸಲ್ಲಿಸಿ",
        noReviews: "ಇನ್ನೂ ಯಾವುದೇ ವಿಮರ್ಶೆಗಳಿಲ್ಲ. ನಿಮ್ಮ ಅನುಭವವನ್ನು ಹಂಚಿಕೊಳ್ಳಲು ಮೊದಲಿಗರಾಗಿ!",
        submitSuccess: "ವಿಮರ್ಶೆಯನ್ನು ಯಶಸ್ವಿಯಾಗಿ ಸಲ್ಲಿಸಲಾಗಿದೆ!",
        submitError: "ವಿಮರ್ಶೆಯನ್ನು ಸಲ್ಲಿಸಲು ವಿಫಲವಾಗಿದೆ:",
        loading: "ವಿಮರ್ಶೆಗಳನ್ನು ಲೋಡ್ ಮಾಡಲಾಗುತ್ತಿದೆ...",
        fetchingError: "ವಿಮರ್ಶೆಗಳನ್ನು ಲೋಡ್ ಮಾಡಲು ವಿಫಲವಾಗಿದೆ. ದಯವಿಟ್ಟು ಮತ್ತೆ ಪ್ರಯತ್ನಿಸಿ.",
        loggedInAs: "ಲಾಗ್ ಇನ್ ಮಾಡಲಾಗಿದೆ:",
        back: "ಮನೆಗೆ ಹಿಂತಿರುಗಿ",
        ratingInvalid: "ದಯವಿಟ್ಟು ರೇಟಿಂಗ್ (1-5 ನಕ್ಷತ್ರಗಳು) ಆಯ್ಕೆಮಾಡಿ.",
        reviewEmpty: "ದಯವಿಟ್ಟು ನಿಮ್ಮ ವಿಮರ್ಶೆಯನ್ನು ನಮೂದಿಸಿ.",
      },
    };
    return translations[defaultLanguage]?.[key] || translations['en'][key];
  };

  // Fetch reviews from Firestore on component mount
  useEffect(() => {
    const fetchReviews = async () => {
      if (!db) return; // Ensure db is initialized
      setLoadingReviews(true);
      setError('');
      try {
        const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
        // Query reviews collection, ordered by timestamp descending
        const q = query(collection(db, `artifacts/${appId}/public/reviews`), orderBy('timestamp', 'desc'));

        const unsubscribe = onSnapshot(q, (snapshot) => {
          const fetchedReviews = [];
          snapshot.forEach((doc) => {
            fetchedReviews.push({ id: doc.id, ...doc.data() });
          });
          setReviews(fetchedReviews);
          setLoadingReviews(false);
        }, (error) => {
          console.error("Error fetching reviews:", error);
          setError(getTranslation('fetchingError'));
          setLoadingReviews(false);
        });

        return () => unsubscribe(); // Clean up the listener
      } catch (err) {
        console.error("Error setting up review listener:", err);
        setError(getTranslation('fetchingError'));
        setLoadingReviews(false);
      }
    };

    if (db) { // Only fetch if db is initialized
      fetchReviews();
    }
  }, [db, defaultLanguage]); // Re-fetch when db or language changes

  // Handle review submission
  const handleSubmitReview = async (e) => {
    e.preventDefault();
    if (!db || !userId || !user) {
      setSubmitMessage(getTranslation('loggedInAs') + ' ' + user?.email || 'Not logged in!');
      setTimeout(() => setSubmitMessage(''), 3000);
      return;
    }
    if (newRating < 1 || newRating > 5) {
      setSubmitMessage(getTranslation('ratingInvalid'));
      setTimeout(() => setSubmitMessage(''), 3000);
      return;
    }
    if (!newReview.trim()) {
      setSubmitMessage(getTranslation('reviewEmpty'));
      setTimeout(() => setSubmitMessage(''), 3000);
      return;
    }

    setSubmittingReview(true);
    setSubmitMessage('');

    try {
      const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
      const reviewsCollectionRef = collection(db, `artifacts/${appId}/public/reviews`);
      await addDoc(reviewsCollectionRef, {
        userId: userId,
        userName: user.email || 'Anonymous', // Use email or anonymous if not available
        rating: newRating,
        comment: newReview.trim(),
        timestamp: new Date(), // Store server timestamp
      });
      setNewReview('');
      setNewRating(0);
      setSubmitMessage(getTranslation('submitSuccess'));
    } catch (error) {
      console.error("Error submitting review:", error);
      setSubmitMessage(`${getTranslation('submitError')} ${error.message}`);
    } finally {
      setSubmittingReview(false);
      setTimeout(() => setSubmitMessage(''), 3000);
    }
  };

  return (
    <div className="bg-purple-700 p-8 rounded-2xl shadow-xl max-w-3xl w-full border border-purple-600">
      <h2 className="text-3xl font-bold text-center mb-6 text-white">
        {getTranslation('title')}
      </h2>

      {/* Review Submission Form */}
      <form onSubmit={handleSubmitReview} className="space-y-4 mb-8 p-6 bg-purple-600 rounded-lg shadow-inner">
        <h3 className="text-xl font-semibold text-white mb-4">{getTranslation('leaveReview')}</h3>
        <div>
          <label className="block text-white text-sm font-semibold mb-2">{getTranslation('yourRating')}</label>
          <div className="flex items-center space-x-1">
            {[1, 2, 3, 4, 5].map((star) => (
              <svg
                key={star}
                className={`w-6 h-6 cursor-pointer transition duration-150 ease-in-out ${
                  newRating >= star ? 'text-yellow-400' : 'text-gray-400'
                }`}
                fill="currentColor"
                viewBox="0 0 20 20"
                onClick={() => setNewRating(star)}
              >
                <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.683-1.539 1.118l-2.8-2.034a1 1 0 00-1.176 0l-2.8 2.034c-.784.565-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.462a1 1 0 00.95-.69l1.07-3.292z" />
              </svg>
            ))}
          </div>
        </div>
        <div>
          <label className="block text-white text-sm font-semibold mb-2" htmlFor="reviewComment">
            {getTranslation('yourReview')}
          </label>
          <textarea
            id="reviewComment"
            value={newReview}
            onChange={(e) => setNewReview(e.target.value)}
            className="w-full p-3 rounded-lg bg-purple-500 text-white border border-purple-400 focus:outline-none focus:ring-2 focus:ring-purple-300 focus:border-transparent min-h-[100px]"
            placeholder="Share your experience here..."
            required
          ></textarea>
        </div>
        {submitMessage && (
          <p className={`text-sm mt-2 ${submitMessage.includes('successfully') ? 'text-green-300' : 'text-red-300'}`}>
            {submitMessage}
          </p>
        )}
        <button
          type="submit"
          disabled={submittingReview}
          className="w-full bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-6 rounded-lg shadow-md transition duration-300 ease-in-out transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-opacity-75 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {submittingReview ? 'Submitting...' : getTranslation('submitReview')}
        </button>
      </form>

      {/* Display Existing Reviews */}
      <div className="mt-8">
        <h3 className="text-2xl font-bold text-white mb-4">Customer Reviews</h3>
        {loadingReviews ? (
          <div className="flex items-center justify-center text-blue-300">
            <svg className="animate-spin h-5 w-5 mr-3 text-blue-300" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            {getTranslation('loading')}
          </div>
        ) : error ? (
          <p className="text-red-300 text-center">{error}</p>
        ) : reviews.length === 0 ? (
          <p className="text-gray-300 text-center">{getTranslation('noReviews')}</p>
        ) : (
          <div className="space-y-6">
            {reviews.map((review) => (
              <div key={review.id} className="bg-purple-600 p-6 rounded-lg shadow-md border border-purple-500">
                <div className="flex items-center mb-2">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <svg
                      key={star}
                      className={`w-5 h-5 ${
                        review.rating >= star ? 'text-yellow-400' : 'text-gray-400'
                      }`}
                      fill="currentColor"
                      viewBox="0 0 20 20"
                    >
                      <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.683-1.539 1.118l-2.8-2.034a1 1 0 00-1.176 0l-2.8 2.034c-.784.565-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.462a1 1 0 00.95-.69l1.07-3.292z" />
                    </svg>
                  ))}
                </div>
                <p className="text-gray-200 text-base mb-2">{review.comment}</p>
                <p className="text-gray-400 text-sm">
                  - {review.userName} on{' '}
                  {new Date(review.timestamp?.toDate ? review.timestamp.toDate() : review.timestamp).toLocaleDateString()}
                </p>
              </div>
            ))}
          </div>
        )}
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

// NEW COMPONENT: Nakshatras Page - General Details about 27 Stars and their Rulers
function NakshatrasPage() {
  const { setCurrentPage, defaultLanguage } = useContext(AuthContext);

  // Data for Nakshatras (as provided in the image)
  const nakshatrasData = [
    { name: "Ashwini", ruler: "Ketu", deity: "Ashwina Kumar", symbol: "Horse's head" },
    { name: "Bharni", ruler: "Shukra", deity: "Lord Yama", symbol: "Yoni" },
    { name: "Kritika", ruler: "Surya", deity: "Agni", symbol: "Knife" },
    { name: "Rohini", ruler: "Chandra", deity: "Brahma", symbol: "Cart, Temple, Banyana Tree" },
    { name: "Mrigshira", ruler: "Mangal", deity: "Soma", symbol: "Deer's head" },
    { name: "Ardara", ruler: "Rahu", deity: "Rudra", symbol: "Teardrop, Diamond, a Human head" },
    { name: "Punarvasu", ruler: "Guru", deity: "Aditi", symbol: "Bow and quiver" },
    { name: "Pushya", ruler: "Shani", deity: "Brihaspati", symbol: "Cow's udder, lotus, arrow and circle" },
    { name: "Ashlesha", ruler: "Budh", deity: "Sarpa or Nagas", symbol: "Serpent" },
    { name: "Magha", ruler: "Ketu", deity: "Pitra or Forefathers", symbol: "Royal throne" },
    { name: "Poorva Phalguni", ruler: "Shukra", deity: "Aryaman", symbol: "Front leg of the bed, hammock, fig tree" },
    { name: "Uttara Phalguni", ruler: "Surya", deity: "Bhaga", symbol: "four legs of the bed, hammock" },
    { name: "Hasta", ruler: "Chandra", deity: "Saviti or Surya", symbol: "Hand or fist" },
    { name: "Chitra", ruler: "Mangal", deity: "Tvastar or Vishwakarma", symbol: "Bright jewel or pearl" },
    { name: "Swati", ruler: "Rahu", deity: "Vayu", symbol: "Shoot of plant, coral" },
    { name: "Vishakha", ruler: "Guru", deity: "Indra and Agni", symbol: "Triumphal arch, potter's wheel" },
    { name: "Anuradha", ruler: "Shani", deity: "Mitra", symbol: "Triumphal arch, lotus" },
    { name: "Jyeshtha", ruler: "Budh", deity: "Indra", symbol: "Circular amulet, umbrella, and earrings" },
    { name: "Moola", ruler: "Ketu", deity: "Nirti", symbol: "Bunch of roots tied together, elephant goad" },
    { name: "Poorva-Shada", ruler: "Shukra", deity: "Apah", symbol: "Elephant tusk, fan, winnowing basket" },
    { name: "Uttara-Shada", ruler: "Surya", deity: "Vishvedevas", symbol: "Elephant tusk" },
    { name: "Shravana", ruler: "Chandra", deity: "Vishnu", symbol: "Ears or three footprints" },
    { name: "Dhanishtha", ruler: "Mangal", deity: "Eight Vasus", symbol: "Drum or flute" },
    { name: "Shatbhisha", ruler: "Rahu", deity: "Varuna", symbol: "Empty circle, flowers or stars" },
    { name: "Poorva Bhadrapada", ruler: "Guru", deity: "Ajikapada", symbol: "Swords, or two front legs of cot, a man with two faes" },
    { name: "Uttara Bhadrapada", ruler: "Shani", deity: "Ahir Budhyana", symbol: "Twins, back legs of cot, snake in the water" },
    { name: "Revati", ruler: "Budh", deity: "Pushan", symbol: "Pair of fish, drum" },
  ];

  const getTranslation = (key) => {
    const translations = {
      en: {
        title: "General Details About 27 Nakshatras (Stars)",
        intro: "In Vedic astrology, Nakshatras (lunar mansions) are specific segments of the ecliptic through which the Moon passes. Each Nakshatra has a unique influence, a ruling planet, a presiding deity, and symbolic representation. Understanding them provides deeper insights into one's personality and destiny.",
        tableHeaderName: "Nakshatra (Star)",
        tableHeaderRuler: "Ruling Planet",
        tableHeaderDeity: "Presiding Deity",
        tableHeaderSymbol: "Symbol",
        back: "Back to Home",
      },
      hi: {
        title: "27 नक्षत्रों (सितारों) के बारे में सामान्य विवरण",
        intro: "वैदिक ज्योतिष में, नक्षत्र (चंद्र महल) क्रांतिवृत्त के विशिष्ट खंड होते हैं जिनसे होकर चंद्रमा गुजरता है। प्रत्येक नक्षत्र का एक अद्वितीय प्रभाव, एक शासक ग्रह, एक अधिष्ठाता देवता और प्रतीकात्मक प्रतिनिधित्व होता है। उन्हें समझना किसी के व्यक्तित्व और भाग्य में गहरी अंतर्दृष्टि प्रदान करता है।",
        tableHeaderName: "नक्षत्र (तारा)",
        tableHeaderRuler: "शासक ग्रह",
        tableHeaderDeity: "अधिष्ठाता देवता",
        tableHeaderSymbol: "प्रतीक",
        back: "होम पर वापस",
      },
      te: {
        title: "27 నక్షత్రాల (నక్షత్రాలు) గురించి సాధారణ వివరాలు",
        intro: "వేద జ్యోతిష్యశాస్త్రంలో, నక్షత్రాలు (చంద్ర గృహాలు) చంద్రుడు ప్రయాణించే గ్రహణ మార్గం యొక్క నిర్దిష్ట విభాగాలు. ప్రతి నక్షత్రానికి ఒక ప్రత్యేక ప్రభావం, ఒక పాలకుడు గ్రహం, ఒక అధిష్టాన దేవత మరియు ప్రతీకాత్మక ప్రాతినిధ్యం ఉంటుంది. వాటిని అర్థం చేసుకోవడం ఒకరి వ్యక్తిత్వం మరియు విధిపై లోతైన అంతర్దృష్టులను అందిస్తుంది.",
        tableHeaderName: "నక్షత్రం (నక్షత్రం)",
        tableHeaderRuler: "పాలక గ్రహం",
        tableHeaderDeity: "అధిష్టాన దేవత",
        tableHeaderSymbol: "చిహ్నం",
        back: "హోమ్‌కు తిరిగి వెళ్ళు",
      },
      ml: {
        title: "27 നക്ഷത്രങ്ങളെക്കുറിച്ചുള്ള പൊതുവായ വിവരങ്ങൾ",
        intro: "വേദ ജ്യോതിഷത്തിൽ, നക്ഷത്രങ്ങൾ (ചാന്ദ്ര ഭവനങ്ങൾ) ചന്ദ്രൻ കടന്നുപോകുന്ന ക്രാന്തിവൃത്തത്തിന്റെ നിർദ്ദിഷ്ട ഭാഗങ്ങളാണ്. ഓരോ നക്ഷത്രത്തിനും അതിൻ്റേതായ സ്വാധീനം, ഒരു ഭരണ ഗ്രഹം, ഒരു അധിഷ്ഠിത ദേവൻ, പ്രതീകാത്മക പ്രാതിനിധ്യം എന്നിവയുണ്ട്. അവ മനസ്സിലാക്കുന്നത് ഒരാളുടെ വ്യക്തിത്വത്തെയും വിധിയെയും കുറിച്ച് ആഴത്തിലുള്ള ഉൾക്കാഴ്ചകൾ നൽകുന്നു.",
        tableHeaderName: "നക്ഷത്രം (നക്ഷത്രം)",
        tableHeaderRuler: "ഭരണ ഗ്രഹം",
        tableHeaderDeity: "അധിഷ്ഠിത ദേവൻ",
        tableHeaderSymbol: "പ്രതീകം",
        back: "ഹോമിലേക്ക് തിരികെ",
      },
      ta: {
        title: "27 நட்சத்திரங்கள் பற்றிய பொதுவான விவரங்கள்",
        intro: "வேத ஜோதிடத்தில், நட்சத்திரங்கள் (சந்திர வீடுகள்) என்பது சந்திரன் கடந்து செல்லும் இரைச்சல் வட்டத்தின் குறிப்பிட்ட பிரிவுகளாகும். ஒவ்வொரு நட்சத்திரத்திற்கும் ஒரு தனிப்பட்ட செல்வாக்கு, ஒரு ஆளும் கிரகம், ஒரு presiding தெய்வம் மற்றும் குறியீட்டு பிரதிநிதித்துவம் உள்ளது. அவற்றைப் புரிந்துகொள்வது ஒருவரின் ஆளுமை மற்றும் விதி பற்றிய ஆழமான நுண்ணறிவுகளை வழங்குகிறது.",
        tableHeaderName: "நட்சத்திரம்",
        tableHeaderRuler: "ஆளும் கிரகம்",
        tableHeaderDeity: "அதிபதி தெய்வம்",
        tableHeaderSymbol: "சின்னம்",
        back: "முகப்புக்கு திரும்பு",
      },
      kn: {
        title: "27 ನಕ್ಷತ್ರಗಳ ಬಗ್ಗೆ ಸಾಮಾನ್ಯ ವಿವರಗಳು",
        intro: "ವೈದಿಕ ಜ್ಯೋತಿಷ್ಯದಲ್ಲಿ, ನಕ್ಷತ್ರಗಳು (ಚಂದ್ರನ ನಿವಾಸಗಳು) ಚಂದ್ರನು ಹಾದುಹೋಗುವ ಗ್ರಹಣ ವೃತ್ತದ ನಿರ್ದಿಷ್ಟ ವಿಭಾಗಗಳಾಗಿವೆ. ಪ್ರತಿಯೊಂದು ನಕ್ಷತ್ರವು ವಿಶಿಷ್ಟ ಪ್ರಭಾವ, ಆಡಳಿತ ಗ್ರಹ, ಅಧಿದೇವತೆ ಮತ್ತು ಸಾಂಕೇತಿಕ ಪ್ರಾತಿನಿಧ್ಯವನ್ನು ಹೊಂದಿದೆ. ಅವುಗಳನ್ನು ಅರ್ಥಮಾಡಿಕೊಳ್ಳುವುದು ಒಬ್ಬರ ವ್ಯಕ್ತಿತ್ವ ಮತ್ತು ಅದೃಷ್ಟದ ಬಗ್ಗೆ ಆಳವಾದ ಒಳನೋಟಗಳನ್ನು ನೀಡುತ್ತದೆ.",
        tableHeaderName: "ನಕ್ಷತ್ರ",
        tableHeaderRuler: "ಆಡಳಿತ ಗ್ರಹ",
        tableHeaderDeity: "ಅಧಿದೇವತೆ",
        tableHeaderSymbol: "ಚಿಹ್ನೆ",
        back: "ಮನೆಗೆ ಹಿಂತಿರುಗಿ",
      },
    };
    return translations[defaultLanguage]?.[key] || translations['en'][key];
  };

  return (
    <div className="bg-purple-700 p-8 rounded-2xl shadow-xl max-w-4xl w-full border border-purple-600">
      <h2 className="text-3xl font-bold text-center mb-6 text-white">
        {getTranslation('title')}
      </h2>

      <div className="bg-purple-600 p-6 rounded-lg text-white prose prose-invert max-w-none">
        <p className="mb-6">{getTranslation('intro')}</p>

        <div className="overflow-x-auto"> {/* Added for horizontal scrolling on small screens */}
          <table className="min-w-full divide-y divide-purple-500">
            <thead className="bg-purple-700">
              <tr>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider rounded-tl-lg">
                  {getTranslation('tableHeaderName')}
                </th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
                  {getTranslation('tableHeaderRuler')}
                </th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider">
                  {getTranslation('tableHeaderDeity')}
                </th>
                <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-300 uppercase tracking-wider rounded-tr-lg">
                  {getTranslation('tableHeaderSymbol')}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-purple-500">
              {nakshatrasData.map((nakshatra, index) => (
                <tr key={index} className={index % 2 === 0 ? 'bg-purple-600' : 'bg-purple-650'}>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-white">
                    {nakshatra.name}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-200">
                    {nakshatra.ruler}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-200">
                    {nakshatra.deity}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-200">
                    {nakshatra.symbol}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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


export default App;
