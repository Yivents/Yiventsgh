import type { Metadata } from 'next';
import '@/components/public/public.css';
import type { CSSProperties } from 'react';
import { formatEventRange, formatGhanaDate } from '@yivents/shared';
import { Badge, Card, EmptyState } from '@yivents/ui';
import { FlyerSlideshow } from '@/components/public/FlyerSlideshow';
import { RegistrationForm } from '@/components/public/RegistrationForm';
import { getPublicProgram } from '@/components/public/public-data';
import { LOOKUP_URL, PublicShell, REPORT_URL } from '@/components/public/site-chrome';
import { safeHttpUrl } from '@/components/public/types';

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const program = await getPublicProgram(slug);
  const title = program?.title ?? 'Event';
  const description = program?.description.slice(0, 180) || 'Register for this event and get your QR ticket on Yivents.';
  const ogUrl = `/api/og?slug=${encodeURIComponent(slug)}&title=${encodeURIComponent(title)}&description=${encodeURIComponent(description)}`;
  return {
    title,
    description,
    alternates: { canonical: `/e/${encodeURIComponent(slug)}` },
    openGraph: { type: 'website', title, description, url: `/e/${encodeURIComponent(slug)}`, images: [{ url: ogUrl, width: 1200, height: 630, alt: title }] },
    twitter: { card: 'summary_large_image', title, description, images: [ogUrl] },
  };
}

function safeDate(iso: string, withTime = true): string {
  if (!iso) return '';
  try {
    return formatGhanaDate(iso, withTime);
  } catch {
    return '';
  }
}

export default async function EventPage({ params }: Props) {
  const { slug } = await params;
  const program = await getPublicProgram(slug);

  if (!program) {
    return (
      <PublicShell>
        <div className="section yv-container">
          <EmptyState
            title="This event is not available"
            message="The link may be wrong, or the organizer has not published this event. Ask the organizer for the current link."
            action={<a className="yv-btn yv-btn-primary" href="/">Find events</a>}
          />
        </div>
      </PublicShell>
    );
  }

  const brandStyle = {
    '--brand-primary': program.branding.primaryColor,
    '--brand-accent': program.branding.accentColor,
  } as CSSProperties;

  let dateText = 'Date to be announced';
  try {
    if (program.event.startAt) dateText = formatEventRange(program.event);
  } catch {
    // Keep the friendly fallback when a projection has a malformed date.
  }

  const closedReason =
    program.status === 'ended'
      ? 'This event has ended.'
      : program.status === 'archived'
        ? 'This event has been archived.'
        : program.capacityState.full
          ? 'Registration is full.'
          : !program.registrationOpen
            ? 'Registration is closed for this event.'
            : '';
  const deadline = safeDate(program.registrationDeadline);
  const mapsUrl = safeHttpUrl(program.event.mapsUrl);
  const modeLabel = program.event.mode === 'online' ? 'Online event' : program.event.mode === 'hybrid' ? 'Hybrid event' : 'In-person event';
  // PublicProgram has no plan field in the shared contract; treat missing plan
  // as free so branding credit appears on free pages by default.
  const freePlan = !program.plan || ['free', 'starter'].includes(program.plan);

  return (
    <div data-brand style={brandStyle}>
      <PublicShell>
        <div className="section yv-container yv-stack">
          <div className="yv-spread">
            <p className="yv-muted">Event details</p>
            <div className="yv-row">
              {program.capacityState.almostFull && !program.capacityState.full ? <Badge tone="warning">Almost full</Badge> : null}
              {closedReason ? <Badge tone="danger">Closed</Badge> : <Badge tone="success">Registration open</Badge>}
            </div>
          </div>

          <div className="pub-event-layout">
            <div className="yv-stack">
              <FlyerSlideshow images={program.imageUrls.slice(0, 8)} title={program.title} />

              <section aria-labelledby="about-heading">
                <h1 id="about-heading">{program.title}</h1>
                {program.description ? (
                  <p className="pub-description">{program.description}</p>
                ) : (
                  <p className="yv-muted">The organizer has not added a description yet.</p>
                )}
              </section>

              <Card>
                <h2>Date and venue</h2>
                <div className="pub-detail-block">
                  <p><strong>{dateText}</strong></p>
                  <p>{program.event.venue ? program.event.venue : 'Venue to be confirmed'}</p>
                  <p className="yv-tiny yv-muted">{modeLabel}</p>
                  {mapsUrl ? (
                    <p><a href={mapsUrl} target="_blank" rel="noopener noreferrer">Open in Google Maps</a></p>
                  ) : null}
                </div>
                {deadline ? <p className="yv-tiny yv-muted">Registration deadline: {deadline}</p> : null}
              </Card>

              {program.speakers.length ? (
                <section aria-labelledby="speakers-heading">
                  <h2 id="speakers-heading">Speakers</h2>
                  {program.speakers.map((speaker, index) => (
                    <div className="pub-speaker" key={`${speaker.name}-${index}`}>
                      {speaker.photoUrl ? <img src={speaker.photoUrl} alt="" loading="lazy" /> : null}
                      <div>
                        <strong>{speaker.name}</strong>
                        {speaker.topic ? <p className="yv-muted">{speaker.topic}</p> : null}
                        {speaker.time ? <p className="yv-tiny yv-muted">{speaker.time}</p> : null}
                        {speaker.notes ? <p className="yv-tiny">{speaker.notes}</p> : null}
                      </div>
                    </div>
                  ))}
                </section>
              ) : null}

              {program.sponsors.length ? (
                <section aria-labelledby="sponsors-heading">
                  <h2 id="sponsors-heading">Sponsors</h2>
                  <div className="grid">
                    {program.sponsors.map((sponsor, index) => {
                      const inner = (
                        <>
                          {sponsor.logoUrl ? <img src={sponsor.logoUrl} alt="" loading="lazy" /> : null}
                          <span>{sponsor.name}</span>
                        </>
                      );
                      return sponsor.url ? (
                        <a className="pub-sponsor" href={sponsor.url} target="_blank" rel="noopener noreferrer" key={`${sponsor.name}-${index}`}>
                          {inner}
                        </a>
                      ) : (
                        <div className="pub-sponsor" key={`${sponsor.name}-${index}`}>{inner}</div>
                      );
                    })}
                  </div>
                </section>
              ) : null}
            </div>

            <aside className="pub-sticky" aria-labelledby="register-heading">
              <Card>
                <h2 id="register-heading">Register</h2>
                {program.capacityState.total ? (
                  <p className="yv-tiny yv-muted">
                    {Math.max(0, program.capacityState.total - program.capacityState.taken)} of {program.capacityState.total} places left.
                  </p>
                ) : null}
                {closedReason ? (
                  <div className="yv-stack">
                    <p className="yv-muted">{closedReason}</p>
                    <a className="yv-btn yv-btn-outline" href={LOOKUP_URL}>Already registered? Get your ticket</a>
                  </div>
                ) : (
                  <RegistrationForm program={program} />
                )}
                <div className="pub-inline-links">
                  <a href={LOOKUP_URL}>Already registered? Get your ticket</a>
                  <a href={`${REPORT_URL}?programId=${encodeURIComponent(program.programId)}`}>Report this event</a>
                </div>
              </Card>
              <div className="pub-notice" style={{ marginTop: '1rem' }}>
                <p><strong>Never share your PIN or password.</strong></p>
                <p className="yv-tiny">{program.privacyNotice}</p>
              </div>
              {freePlan ? <p className="yv-tiny yv-muted" style={{ marginTop: '.75rem' }}>Powered by Yivents.</p> : null}
            </aside>
          </div>
        </div>
      </PublicShell>
    </div>
  );
}
