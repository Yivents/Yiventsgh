/** XLSX export to a private Storage object with a one-hour signed URL. */
import { documentId } from 'firebase-admin/firestore';
import ExcelJS from 'exceljs';
import { onCall } from 'firebase-functions/v2/https';
import { z } from 'zod';
import { ALLOWED_ORIGIN, EXPORT_TTL_MS, REGION } from '../config';
import { requireAuth, requireProgramAccess } from '../authz';
import { parseInput } from '../validation';
import { bucket, firestore } from '../firebase';
import { newId, nowIso, programAudit } from '../utils';
import type { FormField, TicketType } from '@yivents/shared';
import type { RegistrationDoc } from '../types';

const exportSchema = z.object({
  programId: z.string().min(1),
  registrationIds: z.array(z.string().min(1)).max(5000).optional(),
});

function sheetName(name: string): string {
  return name.replace(/[[\]:*?/\\]/g, ' ').trim().slice(0, 31) || 'Tickets';
}

function money(pesewas: number | undefined): string {
  return typeof pesewas === 'number' ? ((pesewas / 100).toFixed(2)) : '';
}

function headers(fields: FormField[]): string[] {
  return [
    'Timestamp',
    ...fields.map((field) => field.label),
    'Ticket type',
    'Price (GHS)',
    'Amount paid (GHS)',
    'Over (GHS)',
    'Short (GHS)',
    'Payment status',
    'Check-in status',
  ];
}

function row(registration: RegistrationDoc, fields: FormField[]): string[] {
  const answers = fields.map((field) => {
    const value = registration.answers[field.id];
    return Array.isArray(value) ? value.join(', ') : String(value ?? '');
  });
  return [
    registration.createdAt,
    ...answers,
    registration.ticketTypeName,
    money(registration.ticketPricePesewas),
    money(registration.payment?.amountPaidPesewas),
    money(registration.payment?.overByPesewas),
    money(registration.payment?.shortByPesewas),
    registration.payment?.verificationStatus ?? (registration.ticketPricePesewas > 0 ? 'unverified' : 'n/a'),
    registration.checkedInAt ?? 'not checked in',
  ];
}

export const exportRegistrations = onCall({ region: REGION, cors: [ALLOWED_ORIGIN] }, async (request) => {
  const input = parseInput(exportSchema, request.data);
  const { uid } = requireAuth(request);
  const program = await requireProgramAccess(uid, input.programId, true); // organizer or helper

  const fields = (await firestore().collection(`programs/${program.id}/formFields`).get()).docs
    .map((doc) => ({ ...(doc.data() as FormField), id: doc.id }))
    .sort((a, b) => a.order - b.order)
    // Secrets must never be exported.
    .filter((field) => field.sensitiveFlag !== 'blocked');
  const ticketTypes = (await firestore().collection(`programs/${program.id}/ticketTypes`).get()).docs
    .map((doc) => ({ ...(doc.data() as TicketType), id: doc.id }));

  let registrations: RegistrationDoc[];
  if (input.registrationIds?.length) {
    const chunks: string[][] = [];
    for (let i = 0; i < input.registrationIds.length; i += 10) chunks.push(input.registrationIds.slice(i, i + 10));
    const snapshots = await Promise.all(chunks.map((chunk) => firestore()
      .collection(`programs/${program.id}/registrations`)
      .where(documentId(), 'in', chunk).get()));
    registrations = snapshots.flatMap((snap) => snap.docs.map((doc) => doc.data() as RegistrationDoc));
  } else {
    const snap = await firestore().collection(`programs/${program.id}/registrations`).orderBy('createdAt', 'desc').limit(5000).get();
    registrations = snap.docs.map((doc) => doc.data() as RegistrationDoc);
  }

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Yivents';
  workbook.created = new Date();
  const table = [headers(fields), ...registrations.map((registration) => row(registration, fields))];
  const addSheet = (name: string, rows: string[][]) => {
    const sheet = workbook.addWorksheet(sheetName(name));
    rows.forEach((values) => sheet.addRow(values));
    sheet.getRow(1).font = { bold: true };
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
  };
  addSheet('All', table);
  for (const ticketType of ticketTypes) {
    addSheet(ticketType.name, [
      headers(fields),
      ...registrations.filter((registration) => registration.ticketTypeId === ticketType.id)
        .map((registration) => row(registration, fields)),
    ]);
  }

  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
  const path = `exports/${program.id}/${newId()}.xlsx`;
  const cleanupId = newId();
  const deleteAt = Date.now() + EXPORT_TTL_MS;
  const file = bucket().file(path);
  await file.save(buffer, {
    resumable: false,
    metadata: { contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
  });
  const [url] = await file.getSignedUrl({ action: 'read', version: 2, expires: deleteAt });
  // Scheduled cleanup removes the object and this TTL doc after expiry.
  await firestore().doc(`exportCleanup/${cleanupId}`).set({
    path, programId: program.id, requestedBy: uid, deleteAt, createdAt: nowIso(),
  });
  await programAudit(program.id, {
    action: 'registrations.exported', actorUid: uid, actorRole: 'organizer',
    details: { rows: registrations.length, sheets: ticketTypes.length + 1 },
  });
  return { url, expiresAt: deleteAt };
});
