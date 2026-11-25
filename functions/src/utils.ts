/** Shared server utilities: IDs, hashing, rate limits, CAPTCHA and audit writes. */
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { hashIdentifier, TICKET_CODE_BYTES } from '@yivents/shared';
import type { CallableRequest } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/logger';
import { CAPTCHA_SECRET, RATE_LIMITS, SCANNER_HASH_SALT, type RateLimitedName } from './config';
import { fail } from './errors';
import { firestore } from './firebase';
import type { AuditEntry } from './types';

export function nowIso(): string {
  return new Date().toISOString();
}

export function newId(): string {
  return randomUUID();
}

/** The only secret inside a QR code: 192 bits, base64url encoded. */
export function newTicketCode(): string {
  return randomBytes(TICKET_CODE_BYTES).toString('base64url');
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function scannerHash(token: string): string {
  return sha256(`${SCANNER_HASH_SALT}:${token}`);
}

export function requestIp(req: CallableRequest<unknown>): string {
  const forwarded = req.rawRequest.headers['x-forwarded-for'];
  const value = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  return String(value ?? req.rawRequest.ip ?? 'unknown').split(',')[0].trim();
}

/** Atomic sliding-window counter in rateLimits/{key}; denies on the N+1th call. */
export async function consumeRateLimit(name: RateLimitedName, identity: string): Promise<void> {
  const { limit, windowMs } = RATE_LIMITS[name];
  const key = `${name}_${hashIdentifier(identity)}`;
  const ref = firestore().doc(`rateLimits/${key}`);
  await firestore().runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const now = Date.now();
    const previous = snap.data() as { count?: number; resetAt?: number } | undefined;
    const active = Boolean(previous && (previous.resetAt ?? 0) > now);
    if (active && (previous?.count ?? 0) >= limit) {
      fail('resource-exhausted', 'Too many attempts. Please try again later.');
    }
    tx.set(
      ref,
      {
        key,
        name,
        count: active ? (previous?.count ?? 0) + 1 : 1,
        resetAt: now + windowMs,
        updatedAt: nowIso(),
      },
      { merge: true },
    );
  });
}

/** reCAPTCHA v3/v2 verification. Missing secret = emulator/dev only (warn + allow). */
export async function verifyCaptcha(token: string | undefined, ip?: string): Promise<boolean> {
  if (!CAPTCHA_SECRET) {
    logger.warn('RECAPTCHA_SECRET_KEY is not configured — allowing request (local development only).');
    return true;
  }
  if (!token) return false;
  try {
    const body = new URLSearchParams({ secret: CAPTCHA_SECRET, response: token });
    if (ip) body.set('remoteip', ip);
    const response = await fetch('https://www.google.com/recaptcha/api/siteverify', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return false;
    const result = (await response.json()) as { success?: boolean; score?: number; action?: string };
    return result.success === true && (result.score === undefined || result.score >= 0.5);
  } catch (error) {
    logger.error('CAPTCHA verification failed', error);
    return false;
  }
}

export async function audit(entry: Omit<AuditEntry, 'at'> & { at?: string }): Promise<void> {
  const record: AuditEntry = { ...entry, at: entry.at ?? nowIso() };
  await firestore().collection('auditLogs').add(record);
}

export async function programAudit(
  programId: string,
  entry: Omit<AuditEntry, 'at' | 'programId'> & { at?: string },
): Promise<void> {
  const record: AuditEntry = { ...entry, programId, at: entry.at ?? nowIso() };
  await firestore().collection(`programs/${programId}/auditLogs`).add(record);
}

export function cleanString(value: unknown, max = 200): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}
