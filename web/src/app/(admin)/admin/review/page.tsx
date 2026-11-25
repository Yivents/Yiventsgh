'use client';

import { useState } from 'react';
import { collection, limit, orderBy, query, where } from 'firebase/firestore';
import { formatEventRange, type EventDetails } from '@yivents/shared';
import { Badge, Button, Card, EmptyState, ErrorBanner, Field, LoadingState, Modal } from '@yivents/ui';
import { db } from '@/lib/firebase/client';
import { ADMIN_ACTIONS, adminAction } from '@/components/admin/adminActions';
import { displayDate, friendlyError, useCollection } from '@/components/admin/adminData';
import { AdminOnly } from '@/components/admin/AdminShell';

interface PendingProgram {
  id: string;
  title?: string;
  description?: string;
  visibility?: string;
  ownerUid?: string;
  createdAt?: string;
  event?: EventDetails;
}

type Decision = { kind: 'approve' | 'reject'; program: PendingProgram } | null;

function ReviewQueue() {
  const { rows, loading, error } = useCollection<PendingProgram>(
    () => query(collection(db, 'programs'), where('approvalStatus', '==', 'pending'), orderBy('createdAt', 'desc'), limit(100)),
    [],
  );
  const [search, setSearch] = useState('');
  const [decision, setDecision] = useState<Decision>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [failure, setFailure] = useState('');

  const filtered = rows.filter((row) => `${row.title ?? ''} ${row.ownerUid ?? ''}`.toLowerCase().includes(search.trim().toLowerCase()));

  async function decide() {
    if (!decision) return;
    setBusy(true);
    setFailure('');
    try {
      const action = decision.kind === 'approve' ? ADMIN_ACTIONS.approveListing : ADMIN_ACTIONS.rejectListing;
      await adminAction({ action, targetId: decision.program.id, reason: reason || undefined });
      setNotice(decision.kind === 'approve' ? 'Programme approved and listed.' : 'Programme rejected.');
      setDecision(null);
      setReason('');
    } catch (err) {
      setFailure(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="yv-stack">
      <div>
        <h1>Review queue</h1>
        <p className="yv-muted">Public listings wait here until approved. Rejections keep the programme private and are audit-logged.</p>
      </div>

      {error ? <ErrorBanner message={error} /> : null}
      {notice ? <Card><p>{notice}</p></Card> : null}
      {failure ? <ErrorBanner message={failure} onDismiss={() => setFailure('')} /> : null}

      <Field id="review-search" label="Search queue" hint="Programme title or organiser ID">
        <input id="review-search" value={search} onChange={(e) => setSearch(e.target.value)} />
      </Field>

      {loading ? <LoadingState label="Loading pending programmes…" /> : null}
      {!loading && !filtered.length ? (
        <EmptyState title="Queue is clear" message={search ? 'No pending programme matches that search.' : 'No programmes are waiting for review.'} />
      ) : null}

      {!loading && filtered.length ? (
        <div className="yv-stack">
          {filtered.map((program) => (
            <Card key={program.id} className="yv-stack">
              <div className="yv-spread">
                <div>
                  <h2 style={{ fontSize: '1.15rem' }}>{program.title || 'Untitled programme'}</h2>
                  <p className="yv-tiny yv-muted">Organiser {program.ownerUid} · Submitted {displayDate(program.createdAt)}</p>
                </div>
                <Badge tone={program.visibility === 'public' ? 'info' : 'neutral'}>{program.visibility ?? 'link_only'}</Badge>
              </div>
              {program.description ? <p>{program.description}</p> : null}
              {program.event ? <p className="yv-tiny yv-muted">{formatEventRange(program.event)}</p> : null}
              <div className="yv-row">
                <Button size="sm" disabled={busy} onClick={() => { setDecision({ kind: 'approve', program }); setReason(''); }}>Approve</Button>
                <Button size="sm" variant="outline" disabled={busy} onClick={() => { setDecision({ kind: 'reject', program }); setReason(''); }}>Reject</Button>
              </div>
            </Card>
          ))}
        </div>
      ) : null}

      <Modal open={Boolean(decision)} title={decision?.kind === 'approve' ? 'Approve listing' : 'Reject listing'} onClose={() => setDecision(null)}>
        <div className="yv-stack">
          <p className="yv-muted">{decision?.kind === 'approve' ? 'The programme will appear in public listings.' : 'Add a short reason for the review record. Keep it plain text.'}</p>
          {decision?.kind === 'reject' ? (
            <Field id="review-reason" label="Reason" hint="Shown in the audit record">
              <textarea id="review-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
            </Field>
          ) : null}
          <div className="yv-row">
            <Button variant={decision?.kind === 'reject' ? 'danger' : 'primary'} loading={busy} onClick={decide}>
              {decision?.kind === 'approve' ? 'Approve programme' : 'Reject programme'}
            </Button>
            <Button variant="ghost" onClick={() => setDecision(null)}>Cancel</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

export default function AdminReviewPage() {
  return (
    <AdminOnly allow={['superAdmin', 'moderator']}>
      <ReviewQueue />
    </AdminOnly>
  );
}
