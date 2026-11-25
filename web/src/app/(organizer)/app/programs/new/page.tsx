'use client';

import { EmptyState, LoadingState } from '@yivents/ui';
import { useSession } from '@/lib/auth';
import { ProgramSetupForm } from '@/components/organizer/ProgramSetupForm';

export default function NewProgramPage() {
  const { user, loading } = useSession();
  if (loading) return <LoadingState label="Checking your session…" />;
  if (!user) return <EmptyState title="Sign in required" message="Sign in to create a program." />;
  return (
    <div className="org-stack">
      <div>
        <h1 style={{ margin: 0 }}>New program</h1>
        <p className="yv-muted" style={{ margin: '.35rem 0 0' }}>Set up the essentials now; you can add tickets, forms and payments next.</p>
      </div>
      <ProgramSetupForm user={user} />
    </div>
  );
}
