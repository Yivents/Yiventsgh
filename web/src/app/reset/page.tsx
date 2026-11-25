'use client';

/** Password reset request. Firebase sends the reset email directly. */
import { sendPasswordResetEmail } from 'firebase/auth';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { Button, ErrorBanner, Field, SuccessBanner } from '@yivents/ui';
import { auth } from '@/lib/firebase/client';
import { AuthShell } from '@/components/organizer/AuthShell';
import { friendlyError } from '@/components/organizer/utils';

export default function ResetPage() {
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    setSent(false);
    try {
      await sendPasswordResetEmail(auth, email.trim());
      setSent(true);
    } catch (err) {
      setError(friendlyError(err, 'Could not send the reset email. Please try again.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell
      title="Reset your password"
      subtitle="We will send a reset link to your email address."
      footer={
        <p>
          Remembered it? <Link href="/login">Back to sign in</Link>
        </p>
      }
    >
      {error ? <ErrorBanner message={error} onDismiss={() => setError('')} /> : null}
      {sent ? <SuccessBanner message="Reset link sent. Check your inbox and spam folder." /> : null}
      <form onSubmit={submit}>
        <Field label="Email address" id="reset-email" required>
          <input
            className="org-input"
            id="reset-email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
        </Field>
        <Button type="submit" loading={busy} style={{ width: '100%' }}>
          Send reset link
        </Button>
      </form>
    </AuthShell>
  );
}
