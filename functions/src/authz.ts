/** Server-side authorization. Every privileged callable goes through these. */
import type { CallableRequest } from 'firebase-functions/v2/https';
import type { DecodedIdToken } from 'firebase-admin/auth';
import type { Program } from '@yivents/shared';
import { assert, fail } from './errors';
import { firestore } from './firebase';

export type Claims = DecodedIdToken & Record<string, unknown>;
export interface AuthData {
  uid: string;
  token: Claims;
}

export type AdminLevel = 'superAdmin' | 'admin' | 'support' | 'moderator';
export interface AdminIdentity extends AuthData {
  level: AdminLevel;
}

export function requireAuth(req: CallableRequest<unknown>): AuthData {
  if (!req.auth?.uid) fail('unauthenticated', 'Sign in to continue.');
  return req.auth as unknown as AuthData;
}

export function hasClaim(token: Claims, name: string): boolean {
  return token[name] === true;
}

/** Admin powers come only from Firebase custom claims (never a database field). */
export function adminIdentity(
  req: CallableRequest<unknown>,
  options: { require2fa?: boolean; superOnly?: boolean } = {},
): AdminIdentity {
  const identity = requireAuth(req);
  const token = identity.token;
  const level: AdminLevel | null =
    hasClaim(token, 'superAdmin') ? 'superAdmin'
      : hasClaim(token, 'admin') ? 'admin'
        : hasClaim(token, 'support') ? 'support'
          : hasClaim(token, 'moderator') ? 'moderator'
            : null;
  if (!level) fail('permission-denied', 'Administrator privileges are required.');
  if (options.superOnly && level !== 'superAdmin') fail('permission-denied', 'Super administrator privileges are required.');
  if (options.require2fa && token.twoFactorEnrolled !== true) {
    fail('failed-precondition', 'Complete administrator two-factor enrolment first.');
  }
  return { ...identity, level };
}

export async function assertActiveUser(uid: string): Promise<void> {
  const snap = await firestore().doc(`users/${uid}`).get();
  const status = snap.data()?.status;
  if (status === 'suspended' || status === 'removed') {
    fail('permission-denied', 'This account is not active.');
  }
}

export async function getProgram(programId: string): Promise<Program & { id: string }> {
  assert(typeof programId === 'string' && programId.length > 0, 'invalid-argument', 'programId is required.');
  const snap = await firestore().doc(`programs/${programId}`).get();
  if (!snap.exists) fail('not-found', 'Programme not found.');
  return { ...(snap.data() as Program), id: snap.id };
}

/** Owner or accepted helper membership; helpers never own the programme. */
export async function requireProgramAccess(
  uid: string,
  programId: string,
  allowHelper = true,
): Promise<Program & { id: string }> {
  await assertActiveUser(uid);
  const program = await getProgram(programId);
  if (program.ownerUid === uid) return program;
  if (allowHelper) {
    const helper = await firestore().doc(`programs/${programId}/helpers/${uid}`).get();
    const status = helper.data()?.status;
    if (helper.exists && status !== 'revoked') return program;
  }
  fail('permission-denied', 'You do not manage this programme.');
}

export async function requireProgramOwner(uid: string, programId: string): Promise<Program & { id: string }> {
  return requireProgramAccess(uid, programId, false);
}
