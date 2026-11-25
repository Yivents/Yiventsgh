# Security testing and operations (Phase 1)

## Defence layers

1. **Firebase App Check** on callables, using reCAPTCHA Enterprise/Play Integrity providers (`NEXT_PUBLIC_APP_CHECK_SITE_KEY`, `APP_CHECK_SERVICE_ACCOUNT_JSON`). Start in monitoring mode, then enforce for callable traffic. Emulator traffic must be allowed explicitly via debug tokens.
2. **CAPTCHA** on public writes: `submitRegistration`, `lookupTicket`, `submitFeedback` validate the token server-side with `RECAPTCHA_SECRET_KEY`. Admin screens do not need CAPTCHA; they need claims and 2FA.
3. **Rate limits** in the server-only `rateLimits` collection (client read/write denied). Enforce per IP/identifier/action for lookups, submissions and messages. Friendly client errors map `too-many-requests` to a wait-and-retry message.
4. **Firestore/Storage rules** deny by default; `npm run test:rules` must cover the cases below.
5. **Callables** re-verify identity, claims, ownership, capacity, amounts and transaction-ID uniqueness inside transactions, and write audit records.

## Rules test matrix (`npm run test:rules`)

- Unauthenticated reads/writes to `users`, `programs`, `metrics`, `settings`, `blocklist`, `auditLogs` are denied.
- `users/{uid}`: only self can read; self cannot update `status`, `suspensionReason`, `verifiedBadge`, `uid`, `accountType`; self cannot create with `admin`, `role`, `isAdmin`, `plan` or `credits`.
- `superAdmin`: can suspend/restore/remove and change the verified badge; `support` and `moderator` cannot.
- Global `auditLogs`: super admin only. Per-program `programs/{id}/auditLogs`: only owner/admin. `blocklist` and `settings`: read any admin, write super admin only.
- `publicPrograms/{slug}`: `get` allowed unless archived; `list` denied. `publicListings`: only approved upcoming/ongoing; `list` of unapproved denied.
- `tickets/{code}`, `rateLimits/{key}`: all client access denied.
- `programs/{id}/registrations`: direct `create` denied; client updates cannot change `status`, `ticketCode`, `payment`, `contact`, check-in fields.
- `conversations/{orgId}/messages`: only participants or any admin can read/send; `delete` denied.
- `reports`: public create only with `status: 'open'` and an allowed key set; only admin can change status.
- Storage: uploads stay under `uploads/{uid}/`, images/videos only and within size limits; payment screenshots are not public.

## Callable and admin UI tests

- `submitRegistration`: fake CAPTCHA, duplicate phone/email, over-capacity race, malformed transaction ID, repeated transaction ID, wrong amount — all rejected; capacity and counters are transactionally consistent.
- `checkIn`: scanner token validation; green/amber/red result; duplicate check-in is idempotent or rejected as designed.
- `adminAction`: call each canonical action with support/moderator claims and confirm denial; with superAdmin confirm the Firestore change **and** an audit entry containing actor, action, target and reason.
- `admin2faStart` never returns the raw secret to the browser; `admin2faVerify` requires a valid TOTP and sets `twoFactorEnrolled`; all admin screens are blocked until then.
- Idle logout fires after 30 minutes of inactivity and clears the session; the view-as banner persists until explicitly exited.
- `viewAsOrganizer` is read-only and always writes an audit entry.
- `sendAdminMessage` only accepts threads the admin can access and stores plain text; group sends produce one audited message per recipient.
- Plain-text guard: HTML in announcements, legal content, reasons, replies and banners is rejected; React rendering never uses `dangerouslySetInnerHTML`.
- Accessibility smoke test: every input has a label, keyboard navigation works, and interactive targets are at least 44px.

## Backups, budgets and dependency hygiene

- **Backups**: enable daily Firestore automated backups with a retention window aligned to `DEFAULT_RETENTION_MONTHS` (12). Export `auditLogs`, `registrations`, `programs` and `users` to a restricted bucket; enable Storage object versioning for `uploads/**`. Run a restore drill each quarter into the demo project and verify ticket codes and counter consistency.
- **Budget alerts**: set a monthly billing budget (see `MONTHLY_BUDGET_ALERT_USD`) with alerts at 50%, 90% and 100%; add alerts for Function invocations, Firestore writes and egress. Unexpected `applyRetention` or `updatePlatformMetrics` volumes are an incident signal.
- **Dependency audits**: commit the lockfile; run `npm audit --omit=dev --audit-level=high` and `npm audit --audit-level=high` in CI, plus Dependabot/Renovate weekly. Patch `firebase`, `firebase-admin`, `next`, `react` and `zod` promptly; record accepted risks in `docs/decisions.md`.
- **Secrets**: rotate service accounts and reCAPTCHA/App Check keys on a schedule; never log ID tokens, TOTP secrets, ticket codes or payment screenshots.

## Incident response outline

1. Revoke the affected custom claim with the Admin SDK; sessions pick up the change on next token refresh.
2. Disable the relevant feature switch or turn on maintenance mode through `adminAction` (audited).
3. Use the global audit log to establish scope; freeze retention jobs if data may be needed as evidence.
4. Restore from backup into a separate project, verify, then migrate only affected documents.
5. Publish a plain-English notice through the announcement builder and update the legal pages if registrant data was involved.
