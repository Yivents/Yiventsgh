// Firebase client SDK loaded directly from the CDN. No npm install, no build.
import { initializeApp } from 'https://www.gstatic.com/firebasejs/11.6.0/firebase-app.js';
import {
  getAuth, createUserWithEmailAndPassword, signInWithEmailAndPassword,
  signOut, sendPasswordResetEmail, updateProfile, onAuthStateChanged,
  signInAnonymously,
} from 'https://www.gstatic.com/firebasejs/11.6.0/firebase-auth.js';
import {
  getFirestore, doc, getDoc, getDocs, setDoc, addDoc, updateDoc, deleteDoc,
  collection, query, where, orderBy, limit, writeBatch, serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/11.6.0/firebase-firestore.js';
import {
  getStorage, ref, uploadBytes, getDownloadURL,
} from 'https://www.gstatic.com/firebasejs/11.6.0/firebase-storage.js';
import { firebaseConfig } from './config.js';

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const storage = getStorage(app);

export {
  createUserWithEmailAndPassword, signInWithEmailAndPassword, signOut,
  sendPasswordResetEmail, updateProfile, onAuthStateChanged, signInAnonymously,
  doc, getDoc, getDocs, setDoc, addDoc, updateDoc, deleteDoc,
  collection, query, where, orderBy, limit, writeBatch, serverTimestamp,
  ref, uploadBytes, getDownloadURL,
};
