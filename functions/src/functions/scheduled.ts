/** Daily/hourly lifecycle jobs. All writes use the Admin SDK (rules bypassed safely). */
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions/logger';
import {
  DEFAULT_ARCHIVE_AFTER_DAYS,
  DEFAULT_RETENTION_MONTHS,
  DEFAULT_SCREENSHOT_RETENTION_DAYS,
} from '@yivents/shared';
import { REGION } from '../config';
import { firestore, bucket } from '../firebase';
import { audit, newId, nowIso } from '../utils';
import { settingsOf, type Program, type RegistrationDoc } from '../types';

const DAY_MS = 24 * 60 * 60 * 1000;
const scheduleOptions = { region: REGION, timeZone: 'Africa/Accra', retries: 2 };

function chunk<T>(items: T[], size = 400): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size) result.push(items.slice(i, i + size));
  return result;
}

function archiveDays(program: Program): number {
  return settingsOf(program).archiveAfterDays || DEFAULT_ARCHIVE_AFTER_DAYS;
}

function retentionMonths(program: Program): number {
  return settingsOf(program).retentionMonths || DEFAULT_RETENTION_MONTHS;
}

export const rolloverProgramStatuses = onSchedule({ ...scheduleOptions, schedule: 'every 1 hour' }, async () => {
  const now = nowIso();
  const starting = await firestore().collection('programs').where('status', '==', 'upcoming').where('event.startAt', '<=', now).get();
  const ending = await firestore().collection('programs').where('status', '==', 'ongoing').where('event.endAt', '<=', now).get();
  const updates = [
    ...starting.docs.map((doc) => ({ ref: doc.ref, data: { status: 'ongoing', updatedAt: now } })),
    ...ending.docs.map((doc) => ({ ref: doc.ref, data: { status: 'ended', updatedAt: now } })),
  ];
  for (const group of chunk(updates)) {
    const batch = firestore().batch();
    group.forEach(({ ref, data }) => batch.update(ref, data));
    await batch.commit();
  }
  if (updates.length) logger.info(`Rollover complete: ${updates.length} programmes.`);
});

export const archiveWarnings = onSchedule({ ...scheduleOptions, schedule: 'every day 08:00' }, async () => {
  const now = Date.now();
  const snap = await firestore().collection('programs').where('status', '==', 'ended').get();
  for (const doc of snap.docs) {
    const program = { ...(doc.data() as Program), id: doc.id };
    const endAt = Date.parse(program.event.endAt ?? program.event.startAt);
    const daysSince = (now - endAt) / DAY_MS;
    const warnAt = archiveDays(program) - 3;
    if (daysSince < warnAt || daysSince >= archiveDays(program) || program.archivedAt) continue;
    const existing = await firestore().collection(`programs/${program.id}/auditLogs`)
      .where('action', '==', 'lifecycle.archiveWarning').limit(1).get();
    if (!existing.empty) continue;
    await firestore().collection(`programs/${program.id}/auditLogs`).add({
      action: 'lifecycle.archiveWarning',
      programId: program.id,
      at: nowIso(),
      details: { daysSinceEnd: Math.floor(daysSince), archiveAfterDays: archiveDays(program) },
    });
  }
});

export const archivePrograms = onSchedule({ ...scheduleOptions, schedule: 'every day 02:30' }, async () => {
  const now = Date.now();
  const snap = await firestore().collection('programs').where('status', '==', 'ended').get();
  const toArchive = snap.docs.filter((doc) => {
    const program = doc.data() as Program;
    const endAt = Date.parse(program.event.endAt ?? program.event.startAt);
    return !program.archivedAt && (now - endAt) / DAY_MS >= archiveDays(program);
  });
  for (const group of chunk(toArchive)) {
    const batch = firestore().batch();
    group.forEach((doc) => batch.update(doc.ref, { status: 'archived', archivedAt: nowIso(), updatedAt: nowIso() }));
    await batch.commit();
  }
  for (const doc of toArchive) {
    await firestore().collection(`programs/${doc.id}/auditLogs`).add({
      action: 'lifecycle.archived', programId: doc.id, at: nowIso(),
    });
  }
});

export const deleteOldScreenshots = onSchedule({ ...scheduleOptions, schedule: 'every day 03:00' }, async () => {
  const cutoff = new Date(Date.now() - DEFAULT_SCREENSHOT_RETENTION_DAYS * DAY_MS).toISOString();
  const snap = await firestore().collection('screenshots').where('createdAt', '<=', cutoff).limit(400).get();
  for (const doc of snap.docs) {
    const path = doc.data()?.path as string | undefined;
    if (path) await bucket().file(path).delete().catch(() => undefined);
    await doc.ref.delete();
  }
  await audit({ action: 'lifecycle.screenshotsDeleted', actorRole: 'system', details: { count: snap.size } });
});

/** Exports get a 1-hour signed URL; this removes the object promptly afterwards. */
export const cleanupExpiredExports = onSchedule({ ...scheduleOptions, schedule: 'every 5 minutes' }, async () => {
  const snap = await firestore().collection('exportCleanup').where('deleteAt', '<=', Date.now()).limit(200).get();
  for (const doc of snap.docs) {
    const path = doc.data()?.path as string | undefined;
    if (path) await bucket().file(path).delete().catch(() => undefined);
    await doc.ref.delete();
  }
  if (snap.size) logger.info(`Deleted ${snap.size} expired exports.`);
});

export const applyRetention = onSchedule({ ...scheduleOptions, schedule: 'every day 04:00' }, async () => {
  const cutoff = new Date(Date.now() - DEFAULT_RETENTION_MONTHS * 30 * DAY_MS).toISOString();
  const snap = await firestore().collectionGroup('registrations').where('createdAt', '<', cutoff).limit(200).get();
  const totals = new Map<string, { count: number; confirmed: number; revenuePesewas: number }>();

  for (const doc of snap.docs) {
    const programId = doc.ref.parent.parent?.id;
    if (!programId) continue;
    const programSnap = await firestore().doc(`programs/${programId}`).get();
    const program = programSnap.data() as Program | undefined;
    const months = program ? retentionMonths(program) : DEFAULT_RETENTION_MONTHS;
    if (Date.parse(doc.data().createdAt) > Date.now() - months * 30 * DAY_MS) continue;
    const registration = doc.data() as RegistrationDoc;
    const total = totals.get(programId) ?? { count: 0, confirmed: 0, revenuePesewas: 0 };
    total.count += 1;
    if (registration.status === 'verified') total.confirmed += 1;
    total.revenuePesewas += registration.payment?.amountPaidPesewas ?? 0;
    totals.set(programId, total);

    // Keep aggregate totals; remove identifiable answers, contacts and evidence.
    await doc.ref.update({
      answers: {},
      notes: '',
      contact: { name: 'Anonymised' },
      payment: registration.payment ? {
        ...registration.payment,
        transactionId: 'REDACTED',
        senderName: 'Anonymised',
        senderPhone: undefined,
        screenshotPath: undefined,
        verified: false,
      } : undefined,
      anonymisedAt: nowIso(),
      updatedAt: nowIso(),
    });
    await firestore().doc(`tickets/${registration.ticketCode}`).set({ contactName: 'Anonymised' }, { merge: true });
  }

  for (const [programId, total] of totals) {
    // Aggregates survive anonymisation; no contact or answer data is kept.
    await firestore().doc(`metrics/retentionTotals/${programId}`).set({ ...total, programId, updatedAt: nowIso() }, { merge: true });
    await firestore().collection(`programs/${programId}/auditLogs`).add({
      action: 'lifecycle.retentionApplied', programId, at: nowIso(), details: total,
    });
  }
  await audit({ action: 'lifecycle.retentionApplied', actorRole: 'system', details: { registrations: snap.size, programs: totals.size } });
});

export const updatePlatformMetrics = onSchedule({ ...scheduleOptions, schedule: 'every day 05:00' }, async () => {
  const programs = (await firestore().collection('programs').get()).docs.map((doc) => doc.data() as Program);
  const registrations = await firestore().collectionGroup('registrations').get();
  const byStatus: Record<string, number> = {};
  let confirmed = 0;
  let pending = 0;
  let checkedIn = 0;
  for (const program of programs) byStatus[program.status] = (byStatus[program.status] ?? 0) + 1;
  for (const registration of registrations.docs) {
    const data = registration.data() as RegistrationDoc;
    if (data.status === 'verified') confirmed += 1;
    if (data.status === 'pending') pending += 1;
    if (data.checkedInAt) checkedIn += 1;
  }
  const metrics = {
    programs: programs.length,
    byStatus,
    registrations: registrations.size,
    confirmed,
    pending,
    checkedIn,
    updatedAt: nowIso(),
  };
  await firestore().doc('metrics/platform').set(metrics, { merge: true });
  await firestore().doc(`metrics/daily/${new Date().toISOString().slice(0, 10)}`).set(metrics);
  await audit({ action: 'metrics.updated', actorRole: 'system', details: metrics });
});

/** Exported for tests and for manual emulator runs. */
export function retentionCutoff(now = Date.now(), months = DEFAULT_RETENTION_MONTHS): string {
  return new Date(now - months * 30 * DAY_MS).toISOString();
}
