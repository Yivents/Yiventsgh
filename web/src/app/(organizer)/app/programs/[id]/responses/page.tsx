'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { computeOverShort, formatEventRange, formatGHS, type Registration } from '@yivents/shared';
import { Badge, Button, Card, ErrorBanner, Field, LoadingState, Modal, Tabs } from '@yivents/ui';
import { storageUrl } from '@/lib/firebase/client';
import { exportRegistrations } from '@/components/organizer/callables';
import { useProgram, useRegistrationsFor, useTicketTypes } from '@/components/organizer/data';
import { TicketPreview } from '@/components/organizer/TicketPreview';
import { statusTone } from '@/components/organizer/utils';

export default function ResponsesPage() {
  const params = useParams<{ id: string }>();
  const programId = String(params?.id ?? '');
  const { program } = useProgram(programId);
  const { ticketTypes } = useTicketTypes(programId);
  const { registrations, loading, error } = useRegistrationsFor([programId]);
  const [tab, setTab] = useState('all');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [flagged, setFlagged] = useState('all');
  const [typeFilter, setTypeFilter] = useState('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [activeTicket, setActiveTicket] = useState<Registration | null>(null);
  const [logoUrl, setLogoUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [actionError, setActionError] = useState('');

  const paidTypes = useMemo(
    () => ticketTypes.filter((type) => type.pricePesewas > 0 || registrations.some((row) => row.ticketTypeId === type.id && row.ticketPricePesewas > 0)),
    [ticketTypes, registrations],
  );

  useEffect(() => {
    let alive = true;
    storageUrl(program?.branding.logoPath).then((url) => alive && setLogoUrl(url ?? '')).catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [program?.branding.logoPath]);

  const counts = useMemo(() => {
    const result: Record<string, number> = { all: registrations.length, free: 0 };
    registrations.forEach((row) => {
      if (row.ticketPricePesewas === 0) result.free += 1;
      result[`paid-${row.ticketTypeId}`] = (result[`paid-${row.ticketTypeId}`] ?? 0) + 1;
    });
    return result;
  }, [registrations]);

  const rows = registrations.filter((row) => {
    if (tab === 'free' && row.ticketPricePesewas !== 0) return false;
    if (tab.startsWith('paid-') && `paid-${row.ticketTypeId}` !== tab) return false;
    if (typeFilter !== 'all' && row.ticketTypeId !== typeFilter) return false;
    if (status !== 'all' && row.status !== status) return false;
    if (flagged === 'yes' && !row.flagged) return false;
    if (flagged === 'no' && row.flagged) return false;
    const day = row.createdAt.slice(0, 10);
    if (from && day < from) return false;
    if (to && day > to) return false;
    const query = search.trim().toLowerCase();
    if (query) {
      const haystack = [row.contact.name, row.contact.email, row.contact.phone, row.ticketCode, row.payment?.transactionId, row.ticketTypeName]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    return true;
  });

  const allVisibleSelected = rows.length > 0 && rows.every((row) => selected.includes(row.id));
  const toggleAll = () => setSelected(allVisibleSelected ? [] : rows.map((row) => row.id));
  const toggleOne = (id: string) =>
    setSelected((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));

  const exportRows = async () => {
    setBusy(true);
    setActionError('');
    setNotice('');
    try {
      const ticketTypeId = tab.startsWith('paid-') ? tab.slice(5) : tab === 'free' ? undefined : typeFilter !== 'all' ? typeFilter : undefined;
      const url = await exportRegistrations(programId, ticketTypeId);
      window.open(url, '_blank', 'noopener,noreferrer');
      setNotice('Export ready. The signed link opens in a new tab and expires shortly.');
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not export registrations.');
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <LoadingState label="Loading responses…" />;
  if (error) return <ErrorBanner message={error} />;

  const allowance = program?.settings.allowancePesewas ?? 0;
  const tolerance = program?.settings.tolerancePesewas ?? 0;

  return (
    <div className="org-stack">
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ margin: 0 }}>Responses</h1>
          <p className="yv-muted" style={{ margin: '.35rem 0 0' }}>Every registration, split automatically by ticket type.</p>
        </div>
        <div className="org-row">
          <Button variant="outline" size="sm" loading={busy} onClick={() => void exportRows()}>Export Excel</Button>
          <Link
            className={`yv-btn yv-btn-sm yv-btn-primary${selected.length ? '' : ' yv-btn-outline'}`}
            href={`/app/programs/${programId}/email${selected.length ? `?ids=${encodeURIComponent(selected.join(','))}` : ''}`}
          >
            Email {selected.length ? `selected (${selected.length})` : 'participants'}
          </Link>
        </div>
      </div>
      {notice ? <Card><p style={{ margin: 0 }}>{notice}</p></Card> : null}
      {actionError ? <ErrorBanner message={actionError} onDismiss={() => setActionError('')} /> : null}

      <Tabs
        tabs={[
          { id: 'all', label: 'All', count: counts.all },
          { id: 'free', label: 'Free', count: counts.free },
          ...paidTypes.map((type) => ({ id: `paid-${type.id}`, label: type.name, count: counts[`paid-${type.id}`] ?? 0 })),
        ]}
        active={tab}
        onChange={setTab}
      />

      <Card>
        <div className="org-preview-grid">
          <Field label="Search" id="responses-search">
            <input className="org-input" id="responses-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Name, email, phone, ticket code or transaction ID" />
          </Field>
          <Field label="Ticket type" id="responses-type">
            <select className="org-input" id="responses-type" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}>
              <option value="all">All ticket types</option>
              {ticketTypes.map((type) => <option key={type.id} value={type.id}>{type.name}</option>)}
            </select>
          </Field>
          <Field label="Status" id="responses-status">
            <select className="org-input" id="responses-status" value={status} onChange={(event) => setStatus(event.target.value)}>
              <option value="all">All statuses</option>
              <option value="pending">Pending</option>
              <option value="verified">Verified</option>
              <option value="rejected">Rejected</option>
              <option value="cancelled">Cancelled</option>
              <option value="waitlisted">Waitlisted</option>
            </select>
          </Field>
          <Field label="Flagged" id="responses-flagged">
            <select className="org-input" id="responses-flagged" value={flagged} onChange={(event) => setFlagged(event.target.value)}>
              <option value="all">Any</option><option value="yes">Flagged</option><option value="no">Not flagged</option>
            </select>
          </Field>
          <Field label="From date" id="responses-from"><input className="org-input" id="responses-from" type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></Field>
          <Field label="To date" id="responses-to"><input className="org-input" id="responses-to" type="date" value={to} onChange={(event) => setTo(event.target.value)} /></Field>
        </div>
      </Card>

      {selected.length ? (
        <Card>
          <div className="org-row" style={{ justifyContent: 'space-between' }}>
            <span>{selected.length} selected</span>
            <div className="org-row">
              <Button variant="ghost" size="sm" onClick={() => setSelected([])}>Clear selection</Button>
              <Link className="yv-btn yv-btn-sm yv-btn-primary" href={`/app/programs/${programId}/email?ids=${encodeURIComponent(selected.join(','))}`}>Email selected</Link>
            </div>
          </div>
        </Card>
      ) : null}

      {!rows.length ? (
        <Card><p className="yv-muted">No registrations match these filters yet.</p></Card>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col"><input type="checkbox" checked={allVisibleSelected} onChange={toggleAll} aria-label="Select all visible registrations" /></th>
                <th scope="col">Participant</th>
                <th scope="col">Ticket type</th>
                <th scope="col">Price</th>
                <th scope="col">Over / short</th>
                <th scope="col">Status</th>
                <th scope="col">Check-in</th>
                <th scope="col">Actions</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const overShort = computeOverShort(row.ticketPricePesewas, row.payment?.amountPaidPesewas ?? 0, allowance, tolerance);
                return (
                  <tr key={row.id}>
                    <td><input type="checkbox" checked={selected.includes(row.id)} onChange={() => toggleOne(row.id)} aria-label={`Select ${row.contact.name}`} /></td>
                    <th scope="row">
                      {row.contact.name}
                      <div className="org-muted">{row.contact.email || row.contact.phone || 'No contact'}</div>
                      {row.flagged ? <Badge tone="warning">Flagged</Badge> : null}
                    </th>
                    <td>{row.ticketTypeName}</td>
                    <td>{formatGHS(row.ticketPricePesewas)}</td>
                    <td>
                      {overShort.overByPesewas ? <Badge tone="info">Over {formatGHS(overShort.overByPesewas)}</Badge> : null}
                      {overShort.shortByPesewas ? <Badge tone="danger">Short {formatGHS(overShort.shortByPesewas)}</Badge> : null}
                      {!overShort.overByPesewas && !overShort.shortByPesewas ? <span className="org-muted">—</span> : null}
                    </td>
                    <td><Badge tone={statusTone(row.status)}>{row.status}</Badge></td>
                    <td>{row.checkedInAt ? 'Checked in' : 'Not checked in'}</td>
                    <td><button type="button" className="yv-link-button" onClick={() => setActiveTicket(row)}>Ticket</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={Boolean(activeTicket)} title="Ticket preview" onClose={() => setActiveTicket(null)}>
        {activeTicket && program ? (
          <TicketPreview
            filename={`${program.slug}-${activeTicket.ticketCode.slice(0, 8)}`}
            data={{
              eventName: program.title,
              attendeeName: activeTicket.contact.name,
              ticketTypeName: activeTicket.ticketTypeName,
              dateLabel: formatEventRange(program.event),
              venueLabel: program.event.venue || 'Online',
              code: activeTicket.ticketCode,
              logoUrl,
              primaryColor: program.branding.primaryColor,
              accentColor: program.branding.accentColor,
              documentKind: program.settings.documentKind,
              showAmount: program.settings.documentKind === 'receipt' && program.settings.showAmountOnReceipt,
              amountLabel: activeTicket.payment ? formatGHS(activeTicket.payment.amountPaidPesewas) : undefined,
              layout: program.settings.ticketLayout ?? 'vertical',
            }}
          />
        ) : null}
      </Modal>
    </div>
  );
}
