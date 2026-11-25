# Canonical callable / HTTPS API contract (Phase 1)

All names are exact. Callables are `httpsCallable(functions, name)` in `europe-west2`.
Every callable verifies identity and ownership server-side; never trust the client.

| Name | Direction | Purpose |
|---|---|---|
| `submitRegistration` | public | Validate CAPTCHA, duplicate/rate limits, capacity (transaction), amount, transaction-ID uniqueness; write registration + ticket + counters + audit. |
| `lookupTicket` | public | Rate-limited lookup by email/phone or ticket code; returns safe ticket data and meeting-link eligibility only. |
| `checkIn` | door staff | Verify scanner token, atomic check-in transaction, return green/amber/red result. |
| `verifyScannerAccess` | door staff | Validate scanner link/PIN and return program display data when enabled. |
| `submitFeedback` | public | Rate-limited feedback submission after event. |
| `reportEvent` | public | Create a report in the admin inbox. |
| `requestUploadUrl` | public | Rate-limited, CAPTCHA-checked server-issued anonymous upload folder/signed URL for screenshots. |
| `issueTicketLink` | public | Rate-limited private `/t/{code}` link plus a server-issued one-time code. |
| `scannerApprove` | door staff | Scanner-token-only approval of an unverified paid ticket on the spot (atomic). |
| `scannerSearch` | door staff | Scanner-token-only name search for the manual check-in fallback. |
| `approveRegistrations` | organizer/helper | Bulk approve; updates status, counters, audit. |
| `rejectRegistrations` | organizer/helper | Bulk reject; releases capacity. |
| `cancelRegistration` | organizer only | Cancel ticket; scanner shows red. |
| `reassignTransaction` | organizer only | Move a transaction ID claim from one registration to another. |
| `extendDeadline` | organizer only | Extend deadline with validation (not beyond event end) and change log. |
| `recordExpectedReceived` | organizer only | Store expected-vs-received total. |
| `markUnpaid` | organizer only | Mark registration unpaid and return recipient data for mailto batching. |
| `generateScannerCredentials` | organizer only | Create scanner link and PIN hash. |
| `toggleScanner` | organizer only | Enable/disable scanner. |
| `exportRegistrations` | organizer/helper | Return a short-lived signed URL to a generated XLSX (not stored permanently). |
| `inviteHelper` | organizer only | Create helper membership by link token. |
| `acceptHelperInvite` | helper | Accept invitation after sign-in. |
| `sendAdminMessage` | organizer/admin | Add a message to a conversation thread. |
| `adminAction` | admin claims | Generic audited admin operation (suspend/restore/remove/approve listing/blocklist/content/settings). |
| `admin2faStart` | admin claims | Begin TOTP enrollment; returns otpauth URI (secret stored server-side). |
| `admin2faVerify` | admin claims | Confirm TOTP code and set `twoFactorEnrolled` claim. |
| `viewAsOrganizer` | admin claims | Read-only impersonation, always audit-logged. |
| `recordJoinClick` | public | Count a click on a released online meeting link (no personal data). |

HTTP endpoints (Firebase Hosting rewrite `/api/**`):
- `api` — health check and scheduled webhook hooks where needed.

Scheduled functions:
- `rolloverProgramStatuses` (hourly)
- `archiveWarnings` (daily)
- `archivePrograms` (daily)
- `deleteOldScreenshots` (daily)
- `applyRetention` (daily)
- `updatePlatformMetrics` (daily)
- `cleanupExpiredExports` (every 5 minutes, removes expired signed-URL export files)

Triggers:
- `syncPublicProjections` (on program write)
- `syncPublicFormFields`, `syncPublicTicketTypes`, `syncPublicPaymentMethods` (on subcollection writes)
- `validateUpload` (on Storage finalize)
- `logRegistrationChanges` (on registration write)
- `onUserCreate` (on Auth user create)
