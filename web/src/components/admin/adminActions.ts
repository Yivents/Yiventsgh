/**
 * Typed wrappers around the admin-only callables. The browser never escalates
 * privileges by writing Firestore directly: every privileged change goes
 * through a callable that re-checks custom claims and writes an audit record.
 */
import { auth, callFunction, storage } from '@/lib/firebase/client';

/** Canonical `adminAction` operation names; the function must audit each one. */
export const ADMIN_ACTIONS = {
  addOrganizer: 'addOrganizer',
  suspendOrganizer: 'suspendOrganizer',
  restoreOrganizer: 'restoreOrganizer',
  removeOrganizer: 'removeOrganizer',
  setVerifiedBadge: 'setVerifiedBadge',
  approveListing: 'approveListing',
  rejectListing: 'rejectListing',
  updateReport: 'updateReport',
  addBlocklistEntry: 'addBlocklistEntry',
  removeBlocklistEntry: 'removeBlocklistEntry',
  saveAnnouncement: 'saveAnnouncement',
  deleteAnnouncement: 'deleteAnnouncement',
  publishContent: 'publishContent',
  updateSettings: 'updateSettings',
  setConversationStatus: 'setConversationStatus',
} as const;

export type AdminActionName = (typeof ADMIN_ACTIONS)[keyof typeof ADMIN_ACTIONS];

export interface AdminActionRequest {
  action: AdminActionName | string;
  targetId?: string;
  reason?: string;
  value?: unknown;
  payload?: Record<string, unknown>;
}

export interface ActionResult {
  ok?: boolean;
  message?: string;
}

export function adminAction(request: AdminActionRequest): Promise<ActionResult> {
  return callFunction<ActionResult, AdminActionRequest>('adminAction', request);
}

export interface AdminMessageRequest {
  conversationId: string;
  body: string;
  attachments?: Array<{ name: string; path: string; size?: number; contentType?: string }>;
  programId?: string;
}

export function sendAdminMessage(request: AdminMessageRequest): Promise<ActionResult> {
  return callFunction<ActionResult, AdminMessageRequest>('sendAdminMessage', request);
}

/** Returns the otpauth URI; the secret stays server-side. */
export function admin2faStart(): Promise<{ otpauthUri?: string; uri?: string; secret?: string }> {
  return callFunction<{ otpauthUri?: string; uri?: string; secret?: string }, Record<string, never>>('admin2faStart', {});
}

export function admin2faVerify(code: string): Promise<ActionResult> {
  return callFunction<ActionResult, { code: string }>('admin2faVerify', { code });
}

/** Read-only impersonation; the callable always writes an audit record. */
export function viewAsOrganizer(uid: string): Promise<ActionResult> {
  return callFunction<ActionResult, { uid: string }>('viewAsOrganizer', { uid });
}

/** Uploads into the signed-in admin's own Storage folder (rules enforce type/size). */
export async function uploadAdminFile(file: File, folder: string): Promise<string> {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('Please sign in again before uploading.');
  const safeName = file.name.replace(/[^a-zA-Z0-9._ -]/g, '_').slice(0, 80);
  const path = `uploads/${uid}/${folder}/${Date.now()}-${safeName}`;
  const { ref, uploadBytes } = await import('firebase/storage');
  await uploadBytes(ref(storage, path), file);
  return path; // store the path, render later through a signed URL
}
