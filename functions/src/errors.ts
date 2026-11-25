import { HttpsError } from 'firebase-functions/v2/https';

export type FnErrorCode =
  | 'invalid-argument'
  | 'unauthenticated'
  | 'permission-denied'
  | 'not-found'
  | 'already-exists'
  | 'resource-exhausted'
  | 'failed-precondition'
  | 'aborted'
  | 'unavailable'
  | 'internal';

export function fail(code: FnErrorCode, message: string): never {
  throw new HttpsError(code, message);
}

export function assert(condition: unknown, code: FnErrorCode, message: string): asserts condition {
  if (!condition) fail(code, message);
}
