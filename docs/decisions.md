# Phase 1 decisions and open items

## Decisions

1. **Roles are claims only.** `superAdmin`, `support` and `moderator` (plus legacy `admin`) come from Firebase custom claims. There is deliberately no editable role field; both rules and the UI enforce this.
2. **Callables are the trust boundary.** All privileged writes go through the exact names in [`callables.md`](./callables.md). The browser may display state but never grants itself authority.
3. **Integer pesewas, UTC storage, Accra display.** `GHS` amounts are integers; presentation uses `formatGHS`. Timestamps are UTC ISO strings rendered in `Africa/Accra` via shared helpers.
4. **Public data is projected, not exposed.** `publicPrograms` and `publicListings` are safe trigger-maintained projections; link-only slugs cannot be enumerated; registrant data never appears in a projection.
5. **Plain text only.** User/admin text is validated with `plainTextSchema` and rendered as paragraphs. No raw HTML in announcements, legal pages, reasons or messages.
6. **Announcement fonts.** The shared `Announcement.font` enum has four values. The builder offers eight curated families and stores the enum value plus a `fontFamily` hint; contrast is checked with `contrastRatio` at 4.5:1 and urgent banners are always non-dismissible.
7. **Legal content falls back safely.** `/legal/[slug]` reads `contentPages/{slug}` with ISR and uses bundled constants in `components/admin/legalContent.ts` when Firestore is unavailable. All pages carry `[LEGAL REVIEW NEEDED]`, placeholder markers, Act 843 reference and the required responsibility statements.
8. **Role-scoped admin navigation.** Support sees Messages only; Moderator sees the Review queue only; Super admin sees all sections. Route-level `AdminOnly` guards match the nav.
9. **Saved replies are local.** Phase 1 saved replies live in `localStorage` on the admin device; they are plain text and do not create a new Firestore contract.
10. **Metrics are tolerant.** The dashboard reads `metrics/*` and accepts common field aliases for sign-ups, registrations, scans and retention, with live counts for organisers and events. Missing values render as `—` instead of zero.
11. **2FA and idle.** Every admin must enrol in TOTP before any admin screen renders; idle timeout is exactly 30 minutes using `startAdminIdleTimer`.
12. **Read-only impersonation.** `viewAsOrganizer` logs access; the view-as banner persists via `sessionStorage` and the impersonation screen exposes no actions.

## Additional Phase 1 decisions

13. **Registrants have no accounts.** Public screenshots are uploaded through `requestUploadUrl`, which issues a random token-scoped folder under `uploads/anonymous/{token}/...` after CAPTCHA and rate limiting. Storage rules and the finalize trigger both revalidate the MIME type and size; anonymous Firebase Auth sign-in is not used.
14. **Private ticket links are server-issued.** `issueTicketLink` verifies the identifier and returns a `/t/{code}` link with a short-lived one-time code. Because platform email/SMS is a Phase 3 feature, the UI offers a `mailto:` compose and states this limitation honestly.
15. **Door staff use a capability token, not an account.** `verifyScannerAccess` accepts the scanner link token (and optional PIN); `checkIn`, `scannerApprove` and `scannerSearch` all re-verify that token on the server. Check-in and on-the-spot approval are transactions, so multiple phones can scan safely.
16. **Public projections carry definitions, never data.** `publicPrograms` now includes public-safe `formFields`, enabled `paymentMethods`, payment instructions and plan; triggers resync it when those subcollections change. Answers, screenshots, ticket codes, meeting links and internal statuses are never projected.
17. **Ticket lookup works from a bare private link.** `lookupTicket` resolves the programme from a program id, a public slug, or the ticket code itself, so a shared `/t/{code}` URL works without extra query parameters.

## Deferred by design (Phase 2/3 — not missing Phase 1 work)

- Statement/essay matching and automated grading.
- Waitlist auto-promotion (Phase 1 reserves capacity at submission and releases it on reject/cancel).
- Scheduled and manual meeting-link release, and tracked Join-button activation.
- Platform-sent email/SMS for ticket links, payments and reminders (Phase 1 uses organizer-initiated `mailto:` batching).
- Platform subscriptions/billing and paid plan tiers (`plan: 'free'` is the only Phase 1 value).
- Feedback analytics dashboards and saved-reply sharing across staff devices.
- Homepage video/banner and outline generator.

## Open items and decisions still needed from you

- **Environment and credentials:** real Firebase project config, App Check site key, reCAPTCHA v3 keys, `ALLOWED_ORIGIN`, `ADMIN_2FA_SECRET`, `SCANNER_HASH_SALT`, Secret Manager entries and the Cloud Run service `yivents-web` must be provisioned. All current values are placeholders.
- **Legal sign-off:** replace `[YOUR NAME]`, `[SUPPORT EMAIL]`, `[DOMAIN]` and remove every `[LEGAL REVIEW NEEDED]` marker only after counsel approves. Confirm Act 843 references, section 4.12 numbering, cookie/refund wording and the registrant notice.
- **App Check enforcement:** decide whether to run in soft-launch (monitor) mode before enabling hard enforcement on callables and Storage.
- **Rate limits and budgets:** confirm the default thresholds in `apps/functions/src/config.ts`, monthly budget alerts, backup schedule and retention periods.
- **Admin recovery:** decide the TOTP lost-device/re-enrolment process; Phase 1 covers enrolment and verification only.
- **Role scope:** confirm whether Moderators should also see Reports/Blocklist (currently Review only) and how saved replies should be shared, if at all.
- **Metrics schema:** the dashboard tolerates aliases; once the production metrics writer is agreed, pin one canonical `metrics/{id}` shape and remove the aliases.
- **Toolchain verification:** Node/npm were unavailable in the build environment, so `npm install`, typecheck, builds and emulator tests have **not** been executed. Run these before deployment and fix any compiler errors.
- **Instant-ticket policy:** confirm which paid ticket types should issue immediately versus requiring approval; defaults are per ticket type in program settings.
