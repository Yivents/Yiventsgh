'use client';

import { useState } from 'react';
import { collection, limit, orderBy, query } from 'firebase/firestore';
import { Badge, Button, Card, EmptyState, ErrorBanner, LoadingState, Tabs } from '@yivents/ui';
import { db } from '@/lib/firebase/client';
import { ADMIN_ACTIONS, adminAction } from '@/components/admin/adminActions';
import { displayDate, friendlyError, useCollection } from '@/components/admin/adminData';
import { AdminOnly } from '@/components/admin/AdminShell';

interface ReportRow {
  id: string;
  programId?: string;
  reason?: string;
  details?: string;
  contact?: string;
  status?: string;
  createdAt?: string;
}

type Filter = 'open' | 'in_progress' | 'resolved' | 'all';

function ReportsInbox() {
  const { rows, loading, error } = useCollection<ReportRow>(
    () => query(collection(db, 'reports'), orderBy('createdAt', 'desc'), limit(200)),
    [],
  );
  const [filter, setFilter] = useState<Filter>('open');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [failure, setFailure] = useState('');

  const counts = {
    open: rows.filter((r) => r.status === 'open').length,
    in_progress: rows.filter((r) => r.status === 'in_progress').length,
    resolved: rows.filter((r) => (r.status === 'resolved' || r.status === 'dismissed')).length,
    all: rows.length,
  };
  const visible = filter === 'all' ? rows : filter === 'resolved'
    ? rows.filter((r) => r.status === 'resolved' || r.status === 'dismissed')
    : rows.filter((r) => r.status === filter);

  async function setStatus(id: string, status: string) {
    setBusy(true);
    setFailure('');
    setNotice('');
    try {
      await adminAction({ action: ADMIN_ACTIONS.updateReport, targetId: id, value: status });
      setNotice(`Report marked ${status.replace('_', ' ')}.`);
    } catch (err) {
      setFailure(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="yv-stack">
      <div>
        <h1>Reports inbox</h1>
        <p className="yv-muted">Reports from attendees and organisers. Status changes are audit-logged; reports are never edited here.</p>
      </div>

      {error ? <ErrorBanner message={error} /> : null}
      {notice ? <Card><p>{notice}</p></Card> : null}
      {failure ? <ErrorBanner message={failure} onDismiss={() => setFailure('')} /> : null}

      <Tabs<Filter>
        tabs={[
          { id: 'open', label: 'Open', count: counts.open },
          { id: 'in_progress', label: 'In progress', count: counts.in_progress },
          { id: 'resolved', label: 'Resolved', count: counts.resolved },
          { id: 'all', label: 'All', count: counts.all },
        ]}
        active={filter}
        onChange={setFilter}
      />

      {loading ? <LoadingState label="Loading reports…" /> : null}
      {!loading && !visible.length ? (
        <EmptyState title="Nothing here" message={filter === 'open' ? 'No open reports need attention right now.' : 'No reports match this filter.'} />
      ) : null}

      {!loading && visible.length ? (
        <div className="yv-stack">
          {visible.map((report) => (
            <Card key={report.id} className="yv-stack">
              <div className="yv-spread">
                <div>
                  <h2 style={{ fontSize: '1.1rem' }}>{report.reason || 'Unspecified reason'}</h2>
                  <p className="yv-tiny yv-muted">
                    {displayDate(report.createdAt)} · Programme {report.programId || 'not linked'}
                  </p>
                </div>
                <Badge tone={report.status === 'open' ? 'warning' : report.status === 'in_progress' ? 'info' : 'success'}>{report.status ?? 'unknown'}</Badge>
              </div>
              {report.details ? <p>{report.details}</p> : null}
              {report.contact ? <p className="yv-tiny yv-muted">Contact: {report.contact}</p> : null}
              <div className="yv-row">
                <Button size="sm" variant="outline" disabled={busy || report.status === 'in_progress'} onClick={() => setStatus(report.id, 'in_progress')}>Mark in progress</Button>
                <Button size="sm" disabled={busy || report.status === 'resolved'} onClick={() => setStatus(report.id, 'resolved')}>Resolve</Button>
                <Button size="sm" variant="ghost" disabled={busy || report.status === 'dismissed'} onClick={() => setStatus(report.id, 'dismissed')}>Dismiss</Button>
              </div>
            </Card>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export default function AdminReportsPage() {
  return (
    <AdminOnly allow={['superAdmin']}>
      <ReportsInbox />
    </AdminOnly>
  );
}
