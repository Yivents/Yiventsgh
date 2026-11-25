'use client';

import { useState } from 'react';
import { collection, limit, query } from 'firebase/firestore';
import { normalizeGhanaPhone, plainTextSchema } from '@yivents/shared';
import { Badge, Button, Card, EmptyState, ErrorBanner, Field, LoadingState, Tabs } from '@yivents/ui';
import { db } from '@/lib/firebase/client';
import { ADMIN_ACTIONS, adminAction } from '@/components/admin/adminActions';
import { displayDate, friendlyError, useCollection } from '@/components/admin/adminData';
import { AdminOnly } from '@/components/admin/AdminShell';

interface BlockRow {
  id: string;
  value?: string;
  email?: string;
  phone?: string;
  keyword?: string;
  type?: string;
  reason?: string;
  createdAt?: string;
}

type Kind = 'all' | 'email' | 'phone' | 'keyword';

const rowValue = (row: BlockRow) => String(row.value ?? row.email ?? row.phone ?? row.keyword ?? '');
const rowKind = (row: BlockRow): Kind => {
  if (row.type === 'email' || row.type === 'phone' || row.type === 'keyword') return row.type;
  if (row.email) return 'email';
  if (row.phone) return 'phone';
  return 'keyword';
};

function Blocklist() {
  const { rows, loading, error } = useCollection<BlockRow>(() => query(collection(db, 'blocklist'), limit(300)), []);
  const [filter, setFilter] = useState<Kind>('all');
  const [kind, setKind] = useState<Exclude<Kind, 'all'>>('email');
  const [value, setValue] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [failure, setFailure] = useState('');

  const visible = filter === 'all' ? rows : rows.filter((row) => rowKind(row) === filter);
  const counts: Record<Kind, number> = {
    all: rows.length,
    email: rows.filter((r) => rowKind(r) === 'email').length,
    phone: rows.filter((r) => rowKind(r) === 'phone').length,
    keyword: rows.filter((r) => rowKind(r) === 'keyword').length,
  };

  const valueError = !value.trim()
    ? 'Enter a value.'
    : kind === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
      ? 'Enter a valid email address.'
      : kind === 'phone' && !normalizeGhanaPhone(value)
        ? 'Enter a valid Ghana phone number.'
        : '';

  async function add() {
    setBusy(true);
    setFailure('');
    setNotice('');
    try {
      await adminAction({
        action: ADMIN_ACTIONS.addBlocklistEntry,
        payload: { type: kind, value: value.trim(), reason: reason.trim() },
      });
      setNotice('Entry added. The server normalises it before storage.');
      setValue('');
      setReason('');
    } catch (err) {
      setFailure(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove(row: BlockRow) {
    setBusy(true);
    setFailure('');
    try {
      await adminAction({ action: ADMIN_ACTIONS.removeBlocklistEntry, targetId: row.id });
      setNotice('Entry removed.');
    } catch (err) {
      setFailure(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="yv-stack">
      <div>
        <h1>Blocklist</h1>
        <p className="yv-muted">Block emails, phone numbers and keywords. Only the server writes this collection; every change is audited.</p>
      </div>

      {error ? <ErrorBanner message={error} /> : null}
      {notice ? <Card><p>{notice}</p></Card> : null}
      {failure ? <ErrorBanner message={failure} onDismiss={() => setFailure('')} /> : null}

      <Card className="yv-stack">
        <h2 style={{ fontSize: '1.1rem' }}>Add an entry</h2>
        <div className="yv-row" style={{ alignItems: 'flex-end' }}>
          <div style={{ flex: '1 1 200px' }}>
            <Field id="block-kind" label="Type">
              <select id="block-kind" value={kind} onChange={(e) => { setKind(e.target.value as Exclude<Kind, 'all'>); setValue(''); }}>
                <option value="email">Email</option>
                <option value="phone">Phone</option>
                <option value="keyword">Keyword</option>
              </select>
            </Field>
          </div>
          <div style={{ flex: '2 1 260px' }}>
            <Field id="block-value" label="Value" required error={valueError}>
              <input id="block-value" value={value} onChange={(e) => setValue(e.target.value)} placeholder={kind === 'phone' ? '024XXXXXXX' : kind === 'email' ? 'name@example.com' : 'word or phrase'} />
            </Field>
          </div>
        </div>
        <Field id="block-reason" label="Reason" hint="Plain text, optional" error={reason && !plainTextSchema.safeParse(reason).success ? 'Use plain text only.' : ''}>
          <input id="block-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <div>
          <Button loading={busy} disabled={Boolean(valueError) || !plainTextSchema.safeParse(reason).success} onClick={add}>Add to blocklist</Button>
        </div>
      </Card>

      <Tabs<Kind>
        tabs={[
          { id: 'all', label: 'All', count: counts.all },
          { id: 'email', label: 'Emails', count: counts.email },
          { id: 'phone', label: 'Phones', count: counts.phone },
          { id: 'keyword', label: 'Keywords', count: counts.keyword },
        ]}
        active={filter}
        onChange={setFilter}
      />

      {loading ? <LoadingState label="Loading blocklist…" /> : null}
      {!loading && !visible.length ? <EmptyState title="No entries" message="Nothing is blocked in this category." /> : null}

      {!loading && visible.length ? (
        <div className="table-wrap">
          <table>
            <thead><tr><th scope="col">Value</th><th scope="col">Type</th><th scope="col">Reason</th><th scope="col">Added</th><th scope="col">Action</th></tr></thead>
            <tbody>
              {visible.map((row) => (
                <tr key={row.id}>
                  <td><strong>{rowValue(row) || row.id}</strong></td>
                  <td><Badge tone="neutral">{rowKind(row)}</Badge></td>
                  <td className="yv-tiny">{row.reason || '—'}</td>
                  <td className="yv-tiny">{displayDate(row.createdAt, false)}</td>
                  <td><Button size="sm" variant="danger" disabled={busy} onClick={() => remove(row)}>Remove</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}

export default function AdminBlocklistPage() {
  return (
    <AdminOnly allow={['superAdmin']}>
      <Blocklist />
    </AdminOnly>
  );
}
