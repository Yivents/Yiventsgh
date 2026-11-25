'use client';

/** Per-organiser support threads. Announcements are managed on their own screen. */
import Link from 'next/link';
import { useEffect, useState, type ChangeEvent } from 'react';
import { collection, doc, getDoc, limit, orderBy, query } from 'firebase/firestore';
import { Badge, Button, Card, EmptyState, ErrorBanner, Field, LoadingState, Modal, Tabs } from '@yivents/ui';
import { plainTextSchema } from '@yivents/shared';
import { db } from '@/lib/firebase/client';
import { ADMIN_ACTIONS, adminAction, sendAdminMessage, uploadAdminFile, type AdminMessageRequest } from '@/components/admin/adminActions';
import { displayDate, friendlyError, useCollection, useUserMap } from '@/components/admin/adminData';
import { AdminOnly } from '@/components/admin/AdminShell';

interface ConversationRow {
  id: string;
  organizerUid?: string;
  status?: 'open' | 'resolved';
  programId?: string;
  subject?: string;
  lastMessageAt?: string;
  unreadForAdmin?: number;
}

interface MessageRow {
  id: string;
  sender?: string;
  body?: string;
  createdAt?: string;
  readByAdmin?: boolean;
  attachments?: Array<{ name: string; path: string; size?: number; contentType?: string }>;
}

type Filter = 'open' | 'resolved' | 'all';
type Attachment = NonNullable<MessageRow['attachments']>[number];
interface SavedReply { label: string; body: string }

const SAVED_REPLIES_KEY = 'yv_admin_saved_replies';

function Messages() {
  const { rows: conversations, loading, error } = useCollection<ConversationRow>(
    () => query(collection(db, 'conversations'), orderBy('lastMessageAt', 'desc'), limit(200)),
    [],
  );
  const [filter, setFilter] = useState<Filter>('open');
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState('');
  const [body, setBody] = useState('');
  const [pendingAttachments, setPendingAttachments] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [failure, setFailure] = useState('');
  const [checked, setChecked] = useState<string[]>([]);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkBody, setBulkBody] = useState('');
  const [savedReplies, setSavedReplies] = useState<SavedReply[]>([]);
  const [replyLabel, setReplyLabel] = useState('');
  const [programTitle, setProgramTitle] = useState('');

  const messages = useCollection<MessageRow>(
    () => (selectedId ? query(collection(db, 'conversations', selectedId, 'messages'), orderBy('createdAt', 'asc'), limit(300)) : null),
    [selectedId],
  );

  const users = useUserMap(conversations.map((row) => row.organizerUid ?? ''));
  const selected = conversations.find((row) => row.id === selectedId);
  const programId = selected?.programId ?? '';

  useEffect(() => {
    let alive = true;
    if (!programId) {
      setProgramTitle('');
      return;
    }
    getDoc(doc(db, 'programs', programId))
      .then((snap) => {
        if (!alive) return;
        const title = snap.exists() ? snap.data()?.title : '';
        setProgramTitle(typeof title === 'string' && title ? title : programId);
      })
      .catch(() => alive && setProgramTitle(programId));
    return () => {
      alive = false;
    };
  }, [programId]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(SAVED_REPLIES_KEY);
      if (!raw) return;
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        setSavedReplies(parsed.filter((item): item is SavedReply => {
          if (!item || typeof item !== 'object') return false;
          const candidate = item as Partial<SavedReply>;
          return typeof candidate.label === 'string' && typeof candidate.body === 'string';
        }));
      }
    } catch {
      // Local saved replies are optional; ignore malformed browser storage.
    }
  }, []);

  const visible = conversations
    .filter((row) => filter === 'all' || (row.status ?? 'open') === filter)
    .filter((row) => {
      const user = row.organizerUid ? users[row.organizerUid] : undefined;
      const text = `${user?.displayName ?? ''} ${user?.email ?? ''} ${row.organizerUid ?? ''} ${row.subject ?? ''}`.toLowerCase();
      return text.includes(search.trim().toLowerCase());
    });

  const unreadHere = messages.rows.filter((m) => m.sender === 'organizer' && !m.readByAdmin).length;

  function report(err: unknown) {
    setFailure(friendlyError(err, 'The message could not be sent. Please try again.'));
  }

  async function send() {
    if (!selectedId || !plainTextSchema.safeParse(body).success) return;
    setBusy(true);
    setFailure('');
    setNotice('');
    try {
      const request: AdminMessageRequest = {
        conversationId: selectedId,
        body: body.trim(),
        attachments: pendingAttachments,
        programId: programId || undefined,
      };
      await sendAdminMessage(request);
      setBody('');
      setPendingAttachments([]);
      setNotice('Message sent.');
    } catch (err) {
      report(err);
    } finally {
      setBusy(false);
    }
  }

  async function onFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    if (!files.length) return;
    setUploading(true);
    setFailure('');
    try {
      const uploaded = await Promise.all(
        files.map(async (file) => ({
          name: file.name,
          path: await uploadAdminFile(file, 'admin-attachments'),
          size: file.size,
          contentType: file.type,
        })),
      );
      setPendingAttachments((prev) => [...prev, ...uploaded]);
    } catch (err) {
      setFailure(friendlyError(err, 'Upload failed. Use images or videos within the size limit.'));
    } finally {
      setUploading(false);
      event.target.value = '';
    }
  }

  async function setStatus(id: string, status: 'open' | 'resolved') {
    setBusy(true);
    setFailure('');
    try {
      await adminAction({ action: ADMIN_ACTIONS.setConversationStatus, targetId: id, value: status });
      setNotice(`Conversation marked ${status}.`);
    } catch (err) {
      report(err);
    } finally {
      setBusy(false);
    }
  }

  async function bulkSend() {
    if (!plainTextSchema.safeParse(bulkBody).success || !checked.length) return;
    setBusy(true);
    setFailure('');
    try {
      const results = await Promise.allSettled(
        checked.map((id) => sendAdminMessage({ conversationId: id, body: bulkBody.trim() })),
      );
      const sent = results.filter((r) => r.status === 'fulfilled').length;
      setNotice(`Sent to ${sent} of ${checked.length} conversations.`);
      if (sent < checked.length) setFailure('Some messages could not be sent. Check the threads and try again.');
      setBulkOpen(false);
      setBulkBody('');
    } finally {
      setBusy(false);
    }
  }

  function saveReply() {
    if (!replyLabel.trim() || !plainTextSchema.safeParse(body).success) return;
    const next = [...savedReplies.filter((r) => r.label !== replyLabel.trim()), { label: replyLabel.trim(), body: body.trim() }];
    setSavedReplies(next);
    window.localStorage.setItem(SAVED_REPLIES_KEY, JSON.stringify(next));
    setReplyLabel('');
    setNotice('Saved reply stored on this device.');
  }

  return (
    <div className="yv-stack">
      <div className="yv-spread">
        <div>
          <h1>Messages</h1>
          <p className="yv-muted">One conversation per organiser. Open or resolve threads, search, attach image metadata and use saved replies.</p>
        </div>
        <div className="yv-row">
          <Button variant="outline" size="sm" disabled={!checked.length} onClick={() => setBulkOpen(true)}>Message selected ({checked.length})</Button>
          <Link className="yv-btn yv-btn-ghost yv-btn-sm" href="/admin/announcements">Announcements →</Link>
        </div>
      </div>
      <p className="yv-tiny yv-muted">Announcements are broadcast banners and are managed separately; they are not conversation messages.</p>

      {error ? <ErrorBanner message={error} /> : null}
      {notice ? <Card><p>{notice}</p></Card> : null}
      {failure ? <ErrorBanner message={failure} onDismiss={() => setFailure('')} /> : null}

      <div className="yv-row" style={{ alignItems: 'flex-start' }}>
        <div style={{ flex: '1 1 300px' }} className="yv-stack">
          <Field id="message-search" label="Search conversations" hint="Organiser name, email, ID or subject">
            <input id="message-search" value={search} onChange={(e) => setSearch(e.target.value)} />
          </Field>
          <Tabs<Filter>
            tabs={[
              { id: 'open', label: 'Open', count: conversations.filter((c) => c.status === 'open').length },
              { id: 'resolved', label: 'Resolved', count: conversations.filter((c) => c.status === 'resolved').length },
              { id: 'all', label: 'All', count: conversations.length },
            ]}
            active={filter}
            onChange={setFilter}
          />
          {loading ? <LoadingState label="Loading conversations…" /> : null}
          {!loading && !visible.length ? <EmptyState title="No conversations" message={search ? 'No thread matches that search.' : 'No threads in this filter.'} /> : null}
          <div className="yv-stack">
            {visible.map((row) => {
              const user = row.organizerUid ? users[row.organizerUid] : undefined;
              return (
                <Card key={row.id} style={{ borderColor: row.id === selectedId ? 'var(--brand-primary)' : undefined }}>
                  <div className="yv-row" style={{ flexWrap: 'nowrap', alignItems: 'flex-start' }}>
                    <input
                      type="checkbox"
                      aria-label={`Select conversation with ${user?.displayName ?? row.organizerUid ?? row.id}`}
                      checked={checked.includes(row.id)}
                      onChange={(e) => setChecked((prev) => (e.target.checked ? [...prev, row.id] : prev.filter((id) => id !== row.id)))}
                      style={{ flex: '0 0 22px' }}
                    />
                    <div style={{ flex: 1 }}>
                      <button type="button" className="yv-link-button" onClick={() => setSelectedId(row.id)} style={{ textAlign: 'left' }}>
                        {user?.displayName || row.organizerUid || 'Organiser'}
                      </button>
                      <div className="yv-tiny yv-muted">{user?.email || row.id}</div>
                      {row.subject ? <div className="yv-tiny">{row.subject}</div> : null}
                      <div className="yv-tiny yv-muted">Last message {displayDate(row.lastMessageAt)}</div>
                    </div>
                    <div>
                      {Number(row.unreadForAdmin ?? 0) > 0 ? <Badge tone="danger">{row.unreadForAdmin} unread</Badge> : null}
                      <Badge tone={row.status === 'resolved' ? 'success' : 'info'}>{row.status ?? 'open'}</Badge>
                    </div>
                  </div>
                </Card>
              );
            })}
          </div>
        </div>

        <div style={{ flex: '2 1 420px' }} className="yv-stack">
          {!selected ? (
            <EmptyState title="Select a conversation" message="Choose a thread on the left to read and reply." />
          ) : (
            <Card className="yv-stack">
              <div className="yv-spread">
                <div>
                  <h2 style={{ fontSize: '1.15rem' }}>{users[selected.organizerUid ?? '']?.displayName || selected.organizerUid || 'Conversation'}</h2>
                  <p className="yv-tiny yv-muted">
                    {programTitle ? `Linked programme: ${programTitle}` : 'No linked programme'}
                    {unreadHere ? ` · ${unreadHere} unread in thread` : ''}
                  </p>
                </div>
                <Badge tone={selected.status === 'resolved' ? 'success' : 'info'}>{selected.status ?? 'open'}</Badge>
              </div>
              <div className="yv-row">
                <Button size="sm" variant="outline" disabled={busy} onClick={() => setStatus(selected.id, selected.status === 'resolved' ? 'open' : 'resolved')}>
                  Mark {selected.status === 'resolved' ? 'open' : 'resolved'}
                </Button>
                <Link className="yv-btn yv-btn-ghost yv-btn-sm" href={`/admin/view-as/${selected.organizerUid ?? ''}`}>View organiser (read only)</Link>
              </div>

              {messages.loading ? <LoadingState label="Loading messages…" /> : null}
              {!messages.loading && !messages.rows.length ? <EmptyState title="No messages yet" message="Write the first reply below." /> : null}
              <div className="yv-stack">
                {messages.rows.map((message) => (
                  <div key={message.id} style={{ borderLeft: '3px solid var(--border)', paddingLeft: '0.75rem' }}>
                    <p className="yv-tiny yv-muted">{message.sender === 'organizer' ? 'Organiser' : 'Admin'} · {displayDate(message.createdAt)}</p>
                    <p>{message.body || '(attachment only)'}</p>
                    {message.attachments?.length ? (
                      <ul className="yv-tiny yv-muted">
                        {message.attachments.map((attachment, index) => (
                          <li key={index}>{attachment.name} · {attachment.contentType || 'file'} · {typeof attachment.size === 'number' ? `${attachment.size} bytes` : ''}</li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                ))}
              </div>

              <Field id="admin-message-body" label="Reply" hint="Plain text only. HTML is not rendered." error={body && !plainTextSchema.safeParse(body).success ? 'Use plain text only, up to 5000 characters.' : ''}>
                <textarea id="admin-message-body" rows={4} value={body} onChange={(e) => setBody(e.target.value)} />
              </Field>
              <div className="yv-row">
                <label htmlFor="admin-attachments" className="yv-tiny yv-muted">Attach images or videos (metadata shown with the message)</label>
                <input id="admin-attachments" type="file" accept="image/jpeg,image/png,image/webp,video/mp4" multiple onChange={onFiles} />
              </div>
              {pendingAttachments.length ? (
                <ul className="yv-tiny yv-muted">
                  {pendingAttachments.map((attachment, index) => (
                    <li key={index}>
                      {attachment.name}
                      <button type="button" className="yv-link-button" onClick={() => setPendingAttachments((prev) => prev.filter((_, i) => i !== index))}>Remove</button>
                    </li>
                  ))}
                </ul>
              ) : null}
              <div className="yv-row">
                <Button loading={busy || uploading} disabled={!plainTextSchema.safeParse(body).success} onClick={send}>Send reply</Button>
                <select id="saved-reply-picker" aria-label="Insert a saved reply" value="" onChange={(e) => {
                  const saved = savedReplies.find((reply) => reply.label === e.target.value);
                  if (saved) setBody(saved.body);
                }}>
                  <option value="">Insert saved reply…</option>
                  {savedReplies.map((reply) => <option key={reply.label} value={reply.label}>{reply.label}</option>)}
                </select>
                <input aria-label="New saved reply label" value={replyLabel} onChange={(e) => setReplyLabel(e.target.value)} placeholder="Reply name" />
                <Button variant="outline" disabled={!replyLabel.trim() || !plainTextSchema.safeParse(body).success} onClick={saveReply}>Save reply</Button>
              </div>
            </Card>
          )}
        </div>
      </div>

      <Modal open={bulkOpen} title="Group message" onClose={() => setBulkOpen(false)}>
        <div className="yv-stack">
          <p className="yv-muted">Sends a separate plain-text message to each selected conversation. Each send is audited.</p>
          <Field id="bulk-body" label="Message" error={bulkBody && !plainTextSchema.safeParse(bulkBody).success ? 'Use plain text only.' : ''}>
            <textarea id="bulk-body" rows={4} value={bulkBody} onChange={(e) => setBulkBody(e.target.value)} />
          </Field>
          <div className="yv-row">
            <Button loading={busy} disabled={!plainTextSchema.safeParse(bulkBody).success} onClick={bulkSend}>Send to {checked.length} conversations</Button>
            <Button variant="ghost" onClick={() => setBulkOpen(false)}>Cancel</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

export default function AdminMessagesPage() {
  return (
    <AdminOnly allow={['superAdmin', 'support']}>
      <Messages />
    </AdminOnly>
  );
}
