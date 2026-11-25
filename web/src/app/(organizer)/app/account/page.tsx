'use client';

import { updateDoc, doc } from 'firebase/firestore';
import { useEffect, useState } from 'react';
import { isValidGhanaPhone } from '@yivents/shared';
import { Badge, Button, Card, ErrorBanner, Field, LoadingState, SuccessBanner } from '@yivents/ui';
import { useSession } from '@/lib/auth';
import { db } from '@/lib/firebase/client';
import { useProfile } from '@/components/organizer/data';
import { friendlyError } from '@/components/organizer/utils';

export default function AccountPage() {
  const { user, loading: sessionLoading } = useSession();
  const uid = user?.uid;
  const { profile, loading } = useProfile(uid);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [photoUrl, setPhotoUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (!profile) return;
    setName(profile.displayName ?? '');
    setPhone(profile.phone ?? '');
    setPhotoUrl(profile.photoURL ?? '');
  }, [profile?.id, profile?.displayName, profile?.phone, profile?.photoURL]);

  if (sessionLoading || loading) return <LoadingState label="Loading your profile…" />;
  if (!user || !profile) return <ErrorBanner message="Your profile could not be loaded." />;

  const save = async () => {
    setError('');
    setNotice('');
    if (phone.trim() && !isValidGhanaPhone(phone.trim())) {
      setError('Enter a valid Ghana phone number, or leave it blank.');
      return;
    }
    setBusy(true);
    try {
      // Only fields an owner may edit are written. Status, badges and claims
      // are controlled by Yivents and never appear in this update.
      await updateDoc(doc(db, 'users', uid), {
        displayName: name.trim(),
        ...(phone.trim() ? { phone: phone.trim() } : {}),
        ...(photoUrl.trim() ? { photoURL: photoUrl.trim() } : {}),
        updatedAt: new Date().toISOString(),
      });
      setNotice('Profile saved.');
    } catch (err) {
      setError(friendlyError(err, 'Could not save your profile.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="org-stack">
      <div>
        <h1 style={{ margin: 0 }}>Account</h1>
        <p className="yv-muted" style={{ margin: '.35rem 0 0' }}>Your organizer profile and accepted legal versions.</p>
      </div>
      {error ? <ErrorBanner message={error} onDismiss={() => setError('')} /> : null}
      {notice ? <SuccessBanner message={notice} /> : null}

      <Card>
        <h2 style={{ marginTop: 0 }}>Profile</h2>
        <p className="org-muted">Signed in as {profile.email || user.email}. Your email is not editable here.</p>
        <Field label="Display name" id="account-name"><input className="org-input" id="account-name" value={name} onChange={(event) => setName(event.target.value)} /></Field>
        <Field label="Phone (optional)" id="account-phone"><input className="org-input" id="account-phone" type="tel" value={phone} onChange={(event) => setPhone(event.target.value)} /></Field>
        <Field label="Photo URL (optional)" id="account-photo"><input className="org-input" id="account-photo" type="url" value={photoUrl} onChange={(event) => setPhotoUrl(event.target.value)} /></Field>
        <Button onClick={() => void save()} loading={busy}>Save profile</Button>
      </Card>

      <Card>
        <h2 style={{ marginTop: 0 }}>Legal versions</h2>
        <div className="org-row">
          <Badge tone="info">Terms: {profile.acceptedLegal?.termsVersion ?? 'not recorded'}</Badge>
          <Badge tone="info">Privacy: {profile.acceptedLegal?.privacyVersion ?? 'not recorded'}</Badge>
        </div>
        <p className="org-muted">
          Accepted {profile.acceptedLegal?.acceptedAt ? new Date(profile.acceptedLegal.acceptedAt).toLocaleDateString() : '—'}.
          These are read-only records of the versions you accepted.
        </p>
      </Card>

      <Card>
        <h2 style={{ marginTop: 0 }}>Security</h2>
        <p className="org-muted">Two-factor authentication for organizers is optional and coming later.</p>
        <Button variant="outline" disabled>Enable 2FA — coming later</Button>
        <p className="org-muted">Registration and admin permissions come only from Yivents custom claims. They are never editable by users.</p>
      </Card>
    </div>
  );
}
