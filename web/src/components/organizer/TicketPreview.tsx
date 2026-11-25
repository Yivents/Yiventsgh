'use client';

/** Live ticket preview and downloads — always the shared @yivents/ticket-render component. */
import { useRef, useState } from 'react';
import { downloadTicketPdf, downloadTicketPng, Ticket, type TicketData } from '@yivents/ticket-render';
import { Button, ErrorBanner } from '@yivents/ui';

export function TicketPreview({ data, filename }: { data: TicketData; filename: string }) {
  const node = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const download = async (format: 'png' | 'pdf') => {
    if (!node.current) return;
    setBusy(format);
    setError('');
    try {
      if (format === 'png') await downloadTicketPng(node.current, filename);
      else await downloadTicketPdf(node.current, filename);
    } catch {
      setError(`Could not create the ${format.toUpperCase()}. Please try again.`);
    } finally {
      setBusy('');
    }
  };

  return (
    <div>
      <div ref={node} style={{ display: 'inline-block', maxWidth: '100%' }}>
        <Ticket {...data} />
      </div>
      {error ? <ErrorBanner message={error} onDismiss={() => setError('')} /> : null}
      <div style={{ display: 'flex', gap: '.6rem', flexWrap: 'wrap', marginTop: '1rem' }}>
        <Button variant="outline" size="sm" loading={busy === 'png'} onClick={() => download('png')}>
          Download PNG
        </Button>
        <Button variant="outline" size="sm" loading={busy === 'pdf'} onClick={() => download('pdf')}>
          Download PDF
        </Button>
      </div>
    </div>
  );
}
