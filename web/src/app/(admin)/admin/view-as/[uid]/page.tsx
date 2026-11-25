'use client';

/** Read-only impersonation view. The callable logs the access before data is shown. */
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { collection, doc, getDoc, limit, orderBy, query, where } from 'firebase/firestore';
import { Badge, Button, Card, EmptyState, ErrorBanner, LoadingState } from '@yivents/ui';
import { db } from '@/lib/firebase/client';
import { viewAsOrganizer } from '@/components/admin/adminActions';
import { displayDate, friendlyError, useCollection, useDocument } from '@/components/admin/adminData';
import { AdminOnly } from '@/components/admin/AdminShell';

interface ProgramRow {
  id: string;
  title?: string;
  status?: string;
  approvalStatus?: string;
  createdAt?: string;
}

function ViewAs({ uid }: { uid: string }) {
  const user = useDocument<Record<string, unknown>>(() => doc(db, 'users', uid), [uid]);
  const programs = useCollection<ProgramRow>(
    () => query(collection(db, 'programs'), where('ownerUid', '==', uid), orderBy('createdAt', 'desc'), limit(100)),
    [uid],
  );
  const [authorized, setAuthorized] = useState(false);
  const [failure, setFailure] = useState('');

  useEffect(() => {
    let alive = true;
    window.sessionStorage.setItem('yv_viewAs', uid); // banner persists across admin pages
    viewAsOrganizer(uid)
      .then(() => alive && setAuthorized(true))
      .catch((err) => alive && setFailure(friendlyError(err, 'Impersonation was not authorised.')));
    return () => {
      alive = false;
    };
  }, [uid]);

  function exit() {
    window.sessionStorage.removeItem('yv_viewAs');
    window.location.assign('/admin');
  }

  return (
    <div className="yv-stack">
      <div className="yv-warning-banner" role="status">
        <span><strong>Read-only view-as session.</strong> You are viewing organiser {uid}. All access is logged by viewAsOrganizer. No action buttons are available.</span>
        <Button size="sm" variant="outline" onClick={exit}>Exit view-as</Button>
      </div>

      {failure ? <ErrorBanner message={failure} /> : null}
      {!authorized && !failure ? <LoadingState label="Opening read-only session…" /> : null}

      {authorized ? (
        <div className="yv-stack">
          <div>
            <h1>Organiser view</h1>
            <p className="yv-muted">The same read-only data the organiser can see. Nothing on this page can be edited.</p>
          </div>

          {user.error || programs.error ? <ErrorBanner message={user.error || programs.error} /> : null}
          {user.loading || programs.loading ? <LoadingState label="Loading organiser data…" /> : null}

          {!user.loading && !user.data ? <EmptyState title="Organiser not found" message="The account may have been removed." /> : null}
          {user.data ? (
            <Card className="yv-stack">
              <div className="yv-spread">
                <div>
                  <h2 style={{ fontSize: '1.15rem' }}>{String(user.data.displayName ?? 'Unnamed organiser')}</h2>
                  <p className="yv-tiny yv-muted">{String(user.data.email ?? uid)}</p>
                </div>
                <Badge tone={user.data.status === 'active' ? 'success' : 'warning'}>{String(user.data.status ?? 'unknown')}</Badge>
              </div>
              {typeof user.data.suspensionReason === 'string' && user.data.suspensionReason ? <p>Reason shown to organiser: {user.data.suspensionReason}</p> : null}
              <p className="yv-tiny yv-muted">Joined {displayDate(user.data.createdAt)} · Verified badge: {user.data.verifiedBadge ? 'yes' : 'no'}</p>
            </Card>
          ) : null}

          <Card className="yv-stack">
            <h2 style={{ fontSize: '1.15rem' }}>Programmes ({programs.rows.length})</h2>
            {!programs.loading && !programs.rows.length ? <EmptyState title="No programmes" message="This organiser has not created a programme yet." /> : null}
            {!programs.loading && programs.rows.length ? (
              <div className="table-wrap">
                <table>
                  <thead><tr><th scope="col">Programme</th><th scope="col">Status</th><th scope="col">Approval</th><th scope="col">Created</th></tr></thead>
                  <tbody>
                    {programs.rows.map((program) => (
                      <tr key={program.id}>
                        <td>{program.title ?? program.id}</td>
                        <td className="yv-tiny">{program.status ?? '—'}</td>
                        <td className="yv-tiny">{program.approvalStatus ?? '—'}</td>
                        <td className="yv-tiny">{displayDate(program.createdAt, false)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}
          </Card>

          <Link className="yv-btn yv-btn-outline" href="/admin">Back to admin overview</Link>
        </div>
      ) : null}
    </div>
  );
}

export default function AdminViewAsPage() {
  const params = useParams<{ uid: string }>();
  return (
    <AdminOnly allow={['superAdmin']}>
      <ViewAs uid={params.uid} />
    </AdminOnly>
  );
}
