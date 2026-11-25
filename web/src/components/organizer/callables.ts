'use client';

/**
 * Thin wrappers around the exact callable names in docs/callables.md.
 * Payloads include common aliases because the contract only fixes the names;
 * the server remains the source of truth for validation and auditing.
 */
import { callFunction } from '@/lib/firebase/client';
import type { CallResultWithUrl, RecipientResult } from './types';
import { friendlyError } from './utils';

async function call<T>(name: string, data: object): Promise<T> {
  try {
    return await callFunction<T>(name, data);
  } catch (error) {
    throw new Error(friendlyError(error, `Could not complete ${name}. Please try again.`));
  }
}

export function approveRegistrations(programId: string, registrationIds: string[]) {
  return call<{ approved?: number }>('approveRegistrations', { programId, registrationIds, ids: registrationIds });
}

export function rejectRegistrations(programId: string, registrationIds: string[]) {
  return call<{ rejected?: number }>('rejectRegistrations', { programId, registrationIds, ids: registrationIds });
}

export function cancelRegistration(programId: string, registrationId: string) {
  return call<{ cancelled?: boolean }>('cancelRegistration', { programId, registrationId, id: registrationId });
}

export function reassignTransaction(programId: string, fromRegistrationId: string, toRegistrationId: string) {
  return call<{ ok?: boolean }>('reassignTransaction', { programId, fromRegistrationId, toRegistrationId });
}

export function extendDeadline(programId: string, deadline: string, reason?: string) {
  return call<{ deadline?: string }>('extendDeadline', {
    programId,
    deadline,
    newDeadline: deadline,
    registrationDeadline: deadline,
    reason,
  });
}

export function recordExpectedReceived(programId: string, expectedReceivedPesewas: number) {
  return call<{ saved?: boolean }>('recordExpectedReceived', {
    programId,
    expectedReceivedPesewas,
    amountPesewas: expectedReceivedPesewas,
  });
}

export function markUnpaid(programId: string, registrationIds: string[]) {
  return call<RecipientResult>('markUnpaid', { programId, registrationIds, ids: registrationIds });
}

export function generateScannerCredentials(programId: string) {
  return call<CallResultWithUrl>('generateScannerCredentials', { programId });
}

export function toggleScanner(programId: string, enabled: boolean) {
  return call<{ enabled?: boolean }>('toggleScanner', { programId, enabled });
}

export async function exportRegistrations(programId: string, ticketTypeId?: string): Promise<string> {
  const result = await call<CallResultWithUrl>('exportRegistrations', {
    programId,
    ...(ticketTypeId ? { ticketTypeId } : {}),
  });
  const url = result.signedUrl ?? result.url ?? result.downloadUrl;
  if (!url) throw new Error('The export did not return a download link. Please try again.');
  return url;
}

export function inviteHelper(programId: string, email?: string) {
  return call<CallResultWithUrl>('inviteHelper', { programId, ...(email ? { email } : {}) });
}

export function acceptHelperInvite(token: string, programId?: string) {
  return call<{ accepted?: boolean; programId?: string }>('acceptHelperInvite', { token, ...(programId ? { programId } : {}) });
}

export function sendAdminMessage(conversationId: string, body: string, programId?: string) {
  return call<{ id?: string }>('sendAdminMessage', {
    conversationId,
    conversationUid: conversationId,
    body,
    text: body,
    ...(programId ? { programId } : {}),
  });
}
