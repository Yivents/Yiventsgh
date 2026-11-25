'use client';

import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Button, Card, ErrorBanner, Field, LoadingState, SuccessBanner, WarningBanner } from '@yivents/ui';
import { useSession } from '@/lib/auth';
import { FormBuilder } from '@/components/organizer/FormBuilder';
import { useProgram } from '@/components/organizer/data';
import { patchProgram } from '@/components/organizer/program';
import { friendlyError } from '@/components/organizer/utils';

type DuplicateRule = 'phone' | 'email' | 'phone_or_email' | 'off';

export default function FormPage() {
  const params = useParams<{ id: string }>();
  const programId = String(params?.id ?? '');
  const { user } = useSession();
  const { program, loading } = useProgram(programId);
  const [duplicateRule, setDuplicateRule] = useState<DuplicateRule>('phone_or_email');
  const [allowMultiple, setAllowMultiple] = useState(false);
  const [waitlist, setWaitlist] = useState(false);
  const [captcha, setCaptcha] = useState(false);
  const [feedback, setFeedback] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!program) return;
    setDuplicateRule(program.settings.duplicateRule);
    setAllowMultiple(Boolean(program.settings.allowMultiplePerContact));
    setWaitlist(Boolean(program.settings.waitlistEnabled));
    setCaptcha(Boolean(program.settings.captchaRequired));
    setFeedback(Boolean(program.settings.feedbackEnabled));
  }, [program?.id, program?.settings.duplicateRule, program?.settings.feedbackEnabled]);

  if (loading || !user) return <LoadingState label="Loading form settings…" />;
  if (!program) return <ErrorBanner message="This program could not be found." />;
  const readOnly = program.status === 'archived';

  const saveSettings = async () => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await patchProgram(programId, {
        'settings.duplicateRule': duplicateRule,
        'settings.allowMultiplePerContact': allowMultiple,
        'settings.waitlistEnabled': waitlist,
        'settings.captchaRequired': captcha,
        'settings.feedbackEnabled': feedback,
      });
      setNotice('Form rules saved.');
    } catch (err) {
      setError(friendlyError(err, 'Could not save form rules.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="org-stack">
      <div>
        <h1 style={{ margin: 0 }}>Registration form</h1>
        <p className="yv-muted" style={{ margin: '.35rem 0 0' }}>Build questions, sections and a feedback form without drag and drop.</p>
      </div>
      {error ? <ErrorBanner message={error} onDismiss={() => setError('')} /> : null}
      {notice ? <SuccessBanner message={notice} /> : null}
      {readOnly ? <WarningBanner>This program is archived and read-only.</WarningBanner> : null}

      <Card>
        <h2 style={{ marginTop: 0 }}>Form rules</h2>
        <Field label="Duplicate registration rule" id="duplicate-rule" hint="How the server checks whether someone has already registered.">
          <select className="org-input" id="duplicate-rule" value={duplicateRule} disabled={readOnly} onChange={(event) => setDuplicateRule(event.target.value as DuplicateRule)}>
            <option value="phone_or_email">Same phone or email</option>
            <option value="phone">Same phone</option>
            <option value="email">Same email</option>
            <option value="off">Off</option>
          </select>
        </Field>
        <div className="org-row">
          <label className="org-check"><input type="checkbox" checked={allowMultiple} disabled={readOnly} onChange={(event) => setAllowMultiple(event.target.checked)} /> Allow multiple registrations per contact</label>
          <label className="org-check"><input type="checkbox" checked={waitlist} disabled={readOnly} onChange={(event) => setWaitlist(event.target.checked)} /> Enable waitlist when full</label>
          <label className="org-check"><input type="checkbox" checked={captcha} disabled={readOnly} onChange={(event) => setCaptcha(event.target.checked)} /> Require CAPTCHA</label>
          <label className="org-check"><input type="checkbox" checked={feedback} disabled={readOnly} onChange={(event) => setFeedback(event.target.checked)} /> Enable feedback form</label>
        </div>
        <Button onClick={() => void saveSettings()} loading={busy} disabled={readOnly} style={{ marginTop: '1rem' }}>Save form rules</Button>
      </Card>

      <Card>
        <h2 style={{ marginTop: 0 }}>Registration questions</h2>
        <FormBuilder programId={programId} user={user} kind="registration" disabled={readOnly} />
      </Card>

      {feedback ? (
        <Card>
          <h2 style={{ marginTop: 0 }}>Feedback questions</h2>
          <p className="org-muted">Shown after the event. Feedback is private to your team.</p>
          <FormBuilder programId={programId} user={user} kind="feedback" disabled={readOnly} />
        </Card>
      ) : null}
    </div>
  );
}
