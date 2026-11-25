'use client';

import { useEffect, useState } from 'react';
import { collection, doc, limit, orderBy, query } from 'firebase/firestore';
import { plainTextSchema } from '@yivents/shared';
import { Button, Card, EmptyState, ErrorBanner, Field, LoadingState, WarningBanner } from '@yivents/ui';
import { db } from '@/lib/firebase/client';
import { ADMIN_ACTIONS, adminAction } from '@/components/admin/adminActions';
import { displayDate, friendlyError, useCollection, useDocument } from '@/components/admin/adminData';
import { AdminOnly } from '@/components/admin/AdminShell';
import { LEGAL_SLUGS } from '@/components/admin/legalContent';

const EDITABLE_SLUGS = [...LEGAL_SLUGS, 'faq'];

function ContentManager() {
  const [slug, setSlug] = useState<string>(LEGAL_SLUGS[0]);
  const [title, setTitle] = useState('');
  const [summary, setSummary] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [failure, setFailure] = useState('');

  const page = useDocument<Record<string, unknown>>(() => doc(db, 'contentPages', slug), [slug]);
  const versions = useCollection<Record<string, unknown>>(
    () => query(collection(db, 'contentPages', slug, 'versions'), orderBy('createdAt', 'desc'), limit(20)),
    [slug],
  );

  useEffect(() => {
    setTitle(typeof page.data?.title === 'string' ? page.data.title : '');
    setSummary(typeof page.data?.summary === 'string' ? page.data.summary : '');
    setBody(typeof page.data?.body === 'string' ? page.data.body : '');
  }, [page.data?.id, slug]);

  const valid = plainTextSchema.safeParse(title).success
    && plainTextSchema.safeParse(summary).success
    && plainTextSchema.safeParse(body).success;
  const currentVersion = String(page.data?.version ?? '');
  const nextVersion = `v${(Number(currentVersion.replace(/\D/g, '')) || 0) + 1}`;

  async function publish() {
    setBusy(true);
    setFailure('');
    setNotice('');
    try {
      await adminAction({
        action: ADMIN_ACTIONS.publishContent,
        targetId: slug,
        payload: { slug, title: title.trim(), summary: summary.trim(), body: body.trim(), version: nextVersion },
      });
      setNotice(`Version ${nextVersion} published. The server re-prompts organisers via contentAcceptances.`);
    } catch (err) {
      setFailure(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="yv-stack">
      <div>
        <h1>Content manager</h1>
        <p className="yv-muted">Edit the plain-text pages served at /legal/[slug]. Publishing creates a version and re-prompts organisers to accept the new text.</p>
      </div>

      {page.error || versions.error ? <ErrorBanner message={page.error || versions.error} /> : null}
      {notice ? <Card><p>{notice}</p></Card> : null}
      {failure ? <ErrorBanner message={failure} onDismiss={() => setFailure('')} /> : null}

      <Field id="content-slug" label="Page">
        <select id="content-slug" value={slug} onChange={(e) => setSlug(e.target.value)}>
          {EDITABLE_SLUGS.map((item) => <option key={item} value={item}>{item}</option>)}
        </select>
      </Field>

      {page.loading || versions.loading ? <LoadingState label="Loading page content…" /> : null}

      <div className="yv-row" style={{ alignItems: 'flex-start' }}>
        <Card className="yv-stack" style={{ flex: '2 1 400px' }}>
          <h2 style={{ fontSize: '1.15rem' }}>{slug} {currentVersion ? <span className="yv-tiny yv-muted">current: {currentVersion}</span> : null}</h2>
          <Field id="content-title" label="Title" required error={title && !plainTextSchema.safeParse(title).success ? 'Use plain text only.' : ''}>
            <input id="content-title" value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <Field id="content-summary" label="Short summary" hint="Shown at the top of the page" error={summary && !plainTextSchema.safeParse(summary).success ? 'Use plain text only.' : ''}>
            <textarea id="content-summary" rows={2} value={summary} onChange={(e) => setSummary(e.target.value)} />
          </Field>
          <Field id="content-body" label="Body" hint="Plain paragraphs separated by a blank line. No HTML." error={body && !plainTextSchema.safeParse(body).success ? 'Use plain text only, up to 5000 characters.' : ''}>
            <textarea id="content-body" rows={14} value={body} onChange={(e) => setBody(e.target.value)} />
          </Field>
          <WarningBanner>Publishing bumps the version. The callable must write the new content plus a copy under versions and reset acceptance records.</WarningBanner>
          <Button loading={busy} disabled={!valid} onClick={publish}>Publish {nextVersion}</Button>
        </Card>

        <Card className="yv-stack" style={{ flex: '1 1 300px' }}>
          <h2 style={{ fontSize: '1.15rem' }}>Preview</h2>
          <h3>{title || 'Page title'}</h3>
          <p className="yv-muted">{summary || 'Short summary appears here.'}</p>
          {(body || 'Page text appears here as plain paragraphs.').split(/\n\s*\n/).map((part, index) => <p key={index}>{part.replace(/\n/g, ' ')}</p>)}
        </Card>
      </div>

      <div className="yv-stack">
        <h2 style={{ fontSize: '1.15rem' }}>Version history</h2>
        {!versions.loading && !versions.rows.length ? <EmptyState title="No saved versions" message="Versions are created when a page is published." /> : null}
        {!versions.loading && versions.rows.length ? (
          <div className="table-wrap">
            <table>
              <thead><tr><th scope="col">Version</th><th scope="col">Date</th><th scope="col">Published by</th><th scope="col">Note</th></tr></thead>
              <tbody>
                {versions.rows.map((version) => (
                  <tr key={version.id}>
                    <td><strong>{String(version.version ?? version.id)}</strong></td>
                    <td className="yv-tiny">{displayDate(version.createdAt ?? version.at)}</td>
                    <td className="yv-tiny">{String(version.publishedBy ?? version.createdBy ?? '—')}</td>
                    <td className="yv-tiny">{String(version.note ?? '')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default function AdminContentPage() {
  return (
    <AdminOnly allow={['superAdmin']}>
      <ContentManager />
    </AdminOnly>
  );
}
