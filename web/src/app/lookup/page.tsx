import type { Metadata } from 'next';
import '@/components/public/public.css';
import { LookupForm } from '@/components/public/LookupForm';
import { PublicShell } from '@/components/public/site-chrome';

export const metadata: Metadata = {
  title: 'Find your ticket',
  description: 'Look up your Yivents ticket with the email address or phone number you used to register.',
};

export default function LookupPage() {
  return (
    <PublicShell>
      <div className="section yv-container yv-stack">
        <div>
          <h1>Find your ticket</h1>
          <p className="yv-muted">No account needed. We will verify your details before showing a private link.</p>
        </div>
        <LookupForm />
      </div>
    </PublicShell>
  );
}
