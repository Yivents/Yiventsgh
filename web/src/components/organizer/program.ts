'use client';

/** Program creation, duplication and small direct Firestore writes (owner only). */
import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import { GHANA_TIMEZONE, slugify, type ApprovalStatus, type EventMode } from '@yivents/shared';
import { db } from '@/lib/firebase/client';
import type { ProgramDoc } from './types';
import { friendlyError } from './utils';

function nowIso(): string {
  return new Date().toISOString();
}

function isConflict(error: unknown): boolean {
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code?: unknown }).code ?? '')
      : '';
  return code === 'already-exists' || /slug|link.*taken|already.*taken/i.test(
    typeof error === 'object' && error !== null && 'message' in error ? String((error as { message?: unknown }).message ?? '') : '',
  );
}

/**
 * Slugs are the capability for link-only events. There is no client-side
 * atomic reservation, so we check both projection and program paths and then
 * retry the write on conflict; the server trigger remains the final authority.
 */
export async function uniqueSlug(base: string, ignoreSlug?: string): Promise<string> {
  const root = slugify(base) || 'event';
  let candidate = root.slice(0, 48);
  for (let attempt = 0; attempt < 15; attempt += 1) {
    if (candidate !== ignoreSlug) {
      const [takenProjection, takenProgram] = await Promise.all([
        getDoc(doc(db, 'publicPrograms', candidate)).then((snap) => snap.exists()).catch(() => false),
        getDoc(doc(db, 'programs', candidate)).then((snap) => snap.exists()).catch(() => false),
      ]);
      if (!takenProjection && !takenProgram) return candidate;
    }
    const suffix = `-${attempt + 2}`;
    candidate = `${root.slice(0, 48 - suffix.length)}${suffix}`;
  }
  throw new Error('Could not find a unique share link. Try a different event name.');
}

export function blankProgram(ownerUid: string): Omit<ProgramDoc, 'id'> {
  const start = new Date(Date.now() + 24 * 60 * 60 * 1000);
  const startAt = start.toISOString();
  const deadline = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();
  const createdAt = nowIso();
  const mode: EventMode = 'in_person';
  const approvalStatus: ApprovalStatus = 'not_required';
  return {
    ownerUid,
    slug: '',
    title: '',
    description: '',
    visibility: 'link_only',
    approvalStatus,
    status: 'draft',
    event: { startAt, timezone: GHANA_TIMEZONE, mode },
    registrationDeadline: deadline,
    deadlineChanges: [],
    branding: {
      primaryColor: '#104080',
      accentColor: '#F2A93B',
      backgroundColor: '#FFFFFF',
      themePreset: 'logo',
      font: 'inter',
    },
    slideshow: [],
    speakers: [],
    sponsors: [],
    capacity: { perTicketType: {}, almostFullThreshold: 0.1 },
    settings: {
      documentKind: 'ticket',
      showAmountOnReceipt: false,
      instantTicketFree: true,
      instantTicketPaid: false,
      bankInstantTicket: false,
      duplicateRule: 'phone_or_email',
      allowMultiplePerContact: false,
      waitlistEnabled: false,
      captchaRequired: false,
      archiveAfterDays: 14,
      retentionMonths: 12,
      screenshotRetentionDays: 90,
      feedbackEnabled: false,
      linkReleaseDefaults: {},
      linkDisplay: 'direct',
      defaultLinkReleaseRule: 'on_registration',
      allowancePesewas: 0,
      tolerancePesewas: 0,
      ticketLayout: 'vertical',
      reopenCapacityOnReject: true,
    },
    counters: { confirmed: 0, pending: 0, waitlisted: 0, checkedIn: 0 },
    scannerEnabled: false,
    createdAt,
    updatedAt: createdAt,
  };
}

async function createWithSlugRetry(
  ownerUid: string,
  base: string,
  build: (slug: string, programId: string) => Record<string, unknown>,
): Promise<string> {
  const root = slugify(base) || 'event';
  let slugBase = root;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const slug = await uniqueSlug(slugBase);
    const ref = doc(collection(db, 'programs'));
    const at = nowIso();
    try {
      // Try the write; if the server rejects the slug, retry with a suffix.
      await setDoc(ref, { ...build(slug, ref.id), slug, createdAt: at, updatedAt: at });
      return ref.id;
    } catch (error) {
      if (isConflict(error) && attempt < 4) {
        slugBase = `${root}-${attempt + 2}`;
        continue;
      }
      throw new Error(friendlyError(error, 'Could not create the event. Please try again.'));
    }
  }
  throw new Error('Could not reserve a unique share link. Please try a different name.');
}

export function createProgram(ownerUid: string, title: string, preferredSlug?: string): Promise<string> {
  const base = preferredSlug?.trim() || title || 'event';
  return createWithSlugRetry(ownerUid, base, (slug) => ({
    ...blankProgram(ownerUid),
    title: title.trim() || 'Untitled event',
    slug,
  }));
}

/** Duplicate the full private setup in one click; registrations are never copied. */
export async function duplicateProgram(source: ProgramDoc, ownerUid: string): Promise<string> {
  const copy = await createWithSlugRetry(ownerUid, `${source.title} copy`, (slug) => {
    const at = nowIso();
    // Private meeting links are intentionally not copied between events.
    const { meetingLink: _ignored, ...safeSettings } = source.settings;
    return {
      ...blankProgram(ownerUid),
      slug,
      title: `${source.title} (copy)`,
      description: source.description,
      visibility: source.visibility,
      event: { ...source.event, timezone: GHANA_TIMEZONE },
      registrationDeadline: source.registrationDeadline,
      branding: { ...source.branding },
      slideshow: [...source.slideshow],
      speakers: source.speakers.map((speaker) => ({ ...speaker })),
      sponsors: source.sponsors.map((sponsor) => ({ ...sponsor })),
      capacity: {
        ...(source.capacity.overall ? { overall: source.capacity.overall } : {}),
        perTicketType: {},
        almostFullThreshold: source.capacity.almostFullThreshold,
      },
      settings: {
        ...blankProgram(ownerUid).settings,
        ...safeSettings,
        linkReleaseDefaults: {},
      },
      createdAt: at,
      updatedAt: at,
    };
  });

  const names = ['ticketTypes', 'formFields', 'feedbackFields', 'paymentMethods'] as const;
  for (const name of names) {
    const snapshot = await getDocs(collection(db, 'programs', source.id, name));
    if (snapshot.empty) continue;
    const batch = writeBatch(db);
    const idMap = new Map<string, string>();
    snapshot.docs.forEach((old) => {
      const target = doc(collection(db, 'programs', copy, name));
      idMap.set(old.id, target.id);
      batch.set(target, { ...old.data(), id: target.id });
    });
    await batch.commit();

    if (name === 'ticketTypes') {
      const perTicketType: Record<string, number> = {};
      Object.entries(source.capacity.perTicketType).forEach(([oldId, value]) => {
        const nextId = idMap.get(oldId);
        if (nextId) perTicketType[nextId] = value;
      });
      const linkReleaseDefaults: Record<string, string> = {};
      Object.entries(source.settings.linkReleaseDefaults).forEach(([oldId, rule]) => {
        const nextId = idMap.get(oldId);
        if (nextId) linkReleaseDefaults[nextId] = rule;
      });
      await patchProgram(copy, {
        'capacity.perTicketType': perTicketType,
        'settings.linkReleaseDefaults': linkReleaseDefaults,
      });
    }
  }
  return copy;
}

export async function patchProgram(programId: string, patch: Record<string, unknown>): Promise<void> {
  try {
    await updateDoc(doc(db, 'programs', programId), { ...patch, updatedAt: nowIso() });
  } catch (error) {
    throw new Error(friendlyError(error, 'Could not save the change. Please try again.'));
  }
}

export async function changeSlug(programId: string, base: string, currentSlug: string): Promise<string> {
  const slug = await uniqueSlug(base, currentSlug);
  if (slug === currentSlug) return slug;
  await patchProgram(programId, { slug });
  return slug;
}

export async function archiveProgram(programId: string): Promise<void> {
  await patchProgram(programId, { status: 'archived', archivedAt: nowIso() });
}
