/**
 * Idempotent emulator-friendly seed data for Yivents.
 *   npx tsx scripts/seed/index.ts
 * Set USE_EMULATOR=1 (or the *_EMULATOR_HOST vars) to target local emulators.
 */
import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import {
  CURRENCY,
  GHANA_TIMEZONE,
  DEFAULT_ARCHIVE_AFTER_DAYS,
  DEFAULT_RETENTION_MONTHS,
  DEFAULT_SCREENSHOT_RETENTION_DAYS,
  hashIdentifier,
  searchTokens,
  type Announcement,
  type FormField,
  type PaymentMethod,
  type PlatformSettings,
  type Program,
  type PublicListing,
  type PublicProgram,
  type Registration,
  type TicketType,
  type UserProfile,
} from '../../packages/shared/src/index';
import type { TicketDoc } from '../../apps/functions/src/types';

if (process.env.USE_EMULATOR === '1' || process.env.FIRESTORE_EMULATOR_HOST) {
  process.env.FIRESTORE_EMULATOR_HOST ??= '127.0.0.1:8080';
  process.env.FIREBASE_AUTH_EMULATOR_HOST ??= '127.0.0.1:9099';
  process.env.FIREBASE_STORAGE_EMULATOR_HOST ??= '127.0.0.1:9199';
}
const projectId = process.env.FIREBASE_PROJECT_ID ?? process.env.GCLOUD_PROJECT ?? 'yivents-demo';
if (!getApps().length) initializeApp({ projectId, storageBucket: `${projectId}.appspot.com` });
const db = getFirestore();
const auth = getAuth();

const CREATED = '2026-11-01T08:00:00.000Z';
const START = '2026-12-15T09:00:00+00:00';
const END = '2026-12-15T17:00:00+00:00';
const DEADLINE = '2026-12-10T23:59:00+00:00';

/** Stable 32-char ticket codes so re-running the seed keeps the same QR values. */
function seedCode(prefix: string): string {
  return prefix.padEnd(32, '0').slice(0, 32);
}

function branding() {
  return {
    primaryColor: '#0B5C4A', accentColor: '#F4A261', backgroundColor: '#FFFFFF',
    themePreset: 'mint' as const, font: 'inter' as const,
  };
}

function baseProgram(id: string, overrides: Partial<Program>): Program {
  return {
    id,
    ownerUid: '', slug: id, title: id, description: '', visibility: 'public',
    approvalStatus: 'approved', status: 'upcoming',
    event: { startAt: START, endAt: END, timezone: GHANA_TIMEZONE, mode: 'in_person' },
    registrationDeadline: DEADLINE, deadlineChanges: [], branding: branding(),
    slideshow: [], speakers: [], sponsors: [],
    capacity: { overall: 100, perTicketType: {}, almostFullThreshold: 0.1 },
    settings: {
      documentKind: 'ticket', showAmountOnReceipt: false,
      instantTicketFree: true, instantTicketPaid: true, bankInstantTicket: false,
      duplicateRule: 'phone_or_email', allowMultiplePerContact: false,
      waitlistEnabled: true, captchaRequired: true,
      archiveAfterDays: DEFAULT_ARCHIVE_AFTER_DAYS,
      retentionMonths: DEFAULT_RETENTION_MONTHS,
      screenshotRetentionDays: DEFAULT_SCREENSHOT_RETENTION_DAYS,
      feedbackEnabled: true, linkReleaseDefaults: {}, linkDisplay: 'join_button',
      paymentAllowancePesewas: 100, paymentTolerancePesewas: 100,
    },
    counters: { confirmed: 0, pending: 0, waitlisted: 0, checkedIn: 0 },
    scannerEnabled: false, createdAt: CREATED, updatedAt: CREATED,
    ...overrides,
  } as Program;
}

async function ensureUser(email: string, displayName: string, claims: Record<string, boolean> = {}) {
  let user;
  try {
    user = await auth.getUserByEmail(email);
  } catch {
    user = await auth.createUser({ email, displayName, password: 'DemoPass123!', emailVerified: true });
  }
  await auth.setCustomUserClaims(user.uid, claims);
  const profile: UserProfile = {
    uid: user.uid,
    email,
    displayName,
    accountType: 'organizer',
    status: 'active',
    verifiedBadge: false,
    acceptedLegal: { termsVersion: '2026-1', privacyVersion: '2026-1', acceptedAt: CREATED },
    twoFactorEnabled: claims.twoFactorEnrolled === true,
    createdAt: CREATED,
    updatedAt: CREATED,
  };
  await db.doc(`users/${user.uid}`).set(profile, { merge: true });
  return user;
}

async function seedProgram(program: Program, ticketTypes: TicketType[], fields: FormField[], methods: PaymentMethod[]) {
  await db.doc(`programs/${program.id}`).set(program);
  await Promise.all(ticketTypes.map((t) => db.doc(`programs/${program.id}/ticketTypes/${t.id}`).set(t)));
  await Promise.all(fields.map((f) => db.doc(`programs/${program.id}/formFields/${f.id}`).set(f)));
  await Promise.all(methods.map((m) => db.doc(`programs/${program.id}/paymentMethods/${m.id}`).set(m)));
  await db.doc(`programs/${program.id}/feedbackFields/rating`).set({
    id: 'rating', type: 'rating', label: 'Overall rating', required: false, section: 'Feedback', order: 1,
  });
}

async function seedRegistration(programId: string, registration: Registration, code: string, internalStatus: string) {
  const ticket: TicketDoc = {
    code,
    programId,
    programTitle: registration.ticketTypeName,
    registrationId: registration.id,
    ticketTypeId: registration.ticketTypeId,
    ticketTypeName: registration.ticketTypeName,
    internalStatus: internalStatus as TicketDoc['internalStatus'],
    contactName: registration.contact.name,
    event: { startAt: START, endAt: END, timezone: GHANA_TIMEZONE, mode: programId === 'paid-summit' ? 'hybrid' : 'in_person' },
    createdAt: registration.createdAt,
  };
  await db.doc(`programs/${programId}/registrations/${registration.id}`).set(registration);
  await db.doc(`tickets/${code}`).set(ticket);
  if (registration.contact.duplicateKey) {
    await db.doc(`programs/${programId}/duplicateClaims/${registration.contact.duplicateKey}`).set({
      registrationId: registration.id, programId, createdAt: registration.createdAt,
    });
  }
  if (registration.payment) {
    await db.doc(`programs/${programId}/transactionClaims/${registration.payment.transactionId.toLowerCase()}`).set({
      registrationId: registration.id, programId, createdAt: registration.createdAt,
    });
  }
}

async function main() {
  const organizer = await ensureUser('organizer@demo.yivents.test', 'Demo Organizer');
  const helper = await ensureUser('helper@demo.yivents.test', 'Demo Helper');
  const admin = await ensureUser('admin@demo.yivents.test', 'Demo Admin', { superAdmin: true, twoFactorEnrolled: true });
  console.log(`Users ready: ${organizer.uid}, ${helper.uid}, ${admin.uid}`);

  const commonFields: FormField[] = [
    { id: 'full_name', type: 'short_text', label: 'Full name', required: true, section: 'Contact', order: 1 },
    { id: 'email', type: 'email', label: 'Email address', required: false, section: 'Contact', order: 2 },
    { id: 'phone', type: 'phone', label: 'Phone number', required: true, section: 'Contact', order: 3 },
    { id: 'dietary', type: 'dropdown', label: 'Dietary needs', required: false, section: 'Details', order: 4, options: ['None', 'Vegetarian', 'Other'] },
    { id: 'pin', type: 'short_text', label: 'PIN', required: false, section: 'Security (do not answer)', order: 5, sensitiveFlag: 'flagged' },
  ];

  const free = baseProgram('free-meet', {
    slug: 'free-community-meet',
    title: 'Free Community Meet',
    description: 'An open in-person meet-up for the Yivents community.',
    status: 'upcoming', event: { startAt: START, endAt: END, timezone: GHANA_TIMEZONE, mode: 'in_person', venue: 'Accra' },
    capacity: { overall: 50, perTicketType: { free_general: 50 }, almostFullThreshold: 0.1 },
    settings: { ...baseProgram('', {}).settings, instantTicketFree: true, duplicateRule: 'phone_or_email' },
    counters: { confirmed: 1, pending: 0, waitlisted: 0, checkedIn: 0 },
  });
  free.ownerUid = organizer.uid;
  await seedProgram(free, [
    { id: 'free_general', name: 'General admission', pricePesewas: 0, currency: CURRENCY, capacity: 50, mode: 'physical', instantTicket: true, linkReleaseRule: 'on_registration', active: true, order: 1 },
  ], commonFields, []);
  await db.doc('programs/free-meet/helpers/' + helper.uid).set({ uid: helper.uid, role: 'helper', status: 'active', acceptedAt: CREATED });

  const paid = baseProgram('paid-summit', {
    slug: 'paid-hybrid-summit',
    title: 'Paid Hybrid Summit',
    description: 'A two-day hybrid summit with MoMo and bank payment options.',
    event: { startAt: START, endAt: END, timezone: GHANA_TIMEZONE, mode: 'hybrid', venue: 'Kempinski Hotel, Accra' },
    capacity: { overall: 100, perTicketType: { early_bird: 30, regular: 70 }, almostFullThreshold: 20 },
    settings: {
      ...baseProgram('', {}).settings,
      instantTicketPaid: true,
      bankInstantTicket: false,
      linkReleaseDefaults: { early_bird: 'on_registration', regular: 'after_approval' },
      meetingLinks: { early_bird: 'https://meet.example.com/early', regular: 'https://meet.example.com/regular' },
    },
    counters: { confirmed: 1, pending: 2, waitlisted: 0, checkedIn: 0 },
    expectedReceivedPesewas: 45_000,
  });
  paid.ownerUid = organizer.uid;
  await seedProgram(paid, [
    { id: 'early_bird', name: 'Early bird', pricePesewas: 15_000, currency: CURRENCY, capacity: 30, mode: 'physical', instantTicket: true, linkReleaseRule: 'on_registration', active: true, order: 1 },
    { id: 'regular', name: 'Regular (online)', pricePesewas: 20_000, currency: CURRENCY, capacity: 70, mode: 'online', instantTicket: false, linkReleaseRule: 'after_approval', active: true, order: 2 },
  ], commonFields, [
    { id: 'momo_mtn', type: 'momo', network: 'MTN MoMo', number: '0240000000', accountName: 'Yivents Events', enabled: true, currency: CURRENCY, order: 1 },
    { id: 'bank_gtbank', type: 'bank', bankName: 'GTCO', accountNumber: '0123456789', accountName: 'Yivents Events', enabled: true, currency: CURRENCY, bankInstantTicket: false, order: 2 },
  ]);
  await db.doc('programs/paid-summit/helpers/' + helper.uid).set({ uid: helper.uid, role: 'helper', status: 'active', acceptedAt: CREATED });

  const email1 = 'ama@example.com';
  const phone1 = '+233241234567';
  await seedRegistration('free-meet', {
    id: 'reg_free_1', programId: 'free-meet', ticketCode: seedCode('seedfree'), ticketTypeId: 'free_general',
    ticketTypeName: 'General admission', ticketPricePesewas: 0, currency: CURRENCY,
    status: 'verified', flagged: false, flagReasons: [],
    answers: { full_name: 'Ama Mensah', email: email1, phone: phone1 },
    contact: { name: 'Ama Mensah', email: email1, phone: phone1, phoneHash: hashIdentifier(phone1), emailHash: hashIdentifier(email1), duplicateKey: `phone_${hashIdentifier(phone1)}` },
    verifiedAt: CREATED, createdAt: CREATED,
  }, seedCode('seedfree'), 'valid');
  await db.doc('programs/free-meet/capacityCounters/free_general').set({
    programId: 'free-meet', ticketTypeId: 'free_general', taken: 1, updatedAt: CREATED,
  });

  const phone2 = '+233501234567';
  const email2 = 'kojo@example.com';
  await seedRegistration('paid-summit', {
    id: 'reg_paid_momo', programId: 'paid-summit', ticketCode: seedCode('seedmomo'), ticketTypeId: 'early_bird',
    ticketTypeName: 'Early bird', ticketPricePesewas: 15_000, currency: CURRENCY,
    status: 'verified', flagged: false, flagReasons: [],
    answers: { full_name: 'Kojo Boateng', email: email2, phone: phone2 },
    contact: { name: 'Kojo Boateng', email: email2, phone: phone2, phoneHash: hashIdentifier(phone2), emailHash: hashIdentifier(email2), duplicateKey: `phone_${hashIdentifier(phone2)}` },
    payment: {
      methodId: 'momo_mtn', methodType: 'momo', transactionId: 'MTN-SEED-001', amountPaidPesewas: 15_000,
      ticketPricePesewas: 15_000, currency: CURRENCY, overByPesewas: 0, shortByPesewas: 0,
      senderName: 'Kojo Boateng', senderPhone: phone2, verified: true, verificationStatus: 'verified',
    },
    verifiedAt: CREATED, createdAt: CREATED,
  }, seedCode('seedmomo'), 'valid');

  const phone3 = '+233271234567';
  await seedRegistration('paid-summit', {
    id: 'reg_paid_bank', programId: 'paid-summit', ticketCode: seedCode('seedbank'), ticketTypeId: 'regular',
    ticketTypeName: 'Regular (online)', ticketPricePesewas: 20_000, currency: CURRENCY,
    status: 'pending', flagged: false, flagReasons: [],
    answers: { full_name: 'Efua Owusu', phone: phone3 },
    contact: { name: 'Efua Owusu', phone: phone3, phoneHash: hashIdentifier(phone3), duplicateKey: `phone_${hashIdentifier(phone3)}` },
    payment: {
      methodId: 'bank_gtbank', methodType: 'bank', transactionId: 'GTCO-SEED-002', amountPaidPesewas: 20_000,
      ticketPricePesewas: 20_000, currency: CURRENCY, overByPesewas: 0, shortByPesewas: 0,
      senderName: 'Efua Owusu', verified: false, verificationStatus: 'unverified',
    },
    createdAt: CREATED,
  }, seedCode('seedbank'), 'pending_approval');

  const phone4 = '+233541234567';
  await seedRegistration('paid-summit', {
    id: 'reg_paid_flagged', programId: 'paid-summit', ticketCode: seedCode('seedflag'), ticketTypeId: 'regular',
    ticketTypeName: 'Regular (online)', ticketPricePesewas: 20_000, currency: CURRENCY,
    status: 'pending', flagged: true, flagReasons: ['Sensitive answer removed: PIN', 'Payment below the ticket price.'],
    answers: { full_name: 'Kwame Asante', phone: phone4 },
    contact: { name: 'Kwame Asante', phone: phone4, phoneHash: hashIdentifier(phone4), duplicateKey: `phone_${hashIdentifier(phone4)}` },
    payment: {
      methodId: 'momo_mtn', methodType: 'momo', transactionId: 'MTN-SEED-003', amountPaidPesewas: 19_000,
      ticketPricePesewas: 20_000, currency: CURRENCY, overByPesewas: 0, shortByPesewas: 900,
      senderName: 'Kwame Asante', verified: false, verificationStatus: 'unverified',
    },
    createdAt: CREATED,
  }, seedCode('seedflag'), 'pending_approval');
  await db.doc('programs/paid-summit/capacityCounters/early_bird').set({ programId: 'paid-summit', ticketTypeId: 'early_bird', taken: 1, updatedAt: CREATED });
  await db.doc('programs/paid-summit/capacityCounters/regular').set({ programId: 'paid-summit', ticketTypeId: 'regular', taken: 2, updatedAt: CREATED });

  // Public projections mirror what syncPublicProjections would produce.
  const platformSettings: PlatformSettings = {
    currency: CURRENCY,
    planLimits: { programs: 10, responses: 5000, uploadsMb: 50, sponsorsMax: 20, slidesMax: 8 },
    archiveAfterDays: DEFAULT_ARCHIVE_AFTER_DAYS,
    retentionMonths: DEFAULT_RETENTION_MONTHS,
    screenshotRetentionDays: DEFAULT_SCREENSHOT_RETENTION_DAYS,
    almostFullThreshold: 0.1,
    featureSwitches: { feedback: true, hybridEvents: true },
    maintenanceMode: false,
    legalVersions: { terms: '2026-1', privacy: '2026-1', registrantNotice: 'Your data is used only to issue your ticket.' },
    supportEmail: 'support@yivents.com',
    domain: 'https://yivents.com',
  };
  await db.doc('settings/platform').set(platformSettings, { merge: true });
  await db.doc('publicSettings/platform').set({
    legalVersions: platformSettings.legalVersions,
    supportEmail: platformSettings.supportEmail,
    domain: platformSettings.domain,
  }, { merge: true });

  const projection = (program: Program, ticketTypes: Array<{ id: string; name: string; pricePesewas: number }>): PublicProgram => ({
    programId: program.id, slug: program.slug, title: program.title, description: program.description,
    imagePaths: program.slideshow, event: program.event, registrationDeadline: program.registrationDeadline,
    branding: program.branding,
    ticketTypes: ticketTypes.map((t) => ({ ...t, currency: CURRENCY })),
    speakers: program.speakers, sponsors: program.sponsors,
    capacityState: { total: program.capacity.overall, taken: program.counters.confirmed + program.counters.pending, almostFull: false, full: false },
    status: program.status, hasFeedbackForm: program.settings.feedbackEnabled,
    registrationOpen: true, privacyNotice: platformSettings.legalVersions.registrantNotice,
  });
  await db.doc(`publicPrograms/${free.slug}`).set(projection(free, [{ id: 'free_general', name: 'General admission', pricePesewas: 0 }]));
  await db.doc(`publicPrograms/${paid.slug}`).set(projection(paid, [
    { id: 'early_bird', name: 'Early bird', pricePesewas: 15_000 },
    { id: 'regular', name: 'Regular (online)', pricePesewas: 20_000 },
  ]));
  for (const program of [free, paid]) {
    const listing: PublicListing = {
      programId: program.id, slug: program.slug, title: program.title,
      summary: program.description.slice(0, 240), startAt: program.event.startAt, endAt: program.event.endAt,
      venue: program.event.venue, mode: program.event.mode,
      searchTokens: searchTokens(program.title), approvalStatus: program.approvalStatus,
      status: program.status, listedAt: CREATED,
    };
    await db.doc(`publicListings/${program.id}`).set(listing);
  }

  const announcement: Announcement = {
    id: 'welcome', title: 'Welcome to Yivents', body: 'Registrations are open for the demo events.',
    type: 'info', startAt: CREATED, endAt: '2027-01-01T00:00:00Z', target: 'both',
    dismissible: true, font: 'inter', bgColor: '#0B5C4A', contrastChecked: true, createdBy: admin.uid,
  };
  await db.doc('announcements/welcome').set(announcement);
  await db.doc('contentPages/terms').set({ title: 'Terms of Service', body: 'Demo terms.', version: '2026-1', published: true, updatedAt: CREATED });
  await db.doc('contentPages/privacy').set({ title: 'Privacy Policy', body: 'Demo privacy notice.', version: '2026-1', published: true, updatedAt: CREATED });
  await db.doc('contentPages/registrant-notice').set({ title: 'Registrant Notice', body: platformSettings.legalVersions.registrantNotice, version: '2026-1', published: true, updatedAt: CREATED });

  console.log('Seed complete: 2 programmes, 4 registrations, tickets, projections, announcements and legal pages.');
}

main().catch((error) => {
  console.error('Seed failed:', error);
  process.exitCode = 1;
});
