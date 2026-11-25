import { cert, getApp, getApps, initializeApp, type App } from 'firebase-admin/app';
import { getAuth, type Auth } from 'firebase-admin/auth';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { getStorage, type Bucket } from 'firebase-admin/storage';

/**
 * Server-only Admin SDK access. Lazy getters keep `next build` working without
 * credentials (public pages fall back to an empty list and log a warning).
 */
function adminApp(): App {
  if (getApps().length) return getApp();
  const projectId = process.env.FIREBASE_PROJECT_ID ?? process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID ?? 'yivents';
  const serviceAccountPath = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (serviceAccountPath) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const serviceAccount = require(serviceAccountPath);
    return initializeApp({ credential: cert(serviceAccount), projectId, storageBucket: `${projectId}.appspot.com` });
  }
  return initializeApp({ projectId, storageBucket: `${projectId}.appspot.com` });
}

export function getAdminDb(): Firestore {
  return getFirestore(adminApp());
}

export function getAdminAuth(): Auth {
  return getAuth(adminApp());
}

export function getAdminBucket(): Bucket {
  return getStorage(adminApp()).bucket();
}
