'use client';

import { useParams } from 'next/navigation';
import { EmptyState, LoadingState } from '@yivents/ui';
import { useSession } from '@/lib/auth';
import { useProgram } from '@/components/organizer/data';
import { ProgramSetupForm } from '@/components/organizer/ProgramSetupForm';

export default function SetupPage() {
  const params = useParams<{ id: string }>();
  const programId = String(params?.id ?? '');
  const { user } = useSession();
  const { program, loading } = useProgram(programId);

  if (loading) return <LoadingState label="Loading program setup…" />;
  if (!program) return <EmptyState title="Program not found" message="This event no longer exists." />;
  if (!user) return <EmptyState title="Sign in required" message="Sign in to edit this program." />;

  return (
    <div className="org-stack">
      <div>
        <h1 style={{ margin: 0 }}>Setup</h1>
        <p className="yv-muted" style={{ margin: '.35rem 0 0' }}>Details, branding, media, schedule and sharing.</p>
      </div>
      <ProgramSetupForm program={program} user={user} />
    </div>
  );
}
