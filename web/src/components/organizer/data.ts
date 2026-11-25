'use client';

/**
 * Small live-data hooks for the organiser area. All reads go straight to the
 * Firestore client SDK; rules scope them to ownerUid / helpers/{uid}.
 */
import {
  collection,
  doc,
  onSnapshot,
  query,
  where,
  type DocumentData,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { useEffect, useState } from 'react';
import type { Announcement, FormField, PaymentMethod, Registration, TicketType, UserProfile } from '@yivents/shared';
import { db } from '@/lib/firebase/client';
import type { AdminMessageDoc, HelperDoc, ProgramDoc } from './types';
import { friendlyError } from './utils';

function withId<T>(snapshot: QueryDocumentSnapshot<DocumentData>): T {
  return { id: snapshot.id, ...snapshot.data() } as T;
}

export function useDoc<T>(path: string | null) {
  const [value, setValue] = useState<T | null>(null);
  const [loading, setLoading] = useState(Boolean(path));
  const [error, setError] = useState('');

  useEffect(() => {
    if (!path) {
      setValue(null);
      setLoading(false);
      return undefined;
    }
    setLoading(true);
    setError('');
    return onSnapshot(
      doc(db, path),
      (snapshot) => {
        setValue(snapshot.exists() ? ({ id: snapshot.id, ...snapshot.data() } as T) : null);
        setLoading(false);
      },
      (err) => {
        setError(friendlyError(err));
        setValue(null);
        setLoading(false);
      },
    );
  }, [path]);

  return { value, loading, error };
}

export function useCollection<T>(path: string | null) {
  const [items, setItems] = useState<T[]>([]);
  const [loading, setLoading] = useState(Boolean(path));
  const [error, setError] = useState('');

  useEffect(() => {
    if (!path) {
      setItems([]);
      setLoading(false);
      return undefined;
    }
    setLoading(true);
    setError('');
    return onSnapshot(
      collection(db, path),
      (snapshot) => {
        setItems(snapshot.docs.map(withId<T>));
        setLoading(false);
      },
      (err) => {
        setError(friendlyError(err));
        setItems([]);
        setLoading(false);
      },
    );
  }, [path]);

  return { items, loading, error };
}

export function useProgram(programId?: string) {
  const result = useDoc<ProgramDoc>(programId ? `programs/${programId}` : null);
  return { program: result.value, loading: result.loading, error: result.error };
}

/** Only programs owned by the signed-in user are readable by this query. */
export function useMyPrograms(uid?: string) {
  const [items, setItems] = useState<ProgramDoc[]>([]);
  const [loading, setLoading] = useState(Boolean(uid));
  const [error, setError] = useState('');

  useEffect(() => {
    if (!uid) {
      setItems([]);
      setLoading(false);
      return undefined;
    }
    setLoading(true);
    setError('');
    const owned = query(collection(db, 'programs'), where('ownerUid', '==', uid));
    return onSnapshot(
      owned,
      (snapshot) => {
        setItems(snapshot.docs.map(withId<ProgramDoc>));
        setLoading(false);
      },
      (err) => {
        setError(friendlyError(err));
        setItems([]);
        setLoading(false);
      },
    );
  }, [uid]);

  return { programs: items, loading, error };
}

export function useTicketTypes(programId?: string) {
  const result = useCollection<TicketType>(programId ? `programs/${programId}/ticketTypes` : null);
  return { ticketTypes: result.items, loading: result.loading, error: result.error };
}

export function useFormFields(programId?: string, kind: 'registration' | 'feedback' = 'registration') {
  const name = kind === 'feedback' ? 'feedbackFields' : 'formFields';
  const result = useCollection<FormField>(programId ? `programs/${programId}/${name}` : null);
  return { fields: result.items, loading: result.loading, error: result.error };
}

export function usePaymentMethods(programId?: string) {
  const result = useCollection<PaymentMethod>(programId ? `programs/${programId}/paymentMethods` : null);
  return { methods: result.items, loading: result.loading, error: result.error };
}

/** Registrations are private; one listener per program keeps rules simple. */
export function useRegistrationsFor(programIds: string[]) {
  const [items, setItems] = useState<Registration[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const key = programIds.filter(Boolean).sort().join('|');

  useEffect(() => {
    const ids = key ? key.split('|') : [];
    if (!ids.length) {
      setItems([]);
      setLoading(false);
      setError('');
      return undefined;
    }
    setLoading(true);
    setError('');
    const byProgram = new Map<string, Registration[]>();
    const unsubscribers = ids.map((id) =>
      onSnapshot(
        collection(db, `programs/${id}/registrations`),
        (snapshot) => {
          byProgram.set(id, snapshot.docs.map(withId<Registration>));
          setItems(Array.from(byProgram.values()).flat());
          setLoading(false);
        },
        (err) => {
          setError(friendlyError(err));
          setLoading(false);
        },
      ),
    );
    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
  }, [key]);

  return { registrations: items, loading, error };
}

export function useHelperDoc(programId?: string, uid?: string) {
  const result = useDoc<HelperDoc>(programId && uid ? `programs/${programId}/helpers/${uid}` : null);
  return { helper: result.value, loading: result.loading };
}

export function useHelpers(programId?: string) {
  const result = useCollection<HelperDoc>(programId ? `programs/${programId}/helpers` : null);
  return { helpers: result.items, loading: result.loading, error: result.error };
}

export function useProfile(uid?: string) {
  const result = useDoc<UserProfile>(uid ? `users/${uid}` : null);
  return { profile: result.value, loading: result.loading, error: result.error };
}

export function useAnnouncements() {
  const result = useCollection<Announcement>('announcements');
  return { announcements: result.items, loading: result.loading };
}

export function useMessages(conversationId?: string) {
  const result = useCollection<AdminMessageDoc>(conversationId ? `conversations/${conversationId}/messages` : null);
  return { messages: result.items, loading: result.loading, error: result.error };
}
