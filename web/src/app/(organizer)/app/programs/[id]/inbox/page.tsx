'use client';

import { updateDoc, doc } from 'firebase/firestore';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import { formatGHS, formatGhanaDate } from '@yivents/shared';
import { Badge, Button, Card, ErrorBanner, Field, LoadingState, Modal, SuccessBanner } from '@yivents/ui';
import { db } from '@/lib/firebase/client';
import {
  approveRegistrations,
  cancelRegistration,
  markUnpaid,
  reassignTransaction,
  rejectRegistrations,
} from '@/components/organizer/callables';
import { useRegistrationsFor, useTicketTypes } from '@/components/organizer/data';
import type { RecipientResult } from '@/components/organizer/types';
import { copyText, friendlyError, statusTone } from '@/components/organizer/utils';

export default function InboxPage() {
  const params = useParams<{ id: string }>();
  const programId = String(params?.id ?? '');
  const { registrations, loading, error } = useRegistrationsFor([programId]);
  const { ticketTypes } = useTicketTypes(programId);
  const [status, setStatus] = useState('pending');
  const [typeFilter, setTypeFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [flaggedOnly, setFlaggedOnly] = useState(false);
  const [sort, setSort] = useState<'newest' | 'oldest'>('newest');
  const [selected, setSelected] = useState<string[]>([]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [reassignId, setReassignId] = useState('');
  const [reassignTargetId, setReassignTargetId] = useState('');
  const [transactionId, setTransactionId] = useState('');
  const [cancelId, setCancelId] = useState('');
  const [recipients, setRecipients] = useState<RecipientResult | null>(null);
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const [actionError, setActionError] = useState('');

  const rows = useMemo(() => {
    const query = search.trim().toLowerCase();
    return registrations
      .filter((row) => {
        if (status !== 'all' && row.status !== status) return false;
        if (typeFilter !== 'all' && row.ticketTypeId !== typeFilter) return false;
        if (flaggedOnly && !row.flagged) return false;
        if (!query) return true;
        return [row.contact.name, row.contact.email, row.contact.phone, row.payment?.transactionId]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
          .includes(query);
      })
      .sort((a, b) => {
        const diff = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
        return sort === 'newest' ? -diff : diff;
      });
  }, [registrations, status, typeFilter, search, flaggedOnly, sort]);

  const run = async (label: string, action: () => Promise<unknown>, success: string) => {
    setBusy(label);
    setActionError('');
    setNotice('');
    try {
      await action();
      setNotice(success);
    } catch (err) {
      setActionError(friendlyError(err));
    } finally {
      setBusy('');
    }
  };

  const selectedRows = registrations.filter((row) => selected.includes(row.id));
  const emailsFromResult = (result: RecipientResult): string[] => {
    if (result.emails?.length) return result.emails;
    const nested = result.recipients?.map((item) => item.contact?.email ?? item.email).filter((email): email is string => Boolean(email)) ?? [];
    return Array.from(new Set(nested));
  };

  const saveNote = async (id: string, value: string) => {
    await run(`note-${id}`, async () => {
      await updateDoc(doc(db, 'programs', programId, 'registrations', id), { notes: value });
    }, 'Note saved.');
  };

  if (loading) return <LoadingState label="Loading approval inbox…" />;
  if (error) return <ErrorBanner message={error} />;

  return (
    <div className="org-stack">
      <div>
        <h1 style={{ margin: 0 }}>Approval inbox</h1>
        <p className="yv-muted" style={{ margin: '.35rem 0 0' }}>Review, approve, reject and reconcile registrations. Invited helpers can use this area only.</p>
      </div>
      {notice ? <SuccessBanner message={notice} /> : null}
      {actionError ? <ErrorBanner message={actionError} onDismiss={() => setActionError('')} /> : null}

      <Card>
        <div className="org-preview-grid">
          <Field label="Status" id="inbox-status">
            <select className="org-input" id="inbox-status" value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="pending">Pending</option><option value="all">All</option><option value="verified">Verified</option>
              <option value="rejected">Rejected</option><option value="cancelled">Cancelled</option><option value="waitlisted">Waitlisted</option>
            </select>
          </Field>
          <Field label="Ticket type" id="inbox-type">
            <select className="org-input" id="inbox-type" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}>
              <option value="all">All ticket types</option>
              {ticketTypes.map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}
            </select>
          </Field>
          <Field label="Search" id="inbox-search">
            <input className="org-input" id="inbox-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Name, email, phone or transaction ID" />
          </Field>
          <Field label="Sort" id="inbox-sort">
            <select className="org-input" id="inbox-sort" value={sort} onChange={(event) => setSort(event.target.value as 'newest' | 'oldest')}>
              <option value="newest">Newest first</option><option value="oldest">Oldest first</option>
            </select>
          </Field>
        </div>
        <label className="org-check"><input type="checkbox" checked={flaggedOnly} onChange={(event) => setFlaggedOnly(event.target.checked)} /> Flagged only</label>
        <div className="org-row" style={{ marginTop: '1rem' }}>
          <Button
            size="sm"
            loading={busy === 'approve'}
            disabled={!selected.length}
            onClick={() => void run('approve', () => approveRegistrations(programId, selected), `${selected.length} registration(s) approved.`)}
          >
            Approve selected
          </Button>
          <Button
            variant="danger"
            size="sm"
            loading={busy === 'reject'}
            disabled={!selected.length}
            onClick={() => void run('reject', () => rejectRegistrations(programId, selected), `${selected.length} registration(s) rejected.`)}
          >
            Reject selected
          </Button>
          <Button
            variant="outline"
            size="sm"
            loading={busy === 'unpaid'}
            disabled={!selected.length}
            onClick={() => void run('unpaid', async () => {
              const result = await markUnpaid(programId, selected);
              setRecipients(result);
            }, 'Marked unpaid. Recipient details are ready below.')}
          >
            Mark unpaid
          </Button>
          <Link className="yv-btn yv-btn-sm yv-btn-outline" href={`/app/programs/${programId}/email`}>Email recipients</Link>
        </div>
      </Card>

      {recipients ? (
        <Card>
          <h2 style={{ marginTop: 0 }}>Unpaid recipients</h2>
          <p className="org-muted">{emailsFromResult(recipients).length} email address(es) returned. No email was sent by Yivents.</p>
          <div className="org-row">
            {recipients.mailto ? <a className="yv-btn yv-btn-sm yv-btn-outline" href={recipients.mailto}>Open email draft</a> : null}
            <Button variant="outline" size="sm" onClick={() => void copyText(emailsFromResult(recipients).join(',')).then((ok) => setNotice(ok ? 'Emails copied.' : 'Could not copy emails.'))}>Copy emails</Button>
          </div>
        </Card>
      ) : null}

      {!rows.length ? <Card><p className="yv-muted">No registrations match these filters.</p></Card> : null}
      {rows.map((row) => (
        <Card key={row.id}>
          <div className="org-row" style={{ justifyContent: 'space-between' }}>
            <div className="org-row">
              <input type="checkbox" checked={selected.includes(row.id)} onChange={() => setSelected((current) => current.includes(row.id) ? current.filter((id) => id !== row.id) : [...current, row.id])} aria-label={`Select ${row.contact.name}`} />
              <div>
                <strong>{row.contact.name}</strong>
                <div className="org-muted">{row.contact.email || 'No email'} · {row.contact.phone || 'No phone'}</div>
              </div>
            </div>
            <div className="org-row">
              <Badge tone={statusTone(row.status)}>{row.status}</Badge>
              {row.flagged ? <Badge tone="warning">Flagged</Badge> : null}
            </div>
          </div>
          <p className="org-muted" style={{ margin: '.6rem 0' }}>
            {row.ticketTypeName} · {formatGHS(row.ticketPricePesewas)} · {formatGhanaDate(row.createdAt)}
            {row.payment ? ` · ${row.payment.transactionId} (${formatGHS(row.payment.amountPaidPesewas)})` : ' · No payment record'}
          </p>
          {row.flagReasons.length ? <p className="org-muted">Flags: {row.flagReasons.join(', ')}</p> : null}
          <Field label={`Note for ${row.contact.name}`} id={`note-${row.id}`}>
            <input
              className="org-input"
              id={`note-${row.id}`}
              defaultValue={row.notes ?? ''}
              onChange={(event) => setNotes((current) => ({ ...current, [row.id]: event.target.value }))}
            />
          </Field>
          <div className="org-row">
            <Button
              size="sm"
              loading={busy === `approve-${row.id}`}
              onClick={() => void run(`approve-${row.id}`, () => approveRegistrations(programId, [row.id]), 'Registration approved.')}
            >
              One-click approve
            </Button>
            <Button variant="outline" size="sm" loading={busy === `note-${row.id}`} onClick={() => void saveNote(row.id, notes[row.id] ?? row.notes ?? '')}>Save note</Button>
            <Button variant="outline" size="sm" onClick={() => { setReassignId(row.id); setTransactionId(row.payment?.transactionId ?? ''); setReassignTargetId(''); }}>Reassign transaction</Button>
            {row.payment ? (
              <Button variant="danger" size="sm" onClick={() => void run('unpaid-row', async () => {
                const result = await markUnpaid(programId, [row.id]);
                setRecipients(result);
              }, 'Marked unpaid.')}>Mark unpaid</Button>
            ) : null}
            <Button variant="danger" size="sm" onClick={() => setCancelId(row.id)}>Cancel</Button>
          </div>
        </Card>
      ))}

      <Modal open={Boolean(reassignId)} title="Reassign transaction" onClose={() => setReassignId('')}>
        <Field label="Transaction ID or bank reference" id="reassign-transaction" hint="This is the payment that will be moved.">
          <input className="org-input" id="reassign-transaction" value={transactionId} readOnly />
        </Field>
        <Field label="Move payment to registration" id="reassign-target" hint="Choose the registration that should receive this payment.">
          <select className="org-input" id="reassign-target" value={reassignTargetId} onChange={(event) => setReassignTargetId(event.target.value)}>
            <option value="">Select a registration…</option>
            {registrations.filter((row) => row.id !== reassignId).map((row) => (
              <option key={row.id} value={row.id}>{row.contact.name} — {formatGHS(row.ticketPricePesewas)}</option>
            ))}
          </select>
        </Field>
        <div className="org-row">
          <Button variant="outline" onClick={() => setReassignId('')}>Cancel</Button>
          <Button
            loading={busy === 'reassign'}
            disabled={!reassignTargetId}
            onClick={() => void run('reassign', async () => {
              await reassignTransaction(programId, reassignId, reassignTargetId);
              setReassignId('');
            }, 'Transaction reassigned.')}
          >
            Reassign
          </Button>
        </div>
      </Modal>

      <Modal open={Boolean(cancelId)} title="Cancel registration?" onClose={() => setCancelId('')}>
        <p>The ticket will show red at the door and capacity is released. This cannot be undone here.</p>
        <div className="org-row">
          <Button variant="outline" onClick={() => setCancelId('')}>Keep registration</Button>
          <Button
            variant="danger"
            loading={busy === 'cancel'}
            onClick={() => void run('cancel', async () => {
              await cancelRegistration(programId, cancelId);
              setCancelId('');
            }, 'Registration cancelled.')}
          >
            Cancel registration
          </Button>
        </div>
      </Modal>
    </div>
  );
}
