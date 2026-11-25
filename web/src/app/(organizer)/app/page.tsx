'use client';

/** Organiser dashboard: private registrations, price-based revenue and trends. */
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { BarChart, Button, Card, EmptyState, ErrorBanner, Field, LineChart, LoadingState } from '@yivents/ui';
import { formatGHS, GHANA_TIMEZONE } from '@yivents/shared';
import { useSession } from '@/lib/auth';
import { useMyPrograms, useRegistrationsFor, useTicketTypes } from '@/components/organizer/data';
import { ghsToPesewas, pesewasToInput } from '@/components/organizer/utils';
import { recordExpectedReceived } from '@/components/organizer/callables';
import { patchProgram } from '@/components/organizer/program';

export default function DashboardPage() {
  const { user } = useSession();
  const { programs, loading: programsLoading, error: programsError } = useMyPrograms(user?.uid);
  const [selected, setSelected] = useState('all');
  const [expectedInput, setExpectedInput] = useState('0.00');
  const [savingExpected, setSavingExpected] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (selected !== 'all') {
      const program = programs.find((item) => item.id === selected);
      setExpectedInput(pesewasToInput(program?.expectedReceivedPesewas));
    }
  }, [selected, programs]);

  const scopeIds = selected === 'all' ? programs.map((program) => program.id) : [selected];
  const { registrations, loading: registrationsLoading, error: registrationsError } = useRegistrationsFor(scopeIds);
  const { ticketTypes } = useTicketTypes(selected === 'all' ? undefined : selected);
  const scopePrograms = selected === 'all' ? programs : programs.filter((program) => program.id === selected);
  const verified = registrations.filter((row) => row.status === 'verified');
  const pending = registrations.filter((row) => row.status === 'pending');
  const checkedIn = registrations.filter((row) => row.checkedInAt).length;
  // Revenue uses the ticket price, never the amount the sender claimed to pay.
  const revenue = verified.reduce((sum, row) => sum + (row.ticketPricePesewas ?? 0), 0);
  const capacity = scopePrograms.reduce((sum, program) => sum + (program.capacity.overall ?? 0), 0);
  const capacityUsed = verified.length + pending.length;

  const byType = new Map<string, { count: number; revenue: number; capacity: number }>();
  registrations.forEach((row) => {
    const name = row.ticketTypeName || 'Unspecified';
    const entry = byType.get(name) ?? { count: 0, revenue: 0, capacity: 0 };
    entry.count += 1;
    if (row.status === 'verified') entry.revenue += row.ticketPricePesewas ?? 0;
    byType.set(name, entry);
  });
  ticketTypes.forEach((type) => {
    const entry = byType.get(type.name) ?? { count: 0, revenue: 0, capacity: 0 };
    entry.capacity = type.capacity ?? scopePrograms[0]?.capacity.perTicketType[type.id] ?? 0;
    byType.set(type.name, entry);
  });

  const trendDays = Array.from({ length: 7 }, (_, index) => {
    const date = new Date();
    date.setUTCDate(date.getUTCDate() - 6 + index);
    return {
      key: date.toISOString().slice(0, 10),
      label: new Intl.DateTimeFormat('en-GB', { timeZone: GHANA_TIMEZONE, day: '2-digit', month: 'short' }).format(date),
    };
  });
  const trend = trendDays.map((day) => registrations.filter((row) => row.createdAt.slice(0, 10) === day.key).length);

  const saveExpected = async () => {
    if (selected === 'all') {
      setError('Choose one program to record an expected total.');
      return;
    }
    setSavingExpected(true);
    setError('');
    setNotice('');
    try {
      const pesewas = ghsToPesewas(expectedInput);
      await recordExpectedReceived(selected, pesewas);
      await patchProgram(selected, { expectedReceivedPesewas: pesewas });
      setNotice(`Expected total saved: ${formatGHS(pesewas)}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save the expected total.');
    } finally {
      setSavingExpected(false);
    }
  };

  if (programsLoading || registrationsLoading) return <LoadingState label="Loading your dashboard…" />;
  if (programsError || registrationsError) return <ErrorBanner message={programsError || registrationsError} />;

  if (!programs.length) {
    return (
      <EmptyState
        title="Your dashboard is empty"
        message="Create your first event to start collecting registrations and tracking tickets."
        action={<Link className="yv-btn yv-btn-primary" href="/app/programs/new">Create a program</Link>}
      />
    );
  }

  const stat = (label: string, value: string, hint?: string) => (
    <Card key={label}>
      <p className="org-muted" style={{ margin: 0 }}>{label}</p>
      <h2 style={{ margin: '.25rem 0', fontSize: '1.8rem' }}>{value}</h2>
      {hint ? <p className="org-muted" style={{ margin: 0 }}>{hint}</p> : null}
    </Card>
  );

  return (
    <div className="org-stack">
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ margin: 0 }}>Dashboard</h1>
          <p className="yv-muted" style={{ margin: '.35rem 0 0' }}>A private view of your registrations and ticket performance.</p>
        </div>
        <div className="org-row">
          <label htmlFor="dashboard-program" className="org-muted">View</label>
          <select
            id="dashboard-program"
            className="org-input"
            style={{ width: 'auto', minWidth: 200 }}
            value={selected}
            onChange={(event) => setSelected(event.target.value)}
          >
            <option value="all">All programs</option>
            {programs.map((program) => <option key={program.id} value={program.id}>{program.title || 'Untitled event'}</option>)}
          </select>
        </div>
      </div>

      {notice ? <Card><p style={{ margin: 0 }}>{notice}</p></Card> : null}
      {error ? <ErrorBanner message={error} onDismiss={() => setError('')} /> : null}

      <div className="grid">
        {stat('Registrations', String(registrations.length), `${pending.length} pending approval`)}
        {stat('Revenue (by ticket price)', formatGHS(revenue), 'Excludes amount paid and over/short payments')}
        {stat('Capacity used', capacity ? `${capacityUsed} / ${capacity}` : String(capacityUsed), capacity ? `${Math.round((capacityUsed / capacity) * 100)}% of listed capacity` : 'No overall capacity set')}
        {stat('Checked in', String(checkedIn), 'Scanned at the door')}
      </div>

      <div className="org-preview-grid">
        <Card>
          <h2 style={{ marginTop: 0 }}>Registration trend</h2>
          <LineChart points={trend} labels={trendDays.map((day) => day.label)} />
          <p className="org-muted">New registrations over the last 7 days.</p>
        </Card>
        <Card>
          <h2 style={{ marginTop: 0 }}>Registrations by ticket type</h2>
          {byType.size ? (
            <BarChart values={Array.from(byType.values()).map((entry) => entry.count)} labels={Array.from(byType.keys())} />
          ) : (
            <p className="yv-muted">No registrations yet.</p>
          )}
        </Card>
      </div>

      <Card>
        <h2 style={{ marginTop: 0 }}>Per ticket type</h2>
        {byType.size ? (
          <div className="table-wrap">
            <table>
              <thead><tr><th scope="col">Ticket type</th><th scope="col">Registrations</th><th scope="col">Revenue by price</th><th scope="col">Capacity used</th></tr></thead>
              <tbody>
                {Array.from(byType.entries()).map(([name, entry]) => (
                  <tr key={name}>
                    <th scope="row">{name}</th>
                    <td>{entry.count}</td>
                    <td>{formatGHS(entry.revenue)}</td>
                    <td>{entry.capacity ? `${entry.count} / ${entry.capacity}` : `${entry.count} / —`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="yv-muted">Ticket types and their registrations will appear here.</p>}
      </Card>

      <div className="org-preview-grid">
        <Card>
          <h2 style={{ marginTop: 0 }}>Expected vs received</h2>
          <p className="org-muted">Record the total you expect to receive across payment methods. This is never shown to participants.</p>
          <Field label="Expected total (GHS)" id="expected-total" error={selected === 'all' ? 'Select a single program first.' : undefined}>
            <input
              id="expected-total"
              className="org-input"
              type="number"
              min="0"
              step="0.01"
              value={expectedInput}
              disabled={selected === 'all'}
              onChange={(event) => setExpectedInput(event.target.value)}
            />
          </Field>
          <Button onClick={() => void saveExpected()} loading={savingExpected} disabled={selected === 'all'}>Save expected total</Button>
        </Card>
        <Card>
          <h2 style={{ marginTop: 0 }}>Feedback summary</h2>
          <p className="yv-muted">Feedback analytics are coming soon. Individual feedback stays private to your team.</p>
          {selected !== 'all' ? (
            <Link className="yv-btn yv-btn-outline yv-btn-sm" href={`/app/programs/${selected}/settings`}>Manage feedback form</Link>
          ) : null}
        </Card>
      </div>

      <Card>
        <h2 style={{ marginTop: 0 }}>Quick actions</h2>
        <div className="org-row">
          <Link className="yv-btn yv-btn-outline" href="/app/programs/new">New program</Link>
          <Link className="yv-btn yv-btn-outline" href="/app/programs">All programs</Link>
          {selected !== 'all' ? (
            <>
              <Link className="yv-btn yv-btn-outline" href={`/app/programs/${selected}/responses`}>View responses</Link>
              <Link className="yv-btn yv-btn-outline" href={`/app/programs/${selected}/inbox`}>Approval inbox</Link>
            </>
          ) : null}
        </div>
      </Card>
    </div>
  );
}
