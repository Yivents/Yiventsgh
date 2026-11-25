/** Lazy Admin SDK getters (safe under emulators and during module import). */
import { getApp, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getAuth, type Auth } from 'firebase-admin/auth';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';

const projectId = process.env.FUNCTIONS_PROJECT_ID ?? process.env.GCLOUD_PROJECT ?? 'yivents-demo';
const bucketName = process.env.STORAGE_BUCKET ?? `${projectId}.appspot.com`;

export function adminApp(): App {
  if (getApps().length) return getApp();
  return initializeApp({ projectId, storageBucket: bucketName });
}

let firestoreConfigured = false;

export function firestore(): Firestore {
  const db = getFirestore(adminApp());
  if (!firestoreConfigured) {
    // Optional fields are common in submissions; omit them instead of throwing.
    db.settings({ ignoreUndefinedProperties: true });
    firestoreConfigured = true;
  }
  return db;
}

export function auth(): Auth {
  return getAuth(adminApp());
}

export function bucket() {
  return getStorage(adminApp()).bucket(bucketName);
}
