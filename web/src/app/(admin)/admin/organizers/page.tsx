'use client';

import { useState } from 'react';
import { collection, limit, orderBy, query } from 'firebase/firestore';
import { Badge, Button, Card, EmptyState, ErrorBanner, Field, LoadingState, Modal } from '@yivents/ui';
import { db } from '@/lib/firebase/client';
import { plainTextSchema } from '@yivents/shared';
import { ADMIN_ACTIONS, adminAction } from '@/components/admin/adminActions';
import { displayDate, friendlyError, useCollection } from '@/components/admin/adminData';
import { AdminOnly } from '@/components/admin/AdminShell';

interface OrganizerRow {
  id: string;
  email?: string;
  displayName?: string;
  status?: 'active' | 'suspended' | 'removed';
  suspensionReason?: string;
  verifiedBadge?: boolean;
  twoFactorEnabled?: boolean;
  createdAt?: string;
}

type Dialog = { kind: 'suspend' | 'remove' | 'add'; uid?: string } | null;

function Organizers() {
  const { rows, loading, error } = useCollection<OrganizerRow>(
    () => query(collection(db, 'users'), orderBy('createdAt', 'desc'), limit(200)),
    [],
  );
  const [search, setSearch] = useState('');
  const [dialog, setDialog] = useState<Dialog>(null);
  const [reason, setReason] = useState('');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [failure, setFailure] = useState('');

  const filtered = rows.filter((row) => {
    const text = `${row.displayName ?? ''} ${row.email ?? ''} ${row.id}`.toLowerCase();
    return text.includes(search.trim().toLowerCase());
  });

  async function act(request: Parameters<typeof adminAction>[0], success: string) {
    setBusy(true);
    setFailure('');
    setNotice('');
    try {
      await adminAction(request);
      setNotice(success);
      setDialog(null);
      setReason('');
      setEmail('');
      setName('');
    } catch (err) {
      setFailure(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="yv-stack">
      <div className="yv-spread">
        <div>
          <h1>Organisers</h1>
          <p className="yv-muted">View accounts, add an organiser, suspend with a visible reason, restore, remove and manage the verified badge.</p>
        </div>
        <Button onClick={() => setDialog({ kind: 'add' })}>Add organiser</Button>
      </div>

      {error ? <ErrorBanner message={error} /> : null}
      {notice ? <Card><p>{notice}</p></Card> : null}
      {failure ? <ErrorBanner message={failure} onDismiss={() => setFailure('')} /> : null}

      <Field id="organizer-search" label="Search organisers" hint="Name, email or user ID">
        <input id="organizer-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="e.g. akosua@example.com" />
      </Field>

      {loading ? <LoadingState label="Loading organisers…" /> : null}
      {!loading && !filtered.length ? (
        <EmptyState title="No organisers found" message={search ? 'Try a different search term.' : 'Organisers appear here after they sign up.'} />
      ) : null}

      {!loading && filtered.length ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th scope="col">Organiser</th><th scope="col">Status</th><th scope="col">Verified</th><th scope="col">Joined</th><th scope="col">Actions</th></tr>
            </thead>
            <tbody>
              {filtered.map((row: OrganizerRow) => (
                <tr key={row.id}>
                  <td>
                    <strong>{row.displayName || 'Unnamed organiser'}</strong>
                    <div className="yv-tiny yv-muted">{row.email || row.id}</div>
                    {row.suspensionReason ? <div className="yv-tiny">Reason shown to organiser: {row.suspensionReason}</div> : null}
                    {row.twoFactorEnabled ? <Badge tone="info">2FA on</Badge> : null}
                  </td>
                  <td><Badge tone={row.status === 'active' ? 'success' : row.status === 'suspended' ? 'danger' : 'neutral'}>{row.status ?? 'unknown'}</Badge></td>
                  <td><Badge tone={row.verifiedBadge ? 'success' : 'neutral'}>{row.verifiedBadge ? 'Verified' : 'Not verified'}</Badge></td>
                  <td className="yv-tiny">{displayDate(row.createdAt, false)}</td>
                  <td>
                    <div className="yv-row">
                      {row.status === 'suspended' ? (
                        <Button size="sm" variant="outline" disabled={busy} onClick={() => act({ action: ADMIN_ACTIONS.restoreOrganizer, targetId: row.id }, 'Organiser restored.')}>Restore</Button>
                      ) : (
                        <Button size="sm" variant="danger" disabled={busy} onClick={() => { setDialog({ kind: 'suspend', uid: row.id }); setReason(''); }}>Suspend</Button>
                      )}
                      <Button size="sm" variant="outline" disabled={busy} onClick={() => act({ action: ADMIN_ACTIONS.setVerifiedBadge, targetId: row.id, value: !row.verifiedBadge }, 'Verified badge updated.')}>
                        {row.verifiedBadge ? 'Remove badge' : 'Verify'}
                      </Button>
                      <Button size="sm" variant="ghost" disabled={busy} onClick={() => setDialog({ kind: 'remove', uid: row.id })}>Remove</Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <Modal open={dialog?.kind === 'suspend'} title="Suspend organiser" onClose={() => setDialog(null)}>
        <div className="yv-stack">
          <p className="yv-muted">The reason is stored on the account and shown to the organiser.</p>
          <Field id="suspend-reason" label="Reason" required error={reason && !plainTextSchema.safeParse(reason).success ? 'Use plain text only, up to 5000 characters.' : ''}>
            <textarea id="suspend-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          <div className="yv-row">
            <Button variant="danger" loading={busy} disabled={!plainTextSchema.safeParse(reason).success} onClick={() => act({ action: ADMIN_ACTIONS.suspendOrganizer, targetId: dialog?.uid, reason }, 'Organiser suspended.')}>Suspend account</Button>
            <Button variant="ghost" onClick={() => setDialog(null)}>Cancel</Button>
          </div>
        </div>
      </Modal>

      <Modal open={dialog?.kind === 'remove'} title="Remove organiser" onClose={() => setDialog(null)}>
        <div className="yv-stack">
          <p className="yv-muted">This removes access. The action is audit-logged. Consider suspending first if a review is needed.</p>
          <div className="yv-row">
            <Button variant="danger" loading={busy} onClick={() => act({ action: ADMIN_ACTIONS.removeOrganizer, targetId: dialog?.uid, reason: 'Removed by administrator' }, 'Organiser removed.')}>Remove account</Button>
            <Button variant="ghost" onClick={() => setDialog(null)}>Cancel</Button>
          </div>
        </div>
      </Modal>

      <Modal open={dialog?.kind === 'add'} title="Add organiser" onClose={() => setDialog(null)}>
        <div className="yv-stack">
          <p className="yv-muted">The server creates or invites the account. There is no editable role field; admin rights are custom claims only.</p>
          <Field id="new-organizer-email" label="Email" required>
            <input id="new-organizer-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </Field>
          <Field id="new-organizer-name" label="Display name">
            <input id="new-organizer-name" value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <div className="yv-row">
            <Button loading={busy} disabled={!email} onClick={() => act({ action: ADMIN_ACTIONS.addOrganizer, payload: { email, displayName: name } }, 'Organiser invitation requested.')}>Add organiser</Button>
            <Button variant="ghost" onClick={() => setDialog(null)}>Cancel</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

export default function AdminOrganizersPage() {
  return (
    <AdminOnly allow={['superAdmin']}>
      <Organizers />
    </AdminOnly>
  );
}
