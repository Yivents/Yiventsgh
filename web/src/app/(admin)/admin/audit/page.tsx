'use client';

import { useState } from 'react';
import { collection, limit, orderBy, query } from 'firebase/firestore';
import { Badge, Card, EmptyState, ErrorBanner, Field, LoadingState } from '@yivents/ui';
import { db } from '@/lib/firebase/client';
import { displayDate, friendlyError, useCollection } from '@/components/admin/adminData';
import { AdminOnly } from '@/components/admin/AdminShell';

interface AuditRow {
  id: string;
  actorUid?: string;
  action?: string;
  targetId?: string;
  reason?: string;
  at?: string;
  createdAt?: string;
  result?: string;
}

function AuditLog() {
  const { rows, loading, error } = useCollection<AuditRow>(
    () => query(collection(db, 'auditLogs'), orderBy('at', 'desc'), limit(200)),
    [],
  );
  const [actor, setActor] = useState('');
  const [action, setAction] = useState('');
  const [search, setSearch] = useState('');

  const actions = Array.from(new Set(rows.map((row) => row.action).filter(Boolean))) as string[];
  const visible = rows.filter((row) => {
    if (actor && row.actorUid !== actor) return false;
    if (action && row.action !== action) return false;
    const text = `${row.actorUid ?? ''} ${row.action ?? ''} ${row.targetId ?? ''} ${row.reason ?? ''}`.toLowerCase();
    return text.includes(search.trim().toLowerCase());
  });

  return (
    <div className="yv-stack">
      <div>
        <h1>Global audit log</h1>
        <p className="yv-muted">Read-only. Every adminAction, message, impersonation and 2FA event is recorded by trusted server code; nothing here is editable.</p>
      </div>

      {error ? <ErrorBanner message={friendlyError(error)} /> : null}
      {loading ? <LoadingState label="Loading audit log…" /> : null}

      <div className="grid">
        <Field id="audit-actor" label="Actor">
          <select id="audit-actor" value={actor} onChange={(e) => setActor(e.target.value)}>
            <option value="">All actors</option>
            {Array.from(new Set(rows.map((row) => row.actorUid).filter(Boolean))).map((uid) => <option key={uid} value={uid}>{uid}</option>)}
          </select>
        </Field>
        <Field id="audit-action" label="Action">
          <select id="audit-action" value={action} onChange={(e) => setAction(e.target.value)}>
            <option value="">All actions</option>
            {actions.map((name) => <option key={name} value={name}>{name}</option>)}
          </select>
        </Field>
        <Field id="audit-search" label="Search" hint="Actor, action, target or reason">
          <input id="audit-search" value={search} onChange={(e) => setSearch(e.target.value)} />
        </Field>
      </div>

      {!loading && !visible.length ? (
        <EmptyState title="No audit entries" message={rows.length ? 'No entries match these filters.' : 'Admin actions will appear here as they happen.'} />
      ) : null}

      {!loading && visible.length ? (
        <div className="table-wrap">
          <table>
            <thead><tr><th scope="col">When</th><th scope="col">Actor</th><th scope="col">Action</th><th scope="col">Target</th><th scope="col">Reason / detail</th></tr></thead>
            <tbody>
              {visible.map((row) => (
                <tr key={row.id}>
                  <td className="yv-tiny">{displayDate(row.at ?? row.createdAt)}</td>
                  <td className="yv-tiny">{row.actorUid ?? '—'}</td>
                  <td><Badge tone={row.result === 'denied' ? 'danger' : 'neutral'}>{row.action ?? 'unknown'}</Badge></td>
                  <td className="yv-tiny">{row.targetId ?? '—'}</td>
                  <td className="yv-tiny">{row.reason ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      <Card>
        <p className="yv-tiny yv-muted">Only super admins can read the global audit collection. Programme-level audit entries remain visible to that programme's owner.</p>
      </Card>
    </div>
  );
}

export default function AdminAuditPage() {
  return (
    <AdminOnly allow={['superAdmin']}>
      <AuditLog />
    </AdminOnly>
  );
}
