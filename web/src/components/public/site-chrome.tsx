/**
 * Shared public chrome. Kept framework-agnostic (no hooks, no server imports)
 * so it can be used from both server pages and client pages.
 * Assumed organizer/legal paths are documented in the hand-off notes.
 */
import type { ReactNode } from 'react';

export const HOST_EVENT_URL = '/signup';
export const LOOKUP_URL = '/lookup';
export const REPORT_URL = '/report';

export function SiteHeader() {
  return (
    <header className="site-header">
      <div className="yv-container">
        <a href="/" className="brand" aria-label="Yivents home">
          <img src="/brand/logo.png" alt="" width={34} height={34} />
          <span>Yivents</span>
        </a>
        <nav className="pub-nav-links" aria-label="Main navigation">
          <a href="/">Find events</a>
          <a href={LOOKUP_URL}>Get your ticket</a>
          <a href={HOST_EVENT_URL} className="pub-nav-cta">Host your event</a>
        </nav>
      </div>
    </header>
  );
}

export function SiteFooter() {
  const support = process.env.NEXT_PUBLIC_SUPPORT_EMAIL;
  return (
    <footer className="site-footer">
      <div className="yv-container yv-stack">
        <div className="yv-spread">
          <strong>Yivents</strong>
          <span className="yv-tiny">Registration, payments tracking and tickets for Ghanaian events.</span>
        </div>
        <nav className="yv-row" aria-label="Legal and support links">
          <a href="/legal/terms">Terms</a>
          <a href="/legal/privacy">Privacy</a>
          <a href="/legal/registrant-notice">Registrant notice</a>
          {support ? <a href={`mailto:${support}`}>Contact support</a> : null}
        </nav>
        <p className="yv-tiny">Never share your PIN or password. Yivents does not process or hold payments.</p>
      </div>
    </footer>
  );
}

export function PublicShell({ children }: { children: ReactNode }) {
  return (
    <div className="pub-shell">
      <SiteHeader />
      <main id="main" className="pub-main">{children}</main>
      <SiteFooter />
    </div>
  );
}
