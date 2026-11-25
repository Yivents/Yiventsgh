'use client';

/**
 * Claim-based admin shell. Roles come ONLY from Firebase custom claims; there
 * is deliberately no editable role field in Firestore. Also enforces TOTP
 * enrolment and a 30-minute idle logout for every admin session.
 */
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { signOut } from 'firebase/auth';
import { createContext, useContext, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { auth } from '@/lib/firebase/client';
import { startAdminIdleTimer, useSession, type SessionUser } from '@/lib/auth';
import { Badge, Button, Card, ErrorBanner, LoadingState } from '@yivents/ui';
import { admin2faStart, admin2faVerify } from '@/components/admin/adminActions';
import { friendlyError } from '@/components/admin/adminData';

export type AdminRole = 'superAdmin' | 'support' | 'moderator';

interface AdminContextValue {
  user: SessionUser;
  roles: AdminRole[];
  isSuperAdmin: boolean;
}

const AdminContext = createContext<AdminContextValue | null>(null);

export function useAdmin(): AdminContextValue {
  const value = useContext(AdminContext);
  if (!value) throw new Error('Admin components must be rendered inside the admin layout.');
  return value;
}

const NAV: Array<{ href: string; label: string; roles: AdminRole[] }> = [
  { href: '/admin', label: 'Overview', roles: ['superAdmin'] },
  { href: '/admin/organizers', label: 'Organisers', roles: ['superAdmin'] },
  { href: '/admin/review', label: 'Review queue', roles: ['superAdmin', 'moderator'] },
  { href: '/admin/reports', label: 'Reports', roles: ['superAdmin'] },
  { href: '/admin/blocklist', label: 'Blocklist', roles: ['superAdmin'] },
  { href: '/admin/messages', label: 'Messages', roles: ['superAdmin', 'support'] },
  { href: '/admin/announcements', label: 'Announcements', roles: ['superAdmin'] },
  { href: '/admin/content', label: 'Content', roles: ['superAdmin'] },
  { href: '/admin/settings', label: 'Settings', roles: ['superAdmin'] },
  { href: '/admin/audit', label: 'Audit log', roles: ['superAdmin'] },
];

function AccessDenied({ message }: { message: string }) {
  return (
    <main id="main" className="yv-container yv-stack" style={{ paddingBlock: '2.5rem' }}>
      <Card>
        <h1>Admin access required</h1>
        <p>{message}</p>
        <p className="yv-muted yv-tiny">
          Admin powers come from Firebase custom claims. Ask a super administrator to set the correct claim on your account, then sign in again.
        </p>
        <div className="yv-row">
          <Link className="yv-btn yv-btn-primary" href="/login">
            Sign in
          </Link>
          <Link className="yv-btn yv-btn-outline" href="/">
            Back to Yivents
          </Link>
        </div>
      </Card>
    </main>
  );
}

/** TOTP enrolment gate: the callable returns the URI, the secret never reaches the browser. */
function TwoFactorEnrollment() {
  const [uri, setUri] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const router = useRouter();

  async function start() {
    setBusy(true);
    setError('');
    try {
      const result = await admin2faStart();
      setUri(result.otpauthUri ?? result.uri ?? result.secret ?? '');
    } catch (err) {
      setError(friendlyError(err, 'We could not start two-factor setup. Please try again.'));
    } finally {
      setBusy(false);
    }
  }

  async function verify(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await admin2faVerify(code.trim());
      // Refresh the ID token so the new twoFactorEnrolled claim is visible, then remount the shell.
      await auth.currentUser?.getIdTokenResult(true);
      router.refresh();
      window.location.reload();
    } catch (err) {
      setError(friendlyError(err, 'That code was not accepted. Check your authenticator and try again.'));
      setBusy(false);
    }
  }

  return (
    <main id="main" className="yv-container" style={{ paddingBlock: '2.5rem', maxWidth: 640 }}>
      <Card className="yv-stack">
        <div>
          <Badge tone="warning">Required for all admins</Badge>
          <h1>Set up two-factor authentication</h1>
          <p className="yv-muted">Admin sessions require a TOTP authenticator app. This is a one-time step for your account.</p>
        </div>
        {error ? <ErrorBanner message={error} onDismiss={() => setError('')} /> : null}
        {!uri ? (
          <Button onClick={start} loading={busy}>
            Show setup key
          </Button>
        ) : (
          <form onSubmit={verify} className="yv-stack">
            <p className="yv-tiny yv-muted">Copy this plain-text key into your authenticator app:</p>
            <code style={{ display: 'block', overflowWrap: 'anywhere', background: 'var(--surface-alt)', padding: '0.75rem', borderRadius: 'var(--radius-sm)' }}>
              {uri}
            </code>
            <label htmlFor="admin-totp">Six-digit code</label>
            <input
              id="admin-totp"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              required
            />
            <Button type="submit" loading={busy}>
              Verify and continue
            </Button>
          </form>
        )}
      </Card>
    </main>
  );
}

export function AdminShell({ children }: { children: ReactNode }) {
  const { user, loading } = useSession();
  const pathname = usePathname();
  const router = useRouter();
  const [viewAsUid, setViewAsUid] = useState('');

  const roles: AdminRole[] = [];
  if (user?.claims.superAdmin === true) roles.push('superAdmin');
  if (user?.claims.support === true) roles.push('support');
  if (user?.claims.moderator === true) roles.push('moderator');

  const enrolled = user?.claims.twoFactorEnrolled === true;
  const ready = Boolean(user && roles.length && enrolled);

  // Read the view-as flag from sessionStorage only after mount (avoids hydration mismatch).
  useEffect(() => {
    setViewAsUid(window.sessionStorage.getItem('yv_viewAs') ?? '');
  }, []);

  useEffect(() => {
    if (!ready) return;
    return startAdminIdleTimer(async () => {
      try {
        await signOut(auth);
      } finally {
        router.replace('/login');
      }
    }, 30);
  }, [ready, router]);

  async function signOutAdmin() {
    window.sessionStorage.removeItem('yv_viewAs');
    await signOut(auth);
    router.replace('/login');
  }

  function exitViewAs() {
    window.sessionStorage.removeItem('yv_viewAs');
    setViewAsUid('');
    router.replace('/admin');
  }

  if (loading) {
    return (
      <main id="main" className="yv-container" style={{ paddingBlock: '3rem' }}>
        <LoadingState label="Checking your admin access…" />
      </main>
    );
  }

  if (!user || roles.length === 0) {
    return <AccessDenied message="This area is restricted to accounts with an admin custom claim." />;
  }

  if (!enrolled) return <TwoFactorEnrollment />;

  const visibleNav = NAV.filter((item) => item.roles.some((role) => roles.includes(role)));
  const value: AdminContextValue = { user, roles, isSuperAdmin: roles.includes('superAdmin') };

  return (
    <AdminContext.Provider value={value}>
      {viewAsUid ? (
        <div className="yv-warning-banner" role="status" style={{ borderRadius: 0, justifyContent: 'center' }}>
          <span>
            Read-only view-as session for organiser <strong>{viewAsUid}</strong>. Every access is logged. No actions are available.
          </span>
          <button type="button" className="yv-link-button" onClick={exitViewAs}>
            Exit view-as
          </button>
        </div>
      ) : null}

      <header className="site-header">
        <div className="yv-container yv-spread">
          <Link href="/admin" className="brand" aria-label="Yivents admin home">
            Yivents Admin
          </Link>
          <div className="yv-row">
            <span className="yv-tiny yv-muted">{roles.join(', ')}</span>
            <Button variant="outline" size="sm" onClick={signOutAdmin}>
              Sign out
            </Button>
          </div>
        </div>
      </header>

      <nav aria-label="Admin sections" style={{ background: 'var(--surface)', borderBottom: '1px solid var(--border)' }}>
        <div className="yv-container yv-row" style={{ overflowX: 'auto', paddingBlock: '0.5rem', flexWrap: 'nowrap' }}>
          {visibleNav.map((item) => {
            const active = pathname === item.href || (item.href !== '/admin' && pathname.startsWith(`${item.href}/`));
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={`yv-btn yv-btn-sm ${active ? 'yv-btn-primary' : 'yv-btn-ghost'}`}
                style={{ whiteSpace: 'nowrap' }}
              >
                {item.label}
              </Link>
            );
          })}
        </div>
      </nav>

      <main id="main" className="yv-container" style={{ paddingBlock: '2rem' }}>
        {children}
      </main>

      <footer className="site-footer">
        <div className="yv-container yv-row">
          <span className="yv-tiny">Yivents admin — claim-gated, audited, 30-minute idle logout.</span>
          <Link href="/legal/privacy" className="yv-tiny">
            Privacy
          </Link>
        </div>
      </footer>
    </AdminContext.Provider>
  );
}

/** Route-level guard used by each admin screen. */
export function AdminOnly({ allow, children }: { allow: AdminRole[]; children: ReactNode }) {
  const { roles } = useAdmin();
  if (!allow.some((role) => roles.includes(role))) {
    return <AccessDenied message="Your admin role does not include this section." />;
  }
  return <>{children}</>;
}
