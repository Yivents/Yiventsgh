'use client';

/**
 * The single ticket renderer used BOTH by the organizer's live preview and by
 * the registrant's downloadable ticket. Preview and download therefore cannot
 * drift. Tickets never render payment status and never render an amount unless
 * the program is explicitly configured as a receipt with showAmount = true.
 */
import { forwardRef, useEffect, useState, type CSSProperties } from 'react';
import QRCode from 'qrcode';
import './ticket.css';

export type TicketLayout = 'vertical' | 'horizontal' | 'card';

export interface TicketData {
  eventName: string;
  attendeeName: string;
  ticketTypeName: string;
  dateLabel: string;
  venueLabel: string;
  code: string;
  logoUrl?: string;
  primaryColor: string;
  accentColor: string;
  documentKind: 'ticket' | 'receipt';
  showAmount?: boolean;
  amountLabel?: string;
  layout: TicketLayout;
}

function useQrDataUrl(code: string) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    let alive = true;
    QRCode.toDataURL(code, {
      width: 320,
      margin: 2,
      errorCorrectionLevel: 'M',
      color: { dark: '#14213D', light: '#FFFFFF' },
    })
      .then((value) => alive && setUrl(value))
      .catch(() => alive && setUrl(''));
    return () => {
      alive = false;
    };
  }, [code]);
  return url;
}

export const Ticket = forwardRef<HTMLDivElement, TicketData>(function Ticket(data, ref) {
  const qr = useQrDataUrl(data.code);
  const isReceipt = data.documentKind === 'receipt';
  return (
    <div
      ref={ref}
      className={`yv-ticket yv-ticket-${data.layout}`}
      data-brand
      style={
        {
          '--brand-primary': data.primaryColor,
          '--brand-accent': data.accentColor,
        } as CSSProperties
      }
    >
      <div className="yv-ticket-head">
        {data.logoUrl ? <img className="yv-ticket-logo" src={data.logoUrl} alt="" crossOrigin="anonymous" /> : null}
        <div>
          <p className="yv-ticket-kicker">{isReceipt ? 'Payment receipt' : 'Admission ticket'}</p>
          <h2>{data.eventName}</h2>
        </div>
      </div>

      <div className="yv-ticket-body">
        <div className="yv-ticket-details">
          <p className="yv-ticket-label">Attendee</p>
          <p className="yv-ticket-name">{data.attendeeName}</p>
          <p className="yv-ticket-label">Ticket type</p>
          <p className="yv-ticket-strong">{data.ticketTypeName}</p>
          <p className="yv-ticket-label">Date</p>
          <p className="yv-ticket-strong">{data.dateLabel}</p>
          <p className="yv-ticket-label">Venue</p>
          <p className="yv-ticket-strong">{data.venueLabel}</p>
          {isReceipt && data.showAmount && data.amountLabel ? (
            <p className="yv-ticket-amount">Amount paid: {data.amountLabel}</p>
          ) : null}
        </div>
        <div className="yv-ticket-qr-wrap">
          {qr ? <img className="yv-ticket-qr" src={qr} alt="Ticket QR code" width={180} height={180} /> : <div className="yv-ticket-qr-skeleton" />}
          <p className="yv-ticket-code">{data.code.slice(0, 12)}…</p>
        </div>
      </div>

      <footer className="yv-ticket-foot">Present this QR code at the door. Powered by Yivents.</footer>
    </div>
  );
});
