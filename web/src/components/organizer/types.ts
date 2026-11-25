import type { Announcement, LinkReleaseRule, Program, TicketLayout } from '@yivents/shared';

/**
 * A few Phase 1 organiser settings are not named in @yivents/shared yet. They
 * live inside `programs/{id}.settings` so the Firestore create allowlist stays
 * valid; this type documents the temporary extension.
 */
export interface ProgramSettingsExtras {
  /** Private meeting link. Never copied into a public projection. */
  meetingLink?: string;
  /** Copy shown to eligible participants alongside the link. */
  meetingMessage?: string;
  /** Global default; ticket types may override with their own rule. */
  defaultLinkReleaseRule?: LinkReleaseRule;
  /** Extra pesewas a sender may add above the ticket price without being "over". */
  allowancePesewas?: number;
  /** Pesewas of shortfall that are tolerated before a payment is flagged. */
  tolerancePesewas?: number;
  ticketLayout?: TicketLayout;
  reopenCapacityOnReject?: boolean;
}

export type ProgramDoc = Omit<Program, 'settings'> & {
  settings: Program['settings'] & ProgramSettingsExtras;
};

/** `programs/{programId}/helpers/{uid}` — granting is callable-only. */
export interface HelperDoc {
  uid: string;
  email?: string;
  displayName?: string;
  role?: string;
  status?: string;
  inviteUrl?: string;
  createdAt?: string;
}

/** Messages are written through `sendAdminMessage`; shapes vary by sender. */
export interface AdminMessageDoc {
  id: string;
  body?: string;
  text?: string;
  message?: string;
  senderUid?: string;
  senderName?: string;
  createdAt?: string;
  at?: string;
}

export type AnnouncementDoc = Announcement;

export interface CallResultWithUrl {
  url?: string;
  signedUrl?: string;
  downloadUrl?: string;
  inviteUrl?: string;
  scannerUrl?: string;
  link?: string;
  pin?: string;
  token?: string;
}

export interface RecipientResult {
  emails?: string[];
  recipients?: Array<{ email?: string; contact?: { email?: string } }>;
  mailto?: string;
}
