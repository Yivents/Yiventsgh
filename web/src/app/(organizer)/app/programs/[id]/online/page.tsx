'use client';

import { updateDoc, doc } from 'firebase/firestore';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { type LinkReleaseRule } from '@yivents/shared';
import { Button, Card, ErrorBanner, Field, LoadingState, SuccessBanner, WarningBanner } from '@yivents/ui';
import { db } from '@/lib/firebase/client';
import { useProgram, useTicketTypes } from '@/components/organizer/data';
import { patchProgram } from '@/components/organizer/program';
import { copyText, friendlyError } from '@/components/organizer/utils';

type EffectiveRule = 'inherit' | LinkReleaseRule;

const RULES: Array<{ value: LinkReleaseRule; label: string; disabled?: boolean }> = [
  { value: 'on_registration', label: 'Immediately on registration' },
  { value: 'after_approval', label: 'After approval' },
  { value: 'scheduled', label: 'Scheduled (coming later)', disabled: true },
  { value: 'manual', label: 'Manual release (coming later)', disabled: true },
];

export default function OnlinePage() {
  const params = useParams<{ id: string }>();
  const programId = String(params?.id ?? '');
  const { program, loading } = useProgram(programId);
  const { ticketTypes } = useTicketTypes(programId);
  const [meetingLink, setMeetingLink] = useState('');
  const [replayLink, setReplayLink] = useState('');
  const [defaultRule, setDefaultRule] = useState<LinkReleaseRule>('on_registration');
  const [display, setDisplay] = useState<'direct' | 'join_button'>('direct');
  const [message, setMessage] = useState('');
  const [overrides, setOverrides] = useState<Record<string, LinkReleaseRule>>({});
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!program) return;
    setMeetingLink(program.settings.meetingLink ?? '');
    setReplayLink(program.settings.replayLink ?? '');
    setDefaultRule(program.settings.defaultLinkReleaseRule ?? 'on_registration');
    setDisplay(program.settings.linkDisplay);
    setMessage(program.settings.meetingMessage ?? 'Your meeting link is private. Do not share it outside your registration.');
    setOverrides({ ...program.settings.linkReleaseDefaults });
  }, [program?.id, program?.settings.meetingLink, program?.settings.linkReleaseDefaults, program?.settings.linkDisplay]);

  if (loading || !program) return <LoadingState label="Loading online settings…" />;
  const readOnly = program.status === 'archived';

  const save = async () => {
    setError('');
    setNotice('');
    setBusy(true);
    try {
      await patchProgram(programId, {
        'settings.meetingLink': meetingLink.trim(),
        'settings.replayLink': replayLink.trim(),
        'settings.defaultLinkReleaseRule': defaultRule,
        'settings.linkDisplay': display,
        'settings.meetingMessage': message,
        'settings.linkReleaseDefaults': overrides,
      });
      for (const type of ticketTypes) {
        await updateDoc(doc(db, 'programs', programId, 'ticketTypes', type.id), {
          linkReleaseRule: overrides[type.id] ?? defaultRule,
        });
      }
      setNotice('Online settings saved. The meeting link stays private.');
    } catch (err) {
      setError(friendlyError(err, 'Could not save online settings.'));
    } finally {
      setBusy(false);
    }
  };

  const setOverride = (id: string, value: EffectiveRule) =>
    setOverrides((current) => {
      const next = { ...current };
      if (value === 'inherit') delete next[id];
      else next[id] = value;
      return next;
    });

  return (
    <div className="org-stack">
      <div>
        <h1 style={{ margin: 0 }}>Online details</h1>
        <p className="yv-muted" style={{ margin: '.35rem 0 0' }}>Control who sees the meeting link and when it is released.</p>
      </div>
      {error ? <ErrorBanner message={error} onDismiss={() => setError('')} /> : null}
      {notice ? <SuccessBanner message={notice} /> : null}
      {readOnly ? <WarningBanner>This program is archived and read-only.</WarningBanner> : null}
      <WarningBanner>
        The meeting link is never shown on the public event page, in public search or in ticket lookup. Only eligible participants receive it after your chosen release rule.
      </WarningBanner>

      <Card>
        <h2 style={{ marginTop: 0 }}>Links</h2>
        <Field label="Meeting link (private)" id="online-link" hint="Paste the Zoom, Teams or Meet link here. Do not put it in the description.">
          <input className="org-input" id="online-link" type="url" value={meetingLink} disabled={readOnly} onChange={(event) => setMeetingLink(event.target.value)} placeholder="https://..." />
        </Field>
        <div className="org-row">
          <Button variant="outline" size="sm" disabled={!meetingLink} onClick={() => void copyText(meetingLink).then((ok) => setNotice(ok ? 'Meeting link copied privately.' : 'Could not copy the link.'))}>Copy private link</Button>
        </div>
        <Field label="Replay link (after the event)" id="online-replay" hint="Optional. Released after the event ends.">
          <input className="org-input" id="online-replay" type="url" value={replayLink} disabled={readOnly} onChange={(event) => setReplayLink(event.target.value)} placeholder="https://..." />
        </Field>
        <Field label="Message shown with the link" id="online-message">
          <textarea className="org-input" id="online-message" rows={3} value={message} disabled={readOnly} onChange={(event) => setMessage(event.target.value)} />
        </Field>
      </Card>

      <Card>
        <h2 style={{ marginTop: 0 }}>Release rules</h2>
        <Field label="Default for all ticket types" id="online-default-rule">
          <select className="org-input" id="online-default-rule" value={defaultRule} disabled={readOnly} onChange={(event) => setDefaultRule(event.target.value as LinkReleaseRule)}>
            {RULES.filter((rule) => !rule.disabled).map((rule) => <option key={rule.value} value={rule.value}>{rule.label}</option>)}
          </select>
        </Field>
        <h3>Per ticket type override</h3>
        {ticketTypes.length ? ticketTypes.map((type) => (
          <Field key={type.id} label={type.name} id={`rule-${type.id}`}>
            <select className="org-input" id={`rule-${type.id}`} value={overrides[type.id] ?? 'inherit'} disabled={readOnly} onChange={(event) => setOverride(type.id, event.target.value as EffectiveRule)}>
              <option value="inherit">Inherit default</option>
              {RULES.filter((rule) => !rule.disabled).map((rule) => <option key={rule.value} value={rule.value}>{rule.label}</option>)}
            </select>
          </Field>
        )) : <p className="org-muted">Add ticket types to set per-type rules.</p>}
        <div className="org-row" style={{ marginTop: '.75rem' }}>
          <Button variant="outline" size="sm" disabled title="Coming in Phase 2">Join activation — coming later</Button>
          <Button variant="outline" size="sm" disabled title="Coming in Phase 2">Scheduled release — coming later</Button>
          <Button variant="outline" size="sm" disabled title="Coming in Phase 2">Manual release — coming later</Button>
        </div>
      </Card>

      <Card>
        <h2 style={{ marginTop: 0 }}>Link display</h2>
        <Field label="How participants open the meeting" id="online-display">
          <select className="org-input" id="online-display" value={display} disabled={readOnly} onChange={(event) => setDisplay(event.target.value as 'direct' | 'join_button')}>
            <option value="direct">Show the direct link</option>
            <option value="join_button">Show a Join button</option>
          </select>
        </Field>
        <p className="org-muted">The Join button activation, scheduled and manual controls arrive in Phase 2. Until then, choose immediate or after approval above.</p>
        <Button onClick={() => void save()} loading={busy} disabled={readOnly}>Save online settings</Button>
      </Card>
    </div>
  );
}
