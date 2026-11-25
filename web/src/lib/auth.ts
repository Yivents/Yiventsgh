'use client';

import { useEffect, useState } from 'react';
import { onAuthStateChanged, type User } from 'firebase/auth';
import { auth } from '@/lib/firebase/client';

export interface SessionUser extends User {
  claims: Record<string, boolean | string | number>;
}

export function useSession() {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    return onAuthStateChanged(auth, async (next) => {
      if (!next) {
        setUser(null);
        setLoading(false);
        return;
      }
      const token = await next.getIdTokenResult();
      setUser({ ...next, claims: token.claims as Record<string, boolean | string | number> } as SessionUser);
      setLoading(false);
    });
  }, []);

  return { user, loading, isOrganizer: Boolean(user && !user.claims.superAdmin), isAdmin: Boolean(user?.claims.superAdmin || user?.claims.admin), isSupport: Boolean(user?.claims.support), isModerator: Boolean(user?.claims.moderator) };
}

/** Admin sessions expire after 30 minutes of inactivity; call from admin layouts. */
export function startAdminIdleTimer(onExpire: () => void, minutes = 30) {
  if (typeof window === 'undefined') return () => undefined;
  let timer = window.setTimeout(onExpire, minutes * 60_000);
  const reset = () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(onExpire, minutes * 60_000);
  };
  ['click', 'keydown', 'touchstart'].forEach((event) => window.addEventListener(event, reset, { passive: true }));
  return () => {
    window.clearTimeout(timer);
    ['click', 'keydown', 'touchstart'].forEach((event) => window.removeEventListener(event, reset));
  };
}
