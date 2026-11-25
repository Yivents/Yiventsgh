'use client';

/** Email/password sign-in with optional Google sign-in. */
import { GoogleAuthProvider, signInWithEmailAndPassword, signInWithPopup } from 'firebase/auth';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Button, ErrorBanner, Field } from '@yivents/ui';
import { useSession } from '@/lib/auth';
import { auth } from '@/lib/firebase/client';
import { AuthShell } from '@/components/organizer/AuthShell';
import { friendlyError } from '@/components/organizer/utils';

export default function LoginPage() {
  const router = useRouter();
  const { user, loading } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [next, setNext] = useState('/app');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get('next');
    if (requested?.startsWith('/') && !requested.startsWith('//')) setNext(requested);
  }, []);

  useEffect(() => {
    if (!loading && user) router.replace(next);
  }, [loading, user, next, router]);

  const signIn = async (method: 'email' | 'google') => {
    setBusy(method);
    setError('');
    try {
      if (method === 'email') await signInWithEmailAndPassword(auth, email.trim(), password);
      else await signInWithPopup(auth, new GoogleAuthProvider());
      router.replace(next);
    } catch (err) {
      setError(friendlyError(err, 'Could not sign you in. Check your details and try again.'));
    } finally {
      setBusy('');
    }
  };

  return (
    <AuthShell
      title="Welcome back"
      subtitle="Sign in to manage your events, registrations and tickets."
      footer={
        <p>
          New to Yivents? <Link href="/signup">Create an account</Link>
        </p>
      }
    >
      {error ? <ErrorBanner message={error} onDismiss={() => setError('')} /> : null}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void signIn('email');
        }}
      >
        <Field label="Email address" id="login-email" required>
          <input
            className="org-input"
            id="login-email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            required
          />
        </Field>
        <Field label="Password" id="login-password" required>
          <input
            className="org-input"
            id="login-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
        </Field>
        <p style={{ textAlign: 'right', marginTop: '-.5rem' }}>
          <Link href="/reset">Forgot password?</Link>
        </p>
        <Button type="submit" loading={busy === 'email'} style={{ width: '100%' }}>
          Sign in
        </Button>
      </form>
      <div style={{ display: 'flex', alignItems: 'center', gap: '.75rem', margin: '1.25rem 0' }}>
        <span style={{ flex: 1, borderTop: '1px solid var(--border)' }} />
        <span className="org-muted">or</span>
        <span style={{ flex: 1, borderTop: '1px solid var(--border)' }} />
      </div>
      <Button variant="outline" loading={busy === 'google'} onClick={() => void signIn('google')} style={{ width: '100%' }}>
        Continue with Google
      </Button>
    </AuthShell>
  );
}
