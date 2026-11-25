import type { Metadata } from 'next';
import '@/components/public/public.css';
import { ReportForm } from '@/components/public/ReportForm';
import { PublicShell } from '@/components/public/site-chrome';

export const metadata: Metadata = {
  title: 'Report an event',
  description: 'Report a suspicious event, payment request or ticket problem to the Yivents review team.',
};

export default function ReportPage() {
  return (
    <PublicShell>
      <div className="section yv-container yv-stack">
        <div>
          <h1>Report an event</h1>
          <p className="yv-muted">
            Tell us what happened. Reports go to the Yivents review team. Never include your PIN or password.
          </p>
        </div>
        <ReportForm />
      </div>
    </PublicShell>
  );
}
