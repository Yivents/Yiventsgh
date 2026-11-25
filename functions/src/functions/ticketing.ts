/** Ticket lookup, door check-in, feedback and abuse reports. */
import {
  checkInSchema,
  feedbackSubmissionSchema,
  hashIdentifier,
  normalizeGhanaPhone,
  ticketLookupSchema,
  type Program,
} from '@yivents/shared';
import { onCall } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { ALLOWED_ORIGIN, PHASE1_LINK_RULES, REGION } from '../config';
import { checkedInUpdate } from '../capacity';
import { fail } from '../errors';
import { firestore } from '../firebase';
import { getProgram } from '../authz';
import {
  audit,
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
import { parseInput, type AnswerValue } from '../validation';
import { settingsOf, type RegistrationDoc, type ScannerDoc, type TicketDoc } from '../types';

/** A registrant may arrive with just a private ticket code in the URL. */
const lookupInputSchema = ticketLookupSchema.extend({
  programId: z.string().min(1).optional(),
  ticketCode: z.string().min(24).optional(),
});
const scannerInputSchema = z.object({
  programId: z.string().min(1),
  token: z.string().min(1),
  pin: z.string().optional(),
});
const feedbackInputSchema = feedbackSubmissionSchema;
const reportInputSchema = z.object({
  programId: z.string().min(1),
  reason: z.string().trim().min(3).max(120),
  details: z.string().trim().min(5).max(2000),
  contact: z.string().trim().max(200).optional(),
});
const joinClickSchema = z.object({ programId: z.string().min(1), ticketCode: z.string().min(24) });

async function enabledScanner(program: Program, token: string, pin?: string): Promise<void> {
  if (program.scannerEnabled !== true) fail('permission-denied', 'The scanner is disabled.');
  const snap = await firestore().doc(`programs/${program.id}/scanner`).get();
  const scanner = snap.data() as ScannerDoc | undefined;
  if (!scanner || scanner.enabled !== true || scannerHash(token) !== scanner.tokenHash) {
    fail('permission-denied', 'Invalid scanner credentials.');
  }
  if (pin && scanner.pinHash && scannerHash(pin) !== scanner.pinHash) {
    fail('permission-denied', 'Invalid scanner PIN.');
  }
}

/** Accept a program id, a public page slug, or resolve from a ticket code. */
async function resolveProgram(programIdOrSlug?: string, code?: string): Promise<Program & { id: string }> {
  if (programIdOrSlug) {
    const direct = await firestore().doc(`programs/${programIdOrSlug}`).get();
    if (direct.exists) return { ...(direct.data() as Program), id: direct.id };
    const projection = await firestore().doc(`publicPrograms/${programIdOrSlug}`).get();
    const projectedId = projection.data()?.programId as string | undefined;
    if (projectedId) return getProgram(projectedId);
    fail('not-found', 'Event not found. Open the event page and use its link, then try again.');
  }
  if (code) {
    const ticket = (await firestore().doc(`tickets/${code}`).get()).data() as TicketDoc | undefined;
    if (ticket?.programId) return getProgram(ticket.programId);
  }
  fail('invalid-argument', 'Enter the event ID or page slug, or open your private ticket link.');
}

/** Phase 1 never releases 'scheduled' or 'manual' meeting links. */
function meetingLinkFor(
  program: Program,
  ticketTypeId: string,
  registration: RegistrationDoc,
  linkMap: Record<string, string>,
): string | undefined {
  const rule = settingsOf(program).linkReleaseDefaults[ticketTypeId]
    ?? (linkMap[ticketTypeId] as 'on_registration' | 'after_approval' | undefined);
  if (!rule || !PHASE1_LINK_RULES.includes(rule as (typeof PHASE1_LINK_RULES)[number])) return undefined;
  const rejected = registration.status === 'rejected' || registration.status === 'cancelled';
  if (rejected) return undefined;
  if (rule === 'after_approval' && registration.status !== 'verified' && !registration.meetingLinkReleasedAt) {
    return undefined;
  }
  // Both 'direct' and 'join_button' use the same trusted URL; display differs in the UI only.
  return linkMap[ticketTypeId];
}

export const lookupTicket = onCall({ region: REGION, cors: [ALLOWED_ORIGIN] }, async (request) => {
  const input = parseInput(lookupInputSchema, request.data);
  const ip = requestIp(request);
  await consumeRateLimit('lookupTicket', `${ip}:${input.identifier}`);
  if (!(await verifyCaptcha(input.captchaToken, ip))) {
    fail('permission-denied', 'CAPTCHA verification failed. Please try again.');
  }
  const code = input.ticketCode ?? (/^[A-Za-z0-9_-]{32}$/.test(input.identifier) ? input.identifier : undefined);
  const program = await resolveProgram(input.programId, code);
  const linkMap = settingsOf(program).meetingLinks ?? {};
  const results: Array<Record<string, unknown>> = [];
  if (code) {
    const ticket = (await firestore().doc(`tickets/${code}`).get()).data() as TicketDoc | undefined;
    if (ticket && ticket.programId === program.id) {
      const registration = (await firestore().doc(`programs/${program.id}/registrations/${ticket.registrationId}`).get()).data() as RegistrationDoc | undefined;
      if (registration && registration.status !== 'rejected' && registration.status !== 'cancelled') {
        const presentation = settingsOf(program);
        results.push({
          ticketCode: ticket.code,
          ticketTypeName: ticket.ticketTypeName,
          name: ticket.contactName,
          programTitle: ticket.programTitle ?? program.title,
          branding: program.branding,
          documentKind: presentation.documentKind,
          showAmountOnReceipt: presentation.showAmountOnReceipt === true,
          amountLabel: presentation.documentKind === 'receipt' && presentation.showAmountOnReceipt && registration?.payment
            ? `${(registration.payment.amountPaidPesewas / 100).toFixed(2)} GHS`
            : undefined,
          event: ticket.event,
          ...(registration ? { meetingLink: meetingLinkFor(program, ticket.ticketTypeId, registration, linkMap) } : {}),
        });
      }
    }
  } else {
    const email = /@/.test(input.identifier) ? hashIdentifier(input.identifier.trim().toLowerCase()) : undefined;
    const phone = normalizeGhanaPhone(input.identifier) ? hashIdentifier(normalizeGhanaPhone(input.identifier)!) : undefined;
    const keys = [email && `email_${email}`, phone && `phone_${phone}`, hashIdentifier(input.identifier.trim())].filter(Boolean) as string[];
    const seen = new Set<string>();
    for (const key of keys) {
      const snap = await firestore().collection(`programs/${program.id}/registrations`)
        .where('contact.duplicateKey', '==', key).limit(10).get();
      for (const doc of snap.docs) {
        if (seen.has(doc.id)) continue;
        seen.add(doc.id);
        const registration = doc.data() as RegistrationDoc;
        if (registration.status === 'rejected' || registration.status === 'cancelled') continue;
        const presentation = settingsOf(program);
        results.push({
          ticketCode: registration.ticketCode,
          ticketTypeName: registration.ticketTypeName,
          name: registration.contact.name,
          programTitle: program.title,
          branding: program.branding,
          documentKind: presentation.documentKind,
          showAmountOnReceipt: presentation.showAmountOnReceipt === true,
          amountLabel: presentation.documentKind === 'receipt' && presentation.showAmountOnReceipt && registration.payment
            ? `${(registration.payment.amountPaidPesewas / 100).toFixed(2)} GHS`
            : undefined,
          event: program.event,
          meetingLink: meetingLinkFor(program, registration.ticketTypeId, registration, linkMap),
        });
      }
      if (results.length >= 10) break;
    }
  }
  // Registration status, payment details and audit data are deliberately absent.
  return { found: results.length > 0, results };
});

export const verifyScannerAccess = onCall({ region: REGION, cors: [ALLOWED_ORIGIN] }, async (request) => {
  const input = parseInput(scannerInputSchema, request.data);
  await consumeRateLimit('verifyScannerAccess', `${requestIp(request)}:${input.programId}`);
  const program = await getProgram(input.programId);
  await enabledScanner(program, input.token, input.pin);
  return {
    programId: program.id,
    title: program.title,
    event: program.event,
    venue: program.event.venue,
    scannerTokenHash: scannerHash(input.token).slice(0, 12),
    // Echo the caller's own token so the door device can use it for later calls.
    scannerToken: input.token,
  };
});

/** Green = valid, amber = payment unverified, red = refused (no write). */
export const checkIn = onCall({ region: REGION, cors: [ALLOWED_ORIGIN] }, async (request) => {
  const input = parseInput(checkInSchema, request.data);
  const ip = requestIp(request);
  await consumeRateLimit('checkIn', `${ip}:${input.programId}`);
  const program = await getProgram(input.programId);
  await enabledScanner(program, input.scannerToken);

  const checkedInAt = nowIso();
  const outcome = await firestore().runTransaction(async (tx) => {
    const ticketSnap = await tx.get(firestore().doc(`tickets/${input.ticketCode}`));
    const ticket = ticketSnap.data() as TicketDoc | undefined;
    let registrationRefPath: string | undefined;
    if (ticket) {
      if (ticket.programId !== program.id) return { result: 'red' as const, reason: 'not_found' };
      registrationRefPath = `programs/${program.id}/registrations/${ticket.registrationId}`;
    } else {
      const query = firestore().collection(`programs/${program.id}/registrations`)
        .where('ticketCode', '==', input.ticketCode).limit(1);
      const querySnap = await tx.get(query);
      registrationRefPath = querySnap.docs[0]?.ref.path;
    }
    if (!registrationRefPath) return { result: 'red' as const, reason: 'not_found' };
    const registrationRef = firestore().doc(registrationRefPath);
    const regSnap = await tx.get(registrationRef);
    const registration = regSnap.data() as RegistrationDoc | undefined;
    if (!registration) return { result: 'red' as const, reason: 'not_found' };
    if (['rejected', 'cancelled'].includes(registration.status)) {
      return { result: 'red' as const, reason: registration.status };
    }
    if (registration.checkedInAt) {
      return { result: 'red' as const, reason: 'already_checked_in', checkedInAt: registration.checkedInAt };
    }

    // Free and instant tickets are verified at submission; paid post-approval
    // tickets stay amber at the door until an organizer approves them.
    const unverified = registration.ticketPricePesewas > 0 && registration.status !== 'verified';
    const result = unverified ? 'amber' : 'green';
    // Atomic: the guard above plus transaction retries prevent double check-in.
    tx.update(registrationRef, { checkedInAt, checkedInBy: `scanner:${scannerHash(input.scannerToken).slice(0, 12)}` });
    tx.update(firestore().doc(`programs/${program.id}`), checkedInUpdate(checkedInAt));
    return {
      result: result as 'green' | 'amber',
      name: registration.contact.name,
      ticketType: registration.ticketTypeName,
      ...(unverified && registration.payment ? {
        payment: {
          transactionId: registration.payment.transactionId,
          amountPesewas: registration.payment.amountPaidPesewas,
        },
      } : {}),
      checkedInAt,
    };
  });

  await firestore().collection(`programs/${program.id}/checkInLogs`).add({
    programId: program.id,
    ticketCodeHash: sha256(input.ticketCode),
    outcome: outcome.result,
    reason: 'reason' in outcome ? outcome.reason : undefined,
    at: checkedInAt,
    actor: `scanner:${scannerHash(input.scannerToken).slice(0, 12)}`,
  });
  await programAudit(program.id, {
    action: 'checkIn',
    actorRole: 'door_staff',
    at: checkedInAt,
    details: { outcome: outcome.result, ticketCodeHash: sha256(input.ticketCode) },
  });
  return outcome;
});

export const submitFeedback = onCall(
  { region: REGION, cors: [ALLOWED_ORIGIN], secrets: ['RECAPTCHA_SECRET_KEY'] },
  async (request) => {
    const input = parseInput(feedbackInputSchema, request.data);
    const ip = requestIp(request);
    await consumeRateLimit('submitFeedback', ip);
    if (!(await verifyCaptcha(input.captchaToken, ip))) {
      fail('permission-denied', 'CAPTCHA verification failed. Please try again.');
    }
    const program = await getProgram(input.programId);
    if (!settingsOf(program).feedbackEnabled) fail('failed-precondition', 'Feedback is closed for this programme.');
    if (input.ticketCode) {
      const ticket = (await firestore().doc(`tickets/${input.ticketCode}`).get()).data() as TicketDoc | undefined;
      if (!ticket || ticket.programId !== program.id) fail('invalid-argument', 'Ticket not found.');
    }
    const id = newId();
    await firestore().doc(`programs/${program.id}/feedback/${id}`).set({
      id,
      programId: program.id,
      answers: input.answers as Record<string, AnswerValue>,
      rating: input.rating,
      ticketCodeHash: input.ticketCode ? sha256(input.ticketCode) : undefined,
      createdAt: nowIso(),
    });
    await programAudit(program.id, { action: 'feedback.submitted', targetId: id, actorRole: 'public' });
    return { ok: true, feedbackId: id };
  },
);

export const reportEvent = onCall({ region: REGION, cors: [ALLOWED_ORIGIN] }, async (request) => {
  const input = parseInput(reportInputSchema, request.data);
  await consumeRateLimit('reportEvent', requestIp(request));
  await getProgram(input.programId); // reject reports against unknown programmes
  const id = newId();
  // Keys restricted to the allowlist in firestore.rules.
  await firestore().doc(`reports/${id}`).set({
    programId: input.programId,
    reason: input.reason,
    details: input.details,
    contact: input.contact ?? '',
    status: 'open',
    createdAt: nowIso(),
  });
  await audit({ action: 'report.created', actorRole: 'public', targetId: id, programId: input.programId });
  return { ok: true, reportId: id };
});

/** Separate callable so ticket lookups do not mutate anything. */
export const recordJoinClick = onCall({ region: REGION, cors: [ALLOWED_ORIGIN] }, async (request) => {
  const input = parseInput(joinClickSchema, request.data);
  const ticket = (await firestore().doc(`tickets/${input.ticketCode}`).get()).data() as TicketDoc | undefined;
  if (!ticket || ticket.programId !== input.programId) fail('invalid-argument', 'Ticket not found.');
  await firestore().doc(`programs/${input.programId}/joinClicks/${randomToken(12)}`).set({
    programId: input.programId,
    ticketCodeHash: sha256(input.ticketCode),
    at: nowIso(),
  });
  return { ok: true };
});
