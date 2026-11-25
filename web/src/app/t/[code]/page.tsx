'use client';

import '@/components/public/public.css';
import { useParams } from 'next/navigation';
import { TicketView } from '@/components/public/TicketView';
import { PublicShell } from '@/components/public/site-chrome';

export default function TicketPage() {
  const params = useParams();
  const value = params.code;
  const raw = Array.isArray(value) ? value[0] : value;
  let code = '';
  try {
    code = decodeURIComponent(raw ?? '');
  } catch {
    code = raw ?? '';
  }

  return (
    <PublicShell>
      <div className="section yv-container yv-stack">
        <div>
          <h1>Your ticket</h1>
          <p className="yv-muted">Keep this page or download a copy. Your QR code is all the door team needs.</p>
        </div>
        <TicketView code={code} />
      </div>
    </PublicShell>
  );
}
