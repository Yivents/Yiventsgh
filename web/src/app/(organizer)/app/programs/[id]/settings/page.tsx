'use client';

import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { formatGhanaDate, type Visibility } from '@yivents/shared';
import { Button, Card, ErrorBanner, Field, LoadingState, SuccessBanner, WarningBanner } from '@yivents/ui';
import { extendDeadline } from '@/components/organizer/callables';
import { useCollection, useProgram } from '@/components/organizer/data';
import { patchProgram } from '@/components/organizer/program';
import { friendlyError, fromDateTimeLocal, toDateTimeLocal } from '@/components/organizer/utils';

export default function SettingsPage() {
  const params = useParams<{ id: string }>();
  const programId = String(params?.id ?? '');
  const { program, loading } = useProgram(programId);
  const { items: auditLogs } = useCollection<Record<string, unknown> & { id: string }>(programId ? `programs/${programId}/auditLogs` : null);
  const [deadline, setDeadline] = useState('');
  const [reason, setReason] = useState('');
  const [archiveDays, setArchiveDays] = useState('14');
  const [retentionMonths, setRetentionMonths] = useState('12');
  const [screenshotDays, setScreenshotDays] = useState('90');
  const [visibility, setVisibility] = useState<Visibility>('link_only');
  const [reopen, setReopen] = useState(true);
  const [waitlist, setWaitlist] = useState(false);
  const [allowMultiple, setAllowMultiple] = useState(false);
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!program) return;
    setDeadline(toDateTimeLocal(program.registrationDeadline));
    setArchiveDays(String(program.settings.archiveAfterDays));
    setRetentionMonths(String(program.settings.retentionMonths));
    setScreenshotDays(String(program.settings.screenshotRetentionDays));
    setVisibility(program.visibility);
    setReopen(Boolean(program.settings.reopenCapacityOnReject));
    setWaitlist(Boolean(program.settings.waitlistEnabled));
    setAllowMultiple(Boolean(program.settings.allowMultiplePerContact));
  }, [program?.id, program?.registrationDeadline, program?.settings.archiveAfterDays, program?.settings.reopenCapacityOnReject]);

  if (loading || !program) return <LoadingState label="Loading settings…" />;
  const readOnly = program.status === 'archived';

  const extend = async () => {
    setError('');
    setNotice('');
    const next = fromDateTimeLocal(deadline);
    if (!next) {
      setError('Choose a valid date and time.');
      return;
    }
    if (new Date(next) <= new Date(program.registrationDeadline)) {
      setError('Pick a later deadline than the current one.');
      return;
    }
    const limit = program.event.endAt ?? program.event.startAt;
    if (new Date(next) > new Date(limit)) {
      setError('The deadline cannot be later than the event end.');
      return;
    }
    setBusy('deadline');
    try {
      await extendDeadline(programId, next, reason.trim() || undefined);
      setReason('');
      setNotice(`Deadline extended to ${formatGhanaDate(next)}. The change is logged.`);
    } catch (err) {
      setError(friendlyError(err, 'Could not extend the deadline.'));
    } finally {
      setBusy('');
    }
  };

  const restore = async () => {
    setBusy('restore');
    setError('');
    try {
      await patchProgram(programId, { status: 'draft', archivedAt: null });
      setNotice('Program restored to draft. You can edit it again.');
    } catch (err) {
      setError(friendlyError(err, 'Could not restore the program.'));
    } finally {
      setBusy('');
    }
  };

  const saveSettings = async () => {
    setError('');
    setNotice('');
    setBusy('settings');
    try {
      await patchProgram(programId, {
        visibility,
        'settings.archiveAfterDays': Math.max(1, Number(archiveDays) || 14),
        'settings.retentionMonths': Math.max(1, Number(retentionMonths) || 12),
        'settings.screenshotRetentionDays': Math.max(1, Number(screenshotDays) || 90),
        'settings.reopenCapacityOnReject': reopen,
        'settings.waitlistEnabled': waitlist,
        'settings.allowMultiplePerContact': allowMultiple,
      });
      setNotice('Settings saved.');
    } catch (err) {
      setError(friendlyError(err, 'Could not save settings.'));
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="org-stack">
      <div>
        <h1 style={{ margin: 0 }}>Settings</h1>
        <p className="yv-muted" style={{ margin: '.35rem 0 0' }}>Deadlines, retention, capacity rules and visibility.</p>
      </div>
      {error ? <ErrorBanner message={error} onDismiss={() => setError('')} /> : null}
      {notice ? <SuccessBanner message={notice} /> : null}
      {readOnly ? (
        <WarningBanner>
          This program is archived and read-only. Restore it before changing settings.
          <div style={{ marginTop: '.5rem' }}>
            <Button size="sm" variant="outline" loading={busy === 'restore'} onClick={() => void restore()}>
              Restore to draft
            </Button>
          </div>
        </WarningBanner>
      ) : null}

      <Card>
        <h2 style={{ marginTop: 0 }}>Registration deadline</h2>
        <p className="org-muted">Current: {formatGhanaDate(program.registrationDeadline)}. Deadlines can only move later and never past the event end.</p>
        <div className="org-preview-grid">
          <Field label="New deadline" id="settings-deadline">
            <input className="org-input" id="settings-deadline" type="datetime-local" value={deadline} disabled={readOnly} onChange={(event) => setDeadline(event.target.value)} />
          </Field>
          <Field label="Reason (optional)" id="settings-reason">
            <input className="org-input" id="settings-reason" value={reason} disabled={readOnly} onChange={(event) => setReason(event.target.value)} placeholder="e.g. extended by request" />
          </Field>
        </div>
        <Button onClick={() => void extend()} loading={busy === 'deadline'} disabled={readOnly}>Extend deadline</Button>
        <h3 style={{ marginTop: '1.25rem' }}>Deadline change log</h3>
        {program.deadlineChanges.length ? (
          <div className="table-wrap">
            <table>
              <thead><tr><th scope="col">From</th><th scope="col">To</th><th scope="col">When</th><th scope="col">Reason</th></tr></thead>
              <tbody>
                {[...program.deadlineChanges].reverse().map((change, index) => (
                  <tr key={index}>
                    <td>{formatGhanaDate(change.from)}</td><td>{formatGhanaDate(change.to)}</td>
                    <td>{formatGhanaDate(change.at)}</td><td>{change.reason || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="org-muted">No deadline changes yet.</p>}
      </Card>

      <Card>
        <h2 style={{ marginTop: 0 }}>Retention and archive</h2>
        <div className="org-preview-grid">
          <Field label="Archive after (days)" id="settings-archive"><input className="org-input" id="settings-archive" type="number" min="1" value={archiveDays} disabled={readOnly} onChange={(event) => setArchiveDays(event.target.value)} /></Field>
          <Field label="Keep data for (months)" id="settings-retention"><input className="org-input" id="settings-retention" type="number" min="1" value={retentionMonths} disabled={readOnly} onChange={(event) => setRetentionMonths(event.target.value)} /></Field>
          <Field label="Screenshots kept for (days)" id="settings-screenshots"><input className="org-input" id="settings-screenshots" type="number" min="1" value={screenshotDays} disabled={readOnly} onChange={(event) => setScreenshotDays(event.target.value)} /></Field>
        </div>
      </Card>

      <Card>
        <h2 style={{ marginTop: 0 }}>Capacity and visibility</h2>
        <div className="org-row">
          <label className="org-check"><input type="checkbox" checked={reopen} disabled={readOnly} onChange={(event) => setReopen(event.target.checked)} /> Reopen capacity when a registration is rejected or cancelled</label>
          <label className="org-check"><input type="checkbox" checked={waitlist} disabled={readOnly} onChange={(event) => setWaitlist(event.target.checked)} /> Waitlist when full</label>
          <label className="org-check"><input type="checkbox" checked={allowMultiple} disabled={readOnly} onChange={(event) => setAllowMultiple(event.target.checked)} /> Allow multiple registrations per contact</label>
        </div>
        <Field label="Visibility" id="settings-visibility">
          <select className="org-input" id="settings-visibility" value={visibility} disabled={readOnly} onChange={(event) => setVisibility(event.target.value as Visibility)}>
            <option value="link_only">Link only</option><option value="public">Publicly listed (approval required)</option>
          </select>
        </Field>
        <p className="org-muted">You cannot approve your own public listing. Approval status is controlled by Yivents.</p>
        <Button onClick={() => void saveSettings()} loading={busy === 'settings'} disabled={readOnly}>Save settings</Button>
      </Card>

      <Card>
        <h2 style={{ marginTop: 0 }}>Change log</h2>
        <p className="org-muted">Trusted operations are audited on the server. Recent audit entries are read-only.</p>
        {auditLogs.length ? (
          <ul className="org-muted">
            {auditLogs.slice(0, 20).map((entry) => (
              <li key={entry.id}>
                {String(entry.action ?? entry.type ?? 'Change')} — {String(entry.at ?? entry.createdAt ?? '')} {entry.by ? `by ${String(entry.by)}` : ''}
              </li>
            ))}
          </ul>
        ) : <p className="org-muted">No audit entries yet.</p>}
      </Card>
    </div>
  );
}
