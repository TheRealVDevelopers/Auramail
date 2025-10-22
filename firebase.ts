// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyDD9dNhjLH7xuft8nz2g9Vb2VNhKNHyTHQ",
  authDomain: "vox-mail-2a17c.firebaseapp.com",
  projectId: "vox-mail-2a17c",
  storageBucket: "vox-mail-2a17c.firebasestorage.app",
  messagingSenderId: "94269632207",
  appId: "1:94269632207:web:1ec81ab5b8c12f4c5411ba",
  measurementId: "G-8F32NW8L3N"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

try {
  const analytics = getAnalytics(app);
} catch (e) {
  console.error("Firebase Analytics not supported in this environment.", e);
}


export const auth = getAuth(app);
export const db = getFirestore(app);