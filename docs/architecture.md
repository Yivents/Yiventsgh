# Architecture (Phase 1)

## Shape of the system

| Layer | Technology | Role |
|---|---|---|
| Front door | Firebase Hosting | Static assets, security headers, `/api/**` rewrite to the `api` function |
| Web app | Next.js 15 standalone on Cloud Run (`europe-west2`) | SSR for public/organiser/admin pages, ISR for public and legal content |
| Business logic | Cloud Functions `europe-west2` | All privileged writes through callable functions in [`callables.md`](./callables.md) |
| Data | Firestore + Cloud Storage | Source of truth; rules deny-by-default; projections for public reads |
| Shared code | `@yivents/shared`, `@yivents/ui`, `@yivents/ticket-render` | Types, validation, Ghana helpers, design tokens, ticket rendering |

`apps/web/src/lib/firebase/admin.ts` is **server-only** Admin SDK access with lazy getters so `next build` works without credentials. Browser code uses `apps/web/src/lib/firebase/client.ts` only.

## Request flow and the trust boundary

1. Hosting terminates TLS and serves cached assets; everything else is rewritten to the Cloud Run service.
2. Next.js renders the page. Public and legal pages read Firestore through the Admin SDK (with a bundled plain-text fallback for legal content); authenticated screens hydrate in the browser with the client SDK.
3. Any write with business meaning goes through `httpsCallable(functions, name)`. The callable re-checks Auth identity, custom claims and ownership. **The browser is never trusted**, even though the UI also checks roles.
4. Functions use the Admin SDK, which bypasses Firestore rules, so they must enforce capacity, amounts, duplicates, rate limits and auditing themselves.
5. Firestore rules are the second boundary: direct client writes to `tickets`, `rateLimits`, `auditLogs`, `metrics`, `blocklist` and projections are denied.

Admin roles exist **only** as Firebase custom claims: `superAdmin`, `support`, `moderator` (with `admin` accepted as a legacy super-admin equivalent in rules). There is no editable `role`, `isAdmin`, `plan` or `credits` field on `users`; create/update rules explicitly reject those keys.

## Public projections

`publicPrograms/{slug}` and `publicListings/{programId}` are safe, denormalised documents maintained by the `syncPublicProjections` trigger. They contain display data (title, times, branding, ticket summaries, counters) and **never** registrant answers, contact details, transaction IDs or scanner PINs.

- `publicPrograms`: `get` only when not archived; `list` is denied so a link-only event cannot be enumerated. The slug is the capability.
- `publicListings`: readable only when `approvalStatus == 'approved'` and status is `upcoming` or `ongoing`.
- Admin review changes `programs/{id}.approvalStatus` through `adminAction`; the projection follows asynchronously.

## Money and time

- Currency is `GHS`. All amounts are **integer pesewas** (`pricePesewas`, `amountPaidPesewas`, `overByPesewas`, `shortByPesewas`). Divide by 100 only at the presentation edge using `formatGHS`.
- Over/short calculations use `computeOverShort` in `@yivents/shared`, never floating-point comparison of cedis.
- All timestamps are stored as UTC ISO strings (or Firestore Timestamps). Users see `Africa/Accra` through `formatGhanaDate` and `formatEventRange`. Multi-day events are a single range with a later `endAt`; the range suffix is GMT to avoid misleading local labels.

## Collections at a glance

| Collection | Written by | Read by |
|---|---|---|
| `users` | owner (limited fields), `onUserCreate`, admin callables | owner, any admin |
| `programs/**` | owner/helper (server for sensitive fields) | owner/helper, any admin |
| `registrations`, `checkInLogs`, `feedback`, `waitlist` | callables only | owner/helper, any admin |
| `tickets`, `rateLimits` | server only | nobody via client |
| `publicPrograms`, `publicListings` | `syncPublicProjections` trigger | public (get / approved list) |
| `conversations/{orgId}/messages` | owner, admin via `sendAdminMessage` | participants, any admin |
| `reports` | `reportEvent` callable | owner, any admin; status via `adminAction` |
| `settings`, `blocklist`, `metrics` | super admin callables / scheduled functions | any admin |
| `announcements`, `contentPages` | super admin callables | public read, admin version history |
| `contentAcceptances/{uid}/{slug}` | signed-in owner | owner, any admin |
| `auditLogs` (global and per-program) | server only | global: super admin only; per-program: owner/admin |

## Admin UI

`apps/web/src/app/(admin)/layout.tsx` wraps `/admin/**` with `AdminShell`:

- claim guard using `useSession()` (`superAdmin` / `support` / `moderator` only);
- TOTP enrolment gate via `admin2faStart` / `admin2faVerify` until `twoFactorEnrolled` is true;
- `startAdminIdleTimer(..., 30)` with sign-out on expiry;
- role-scoped navigation and `AdminOnly` route guards (support: Messages; moderator: Review queue; super admin: everything);
- persistent read-only banner when a `viewAsOrganizer` session flag is set.

Every screen shows explicit loading, empty and friendly error states. All privileged buttons call `adminAction` or `sendAdminMessage`; the UI never escalates by writing Firestore directly.

## Legal pages

`/legal/[slug]` is SSR with hourly ISR. `contentPages/{slug}` (plain text fields `title`, `summary`, `body`) wins when available; bundled constants in `apps/web/src/components/admin/legalContent.ts` are the fallback. Bodies are rendered as paragraphs only — no `dangerouslySetInnerHTML`. Version history lives under `contentPages/{slug}/versions` and publishing is expected to reset `contentAcceptances` server-side so organisers are re-prompted.

## Background work

`rolloverProgramStatuses`, `archiveWarnings`, `archivePrograms`, `deleteOldScreenshots`, `applyRetention`, `updatePlatformMetrics` (scheduled) and `validateUpload`, `logRegistrationChanges`, `onUserCreate` (triggers) own all asynchronous maintenance. The dashboard reads `metrics/*` snapshots plus small live collection counts, so it degrades gracefully before the first scheduled run.
