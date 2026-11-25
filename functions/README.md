# Yivents Cloud Functions (v2)

Node 22, TypeScript, region `europe-west2`. All callables in `docs/callables.md` are exported from `src/index.ts`; names are the canonical API names.

## Environment variables

| Variable | Purpose |
|---|---|
| `ALLOWED_ORIGIN` | Single allowed CORS origin (default `https://yivents.com`). |
| `RECAPTCHA_SECRET_KEY` | Server-side reCAPTCHA verification for public writes. **If absent, verification is skipped with a warning (emulator/dev only).** |
| `ADMIN_2FA_SECRET` | Secret Manager master secret used to derive each admin's TOTP secret. Admin 2FA fails closed when missing. |
| `ADMIN_2FA_RETURN_SECRET` | Set to `1` only for local manual-entry testing to include the TOTP secret in `admin2faStart`. |
| `WEBHOOK_SECRET` | Shared secret required by `POST /api/**` hooks. |
| `SCANNER_HASH_SALT` | Server-side salt for scanner/PIN hashes. |
| `FUNCTIONS_PROJECT_ID`, `STORAGE_BUCKET` | Admin SDK project/bucket overrides. |
| `FIRESTORE_EMULATOR_HOST`, `FIREBASE_AUTH_EMULATOR_HOST`, `FIREBASE_STORAGE_EMULATOR_HOST` | Emulator hosts. |

Secrets are read at runtime and should be configured with `firebase functions:secrets:set`, never committed.

## Admin UI contract

`adminAction` accepts `{ action, targetId?, reason?, value?, payload? }` with the 15 exact names from `adminActions.ts` (organizer lifecycle, listings, reports, blocklist, announcements, content publishing, settings and conversation status). `sendAdminMessage` accepts `{ conversationId, body, attachments?, programId? }`; `admin2faStart` returns `{ otpauthUri, uri, secret? }`, `admin2faVerify({ code })` and `viewAsOrganizer({ uid })` are implemented as claimed. Announcements keep `fontFamily`/`textColor` and are contrast-gated (4.5:1) server-side; publishing a content page writes `contentPages/{slug}/versions/{version}` and resets the relevant `contentAcceptances`.

## Security model

- Public writes (`submitRegistration`, `lookupTicket`, `submitFeedback`, `reportEvent`) are rate-limited via `rateLimits/{key}` and validated with `@yivents/shared` schemas.
- Capacity, transaction-ID uniqueness and duplicate-contact claims are enforced in one Firestore transaction using dedicated claim docs, so concurrent submissions cannot oversell or reuse a payment reference.
- Organizer callables verify `ownerUid` or an accepted helper membership; `cancelRegistration` and money-related operations are owner-only. Helpers cannot change status by writing Firestore directly (rules deny it).
- Admin callables require Firebase custom claims (`superAdmin`/`admin`/`support`/`moderator`); high-risk actions also require the `twoFactorEnrolled` claim. Every admin action, including `viewAsOrganizer`, writes a global `auditLogs` entry.
- Public projections (`publicPrograms`, `publicListings`) are rebuilt by trigger from allow-listed fields only; no registrant data is copied. Registration status is never returned by public lookup.

## Tests

```bash
npm run typecheck --workspace @yivents/functions   # TypeScript (no build required to author)
npm run test:unit --workspace @yivents/functions   # amount, capacity, phone unit tests
firebase emulators:start --only firestore --project yivents-demo --config firebase/firebase.json
npm test --workspace @yivents/functions           # unit + firebase/tests rules tests
```

Seed local data (idempotent, deterministic IDs):

```bash
USE_EMULATOR=1 npx tsx scripts/seed/index.ts
```

Demo accounts: `organizer@demo.yivents.test`, `helper@demo.yivents.test`, `admin@demo.yivents.test` (superAdmin + 2FA claim), password `DemoPass123!`.

## Assumptions

- Program settings may contain Phase 1 extras (`paymentAllowancePesewas`, `paymentTolerancePesewas`, `maxPaymentPesewas`, `meetingLinks`); they are accessed via a local type cast until the shared type is extended.
- Payment evidence paths are only stored when they match `uploads/{uid}/...`; payment screenshots are validated again by the `validateUpload` Storage trigger.
- Waitlisted registrations are not auto-promoted in Phase 1; capacity exhaustion returns `resource-exhausted`.
- Exported XLSX files are written to `exports/{programId}/...` with a one-hour signed URL; `cleanupExpiredExports` runs every 5 minutes (in addition to the six scheduled jobs in the contract).
- TOTP secrets are HMAC-derived from `ADMIN_2FA_SECRET` per admin UID, so they never need storage in Firestore.
