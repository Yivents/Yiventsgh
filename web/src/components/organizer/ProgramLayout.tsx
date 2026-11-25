'use client';

/** Shared program header/sub-navigation. Helpers can only reach the inbox. */
import Link from 'next/link';
import { useParams, usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { Badge, EmptyState, LoadingState, WarningBanner } from '@yivents/ui';
import { useSession } from '@/lib/auth';
import { useHelperDoc, useProgram } from './data';
import { formatEventRange, type ProgramStatus } from '@yivents/shared';
import { statusTone } from './utils';

const OWNER_TABS = [
  { path: '', label: 'Overview' },
  { path: '/setup', label: 'Setup' },
  { path: '/tickets', label: 'Tickets' },
  { path: '/form', label: 'Form' },
  { path: '/payments', label: 'Payments' },
  { path: '/responses', label: 'Responses' },
  { path: '/inbox', label: 'Inbox' },
  { path: '/email', label: 'Email' },
  { path: '/tickets-design', label: 'Ticket design' },
  { path: '/online', label: 'Online' },
  { path: '/helpers', label: 'Helpers' },
  { path: '/scanner', label: 'Scanner' },
  { path: '/settings', label: 'Settings' },
];
const HELPER_TABS = [{ path: '/inbox', label: 'Inbox' }];

export function ProgramLayout({ children }: { children: ReactNode }) {
  const params = useParams<{ id: string }>();
  const programId = String(params?.id ?? '');
  const pathname = usePathname();
  const { user } = useSession();
  const { program, loading } = useProgram(programId);
  const { helper } = useHelperDoc(programId, user?.uid);

  if (loading) return <LoadingState label="Opening program…" />;
  if (!program) {
    return <EmptyState title="Program not found" message="This event does not exist or you no longer have access to it." />;
  }
  const isOwner = program.ownerUid === user?.uid;
  if (!isOwner && !helper) {
    return (
      <EmptyState
        title="Access restricted"
        message="Only the event owner or an invited helper can open this area."
        action={<Link className="yv-btn yv-btn-outline" href="/app/programs">Back to programs</Link>}
      />
    );
  }

  const base = `/app/programs/${programId}`;
  const tabs = isOwner ? OWNER_TABS : HELPER_TABS;
  const current = pathname === base ? '' : pathname.startsWith(`${base}/`) ? pathname.slice(base.length) : '';

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div>
          <p className="yv-tiny yv-muted">Program workspace</p>
          <h1 style={{ margin: '.15rem 0' }}>{program.title || 'Untitled event'}</h1>
          <p className="yv-muted" style={{ margin: 0 }}>
            {formatEventRange(program.event)}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '.4rem', alignItems: 'center' }}>
          <Badge tone={statusTone(program.status as ProgramStatus)}>{program.status}</Badge>
          {!isOwner ? <Badge tone="info">Helper access</Badge> : null}
        </div>
      </div>

      {program.status === 'archived' ? (
        <div style={{ marginTop: '1rem' }}>
          <WarningBanner>This program is archived and read-only. Restore it from Settings before making changes.</WarningBanner>
        </div>
      ) : null}

      <nav className="yv-tabs" aria-label="Program sections" style={{ marginTop: '1.5rem' }}>
        {tabs.map((tab) => {
          const href = `${base}${tab.path}`;
          const active = current === tab.path || (tab.path === '/inbox' && current === '/inbox');
          return (
            <Link
              key={tab.label}
              href={href}
              className={`yv-tab${active ? ' yv-tab-active' : ''}`}
              aria-current={active ? 'page' : undefined}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>

      <div style={{ marginTop: '1.25rem' }}>{children}</div>
    </div>
  );
}
