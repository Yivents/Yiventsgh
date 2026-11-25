/** Public registration submission: all trust decisions happen here. */
import { FieldValue } from 'firebase-admin/firestore';
import {
  normalizeGhanaPhone,
  hashIdentifier,
  registrationSubmissionSchema,
  type FormField,
  type PaymentMethod,
  type Program,
  type TicketType,
} from '@yivents/shared';
import { onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/logger';
import { ALLOWED_ORIGIN, REGION } from '../config';
import { assertCapacityAvailable, capacityDelta, counterUpdates } from '../capacity';
import { fail } from '../errors';
import { firestore } from '../firebase';
import { getProgram } from '../authz';
import {
  newId,
  newTicketCode,
  nowIso,
  programAudit,
  requestIp,
  consumeRateLimit,
  verifyCaptcha,
} from '../utils';
import {
  parseInput,
  paymentRecord,
  requirePaymentMethod,
  validateAnswers,
  type AnswerValue,
} from '../validation';
import {
  settingsOf,
  type PaymentRecordExtras,
  type RegistrationDoc,
  type TicketDoc,
  type TicketInternalStatus,
} from '../types';

async function loadCollection<T>(path: string): Promise<T[]> {
  const snap = await firestore().collection(path).get();
  return snap.docs.map((doc) => ({ ...(doc.data() as T), id: doc.id }));
}

/** Free / MoMo / bank rules decide whether the ticket is valid immediately. */
function isInstantTicket(
  program: Program,
  ticketType: TicketType,
  method: PaymentMethod | undefined,
  free: boolean,
): boolean {
  const settings = settingsOf(program);
  if (ticketType.instantTicket === false) return false;
  if (free) return settings.instantTicketFree === true;
  if (!method) return false;
  if (method.type === 'bank') {
    return settings.bankInstantTicket === true && method.bankInstantTicket !== false;
  }
  return settings.instantTicketPaid === true;
}

export const submitRegistration = onCall(
  { region: REGION, cors: [ALLOWED_ORIGIN], secrets: ['RECAPTCHA_SECRET_KEY'] },
  async (request) => {
    const input = parseInput(registrationSubmissionSchema, request.data);
    const ip = requestIp(request);
    await consumeRateLimit('submitRegistration', ip);
    if (!(await verifyCaptcha(input.captchaToken, ip))) {
      fail('permission-denied', 'CAPTCHA verification failed. Please try again.');
    }

    const program = await getProgram(input.programId);
    if (!['upcoming', 'ongoing'].includes(program.status)) fail('failed-precondition', 'Registration is not open for this programme.');
    if (Date.parse(program.registrationDeadline) <= Date.now()) {
      fail('failed-precondition', 'The registration deadline has passed.');
    }
    const settings = settingsOf(program);

    const ticketTypes = await loadCollection<TicketType>(`programs/${program.id}/ticketTypes`);
    const ticketType = ticketTypes.find((t) => t.id === input.ticketTypeId && t.active);
    if (!ticketType) fail('invalid-argument', 'That ticket type is not available.');

    const fields = await loadCollection<FormField>(`programs/${program.id}/formFields`);
    const { answers, flagReasons } = validateAnswers(fields, input.answers as Record<string, AnswerValue>);

    const email = input.contact.email?.trim().toLowerCase() || undefined;
    const phone = input.contact.phone ? normalizeGhanaPhone(input.contact.phone) ?? undefined : undefined;
    if (!email && !phone) fail('invalid-argument', 'Provide an email address or a Ghana phone number.');

    const methods = await loadCollection<PaymentMethod>(`programs/${program.id}/paymentMethods`);
    const free = ticketType.pricePesewas <= 0;
    let method: PaymentMethod | undefined;
    let payment: PaymentRecordExtras | undefined;
    if (free) {
      // Free tickets skip payment entirely — do not create a payment claim.
      if (input.payment) logger.info('Ignoring payment details supplied for a free ticket.');
    } else {
      if (!input.payment) fail('invalid-argument', 'Payment details are required for this ticket.');
      method = requirePaymentMethod(input.payment.methodId, methods);
      payment = paymentRecord(method, input.payment, ticketType.pricePesewas, program);
      if (payment.overByPesewas > 0) flagReasons.push('Payment above the ticket price.');
      if (payment.shortByPesewas > 0) flagReasons.push('Payment below the ticket price.');
      if (typeof input.payment.screenshotToken === 'string'
        && /^uploads\/(?:anonymous\/[A-Za-z0-9_-]{20,}|[A-Za-z0-9_-]{20,})\/[A-Za-z0-9._/-]+$/.test(input.payment.screenshotToken)) {
        payment.screenshotPath = input.payment.screenshotToken;
      }
    }

    const instant = isInstantTicket(program, ticketType, method, free);
    const initialStatus: RegistrationDoc['status'] = instant ? 'verified' : 'pending';
    const ticketInternalStatus: TicketInternalStatus = instant ? 'valid' : 'pending_approval';
    const registrationId = newId();
    const code = newTicketCode();
    const createdAt = nowIso();

    const phoneHash = phone ? hashIdentifier(phone) : undefined;
    const emailHash = email ? hashIdentifier(email) : undefined;
    const duplicateKey = phoneHash ? `phone_${phoneHash}` : emailHash ? `email_${emailHash}` : undefined;

    const programRef = firestore().doc(`programs/${program.id}`);
    const registrationRef = firestore().doc(`programs/${program.id}/registrations/${registrationId}`);
    const ticketRef = firestore().doc(`tickets/${code}`);
    const counterRef = firestore().doc(`programs/${program.id}/capacityCounters/${ticketType.id}`);

    await firestore().runTransaction(async (tx) => {
      // Re-read inside the transaction so capacity can never oversell.
      const snap = await tx.get(programRef);
      if (!snap.exists) fail('not-found', 'Programme not found.');
      const fresh = snap.data() as Program;
      if (!['upcoming', 'ongoing'].includes(fresh.status) || Date.parse(fresh.registrationDeadline) <= Date.now()) {
        fail('failed-precondition', 'Registration is no longer open.');
      }
      const counterSnap = await tx.get(counterRef);
      const taken = Number(counterSnap.data()?.taken ?? 0);
      assertCapacityAvailable(fresh, taken, ticketType.id, ticketType);

      const runtimeFlags: string[] = [];
      if (payment) {
        // One claim doc per transaction ID across ALL registrations of the programme.
        const txnKey = payment.transactionId.trim().toLowerCase();
        const claimRef = firestore().doc(`programs/${program.id}/transactionClaims/${txnKey}`);
        const claim = await tx.get(claimRef);
        if (claim.exists && claim.data()?.registrationId !== registrationId) {
          fail('already-exists', 'This transaction ID has already been claimed.');
        }
        if (!claim.exists) {
          tx.set(claimRef, { registrationId, programId: program.id, createdAt });
        }
      }

      if (settings.duplicateRule !== 'off') {
        const keys: string[] = [];
        if ((settings.duplicateRule === 'phone' || settings.duplicateRule === 'phone_or_email') && phoneHash) {
          keys.push(`phone_${phoneHash}`);
        }
        if ((settings.duplicateRule === 'email' || settings.duplicateRule === 'phone_or_email') && emailHash) {
          keys.push(`email_${emailHash}`);
        }
        for (const key of keys) {
          const dupRef = firestore().doc(`programs/${program.id}/duplicateClaims/${key}`);
          const existing = await tx.get(dupRef);
          if (existing.exists && !settings.allowMultiplePerContact) {
            fail('already-exists', 'You already have a registration for this programme.');
          }
          if (existing.exists) runtimeFlags.push('Possible duplicate contact.');
          else tx.set(dupRef, { registrationId, programId: program.id, createdAt });
        }
      }
      const registration: RegistrationDoc = {
        id: registrationId,
        programId: program.id,
        ticketCode: code,
        ticketTypeId: ticketType.id,
        ticketTypeName: ticketType.name,
        ticketPricePesewas: ticketType.pricePesewas,
        currency: ticketType.currency,
        status: initialStatus,
        flagged: flagReasons.length + runtimeFlags.length > 0,
        flagReasons: [...flagReasons, ...runtimeFlags],
        answers,
        contact: { name: input.contact.name.trim(), email, phone, phoneHash, emailHash, duplicateKey },
        ...(payment ? { payment } : {}),
        ...(instant ? { verifiedAt: createdAt } : {}),
        createdAt,
      };
      const ticket: TicketDoc = {
        code,
        programId: program.id,
        programTitle: fresh.title,
        registrationId,
        ticketTypeId: ticketType.id,
        ticketTypeName: ticketType.name,
        internalStatus: ticketInternalStatus,
        contactName: input.contact.name.trim(),
        event: fresh.event,
        createdAt,
      };

      tx.set(registrationRef, registration);
      tx.set(ticketRef, ticket);
      const delta = capacityDelta('none', initialStatus === 'verified' ? 'verified' : 'pending');
      tx.update(programRef, counterUpdates(delta));
      tx.set(counterRef, { programId: program.id, ticketTypeId: ticketType.id, taken: FieldValue.increment(1), updatedAt: createdAt }, { merge: true });
    });

    // Tracks the private screenshot so the daily lifecycle job can delete it
    // after the configured retention period. No payment values are stored here.
    if (payment?.screenshotPath) {
      await firestore().doc(`screenshots/${registrationId}`).set({
        path: payment.screenshotPath,
        programId: program.id,
        registrationId,
        createdAt,
      });
    }

    await programAudit(program.id, {
      action: 'registration.submitted',
      targetId: registrationId,
      actorRole: 'public',
      details: { ticketTypeId: ticketType.id, status: initialStatus, flagged: flagReasons.length > 0, codeIssued: true },
    });

    return {
      registrationId,
      ticketCode: code,
      message: instant
        ? 'Your ticket is ready.'
        : 'Registration received. Your ticket will be issued after approval.',
    };
  },
);
