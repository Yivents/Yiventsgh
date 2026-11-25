/** Claim-gated admin operations, TOTP 2FA and read-only impersonation. */
import { createHmac } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { contrastRatio, hashIdentifier, plainTextSchema } from '@yivents/shared';
import { authenticator } from 'otplib';
import { onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/logger';
import { z } from 'zod';
import { ALLOWED_ORIGIN, REGION, TOTP_MASTER_SECRET } from '../config';
import { adminIdentity, getProgram, requireAuth, requireProgramOwner } from '../authz';
import { fail } from '../errors';
import { auth, firestore } from '../firebase';
import { parseInput } from '../validation';
import { audit, newId, nowIso, programAudit } from '../utils';
import type { Announcement } from '@yivents/shared';

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** Derive a stable per-admin secret from the master secret — never stored in Firestore. */
function base32(bytes: Buffer): string {
  let value = 0;
  let bits = 0;
  let output = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32[(value << (5 - bits)) & 31];
  return output;
}

function totpSecret(uid: string): string {
  if (!TOTP_MASTER_SECRET) {
    fail('failed-precondition', 'Admin 2FA is not configured (ADMIN_2FA_SECRET missing).');
  }
  const derived = createHmac('sha256', TOTP_MASTER_SECRET).update(`yivents:totp:${uid}`).digest();
  return base32(derived.subarray(0, 20));
}

/* -------------------------------------------------------------------------- */
/* adminAction — exact names used by adminActions.ts                          */
/* -------------------------------------------------------------------------- */

const ADMIN_ACTIONS = [
  'addOrganizer', 'suspendOrganizer', 'restoreOrganizer', 'removeOrganizer', 'setVerifiedBadge',
  'approveListing', 'rejectListing', 'updateReport', 'addBlocklistEntry', 'removeBlocklistEntry',
  'saveAnnouncement', 'deleteAnnouncement', 'publishContent', 'updateSettings', 'setConversationStatus',
] as const;

type AdminActionName = (typeof ADMIN_ACTIONS)[number];

const adminActionSchema = z.object({
  action: z.string().min(1).max(60),
  targetId: z.string().min(1).max(200).optional(),
  reason: z.string().trim().max(500).optional(),
  value: z.unknown().optional(),
  payload: z.record(z.unknown()).optional(),
});

/** Actions reserved for super administrators (the `admin` claim counts too). */
const SUPER_ONLY = new Set<AdminActionName>([
  'addOrganizer', 'removeOrganizer', 'setVerifiedBadge',
  'addBlocklistEntry', 'removeBlocklistEntry', 'saveAnnouncement', 'deleteAnnouncement',
  'publishContent', 'updateSettings',
]);

function requiredTarget(targetId: string | undefined): string {
  if (!targetId) fail('invalid-argument', 'targetId is required for this action.');
  return targetId;
}

async function setDisabled(uid: string, disabled: boolean): Promise<void> {
  try {
    await auth().updateUser(uid, { disabled });
  } catch (error) {
    // The profile can exist before the Auth record (emulator seeds); keep the audit accurate.
    logger.warn('Auth user update skipped', error);
  }
}

async function resolveOrganizerUid(input: z.infer<typeof adminActionSchema>): Promise<string> {
  const payload = input.payload ?? {};
  const candidate = input.targetId ?? (typeof payload.uid === 'string' ? payload.uid : undefined);
  const email = candidate?.includes('@')
    ? candidate
    : typeof payload.email === 'string' ? payload.email : undefined;
  if (email) {
    try {
      return (await auth().getUserByEmail(email)).uid;
    } catch {
      const created = await auth().createUser({
        email,
        ...(typeof payload.displayName === 'string' ? { displayName: payload.displayName } : {}),
      });
      return created.uid;
    }
  }
  return requiredTarget(candidate);
}

/* --------------------------------- Announcements -------------------------- */

/** UI font ids/CSS stacks map to the shared enum; store the curated stack verbatim. */
const ANNOUNCEMENT_FONTS = ['inter', 'jakarta', 'serif', 'system'] as const;
const FONT_FAMILIES = [
  "'Inter', system-ui, sans-serif",
  "'Inter', 'Segoe UI', sans-serif",
  "'Plus Jakarta Sans', sans-serif",
  "'Plus Jakarta Sans', 'Trebuchet MS', sans-serif",
  "Georgia, 'Times New Roman', serif",
  "'Times New Roman', serif",
  'system-ui, -apple-system, sans-serif',
  "'Trebuchet MS', Arial, sans-serif",
] as const;
const FONT_MAP: Record<string, Announcement['font']> = {
  inter: 'inter', jakarta: 'jakarta', serif: 'serif', system: 'system',
  'inter-compact': 'inter', 'jakarta-display': 'jakarta', georgia: 'serif',
  times: 'serif', trebuchet: 'system',
  [FONT_FAMILIES[0]]: 'inter', [FONT_FAMILIES[1]]: 'inter',
  [FONT_FAMILIES[2]]: 'jakarta', [FONT_FAMILIES[3]]: 'jakarta',
  [FONT_FAMILIES[4]]: 'serif', [FONT_FAMILIES[5]]: 'serif',
  [FONT_FAMILIES[6]]: 'system', [FONT_FAMILIES[7]]: 'system',
};
const curatedFont = z.string().min(1).max(120).refine(
  (value) => Object.prototype.hasOwnProperty.call(FONT_MAP, value),
  'Use one of the eight curated font families.',
);
const storagePath = z.string().regex(/^uploads\/[A-Za-z0-9_-]{20,}\/[A-Za-z0-9._/-]+$/, 'Use a valid upload path.');
const hexColor = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a 6-digit hex colour.');

/** Manual validation: the shared enum is deliberately narrower than the UI fonts. */
const announcementPayloadSchema = z.object({
  title: plainTextSchema,
  body: plainTextSchema,
  type: z.enum(['info', 'warning', 'urgent']),
  startAt: z.string().datetime({ offset: true }),
  endAt: z.string().datetime({ offset: true }),
  target: z.enum(['organizers', 'homepage', 'both']),
  dismissible: z.boolean(),
  font: curatedFont,
  fontFamily: z.enum(FONT_FAMILIES),
  bgColor: hexColor,
  textColor: hexColor,
  bgImagePath: storagePath.optional(),
  mobileImagePath: storagePath.optional(),
  contrastChecked: z.literal(true),
});

/* ---------------------------------- Content -------------------------------- */

const contentPayloadSchema = z.object({
  slug: z.string().regex(/^[a-z0-9-]{1,80}$/).optional(),
  title: plainTextSchema,
  body: plainTextSchema,
  version: z.string().regex(/^[A-Za-z0-9._-]{1,40}$/).optional(),
});

const settingsPayloadSchema = z.object({
  maintenanceMode: z.boolean().optional(),
  supportEmail: z.string().email().optional(),
  domain: z.string().max(200).optional(),
  archiveAfterDays: z.number().int().positive().optional(),
  retentionMonths: z.number().int().positive().optional(),
  screenshotRetentionDays: z.number().int().positive().optional(),
  almostFullThreshold: z.number().min(0).max(100).optional(),
  featureSwitches: z.record(z.boolean()).optional(),
  planLimits: z.object({
    programs: z.number().int().nonnegative(),
    responses: z.number().int().nonnegative(),
    uploadsMb: z.number().int().nonnegative(),
    sponsorsMax: z.number().int().nonnegative(),
    slidesMax: z.number().int().nonnegative(),
  }).partial().optional(),
  legalVersions: z.object({
    terms: z.string().max(40).optional(),
    privacy: z.string().max(40).optional(),
    registrantNotice: z.string().max(2000).optional(),
  }).partial().optional(),
});

const reportStatusSchema = z.enum(['open', 'investigating', 'resolved', 'dismissed']);

export const adminAction = onCall({ region: REGION, cors: [ALLOWED_ORIGIN] }, async (request) => {
  const input = parseInput(adminActionSchema, request.data);
  const identity = adminIdentity(request, { require2fa: true });
  const action = input.action as AdminActionName;
  if (!ADMIN_ACTIONS.includes(action)) fail('invalid-argument', `Unsupported admin action: ${input.action}`);
  const superLevel = identity.level === 'superAdmin' || identity.level === 'admin';
  if (SUPER_ONLY.has(action) && !superLevel) fail('permission-denied', 'Super administrator privileges are required.');

  const at = nowIso();
  const details: Record<string, unknown> = {
    action, targetId: input.targetId ?? null, reason: input.reason ?? null,
  };

  switch (action) {
    case 'addOrganizer': {
      const uid = await resolveOrganizerUid(input);
      const user = await auth().getUser(uid).catch(() => null);
      await firestore().doc(`users/${uid}`).set({
        uid,
        email: user?.email ?? '',
        displayName: user?.displayName ?? (typeof input.payload?.displayName === 'string' ? input.payload.displayName : 'Organizer'),
        accountType: 'organizer',
        status: 'active',
        verifiedBadge: false,
        acceptedLegal: { termsVersion: '', privacyVersion: '', acceptedAt: '' },
        twoFactorEnabled: false,
        updatedAt: at,
        createdAt: at,
      }, { merge: true });
      await auth().setCustomUserClaims(uid, { ...(user?.customClaims ?? {}) });
      details.uid = uid;
      break;
    }
    case 'suspendOrganizer':
    case 'restoreOrganizer':
    case 'removeOrganizer': {
      const uid = requiredTarget(input.targetId);
      const status = action === 'suspendOrganizer' ? 'suspended' : action === 'removeOrganizer' ? 'removed' : 'active';
      await firestore().doc(`users/${uid}`).set({
        status,
        ...(status === 'suspended' ? { suspensionReason: input.reason ?? 'Suspended by administrator.' } : {}),
        ...(status === 'active' ? { suspensionReason: FieldValue.delete() } : {}),
        updatedAt: at,
      }, { merge: true });
      await setDisabled(uid, status !== 'active');
      break;
    }
    case 'setVerifiedBadge': {
      const uid = requiredTarget(input.targetId);
      const verified = parseInput(z.boolean(), input.value ?? input.payload?.value);
      await firestore().doc(`users/${uid}`).set({ verifiedBadge: verified, updatedAt: at }, { merge: true });
      details.verifiedBadge = verified;
      break;
    }
    case 'approveListing':
    case 'rejectListing': {
      const programId = requiredTarget(input.targetId);
      const approved = action === 'approveListing';
      const approvalStatus = approved ? 'approved' : 'rejected';
      await firestore().doc(`programs/${programId}`).update({ approvalStatus, updatedAt: at });
      if (approved) {
        const program = await getProgram(programId);
        await firestore().doc(`publicListings/${programId}`).set({
          programId, slug: program.slug, title: program.title,
          summary: program.description.slice(0, 240), startAt: program.event.startAt,
          endAt: program.event.endAt, approvalStatus, status: program.status,
          listedAt: (await firestore().doc(`publicListings/${programId}`).get()).data()?.listedAt ?? at,
        }, { merge: true });
      } else {
        await firestore().doc(`publicListings/${programId}`).delete();
      }
      await programAudit(programId, { action: `admin.${action}`, actorUid: identity.uid, actorRole: identity.level });
      break;
    }
    case 'updateReport': {
      const reportId = requiredTarget(input.targetId);
      const status = parseInput(reportStatusSchema, input.payload?.status ?? input.value);
      await firestore().doc(`reports/${reportId}`).update({
        status, updatedAt: at, updatedBy: identity.uid,
        ...(input.reason ? { resolutionNote: input.reason } : {}),
      });
      details.status = status;
      break;
    }
    case 'addBlocklistEntry':
    case 'removeBlocklistEntry': {
      const raw = input.targetId ?? input.payload?.value;
      if (typeof raw !== 'string' || !raw.trim()) fail('invalid-argument', 'Provide a value to blocklist.');
      const key = hashIdentifier(raw.trim().toLowerCase());
      const ref = firestore().doc(`blocklist/${key}`);
      if (action === 'addBlocklistEntry') {
        await ref.set({
          valueHash: key,
          type: typeof input.payload?.type === 'string' ? input.payload.type : 'identifier',
          reason: input.reason,
          createdBy: identity.uid,
          createdAt: at,
        });
      } else {
        await ref.delete();
      }
      break;
    }
    case 'saveAnnouncement': {
      const announcement = parseInput(announcementPayloadSchema, input.payload ?? {});
      // Server-side WCAG AA gate — never trust the client's contrastChecked flag.
      if (announcement.type === 'urgent' && announcement.dismissible) announcement.dismissible = false;
      if (Date.parse(announcement.startAt) >= Date.parse(announcement.endAt)) {
        fail('invalid-argument', 'The start time must be before the end time.');
      }
      if (contrastRatio(announcement.bgColor, announcement.textColor) < 4.5) {
        fail('invalid-argument', 'Text and background must have at least 4.5:1 contrast.');
      }
      const id = input.targetId ?? newId();
      const existing = (await firestore().doc(`announcements/${id}`).get()).data() as Announcement | undefined;
      const record: Announcement = {
        ...announcement,
        // Accept curated ids/CSS stacks but persist the shared font enum value.
        font: FONT_MAP[announcement.font],
        id,
        createdBy: existing?.createdBy ?? identity.uid,
      };
      await firestore().doc(`announcements/${id}`).set(record, { merge: true });
      details.announcementId = id;
      details.contrastRatio = contrastRatio(announcement.bgColor, announcement.textColor);
      break;
    }
    case 'deleteAnnouncement': {
      const id = requiredTarget(input.targetId);
      await firestore().doc(`announcements/${id}`).delete();
      break;
    }
    case 'publishContent': {
      const payload = parseInput(contentPayloadSchema, input.payload ?? {});
      const slug = payload.slug ?? requiredTarget(input.targetId);
      const version = payload.version ?? `v${Date.now()}`;
      await firestore().doc(`contentPages/${slug}/versions/${version}`).set({
        version, slug, title: payload.title, body: payload.body,
        publishedAt: at, publishedBy: identity.uid,
      });
      await firestore().doc(`contentPages/${slug}`).set({
        title: payload.title, body: payload.body, version, published: true,
        updatedAt: at, updatedBy: identity.uid,
      }, { merge: true });
      // Re-prompt organisers who accepted the previous version.
      const acceptances = await firestore().collectionGroup('contentAcceptances').get();
      let reset = 0;
      for (const doc of acceptances.docs) {
        if (doc.ref.parent.id !== slug) continue;
        await doc.ref.set({ accepted: false, acceptedVersion: '', acceptedAt: null, updatedAt: at }, { merge: true });
        reset += 1;
      }
      details.version = version;
      details.acceptancesReset = reset;
      break;
    }
    case 'updateSettings': {
      const payload = parseInput(settingsPayloadSchema, input.payload ?? {});
      await firestore().doc('settings/platform').set({ ...payload, updatedAt: at, updatedBy: identity.uid }, { merge: true });
      const publicSafe: Record<string, unknown> = {};
      for (const key of ['supportEmail', 'domain', 'featureSwitches', 'legalVersions'] as const) {
        if (payload[key] !== undefined) publicSafe[key] = payload[key];
      }
      if (Object.keys(publicSafe).length) {
        await firestore().doc('publicSettings/platform').set(publicSafe, { merge: true });
      }
      break;
    }
    case 'setConversationStatus': {
      const conversationId = requiredTarget(input.targetId);
      const status = parseInput(z.enum(['open', 'pending', 'closed', 'resolved']), input.value ?? input.payload?.status);
      await firestore().doc(`conversations/${conversationId}`).set({ status, updatedAt: at }, { merge: true });
      details.status = status;
      break;
    }
    default:
      fail('invalid-argument', `Unsupported admin action: ${input.action}`);
  }

  // Every action, including validation-failing targets that succeeded, is audited here.
  await audit({
    action: `admin.${action}`, actorUid: identity.uid, actorRole: identity.level,
    targetId: input.targetId ?? null, details,
  });
  return { ok: true, action, targetId: input.targetId ?? null };
});

/* --------------------------------- 2FA ------------------------------------ */

export const admin2faStart = onCall({ region: REGION, cors: [ALLOWED_ORIGIN] }, async (request) => {
  const identity = adminIdentity(request); // enrolment cannot require 2FA yet
  const secret = totpSecret(identity.uid);
  const uri = authenticator.keyuri(identity.uid, 'Yivents Admin', secret);
  await audit({ action: 'admin.2faStart', actorUid: identity.uid, actorRole: identity.level });
  // The secret stays server-side by default; expose it only for local manual-entry testing.
  return {
    otpauthUri: uri,
    uri,
    ...(process.env.ADMIN_2FA_RETURN_SECRET === '1' ? { secret } : {}),
  };
});

export const admin2faVerify = onCall({ region: REGION, cors: [ALLOWED_ORIGIN] }, async (request) => {
  const identity = adminIdentity(request);
  const input = parseInput(z.object({ code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code.') }), request.data);
  if (!authenticator.check(input.code, totpSecret(identity.uid))) {
    fail('invalid-argument', 'That code is incorrect or expired.');
  }
  const user = await auth().getUser(identity.uid);
  await auth().setCustomUserClaims(identity.uid, { ...(user.customClaims ?? {}), twoFactorEnrolled: true });
  await audit({ action: 'admin.2faVerified', actorUid: identity.uid, actorRole: identity.level });
  return { ok: true, enrolled: true };
});

/* ------------------------------ Messaging --------------------------------- */

const attachmentSchema = z.object({
  name: z.string().min(1).max(120),
  path: storagePath,
  size: z.number().int().nonnegative().optional(),
  contentType: z.string().max(120).optional(),
});

const adminMessageSchema = z.object({
  conversationId: z.string().min(1),
  body: plainTextSchema,
  attachments: z.array(attachmentSchema).max(10).optional(),
  programId: z.string().min(1).optional(),
});

export const sendAdminMessage = onCall({ region: REGION, cors: [ALLOWED_ORIGIN] }, async (request) => {
  const input = parseInput(adminMessageSchema, request.data);
  const identity = requireAuth(request);
  const claims = identity.token as Record<string, unknown>;
  const isAdmin = ['superAdmin', 'admin', 'support', 'moderator'].some((claim) => claims[claim] === true);
  const at = nowIso();
  const conversationRef = firestore().doc(`conversations/${input.conversationId}`);
  const conversation = (await conversationRef.get()).data() as { organizerUid?: string; status?: string } | undefined;

  if (!conversation) {
    if (!input.programId) fail('not-found', 'Conversation not found.');
    // Organizers own exactly one thread, keyed by their uid (same as rules).
    if (!isAdmin && input.conversationId !== identity.uid) {
      fail('permission-denied', 'Invalid conversation.');
    }
    let organizerUid = identity.uid;
    if (isAdmin) {
      organizerUid = (await getProgram(input.programId)).ownerUid;
    } else {
      await requireProgramOwner(identity.uid, input.programId);
    }
    await conversationRef.set({
      organizerUid, programId: input.programId, status: 'open', createdAt: at,
    }, { merge: true });
  } else if (conversation.organizerUid !== identity.uid && !isAdmin) {
    fail('permission-denied', 'You cannot post in this conversation.');
  }

  const attachments = (input.attachments ?? []).map((attachment) => {
    if (!isAdmin && !attachment.path.startsWith(`uploads/${identity.uid}/`)) {
      fail('permission-denied', 'Attachments must be in your own upload folder.');
    }
    return attachment;
  });
  const messageId = newId();
  await firestore().doc(`conversations/${input.conversationId}/messages/${messageId}`).set({
    id: messageId,
    body: input.body,
    senderUid: identity.uid,
    senderRole: isAdmin ? 'admin' : 'organizer',
    attachments,
    createdAt: at,
  });
  await conversationRef.update({ lastMessageAt: at });
  await audit({
    action: 'message.sent', actorUid: identity.uid, actorRole: isAdmin ? 'admin' : 'organizer',
    targetId: input.conversationId, details: { messageId, attachments: attachments.length },
  });
  return { ok: true, conversationId: input.conversationId, messageId };
});

/* ------------------------- Read-only impersonation ------------------------ */

export const viewAsOrganizer = onCall({ region: REGION, cors: [ALLOWED_ORIGIN] }, async (request) => {
  const identity = adminIdentity(request, { require2fa: true });
  const uid = parseInput(z.object({ uid: z.string().min(1) }), request.data).uid;
  const profile = (await firestore().doc(`users/${uid}`).get()).data() as Record<string, unknown> | undefined;
  const programs = (await firestore().collection('programs').where('ownerUid', '==', uid).limit(25).get()).docs;
  const summaries = programs.map((doc) => {
    const program = doc.data() as { title?: string; status?: string; counters?: { confirmed?: number; pending?: number; waitlisted?: number } };
    return {
      id: doc.id,
      title: program.title ?? '',
      status: program.status ?? '',
      confirmed: program.counters?.confirmed ?? 0,
      pending: program.counters?.pending ?? 0,
    };
  });

  // Server-side audit: impersonation cannot be hidden by the UI.
  await audit({
    action: 'admin.viewAsOrganizer', actorUid: identity.uid, actorRole: identity.level,
    targetId: uid, details: { mode: 'read_only', programs: summaries.length },
  });
  return {
    ok: true,
    organizer: {
      uid,
      email: typeof profile?.email === 'string' ? profile.email : '',
      displayName: typeof profile?.displayName === 'string' ? profile.displayName : '',
      status: typeof profile?.status === 'string' ? profile.status : '',
    },
    programs: summaries,
  };
});
