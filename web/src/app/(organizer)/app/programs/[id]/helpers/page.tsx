'use client';

import { deleteDoc, doc } from 'firebase/firestore';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Badge, Button, Card, ErrorBanner, Field, LoadingState, Modal, SuccessBanner, WarningBanner } from '@yivents/ui';
import { db } from '@/lib/firebase/client';
import { acceptHelperInvite, inviteHelper } from '@/components/organizer/callables';
import { useHelpers, useProgram } from '@/components/organizer/data';
import { copyText, friendlyError, statusTone } from '@/components/organizer/utils';

export default function HelpersPage() {
  const params = useParams<{ id: string }>();
  const programId = String(params?.id ?? '');
  const { program } = useProgram(programId);
  const { helpers, loading } = useHelpers(programId);
  const [email, setEmail] = useState('');
  const [inviteLink, setInviteLink] = useState('');
  const [inviteToken, setInviteToken] = useState('');
  const [revokeUid, setRevokeUid] = useState('');
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    const token = new URLSearchParams(window.location.search).get('invite');
    if (token) setInviteToken(token);
  }, []);

  const createInvite = async () => {
    setBusy('invite');
    setError('');
    setNotice('');
    try {
      const result = await inviteHelper(programId, email.trim() || undefined);
      const link =
        result.inviteUrl ??
        result.url ??
        result.link ??
        (result.token
          ? `${window.location.origin}/app/programs/${programId}/helpers?invite=${encodeURIComponent(result.token)}`
          : '');
      setInviteLink(link);
      setNotice('Invite link ready. Send it to your helper.');
    } catch (err) {
      setError(friendlyError(err, 'Could not create an invite.'));
    } finally {
      setBusy('');
    }
  };

  const accept = async () => {
    setBusy('accept');
    setError('');
    try {
      await acceptHelperInvite(inviteToken, programId);
      setInviteToken('');
      setNotice('You now have helper access to this program.');
    } catch (err) {
      setError(friendlyError(err, 'Could not accept the invite.'));
    } finally {
      setBusy('');
    }
  };

  const revoke = async () => {
    if (!revokeUid) return;
    setBusy('revoke');
    setError('');
    try {
      await deleteDoc(doc(db, 'programs', programId, 'helpers', revokeUid));
      setNotice('Helper access revoked.');
      setRevokeUid('');
    } catch (err) {
      setError(friendlyError(err, 'Could not revoke helper access.'));
    } finally {
      setBusy('');
    }
  };

  if (loading) return <LoadingState label="Loading helpers…" />;

  return (
    <div className="org-stack">
      <div>
        <h1 style={{ margin: 0 }}>Helpers</h1>
        <p className="yv-muted" style={{ margin: '.35rem 0 0' }}>Invite trusted people to review and approve registrations.</p>
      </div>
      {error ? <ErrorBanner message={error} onDismiss={() => setError('')} /> : null}
      {notice ? <SuccessBanner message={notice} /> : null}
      {program?.status === 'archived' ? <WarningBanner>This program is archived and read-only.</WarningBanner> : null}
      <WarningBanner>Helpers can only use the approval inbox. They cannot change setup, tickets, payments, settings or branding.</WarningBanner>

      {inviteToken ? (
        <Card>
          <h2 style={{ marginTop: 0 }}>You have been invited</h2>
          <p>Accept to review and approve registrations for this program.</p>
          <Button onClick={() => void accept()} loading={busy === 'accept'}>Accept helper invite</Button>
        </Card>
      ) : null}

      <Card>
        <h2 style={{ marginTop: 0 }}>Invite a helper</h2>
        <Field label="Email (optional)" id="helper-email" hint="Used to label the invite. Anyone with the link still needs to sign in.">
          <input className="org-input" id="helper-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="helper@example.com" />
        </Field>
        <Button onClick={() => void createInvite()} loading={busy === 'invite'} disabled={program?.status === 'archived'}>Create invite link</Button>
        {inviteLink ? (
          <div style={{ marginTop: '1rem' }}>
            <label className="org-muted" htmlFor="helper-invite-link">Invite link</label>
            <input className="org-input" id="helper-invite-link" readOnly value={inviteLink} onFocus={(event) => event.target.select()} />
            <Button variant="outline" size="sm" style={{ marginTop: '.5rem' }} onClick={() => void copyText(inviteLink).then((ok) => setNotice(ok ? 'Invite link copied.' : 'Could not copy the link.'))}>Copy invite link</Button>
          </div>
        ) : null}
      </Card>

      <Card>
        <h2 style={{ marginTop: 0 }}>Current helpers</h2>
        {!helpers.length ? <p className="yv-muted">No helpers yet.</p> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th scope="col">Helper</th><th scope="col">Status</th><th scope="col">Permissions</th><th scope="col">Action</th></tr></thead>
              <tbody>
                {helpers.map((helper) => (
                  <tr key={helper.uid}>
                    <th scope="row">{helper.displayName || helper.email || helper.uid}</th>
                    <td><Badge tone={statusTone(helper.status ?? 'active')}>{helper.status ?? 'active'}</Badge></td>
                    <td>Review and approve only</td>
                    <td><Button variant="danger" size="sm" onClick={() => setRevokeUid(helper.uid)}>Revoke</Button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal open={Boolean(revokeUid)} title="Revoke helper access?" onClose={() => setRevokeUid('')}>
        <p>They will immediately lose access to the approval inbox.</p>
        <div className="org-row">
          <Button variant="outline" onClick={() => setRevokeUid('')}>Keep helper</Button>
          <Button variant="danger" loading={busy === 'revoke'} onClick={() => void revoke()}>Revoke access</Button>
        </div>
      </Modal>
    </div>
  );
}
