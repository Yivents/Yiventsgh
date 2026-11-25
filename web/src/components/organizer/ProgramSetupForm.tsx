'use client';

/** Full private program setup: branding, media, date, visibility, capacity and share link. */
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import QRCode from 'qrcode';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';
import { MAX_SLIDESHOW_IMAGES, plainTextSchema, type Branding, type EventMode, type Visibility } from '@yivents/shared';
import { Badge, Button, Card, ErrorBanner, Field, LoadingState, SuccessBanner, WarningBanner } from '@yivents/ui';
import type { SessionUser } from '@/lib/auth';
import { db, storageUrl } from '@/lib/firebase/client';
import { useTicketTypes } from './data';
import { changeSlug, createProgram, patchProgram } from './program';
import { suggestLogoColors, uploadImage } from './upload';
import { SPONSOR_LIMIT_FALLBACK, copyText, downloadDataUrl, friendlyError, publicProgramUrl, toDateTimeLocal, fromDateTimeLocal } from './utils';

interface SetupState {
  title: string;
  description: string;
  slug: string;
  startLocal: string;
  endLocal: string;
  deadlineLocal: string;
  venue: string;
  mapsUrl: string;
  mode: EventMode;
  visibility: Visibility;
  capacityOverall: string;
  almostFull: string;
  perCapacity: Record<string, string>;
  primaryColor: string;
  accentColor: string;
  backgroundColor: string;
  themePreset: Branding['themePreset'];
  font: Branding['font'];
  logoPath?: string;
  bannerPath?: string;
  slideshow: string[];
  speakers: Array<{ name: string; topic?: string; time?: string; notes?: string; photoPath?: string }>;
  sponsors: Array<{ name: string; logoPath?: string; url?: string }>;
}

function initialState(program?: ProgramDocForSetup): SetupState {
  if (!program) {
    return {
      title: '',
      description: '',
      slug: '',
      startLocal: toDateTimeLocal(new Date(Date.now() + 86400000).toISOString()),
      endLocal: '',
      deadlineLocal: toDateTimeLocal(new Date(Date.now() + 43200000).toISOString()),
      venue: '',
      mapsUrl: '',
      mode: 'in_person',
      visibility: 'link_only',
      capacityOverall: '',
      almostFull: '0.1',
      perCapacity: {},
      primaryColor: '#104080',
      accentColor: '#F2A93B',
      backgroundColor: '#FFFFFF',
      themePreset: 'logo',
      font: 'inter',
      slideshow: [],
      speakers: [],
      sponsors: [],
    };
  }
  const capacity: Record<string, string> = {};
  Object.entries(program.capacity.perTicketType).forEach(([id, value]) => {
    capacity[id] = String(value);
  });
  return {
    title: program.title,
    description: program.description,
    slug: program.slug,
    startLocal: toDateTimeLocal(program.event.startAt),
    endLocal: toDateTimeLocal(program.event.endAt),
    deadlineLocal: toDateTimeLocal(program.registrationDeadline),
    venue: program.event.venue ?? '',
    mapsUrl: program.event.mapsUrl ?? '',
    mode: program.event.mode,
    visibility: program.visibility,
    capacityOverall: program.capacity.overall ? String(program.capacity.overall) : '',
    almostFull: String(program.capacity.almostFullThreshold),
    perCapacity: capacity,
    primaryColor: program.branding.primaryColor,
    accentColor: program.branding.accentColor,
    backgroundColor: program.branding.backgroundColor,
    themePreset: program.branding.themePreset,
    font: program.branding.font,
    logoPath: program.branding.logoPath,
    bannerPath: program.branding.bannerPath,
    slideshow: program.slideshow,
    speakers: program.speakers.map((item) => ({ ...item })),
    sponsors: program.sponsors.map((item) => ({ ...item })),
  };
}

// Local alias keeps the form independent of the hook's extended settings type.
type ProgramDocForSetup = import('./types').ProgramDoc;

export function ProgramSetupForm({ program, user }: { program?: ProgramDocForSetup; user: SessionUser }) {
  const router = useRouter();
  const programId = program?.id;
  const { ticketTypes } = useTicketTypes(programId);
  const [state, setState] = useState<SetupState>(() => initialState(program));
  const [savedSlug, setSavedSlug] = useState(program?.slug ?? '');
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({});
  const [sponsorLimit, setSponsorLimit] = useState(SPONSOR_LIMIT_FALLBACK);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const set = <K extends keyof SetupState>(key: K, value: SetupState[K]) =>
    setState((current) => ({ ...current, [key]: value }));

  useEffect(() => {
    let alive = true;
    getDoc(doc(db, 'publicSettings', 'platform'))
      .then((snapshot) => {
        const limit = snapshot.data()?.planLimits?.sponsorsMax;
        if (alive && typeof limit === 'number' && limit > 0) setSponsorLimit(limit);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  const allPaths = useMemo(
    () => [
      state.logoPath,
      state.bannerPath,
      ...state.slideshow,
      ...state.speakers.map((item) => item.photoPath),
      ...state.sponsors.map((item) => item.logoPath),
    ].filter((path): path is string => Boolean(path)),
    [state.logoPath, state.bannerPath, state.slideshow, state.speakers, state.sponsors],
  );
  const pathsKey = JSON.stringify(allPaths);
  useEffect(() => {
    const paths = JSON.parse(pathsKey) as string[];
    let alive = true;
    Promise.all(
      paths.map(async (path) => {
        try {
          return [path, await storageUrl(path)] as const;
        } catch {
          return [path, ''] as const;
        }
      }),
    ).then((entries) => {
      if (!alive) return;
      const urls: Record<string, string> = {};
      entries.forEach(([path, url]) => {
        if (url) urls[path] = url;
      });
      setImageUrls(urls);
    });
    return () => {
      alive = false;
    };
  }, [pathsKey]);

  const upload = async (kind: string, file: File): Promise<string> => {
    const targetId = programId ?? 'draft';
    const { path } = await uploadImage(user.uid, targetId, kind, file);
    const url = await storageUrl(path);
    if (url) setImageUrls((current) => ({ ...current, [path]: url }));
    return path;
  };

  const uploadLogo = async (file: File) => {
    setBusy(true);
    setError('');
    try {
      // Auto-suggest from the logo; every colour stays manually editable.
      const suggested = await suggestLogoColors(file);
      const path = await upload('logo', file);
      set((current) => ({ ...current, logoPath: path, ...suggested }));
      setNotice('Logo uploaded. Suggested colours were filled in — change them if you like.');
    } catch (err) {
      setError(friendlyError(err, 'The logo could not be uploaded.'));
    } finally {
      setBusy(false);
    }
  };

  const uploadFlyer = async (file: File) => {
    setBusy(true);
    setError('');
    try {
      const path = await upload('flyer', file);
      setState((current) => ({
        ...current,
        slideshow: [path, ...current.slideshow.filter((item) => item !== current.slideshow[0])].slice(0, MAX_SLIDESHOW_IMAGES),
      }));
    } catch (err) {
      setError(friendlyError(err, 'The flyer could not be uploaded.'));
    } finally {
      setBusy(false);
    }
  };

  const addSlides = async (files: FileList | null) => {
    if (!files?.length) return;
    setBusy(true);
    setError('');
    try {
      const room = MAX_SLIDESHOW_IMAGES - state.slideshow.length;
      if (room <= 0) {
        setError(`A slideshow can hold at most ${MAX_SLIDESHOW_IMAGES} images. Remove one first.`);
        return;
      }
      for (const file of Array.from(files).slice(0, room)) {
        const path = await upload(`slide-${Date.now()}`, file);
        setState((current) => ({ ...current, slideshow: [...current.slideshow, path].slice(0, MAX_SLIDESHOW_IMAGES) }));
      }
    } catch (err) {
      setError(friendlyError(err, 'The images could not be uploaded.'));
    } finally {
      setBusy(false);
    }
  };

  const updateSpeaker = (index: number, patch: Partial<SetupState['speakers'][number]>) =>
    setState((current) => ({
      ...current,
      speakers: current.speakers.map((item, i) => (i === index ? { ...item, ...patch } : item)),
    }));
  const updateSponsor = (index: number, patch: Partial<SetupState['sponsors'][number]>) =>
    setState((current) => ({
      ...current,
      sponsors: current.sponsors.map((item, i) => (i === index ? { ...item, ...patch } : item)),
    }));

  const save = async () => {
    setError('');
    setNotice('');
    const parsedDescription = plainTextSchema.safeParse(state.description);
    if (!parsedDescription.success) {
      setError(parsedDescription.error.issues[0]?.message ?? 'Enter a plain-text description.');
      return;
    }
    if (!state.title.trim()) {
      setError('Add an event title.');
      return;
    }
    const startAt = fromDateTimeLocal(state.startLocal);
    const endAt = state.endLocal ? fromDateTimeLocal(state.endLocal) : null;
    const deadline = fromDateTimeLocal(state.deadlineLocal);
    if (!startAt || !deadline) {
      setError('Choose a valid start date/time and registration deadline.');
      return;
    }
    if (endAt && new Date(endAt) < new Date(startAt)) {
      setError('The end date/time cannot be before the start.');
      return;
    }
    if (new Date(deadline) > new Date(startAt)) {
      setError('The registration deadline must be before the event starts.');
      return;
    }
    if (state.mapsUrl.trim()) {
      try {
        const parsed = new URL(state.mapsUrl.trim());
        if (!/google\.com\/maps|goo\.gl\/maps/i.test(parsed.href)) throw new Error('Use a Google Maps link.');
      } catch {
        setError('Enter a valid Google Maps link, or leave it blank.');
        return;
      }
    }

    setBusy(true);
    try {
      let id = programId;
      if (!id) {
        id = await createProgram(user.uid, state.title, state.slug || state.title);
      }
      const slug = await changeSlug(id, state.slug || state.title, program?.slug ?? '');
      const perTicketType: Record<string, number> = {};
      Object.entries(state.perCapacity).forEach(([key, value]) => {
        const capacityValue = Number(value);
        if (Number.isFinite(capacityValue) && capacityValue > 0) perTicketType[key] = Math.round(capacityValue);
      });
      const overall = Number(state.capacityOverall);
      const threshold = Number(state.almostFull);
      const approvalStatus = state.visibility === 'public' && program?.visibility !== 'public' ? 'pending' : program?.approvalStatus ?? 'not_required';

      await patchProgram(id, {
        title: state.title.trim(),
        description: parsedDescription.data,
        slug,
        visibility: state.visibility,
        approvalStatus,
        event: {
          startAt,
          ...(endAt ? { endAt } : {}),
          timezone: 'Africa/Accra',
          ...(state.venue.trim() ? { venue: state.venue.trim() } : {}),
          ...(state.mapsUrl.trim() ? { mapsUrl: state.mapsUrl.trim() } : {}),
          mode: state.mode,
        },
        registrationDeadline: deadline,
        branding: {
          ...(state.logoPath ? { logoPath: state.logoPath } : {}),
          ...(state.bannerPath ? { bannerPath: state.bannerPath } : {}),
          primaryColor: state.primaryColor,
          accentColor: state.accentColor,
          backgroundColor: state.backgroundColor,
          themePreset: state.themePreset,
          font: state.font,
        },
        slideshow: state.slideshow.slice(0, MAX_SLIDESHOW_IMAGES),
        speakers: state.speakers.filter((item) => item.name.trim()),
        sponsors: state.sponsors.filter((item) => item.name.trim()),
        capacity: {
          ...(Number.isFinite(overall) && overall > 0 ? { overall: Math.round(overall) } : {}),
          perTicketType,
          almostFullThreshold: Number.isFinite(threshold) && threshold >= 0 ? threshold : 0.1,
        },
      });

      for (const type of ticketTypes) {
        if (state.perCapacity[type.id] !== undefined) {
          await updateDoc(doc(db, 'programs', id, 'ticketTypes', type.id), {
            capacity: perTicketType[type.id] ?? 0,
          });
        }
      }

      setSavedSlug(slug);
      setNotice('Program saved.');
      if (!programId) router.replace(`/app/programs/${id}/setup`);
    } catch (err) {
      setError(friendlyError(err, 'Could not save the program. Please try again.'));
    } finally {
      setBusy(false);
    }
  };

  const downloadQr = async () => {
    if (!savedSlug) {
      setError('Save the program before downloading a QR code.');
      return;
    }
    try {
      const dataUrl = await QRCode.toDataURL(publicProgramUrl(savedSlug), {
        width: 512,
        margin: 2,
        errorCorrectionLevel: 'M',
      });
      downloadDataUrl(dataUrl, `${savedSlug}-qr.png`);
    } catch {
      setError('Could not create the QR code. Please try again.');
    }
  };

  const multiDay = Boolean(state.endLocal && state.endLocal.slice(0, 10) !== state.startLocal.slice(0, 10));

  return (
    <div className="org-stack">
      {error ? <ErrorBanner message={error} onDismiss={() => setError('')} /> : null}
      {notice ? <SuccessBanner message={notice} /> : null}

      <Card>
        <h2 style={{ marginTop: 0 }}>Basics</h2>
        <Field label="Event title" id="setup-title" required>
          <input className="org-input" id="setup-title" value={state.title} onChange={(event) => set('title', event.target.value)} />
        </Field>
        <Field label="Description" id="setup-description" hint="Plain text only — no HTML">
          <textarea className="org-input" id="setup-description" rows={5} value={state.description} onChange={(event) => set('description', event.target.value)} />
        </Field>
        <Field label="Custom share link" id="setup-slug" hint="Short and easy to share. We check that it is free when you save.">
          <input className="org-input" id="setup-slug" value={state.slug} onChange={(event) => set('slug', event.target.value)} placeholder="e.g. accra-tech-night" />
        </Field>
        <div className="org-row">
          <Button variant="outline" size="sm" onClick={() => void copyText(publicProgramUrl(savedSlug || state.slug)).then((ok) => setNotice(ok ? 'Share link copied.' : 'Could not copy the link.'))}>
            Copy share link
          </Button>
          <Button variant="outline" size="sm" onClick={() => void downloadQr()}>Download QR code</Button>
          {savedSlug ? <span className="org-muted">{publicProgramUrl(savedSlug)}</span> : null}
        </div>
      </Card>

      <Card>
        <h2 style={{ marginTop: 0 }}>Branding and media</h2>
        <div className="org-preview-grid">
          <div>
            <Field label="Logo" id="setup-logo" hint="JPEG, PNG or WebP. Colours are suggested from the image.">
              <input id="setup-logo" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void uploadLogo(file);
              }} />
            </Field>
            {state.logoPath && imageUrls[state.logoPath] ? <img src={imageUrls[state.logoPath]} alt="Event logo" style={{ maxHeight: 90 }} /> : null}
            <div className="org-row">
              <Field label="Primary colour" id="setup-primary"><input id="setup-primary" type="color" value={state.primaryColor} onChange={(event) => set('primaryColor', event.target.value)} /></Field>
              <Field label="Accent colour" id="setup-accent"><input id="setup-accent" type="color" value={state.accentColor} onChange={(event) => set('accentColor', event.target.value)} /></Field>
              <Field label="Background" id="setup-bg"><input id="setup-bg" type="color" value={state.backgroundColor} onChange={(event) => set('backgroundColor', event.target.value)} /></Field>
            </div>
            <div className="org-row">
              <Field label="Theme preset" id="setup-theme">
                <select id="setup-theme" className="org-input" value={state.themePreset} onChange={(event) => set('themePreset', event.target.value as Branding['themePreset'])}>
                  <option value="logo">From logo</option><option value="ocean">Ocean</option><option value="warm">Warm</option><option value="mint">Mint</option>
                </select>
              </Field>
              <Field label="Font" id="setup-font">
                <select id="setup-font" className="org-input" value={state.font} onChange={(event) => set('font', event.target.value as Branding['font'])}>
                  <option value="inter">Inter</option><option value="jakarta">Plus Jakarta Sans</option><option value="serif">Serif</option>
                </select>
              </Field>
            </div>
            <Field label="Banner image" id="setup-banner">
              <input id="setup-banner" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void upload('banner', file).then((path) => set('bannerPath', path)).catch((err) => setError(friendlyError(err)));
              }} />
            </Field>
          </div>
          <div>
            <h3 style={{ marginTop: 0 }}>Slideshow (flyer first, up to 8)</h3>
            <Field label="Flyer" id="setup-flyer">
              <input id="setup-flyer" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void uploadFlyer(file);
              }} />
            </Field>
            <Field label="Add more images" id="setup-slides">
              <input id="setup-slides" type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={(event) => void addSlides(event.target.files)} />
            </Field>
            <div className="org-swipe" aria-label="Slideshow preview, swipe horizontally">
              {state.slideshow.map((path, index) => (
                <figure key={`${path}-${index}`}>
                  {imageUrls[path] ? <img src={imageUrls[path]} alt={`Slide ${index + 1}`} /> : <div className="org-muted">Loading image…</div>}
                  <figcaption className="org-row" style={{ justifyContent: 'space-between' }}>
                    <span className="org-muted">{index === 0 ? 'Flyer' : `Slide ${index + 1}`}</span>
                    <button
                      type="button"
                      className="yv-link-button"
                      disabled={index === 0}
                      onClick={() => setState((current) => ({ ...current, slideshow: current.slideshow.filter((_, i) => i !== index) }))}
                    >
                      Remove
                    </button>
                  </figcaption>
                </figure>
              ))}
            </div>
          </div>
        </div>
      </Card>

      <Card>
        <h2 style={{ marginTop: 0 }}>When and where</h2>
        <div className="org-preview-grid">
          <Field label="Starts" id="setup-start" required>
            <input className="org-input" id="setup-start" type="datetime-local" value={state.startLocal} onChange={(event) => set('startLocal', event.target.value)} required />
          </Field>
          <Field label="Ends (optional)" id="setup-end" hint={multiDay ? 'This is a multi-day event.' : 'Leave blank for a single session.'}>
            <input className="org-input" id="setup-end" type="datetime-local" value={state.endLocal} onChange={(event) => set('endLocal', event.target.value)} />
          </Field>
        </div>
        <Field label="Registration deadline" id="setup-deadline" required>
          <input className="org-input" id="setup-deadline" type="datetime-local" value={state.deadlineLocal} onChange={(event) => set('deadlineLocal', event.target.value)} required />
        </Field>
        <div className="org-preview-grid">
          <Field label="Venue" id="setup-venue">
            <input className="org-input" id="setup-venue" value={state.venue} onChange={(event) => set('venue', event.target.value)} placeholder="e.g. Accra International Conference Centre" />
          </Field>
          <Field label="Google Maps link" id="setup-maps" hint="Only Google Maps links are accepted.">
            <input className="org-input" id="setup-maps" type="url" value={state.mapsUrl} onChange={(event) => set('mapsUrl', event.target.value)} placeholder="https://www.google.com/maps/..." />
          </Field>
        </div>
        <Field label="Event mode" id="setup-mode">
          <select className="org-input" id="setup-mode" value={state.mode} onChange={(event) => set('mode', event.target.value as EventMode)}>
            <option value="in_person">In person</option><option value="online">Online</option><option value="hybrid">Hybrid</option>
          </select>
        </Field>
      </Card>

      <Card>
        <h2 style={{ marginTop: 0 }}>Speakers and sponsors</h2>
        <h3>Speakers</h3>
        {state.speakers.map((speaker, index) => (
          <Card key={index} style={{ marginBottom: '.75rem', boxShadow: 'none' }}>
            <div className="org-row" style={{ justifyContent: 'space-between' }}>
              <strong>Speaker {index + 1}</strong>
              <button type="button" className="yv-link-button" onClick={() => setState((current) => ({ ...current, speakers: current.speakers.filter((_, i) => i !== index) }))}>Remove</button>
            </div>
            <div className="org-row">
              <Field label="Name" id={`speaker-name-${index}`}><input className="org-input" id={`speaker-name-${index}`} value={speaker.name} onChange={(event) => updateSpeaker(index, { name: event.target.value })} /></Field>
              <Field label="Topic" id={`speaker-topic-${index}`}><input className="org-input" id={`speaker-topic-${index}`} value={speaker.topic ?? ''} onChange={(event) => updateSpeaker(index, { topic: event.target.value })} /></Field>
              <Field label="Time" id={`speaker-time-${index}`}><input className="org-input" id={`speaker-time-${index}`} value={speaker.time ?? ''} onChange={(event) => updateSpeaker(index, { time: event.target.value })} /></Field>
            </div>
            <Field label="Notes" id={`speaker-notes-${index}`}><input className="org-input" id={`speaker-notes-${index}`} value={speaker.notes ?? ''} onChange={(event) => updateSpeaker(index, { notes: event.target.value })} /></Field>
            <Field label="Photo" id={`speaker-photo-${index}`}><input id={`speaker-photo-${index}`} type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void upload(`speaker-${index}`, file).then((path) => updateSpeaker(index, { photoPath: path })).catch((err) => setError(friendlyError(err)));
            }} /></Field>
          </Card>
        ))}
        <Button variant="outline" size="sm" onClick={() => setState((current) => ({ ...current, speakers: [...current.speakers, { name: '' }] }))}>Add speaker</Button>

        <h3 style={{ marginTop: '1.5rem' }}>Sponsors (maximum {sponsorLimit})</h3>
        {state.sponsors.map((sponsor, index) => (
          <Card key={index} style={{ marginBottom: '.75rem', boxShadow: 'none' }}>
            <div className="org-row" style={{ justifyContent: 'space-between' }}>
              <strong>Sponsor {index + 1}</strong>
              <button type="button" className="yv-link-button" onClick={() => setState((current) => ({ ...current, sponsors: current.sponsors.filter((_, i) => i !== index) }))}>Remove</button>
            </div>
            <div className="org-row">
              <Field label="Name" id={`sponsor-name-${index}`}><input className="org-input" id={`sponsor-name-${index}`} value={sponsor.name} onChange={(event) => updateSponsor(index, { name: event.target.value })} /></Field>
              <Field label="Website link (optional)" id={`sponsor-url-${index}`}><input className="org-input" id={`sponsor-url-${index}`} type="url" value={sponsor.url ?? ''} onChange={(event) => updateSponsor(index, { url: event.target.value })} /></Field>
            </div>
            <Field label="Logo (optional)" id={`sponsor-logo-${index}`}><input id={`sponsor-logo-${index}`} type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void upload(`sponsor-${index}`, file).then((path) => updateSponsor(index, { logoPath: path })).catch((err) => setError(friendlyError(err)));
            }} /></Field>
          </Card>
        ))}
        <Button
          variant="outline"
          size="sm"
          disabled={state.sponsors.length >= sponsorLimit}
          onClick={() => setState((current) => ({ ...current, sponsors: [...current.sponsors, { name: '' }] }))}
        >
          Add sponsor
        </Button>
      </Card>

      <Card>
        <h2 style={{ marginTop: 0 }}>Visibility and capacity</h2>
        <Field label="Who can find this event?" id="setup-visibility">
          <select className="org-input" id="setup-visibility" value={state.visibility} onChange={(event) => set('visibility', event.target.value as Visibility)}>
            <option value="link_only">Link only (recommended)</option>
            <option value="public">Publicly listed (needs approval)</option>
          </select>
        </Field>
        {state.visibility === 'public' ? (
          <WarningBanner>
            Public listings are reviewed by Yivents. You cannot approve your own listing; approval status is set by the platform.
          </WarningBanner>
        ) : null}
        <div className="org-preview-grid">
          <Field label="Overall capacity" id="setup-capacity" hint="Leave blank for unlimited.">
            <input className="org-input" id="setup-capacity" type="number" min="0" value={state.capacityOverall} onChange={(event) => set('capacityOverall', event.target.value)} />
          </Field>
          <Field label="Almost-full threshold" id="setup-threshold" hint="0.1 = last 10%; 20 = last 20 spots">
            <input className="org-input" id="setup-threshold" type="number" min="0" step="0.01" value={state.almostFull} onChange={(event) => set('almostFull', event.target.value)} />
          </Field>
        </div>
        <h3>Per ticket type capacity</h3>
        {ticketTypes.length ? ticketTypes.map((type) => (
          <Field key={type.id} label={type.name} id={`capacity-${type.id}`} hint="Leave blank for unlimited. Also saved on the ticket type.">
            <input
              className="org-input"
              id={`capacity-${type.id}`}
              type="number"
              min="0"
              value={state.perCapacity[type.id] ?? ''}
              onChange={(event) => set('perCapacity', { ...state.perCapacity, [type.id]: event.target.value })}
            />
          </Field>
        )) : <p className="org-muted">Add ticket types on the Tickets tab to set per-type capacity.</p>}
      </Card>

      {program && program.status === 'archived' ? (
        <WarningBanner>This program is archived and read-only. Restore it from Settings before saving changes.</WarningBanner>
      ) : null}
      <div className="org-row">
        <Button onClick={() => void save()} loading={busy} disabled={program?.status === 'archived'}>Save program</Button>
        {program ? <Badge tone="info">Changes sync to the public page automatically</Badge> : null}
        {busy && !program ? <LoadingState label="Creating your program…" /> : null}
      </div>
    </div>
  );
}
