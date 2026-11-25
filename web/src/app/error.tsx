'use client';

import '@/components/public/public.css';
import { useEffect } from 'react';
import { Button, ErrorBanner } from '@yivents/ui';
import { PublicShell } from '@/components/public/site-chrome';

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error('[public] page error', error);
  }, [error]);

  return (
    <PublicShell>
      <div className="section yv-container yv-stack">
        <h1>Something went wrong</h1>
        <ErrorBanner message="This page could not be loaded right now. Your registration details are safe." />
        <div className="yv-row">
          <Button type="button" onClick={reset}>Try again</Button>
          <a className="yv-btn yv-btn-outline" href="/">Back to events</a>
        </div>
      </div>
    </PublicShell>
  );
}
