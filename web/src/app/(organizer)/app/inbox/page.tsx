'use client';

import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { useState, type FormEvent } from 'react';
import { Button, Card, EmptyState, ErrorBanner, Field, LoadingState, SuccessBanner } from '@yivents/ui';
import { useSession } from '@/lib/auth';
import { db } from '@/lib/firebase/client';
import { sendAdminMessage } from '@/components/organizer/callables';
import { useDoc, useMessages } from '@/components/organizer/data';
import { friendlyError } from '@/components/organizer/utils';

interface ConversationDoc {
  id: string;
  organizerUid?: string;
  createdAt?: string;
  updatedAt?: string;
}

export default function AdminInboxPage() {
  const { user, loading: sessionLoading } = useSession();
  const uid = user?.uid;
  const { value: conversation, loading: conversationLoading } = useDoc<ConversationDoc>(uid ? `conversations/${uid}` : null);
  const { messages, loading: messagesLoading } = useMessages(uid);
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');

  if (sessionLoading || conversationLoading || messagesLoading) return <LoadingState label="Loading your messages…" />;
  if (!user) return <EmptyState title="Sign in required" message="Sign in to message the Yivents team." />;

  const send = async (event: FormEvent) => {
    event.preventDefault();
    if (!body.trim()) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      if (!conversation) {
        await setDoc(doc(db, 'conversations', uid), {
          organizerUid: uid,
          createdAt: new Date().toISOString(),
          updatedAt: serverTimestamp(),
        });
      }
      await sendAdminMessage(uid, body.trim());
      setBody('');
      setNotice('Message sent to the Yivents team.');
    } catch (err) {
      setError(friendlyError(err, 'Could not send your message.'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="org-stack">
      <div>
        <h1 style={{ margin: 0 }}>Messages</h1>
        <p className="yv-muted" style={{ margin: '.35rem 0 0' }}>A private thread with the Yivents team about your account or events.</p>
      </div>
      {error ? <ErrorBanner message={error} onDismiss={() => setError('')} /> : null}
      {notice ? <SuccessBanner message={notice} /> : null}
      <Card>
        <p className="org-muted">Never send PINs, passwords or full payment details here.</p>
        {messages.length ? (
          <div style={{ display: 'grid', gap: '.75rem', margin: '1rem 0' }}>
            {messages.map((message) => (
              <article key={message.id} style={{ borderBottom: '1px solid var(--border)', paddingBottom: '.75rem' }}>
                <div className="org-row" style={{ justifyContent: 'space-between' }}>
                  <strong>{message.senderName || (message.senderUid === uid ? 'You' : 'Yivents team')}</strong>
                  <span className="org-muted">{String(message.createdAt ?? message.at ?? '')}</span>
                </div>
                <p style={{ margin: '.35rem 0 0', whiteSpace: 'pre-wrap' }}>{message.body ?? message.text ?? message.message ?? ''}</p>
              </article>
            ))}
          </div>
        ) : <EmptyState title="No messages yet" message="Ask a question below and we will reply here." />}

        <form onSubmit={send}>
          <Field label="Your message" id="admin-message-body">
            <textarea className="org-input" id="admin-message-body" rows={4} value={body} onChange={(event) => setBody(event.target.value)} required />
          </Field>
          <Button type="submit" loading={busy} disabled={!body.trim()}>Send message</Button>
        </form>
      </Card>
    </div>
  );
}
