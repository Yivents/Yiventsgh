/**
 * Firestore rules tests. Start the emulator first:
 *   firebase emulators:start --only firestore --project yivents-demo --config firebase/firebase.json
 *   npm test --workspace @yivents/functions
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  updateDoc,
  where,
  type Firestore,
} from 'firebase/firestore';

const projectId = 'yivents-rules-test';
const emulator = (process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8080').split(':');
const rules = readFileSync(resolve(__dirname, '../firestore.rules'), 'utf8');

let testEnv: RulesTestEnvironment;

async function seed(db: Firestore): Promise<void> {
  await setDoc(doc(db, 'users/owner'), { uid: 'owner', status: 'active', accountType: 'organizer' });
  await setDoc(doc(db, 'users/helper'), { uid: 'helper', status: 'active', accountType: 'organizer' });
  await setDoc(doc(db, 'programs/paid'), {
    ownerUid: 'owner',
    slug: 'paid-event',
    status: 'upcoming',
    approvalStatus: 'approved',
    visibility: 'public',
    event: { startAt: '2026-12-15T09:00:00Z', mode: 'in_person', timezone: 'Africa/Accra' },
    counters: { confirmed: 0, pending: 0, waitlisted: 0, checkedIn: 0 },
  });
  await setDoc(doc(db, 'programs/paid/helpers/helper'), { uid: 'helper', role: 'helper', status: 'active' });
  await setDoc(doc(db, 'programs/paid/registrations/r1'), {
    status: 'pending', ticketTypeId: 'general', ticketCode: 'code', answers: {}, createdAt: '2026-11-01T00:00:00Z',
  });
  await setDoc(doc(db, 'publicPrograms/paid-event'), { programId: 'paid', slug: 'paid-event', status: 'upcoming' });
  await setDoc(doc(db, 'publicPrograms/old-event'), { programId: 'old', slug: 'old-event', status: 'archived' });
  await setDoc(doc(db, 'publicListings/ok'), {
    programId: 'ok', approvalStatus: 'approved', status: 'upcoming', startAt: '2026-12-15T09:00:00Z', searchTokens: ['ok'],
  });
  await setDoc(doc(db, 'publicListings/pending'), {
    programId: 'pending', approvalStatus: 'pending', status: 'upcoming', startAt: '2026-12-15T09:00:00Z', searchTokens: ['pending'],
  });
  await setDoc(doc(db, 'publicListings/ended'), {
    programId: 'ended', approvalStatus: 'approved', status: 'ended', startAt: '2026-01-15T09:00:00Z', searchTokens: ['ended'],
  });
}

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId,
    firestore: { rules, host: emulator[0], port: Number(emulator[1] ?? 8080) },
  });
});

afterAll(async () => testEnv?.cleanup());

beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (context) => seed(context.firestore()));
});

describe('deny by default', () => {
  it('denies anonymous programme reads', async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(db, 'programs/paid')));
  });

  it('denies cross-organizer reads', async () => {
    const db = testEnv.authenticatedContext('someone-else').firestore();
    await assertFails(getDoc(doc(db, 'programs/paid')));
  });

  it('denies listing all registrations', async () => {
    const db = testEnv.authenticatedContext('someone-else').firestore();
    await assertFails(getDocs(collection(db, 'programs/paid/registrations')));
  });

  it('denies forbidden public writes', async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    await assertFails(setDoc(doc(db, 'programs/paid/registrations/injected'), { status: 'verified' }));
    await assertFails(setDoc(doc(db, 'publicPrograms/paid-event'), { status: 'upcoming' }));
    await assertFails(setDoc(doc(db, 'tickets/abc'), { programId: 'paid' }));
  });
});

describe('helpers and admins', () => {
  it('lets a helper read registrations but not change status', async () => {
    const db = testEnv.authenticatedContext('helper').firestore();
    await assertSucceeds(getDocs(collection(db, 'programs/paid/registrations')));
    await assertSucceeds(getDoc(doc(db, 'programs/paid/registrations/r1')));
    await assertFails(updateDoc(doc(db, 'programs/paid/registrations/r1'), { status: 'verified' }));
    await assertFails(updateDoc(doc(db, 'programs/paid/registrations/r1'), { payment: { transactionId: 'x' } }));
    await assertSucceeds(updateDoc(doc(db, 'programs/paid/registrations/r1'), { notes: 'Follow up' }));
  });

  it('allows a superAdmin-claim user to read private data', async () => {
    const db = testEnv.authenticatedContext('root', { superAdmin: true }).firestore();
    await assertSucceeds(getDoc(doc(db, 'programs/paid')));
    await assertSucceeds(getDocs(collection(db, 'programs/paid/registrations')));
    await assertSucceeds(getDoc(doc(db, 'auditLogs/anything')));
  });
});

describe('public projections', () => {
  it('allows get but denies list on publicPrograms', async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    await assertSucceeds(getDoc(doc(db, 'publicPrograms/paid-event')));
    await assertFails(getDocs(collection(db, 'publicPrograms')));
    await assertFails(getDoc(doc(db, 'publicPrograms/old-event')));
  });

  it('allows listing queries only for approved upcoming events', async () => {
    const db = testEnv.unauthenticatedContext().firestore();
    await assertSucceeds(getDocs(query(
      collection(db, 'publicListings'),
      where('approvalStatus', '==', 'approved'),
      where('status', '==', 'upcoming'),
      where('startAt', '>', new Date().toISOString()),
    )));
    await assertFails(getDoc(doc(db, 'publicListings/pending')));
    await assertFails(getDoc(doc(db, 'publicListings/ended')));
  });
});
