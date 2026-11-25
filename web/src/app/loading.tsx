import '@/components/public/public.css';
import { LoadingState } from '@yivents/ui';
import { PublicShell } from '@/components/public/site-chrome';

export default function Loading() {
  return (
    <PublicShell>
      <div className="section yv-container">
        <LoadingState label="Loading events…" />
      </div>
    </PublicShell>
  );
}
