/**
 * Public/registrant helpers that still need a trusted server: upload tickets,
 * private ticket-link issuance, and the no-account door-staff actions.
 */
import { onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/logger';
import { normalizeGhanaPhone, hashIdentifier } from '@yivents/shared';
import { z } from 'zod';
import { ALLOWED_ORIGIN, REGION } from '../config';
import { capacityDelta, counterUpdates } from '../capacity';
import { fail } from '../errors';
import { bucket, firestore } from '../firebase';
import { getProgram } from '../authz';
import {
  consumeRateLimit,
  newId,
  nowIso,
  programAudit,
  randomToken,
  requestIp,
  scannerHash,
  sha256,
  verifyCaptcha,
} from '../utils';
import { parseInput } from '../validation';
import type { RegistrationDoc } from '../types';

const uploadSchema = z.object({
  programId: z.string().min(1),
  fileName: z.string().max(120).regex(/^[A-Za-z0-9._ -]+$/, 'Use a simple file name.'),
  contentType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
  captchaToken: z.string().optional(),
});

const linkSchema = z.object({
  programId: z.string().min(1),
  identifier: z.string().trim().min(4),
  captchaToken: z.string().optional(),
});

const scannerSchema = z.object({
  programId: z.string().min(1),
  scannerToken: z.string().min(1),
});
const scannerApproveSchema = scannerSchema.extend({ registrationId: z.string().min(1) });
const scannerSearchSchema = scannerSchema.extend({ query: z.string().trim().min(1).max(80) });

/** Registrants have no account, so uploads use a server-issued anonymous folder. */
export const requestUploadUrl = onCall(
  { region: REGION, cors: [ALLOWED_ORIGIN], secrets: ['RECAPTCHA_SECRET_KEY'] },
  async (request) => {
    const input = parseInput(uploadSchema, request.data);
    const ip = requestIp(request);
    await consumeRateLimit('requestUploadUrl', ip);
    if (!(await verifyCaptcha(input.captchaToken, ip))) {
      fail('permission-denied', 'CAPTCHA verification failed. Please try again.');
    }
    await getProgram(input.programId);
    const token = randomToken(24);
    const extension = input.contentType === 'image/png' ? 'png' : input.contentType === 'image/webp' ? 'webp' : 'jpg';
    const path = `uploads/anonymous/${token}/registrations/${newId()}.${extension}`;
    let uploadUrl: string | undefined;
    try {
      // Works in production; the emulator falls back to the Storage SDK path.
      [uploadUrl] = await bucket().file(path).getSignedUrl({
        action: 'write',
        expires: Date.now() + 10 * 60 * 1000,
        contentType: input.contentType,
      });
    } catch (error) {
      logger.info('Signed upload URL unavailable; using Storage SDK path instead.', error);
    }
    return { path, token, uploadUrl, contentType: input.contentType };
  },
);

/** Private link + server-issued one-time code (no platform email service yet). */
export const issueTicketLink = onCall(
  { region: REGION, cors: [ALLOWED_ORIGIN], secrets: ['RECAPTCHA_SECRET_KEY'] },
  async (request) => {
    const input = parseInput(linkSchema, request.data);
    const ip = requestIp(request);
    await consumeRateLimit('issueTicketLink', `${ip}:${input.identifier}`);
    if (!(await verifyCaptcha(input.captchaToken, ip))) {
      fail('permission-denied', 'CAPTCHA verification failed. Please try again.');
    }
    // The public form supplies the page slug; resolve it to the private id.
    const direct = await firestore().doc(`programs/${input.programId}`).get();
    const program = direct.exists
      ? { ...(direct.data() as Awaited<ReturnType<typeof getProgram>>), id: direct.id }
      : await (async () => {
          const projection = await firestore().doc(`publicPrograms/${input.programId}`).get();
          const projectedId = projection.data()?.programId as string | undefined;
          if (!projectedId) fail('not-found', 'Event not found. Open the event page and try again.');
          return getProgram(projectedId);
        })();
    const identifier = input.identifier.trim();
    const keys = [
      identifier.includes('@') ? `email_${hashIdentifier(identifier.toLowerCase())}` : undefined,
      normalizeGhanaPhone(identifier) ? `phone_${hashIdentifier(normalizeGhanaPhone(identifier)!)}` : undefined,
      `phone_${hashIdentifier(identifier)}`,
      `email_${hashIdentifier(identifier)}`,
    ].filter(Boolean) as string[];

    for (const key of keys) {
      const snap = await firestore()
        .collection(`programs/${program.id}/registrations`)
        .where('contact.duplicateKey', '==', key)
        .limit(1)
        .get();
      const foundDoc = snap.docs[0];
      const registration = foundDoc?.data() as RegistrationDoc | undefined;
      if (!foundDoc || !registration || ['rejected', 'cancelled'].includes(registration.status)) continue;
      const code = randomToken(6).toUpperCase();
      const expiresAt = Date.now() + 30 * 60 * 1000;
      await firestore().doc(`programs/${program.id}/linkCodes/${sha256(code)}`).set({
        programId: program.id,
        registrationId: foundDoc.id,
        codeHash: sha256(code),
        expiresAt,
        createdAt: nowIso(),
        used: false,
      });
      return {
        found: true,
        ticketCode: registration.ticketCode,
        privatePath: `/t/${registration.ticketCode}`,
        oneTimeCode: code,
        expiresAt,
      };
    }
    return { found: false };
  },
);

async function requireScanner(programId: string, token: string) {
  const program = await getProgram(programId);
  if (!program.scannerEnabled) fail('permission-denied', 'The scanner is disabled.');
  const scanner = (await firestore().doc(`programs/${programId}/scanner`).get()).data();
  if (!scanner || scanner.enabled !== true || scanner.tokenHash !== scannerHash(token)) {
    fail('permission-denied', 'Invalid scanner credentials.');
  }
  return program;
}

/** Door staff can approve an unverified paid ticket on the spot, atomically. */
export const scannerApprove = onCall({ region: REGION, cors: [ALLOWED_ORIGIN] }, async (request) => {
  const input = parseInput(scannerApproveSchema, request.data);
  const ip = requestIp(request);
  await consumeRateLimit('scannerApprove', `${ip}:${input.programId}`);
  const program = await requireScanner(input.programId, input.scannerToken);
  const at = nowIso();

  const result = await firestore().runTransaction(async (tx) => {
    const ref = firestore().doc(`programs/${program.id}/registrations/${input.registrationId}`);
    const snap = await tx.get(ref);
    const registration = snap.data() as RegistrationDoc | undefined;
    if (!registration) fail('not-found', 'Registration not found.');
    if (registration.status !== 'pending') fail('failed-precondition', 'Only pending payments can be approved here.');
    const delta = capacityDelta('pending', 'verified');
    tx.update(ref, {
      status: 'verified',
      verifiedAt: at,
      updatedAt: at,
      updatedBy: `scanner:${scannerHash(input.scannerToken).slice(0, 12)}`,
      ...(registration.payment ? { payment: { ...registration.payment, verified: true, verificationStatus: 'verified' } } : {}),
    });
    tx.update(firestore().doc(`programs/${program.id}`), counterUpdates(delta));
    const ticketRef = firestore().doc(`tickets/${registration.ticketCode}`);
    if ((await tx.get(ticketRef)).exists) tx.update(ticketRef, { internalStatus: 'valid' });
    return { name: registration.contact.name, ticketType: registration.ticketTypeName };
  });

  await programAudit(program.id, {
    action: 'scanner.approvedOnSpot',
    actorRole: 'door_staff',
    targetId: input.registrationId,
    details: { at },
  });
  return { ok: true, ...result };
});

/** Manual attendee-list fallback for weak network; no registrant answers returned. */
export const scannerSearch = onCall({ region: REGION, cors: [ALLOWED_ORIGIN] }, async (request) => {
  const input = parseInput(scannerSearchSchema, request.data);
  await consumeRateLimit('scannerSearch', `${requestIp(request)}:${input.programId}`);
  const program = await requireScanner(input.programId, input.scannerToken);
  const query = input.query.trim();
  const snap = await firestore()
    .collection(`programs/${program.id}/registrations`)
    .where('contact.name', '>=', query)
    .where('contact.name', '<=', `${query}\uf8ff`)
    .limit(20)
    .get();
  const results = snap.docs.map((doc) => {
    const registration = doc.data() as RegistrationDoc;
    return {
      id: registration.id,
      name: registration.contact.name,
      ticketTypeName: registration.ticketTypeName,
      ticketCode: registration.ticketCode,
      status: registration.status,
      checkedInAt: registration.checkedInAt ?? null,
    };
  });
  return { results };
});
