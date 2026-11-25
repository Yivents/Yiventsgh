/**
 * Public-side view models. These are the ONLY shapes passed from server
 * components to public client components. They never contain registrant data.
 */
import type {
  Branding,
  EventDetails,
  FormField,
  PaymentMethod,
  ProgramStatus,
  PublicListing,
  TicketSummary,
} from '@yivents/shared';

export type AnswerValue = string | string[] | number | boolean;

export interface PublicFormField extends FormField {
  /** Resolved Storage download URL, never a raw private path. */
  imageUrl?: string;
}

export interface PublicPaymentMethod extends PaymentMethod {
  /** Optional human-facing instructions safe to show to registrants. */
  instructions?: string;
}

export interface PublicProgramView {
  programId: string;
  slug: string;
  title: string;
  description: string;
  imagePaths: string[];
  imageUrls: string[];
  logoUrl?: string;
  event: EventDetails;
  registrationDeadline: string;
  branding: Branding;
  ticketTypes: TicketSummary[];
  speakers: Array<{ name: string; topic?: string; time?: string; notes?: string; photoUrl?: string }>;
  sponsors: Array<{ name: string; logoUrl?: string; url?: string }>;
  capacityState: { total?: number; taken: number; almostFull: boolean; full: boolean };
  status: ProgramStatus;
  hasFeedbackForm: boolean;
  registrationOpen: boolean;
  privacyNotice: string;
  /** Public-safe projection extension (see contract gaps in the hand-off notes). */
  formFields?: PublicFormField[];
  paymentMethods?: PublicPaymentMethod[];
  paymentInstructions?: string;
  plan?: string;
}

export interface PublicListingView extends PublicListing {
  coverUrl?: string;
}

/** Tolerant view of `lookupTicket` / `checkIn` responses; the server is the authority. */
export interface TicketLookupResult {
  code?: string;
  ticketCode?: string;
  programId?: string;
  programTitle?: string;
  eventName?: string;
  attendeeName?: string;
  branding?: Branding;
  event?: EventDetails;
  showAmountOnReceipt?: boolean;
  name?: string;
  ticketTypeName?: string;
  dateLabel?: string;
  venueLabel?: string;
  venue?: string;
  documentKind?: 'ticket' | 'receipt';
  showAmount?: boolean;
  amountLabel?: string;
  primaryColor?: string;
  accentColor?: string;
  logoUrl?: string;
  meetingLink?: string;
  meetingLinkRule?: string;
  meetingLinkReleased?: boolean;
  meetingLinkReleasedAt?: string;
  approved?: boolean;
  replayLink?: string;
  checkedInAt?: string;
  transactionId?: string;
  amountPesewas?: number;
  payment?: { transactionId?: string; amountPesewas?: number };
  reason?: string;
  registrationId?: string;
  message?: string;
  oneTimeCode?: string;
  privateLink?: string;
  result?: string;
  status?: string;
  outcome?: string;
  [key: string]: unknown;
}

/** Callable responses are not fully specified in the contract; unwrap common envelopes. */
export function unwrapLookup(raw: unknown): TicketLookupResult {
  const top = (raw ?? {}) as TicketLookupResult;
  const nested = top.ticket ?? top.data ?? top.result;
  if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
    return { ...top, ...(nested as TicketLookupResult) };
  }
  return top;
}

export function resultKind(result: TicketLookupResult): string {
  const raw = String(result.result ?? result.reason ?? result.outcome ?? result.status ?? result.kind ?? '').toLowerCase();
  return raw.replace(/[\s-]+/g, '_');
}

/** Only http(s) links are ever rendered as anchors — no javascript: URLs. */
export function safeHttpUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  try {
    const url = new URL(value.trim());
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

/** React escapes everything; this makes the plain-text-only policy explicit. */
export function plainText(value: unknown, fallback = ''): string {
  if (typeof value !== 'string') return fallback;
  return value.replace(/[\u0000-\u001F]/g, ' ').replace(/<[a-z][\s\S]*>/gi, '').trim() || fallback;
}
