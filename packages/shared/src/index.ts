/**
 * @yivents/shared
 * Single source of truth for data shapes, validation and Ghana-specific helpers.
 * Imported by the web app, Cloud Functions and emulator tests. Never import
 * Firebase Admin or browser APIs from this package.
 */
import { z } from 'zod';

export const CURRENCY = 'GHS' as const;
export const GHANA_TIMEZONE = 'Africa/Accra' as const;
export const MAX_SLIDESHOW_IMAGES = 8;
export const EMAIL_BATCH_SIZE = 50;
export const TICKET_CODE_BYTES = 24; // 192 bits of entropy; QR contains only this code.
export const DEFAULT_ARCHIVE_AFTER_DAYS = 14;
export const DEFAULT_RETENTION_MONTHS = 12;
export const DEFAULT_SCREENSHOT_RETENTION_DAYS = 90;

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

export type RegistrationStatus = 'pending' | 'verified' | 'rejected' | 'cancelled' | 'waitlisted';
export type EventMode = 'in_person' | 'online' | 'hybrid';
export type TicketDocumentKind = 'ticket' | 'receipt';
export type LinkReleaseRule = 'on_registration' | 'after_approval' | 'scheduled' | 'manual';
export type Visibility = 'link_only' | 'public';
export type ApprovalStatus = 'not_required' | 'pending' | 'approved' | 'rejected';
export type ProgramStatus = 'draft' | 'upcoming' | 'ongoing' | 'ended' | 'archived';

export interface EventDetails {
  startAt: string; // ISO UTC
  endAt?: string; // ISO UTC, multi-day events simply have a later endAt
  timezone: typeof GHANA_TIMEZONE;
  venue?: string;
  mapsUrl?: string;
  mode: EventMode;
}

export interface Branding {
  logoPath?: string;
  bannerPath?: string;
  primaryColor: string;
  accentColor: string;
  backgroundColor: string;
  themePreset: 'logo' | 'ocean' | 'warm' | 'mint';
  font: 'inter' | 'jakarta' | 'serif';
}

export interface TicketSummary {
  id: string;
  name: string;
  pricePesewas: number;
  currency: typeof CURRENCY;
}

export interface Program {
  id: string;
  ownerUid: string;
  slug: string;
  title: string;
  description: string; // plain text only
  visibility: Visibility;
  approvalStatus: ApprovalStatus;
  status: ProgramStatus;
  event: EventDetails;
  registrationDeadline: string; // ISO UTC
  deadlineChanges: Array<{ from: string; to: string; by: string; at: string; reason?: string }>;
  branding: Branding;
  slideshow: string[]; // Storage paths, flyer first, max 8
  speakers: Array<{ name: string; topic?: string; time?: string; notes?: string; photoPath?: string }>;
  sponsors: Array<{ name: string; logoPath?: string; url?: string }>;
  capacity: {
    overall?: number;
    perTicketType: Record<string, number>;
    almostFullThreshold: number; // 0.1 = last 10%, or integer 20 = last 20 spots
  };
  settings: {
    documentKind: TicketDocumentKind;
    showAmountOnReceipt: boolean;
    instantTicketFree: boolean;
    instantTicketPaid: boolean;
    bankInstantTicket: boolean;
    duplicateRule: 'phone' | 'email' | 'phone_or_email' | 'off';
    allowMultiplePerContact: boolean;
    waitlistEnabled: boolean;
    captchaRequired: boolean;
    archiveAfterDays: number;
    retentionMonths: number;
    screenshotRetentionDays: number;
    feedbackEnabled: boolean;
    linkReleaseDefaults: Record<string, LinkReleaseRule>;
    linkDisplay: 'direct' | 'join_button';
    replayLink?: string;
    /** Plain-text payment instructions shown to registrants. */
    paymentInstructions?: string;
    /** Phase 1 link release defaults and per-type overrides. */
    defaultLinkReleaseRule?: LinkReleaseRule;
    meetingLink?: string;
    meetingMessage?: string;
    /** Payment amount tolerance settings (pesewas). */
    allowancePesewas?: number;
    tolerancePesewas?: number;
    ticketLayout?: 'vertical' | 'horizontal' | 'card';
    reopenCapacityOnReject?: boolean;
  };
  counters: { confirmed: number; pending: number; waitlisted: number; checkedIn: number };
  expectedReceivedPesewas?: number;
  scannerEnabled: boolean;
  scannerPinHash?: string;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
}

/** Safe projection used by the public program page. Never contains registrant data. */
export interface PublicProgram {
  programId: string;
  slug: string;
  title: string;
  description: string;
  imagePaths: string[];
  event: EventDetails;
  registrationDeadline: string;
  branding: Branding;
  ticketTypes: TicketSummary[];
  /** Form field definitions only — never answers or payment data. */
  formFields: FormField[];
  /** Enabled MoMo/bank methods only; no private credentials beyond public account details. */
  paymentMethods: PaymentMethod[];
  paymentInstructions?: string;
  plan: 'free';
  speakers: Program['speakers'];
  sponsors: Program['sponsors'];
  capacityState: { total?: number; taken: number; almostFull: boolean; full: boolean };
  status: ProgramStatus;
  hasFeedbackForm: boolean;
  registrationOpen: boolean;
  privacyNotice: string;
}

/** Safe projection used by the homepage and search. */
export interface PublicListing {
  programId: string;
  slug: string;
  title: string;
  summary: string;
  coverPath?: string;
  startAt: string;
  endAt?: string;
  venue?: string;
  mode: EventMode;
  searchTokens: string[];
  approvalStatus: ApprovalStatus;
  status: ProgramStatus;
  listedAt: string;
}

export interface TicketType {
  id: string;
  name: string;
  pricePesewas: number;
  currency: typeof CURRENCY;
  capacity?: number;
  mode: 'physical' | 'online';
  instantTicket: boolean;
  linkReleaseRule: LinkReleaseRule;
  active: boolean;
  order: number;
}

export type FieldType =
  | 'short_text'
  | 'paragraph'
  | 'multiple_choice'
  | 'checkboxes'
  | 'dropdown'
  | 'linear_scale'
  | 'date'
  | 'time'
  | 'number'
  | 'email'
  | 'phone'
  | 'file'
  | 'rating';

export interface FormField {
  id: string;
  type: FieldType;
  label: string;
  description?: string;
  required: boolean;
  section: string;
  order: number;
  options?: string[];
  imagePath?: string;
  caption?: string;
  min?: number;
  max?: number;
  sensitiveFlag?: 'blocked' | 'flagged';
}

export interface PaymentMethod {
  id: string;
  type: 'momo' | 'bank';
  network?: 'MTN MoMo' | 'Telecel Cash' | 'AirtelTigo Money';
  number?: string;
  accountNumber?: string;
  accountName: string;
  bankName?: string;
  enabled: boolean;
  currency: typeof CURRENCY;
  bankInstantTicket?: boolean;
  order: number;
}

export interface PaymentRecord {
  methodId: string;
  methodType: 'momo' | 'bank';
  transactionId: string;
  amountPaidPesewas: number;
  ticketPricePesewas: number;
  currency: typeof CURRENCY;
  overByPesewas: number;
  shortByPesewas: number;
  senderName: string;
  senderPhone?: string;
  payerName?: string;
  referenceCode?: string;
  screenshotPath?: string;
}

export interface Registration {
  id: string;
  programId: string;
  ticketCode: string; // long random code; only this is inside the QR
  ticketTypeId: string;
  ticketTypeName: string;
  ticketPricePesewas: number;
  currency: typeof CURRENCY;
  status: RegistrationStatus;
  flagged: boolean;
  flagReasons: string[];
  answers: Record<string, string | string[] | number | boolean>;
  contact: {
    name: string;
    email?: string;
    phone?: string;
    phoneHash?: string;
    emailHash?: string;
    duplicateKey?: string;
  };
  payment?: PaymentRecord;
  notes?: string;
  assignedTo?: string;
  checkedInAt?: string;
  checkedInBy?: string;
  meetingLinkReleasedAt?: string;
  createdAt: string;
  verifiedAt?: string;
}

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  photoURL?: string;
  phone?: string;
  accountType: 'organizer';
  status: 'active' | 'suspended' | 'removed';
  suspensionReason?: string;
  verifiedBadge: boolean;
  acceptedLegal: { termsVersion: string; privacyVersion: string; acceptedAt: string };
  twoFactorEnabled: boolean;
  createdAt: string;
  updatedAt: string;
  lastSeenAt?: string;
}

export interface PlatformSettings {
  currency: typeof CURRENCY;
  planLimits: {
    programs: number;
    responses: number;
    uploadsMb: number;
    sponsorsMax: number;
    slidesMax: number;
  };
  archiveAfterDays: number;
  retentionMonths: number;
  screenshotRetentionDays: number;
  almostFullThreshold: number;
  featureSwitches: Record<string, boolean>;
  maintenanceMode: boolean;
  legalVersions: { terms: string; privacy: string; registrantNotice: string };
  supportEmail: string;
  domain: string;
}

export interface Announcement {
  id: string;
  title: string;
  body: string;
  type: 'info' | 'warning' | 'urgent';
  startAt: string;
  endAt: string;
  target: 'organizers' | 'homepage' | 'both';
  dismissible: boolean;
  font: 'inter' | 'jakarta' | 'serif' | 'system';
  bgColor: string;
  bgImagePath?: string;
  mobileImagePath?: string;
  contrastChecked: boolean;
  createdBy: string;
}

/* -------------------------------------------------------------------------- */
/* Ghana-specific helpers                                                     */
/* -------------------------------------------------------------------------- */

const GHANA_NETWORK_PREFIXES = ['20', '24', '25', '26', '27', '28', '29', '50', '54', '55', '57'];

/** Accepts 0XX / +233XX / 233XX formats and normalises to +233XXXXXXXXX. */
export function normalizeGhanaPhone(input: string): string | null {
  const digits = input.replace(/[^\d]/g, '');
  let local = digits;
  if (digits.startsWith('233') && digits.length === 12) local = '0' + digits.slice(3);
  else if (digits.startsWith('+233')) local = '0' + digits.slice(4);
  if (!/^0\d{9}$/.test(local)) return null;
  if (!GHANA_NETWORK_PREFIXES.includes(local.slice(1, 3))) return null;
  return '+233' + local.slice(1);
}

export function isValidGhanaPhone(input: string): boolean {
  return normalizeGhanaPhone(input) !== null;
}

/** Deterministic, non-reversible hash for duplicate detection / lookup indexes. */
export function hashIdentifier(value: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < value.length; i++) {
    h1 = Math.imul(h1 ^ value.charCodeAt(i), 0x01000193);
    h2 = Math.imul(h2 + value.charCodeAt(i), 0x85ebca6b);
  }
  return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0');
}

export function formatGHS(pesewas: number): string {
  return `GHS ${(pesewas / 100).toFixed(2)}`;
}

export function formatGhanaDate(iso: string, withTime = true): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: GHANA_TIMEZONE,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    ...(withTime ? { hour: '2-digit', minute: '2-digit', hour12: true } : {}),
  }).format(new Date(iso));
}

export function formatEventRange(event: EventDetails): string {
  const start = formatGhanaDate(event.startAt, Boolean(event.endAt));
  if (!event.endAt) return start;
  const sameDay =
    new Intl.DateTimeFormat('en-CA', { timeZone: GHANA_TIMEZONE, dateStyle: 'short' }).format(new Date(event.startAt)) ===
    new Intl.DateTimeFormat('en-CA', { timeZone: GHANA_TIMEZONE, dateStyle: 'short' }).format(new Date(event.endAt));
  const end = sameDay
    ? formatGhanaDate(event.endAt).split(', ').slice(-1)[0]
    : formatGhanaDate(event.endAt, false);
  return `${start} – ${end} GMT`;
}

export function computeOverShort(pricePesewas: number, paidPesewas: number, allowancePesewas = 0, tolerancePesewas = 0) {
  const difference = paidPesewas - pricePesewas;
  return {
    overByPesewas: difference > allowancePesewas ? difference - allowancePesewas : 0,
    shortByPesewas: difference < -tolerancePesewas ? -(difference + tolerancePesewas) : 0,
  };
}

export function isAlmostFull(taken: number, capacity?: number, threshold = 0.1): boolean {
  if (!capacity || capacity <= 0) return false;
  if (threshold >= 1) return capacity - taken <= threshold;
  return taken >= capacity * (1 - threshold);
}

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);
}

export function searchTokens(title: string): string[] {
  return Array.from(new Set(slugify(title).split('-').filter(Boolean)));
}

export function isSensitiveLabel(label: string): boolean {
  return /\b(pin|password|passcode|otp|secret)\b/i.test(label);
}

export function isMalformedTransactionId(value: string): boolean {
  return !/^[A-Za-z0-9][A-Za-z0-9\-]{5,39}$/.test(value.trim());
}

/** WCAG relative luminance, used for the announcement contrast checker. */
export function contrastRatio(hex1: string, hex2: string): number {
  const lum = (hex: string) => {
    const c = hex.replace('#', '');
    const vals = [0, 2, 4].map((i) => parseInt(c.slice(i, i + 2), 16) / 255);
    const [r, g, b] = vals.map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const a = lum(hex1);
  const b = lum(hex2);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/* -------------------------------------------------------------------------- */
/* Validation schemas                                                         */
/* -------------------------------------------------------------------------- */

const answerValue = z.union([z.string(), z.array(z.string()), z.number(), z.boolean()]);

export const registrationSubmissionSchema = z
  .object({
    programId: z.string().min(1),
    ticketTypeId: z.string().min(1),
    answers: z.record(answerValue),
    contact: z.object({
      name: z.string().trim().min(2, 'Enter your full name').max(120),
      email: z.string().trim().email('Enter a valid email').optional().or(z.literal('')),
      phone: z.string().trim().optional(),
    }),
    payment: z
      .object({
        methodId: z.string().min(1),
        transactionId: z.string().trim().min(6).max(40),
        amountPesewas: z.number().int().positive(),
        senderName: z.string().trim().min(2).max(120),
        senderPhone: z.string().trim().optional(),
        payerName: z.string().trim().optional(),
        referenceCode: z.string().trim().max(80).optional(),
        screenshotToken: z.string().optional(),
      })
      .optional(),
    captchaToken: z.string().optional(),
    draftId: z.string().optional(),
  })
  .superRefine((data, ctx) => {
    if (data.contact.phone) {
      const normalized = normalizeGhanaPhone(data.contact.phone);
      if (!normalized) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['contact', 'phone'], message: 'Enter a valid Ghana phone number' });
      }
    }
    if (data.payment && isMalformedTransactionId(data.payment.transactionId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['payment', 'transactionId'],
        message: 'Enter a valid transaction ID or bank reference',
      });
    }
  });

export type RegistrationSubmission = z.infer<typeof registrationSubmissionSchema>;

export const ticketLookupSchema = z.object({
  programId: z.string().min(1),
  identifier: z.string().trim().min(4),
  captchaToken: z.string().optional(),
});

export const checkInSchema = z.object({
  ticketCode: z.string().min(24),
  programId: z.string().min(1),
  scannerToken: z.string().min(1),
});

export const feedbackSubmissionSchema = z.object({
  programId: z.string().min(1),
  ticketCode: z.string().min(24).optional(),
  answers: z.record(answerValue),
  rating: z.number().int().min(1).max(5).optional(),
  captchaToken: z.string().optional(),
});

export const eventDetailsSchema = z.object({
  startAt: z.string().datetime({ offset: true }),
  endAt: z.string().datetime({ offset: true }).optional(),
  timezone: z.literal(GHANA_TIMEZONE),
  venue: z.string().max(200).optional(),
  mapsUrl: z
    .string()
    .url()
    .refine((v) => /google\.com\/maps|goo\.gl\/maps/i.test(v), 'Use a Google Maps link')
    .optional(),
  mode: z.enum(['in_person', 'online', 'hybrid']),
});

/** Plain-text guard used everywhere user text is stored. */
export const plainTextSchema = z.string().trim().max(5000).refine((v) => !/<[a-z][\s\S]*>/i.test(v), 'HTML is not allowed');

export const announcementSchema = z.object({
  title: plainTextSchema,
  body: plainTextSchema,
  type: z.enum(['info', 'warning', 'urgent']),
  startAt: z.string().datetime({ offset: true }),
  endAt: z.string().datetime({ offset: true }),
  target: z.enum(['organizers', 'homepage', 'both']),
  dismissible: z.boolean(),
  font: z.enum(['inter', 'jakarta', 'serif', 'system']),
  bgColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  contrastChecked: z.literal(true),
});

export type AnnouncementInput = z.infer<typeof announcementSchema>;
