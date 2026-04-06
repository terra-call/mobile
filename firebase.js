import { initializeApp } from "firebase/app";
import { getAuth } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { getMessaging } from "firebase/messaging";

const firebaseConfig = {
  apiKey: "AIzaSyANK3sYmA-byOoltomu4CbJEicKELLDkAI",
  authDomain: "terra-call-9335b.firebaseapp.com",
  projectId: "terra-call-9335b",
  storageBucket: "terra-call-9335b.firebasestorage.app",
  messagingSenderId: "173877385922",
  appId: "1:173877385922:web:89f8d7ae52b6bda75b795b",
  measurementId: "G-X102GJ81WD"
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db = getFirestore(app);
export const messaging = getMessaging(app);

export default app;