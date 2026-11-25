import '@/components/public/public.css';
import { LoadingState } from '@yivents/ui';
import { PublicShell } from '@/components/public/site-chrome';

export default function TicketLoading() {
  return (
    <PublicShell>
      <div className="section yv-container">
        <LoadingState label="Opening your ticket…" />
      </div>
    </PublicShell>
  );
}
