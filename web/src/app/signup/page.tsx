'use client';

/** Organizer signup. Only owner-editable profile fields are written; claims are never written here. */
import { createUserWithEmailAndPassword, updateProfile } from 'firebase/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { isValidGhanaPhone } from '@yivents/shared';
import { Button, ErrorBanner, Field, LoadingState } from '@yivents/ui';
import { auth, db } from '@/lib/firebase/client';
import { AuthShell } from '@/components/organizer/AuthShell';
import { friendlyError } from '@/components/organizer/utils';

interface LegalVersions {
  terms: string;
  privacy: string;
  notice?: string;
}

export default function SignupPage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [acceptedPrivacy, setAcceptedPrivacy] = useState(false);
  const [legal, setLegal] = useState<LegalVersions | null>(null);
  const [legalLoading, setLegalLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    // The canonical publicSettings document id is not fixed in the contract;
    // check the likely ones rather than accepting an unknown legal version.
    (async () => {
      for (const id of ['legal', 'platform', 'settings']) {
        try {
          const snapshot = await getDoc(doc(db, 'publicSettings', id));
          const data = snapshot.data();
          const versions = data?.legalVersions as Partial<LegalVersions> | undefined;
          if (versions?.terms && versions?.privacy) {
            if (alive) setLegal({ terms: versions.terms, privacy: versions.privacy, notice: versions.notice });
            return;
          }
          if (data?.termsVersion && data?.privacyVersion) {
            if (alive) setLegal({ terms: String(data.termsVersion), privacy: String(data.privacyVersion) });
            return;
          }
        } catch {
          // Try the next known document.
        }
      }
    })().finally(() => {
      if (alive) setLegalLoading(false);
    });
    return () => {
      alive = false;
    };
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    if (!legal) {
      setError('Legal versions could not be loaded. Please refresh and try again.');
      return;
    }
    if (!acceptedTerms || !acceptedPrivacy) {
      setError('Please accept both the Terms and the Privacy Policy.');
      return;
    }
    if (phone.trim() && !isValidGhanaPhone(phone.trim())) {
      setError('Enter a valid Ghana phone number, or leave the phone field blank.');
      return;
    }
    setBusy(true);
    try {
      const credential = await createUserWithEmailAndPassword(auth, email.trim(), password);
      const at = new Date().toISOString();
      await updateProfile(credential.user, { displayName: name.trim() });
      await setDoc(doc(db, 'users', credential.user.uid), {
        uid: credential.user.uid,
        email: credential.user.email ?? email.trim(),
        displayName: name.trim(),
        ...(phone.trim() ? { phone: phone.trim() } : {}),
        accountType: 'organizer',
        status: 'active',
        verifiedBadge: false,
        acceptedLegal: { termsVersion: legal.terms, privacyVersion: legal.privacy, acceptedAt: at },
        twoFactorEnabled: false,
        createdAt: at,
        updatedAt: at,
      });
      router.replace('/app');
    } catch (err) {
      setError(friendlyError(err, 'Could not create your account. Please try again.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell
      title="Create your organizer account"
      subtitle="Run registrations, payments and tickets from one place."
      footer={
        <p>
          Already have an account? <Link href="/login">Sign in</Link>
        </p>
      }
    >
      {error ? <ErrorBanner message={error} onDismiss={() => setError('')} /> : null}
      {legalLoading ? <LoadingState label="Loading the current legal terms…" /> : null}
      <form onSubmit={submit}>
        <Field label="Your name" id="signup-name" required>
          <input className="org-input" id="signup-name" value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" required />
        </Field>
        <Field label="Email address" id="signup-email" required>
          <input className="org-input" id="signup-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required />
        </Field>
        <Field label="Phone (optional)" id="signup-phone" hint="Ghana number, e.g. 024XXXXXXX">
          <input className="org-input" id="signup-phone" type="tel" value={phone} onChange={(event) => setPhone(event.target.value)} autoComplete="tel" />
        </Field>
        <Field label="Password" id="signup-password" hint="At least 6 characters" required>
          <input className="org-input" id="signup-password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" minLength={6} required />
        </Field>

        <label className="org-check">
          <input type="checkbox" checked={acceptedTerms} disabled={!legal} onChange={(event) => setAcceptedTerms(event.target.checked)} />
          <span>I accept the Terms of Service{legal ? ` (version ${legal.terms})` : ''}.</span>
        </label>
        <label className="org-check">
          <input type="checkbox" checked={acceptedPrivacy} disabled={!legal} onChange={(event) => setAcceptedPrivacy(event.target.checked)} />
          <span>I accept the Privacy Policy{legal ? ` (version ${legal.privacy})` : ''}.</span>
        </label>
        <p className="org-muted">Your acceptance is stored with your account. Admin and registration permissions are never editable here.</p>

        <Button type="submit" loading={busy} disabled={!legal || legalLoading} style={{ width: '100%', marginTop: '1rem' }}>
          Create account
        </Button>
      </form>
    </AuthShell>
  );
}
