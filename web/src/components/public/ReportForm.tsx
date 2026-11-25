'use client';

/** Public abuse/issue report. The callable writes to the admin inbox. */
import { useEffect, useState, type FormEvent } from 'react';
import { Button, ErrorBanner, Field } from '@yivents/ui';
import { callFunction } from '@/lib/firebase/client';
import { useRecaptchaToken } from './useRecaptcha';

const REASONS = [
  'Suspicious payment or scam',
  'Misleading event information',
  'Inappropriate content',
  'Safety concern',
  'Ticket or lookup problem',
  'Something else',
];

export function ReportForm() {
  const getCaptchaToken = useRecaptchaToken();
  const [programId, setProgramId] = useState('');
  const [reason, setReason] = useState('');
  const [details, setDetails] = useState('');
  const [contact, setContact] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setProgramId(params.get('programId') ?? params.get('program') ?? params.get('slug') ?? '');
  }, []);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    if (!reason) {
      setError('Choose a reason for your report.');
      return;
    }
    if (details.trim().length < 10) {
      setError('Please describe the issue in at least 10 characters.');
      return;
    }
    setBusy(true);
    try {
      const captchaToken = await getCaptchaToken('report_event');
      await callFunction('reportEvent', {
        programId: programId.trim(),
        reason,
        details: details.trim(),
        ...(contact.trim() ? { contact: contact.trim() } : {}),
        ...(captchaToken ? { captchaToken } : {}),
      });
      setSent(true);
    } catch (reportError) {
      setError(reportError instanceof Error && reportError.message ? reportError.message : 'We could not send that report. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  if (sent) {
    return (
      <div className="pub-success-card" role="status">
        <h3>Thank you — your report was received</h3>
        <p>The review team will look into it. Please never share your PIN or password with anyone.</p>
      </div>
    );
  }

  return (
    <form className="pub-form-stack" onSubmit={submit} noValidate>
      {error ? <ErrorBanner message={error} onDismiss={() => setError('')} /> : null}
      <Field id="report-program" label="Event ID or page slug (optional)" hint="Add this if the report is about a specific event.">
        <input id="report-program" value={programId} onChange={(event) => setProgramId(event.target.value)} />
      </Field>
      <Field id="report-reason" label="Reason" required>
        <select id="report-reason" value={reason} onChange={(event) => setReason(event.target.value)}>
          <option value="">Choose a reason…</option>
          {REASONS.map((item) => (
            <option key={item} value={item}>{item}</option>
          ))}
        </select>
      </Field>
      <Field id="report-details" label="What happened?" required hint="Include dates, transaction references or links if you have them.">
        <textarea id="report-details" rows={5} value={details} onChange={(event) => setDetails(event.target.value)} />
      </Field>
      <Field id="report-contact" label="Your email or phone (optional)" hint="Only if you want a reply.">
        <input id="report-contact" value={contact} onChange={(event) => setContact(event.target.value)} />
      </Field>
      <Button type="submit" size="lg" loading={busy}>Send report</Button>
      <p className="yv-tiny yv-muted">Reports go to the Yivents review team. Never include your PIN or password.</p>
    </form>
  );
}
