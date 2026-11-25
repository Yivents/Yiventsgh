/** Firestore/Storage/Auth triggers. Projections never contain registrant data. */
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { onObjectFinalized } from 'firebase-functions/v2/storage';
import { onUserCreated } from 'firebase-functions/v2/identity';
import {
  isAlmostFull,
  searchTokens,
  type FormField,
  type PaymentMethod,
  type PlatformSettings,
  type Program,
  type PublicListing,
  type PublicProgram,
  type TicketSummary,
} from '@yivents/shared';
import { REGION } from '../config';
import { bucket, firestore } from '../firebase';
import { audit, newId, nowIso } from '../utils';
import { settingsOf, type ProgramSettingsExtras, type RegistrationDoc } from '../types';
import { capacityLimits } from '../capacity';

const options = { region: REGION };

/**
 * Rebuild the safe public projection for a programme. Form definitions and
 * enabled payment methods are public-safe; answers, screenshots, statuses,
 * meeting links and ticket codes are never copied.
 */
async function writeProjections(programId: string, previousSlug?: string): Promise<void> {
  const program = (await firestore().doc(`programs/${programId}`).get()).data() as Program | undefined;

  if (previousSlug && previousSlug !== program?.slug) {
    await firestore().doc(`publicPrograms/${previousSlug}`).delete();
  }
  if (!program) {
    await firestore().doc(`publicListings/${programId}`).delete();
    return;
  }

  const ticketDocs = (await firestore().collection(`programs/${programId}/ticketTypes`).get()).docs
    .map((doc) => ({ ...(doc.data() as TicketSummary & { active?: boolean }), id: doc.id }))
    .filter((ticket) => ticket.active !== false);
  const formFields = (await firestore().collection(`programs/${programId}/formFields`).orderBy('order').get()).docs
    .map((doc) => ({ ...(doc.data() as FormField), id: doc.id }));
  const paymentMethods = (await firestore().collection(`programs/${programId}/paymentMethods`).orderBy('order').get()).docs
    .map((doc) => ({ ...(doc.data() as PaymentMethod), id: doc.id }))
    .filter((method) => method.enabled !== false);
  const platform = (await firestore().doc('settings/platform').get()).data() as PlatformSettings | undefined;
  const settings: ProgramSettingsExtras = settingsOf(program);
  const taken = (program.counters.confirmed ?? 0) + (program.counters.pending ?? 0);
  const { overall, threshold } = capacityLimits(program, '', undefined);
  const deadlineMs = Date.parse(program.registrationDeadline);

  const projection: PublicProgram = {
    programId,
    slug: program.slug,
    title: program.title,
    description: program.description,
    imagePaths: program.slideshow ?? [],
    event: program.event,
    registrationDeadline: program.registrationDeadline,
    branding: program.branding,
    ticketTypes: ticketDocs.map(({ id, name, pricePesewas, currency }) => ({ id, name, pricePesewas, currency })),
    formFields,
    paymentMethods,
    paymentInstructions: settings.paymentInstructions,
    plan: 'free',
    speakers: program.speakers ?? [],
    sponsors: program.sponsors ?? [],
    capacityState: {
      total: overall,
      taken,
      almostFull: isAlmostFull(taken, overall, threshold),
      full: overall !== undefined && taken >= overall,
    },
    status: program.status,
    hasFeedbackForm: settings.feedbackEnabled === true,
    registrationOpen: ['upcoming', 'ongoing'].includes(program.status)
      && program.approvalStatus !== 'rejected'
      && Number.isFinite(deadlineMs)
      && deadlineMs > Date.now()
      && !(overall !== undefined && taken >= overall),
    privacyNotice: platform?.legalVersions?.registrantNotice ?? '',
  };
  await firestore().doc(`publicPrograms/${program.slug}`).set(projection);

  const listed = program.visibility === 'public'
    && program.approvalStatus === 'approved'
    && ['upcoming', 'ongoing'].includes(program.status);
  if (!listed) {
    await firestore().doc(`publicListings/${programId}`).delete();
    return;
  }
  const existing = (await firestore().doc(`publicListings/${programId}`).get()).data() as PublicListing | undefined;
  const listing: PublicListing = {
    programId,
    slug: program.slug,
    title: program.title,
    summary: program.description.slice(0, 240),
    coverPath: program.slideshow?.[0],
    startAt: program.event.startAt,
    endAt: program.event.endAt,
    venue: program.event.venue,
    mode: program.event.mode,
    searchTokens: searchTokens(`${program.title} ${program.event.venue ?? ''}`),
    approvalStatus: program.approvalStatus,
    status: program.status,
    listedAt: existing?.listedAt ?? nowIso(),
  };
  await firestore().doc(`publicListings/${programId}`).set(listing);
}

export const syncPublicProjections = onDocumentWritten('programs/{programId}', options, async (event) => {
  await writeProjections(
    event.params.programId as string,
    event.data?.before?.exists ? (event.data.before.data() as Program).slug : undefined,
  );
});

/** Form and ticket edits must reach the public page without a full rebuild. */
export const syncPublicFormFields = onDocumentWritten('programs/{programId}/formFields/{fieldId}', options, async (event) => {
  await writeProjections(event.params.programId as string);
});

export const syncPublicTicketTypes = onDocumentWritten('programs/{programId}/ticketTypes/{ticketTypeId}', options, async (event) => {
  await writeProjections(event.params.programId as string);
});

export const syncPublicPaymentMethods = onDocumentWritten('programs/{programId}/paymentMethods/{methodId}', options, async (event) => {
  await writeProjections(event.params.programId as string);
});

/** Storage rules check MIME too; this deletes objects that bypassed the client. */
export const validateUpload = onObjectFinalized(options, async (object) => {
  const name = object.name;
  if (!name || !name.startsWith('uploads/')) return; // e.g. generated XLSX exports
  const contentType = object.contentType ?? '';
  const size = object.size ?? 0;
  const image = /^image\/(jpeg|png|webp|gif)$/.test(contentType);
  const video = contentType === 'video/mp4';
  const ceiling = video ? 8 * 1024 * 1024 : 6 * 1024 * 1024;
  if ((image || video) && size > 0 && size <= ceiling) return;
  await bucket().file(name).delete().catch(() => undefined);
  await audit({
    action: 'upload.rejected',
    actorRole: 'system',
    targetId: newId(),
    details: { path: name, contentType, size, reason: !image && !video ? 'unsupported MIME type' : 'invalid size' },
  });
});

/** Record only changed field names — never raw answers or payment values. */
export const logRegistrationChanges = onDocumentWritten(
  'programs/{programId}/registrations/{registrationId}',
  options,
  async (event) => {
    const before = event.data?.before?.exists ? event.data.before.data() : undefined;
    const after = event.data?.after?.exists ? event.data.after.data() : undefined;
    if (!before && !after) return;
    const keys = Array.from(new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]));
    const changed = keys.filter((key) => JSON.stringify(before?.[key]) !== JSON.stringify(after?.[key]));
    if (!changed.length) return;
    await firestore().collection(`programs/${event.params.programId}/auditLogs`).add({
      action: before ? 'registration.changed' : 'registration.created',
      programId: event.params.programId,
      targetId: event.params.registrationId,
      actorUid: (after as RegistrationDoc | undefined)?.updatedBy ?? null,
      at: nowIso(),
      details: { changedFields: changed },
    });
  },
);

export const onUserCreate = onUserCreated(options, async (user) => {
  const at = nowIso();
  const platform = (await firestore().doc('settings/platform').get()).data() as PlatformSettings | undefined;
  await firestore().doc(`users/${user.uid}`).set({
    uid: user.uid,
    email: user.email ?? '',
    displayName: user.displayName ?? user.email?.split('@')[0] ?? 'Organizer',
    photoURL: user.photoURL ?? undefined,
    phone: user.phoneNumber ?? undefined,
    accountType: 'organizer',
    status: 'active',
    verifiedBadge: false,
    acceptedLegal: {
      termsVersion: platform?.legalVersions?.terms ?? '1',
      privacyVersion: platform?.legalVersions?.privacy ?? '1',
      acceptedAt: '',
    },
    twoFactorEnabled: false,
    createdAt: at,
    updatedAt: at,
  }, { merge: true });
  await audit({ action: 'user.created', actorUid: user.uid, actorRole: 'system', targetId: user.uid });
});
