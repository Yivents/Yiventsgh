import {
  DEFAULT_ARCHIVE_AFTER_DAYS,
  DEFAULT_RETENTION_MONTHS,
  GHANA_TIMEZONE,
  type Announcement,
  type RegistrationStatus,
} from '@yivents/shared';

/** Public program pages are owned outside the organiser area; this is the link we generate. */
export const PUBLIC_PROGRAM_PATH = '/e';
export const SPONSOR_LIMIT_FALLBACK = 8;

export function publicProgramUrl(slug: string): string {
  const origin = typeof window === 'undefined' ? '' : window.location.origin;
  return `${origin}${PUBLIC_PROGRAM_PATH}/${encodeURIComponent(slug)}`;
}

/** Ghana uses UTC+0 all year, so a `datetime-local` value maps to an ISO `Z` time. */
export function fromDateTimeLocal(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}:00Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export function toDateTimeLocal(iso?: string): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: GHANA_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}T${part('hour')}:${part('minute')}`;
}

export function ghsToPesewas(value: string | number): number {
  const amount = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(amount) || amount < 0) return 0;
  return Math.round(amount * 100);
}

export function pesewasToInput(value?: number): string {
  return ((value ?? 0) / 100).toFixed(2);
}

export function chunk<T>(items: T[], size: number): T[][] {
  const groups: T[][] = [];
  for (let i = 0; i < items.length; i += size) groups.push(items.slice(i, i + size));
  return groups;
}

export function friendlyError(error: unknown, fallback = 'Something went wrong. Please try again.'): string {
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? String((error as { code?: unknown }).code ?? '')
      : '';
  const known: Record<string, string> = {
    'permission-denied': 'You do not have permission to do that.',
    unauthenticated: 'Please sign in and try again.',
    'auth/invalid-email': 'Enter a valid email address.',
    'auth/user-not-found': 'We could not find an account with that email.',
    'auth/wrong-password': 'That password is not correct.',
    'auth/invalid-credential': 'That email or password is not correct.',
    'auth/email-already-in-use': 'An account already exists with that email. Try signing in.',
    'auth/weak-password': 'Use at least 6 characters in your password.',
    'auth/popup-closed-by-user': 'The Google sign-in window was closed. Try again.',
    'auth/too-many-requests': 'Too many attempts. Please wait a moment and try again.',
    'functions/already-exists': 'That link is already taken. Try another one.',
    'functions/failed-precondition': 'That change is no longer allowed. Refresh and try again.',
  };
  if (known[code]) return known[code];
  const message =
    typeof error === 'object' && error !== null && 'message' in error
      ? String((error as { message?: unknown }).message ?? '')
      : '';
  return message.replace(/^FirebaseError:\s*/, '') || fallback;
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export function downloadDataUrl(dataUrl: string, filename: string): void {
  const link = document.createElement('a');
  link.href = dataUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

export function isActiveAnnouncement(item: Announcement, now = new Date()): boolean {
  const start = new Date(item.startAt).getTime();
  const end = new Date(item.endAt).getTime();
  return (
    !Number.isNaN(start) &&
    !Number.isNaN(end) &&
    start <= now.getTime() &&
    now.getTime() <= end &&
    (item.target === 'organizers' || item.target === 'both')
  );
}

export function statusTone(status: RegistrationStatus | string): 'neutral' | 'success' | 'danger' | 'warning' | 'info' {
  if (status === 'verified' || status === 'approved') return 'success';
  if (status === 'rejected' || status === 'cancelled' || status === 'archived') return 'danger';
  if (status === 'pending' || status === 'waitlisted') return 'warning';
  if (status === 'upcoming' || status === 'ongoing') return 'info';
  return 'neutral';
}

export const DEFAULT_RETENTION = {
  archiveAfterDays: DEFAULT_ARCHIVE_AFTER_DAYS,
  retentionMonths: DEFAULT_RETENTION_MONTHS,
  screenshotRetentionDays: 90,
};
