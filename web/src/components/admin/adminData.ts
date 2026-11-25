'use client';

/** Small client-side data helpers shared by the admin screens. */
import { useEffect, useMemo, useState, type DependencyList } from 'react';
import {
  collection,
  getDocs,
  onSnapshot,
  where,
  documentId,
  type DocumentData,
  type DocumentReference,
  type Query,
} from 'firebase/firestore';
import { db } from '@/lib/firebase/client';
import { formatGhanaDate } from '@/lib/format';

export type WithId<T> = T & { id: string };

/** Live Firestore query with explicit loading, empty and error states. */
export function useCollection<T>(makeQuery: () => Query<DocumentData> | null, deps: DependencyList) {
  const target = useMemo(makeQuery, deps);
  const [rows, setRows] = useState<WithId<T>[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!target) {
      setRows([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    return onSnapshot(
      target,
      (snap) => {
        setRows(snap.docs.map((d) => ({ ...(d.data() as T), id: d.id })));
        setError('');
        setLoading(false);
      },
      (err) => {
        setError(friendlyError(err, 'We could not load this list. Please try again.'));
        setLoading(false);
      },
    );
  }, [target]);

  return { rows, loading, error };
}

/** Live single document; `null` means the document does not exist (or access is denied). */
export function useDocument<T>(makeRef: () => DocumentReference<DocumentData> | null, deps: DependencyList) {
  const target = useMemo(makeRef, deps);
  const [data, setData] = useState<WithId<T> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!target) {
      setData(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    return onSnapshot(
      target,
      (snap) => {
        setData(snap.exists() ? ({ ...(snap.data() as T), id: snap.id }) : null);
        setError('');
        setLoading(false);
      },
      (err) => {
        setError(friendlyError(err, 'We could not load this record. Please try again.'));
        setLoading(false);
      },
    );
  }, [target]);

  return { data, loading, error };
}

type MaybeTimestamp = { toDate: () => Date };

/** Firestore can return ISO strings or Timestamp objects; normalise both. */
export function toIso(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && 'toDate' in value) {
    const candidate = (value as Partial<MaybeTimestamp>).toDate;
    if (typeof candidate === 'function') {
      const date = candidate.call(value);
      return date instanceof Date ? date.toISOString() : '';
    }
  }
  return '';
}

export function displayDate(value: unknown, withTime = true): string {
  const iso = toIso(value);
  return iso ? formatGhanaDate(iso, withTime) : '—';
}

/** Never show raw Firebase error text; map common causes to useful messages. */
export function friendlyError(error: unknown, fallback = 'Something went wrong. Please try again.'): string {
  const raw = error instanceof Error ? error.message : String(error ?? '');
  const rules: Array<[RegExp, string]> = [
    [/permission-denied/i, 'You do not have permission to do that.'],
    [/unauthenticated/i, 'Please sign in again to continue.'],
    [/failed-precondition/i, 'This action is not available right now. Please check the details and try again.'],
    [/too-many-requests|rate.limit/i, 'Too many attempts. Please wait a moment and try again.'],
    [/network|unavailable|deadline.exceeded/i, 'Connection problem. Check your internet and try again.'],
    [/invalid-argument/i, 'Some details were not accepted. Please check them and try again.'],
    [/already.exists/i, 'That entry already exists.'],
    [/not.found/i, 'We could not find that record. It may have been removed.'],
  ];
  for (const [pattern, message] of rules) if (pattern.test(raw)) return message;
  const cleaned = raw.replace(/^FirebaseError:\s*/i, '').replace(/^\[[^\]]+\]\s*/, '').trim();
  return cleaned && cleaned.length < 160 ? cleaned : fallback;
}

export interface UserLite {
  id: string;
  email?: string;
  displayName?: string;
  verifiedBadge?: boolean;
  status?: string;
}

/** Batched lookup so conversation rows can show names instead of raw uids. */
export async function fetchUsers(uids: string[]): Promise<Record<string, UserLite>> {
  const found: Record<string, UserLite> = {};
  const unique = Array.from(new Set(uids.filter(Boolean)));
  for (let i = 0; i < unique.length; i += 10) {
    const chunk = unique.slice(i, i + 10);
    const snap = await getDocs(query(collection(db, 'users'), where(documentId(), 'in', chunk)));
    snap.docs.forEach((d) => {
      const data = d.data() as Partial<UserLite>;
      found[d.id] = { id: d.id, ...data };
    });
  }
  return found;
}

/** Convenience hook for the batched lookup above. */
export function useUserMap(uids: string[]) {
  const key = Array.from(new Set(uids.filter(Boolean))).sort().join('|');
  const [map, setMap] = useState<Record<string, UserLite>>({});

  useEffect(() => {
    let alive = true;
    const list = key ? key.split('|') : [];
    if (!list.length) {
      setMap({});
      return;
    }
    fetchUsers(list)
      .then((next) => alive && setMap(next))
      .catch(() => alive && setMap({}));
    return () => {
      alive = false;
    };
  }, [key]);

  return map;
}
