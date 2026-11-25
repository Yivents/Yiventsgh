import { getApp, getApps, initializeApp, type FirebaseApp } from 'firebase/app';
import { getAuth, type Auth } from 'firebase/auth';
import { getFirestore, type Firestore } from 'firebase/firestore';
import { getFunctions, httpsCallable, type Functions } from 'firebase/functions';
import { getStorage, type FirebaseStorage } from 'firebase/storage';
import { getAppCheck, initializeAppCheck, ReCaptchaV3Provider, type AppCheck } from 'firebase/app-check';

const config = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

export const firebaseApp: FirebaseApp = getApps().length ? getApp() : initializeApp(config);
export const auth: Auth = getAuth(firebaseApp);
export const db: Firestore = getFirestore(firebaseApp);
export const storage: FirebaseStorage = getStorage(firebaseApp);
export const functions: Functions = getFunctions(firebaseApp, 'europe-west2');

/** App Check is enabled as soon as a site key is configured. */
export const appCheck: AppCheck | null = (() => {
  const siteKey = process.env.NEXT_PUBLIC_APP_CHECK_SITE_KEY;
  if (!siteKey || typeof window === 'undefined') return null;
  // Debug token is only read in development; never commit it.
  const debugToken = process.env.NEXT_PUBLIC_APP_CHECK_DEBUG_TOKEN;
  if (debugToken) (window as unknown as { FIREBASE_appcheck_debug_token?: string }).FIREBASE_appcheck_debug_token = debugToken;
  return getAppCheck(firebaseApp) ?? initializeAppCheck(firebaseApp, { provider: new ReCaptchaV3Provider(siteKey), isTokenAutoRefreshEnabled: true });
})();

/** reCAPTCHA v3 token for public forms; callables verify it server-side. */
export async function getCaptchaToken(action = 'submit'): Promise<string | undefined> {
  if (typeof window === 'undefined') return undefined;
  const siteKey = process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY;
  if (!siteKey) return undefined;
  const google = (window as unknown as { grecaptcha?: { ready: (cb: () => void) => void; execute: (key: string, opts: { action: string }) => Promise<string> } }).grecaptcha;
  if (!google) return undefined;
  await new Promise<void>((resolve) => google.ready(resolve));
  return google.execute(siteKey, { action });
}

/** Callable wrapper used by every public/organizer write that needs server trust. */
export async function callFunction<TResponse = unknown, TRequest extends object = Record<string, unknown>>(
  name: string,
  data: TRequest,
): Promise<TResponse> {
  const callable = httpsCallable<TRequest, TResponse>(functions, name);
  const result = await callable(data);
  return result.data;
}

/** Signed Storage URL for rendering private images on a page the user may view. */
export async function storageUrl(path?: string): Promise<string | undefined> {
  if (!path) return undefined;
  const { getDownloadURL, ref } = await import('firebase/storage');
  return getDownloadURL(ref(storage, path));
}
