/** Server-side document shapes: shared types plus trusted-only fields. */
import type {
  LinkReleaseRule,
  PaymentRecord,
  Program,
  Registration,
  TicketType,
} from '@yivents/shared';

/** Phase 1 tolerance fields may not exist on older program documents. */
export interface ProgramSettingsExtras extends Program['settings'] {
  paymentAllowancePesewas?: number;
  paymentTolerancePesewas?: number;
  /** Plain-text instructions registrants see before sending MoMo/bank payment. */
  paymentInstructions?: string;
  maxPaymentPesewas?: number;
  linkReleaseRule?: LinkReleaseRule;
  /** Internal map of ticket type id -> meeting URL, never copied to projections. */
  meetingLinks?: Record<string, string>;
}

export interface PaymentRecordExtras extends PaymentRecord {
  verified?: boolean;
  verificationStatus?: 'unverified' | 'verified' | 'unpaid';
}

export interface RegistrationDoc extends Omit<Registration, 'payment'> {
  payment?: PaymentRecordExtras;
  updatedAt?: string;
  updatedBy?: string;
}

export type TicketInternalStatus = 'valid' | 'pending_approval' | 'invalid' | 'cancelled';

/** Only callable functions may read this collection (Firestore rules deny all). */
export interface TicketDoc {
  code: string;
  programId: string;
  programTitle: string;
  registrationId: string;
  ticketTypeId: string;
  ticketTypeName: string;
  internalStatus: TicketInternalStatus;
  contactName: string;
  event: Program['event'];
  createdAt: string;
}

export interface ScannerDoc {
  tokenHash: string;
  pinHash?: string;
  enabled: boolean;
  createdAt: string;
  updatedAt?: string;
}

export interface CapacityCounterDoc {
  programId: string;
  ticketTypeId: string;
  taken: number;
  updatedAt: string;
}

export interface AuditEntry {
  action: string;
  actorUid?: string;
  actorRole?: string;
  programId?: string;
  targetId?: string;
  at: string;
  details?: Record<string, unknown>;
}

export function settingsOf(program: Pick<Program, 'settings'>): ProgramSettingsExtras {
  return program.settings as ProgramSettingsExtras;
}

export function ticketTypeName(programId: string, ticketTypes: TicketType[], id: string): string {
  return ticketTypes.find((t) => t.id === id)?.name ?? id;
}
