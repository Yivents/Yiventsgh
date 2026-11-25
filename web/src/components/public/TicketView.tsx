'use client';

/** Ticket lookup by long random code; the QR contains only this code. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { formatEventRange, type Branding, type EventDetails } from '@yivents/shared';
import { Ticket, downloadTicketPdf, downloadTicketPng, type TicketData } from '@yivents/ticket-render';
import { Button, EmptyState, ErrorBanner, LoadingState } from '@yivents/ui';
import { callFunction } from '@/lib/firebase/client';
import type { TicketLookupResult } from './types';
import { LOOKUP_URL, REPORT_URL } from './site-chrome';
import { safeHttpUrl, unwrapLookup } from './types';

export function TicketView({ code }: { code: string }) {
  const ticketRef = useRef<HTMLDivElement>(null);
  const [result, setResult] = useState<TicketLookupResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [downloading, setDownloading] = useState<'png' | 'pdf' | ''>('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const params = new URLSearchParams(window.location.search);
      const programId = params.get('programId') ?? params.get('program') ?? '';
      const response = await callFunction<TicketLookupResult>('lookupTicket', {
        ...(programId ? { programId } : {}),
        code,
        ticketCode: code,
        identifier: code,
      });
      setResult(unwrapLookup(response ?? {}));
    } catch (lookupError) {
      setError(
        lookupError instanceof Error && lookupError.message
          ? lookupError.message
          : 'We could not find that ticket. Check the code and try again.',
      );
    } finally {
      setLoading(false);
    }
  }, [code]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) return <LoadingState label="Finding your ticket…" />;
  if (error || !result) {
    return (
      <div className="yv-stack">
        <ErrorBanner message={error || 'We could not find that ticket.'} />
        <EmptyState
          title="Ticket not available"
          message="The link may be incomplete or the ticket may have been cancelled. You can look it up again with your email or phone number."
          action={
            <div className="yv-row" style={{ justifyContent: 'center' }}>
              <Button type="button" onClick={() => void load()}>Try again</Button>
              <a className="yv-btn yv-btn-outline" href={LOOKUP_URL}>Find my ticket</a>
            </div>
          }
        />
      </div>
    );
  }

  const ticketCode = String(result.ticketCode ?? result.code ?? code);
  const event = result.event as EventDetails | undefined;
  const branding = result.branding as Branding | undefined;
  const documentKind = result.documentKind === 'receipt' ? 'receipt' : 'ticket';
  const ticketData: TicketData = {
    eventName: String(result.programTitle ?? result.eventName ?? 'Yivents event'),
    attendeeName: String(result.attendeeName ?? result.name ?? 'Attendee'),
    ticketTypeName: String(result.ticketTypeName ?? 'Ticket'),
    dateLabel: event ? formatEventRange(event) : String(result.dateLabel ?? 'Date to be confirmed'),
    venueLabel: event?.venue ?? String(result.venueLabel ?? result.venue ?? 'Venue to be confirmed'),
    code: ticketCode,
    ...(safeHttpUrl(result.logoUrl) ? { logoUrl: safeHttpUrl(result.logoUrl) } : {}),
    primaryColor: branding?.primaryColor ?? String(result.primaryColor ?? '#104080'),
    accentColor: branding?.accentColor ?? String(result.accentColor ?? '#F08010'),
    documentKind,
    // A receipt alone is not permission to show an amount; the server must opt in.
    showAmount: documentKind === 'receipt' && (result.showAmount === true || result.showAmountOnReceipt === true),
    ...(result.amountLabel ? { amountLabel: String(result.amountLabel) } : {}),
    layout: 'vertical',
  };

  const rule = String(result.meetingLinkRule ?? '').toLowerCase();
  const meetingReleased =
    result.meetingLinkReleased === true ||
    Boolean(result.meetingLinkReleasedAt) ||
    rule === 'on_registration' ||
    (rule === 'after_approval' && result.approved === true);
  const meetingLink = safeHttpUrl(result.meetingLink);
  const replayLink = safeHttpUrl(result.replayLink);

  const download = async (format: 'png' | 'pdf') => {
    if (!ticketRef.current) return;
    setDownloading(format);
    try {
      const filename = `yivents-ticket-${ticketCode.slice(0, 12)}`;
      if (format === 'png') await downloadTicketPng(ticketRef.current, filename);
      else await downloadTicketPdf(ticketRef.current, filename);
    } catch {
      setError('The download did not work on this device. You can take a screenshot of the ticket instead.');
    } finally {
      setDownloading('');
    }
  };

  return (
    <div className="yv-stack">
      {error ? <ErrorBanner message={error} onDismiss={() => setError('')} /> : null}
      <div className="pub-ticket-wrap">
        <Ticket {...ticketData} ref={ticketRef} />
        <div className="pub-ticket-actions">
          <Button type="button" loading={downloading === 'png'} onClick={() => void download('png')}>Download PNG</Button>
          <Button type="button" variant="outline" loading={downloading === 'pdf'} onClick={() => void download('pdf')}>Download PDF</Button>
        </div>
        <p className="yv-tiny yv-muted">Present this QR code at the door. Never share your PIN or password.</p>
      </div>

      <section className="yv-card" aria-labelledby="meeting-heading">
        <h3 id="meeting-heading">Meeting link</h3>
        {meetingReleased && meetingLink ? (
          <a className="yv-btn yv-btn-primary" href={meetingLink} target="_blank" rel="noopener noreferrer">
            Join the event
          </a>
        ) : (
          <p className="yv-muted">Your meeting link will appear here once your payment is confirmed.</p>
        )}
        {replayLink ? (
          <p>
            <a href={replayLink} target="_blank" rel="noopener noreferrer">Watch the event replay</a>
          </p>
        ) : null}
      </section>

      <p className="yv-tiny">
        Something wrong with this ticket? <a href={`${REPORT_URL}?programId=${encodeURIComponent(String(result.programId ?? ''))}`}>Report an issue</a>
      </p>
    </div>
  );
}
