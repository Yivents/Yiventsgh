import '@/components/public/public.css';
import { EmptyState } from '@yivents/ui';
import { PublicShell } from '@/components/public/site-chrome';

export default function NotFound() {
  return (
    <PublicShell>
      <div className="section yv-container">
        <EmptyState
          title="We could not find that page"
          message="The link may have changed. Try searching for the event, or ask the organizer for a fresh link."
          action={<a className="yv-btn yv-btn-primary" href="/">Find events</a>}
        />
      </div>
    </PublicShell>
  );
}
