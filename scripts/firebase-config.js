// ===============================================
// FIREBASE CONFIGURATION
// V.V.S Rotselaar
// Updated: Exports app instance for secondary app creation
// ===============================================

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js';
import { getFirestore } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

// Je Firebase configuratie
const firebaseConfig = {
    apiKey: "AIzaSyDS9uRPtr5W4r_A2i3HOM-xk47RTisCgwg",
    authDomain: "vvs-rotselaar-db.firebaseapp.com",
    projectId: "vvs-rotselaar-db",
    storageBucket: "vvs-rotselaar-db.firebasestorage.app",
    messagingSenderId: "155354748494",
    appId: "1:155354748494:web:8bc7a4a1da2efcdf57dd86"
};

// Initialize Firebase
export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

console.log('Firebase initialized');
