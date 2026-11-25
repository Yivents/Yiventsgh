'use client';

import { collection, limit, query, where } from 'firebase/firestore';
import { BarChart, Card, EmptyState, ErrorBanner, LoadingState } from '@yivents/ui';
import { db } from '@/lib/firebase/client';
import { useCollection, displayDate, toIso, type WithId } from '@/components/admin/adminData';
import { AdminOnly } from '@/components/admin/AdminShell';

type MetricRow = Record<string, unknown> & { id: string };

function pick(row: MetricRow | undefined, keys: string[]): string {
  if (!row) return '—';
  for (const key of keys) {
    const value = row[key];
    if (typeof value === 'number' || typeof value === 'string') return String(value);
  }
  return '—';
}

function latest(rows: MetricRow[]): MetricRow | undefined {
  return [...rows].sort((a, b) => {
    const left = toIso(a.updatedAt ?? a.at ?? a.date ?? a.generatedAt);
    const right = toIso(b.updatedAt ?? b.at ?? b.date ?? b.generatedAt);
    return right.localeCompare(left);
  })[0];
}

function Overview() {
  const metrics = useCollection<Record<string, unknown>>(() => query(collection(db, 'metrics'), limit(24)), []);
  const organizers = useCollection<Record<string, unknown>>(
    () => query(collection(db, 'users'), where('status', '==', 'active'), limit(500)),
    [],
  );
  const programs = useCollection<Record<string, unknown>>(() => query(collection(db, 'programs'), limit(500)), []);

  const current = latest(metrics.rows);
  const cards = [
    { label: 'Sign-ups', value: pick(current, ['signUps', 'signups', 'totalSignups', 'users']) },
    { label: 'Active organisers', value: organizers.loading ? '—' : String(organizers.rows.length) },
    { label: 'Events', value: programs.loading ? '—' : String(programs.rows.length) },
    { label: 'Registrations', value: pick(current, ['registrations', 'totalRegistrations']) },
    { label: 'Tickets scanned', value: pick(current, ['ticketsScanned', 'checkedIn', 'scanned']) },
    { label: 'Retention', value: pick(current, ['retention', 'retentionPercent', 'retentionRate']) },
  ];

  const statusLabels = ['upcoming', 'ongoing', 'ended', 'archived', 'draft'];
  const statusValues = statusLabels.map((status) => programs.rows.filter((p: WithId<Record<string, unknown>>) => p.status === status).length);

  const error = metrics.error || organizers.error || programs.error;
  const loading = metrics.loading || organizers.loading || programs.loading;

  return (
    <div className="yv-stack">
      <div>
        <h1>Platform overview</h1>
        <p className="yv-muted">
          Sign-ups, organisers, events, registrations, scanned tickets and retention. Metrics are written by a daily scheduled function; counts from collections are live.
        </p>
      </div>

      {error ? <ErrorBanner message={error} /> : null}
      {loading ? <LoadingState label="Loading platform metrics…" /> : null}

      {!loading && !error && !current && !organizers.rows.length && !programs.rows.length ? (
        <EmptyState
          title="No platform data yet"
          message="Metrics appear after the daily update runs and once organisers create accounts and events."
        />
      ) : null}

      <div className="grid">
        {cards.map((card) => (
          <Card key={card.label}>
            <p className="yv-tiny yv-muted">{card.label}</p>
            <p style={{ fontSize: '1.8rem', fontWeight: 800, margin: 0 }}>{card.value}</p>
          </Card>
        ))}
      </div>

      {current ? (
        <Card className="yv-stack">
          <h2 style={{ fontSize: '1.15rem' }}>Events by status</h2>
          <BarChart values={statusValues} labels={statusLabels} />
          <p className="yv-tiny yv-muted">
            Metrics snapshot: {current ? displayDate(current.updatedAt ?? current.at ?? current.date ?? current.generatedAt) : '—'}.
            Values shown as recorded by the platform; no payment totals are held by Yivents.
          </p>
        </Card>
      ) : null}
    </div>
  );
}

export default function AdminDashboardPage() {
  return (
    <AdminOnly allow={['superAdmin']}>
      <Overview />
    </AdminOnly>
  );
}
