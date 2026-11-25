'use client';

/**
 * Phase 1 lookup: the callable verifies the identifier (and rate-limits), then
 * we show a private link plus a one-time code. There is no platform email/SMS
 * service yet, so the UI offers a mailto compose instead of pretending to send.
 */
import { useEffect, useState, type FormEvent } from 'react';
import { Button, ErrorBanner, LoadingState } from '@yivents/ui';
import { callFunction } from '@/lib/firebase/client';
import { useRecaptchaToken } from './useRecaptcha';
import { safeHttpUrl } from './types';

const ATTEMPT_KEY = 'yivents:lookup-attempts';
const WINDOW_MS = 10 * 60_000;
const MAX_ATTEMPTS = 5;

interface Match {
  privateLink: string;
  absoluteLink: string;
  oneTimeCode: string;
}

function readAttempts(): number[] {
  try {
    const raw = sessionStorage.getItem(ATTEMPT_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((value): value is number => typeof value === 'number') : [];
  } catch {
    return [];
  }
}

export function LookupForm() {
  const getCaptchaToken = useRecaptchaToken();
  const [identifier, setIdentifier] = useState('');
  const [programId, setProgramId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [waitSeconds, setWaitSeconds] = useState(0);
  const [match, setMatch] = useState<Match | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    setProgramId(params.get('programId') ?? params.get('program') ?? params.get('slug') ?? '');
  }, []);

  useEffect(() => {
    const tick = () => {
      const recent = readAttempts().filter((time) => Date.now() - time < WINDOW_MS);
      const oldest = recent[0];
      setWaitSeconds(oldest ? Math.max(0, Math.ceil((WINDOW_MS - (Date.now() - oldest)) / 1000)) : 0);
    };
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, []);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError('');
    if (waitSeconds > 0) {
      setError(`Too many lookups. Try again in about ${Math.ceil(waitSeconds / 60)} minute(s).`);
      return;
    }
    if (identifier.trim().length < 4) {
      setError('Enter the email address or phone number you registered with.');
      return;
    }
    if (programId.trim().length < 2) {
      setError('Enter the event page slug or event ID. You can copy it from the event link (/e/your-event).');
      return;
    }
    setBusy(true);
    try {
      const captchaToken = await getCaptchaToken('ticket_lookup');
      // The server verifies the identifier, issues a one-time code and returns
      // the private link. Nothing is trusted from this browser.
      const response = await callFunction<{
        found?: boolean;
        ticketCode?: string;
        privatePath?: string;
        privateLink?: string;
        oneTimeCode?: string;
      }>('issueTicketLink', {
        programId: programId.trim(),
        identifier: identifier.trim(),
        ...(captchaToken ? { captchaToken } : {}),
      });
      const attempts = [...readAttempts(), Date.now()].filter((time) => Date.now() - time < WINDOW_MS);
      try {
        sessionStorage.setItem(ATTEMPT_KEY, JSON.stringify(attempts.slice(-MAX_ATTEMPTS)));
      } catch {
        // Rate limiting also happens on the server.
      }

      const code = String(response?.ticketCode ?? '');
      if (response?.found === false || (!code && !response?.privatePath && !response?.privateLink)) {
        throw new Error('No ticket matched those details. Check the event and try again.');
      }
      const suppliedLink = safeHttpUrl(response?.privateLink) ?? safeHttpUrl(response?.privatePath);
      const path = suppliedLink ?? `/t/${encodeURIComponent(code)}`;
      const absoluteLink = new URL(path, window.location.origin).toString();
      const oneTimeCode = String(response?.oneTimeCode ?? '');
      setMatch({ privateLink: path, absoluteLink, oneTimeCode });
    } catch (lookupError) {
      setError(lookupError instanceof Error && lookupError.message ? lookupError.message : 'We could not complete that lookup. Please try again later.');
    } finally {
      setBusy(false);
    }
  };

  const mailto = match
    ? `mailto:?subject=${encodeURIComponent('My Yivents ticket')}&body=${encodeURIComponent(
        `Use this private link to get your ticket: ${match.absoluteLink}\nOne-time code: ${match.oneTimeCode}\n\nNever share your PIN or password.`,
      )}`
    : '';

  return (
    <div className="yv-stack">
      <p className="yv-muted">
        Enter the email address or phone number you used to register. We will check it with the event organizer&apos;s system
        and show a private ticket link here.
      </p>
      <p className="pub-notice">
        Honest limitation: Yivents cannot send email or SMS yet. Once verified, use the email button below to send the private
        link to yourself. The one-time code appears on this screen only. Never share your PIN or password.
      </p>
      {error ? <ErrorBanner message={error} onDismiss={() => setError('')} /> : null}

      {match ? (
        <div className="yv-stack">
          <div className="pub-success-card" role="status">
            <h3>Your private ticket link is ready</h3>
            <p className="pub-link-box">{match.absoluteLink}</p>
            <p>
              One-time code: <span className="pub-code-box">{match.oneTimeCode}</span>
            </p>
          </div>
          <div className="yv-row">
            <a className="yv-btn yv-btn-primary" href={mailto}>Email this link to myself</a>
            <Button
              type="button"
              variant="outline"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(match.absoluteLink);
                } catch {
                  setError('Copying was blocked. Select the link above and copy it manually.');
                }
              }}
            >
              Copy link
            </Button>
            <a className="yv-btn yv-btn-outline" href={match.privateLink}>Open ticket</a>
          </div>
          <p className="yv-tiny yv-muted">This link is private. Anyone with it can view your ticket, so keep it to yourself.</p>
        </div>
      ) : (
        <form className="pub-form-stack" onSubmit={submit} noValidate>
          <div className="yv-field">
            <label htmlFor="lookup-identifier">Email or phone number</label>
            <input
              id="lookup-identifier"
              value={identifier}
              autoComplete="email"
              onChange={(event) => setIdentifier(event.target.value)}
              placeholder="you@example.com or 05XXXXXXXX"
              aria-invalid={Boolean(error)}
            />
          </div>
          <div className="yv-field">
            <label htmlFor="lookup-program">Event page slug or event ID <span aria-hidden="true">*</span></label>
            <input
              id="lookup-program"
              value={programId}
              onChange={(event) => setProgramId(event.target.value)}
              aria-describedby="lookup-program-hint"
            />
            <p className="yv-tiny yv-muted" id="lookup-program-hint">From your event link, e.g. /e/your-event.</p>
          </div>
          {waitSeconds > 0 ? (
            <LoadingState label={`Lookup paused for ${Math.ceil(waitSeconds / 60)} more minute(s).`} />
          ) : null}
          <Button type="submit" size="lg" loading={busy} disabled={waitSeconds > 0}>
            Find my ticket
          </Button>
        </form>
      )}
    </div>
  );
}
