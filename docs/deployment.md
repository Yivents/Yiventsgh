# Deployment (Phase 1)

No Node/npm is available in the documentation authoring environment; commands below are for a normal Node 20+ workstation or CI runner. Never commit keys or service-account JSON.

## Local emulator setup

From the repository root:

```bash
npm install                 # once, generates the lockfile
npm run emulators           # firebase emulators:start --project yivents-demo -c firebase/firebase.json
```

Ports from `firebase/firebase.json`: Auth 9099, Functions 5001, Firestore 8080, Storage 9199, Hosting 5000, Emulator UI 4000 (`singleProjectMode: true`).

Copy `.env.example` to `.env.local` and set the emulator flags:

```bash
FIRESTORE_EMULATOR_HOST=127.0.0.1:8080
FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099
FIREBASE_STORAGE_EMULATOR_HOST=127.0.0.1:9199
```

For the web app to reach emulated callables, point the client at the emulator in `apps/web/src/lib/firebase/client.ts` locally (`connectFunctionsEmulator`) and use the demo project config. Test admin claims by creating users in the Auth emulator and setting custom claims through the Admin SDK against `FIREBASE_AUTH_EMULATOR_HOST` — the UI never grants roles itself.

Seed a small dataset: one user with `superAdmin`, one with `support`, one with `moderator`, a few `users`, two `programs`, one pending `programs/{id}` with `approvalStatus: 'pending'`, one `conversations/{uid}` with messages, a `reports` doc, and an empty `metrics/current` doc. Enrol the seeded admin through the 2FA screen on first login.

Checks before shipping:

```bash
npm run typecheck
npm run test:rules
npm run build
```

## Production environments

Required variables (see `.env.example`):

- Public: `NEXT_PUBLIC_FIREBASE_*`, `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_SUPPORT_EMAIL`, `NEXT_PUBLIC_APP_CHECK_SITE_KEY`, `NEXT_PUBLIC_RECAPTCHA_SITE_KEY`.
- Server-only: `FIREBASE_PROJECT_ID`, `GOOGLE_APPLICATION_CREDENTIALS` (or Application Default Credentials), `RECAPTCHA_SECRET_KEY`, `APP_CHECK_SERVICE_ACCOUNT_JSON`.
- Functions: `FUNCTIONS_PROJECT_ID`, `RECAPTCHA_SECRET_KEY`, `ALLOWED_ORIGIN`, `MONTHLY_BUDGET_ALERT_USD`.

Never prefix a secret with `NEXT_PUBLIC_`.

### 1. Rules, indexes and functions

```bash
firebase deploy --only firestore:rules,firestore:indexes,storage
firebase deploy --only functions --project yivents
```

`firestore.indexes.json` includes the composite indexes used by the review queue (`approvalStatus + createdAt`), conversations (`status/organizerUid + lastMessageAt`), reports, audit log, registrations and public listings. Deploy indexes with rules so queries do not fail in production.

### 2. Web service (Cloud Run)

The web app is a Next.js standalone build (`apps/web/Dockerfile`, `output: 'standalone'`). Build the container, push it to Artifact Registry, then deploy:

```bash
gcloud builds submit apps/web --tag europe-west2-docker.pkg.dev/yivents/web/yivents-web:latest
gcloud run deploy yivents-web \
  --image europe-west2-docker.pkg.dev/yivents/web/yivents-web:latest \
  --region europe-west2 --platform managed --allow-unauthenticated \
  --set-env-vars FIREBASE_PROJECT_ID=yivents,NEXT_PUBLIC_SITE_URL=https://yivents.com
```

Grant the runtime service account access to Firestore/Storage via IAM. Hosted pages are SSR/ISR; long-lived static assets are cached by Hosting.

### 3. Hosting front door

```bash
firebase deploy --only hosting --project yivents
```

Hosting rewrites `/api/**` to the `api` function in `europe-west2` and everything else to the `yivents-web` Cloud Run service. Security headers (CSP, HSTS, nosniff, referrer policy, permissions policy) are set in `firebase.json`; `next.config.ts` adds the same baseline headers for direct Cloud Run access.

### 4. First admin

1. Create the sign-in account.
2. Set the `superAdmin` **custom claim** with a trusted one-off Admin SDK script or a protected internal endpoint. There is no UI or Firestore field for this.
3. Sign in at `/admin`; complete TOTP enrolment. Set `support` / `moderator` claims for other staff as needed.
4. Verify in the audit log that claim changes and the first admin actions were recorded.

### Rollback

 redeploy the previous container tag and the previous rules snapshot together. Rules and code are coupled: a new callable payload must not be deployed before the function that understands it. Keep `--only` deploys small and record the release commit in the audit/ops log.
