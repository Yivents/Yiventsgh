'use client';

/** Consistent card for login, signup and password reset. */
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Card } from '@yivents/ui';
import './organizer.css';

export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <main id="main" className="yv-container" style={{ maxWidth: 520, padding: '2.5rem 1rem' }}>
      <Link href="/" className="brand" aria-label="Yivents home">
        <img src="/brand/logo.png" alt="" width={34} height={34} /> Yivents
      </Link>
      <Card style={{ marginTop: '1.5rem' }}>
        <h1 style={{ marginTop: 0 }}>{title}</h1>
        <p className="yv-muted">{subtitle}</p>
        {children}
      </Card>
      {footer ? <div style={{ marginTop: '1rem', fontSize: '.9rem' }}>{footer}</div> : null}
    </main>
  );
}
