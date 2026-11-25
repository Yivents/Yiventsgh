'use client';

import { useParams } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { EMAIL_BATCH_SIZE } from '@yivents/shared';
import { Button, Card, EmptyState, ErrorBanner, Field, LoadingState, SuccessBanner, WarningBanner } from '@yivents/ui';
import { makeGmailBccLink, makeMailtoBccLink, safeText } from '@/lib/format';
import { useProgram, useRegistrationsFor, useTicketTypes } from '@/components/organizer/data';
import { chunk, copyText, friendlyError } from '@/components/organizer/utils';

type Group = 'everyone' | 'free' | 'paid' | 'approved' | 'pending' | 'unpaid' | `ticket:${string}` | 'selected';

export default function EmailPage() {
  const params = useParams<{ id: string }>();
  const programId = String(params?.id ?? '');
  const { program } = useProgram(programId);
  const { ticketTypes } = useTicketTypes(programId);
  const { registrations, loading, error } = useRegistrationsFor([programId]);
  const [group, setGroup] = useState<Group>('everyone');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [account, setAccount] = useState('');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [notice, setNotice] = useState('');
  const [actionError, setActionError] = useState('');

  // Responses passes selected ids in the query string; reading it here avoids
  // a Suspense boundary in this static route.
  useEffect(() => {
    const ids = new URLSearchParams(window.location.search).get('ids');
    if (ids) {
      const parsed = ids.split(',').filter(Boolean);
      setSelectedIds(parsed);
      setGroup('selected');
    }
  }, []);

  const recipients = useMemo(() => {
    const rows = registrations.filter((row) => {
      if (group === 'everyone') return true;
      if (group === 'free') return row.ticketPricePesewas === 0;
      if (group === 'paid') return row.ticketPricePesewas > 0;
      if (group === 'approved') return row.status === 'verified';
      if (group === 'pending') return row.status === 'pending';
      if (group === 'unpaid') return row.status === 'pending' || !row.payment;
      if (group === 'selected') return selectedIds.includes(row.id);
      return row.ticketTypeId === group.slice(7);
    });
    const emails = rows
      .map((row) => row.contact.email?.trim().toLowerCase())
      .filter((email): email is string => Boolean(email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)));
    return { count: rows.length, emails: Array.from(new Set(emails)) };
  }, [registrations, group, selectedIds]);

  if (loading) return <LoadingState label="Loading recipient groups…" />;
  if (error) return <ErrorBanner message={error} />;

  const safeSubject = safeText(subject.trim()) || `Updates from ${program?.title ?? 'your event'}`;
  const safeBody = safeText(body.trim());
  const batches = chunk(recipients.emails, EMAIL_BATCH_SIZE);

  const copyAll = async () => {
    const ok = await copyText(recipients.emails.join(','));
    setNotice(ok ? `${recipients.emails.length} email address(es) copied.` : 'Could not copy the addresses.');
  };

  return (
    <div className="org-stack">
      <div>
        <h1 style={{ margin: 0 }}>Email participants</h1>
        <p className="yv-muted" style={{ margin: '.35rem 0 0' }}>Send from your own email app. Yivents does not send or store these messages.</p>
      </div>
      <WarningBanner>
        Recipients are always in BCC, never To or CC. We do not track opens, clicks or delivery. Each batch keeps links within email client limits.
      </WarningBanner>
      {notice ? <SuccessBanner message={notice} /> : null}
      {actionError ? <ErrorBanner message={actionError} onDismiss={() => setActionError('')} /> : null}

      <Card>
        <Field label="Recipient group" id="email-group">
          <select className="org-input" id="email-group" value={group} onChange={(event) => setGroup(event.target.value as Group)}>
            <option value="everyone">Everyone</option>
            <option value="free">Free ticket holders</option>
            <option value="paid">Paid ticket holders</option>
            {ticketTypes.map((type) => <option key={type.id} value={`ticket:${type.id}`}>Ticket type: {type.name}</option>)}
            <option value="approved">Approved</option>
            <option value="pending">Pending</option>
            <option value="unpaid">Unpaid / awaiting payment</option>
            <option value="selected">Selected from responses ({selectedIds.length})</option>
          </select>
        </Field>
        <p className="org-muted">{recipients.count} registration(s), {recipients.emails.length} unique email address(es).</p>
        <div className="org-preview-grid">
          <Field label="Subject" id="email-subject">
            <input className="org-input" id="email-subject" value={subject} onChange={(event) => setSubject(event.target.value)} placeholder="Your event update" />
          </Field>
          <Field label="Optional Gmail account" id="email-account" hint="Leave blank to use your default signed-in Gmail account.">
            <input className="org-input" id="email-account" type="email" value={account} onChange={(event) => setAccount(event.target.value)} placeholder="you@gmail.com" />
          </Field>
        </div>
        <Field label="Message" id="email-body">
          <textarea className="org-input" id="email-body" rows={6} value={body} onChange={(event) => setBody(event.target.value)} placeholder="Write your update here. Plain text only." />
        </Field>
        <div className="org-row">
          <Button variant="outline" size="sm" onClick={() => void copyAll()} disabled={!recipients.emails.length}>Copy all emails</Button>
        </div>
      </Card>

      {!recipients.emails.length ? (
        <EmptyState title="No email addresses in this group" message=" Participants without an email are not included. Choose another group or collect emails in your registration form." />
      ) : (
        <Card>
          <h2 style={{ marginTop: 0 }}>Compose in batches of {EMAIL_BATCH_SIZE}</h2>
          <p className="org-muted">If a link is too long for your email app, use the copy fallback above for that batch.</p>
          {batches.map((emails, index) => (
            <div key={index} className="org-row" style={{ justifyContent: 'space-between', borderTop: '1px solid var(--border)', padding: '.75rem 0' }}>
              <div>
                <strong>Send batch {index + 1} of {batches.length}</strong>
                <div className="org-muted">{emails.length} recipient(s) in BCC</div>
              </div>
              <div className="org-row">
                <a className="yv-btn yv-btn-sm yv-btn-primary" href={makeGmailBccLink(safeSubject, safeBody, emails, account.trim())}>Gmail</a>
                <a className="yv-btn yv-btn-sm yv-btn-outline" href={makeMailtoBccLink(safeSubject, safeBody, emails)}>Mail app</a>
                <Button variant="ghost" size="sm" onClick={() => void copyText(emails.join(',')).then((ok) => setNotice(ok ? `Batch ${index + 1} emails copied.` : 'Could not copy the addresses.'))}>Copy</Button>
              </div>
            </div>
          ))}
          <p className="org-muted" style={{ marginTop: '1rem' }}>Fallback: copy a batch, paste it into the BCC field of your own email app, then remove it from your notes.</p>
        </Card>
      )}
    </div>
  );
}
