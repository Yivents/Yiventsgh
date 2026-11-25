/** Static configuration. Secrets come from runtime env / Secret Manager only. */
export const REGION = 'europe-west2';
export const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN ?? 'https://yivents.com';
export const CAPTCHA_SECRET = process.env.RECAPTCHA_SECRET_KEY ?? '';
export const TOTP_MASTER_SECRET = process.env.ADMIN_2FA_SECRET ?? '';
export const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET ?? '';
export const SCANNER_HASH_SALT = process.env.SCANNER_HASH_SALT ?? '';

/** Hard ceiling for a single payment claim (GHS 1,000,000 in pesewas). */
export const MAX_PAYMENT_PESEWAS = 100_000_000;
export const MAX_PAYMENT_MULTIPLE_OF_PRICE = 10;
export const MAX_BULK_IDS = 100;
export const EXPORT_TTL_MS = 60 * 60 * 1000;
export const PHASE1_LINK_RULES = ['on_registration', 'after_approval'] as const;

export const RATE_LIMITS = {
  submitRegistration: { limit: 5, windowMs: 10 * 60_000 },
  lookupTicket: { limit: 20, windowMs: 10 * 60_000 },
  checkIn: { limit: 120, windowMs: 60_000 },
  submitFeedback: { limit: 3, windowMs: 60 * 60_000 },
  reportEvent: { limit: 3, windowMs: 60 * 60_000 },
  verifyScannerAccess: { limit: 30, windowMs: 60_000 },
  requestUploadUrl: { limit: 10, windowMs: 10 * 60_000 },
  issueTicketLink: { limit: 8, windowMs: 10 * 60_000 },
  scannerApprove: { limit: 120, windowMs: 60 * 60_000 },
  scannerSearch: { limit: 120, windowMs: 60 * 60_000 },
} as const;

export type RateLimitedName = keyof typeof RATE_LIMITS;
