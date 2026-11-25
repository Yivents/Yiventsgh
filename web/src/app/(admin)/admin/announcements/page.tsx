'use client';

/** Banner builder. Text stays plain; the contrast gate uses the shared helper. */
import { useEffect, useState, type ChangeEvent, type CSSProperties } from 'react';
import { collection, limit, orderBy, query } from 'firebase/firestore';
import { contrastRatio, plainTextSchema, type Announcement as SharedAnnouncement } from '@yivents/shared';
import { Badge, Button, Card, EmptyState, ErrorBanner, Field, LoadingState, WarningBanner } from '@yivents/ui';
import { storageUrl } from '@/lib/firebase/client';
import { ADMIN_ACTIONS, adminAction, uploadAdminFile } from '@/components/admin/adminActions';
import { displayDate, friendlyError, useCollection } from '@/components/admin/adminData';
import { AdminOnly, useAdmin } from '@/components/admin/AdminShell';

type BannerType = SharedAnnouncement['type'];
type BannerTarget = SharedAnnouncement['target'];
type SharedFont = SharedAnnouncement['font'];

interface CuratedFont {
  id: string;
  label: string;
  font: SharedFont;
  family: string;
}

/** Eight curated families. `font` uses the shared enum; `family` is the CSS stack for the preview. */
const CURATED_FONTS: CuratedFont[] = [
  { id: 'inter', label: 'Inter', font: 'inter', family: "'Inter', system-ui, sans-serif" },
  { id: 'inter-compact', label: 'Inter Compact', font: 'inter', family: "'Inter', 'Segoe UI', sans-serif" },
  { id: 'jakarta', label: 'Plus Jakarta Sans', font: 'jakarta', family: "'Plus Jakarta Sans', sans-serif" },
  { id: 'jakarta-display', label: 'Jakarta Display', font: 'jakarta', family: "'Plus Jakarta Sans', 'Trebuchet MS', sans-serif" },
  { id: 'georgia', label: 'Georgia', font: 'serif', family: "Georgia, 'Times New Roman', serif" },
  { id: 'times', label: 'Times Classic', font: 'serif', family: "'Times New Roman', serif" },
  { id: 'system', label: 'System UI', font: 'system', family: 'system-ui, -apple-system, sans-serif' },
  { id: 'trebuchet', label: 'Trebuchet', font: 'system', family: "'Trebuchet MS', Arial, sans-serif" },
];

function toLocalInput(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function displayLocal(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : displayDate(date.toISOString());
}

function Announcements() {
  const { user } = useAdmin();
  const { rows, loading, error } = useCollection<Record<string, unknown>>(
    () => query(collection(db, 'announcements'), orderBy('startAt', 'desc'), limit(50)),
    [],
  );
  const [editingId, setEditingId] = useState('');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [type, setType] = useState<BannerType>('info');
  const [startAt, setStartAt] = useState(() => toLocalInput(new Date().toISOString()));
  const [endAt, setEndAt] = useState(() => toLocalInput(new Date(Date.now() + 7 * 86_400_000).toISOString()));
  const [target, setTarget] = useState<BannerTarget>('both');
  const [fontId, setFontId] = useState('inter');
  const [bgColor, setBgColor] = useState('#EAF1FA');
  const [bgImagePath, setBgImagePath] = useState('');
  const [mobileImagePath, setMobileImagePath] = useState('');
  const [dismissible, setDismissible] = useState(true);
  const [previewMobile, setPreviewMobile] = useState(false);
  const [bgUrl, setBgUrl] = useState('');
  const [mobileUrl, setMobileUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [failure, setFailure] = useState('');

  const font = CURATED_FONTS.find((item) => item.id === fontId) ?? CURATED_FONTS[0];
  // Pick the readable text colour automatically, then require WCAG AA (4.5:1).
  const textColor = contrastRatio(bgColor, '#14213D') >= contrastRatio(bgColor, '#FFFFFF') ? '#14213D' : '#FFFFFF';
  const ratio = contrastRatio(bgColor, textColor);
  const contrastOk = ratio >= 4.5;
  const datesOk = Boolean(startAt && endAt && new Date(startAt).getTime() < new Date(endAt).getTime());
  const textOk = plainTextSchema.safeParse(title).success && plainTextSchema.safeParse(body).success;
  const effectiveDismissible = type === 'urgent' ? false : dismissible;

  useEffect(() => {
    let alive = true;
    storageUrl(bgImagePath)
      .then((url) => alive && setBgUrl(url ?? ''))
      .catch(() => alive && setBgUrl(''));
    return () => {
      alive = false;
    };
  }, [bgImagePath]);

  useEffect(() => {
    let alive = true;
    storageUrl(mobileImagePath)
      .then((url) => alive && setMobileUrl(url ?? ''))
      .catch(() => alive && setMobileUrl(''));
    return () => {
      alive = false;
    };
  }, [mobileImagePath]);

  async function upload(event: ChangeEvent<HTMLInputElement>, setter: (path: string) => void) {
    const file = event.target.files?.[0];
    if (!file) return;
    setFailure('');
    try {
      setter(await uploadAdminFile(file, 'announcements'));
      setNotice('Image uploaded. Preview updated.');
    } catch (err) {
      setFailure(friendlyError(err, 'Image upload failed. Use a JPEG, PNG or WebP within the size limit.'));
    } finally {
      event.target.value = '';
    }
  }

  function reset() {
    setEditingId('');
    setTitle('');
    setBody('');
    setType('info');
    setTarget('both');
    setFontId('inter');
    setBgColor('#EAF1FA');
    setBgImagePath('');
    setMobileImagePath('');
    setDismissible(true);
  }

  async function save() {
    setBusy(true);
    setFailure('');
    setNotice('');
    try {
      await adminAction({
        action: ADMIN_ACTIONS.saveAnnouncement,
        targetId: editingId || undefined,
        payload: {
          title: title.trim(),
          body: body.trim(),
          type,
          startAt: new Date(startAt).toISOString(),
          endAt: new Date(endAt).toISOString(),
          target,
          dismissible: effectiveDismissible,
          font: font.font,
          fontFamily: font.family,
          bgColor,
          bgImagePath: bgImagePath || undefined,
          mobileImagePath: mobileImagePath || undefined,
          contrastChecked: true,
          textColor,
        },
      });
      setNotice(editingId ? 'Announcement updated.' : 'Announcement saved.');
      reset();
    } catch (err) {
      setFailure(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setBusy(true);
    setFailure('');
    try {
      await adminAction({ action: ADMIN_ACTIONS.deleteAnnouncement, targetId: id });
      setNotice('Announcement deleted.');
      if (editingId === id) reset();
    } catch (err) {
      setFailure(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }

  const previewStyle: CSSProperties = {
    backgroundColor: bgColor,
    color: textColor,
    fontFamily: font.family,
    borderRadius: 'var(--radius)',
    padding: '1.25rem',
    backgroundImage: previewMobile && mobileUrl ? `url(${mobileUrl})` : !previewMobile && bgUrl ? `url(${bgUrl})` : undefined,
    backgroundSize: 'cover',
    backgroundPosition: 'center',
    textShadow: previewMobile && mobileUrl || bgUrl ? '0 1px 3px rgba(0,0,0,.55)' : undefined,
  };

  return (
    <div className="yv-stack">
      <div>
        <h1>Announcements</h1>
        <p className="yv-muted">Plain-text banners with scheduling, targeting, curated fonts and an automatic contrast check. Urgent banners cannot be dismissed.</p>
      </div>

      {error ? <ErrorBanner message={error} /> : null}
      {notice ? <Card><p>{notice}</p></Card> : null}
      {failure ? <ErrorBanner message={failure} onDismiss={() => setFailure('')} /> : null}

      <div className="yv-row" style={{ alignItems: 'flex-start' }}>
        <Card className="yv-stack" style={{ flex: '1 1 420px' }}>
          <div className="yv-spread">
            <h2 style={{ fontSize: '1.15rem' }}>{editingId ? 'Edit banner' : 'New banner'}</h2>
            {editingId ? <Button size="sm" variant="ghost" onClick={reset}>Clear</Button> : null}
          </div>

          <Field id="announcement-title" label="Title" required error={title && !plainTextSchema.safeParse(title).success ? 'Use plain text only.' : ''}>
            <input id="announcement-title" value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <Field id="announcement-body" label="Text" required error={body && !plainTextSchema.safeParse(body).success ? 'Use plain text only, up to 5000 characters.' : ''}>
            <textarea id="announcement-body" rows={3} value={body} onChange={(e) => setBody(e.target.value)} />
          </Field>
          <div className="yv-row" style={{ alignItems: 'flex-end' }}>
            <div style={{ flex: '1 1 150px' }}>
              <Field id="announcement-type" label="Type">
                <select id="announcement-type" value={type} onChange={(e) => { setType(e.target.value as BannerType); if (e.target.value === 'urgent') setDismissible(false); }}>
                  <option value="info">Info</option>
                  <option value="warning">Warning</option>
                  <option value="urgent">Urgent</option>
                </select>
              </Field>
            </div>
            <div style={{ flex: '1 1 150px' }}>
              <Field id="announcement-target" label="Target">
                <select id="announcement-target" value={target} onChange={(e) => setTarget(e.target.value as BannerTarget)}>
                  <option value="organizers">Organisers</option>
                  <option value="homepage">Homepage</option>
                  <option value="both">Both</option>
                </select>
              </Field>
            </div>
          </div>
          <div className="yv-row" style={{ alignItems: 'flex-end' }}>
            <div style={{ flex: '1 1 190px' }}>
              <Field id="announcement-start" label="Starts" required error={!datesOk ? 'Start must be before the end date.' : ''}>
                <input id="announcement-start" type="datetime-local" value={startAt} onChange={(e) => setStartAt(e.target.value)} />
              </Field>
            </div>
            <div style={{ flex: '1 1 190px' }}>
              <Field id="announcement-end" label="Ends" required>
                <input id="announcement-end" type="datetime-local" value={endAt} onChange={(e) => setEndAt(e.target.value)} />
              </Field>
            </div>
          </div>
          <Field id="announcement-font" label="Font" hint="Curated font families; the stored value stays within the shared enum">
            <select id="announcement-font" value={fontId} onChange={(e) => setFontId(e.target.value)}>
              {CURATED_FONTS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
          </Field>
          <Field id="announcement-color" label="Background colour">
            <div className="yv-row">
              <input id="announcement-color" type="color" value={bgColor} onChange={(e) => setBgColor(e.target.value)} style={{ width: 80, minWidth: 80 }} />
              <input aria-label="Background colour hex value" value={bgColor} onChange={(e) => setBgColor(e.target.value)} pattern="#[0-9a-fA-F]{6}" />
            </div>
          </Field>
          <Field id="announcement-bg-image" label="Background image" hint="Optional. Stored as a Storage path; contrast over images needs a manual look.">
            <input id="announcement-bg-image" value={bgImagePath} onChange={(e) => setBgImagePath(e.target.value)} placeholder="uploads/…/announcements/banner.webp" />
            <input aria-label="Upload background image" type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => upload(e, setBgImagePath)} />
          </Field>
          <Field id="announcement-mobile-image" label="Mobile background image" hint="Optional alternative for small screens.">
            <input id="announcement-mobile-image" value={mobileImagePath} onChange={(e) => setMobileImagePath(e.target.value)} />
            <input aria-label="Upload mobile background image" type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => upload(e, setMobileImagePath)} />
          </Field>
          <div className="yv-row">
            <input
              id="announcement-dismissible"
              type="checkbox"
              checked={effectiveDismissible}
              disabled={type === 'urgent'}
              onChange={(e) => setDismissible(e.target.checked)}
            />
            <label htmlFor="announcement-dismissible" style={{ margin: 0 }}>Dismissible{type === 'urgent' ? ' — urgent banners are always non-dismissible' : ''}</label>
          </div>
          <div className="yv-row">
            <Badge tone={contrastOk ? 'success' : 'danger'}>Contrast {ratio.toFixed(2)}:1 {contrastOk ? '(AA pass)' : '(below 4.5:1)'}</Badge>
            {bgUrl || mobileUrl ? <span className="yv-tiny yv-muted">Check text legibility over the image yourself.</span> : null}
          </div>
          <Button loading={busy} disabled={!textOk || !datesOk || !contrastOk} onClick={save}>
            {editingId ? 'Save changes' : 'Save announcement'}
          </Button>
        </Card>

        <Card className="yv-stack" style={{ flex: '1 1 320px' }}>
          <div className="yv-spread">
            <h2 style={{ fontSize: '1.15rem' }}>Live preview</h2>
            <div className="yv-row">
              <Button size="sm" variant={previewMobile ? 'outline' : 'primary'} onClick={() => setPreviewMobile(false)}>Desktop</Button>
              <Button size="sm" variant={previewMobile ? 'primary' : 'outline'} onClick={() => setPreviewMobile(true)}>Mobile</Button>
            </div>
          </div>
          <div style={previewStyle}>
            <Badge tone={type === 'urgent' ? 'danger' : type === 'warning' ? 'warning' : 'info'}>{type}</Badge>
            <h3 style={{ marginTop: '0.6rem' }}>{title || 'Banner title'}</h3>
            {(body || 'Banner text appears here as plain paragraphs.').split(/\n\s*\n/).map((part, index) => <p key={index}>{part.replace(/\n/g, ' ')}</p>)}
            {effectiveDismissible ? <p className="yv-tiny">Dismissible</p> : <p className="yv-tiny">Not dismissible</p>}
          </div>
          <p className="yv-tiny yv-muted">
            Window: {displayLocal(startAt)} to {displayLocal(endAt)} · Target: {target}
          </p>
          <WarningBanner>Plain text only. No raw HTML is accepted or rendered.</WarningBanner>
        </Card>
      </div>

      <div className="yv-stack">
        <h2 style={{ fontSize: '1.15rem' }}>Scheduled and past banners</h2>
        {loading ? <LoadingState label="Loading announcements…" /> : null}
        {!loading && !rows.length ? <EmptyState title="No announcements" message="Saved banners appear here." /> : null}
        {!loading && rows.length ? (
          <div className="table-wrap">
            <table>
              <thead><tr><th scope="col">Title</th><th scope="col">Type</th><th scope="col">Window</th><th scope="col">Target</th><th scope="col">Actions</th></tr></thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td><strong>{String(row.title ?? 'Untitled')}</strong><div className="yv-tiny yv-muted">{String(row.body ?? '').slice(0, 80)}</div></td>
                    <td><Badge tone={row.type === 'urgent' ? 'danger' : row.type === 'warning' ? 'warning' : 'info'}>{String(row.type ?? 'info')}</Badge></td>
                    <td className="yv-tiny">{displayDate(row.startAt)} → {displayDate(row.endAt)}</td>
                    <td className="yv-tiny">{String(row.target ?? '—')}</td>
                    <td>
                      <div className="yv-row">
                        <Button size="sm" variant="outline" onClick={() => {
                          setEditingId(row.id);
                          setTitle(String(row.title ?? ''));
                          setBody(String(row.body ?? ''));
                          setType((row.type as BannerType) ?? 'info');
                          setTarget((row.target as BannerTarget) ?? 'both');
                          setStartAt(toLocalInput(String(row.startAt ?? new Date().toISOString())));
                          setEndAt(toLocalInput(String(row.endAt ?? new Date().toISOString())));
                          setDismissible(row.dismissible !== false);
                          setBgColor(String(row.bgColor ?? '#EAF1FA'));
                          setBgImagePath(String(row.bgImagePath ?? ''));
                          setMobileImagePath(String(row.mobileImagePath ?? ''));
                          const matched = CURATED_FONTS.find((item) => item.font === row.font);
                          if (matched) setFontId(matched.id);
                        }}>Edit</Button>
                        <Button size="sm" variant="danger" disabled={busy} onClick={() => remove(row.id)}>Delete</Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </div>
      <p className="yv-tiny yv-muted">Signed in as {user.email}. Changes are audit-logged by adminAction.</p>
    </div>
  );
}

export default function AdminAnnouncementsPage() {
  return (
    <AdminOnly allow={['superAdmin']}>
      <Announcements />
    </AdminOnly>
  );
}
