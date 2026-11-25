'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { Badge, Card, EmptyState, LoadingState } from '@yivents/ui';
import { formatEventRange, formatGHS } from '@yivents/shared';
import { useProgram, useRegistrationsFor, useTicketTypes } from '@/components/organizer/data';

export default function ProgramOverviewPage() {
  const params = useParams<{ id: string }>();
  const programId = String(params?.id ?? '');
  const { program, loading } = useProgram(programId);
  const { ticketTypes } = useTicketTypes(programId);
  const { registrations } = useRegistrationsFor([programId]);

  if (loading) return <LoadingState label="Loading overview…" />;
  if (!program) return <EmptyState title="Program not found" message="This event no longer exists." />;

  const verified = registrations.filter((row) => row.status === 'verified');
  const revenue = verified.reduce((sum, row) => sum + (row.ticketPricePesewas ?? 0), 0);

  return (
    <div className="org-stack">
      <div className="grid">
        <Card>
          <p className="org-muted" style={{ margin: 0 }}>When</p>
          <h2 style={{ margin: '.3rem 0', fontSize: '1.15rem' }}>{formatEventRange(program.event)}</h2>
          <p className="org-muted" style={{ margin: 0 }}>{program.event.venue || 'Venue to be announced'}</p>
        </Card>
        <Card>
          <p className="org-muted" style={{ margin: 0 }}>Ticket types</p>
          <h2 style={{ margin: '.3rem 0', fontSize: '1.8rem' }}>{ticketTypes.filter((type) => type.active).length}</h2>
          <p className="org-muted" style={{ margin: 0 }}>{ticketTypes.length} total</p>
        </Card>
        <Card>
          <p className="org-muted" style={{ margin: 0 }}>Registrations</p>
          <h2 style={{ margin: '.3rem 0', fontSize: '1.8rem' }}>{registrations.length}</h2>
          <p className="org-muted" style={{ margin: 0 }}>{verified.length} verified</p>
        </Card>
        <Card>
          <p className="org-muted" style={{ margin: 0 }}>Revenue by ticket price</p>
          <h2 style={{ margin: '.3rem 0', fontSize: '1.8rem' }}>{formatGHS(revenue)}</h2>
          <p className="org-muted" style={{ margin: 0 }}>Not amount paid</p>
        </Card>
      </div>
      <Card>
        <div className="org-row" style={{ justifyContent: 'space-between' }}>
          <div>
            <h2 style={{ margin: 0 }}>Next steps</h2>
            <p className="org-muted">Finish setup, then open registration once tickets and payments are ready.</p>
          </div>
          <Badge tone={program.visibility === 'public' ? 'info' : 'neutral'}>
            {program.visibility === 'public' ? `Public · ${program.approvalStatus}` : 'Link only'}
          </Badge>
        </div>
        <div className="org-row" style={{ marginTop: '1rem' }}>
          <Link className="yv-btn yv-btn-outline" href={`/app/programs/${programId}/setup`}>Edit setup</Link>
          <Link className="yv-btn yv-btn-outline" href={`/app/programs/${programId}/tickets`}>Ticket types</Link>
          <Link className="yv-btn yv-btn-outline" href={`/app/programs/${programId}/form`}>Registration form</Link>
          <Link className="yv-btn yv-btn-outline" href={`/app/programs/${programId}/payments`}>Payment methods</Link>
          <Link className="yv-btn yv-btn-outline" href={`/app/programs/${programId}/responses`}>Responses</Link>
        </div>
      </Card>
    </div>
  );
}
