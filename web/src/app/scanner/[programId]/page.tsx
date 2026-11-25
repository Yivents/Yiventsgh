import type { Metadata } from 'next';
import '@/components/public/public.css';
import { ScannerApp } from '@/components/public/ScannerApp';
import { PublicShell } from '@/components/public/site-chrome';

export const metadata: Metadata = {
  title: 'Door scanner',
  robots: { index: false, follow: false },
};

export default async function ScannerPage({ params }: { params: Promise<{ programId: string }> }) {
  const { programId } = await params;
  let decoded = programId;
  try {
    decoded = decodeURIComponent(programId);
  } catch {
    // Next already decodes route params in the common case.
  }
  return (
    <PublicShell>
      <div className="section yv-container yv-stack">
        <p className="yv-tiny yv-muted">Private door access — keep this screen with you.</p>
        <ScannerApp programId={decoded} />
      </div>
    </PublicShell>
  );
}
