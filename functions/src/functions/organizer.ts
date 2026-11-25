/** Organizer/helper operations. Ownership or accepted membership is always verified. */
import { FieldValue } from 'firebase-admin/firestore';
import type { RegistrationStatus } from '@yivents/shared';
import { onCall } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { ALLOWED_ORIGIN, MAX_BULK_IDS, REGION } from '../config';
import { capacityDelta, counterUpdates, statusToSlot } from '../capacity';
import { requireAuth, requireProgramAccess, requireProgramOwner } from '../authz';
import { fail } from '../errors';
import { firestore } from '../firebase';
import { computePaymentTotals, parseInput, validateDeadline } from '../validation';
import { nowIso, programAudit, randomToken, scannerHash, settingsOf } from '../utils';
import type { RegistrationDoc, ScannerDoc } from '../types';

/** The organizer UI may send singular/`ids` aliases; normalise before validation. */
const idsSchema = z.preprocess((raw) => {
  if (raw && typeof raw === 'object') {
    const value = raw as Record<string, unknown>;
    if (!value.registrationIds && Array.isArray(value.ids)) value.registrationIds = value.ids;
    if (!value.registrationIds && typeof value.registrationId === 'string') value.registrationIds = [value.registrationId];
  }
  return raw;
}, z.object({
  programId: z.string().min(1),
  registrationIds: z.array(z.string().min(1)).min(1).max(MAX_BULK_IDS),
}));
const programOnlySchema = z.object({ programId: z.string().min(1) });
const scannerToggleSchema = programOnlySchema.extend({ enabled: z.boolean() });
const deadlineSchema = z.preprocess((raw) => {
  if (raw && typeof raw === 'object') {
    const value = raw as Record<string, unknown>;
    if (!value.deadline && typeof value.newDeadline === 'string') value.deadline = value.newDeadline;
    if (!value.deadline && typeof value.registrationDeadline === 'string') value.deadline = value.registrationDeadline;
  }
  return raw;
}, programOnlySchema.extend({
  deadline: z.string().min(1),
  reason: z.string().trim().max(300).optional(),
}));
const expectedSchema = programOnlySchema.extend({ amountPesewas: z.number().int().nonnegative() });
const reassignSchema = z.preprocess((raw) => {
  if (raw && typeof raw === 'object') {
    const value = raw as Record<string, unknown>;
    if (!value.fromRegistrationId && typeof value.registrationId === 'string') value.fromRegistrationId = value.registrationId;
  }
  return raw;
}, programOnlySchema.extend({
  fromRegistrationId: z.string().min(1),
  toRegistrationId: z.string().min(1),
}));
const inviteSchema = programOnlySchema.extend({ email: z.string().trim().email().optional() });
const acceptInviteSchema = programOnlySchema.extend({ token: z.string().min(10) });
const ticketStatusFor: Record<string, 'valid' | 'pending_approval' | 'invalid' | 'cancelled'> = {
  verified: 'valid',
  pending: 'pending_approval',
  waitlisted: 'pending_approval',
  rejected: 'invalid',
  cancelled: 'cancelled',
};

/** One transaction for all registrations: counters are accumulated before writing. */
async function changeStatuses(
  uid: string,
  input: z.infer<typeof idsSchema>,
  nextStatus: RegistrationStatus,
  action: string,
  allowHelper = true,
): Promise<{ updated: number }> {
  const program = await requireProgramAccess(uid, input.programId, allowHelper);
  const ids = Array.from(new Set(input.registrationIds));
  const at = nowIso();
  const programRef = firestore().doc(`programs/${program.id}`);
  let totalPending = 0;
  let totalConfirmed = 0;
  const perType = new Map<string, number>();
  const touched: string[] = [];

  await firestore().runTransaction(async (tx) => {
    for (const id of ids) {
      const ref = firestore().doc(`programs/${program.id}/registrations/${id}`);
      const snap = await tx.get(ref);
      if (!snap.exists) continue;
      const registration = snap.data() as RegistrationDoc;
      const delta = capacityDelta(statusToSlot(registration.status), statusToSlot(nextStatus));
      totalPending += delta.pending;
      totalConfirmed += delta.confirmed;
      perType.set(registration.ticketTypeId, (perType.get(registration.ticketTypeId) ?? 0) + delta.taken);
      touched.push(id);

      tx.update(ref, {
        status: nextStatus,
        updatedAt: at,
        updatedBy: uid,
        ...(nextStatus === 'verified' ? { verifiedAt: at } : {}),
        ...(registration.payment ? {
          payment: {
            ...registration.payment,
            verified: nextStatus === 'verified',
            verificationStatus: nextStatus === 'verified' ? 'verified' : 'unverified',
          },
        } : {}),
      });
      const ticketRef = firestore().doc(`tickets/${registration.ticketCode}`);
      if ((await tx.get(ticketRef)).exists) {
        tx.update(ticketRef, { internalStatus: ticketStatusFor[nextStatus] ?? 'pending_approval' });
      }

      if (nextStatus === 'rejected' || nextStatus === 'cancelled') {
        // Release claims so a corrected payment/contact can be resubmitted.
        if (registration.payment) {
          const claimRef = firestore().doc(
            `programs/${program.id}/transactionClaims/${registration.payment.transactionId.trim().toLowerCase()}`,
          );
          const claim = await tx.get(claimRef);
          if (claim.exists && claim.data()?.registrationId === id) tx.delete(claimRef);
        }
        if (registration.contact.duplicateKey) {
          const dupRef = firestore().doc(`programs/${program.id}/duplicateClaims/${registration.contact.duplicateKey}`);
          const dup = await tx.get(dupRef);
          if (dup.exists && dup.data()?.registrationId === id) tx.delete(dupRef);
        }
      }
    }
    if (totalPending !== 0 || totalConfirmed !== 0) {
      tx.update(programRef, counterUpdates({ pending: totalPending, confirmed: totalConfirmed, taken: 0 }));
    }
    for (const [ticketTypeId, taken] of perType) {
      if (taken === 0) continue;
      tx.set(
        firestore().doc(`programs/${program.id}/capacityCounters/${ticketTypeId}`),
        { programId: program.id, ticketTypeId, taken: FieldValue.increment(taken), updatedAt: at },
        { merge: true },
      );
    }
  });

  await programAudit(program.id, { action, actorUid: uid, actorRole: 'organizer', targetId: ids.join(','), details: { updated: touched.length, status: nextStatus } });
  return { updated: touched.length };
}

export const approveRegistrations = onCall({ region: REGION, cors: [ALLOWED_ORIGIN] }, async (request) => {
  const input = parseInput(idsSchema, request.data);
  const { uid } = requireAuth(request);
  return changeStatuses(uid, input, 'verified', 'registrations.approved');
});

export const rejectRegistrations = onCall({ region: REGION, cors: [ALLOWED_ORIGIN] }, async (request) => {
  const input = parseInput(idsSchema, request.data);
  const { uid } = requireAuth(request);
  return changeStatuses(uid, input, 'rejected', 'registrations.rejected');
});

export const cancelRegistration = onCall({ region: REGION, cors: [ALLOWED_ORIGIN] }, async (request) => {
  const input = parseInput(idsSchema, request.data);
  const { uid } = requireAuth(request);
  return changeStatuses(uid, input, 'cancelled', 'registration.cancelled', false);
});

export const reassignTransaction = onCall({ region: REGION, cors: [ALLOWED_ORIGIN] }, async (request) => {
  const input = parseInput(reassignSchema, request.data);
  const { uid } = requireAuth(request);
  const program = await requireProgramOwner(uid, input.programId);
  if (input.fromRegistrationId === input.toRegistrationId) fail('invalid-argument', 'Choose two different registrations.');

  await firestore().runTransaction(async (tx) => {
    const fromRef = firestore().doc(`programs/${program.id}/registrations/${input.fromRegistrationId}`);
    const toRef = firestore().doc(`programs/${program.id}/registrations/${input.toRegistrationId}`);
    const from = (await tx.get(fromRef)).data() as RegistrationDoc | undefined;
    const to = (await tx.get(toRef)).data() as RegistrationDoc | undefined;
    if (!from?.payment || !to) fail('not-found', 'Both registrations and a payment record are required.');
    if (to.payment) fail('failed-precondition', 'The destination registration already has a payment.');
    if (['rejected', 'cancelled'].includes(to.status)) fail('failed-precondition', 'The destination registration is closed.');

    const totals = computePaymentTotals(to.ticketPricePesewas, from.payment.amountPaidPesewas, settingsOf(program));
    const moved = {
      ...from.payment,
      ticketPricePesewas: to.ticketPricePesewas,
      ...totals,
      verified: false,
      verificationStatus: 'unverified' as const,
    };
    tx.update(fromRef, {
      payment: FieldValue.delete(),
      flagged: true,
      flagReasons: FieldValue.arrayUnion('Transaction reassigned to another registration.'),
      updatedAt: nowIso(),
      updatedBy: uid,
    });
    tx.update(toRef, { payment: moved, updatedAt: nowIso(), updatedBy: uid });

    // Overwrite the single claim doc: transaction IDs stay globally unique.
    tx.set(
      firestore().doc(`programs/${program.id}/transactionClaims/${moved.transactionId.trim().toLowerCase()}`),
      { registrationId: to.id, programId: program.id, updatedAt: nowIso() },
      { merge: true },
    );
  });
  await programAudit(program.id, {
    action: 'transaction.reassigned', actorUid: uid, actorRole: 'organizer',
    targetId: input.toRegistrationId,
    details: { from: input.fromRegistrationId },
  });
  return { ok: true };
});

export const extendDeadline = onCall({ region: REGION, cors: [ALLOWED_ORIGIN] }, async (request) => {
  const input = parseInput(deadlineSchema, request.data);
  const { uid } = requireAuth(request);
  const program = await requireProgramOwner(uid, input.programId);
  const deadline = validateDeadline(input.deadline, program);
  const change = {
    from: program.registrationDeadline, to: deadline, by: uid, at: nowIso(),
    ...(input.reason ? { reason: input.reason } : {}),
  };
  await firestore().doc(`programs/${program.id}`).update({
    registrationDeadline: deadline,
    deadlineChanges: FieldValue.arrayUnion(change),
    updatedAt: change.at,
  });
  await programAudit(program.id, { action: 'deadline.extended', actorUid: uid, actorRole: 'organizer', details: change });
  return { ok: true, registrationDeadline: deadline };
});

export const recordExpectedReceived = onCall({ region: REGION, cors: [ALLOWED_ORIGIN] }, async (request) => {
  const input = parseInput(expectedSchema, request.data);
  const { uid } = requireAuth(request);
  const program = await requireProgramOwner(uid, input.programId);
  await firestore().doc(`programs/${program.id}`).update({ expectedReceivedPesewas: input.amountPesewas, updatedAt: nowIso() });
  await programAudit(program.id, {
    action: 'expectedReceived.recorded', actorUid: uid, actorRole: 'organizer',
    details: { amountPesewas: input.amountPesewas, previous: program.expectedReceivedPesewas ?? null },
  });
  return { ok: true };
});

export const markUnpaid = onCall({ region: REGION, cors: [ALLOWED_ORIGIN] }, async (request) => {
  const input = parseInput(idsSchema, request.data);
  const { uid } = requireAuth(request);
  const program = await requireProgramOwner(uid, input.programId);
  const recipients: Array<{ name: string; email: string }> = [];
  const at = nowIso();
  await firestore().runTransaction(async (tx) => {
    for (const id of new Set(input.registrationIds)) {
      const ref = firestore().doc(`programs/${program.id}/registrations/${id}`);
      const snap = await tx.get(ref);
      if (!snap.exists) continue;
      const registration = snap.data() as RegistrationDoc;
      if (!registration.payment) continue;
      tx.update(ref, {
        payment: { ...registration.payment, verified: false, verificationStatus: 'unpaid' },
        flagged: true,
        flagReasons: FieldValue.arrayUnion('Marked unpaid by organizer.'),
        updatedAt: at,
        updatedBy: uid,
      });
      if (registration.contact.email) recipients.push({ name: registration.contact.name, email: registration.contact.email });
    }
  });
  await programAudit(program.id, { action: 'payments.markedUnpaid', actorUid: uid, actorRole: 'organizer', targetId: input.registrationIds.join(',') });
  // Read-only recipient data for the organizer's own mailto batching.
  return { updated: recipients.length, recipients };
});

export const generateScannerCredentials = onCall({ region: REGION, cors: [ALLOWED_ORIGIN] }, async (request) => {
  const input = parseInput(programOnlySchema, request.data);
  const { uid } = requireAuth(request);
  const program = await requireProgramOwner(uid, input.programId);
  const token = randomToken(32);
  const pin = String(Math.floor(100000 + Math.random() * 900000));
  const at = nowIso();
  const scanner: ScannerDoc = { tokenHash: scannerHash(token), pinHash: scannerHash(pin), enabled: true, createdAt: at };
  await firestore().doc(`programs/${program.id}/scanner`).set(scanner);
  await firestore().doc(`programs/${program.id}`).update({ scannerEnabled: true, scannerPinHash: scanner.pinHash, updatedAt: at });
  await programAudit(program.id, { action: 'scanner.credentialsGenerated', actorUid: uid, actorRole: 'organizer', details: { tokenPrefix: token.slice(0, 6) } });
  // Shown once; only hashes are stored. The link carries the capability token.
  const scannerUrl = `${ALLOWED_ORIGIN}/scanner/${program.id}?token=${encodeURIComponent(token)}`;
  return { token, pin, url: scannerUrl, scannerUrl, link: scannerUrl };
});

export const toggleScanner = onCall({ region: REGION, cors: [ALLOWED_ORIGIN] }, async (request) => {
  const input = parseInput(scannerToggleSchema, request.data);
  const { uid } = requireAuth(request);
  const program = await requireProgramOwner(uid, input.programId);
  const at = nowIso();
  await firestore().doc(`programs/${program.id}`).update({ scannerEnabled: input.enabled, updatedAt: at });
  const scannerRef = firestore().doc(`programs/${program.id}/scanner`);
  const existing = (await scannerRef.get()).data() as ScannerDoc | undefined;
  if (existing) await scannerRef.update({ enabled: input.enabled, updatedAt: at });
  await programAudit(program.id, { action: 'scanner.toggled', actorUid: uid, actorRole: 'organizer', details: { enabled: input.enabled } });
  return { ok: true, scannerEnabled: input.enabled };
});

export const inviteHelper = onCall({ region: REGION, cors: [ALLOWED_ORIGIN] }, async (request) => {
  const input = parseInput(inviteSchema, request.data);
  const { uid } = requireAuth(request);
  await requireProgramOwner(uid, input.programId);
  const token = randomToken(24);
  const expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000;
  await firestore().doc(`programs/${input.programId}/helperInvites/${scannerHash(token)}`).set({
    programId: input.programId,
    email: input.email?.toLowerCase(),
    invitedBy: uid,
    expiresAt,
    createdAt: nowIso(),
  });
  await programAudit(input.programId, { action: 'helper.invited', actorUid: uid, actorRole: 'organizer', details: { email: input.email ?? null } });
  return { token, expiresAt };
});

export const acceptHelperInvite = onCall({ region: REGION, cors: [ALLOWED_ORIGIN] }, async (request) => {
  const input = parseInput(acceptInviteSchema, request.data);
  const identity = requireAuth(request);
  const uid = identity.uid;
  const email = String(identity.token.email ?? '').toLowerCase();
  const inviteRef = firestore().doc(`programs/${input.programId}/helperInvites/${scannerHash(input.token)}`);
  const invite = (await inviteRef.get()).data() as { email?: string; expiresAt: number; invitedBy: string } | undefined;
  if (!invite) fail('not-found', 'Invitation not found.');
  if (invite.expiresAt <= Date.now()) fail('failed-precondition', 'This invitation has expired.');
  if (invite.email && invite.email !== email) fail('permission-denied', 'This invitation was issued for a different email address.');
  await firestore().doc(`programs/${input.programId}/helpers/${uid}`).set({
    uid,
    email,
    role: 'helper',
    status: 'active',
    invitedBy: invite.invitedBy,
    acceptedAt: nowIso(),
  });
  await inviteRef.delete(); // single use
  await programAudit(input.programId, { action: 'helper.accepted', actorUid: uid, actorRole: 'helper' });
  return { ok: true, programId: input.programId };
});

