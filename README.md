# Yivents

Yivents is a registration, payment-tracking and ticketing tool for Ghanaian event organizers. An organizer creates an event, sets ticket prices in GHS, collects MoMo or bank transfer details, approves registrations, and scans QR tickets at the door. Registrants do **not** need an account.

**Money rule:** Yivents never receives or processes payments. Attendees pay the organizer directly. There is no Paystack/Flutterwave integration. All money is stored as whole pesewas, and only in GHS.

---

## Read this first: GitHub is for the code, not the live app

For now, GitHub is where we keep the source code, history and documentation. It is **not** where the public website runs.

This app uses Next.js server rendering, Cloud Functions, Firestore and Storage. GitHub Pages can only serve static files, so it cannot run Yivents. The live site will later be deployed to Firebase Hosting + Cloud Run (see `docs/deployment.md`).

---

## Step 1 — Put this code on GitHub

This folder (`yivents`) is **not** yet a Git repository, and the folder above it contains an unrelated project. Run these commands **inside the `yivents` folder**:

```powershell
cd "C:\Users\USER\Documents\Default Project\yivents"

git --version                       # install Git for Windows if this fails
git init -b main
git add .
git status                          # check nothing unexpected is listed
git commit -m "Initial Yivents Phase 1"
```

Now create the empty repository on GitHub:

1. Go to <https://github.com/new>.
2. Name it `yivents`.
3. Choose **Private** or **Public**.
4. **Do not** tick “Add a README”, “Add .gitignore” or “Add a license” — we already have local files.
5. Click **Create repository**.

Then connect your local folder to GitHub and push (replace `YOUR-USERNAME`):

```powershell
git remote add origin https://github.com/YOUR-USERNAME/yivents.git
git push -u origin main
```

If you have the GitHub CLI installed, you can do the last part in one command instead:

```powershell
gh repo create yivents --private --source=. --remote=origin --push
```

Afterwards, `git status` should say “working tree clean”. The `.gitignore` already excludes `node_modules`, `.next`, `lib`, `.env*`, `serviceAccount.json` and logs. **Never commit real API keys, service accounts or `.env.local`.** Only `.env.example` (with blank values) belongs in the repo.

---

## Step 2 — What is in the repository

```text
apps/web/                 Next.js app: public pages, /app organizer area, /admin, /legal
apps/functions/           Cloud Functions: callables, triggers, scheduled jobs, XLSX export
packages/shared/          Types, validation and Ghana/GHS helpers (built to lib/ first)
packages/ui/              Design tokens and accessible UI components
packages/ticket-render/   One ticket component used by both preview and downloads
firebase/                 Hosting, Firestore rules, Storage rules, indexes, emulator config
firebase/tests/           Firestore security-rule tests
scripts/seed/             Demo organizer/admin/programs for the emulator
docs/                     Architecture, deployment, security, decisions, callable contract
```

Key rule: public pages read only the safe `publicPrograms` and `publicListings` projections. Registrant answers, screenshots and payment details are never copied there.

---

## Step 3 — Run it on your computer

You need **Node.js 22+**, npm 10+ and the Firebase CLI (`npm i -g firebase-tools`). None of these were available in the environment where the code was written, so the commands below have **not** been run yet.

```powershell
cd "C:\Users\USER\Documents\Default Project\yivents"

npm install
Copy-Item .env.example .env.local
Copy-Item .env.example apps/functions/.env
```

Open `.env.local` and fill in your Firebase web config (`NEXT_PUBLIC_FIREBASE_*`). Open `apps/functions/.env` and fill in server-only values. Server secrets must **never** start with `NEXT_PUBLIC_`.

Start the app and the local Firebase emulators in two terminals:

```powershell
npm run dev          # website at http://localhost:3000
npm run emulators    # Auth, Firestore, Storage, Functions, Hosting UI at http://localhost:4000
```

Seed demo data (organizer, helper, admin, two events, sample registrations and tickets):

```powershell
npm run build --workspace @yivents/shared
npx tsx scripts/seed/index.ts
```

The seed script prints the demo email addresses and IDs. Use them to sign in at `/login`.

---

## Step 4 — Checks before going live

```powershell
npm run typecheck                 # TypeScript across all workspaces
npm run test:rules                # Firestore rules in the emulator
firebase emulators:exec --project yivents-demo --config firebase/firebase.json "npm run test:rules"
npm run build                     # production build
```

Then, in order:

1. Create a Firebase project; enable Auth (email/password, optional Google), Firestore, Storage, Functions and Hosting.
2. Deploy rules and indexes: `firebase deploy --only firestore:rules,firestore:indexes,storage`.
3. Deploy the Next.js standalone build to Cloud Run as service `yivents-web` in `europe-west2` (details in `docs/deployment.md`).
4. Deploy functions: `firebase deploy --only functions`.
5. Deploy hosting: `firebase deploy --only hosting`.
6. Add your final domain to Firebase Auth authorized domains and App Check.

Admin access is granted **only** through Firebase custom claims (`superAdmin`, `support`, `moderator`), never through a database field. Each admin must complete TOTP enrolment at `admin2faStart` → `admin2faVerify` before `/admin` opens.

---

## Current status and open decisions

Phase 1 is written, but not yet compiled or deployed because Node/npm were unavailable here. See `docs/decisions.md` for the full list. The main things still needing your input are:

- Real Firebase project keys, App Check/reCAPTCHA keys, `ALLOWED_ORIGIN`, `ADMIN_2FA_SECRET`, `SCANNER_HASH_SALT` and a Cloud Run service.
- Legal review: replace `[LEGAL REVIEW NEEDED]`, `[YOUR NAME]`, `[SUPPORT EMAIL]` and `[DOMAIN]` in `/legal/*` before launch.
- App Check enforcement mode, rate limits, budgets, backups and retention periods.
- TOTP lost-device recovery, moderator role scope, and one canonical metrics schema.

Features deliberately saved for Phase 2/3: statement matching, waitlist promotion, scheduled/manual meeting-link release, tracked Join clicks, subscriptions, platform-sent email/SMS, feedback analytics, homepage video/banner and outline generator.

---

## More detail

- `docs/architecture.md` — how the pieces fit together and where data is trusted
- `docs/deployment.md` — exact Firebase/Cloud Run deployment steps
- `docs/security-testing.md` — rules tests, App Check, rate limits, backups, audits
- `docs/callables.md` — every callable name and what it does
- `docs/decisions.md` — decisions, deferred work and open questions
