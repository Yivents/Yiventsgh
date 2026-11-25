'use client';

/** Signed-in shell: auth guard, navigation and organiser announcement banners. */
import { signOut } from 'firebase/auth';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { Button, LoadingState } from '@yivents/ui';
import { useSession } from '@/lib/auth';
import { auth } from '@/lib/firebase/client';
import { useAnnouncements } from './data';
import { isActiveAnnouncement } from './utils';
import './organizer.css';

const LINKS = [
  { href: '/app', label: 'Dashboard' },
  { href: '/app/programs', label: 'Programs' },
  { href: '/app/inbox', label: 'Messages' },
  { href: '/app/announcements', label: 'Announcements' },
  { href: '/app/account', label: 'Account' },
];

function AnnouncementBanners() {
  const { announcements } = useAnnouncements();
  const [dismissed, setDismissed] = useState<string[]>([]);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem('yv-dismissed-announcements');
      setDismissed(saved ? (JSON.parse(saved) as string[]) : []);
    } catch {
      setDismissed([]);
    }
  }, []);

  const visible = announcements.filter(
    (item) => isActiveAnnouncement(item) && !(item.dismissible && dismissed.includes(item.id)),
  );
  if (!visible.length) return null;

  const dismiss = (id: string) => {
    const next = [...dismissed, id];
    setDismissed(next);
    window.localStorage.setItem('yv-dismissed-announcements', JSON.stringify(next));
  };

  return (
    <div style={{ marginBottom: '1rem' }}>
      {visible.map((item) => (
        <div
          className={`yv-${item.type === 'urgent' ? 'error' : item.type === 'info' ? 'success' : item.type}-banner`}
          key={item.id}
          role="status"
        >
          <div>
            <strong>{item.title}</strong>
            <p style={{ margin: '.3rem 0 0' }}>{item.body}</p>
          </div>
          {item.dismissible ? (
            <Button variant="ghost" size="sm" onClick={() => dismiss(item.id)}>
              Dismiss
            </Button>
          ) : null}
        </div>
      ))}
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const { user, loading } = useSession();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!loading && !user) router.replace(`/login?next=${encodeURIComponent(pathname || '/app')}`);
  }, [loading, user, pathname, router]);

  if (loading) {
    return (
      <main id="main" className="yv-container" style={{ padding: '2rem 1rem' }}>
        <LoadingState label="Checking your session…" />
      </main>
    );
  }
  if (!user) {
    return (
      <main id="main" className="yv-container" style={{ padding: '2rem 1rem' }}>
        <p>Taking you to sign in…</p>
      </main>
    );
  }

  return (
    <>
      <header className="site-header">
        <div className="yv-container">
          <Link href="/app" className="brand" aria-label="Yivents home">
            <img src="/brand/logo.png" alt="" width={34} height={34} /> Yivents
          </Link>
          <nav aria-label="Organiser navigation" style={{ display: 'flex', gap: '.35rem', flexWrap: 'wrap' }}>
            {LINKS.map((link) => {
              const active = link.href === '/app' ? pathname === '/app' : pathname.startsWith(link.href);
              return (
                <Link
                  key={link.href}
                  href={link.href}
                  className="yv-btn yv-btn-sm yv-btn-ghost"
                  aria-current={active ? 'page' : undefined}
                  style={active ? { textDecoration: 'underline', background: 'var(--brand-primary-soft)' } : undefined}
                >
                  {link.label}
                </Link>
              );
            })}
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                await signOut(auth);
                router.replace('/login');
              }}
            >
              Sign out
            </Button>
          </nav>
        </div>
      </header>
      <main id="main" className="yv-container" style={{ paddingTop: '1.5rem', paddingBottom: '3rem' }}>
        <AnnouncementBanners />
        {children}
      </main>
    </>
  );
}
