'use client';

import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { formatEventRange, formatGHS, type TicketDocumentKind, type TicketLayout } from '@yivents/shared';
import { Button, Card, ErrorBanner, Field, LoadingState, Modal, SuccessBanner, WarningBanner } from '@yivents/ui';
import { storageUrl } from '@/lib/firebase/client';
import { useProgram, useRegistrationsFor } from '@/components/organizer/data';
import { patchProgram } from '@/components/organizer/program';
import { TicketPreview } from '@/components/organizer/TicketPreview';
import { friendlyError } from '@/components/organizer/utils';

const SAMPLE_NAME = 'Ama Serwaa Boateng-Mensah-Appiah (Nana Adjoa)';

export default function TicketDesignPage() {
  const params = useParams<{ id: string }>();
  const programId = String(params?.id ?? '');
  const { program, loading } = useProgram(programId);
  const { registrations } = useRegistrationsFor([programId]);
  const [documentKind, setDocumentKind] = useState<TicketDocumentKind>('ticket');
  const [showAmount, setShowAmount] = useState(false);
  const [layout, setLayout] = useState<TicketLayout>('vertical');
  const [logoUrl, setLogoUrl] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!program) return;
    setDocumentKind(program.settings.documentKind);
    setShowAmount(Boolean(program.settings.showAmountOnReceipt));
    setLayout(program.settings.ticketLayout ?? 'vertical');
  }, [program?.id, program?.settings.documentKind, program?.settings.showAmountOnReceipt, program?.settings.ticketLayout]);

  useEffect(() => {
    let alive = true;
    storageUrl(program?.branding.logoPath).then((url) => alive && setLogoUrl(url ?? '')).catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [program?.branding.logoPath]);

  if (loading || !program) return <LoadingState label="Loading ticket design…" />;
  const readOnly = program.status === 'archived';
  const changed =
    documentKind !== program.settings.documentKind ||
    showAmount !== Boolean(program.settings.showAmountOnReceipt) ||
    layout !== (program.settings.ticketLayout ?? 'vertical');
  const registrationsStarted = registrations.length > 0;

  const apply = async () => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await patchProgram(programId, {
        'settings.documentKind': documentKind,
        'settings.showAmountOnReceipt': documentKind === 'receipt' && showAmount,
        'settings.ticketLayout': layout,
      });
      setNotice('Ticket design saved. New and regenerated tickets use this design.');
      setConfirmOpen(false);
    } catch (err) {
      setError(friendlyError(err, 'Could not save the design.'));
    } finally {
      setBusy(false);
    }
  };

  const save = () => {
    if (changed && registrationsStarted) setConfirmOpen(true);
    else void apply();
  };

  return (
    <div className="org-stack">
      <div>
        <h1 style={{ margin: 0 }}>Ticket design</h1>
        <p className="yv-muted" style={{ margin: '.35rem 0 0' }}>Choose a ticket or receipt, layout and amount visibility.</p>
      </div>
      {error ? <ErrorBanner message={error} onDismiss={() => setError('')} /> : null}
      {notice ? <SuccessBanner message={notice} /> : null}
      {readOnly ? <WarningBanner>This program is archived and read-only.</WarningBanner> : null}
      {registrationsStarted ? (
        <WarningBanner>
          Registrations already exist. Changing the design affects regenerated tickets; downloadable tickets already saved by participants stay as they are.
        </WarningBanner>
      ) : null}

      <Card>
        <div className="org-preview-grid">
          <div>
            <Field label="Document type" id="design-kind">
              <select className="org-input" id="design-kind" value={documentKind} disabled={readOnly} onChange={(event) => setDocumentKind(event.target.value as TicketDocumentKind)}>
                <option value="ticket">Admission ticket</option>
                <option value="receipt">Payment receipt</option>
              </select>
            </Field>
            <label className="org-check">
              <input type="checkbox" checked={showAmount} disabled={readOnly || documentKind !== 'receipt'} onChange={(event) => setShowAmount(event.target.checked)} /> Show amount on receipt
            </label>
            <Field label="Layout" id="design-layout">
              <select className="org-input" id="design-layout" value={layout} disabled={readOnly} onChange={(event) => setLayout(event.target.value as TicketLayout)}>
                <option value="vertical">Vertical</option><option value="horizontal">Horizontal</option><option value="card">Small card</option>
              </select>
            </Field>
            <Button onClick={save} loading={busy} disabled={readOnly || !changed}>Save design</Button>
          </div>
          <div>
            <h2 style={{ marginTop: 0 }}>Live preview</h2>
            <p className="org-muted">Sample data includes a very long name so you can check wrapping before registrations start.</p>
            <TicketPreview
              filename={`${program.slug}-sample-${layout}`}
              data={{
                eventName: program.title || 'Your event',
                attendeeName: SAMPLE_NAME,
                ticketTypeName: 'Regular ticket',
                dateLabel: formatEventRange(program.event),
                venueLabel: program.event.venue || 'Online',
                code: 'YV-DEMO-CODE-0123456789ABCDEF',
                logoUrl,
                primaryColor: program.branding.primaryColor,
                accentColor: program.branding.accentColor,
                documentKind,
                showAmount: documentKind === 'receipt' && showAmount,
                amountLabel: formatGHS(15000),
                layout,
              }}
            />
          </div>
        </div>
      </Card>

      <Card>
        <h2 style={{ marginTop: 0 }}>Print and QR notes</h2>
        <ul className="org-muted">
          <li>Fonts are embedded in the downloaded file; the preview uses your device fonts.</li>
          <li>Keep the QR at least 20 mm wide with a clear white border and no text over it.</li>
          <li>The QR contains only the long random ticket code — never personal details or payment data.</li>
          <li>Tickets never show payment status. Amounts only appear when this is a receipt with amount enabled.</li>
        </ul>
      </Card>

      <Modal open={confirmOpen} title="Change ticket design?" onClose={() => setConfirmOpen(false)}>
        <p>Registrations have started. Save this design change anyway?</p>
        <div className="org-row">
          <Button variant="outline" onClick={() => setConfirmOpen(false)}>Keep current design</Button>
          <Button variant="danger" loading={busy} onClick={() => void apply()}>Save new design</Button>
        </div>
      </Modal>
    </div>
  );
}
