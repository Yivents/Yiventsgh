'use client';

/** Program list with one-click duplication and read-only archive state. */
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Badge, Button, Card, EmptyState, ErrorBanner, LoadingState } from '@yivents/ui';
import { formatEventRange } from '@yivents/shared';
import { useSession } from '@/lib/auth';
import { useMyPrograms } from '@/components/organizer/data';
import { archiveProgram, duplicateProgram } from '@/components/organizer/program';
import { copyText, publicProgramUrl, statusTone } from '@/components/organizer/utils';

export default function ProgramsPage() {
  const { user } = useSession();
  const router = useRouter();
  const { programs, loading, error } = useMyPrograms(user?.uid);
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState('');
  const [actionError, setActionError] = useState('');

  const duplicate = async (id: string) => {
    const source = programs.find((program) => program.id === id);
    if (!source || !user) return;
    setBusy(id);
    setActionError('');
    try {
      // Copies setup, ticket types, forms and payment methods; never registrations.
      const newId = await duplicateProgram(source, user.uid);
      router.push(`/app/programs/${newId}/setup`);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not duplicate this program.');
    } finally {
      setBusy('');
    }
  };

  const archive = async (id: string) => {
    setBusy(id);
    setActionError('');
    try {
      await archiveProgram(id);
      setNotice('Program archived. It is now read-only.');
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not archive this program.');
    } finally {
      setBusy('');
    }
  };

  if (loading) return <LoadingState label="Loading your programs…" />;
  if (error) return <ErrorBanner message={error} />;

  return (
    <div className="org-stack">
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ margin: 0 }}>Programs</h1>
          <p className="yv-muted" style={{ margin: '.35rem 0 0' }}>Everything you host, in one place.</p>
        </div>
        <Link className="yv-btn yv-btn-primary" href="/app/programs/new">New program</Link>
      </div>
      {notice ? <Card><p style={{ margin: 0 }}>{notice}</p></Card> : null}
      {actionError ? <ErrorBanner message={actionError} onDismiss={() => setActionError('')} /> : null}

      {!programs.length ? (
        <EmptyState
          title="No programs yet"
          message="Create an event, add ticket types and share your link to start collecting registrations."
          action={<Link className="yv-btn yv-btn-primary" href="/app/programs/new">Create your first program</Link>}
        />
      ) : (
        <div className="grid">
          {programs.map((program) => {
            const archived = program.status === 'archived';
            return (
              <Card key={program.id}>
                <div className="org-row" style={{ justifyContent: 'space-between' }}>
                  <h2 style={{ margin: 0, fontSize: '1.15rem' }}>{program.title || 'Untitled event'}</h2>
                  <Badge tone={statusTone(program.status)}>{program.status}</Badge>
                </div>
                <p className="org-muted" style={{ margin: '.5rem 0' }}>{formatEventRange(program.event)}</p>
                <p className="org-muted" style={{ margin: 0 }}>{program.visibility === 'public' ? 'Public listing (approval required)' : 'Link only'}</p>
                <div className="org-row" style={{ marginTop: '1rem' }}>
                  <Link className="yv-btn yv-btn-sm yv-btn-primary" href={`/app/programs/${program.id}`}>Open</Link>
                  <Button variant="outline" size="sm" loading={busy === program.id} onClick={() => void duplicate(program.id)}>Duplicate</Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    loading={busy === `${program.id}-archive`}
                    disabled={archived}
                    onClick={() => void archive(program.id)}
                  >
                    {archived ? 'Archived (read-only)' : 'Archive'}
                  </Button>
                </div>
                <div className="org-row" style={{ marginTop: '.75rem' }}>
                  <button
                    type="button"
                    className="yv-link-button"
                    onClick={() => void copyText(publicProgramUrl(program.slug)).then((ok) => setNotice(ok ? 'Share link copied.' : 'Could not copy the link.'))}
                  >
                    Copy share link
                  </button>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
