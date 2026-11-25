import type { Metadata } from 'next';
import '@/components/public/public.css';
import { formatGhanaDate } from '@yivents/shared';
import { EmptyState, Badge } from '@yivents/ui';
import { getCachedListings } from '@/components/public/public-data';
import { HOST_EVENT_URL, PublicShell } from '@/components/public/site-chrome';
import { plainText } from '@/components/public/types';

export const metadata: Metadata = {
  title: 'Find events',
  description: 'Discover events, register in minutes and get your QR ticket on Yivents.',
};

function dateLabel(iso: string): string {
  if (!iso) return 'Date to be announced';
  try {
    return formatGhanaDate(iso, false);
  } catch {
    return 'Date to be announced';
  }
}

const MODE_LABELS: Record<string, string> = {
  in_person: 'In person',
  online: 'Online',
  hybrid: 'Hybrid',
};

export default async function HomePage({ searchParams }: { searchParams: Promise<{ q?: string | string[] }> }) {
  const params = await searchParams;
  const rawQuery = Array.isArray(params.q) ? params.q[0] : params.q;
  const query = plainText(rawQuery).slice(0, 80);
  // PublicListing.searchTokens holds individual slugified title words.
  const token = query.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').split('-')[0] ?? '';
  const listings = await getCachedListings(token);

  return (
    <PublicShell>
      <section className="hero">
        <div className="yv-container pub-hero-inner">
          <div className="yv-stack">
            <p><Badge tone="info">Registration and tickets for Ghanaian events</Badge></p>
            <h1>Find your next event</h1>
            <p className="yv-muted">
              Discover an event, register in a few minutes, pay the organizer directly if it is paid, and keep your QR ticket
              on your phone. You never need an account.
            </p>
            <form className="pub-search-form" method="get" action="/" role="search">
              <label className="yv-visually-hidden" htmlFor="event-search">Search events by name</label>
              <input id="event-search" name="q" type="search" defaultValue={query} placeholder="Search by event name" />
              <button className="yv-btn yv-btn-primary" type="submit">Search</button>
            </form>
          </div>
          <div className="pub-hero-art" aria-hidden="true">
            <img src="/brand/logo.png" alt="" width={180} height={180} />
          </div>
        </div>
      </section>

      <section className="section yv-container" aria-labelledby="listings-heading">
        <div className="yv-spread">
          <div>
            <h2 id="listings-heading">{query ? `Results for “${query}”` : 'Upcoming events'}</h2>
            <p className="yv-muted">Only events approved for public listing appear here.</p>
          </div>
          <a className="yv-btn yv-btn-accent" href={HOST_EVENT_URL}>Host your event</a>
        </div>

        {listings.length === 0 ? (
          <EmptyState
            title={query ? 'No events matched that name' : 'No public events yet'}
            message={
              query
                ? 'Try a shorter name, or ask the organizer for the direct event link.'
                : 'Events appear here once their organizers publish them. Check back soon.'
            }
            action={
              <a className="yv-btn yv-btn-outline" href="/">See all events</a>
            }
          />
        ) : (
          <div className="grid" style={{ marginTop: '1.5rem' }}>
            {listings.map((listing) => (
              <a className="pub-card-link" href={`/e/${encodeURIComponent(listing.slug)}`} key={listing.programId}>
                <div className="yv-card">
                  <img
                    className="pub-card-media"
                    src={listing.coverUrl}
                    alt=""
                    loading="lazy"
                    decoding="async"
                  />
                  <h3 className="pub-card-title">{listing.title}</h3>
                  <p className="yv-tiny yv-muted">{listing.summary || 'Details and registration inside.'}</p>
                  <div className="pub-meta-list">
                    <span>{dateLabel(listing.startAt)}</span>
                    {listing.venue ? <span>{listing.venue}</span> : null}
                    <span>{MODE_LABELS[listing.mode] ?? 'Event'}</span>
                  </div>
                </div>
              </a>
            ))}
          </div>
        )}
      </section>

      <section className="section yv-container" aria-labelledby="how-heading">
        <h2 id="how-heading">How Yivents works</h2>
        <div className="grid">
          <div className="yv-card">
            <h3>1. Choose an event</h3>
            <p className="yv-muted">Use the search above or an organizer&apos;s private link. No registrant account is needed.</p>
          </div>
          <div className="yv-card">
            <h3>2. Register</h3>
            <p className="yv-muted">Answer the organizer&apos;s questions. For paid events, pay the organizer directly by MoMo or bank.</p>
          </div>
          <div className="yv-card">
            <h3>3. Keep your ticket</h3>
            <p className="yv-muted">Look up your ticket any time and download it as PNG or PDF. Show the QR code at the door.</p>
          </div>
        </div>
        <p style={{ marginTop: '1.5rem' }}>
          <a className="yv-btn yv-btn-primary" href={HOST_EVENT_URL}>Host your event</a>
        </p>
      </section>
    </PublicShell>
  );
}
