'use client';

import { useParams } from 'next/navigation';
import { useState } from 'react';
import { Badge, Button, Card, ErrorBanner, LoadingState, SuccessBanner, WarningBanner } from '@yivents/ui';
import { generateScannerCredentials, toggleScanner } from '@/components/organizer/callables';
import { useProgram } from '@/components/organizer/data';
import { patchProgram } from '@/components/organizer/program';
import { copyText, friendlyError } from '@/components/organizer/utils';

export default function ScannerPage() {
  const params = useParams<{ id: string }>();
  const programId = String(params?.id ?? '');
  const { program, loading } = useProgram(programId);
  const [scannerUrl, setScannerUrl] = useState('');
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  if (loading || !program) return <LoadingState label="Loading scanner settings…" />;
  const readOnly = program.status === 'archived';

  const generate = async () => {
    setBusy('generate');
    setError('');
    try {
      const result = await generateScannerCredentials(programId);
      setScannerUrl(result.url ?? result.scannerUrl ?? result.link ?? '');
      setPin(result.pin ?? '');
      setNotice('Scanner credentials generated. Copy them now — the PIN is shown once.');
    } catch (err) {
      setError(friendlyError(err, 'Could not generate scanner credentials.'));
    } finally {
      setBusy('');
    }
  };

  const toggle = async (enabled: boolean) => {
    setBusy('toggle');
    setError('');
    try {
      await toggleScanner(programId, enabled);
      await patchProgram(programId, { scannerEnabled: enabled });
      setNotice(enabled ? 'Scanner enabled.' : 'Scanner disabled. The door link will not work.');
    } catch (err) {
      setError(friendlyError(err, 'Could not change scanner access.'));
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="org-stack">
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ margin: 0 }}>Door scanner</h1>
          <p className="yv-muted" style={{ margin: '.35rem 0 0' }}>Check in participants with the scanner link and PIN.</p>
        </div>
        <Badge tone={program.scannerEnabled ? 'success' : 'danger'}>{program.scannerEnabled ? 'Enabled' : 'Disabled'}</Badge>
      </div>
      {error ? <ErrorBanner message={error} onDismiss={() => setError('')} /> : null}
      {notice ? <SuccessBanner message={notice} /> : null}
      {!program.scannerEnabled ? <WarningBanner>The scanner is off. Give the link and PIN to door staff only after you enable it.</WarningBanner> : null}
      {readOnly ? <WarningBanner>This program is archived and read-only.</WarningBanner> : null}

      <Card>
        <h2 style={{ marginTop: 0 }}>Credentials</h2>
        <p className="org-muted">Generating credentials rotates the scanner link and PIN. Older links stop working.</p>
        <Button onClick={() => void generate()} loading={busy === 'generate'} disabled={readOnly}>Generate scanner link and PIN</Button>
        {scannerUrl || pin ? (
          <div style={{ marginTop: '1rem' }}>
            {scannerUrl ? (
              <>
                <label className="org-muted" htmlFor="scanner-url">Scanner link</label>
                <input className="org-input" id="scanner-url" readOnly value={scannerUrl} onFocus={(event) => event.target.select()} />
                <Button variant="outline" size="sm" style={{ marginTop: '.5rem' }} onClick={() => void copyText(scannerUrl).then((ok) => setNotice(ok ? 'Scanner link copied.' : 'Could not copy the link.'))}>Copy link</Button>
              </>
            ) : null}
            {pin ? (
              <div style={{ marginTop: '1rem' }}>
                <p className="org-muted">PIN (shown once)</p>
                <strong style={{ fontSize: '1.4rem', letterSpacing: '.2em' }}>{pin}</strong>
                <div><Button variant="outline" size="sm" onClick={() => void copyText(pin).then((ok) => setNotice(ok ? 'PIN copied.' : 'Could not copy the PIN.'))}>Copy PIN</Button></div>
              </div>
            ) : null}
          </div>
        ) : null}
      </Card>

      <Card>
        <h2 style={{ marginTop: 0 }}>Scanner access</h2>
        <div className="org-row">
          {program.scannerEnabled ? (
            <Button variant="danger" loading={busy === 'toggle'} onClick={() => void toggle(false)}>Disable scanner</Button>
          ) : (
            <Button loading={busy === 'toggle'} disabled={readOnly} onClick={() => void toggle(true)}>Enable scanner</Button>
          )}
          <Button variant="outline" disabled={!scannerUrl} onClick={() => void copyText(`Scanner link: ${scannerUrl}\nPIN: ${pin}`).then((ok) => setNotice(ok ? 'Share text copied.' : 'Could not copy.'))}>Copy share text</Button>
        </div>
      </Card>
    </div>
  );
}
