/**
 * SERVER-ONLY public reads. Never query `programs`, `registrations` or any
 * private subcollection here: only the two public projections are read.
 * Admin SDK getters are lazy so `next build` works without credentials.
 */
import { unstable_cache } from 'next/cache';
import type { DocumentData, Query } from 'firebase-admin/firestore';
import { getAdminBucket, getAdminDb } from '@/lib/firebase/admin';
import { CURRENCY, GHANA_TIMEZONE, MAX_SLIDESHOW_IMAGES } from '@yivents/shared';
import type { Branding, EventDetails, FieldType, PaymentMethod, ProgramStatus, TicketSummary } from '@yivents/shared';
import type { PublicFormField, PublicListingView, PublicPaymentMethod, PublicProgramView } from './types';
import { plainText, safeHttpUrl } from './types';

/** Inline placeholder used when Storage signed URLs are unavailable (e.g. at build). */
const PLACEHOLDER_IMAGE = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="420"><rect width="640" height="420" fill="#EAF1FA"/><circle cx="320" cy="180" r="64" fill="#F08010"/><text x="320" y="300" text-anchor="middle" font-family="sans-serif" font-size="30" fill="#104080">Event flyer coming soon</text></svg>',
)}`;

const DEFAULT_BRANDING: Branding = {
  primaryColor: '#104080',
  accentColor: '#F08010',
  backgroundColor: '#FFFFFF',
  themePreset: 'logo',
  font: 'inter',
};

type Loose = Record<string, unknown>;

function asLoose(value: unknown): Loose {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Loose) : {};
}

function asArray<T = unknown>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function asBool(value: unknown): boolean {
  return value === true;
}

/** Firestore Timestamps and ISO strings both occur in projections over time. */
function asIso(value: unknown): string {
  if (!value) return '';
  if (typeof value === 'object' && typeof (value as { toDate?: unknown }).toDate === 'function') {
    try {
      return (value as { toDate: () => Date }).toDate().toISOString();
    } catch {
      return '';
    }
  }
  if (value instanceof Date) return value.toISOString();
  return typeof value === 'string' ? value : '';
}

function asBranding(value: unknown): Branding {
  return { ...DEFAULT_BRANDING, ...asLoose(value) } as Branding;
}

async function signedImageUrl(path?: string): Promise<string | undefined> {
  if (!path) return undefined;
  try {
    const [url] = await getAdminBucket().file(path).getSignedUrl({
      action: 'read',
      expires: Date.now() + 15 * 60 * 1000,
    });
    return url;
  } catch {
    // No credentials in build/preview: callers fall back to the placeholder.
    return undefined;
  }
}

async function resolveOptionalImages(paths: string[]): Promise<Array<string | undefined>> {
  return Promise.all(paths.map(async (path) => (path ? await signedImageUrl(path) : undefined)));
}

async function resolveImages(paths: string[]): Promise<string[]> {
  const urls = await resolveOptionalImages(paths);
  return urls.map((url) => url ?? PLACEHOLDER_IMAGE);
}

function publicEvent(value: unknown): EventDetails {
  const data = asLoose(value);
  return {
    startAt: asIso(data.startAt),
    ...(asIso(data.endAt) ? { endAt: asIso(data.endAt) } : {}),
    timezone: GHANA_TIMEZONE,
    ...(plainText(data.venue) ? { venue: plainText(data.venue) } : {}),
    ...(safeHttpUrl(data.mapsUrl) ? { mapsUrl: safeHttpUrl(data.mapsUrl) } : {}),
    mode: (['in_person', 'online', 'hybrid'] as const).includes(data.mode as EventDetails['mode'])
      ? (data.mode as EventDetails['mode'])
      : 'in_person',
  };
}

function publicFields(value: unknown): PublicFormField[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  return value.map((raw, index) => {
    const field = asLoose(raw);
    return {
      id: plainText(field.id, `field_${index + 1}`),
      type: (plainText(field.type) || 'short_text') as FieldType,
      label: plainText(field.label, 'Question'),
      ...(plainText(field.description) ? { description: plainText(field.description) } : {}),
      required: asBool(field.required),
      section: plainText(field.section, 'Your details'),
      order: asNumber(field.order, index + 1),
      ...(Array.isArray(field.options)
        ? { options: field.options.map((option) => plainText(option)).filter(Boolean) }
        : {}),
      ...(plainText(field.imagePath) ? { imageUrl: plainText(field.imagePath) } : {}),
      ...(plainText(field.caption) ? { caption: plainText(field.caption) } : {}),
      ...(typeof field.min === 'number' ? { min: field.min } : {}),
      ...(typeof field.max === 'number' ? { max: field.max } : {}),
      ...(field.sensitiveFlag === 'blocked' || field.sensitiveFlag === 'flagged'
        ? { sensitiveFlag: field.sensitiveFlag }
        : {}),
    };
  });
}

function publicPaymentMethods(value: unknown): PublicPaymentMethod[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const methods = value
    .map((raw, index) => {
      const m = asLoose(raw);
      const method: PublicPaymentMethod = {
        id: plainText(m.id, `method_${index + 1}`),
        type: m.type === 'bank' ? 'bank' : 'momo',
        accountName: plainText(m.accountName, 'Organizer'),
        enabled: m.enabled !== false,
        currency: CURRENCY,
        order: asNumber(m.order, index + 1),
      };
      if (m.network === 'MTN MoMo' || m.network === 'Telecel Cash' || m.network === 'AirtelTigo Money') {
        method.network = m.network;
      }
      if (plainText(m.number)) method.number = plainText(m.number);
      if (plainText(m.accountNumber)) method.accountNumber = plainText(m.accountNumber);
      if (plainText(m.bankName)) method.bankName = plainText(m.bankName);
      if (plainText(m.instructions)) method.instructions = plainText(m.instructions);
      return method;
    })
    .filter((method) => method.enabled !== false)
    .sort((a, b) => a.order - b.order);
  return methods.length ? methods : undefined;
}

/** Read one public program by slug (the slug is the capability for link-only events). */
export async function getPublicProgram(slug: string): Promise<PublicProgramView | null> {
  if (!slug) return null;
  try {
    const snap = await getAdminDb().collection('publicPrograms').doc(slug).get();
    if (!snap.exists) return null;
    const data = snap.data() ?? {};
    const imagePaths = asArray<string>(data.imagePaths ?? data.slideshow)
      .filter((path): path is string => typeof path === 'string')
      .slice(0, MAX_SLIDESHOW_IMAGES);
    const branding = asBranding(data.branding);
    const imageUrls = await resolveImages(imagePaths);
    const logoUrl = await signedImageUrl(branding.logoPath);
    const event = publicEvent(data.event);
    const formFields = publicFields(data.formFields);
    const paymentMethods = publicPaymentMethods(data.paymentMethods);
    const speakerPhotoPaths = asArray(data.speakers).map((raw) => plainText(asLoose(raw).photoPath));
    const sponsorLogoPaths = asArray(data.sponsors).map((raw) => plainText(asLoose(raw).logoPath));
    const fieldImagePaths = (formFields ?? []).map((field) => field.imageUrl ?? '');
    const [speakerPhotoUrls, sponsorLogoUrls, fieldImageUrls] = await Promise.all([
      resolveOptionalImages(speakerPhotoPaths),
      resolveOptionalImages(sponsorLogoPaths),
      resolveOptionalImages(fieldImagePaths),
    ]);
    const deadline = asIso(data.registrationDeadline);
    const status = (plainText(data.status) || 'upcoming') as ProgramStatus;
    const capacity = asLoose(data.capacityState);
    const total = typeof capacity.total === 'number' ? capacity.total : undefined;
    const taken = asNumber(capacity.taken);
    const explicitRegistrationOpen = data.registrationOpen;
    const deadlineOpen = !deadline || new Date(deadline).getTime() > Date.now();
    const statusOpen = status === 'upcoming' || status === 'ongoing';

    const program: PublicProgramView = {
      programId: plainText(data.programId, slug),
      slug: plainText(data.slug, slug),
      title: plainText(data.title, 'Event'),
      description: plainText(data.description),
      imagePaths,
      imageUrls,
      ...(logoUrl ? { logoUrl } : {}),
      event,
      registrationDeadline: deadline,
      branding,
      ticketTypes: asArray<TicketSummary>(data.ticketTypes).map((ticket) => ({
        id: plainText(ticket?.id),
        name: plainText(ticket?.name, 'General admission'),
        pricePesewas: asNumber(ticket?.pricePesewas),
        currency: CURRENCY,
      })),
      speakers: asArray(data.speakers).map((raw, index) => {
        const speaker = asLoose(raw);
        return {
          name: plainText(speaker.name, 'Speaker'),
          ...(plainText(speaker.topic) ? { topic: plainText(speaker.topic) } : {}),
          ...(plainText(speaker.time) ? { time: plainText(speaker.time) } : {}),
          ...(plainText(speaker.notes) ? { notes: plainText(speaker.notes) } : {}),
          ...(speakerPhotoUrls[index] ? { photoUrl: speakerPhotoUrls[index] } : {}),
        };
      }),
      sponsors: asArray(data.sponsors).map((raw, index) => {
        const sponsor = asLoose(raw);
        return {
          name: plainText(sponsor.name, 'Sponsor'),
          ...(safeHttpUrl(sponsor.url) ? { url: safeHttpUrl(sponsor.url) } : {}),
          ...(sponsorLogoUrls[index] ? { logoUrl: sponsorLogoUrls[index] } : {}),
        };
      }),
      capacityState: {
        ...(total !== undefined ? { total } : {}),
        taken,
        almostFull: asBool(capacity.almostFull) || (total !== undefined && taken >= total - Math.max(1, Math.ceil(total * 0.1)) && taken < total),
        full: asBool(capacity.full) || (total !== undefined && taken >= total),
      },
      status,
      hasFeedbackForm: asBool(data.hasFeedbackForm),
      registrationOpen:
        explicitRegistrationOpen === false ? false : explicitRegistrationOpen === true || (statusOpen && deadlineOpen),
      privacyNotice: plainText(
        data.privacyNotice,
        'Your details are shared with the event organizer only, for registration and ticketing. Never share your PIN or password.',
      ),
      ...(formFields
        ? {
            formFields: formFields.map((field, index) => ({
              ...field,
              ...(fieldImageUrls[index] ? { imageUrl: fieldImageUrls[index] } : { imageUrl: undefined }),
            })),
          }
        : {}),
      ...(paymentMethods ? { paymentMethods } : {}),
      ...(plainText(data.paymentInstructions) ? { paymentInstructions: plainText(data.paymentInstructions) } : {}),
      ...(plainText(data.plan) ? { plan: plainText(data.plan).toLowerCase() } : {}),
    };
    return program;
  } catch (error) {
    console.warn('[public] publicPrograms read unavailable', error);
    return null;
  }
}

async function fetchListings(term: string): Promise<PublicListingView[]> {
  try {
    const db = getAdminDb();
    let query: Query<DocumentData> = db
      .collection('publicListings')
      .where('status', 'in', ['upcoming', 'ongoing']);
    if (term) {
      // Index: searchTokens ARRAY_CONTAINS + status + startAt.
      query = query.where('searchTokens', 'array-contains', term).orderBy('startAt', 'asc');
    } else {
      query = query.orderBy('startAt', 'asc');
    }
    const snap = await query.limit(30).get();
    const listings = snap.docs
      .map((doc) => {
        const data = doc.data();
        const startAt = asIso(data.startAt);
        const endAt = asIso(data.endAt);
        return {
          programId: plainText(data.programId, doc.id),
          slug: plainText(data.slug, doc.id),
          title: plainText(data.title, 'Event'),
          summary: plainText(data.summary),
          ...(plainText(data.coverPath) ? { coverPath: plainText(data.coverPath) } : {}),
          startAt,
          ...(endAt ? { endAt } : {}),
          ...(plainText(data.venue) ? { venue: plainText(data.venue) } : {}),
          mode: (['in_person', 'online', 'hybrid'] as const).includes(data.mode as PublicListingView['mode'])
            ? (data.mode as PublicListingView['mode'])
            : 'in_person',
          searchTokens: asArray<string>(data.searchTokens).filter((token) => typeof token === 'string'),
          approvalStatus: (plainText(data.approvalStatus) || 'pending') as PublicListingView['approvalStatus'],
          status: (plainText(data.status) || 'upcoming') as PublicListingView['status'],
          listedAt: asIso(data.listedAt),
        } satisfies PublicListingView;
      })
      // Admin SDK bypasses rules, so enforce the same public-list filter here.
      .filter((item) => item.approvalStatus === 'approved' && ['upcoming', 'ongoing'].includes(item.status));

    return Promise.all(
      listings.map(async (item) => ({
        ...item,
        coverUrl: (await signedImageUrl(item.coverPath)) ?? PLACEHOLDER_IMAGE,
      })),
    );
  } catch (error) {
    console.warn('[public] publicListings read unavailable', error);
    return [];
  }
}

/** Homepage search cache: 5 minutes, as required for public projections. */
export const getCachedListings = unstable_cache(async (term: string) => fetchListings(term), ['public-listings-v1'], {
  revalidate: 300,
  tags: ['public-listings'],
});
