'use client';

import { collection, deleteDoc, deleteField, doc, setDoc, updateDoc } from 'firebase/firestore';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { CURRENCY, formatGHS, type LinkReleaseRule, type TicketType } from '@yivents/shared';
import { Badge, Button, Card, ErrorBanner, Field, LoadingState, SuccessBanner, WarningBanner } from '@yivents/ui';
import { db } from '@/lib/firebase/client';
import { useProgram, useRegistrationsFor, useTicketTypes } from '@/components/organizer/data';
import { patchProgram } from '@/components/organizer/program';
import { friendlyError, ghsToPesewas, pesewasToInput } from '@/components/organizer/utils';

const RELEASE_RULES: Array<{ value: LinkReleaseRule; label: string; disabled?: boolean }> = [
  { value: 'on_registration', label: 'Immediately on registration' },
  { value: 'after_approval', label: 'After approval' },
  { value: 'scheduled', label: 'Scheduled (coming later)', disabled: true },
  { value: 'manual', label: 'Manual release (coming later)', disabled: true },
];

interface DraftTicket extends TicketType {
  free: boolean;
  priceInput: string;
  capacityInput: string;
}

function toDraft(type: TicketType): DraftTicket {
  return {
    ...type,
    free: type.pricePesewas === 0,
    priceInput: pesewasToInput(type.pricePesewas),
    capacityInput: type.capacity ? String(type.capacity) : '',
  };
}

export default function TicketsPage() {
  const params = useParams<{ id: string }>();
  const programId = String(params?.id ?? '');
  const { program } = useProgram(programId);
  const { ticketTypes, loading } = useTicketTypes(programId);
  const { registrations } = useRegistrationsFor([programId]);
  const [draft, setDraft] = useState<DraftTicket[]>([]);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const loadedKey = JSON.stringify(ticketTypes);

  useEffect(() => {
    if (loading) return;
    setDraft([...ticketTypes].sort((a, b) => a.order - b.order).map(toDraft));
    setReady(true);
  }, [loadedKey, loading]);

  const patch = (id: string, change: Partial<DraftTicket>) =>
    setDraft((current) => current.map((type) => (type.id === id ? { ...type, ...change } : type)));

  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= draft.length) return;
    const next = [...draft];
    [next[index], next[target]] = [next[target], next[index]];
    setDraft(next.map((type, i) => ({ ...type, order: i })));
  };

  const counts = new Map<string, number>();
  registrations.forEach((row) => counts.set(row.ticketTypeId, (counts.get(row.ticketTypeId) ?? 0) + 1));

  const addTicket = () => {
    const ref = doc(collection(db, 'programs', programId, 'ticketTypes'));
    setDraft((current) => [
      ...current,
      {
        id: ref.id,
        name: '',
        pricePesewas: 0,
        currency: CURRENCY,
        mode: 'physical',
        instantTicket: true,
        linkReleaseRule: 'on_registration',
        active: true,
        order: current.length,
        free: true,
        priceInput: '0.00',
        capacityInput: '',
      },
    ]);
  };

  const remove = async (type: DraftTicket) => {
    setError('');
    if ((counts.get(type.id) ?? 0) > 0) {
      setError('This ticket type has registrations. Set it inactive instead of deleting it.');
      return;
    }
    if (!ticketTypes.some((existing) => existing.id === type.id)) {
      setDraft((current) => current.filter((item) => item.id !== type.id));
      return;
    }
    setBusy(true);
    try {
      await deleteDoc(doc(db, 'programs', programId, 'ticketTypes', type.id));
      setNotice('Ticket type removed.');
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    setError('');
    setNotice('');
    if (draft.some((type) => !type.name.trim())) {
      setError('Every ticket type needs a name.');
      return;
    }
    setBusy(true);
    try {
      const existing = new Map(ticketTypes.map((type) => [type.id, type]));
      const perTicketType: Record<string, number> = {};
      for (const type of draft) {
        const pricePesewas = type.free ? 0 : ghsToPesewas(type.priceInput);
        const capacity = Number(type.capacityInput);
        const hasCapacity = Number.isFinite(capacity) && capacity > 0;
        // deleteField() clears a capacity the organiser has just removed.
        const saved: Record<string, unknown> = {
          id: type.id,
          name: type.name.trim(),
          pricePesewas,
          currency: CURRENCY,
          capacity: hasCapacity ? Math.round(capacity) : deleteField(),
          mode: type.mode,
          instantTicket: type.instantTicket,
          linkReleaseRule: type.linkReleaseRule,
          active: type.active,
          order: type.order,
        };
        if (Number.isFinite(capacity) && capacity > 0) perTicketType[type.id] = Math.round(capacity);
        const target = doc(db, 'programs', programId, 'ticketTypes', type.id);
        if (existing.has(type.id)) await updateDoc(target, saved);
        else await setDoc(target, saved);
      }
      await patchProgram(programId, { 'capacity.perTicketType': perTicketType });
      setNotice('Ticket types saved. Registration counts are split by ticket type everywhere.');
    } catch (err) {
      setError(friendlyError(err, 'Could not save ticket types.'));
    } finally {
      setBusy(false);
    }
  };

  if (loading || !ready) return <LoadingState label="Loading ticket types…" />;

  return (
    <div className="org-stack">
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ margin: 0 }}>Ticket types</h1>
          <p className="yv-muted" style={{ margin: '.35rem 0 0' }}>Free and paid tickets, capacities and meeting-link rules.</p>
        </div>
        <Badge tone="info">{registrations.length} registrations across {draft.length} types</Badge>
      </div>
      {error ? <ErrorBanner message={error} onDismiss={() => setError('')} /> : null}
      {notice ? <SuccessBanner message={notice} /> : null}
      {program?.status === 'archived' ? <WarningBanner>This program is archived and read-only.</WarningBanner> : null}

      {draft.length === 0 ? (
        <Card><p className="yv-muted">No ticket types yet. Add one to open registration.</p></Card>
      ) : null}

      {draft.map((type, index) => (
        <Card key={type.id}>
          <div className="org-row" style={{ justifyContent: 'space-between' }}>
            <strong>Ticket type {index + 1}</strong>
            <div className="org-row">
              <Button variant="ghost" size="sm" disabled={index === 0} onClick={() => move(index, -1)} aria-label="Move up">↑</Button>
              <Button variant="ghost" size="sm" disabled={index === draft.length - 1} onClick={() => move(index, 1)} aria-label="Move down">↓</Button>
              <Button variant="danger" size="sm" loading={busy} disabled={program?.status === 'archived'} onClick={() => void remove(type)}>Delete</Button>
            </div>
          </div>
          <div className="org-preview-grid" style={{ marginTop: '1rem' }}>
            <Field label="Name" id={`ticket-name-${type.id}`} required>
              <input className="org-input" id={`ticket-name-${type.id}`} value={type.name} disabled={program?.status === 'archived'} onChange={(event) => patch(type.id, { name: event.target.value })} />
            </Field>
            <Field label="Mode" id={`ticket-mode-${type.id}`}>
              <select className="org-input" id={`ticket-mode-${type.id}`} value={type.mode} disabled={program?.status === 'archived'} onChange={(event) => patch(type.id, { mode: event.target.value as TicketType['mode'] })}>
                <option value="physical">In person</option><option value="online">Online</option>
              </select>
            </Field>
            <Field label="Capacity" id={`ticket-capacity-${type.id}`} hint="Blank means unlimited.">
              <input className="org-input" id={`ticket-capacity-${type.id}`} type="number" min="0" value={type.capacityInput} disabled={program?.status === 'archived'} onChange={(event) => patch(type.id, { capacityInput: event.target.value })} />
            </Field>
            <Field label="Price" id={`ticket-price-${type.id}`} hint={type.free ? 'This ticket is free.' : `Paid in ${CURRENCY}`}>
              <div className="org-row">
                <label className="org-check"><input type="checkbox" checked={type.free} disabled={program?.status === 'archived'} onChange={(event) => patch(type.id, { free: event.target.checked, priceInput: event.target.checked ? '0.00' : type.priceInput })} /> Free</label>
                <input className="org-input" id={`ticket-price-${type.id}`} type="number" min="0" step="0.01" value={type.priceInput} disabled={type.free || program?.status === 'archived'} onChange={(event) => patch(type.id, { priceInput: event.target.value })} />
              </div>
            </Field>
            <Field label="Meeting-link release" id={`ticket-release-${type.id}`} hint="Only immediate or after approval are available in Phase 1.">
              <select className="org-input" id={`ticket-release-${type.id}`} value={type.linkReleaseRule} disabled={program?.status === 'archived'} onChange={(event) => patch(type.id, { linkReleaseRule: event.target.value as LinkReleaseRule })}>
                {RELEASE_RULES.map((rule) => <option key={rule.value} value={rule.value} disabled={rule.disabled}>{rule.label}</option>)}
              </select>
            </Field>
          </div>
          <div className="org-row" style={{ marginTop: '.5rem' }}>
            <label className="org-check"><input type="checkbox" checked={type.active} disabled={program?.status === 'archived'} onChange={(event) => patch(type.id, { active: event.target.checked })} /> Active (available to students)</label>
            <label className="org-check"><input type="checkbox" checked={type.instantTicket} disabled={program?.status === 'archived'} onChange={(event) => patch(type.id, { instantTicket: event.target.checked })} /> Instant ticket</label>
            <span className="org-muted">{formatGHS(type.free ? 0 : ghsToPesewas(type.priceInput))} · {counts.get(type.id) ?? 0} registrations</span>
          </div>
        </Card>
      ))}

      <div className="org-row">
        <Button variant="outline" onClick={addTicket} disabled={program?.status === 'archived'}>Add ticket type</Button>
        <Button onClick={() => void save()} loading={busy} disabled={program?.status === 'archived'}>Save ticket types</Button>
      </div>
    </div>
  );
}
