'use client';

/**
 * Door scanner. The PIN/link is verified by `verifyScannerAccess`; the token is
 * kept only in sessionStorage. Every check-in is atomic on the server via
 * `checkIn`, so many phones can scan at the same time.
 */
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Badge, Button, ErrorBanner, LoadingState } from '@yivents/ui';
import { formatGhanaDate, formatGHS } from '@yivents/shared';
import { callFunction } from '@/lib/firebase/client';
import type { TicketLookupResult } from './types';
import { plainText, resultKind, unwrapLookup } from './types';

interface VerifyResponse {
  scannerToken?: string;
  token?: string;
  programTitle?: string;
  title?: string;
  eventName?: string;
  [key: string]: unknown;
}

type ResultKind = 'valid' | 'unverified' | 'already_checked_in' | 'not_found' | 'rejected' | 'cancelled' | 'error';

interface ScanResult {
  kind: ResultKind;
  code: string;
  name?: string;
  ticketTypeName?: string;
  transactionId?: string;
  amountPesewas?: number;
  checkedInAt?: string;
  registrationId?: string;
  message?: string;
}

interface NativeDetector {
  detect(source: HTMLVideoElement): Promise<Array<{ rawValue: string }>>;
}
type NativeDetectorCtor = new (options: { formats: string[] }) => NativeDetector;

function normalizeResult(raw: TicketLookupResult, code: string): ScanResult {
  const kind = resultKind(raw);
  const payment = raw.payment;
  const base: ScanResult = {
    code,
    name: String(raw.attendeeName ?? raw.name ?? ''),
    ticketTypeName: String(raw.ticketTypeName ?? raw.ticketType ?? ''),
    registrationId: raw.registrationId ? String(raw.registrationId) : undefined,
    message: plainText(raw.message),
    checkedInAt: raw.checkedInAt ? String(raw.checkedInAt) : undefined,
    transactionId: raw.transactionId ? String(raw.transactionId) : payment?.transactionId,
    amountPesewas: typeof raw.amountPesewas === 'number'
      ? raw.amountPesewas
      : typeof payment?.amountPesewas === 'number' ? payment.amountPesewas : undefined,
    kind: 'not_found',
  };
  if (/already|checked_in|duplicate/.test(kind) || raw.checkedInAt) return { ...base, kind: 'already_checked_in' };
  if (/reject/.test(kind)) return { ...base, kind: 'rejected' };
  if (/cancel/.test(kind)) return { ...base, kind: 'cancelled' };
  if (/unverified|pending|amber|needs_review|attention/.test(kind) || (base.transactionId && !/valid|success|green/.test(kind))) {
    return { ...base, kind: 'unverified' };
  }
  if (/valid|success|green|checked_in_ok|ok/.test(kind) || base.name) return { ...base, kind: 'valid' };
  return base;
}

function formatCheckInTime(value?: string): string {
  if (!value) return 'earlier';
  try {
    return formatGhanaDate(value);
  } catch {
    return value;
  }
}

export function ScannerApp({ programId }: { programId: string }) {
  const storageKey = `yivents:scanner:${programId}`;
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const zxingRef = useRef<{ stop: () => void } | null>(null);
  const runningRef = useRef(false);
  const lastScanRef = useRef<{ code: string; at: number } | null>(null);

  const [gate, setGate] = useState<'checking' | 'gated' | 'ready'>('checking');
  const [pin, setPin] = useState('');
  const [token, setToken] = useState('');
  const [programTitle, setProgramTitle] = useState('this event');
  const [gateError, setGateError] = useState('');
  const [gateBusy, setGateBusy] = useState(false);
  const [camera, setCamera] = useState<'off' | 'starting' | 'on' | 'error'>('off');
  const [cameraError, setCameraError] = useState('');
  const [scanBusy, setScanBusy] = useState(false);
  const [result, setResult] = useState<ScanResult | null>(null);
  const [actionError, setActionError] = useState('');
  const [manual, setManual] = useState('');
  const [recent, setRecent] = useState<TicketLookupResult[]>([]);

  const verify = useCallback(
    async (data: { pin?: string; token?: string }) => {
      setGateBusy(true);
      setGateError('');
      try {
        const response = await callFunction<VerifyResponse>('verifyScannerAccess', { programId, ...data });
        const scannerToken = String(response?.scannerToken ?? response?.token ?? '');
        if (!scannerToken) throw new Error('That scanner link or PIN was not accepted.');
        setToken(scannerToken);
        setProgramTitle(plainText(response?.programTitle ?? response?.title ?? response?.eventName, 'this event'));
        try {
          sessionStorage.setItem(storageKey, JSON.stringify({ token: scannerToken, savedAt: Date.now() }));
        } catch {
          // Session storage is a convenience; scanning still works in this tab.
        }
        setGate('ready');
      } catch (error) {
        setGateError(error instanceof Error && error.message ? error.message : 'Scanner access could not be verified.');
        setGate('gated');
      } finally {
        setGateBusy(false);
      }
    },
    [programId, storageKey],
  );

  useEffect(() => {
    let alive = true;
    const params = new URLSearchParams(window.location.search);
    const urlToken = params.get('token') ?? params.get('scannerToken') ?? params.get('t') ?? params.get('code');
    const urlPin = params.get('pin') ?? params.get('p');
    let savedToken = '';
    try {
      const raw = sessionStorage.getItem(storageKey);
      if (raw) savedToken = String((JSON.parse(raw) as { token?: string }).token ?? '');
    } catch {
      savedToken = '';
    }
    if (!alive) return;
    if (urlToken || savedToken) void verify({ token: urlToken || savedToken });
    else {
      setPin(urlPin ?? '');
      setGate('gated');
    }
    return () => {
      alive = false;
    };
  }, [storageKey, verify]);

  const stopCamera = useCallback(() => {
    runningRef.current = false;
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    zxingRef.current?.stop();
    zxingRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCamera('off');
  }, []);

  useEffect(() => stopCamera, [stopCamera]);

  const checkInCode = useCallback(
    async (rawCode: string) => {
      const code = rawCode.trim();
      if (!code) return;
      setScanBusy(true);
      setActionError('');
      try {
        const response = await callFunction<TicketLookupResult>('checkIn', { ticketCode: code, programId, scannerToken: token });
        setResult(normalizeResult(unwrapLookup(response), code));
      } catch (error) {
        setResult({ kind: 'error', code, message: error instanceof Error ? error.message : 'Check-in failed. Try again.' });
      } finally {
        setScanBusy(false);
      }
    },
    [programId, token],
  );

  const handleDetection = useCallback(
    (rawCode: string) => {
      const code = rawCode.trim();
      const previous = lastScanRef.current;
      if (!code || (previous?.code === code && Date.now() - previous.at < 3000)) return;
      lastScanRef.current = { code, at: Date.now() };
      void checkInCode(code);
    },
    [checkInCode],
  );

  const startCamera = async () => {
    setCameraError('');
    setCamera('starting');
    const video = videoRef.current;
    if (!video) {
      setCamera('error');
      setCameraError('Camera preview is not ready yet.');
      return;
    }
    runningRef.current = true;
    try {
      const win = window as Window & { BarcodeDetector?: NativeDetectorCtor };
      if (win.BarcodeDetector) {
        const detector = new win.BarcodeDetector({ formats: ['qr_code'] });
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false,
        });
        streamRef.current = stream;
        video.srcObject = stream;
        await video.play();
        const tick = async () => {
          if (!runningRef.current) return;
          try {
            const detected = await detector.detect(video);
            if (detected[0]?.rawValue) handleDetection(detected[0].rawValue);
          } catch {
            // A transient detect failure should not stop the scanner.
          }
          if (runningRef.current) rafRef.current = requestAnimationFrame(tick);
        };
        void tick();
        setCamera('on');
        return;
      }
      const { BrowserMultiFormatReader } = await import('@zxing/browser');
      const reader = new BrowserMultiFormatReader();
      const controls = await reader.decodeFromVideoDevice(undefined, video, (scanResult) => {
        if (scanResult) handleDetection(scanResult.getText());
      });
      zxingRef.current = controls;
      setCamera('on');
    } catch (error) {
      runningRef.current = false;
      setCamera('error');
      setCameraError(
        error instanceof Error && error.message
          ? `Camera unavailable: ${error.message}`
          : 'Camera unavailable. Use the manual ticket search instead.',
      );
    }
  };

  const manualLookup = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setActionError('');
    if (manual.trim().length < 4) {
      setActionError('Enter a ticket code, email address or phone number.');
      return;
    }
    try {
      // Door staff have no account: the scanner token is the capability.
      const response = await callFunction<{ results?: Array<{
        id: string;
        name: string;
        ticketTypeName: string;
        ticketCode: string;
        status: string;
        checkedInAt?: string | null;
      }> }>('scannerSearch', {
        programId,
        scannerToken: token,
        query: manual.trim(),
      });
      const results = response?.results ?? [];
      if (!results.length) throw new Error('No attendee matched that search.');
      const entries: TicketLookupResult[] = results.map((item) => ({
        code: item.ticketCode,
        ticketCode: item.ticketCode,
        registrationId: item.id,
        name: item.name,
        ticketTypeName: item.ticketTypeName,
        status: item.status,
        ...(item.checkedInAt ? { checkedInAt: item.checkedInAt } : {}),
      }));
      setRecent((previous) => [...entries, ...previous.filter((item) => !entries.some((entry) => entry.code === item.code))].slice(0, 10));
      setResult(normalizeResult(entries[0], String(entries[0].code)));
      setManual('');
    } catch (error) {
      setActionError(error instanceof Error && error.message ? error.message : 'No attendee matched that search.');
    }
  };

  const approveOnSpot = async () => {
    if (!result?.registrationId) {
      setActionError('Search this attendee by name first, then approve from the manual list.');
      return;
    }
    setActionError('');
    setScanBusy(true);
    try {
      await callFunction('scannerApprove', {
        programId,
        scannerToken: token,
        registrationId: result.registrationId,
      });
      setResult({ ...result, kind: 'valid', message: 'Approved at the door. Attendee may enter.' });
    } catch (error) {
      setActionError(
        error instanceof Error && error.message
          ? error.message
          : 'On-the-spot approval is not available to this scanner. Send the attendee to the help desk.',
      );
    } finally {
      setScanBusy(false);
    }
  };

  if (gate === 'checking') return <LoadingState label="Checking scanner access…" />;

  if (gate === 'gated') {
    return (
      <div className="yv-card pub-form-stack" style={{ maxWidth: 520 }}>
        <h3>Door scanner access</h3>
        <p className="yv-muted">Enter the PIN from the organizer, or open the private scanner link you were given.</p>
        {gateError ? <ErrorBanner message={gateError} onDismiss={() => setGateError('')} /> : null}
        <form
          className="pub-form-stack"
          onSubmit={(event) => {
            event.preventDefault();
            if (pin.trim().length < 4) {
              setGateError('Enter the scanner PIN.');
              return;
            }
            void verify({ pin: pin.trim() });
          }}
        >
          <div className="yv-field">
            <label htmlFor="scanner-pin">Scanner PIN</label>
            <input
              id="scanner-pin"
              type="password"
              autoComplete="off"
              value={pin}
              onChange={(event) => setPin(event.target.value)}
            />
            <p className="yv-tiny yv-muted">Your PIN is private. Never share your PIN or password with attendees.</p>
          </div>
          <Button type="submit" size="lg" loading={gateBusy}>Open scanner</Button>
        </form>
      </div>
    );
  }

  return (
    <div className="yv-stack">
      <div className="yv-spread">
        <div>
          <h2>Door scanner</h2>
          <p className="yv-muted">Checking tickets for {programTitle}.</p>
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={stopCamera}>Stop camera</Button>
      </div>
      {actionError ? <ErrorBanner message={actionError} onDismiss={() => setActionError('')} /> : null}

      <div className="pub-scanner-grid">
        <section className="yv-stack" aria-label="Camera scanner">
          <video ref={videoRef} className="pub-scanner-video" playsInline muted aria-label="Ticket QR camera preview" />
          {camera === 'off' || camera === 'error' ? (
            <Button type="button" size="lg" onClick={() => void startCamera()}>Start camera</Button>
          ) : null}
          {camera === 'starting' ? <LoadingState label="Starting camera…" /> : null}
          {camera === 'error' && cameraError ? <ErrorBanner message={cameraError} /> : null}
          <p className="yv-tiny yv-muted">Point the camera at the attendee&apos;s QR code. Keep this screen open while scanning.</p>
        </section>

        <section className="yv-stack" aria-label="Check-in result">
          <h3>Result</h3>
          {scanBusy ? <LoadingState label="Checking ticket…" /> : null}
          {!result ? <p className="yv-muted">Scan a ticket or search manually to see the result here.</p> : null}
          {result?.kind === 'valid' ? (
            <div className="pub-result pub-result-valid" role="status">
              <Badge tone="success">Valid ticket</Badge>
              <p><strong>{result.name || 'Attendee'}</strong></p>
              <p className="yv-muted">{result.ticketTypeName || 'Ticket'}</p>
              {result.message ? <p className="yv-tiny">{result.message}</p> : null}
            </div>
          ) : null}
          {result?.kind === 'unverified' ? (
            <div className="pub-result pub-result-note" role="status">
              <Badge tone="warning">Payment unverified</Badge>
              <p>Do not admit until the organizer confirms payment.</p>
              <p>Transaction ID: <strong>{result.transactionId || 'not supplied'}</strong></p>
              <p>Amount: <strong>{result.amountPesewas !== undefined ? formatGHS(result.amountPesewas) : 'not supplied'}</strong></p>
              <div className="yv-row">
                <Button type="button" size="sm" loading={scanBusy} onClick={() => void approveOnSpot()}>Approve on the spot</Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setResult((previous) => previous
                    ? { ...previous, message: 'Ask the organizer to confirm payment at the help desk before admitting this attendee.' }
                    : null)}
                >
                  Send to help desk
                </Button>
              </div>
            </div>
          ) : null}
          {result?.kind === 'already_checked_in' ? (
            <div className="pub-result pub-result-red" role="status">
              <Badge tone="danger">Already checked in</Badge>
              <p>Checked in at {formatCheckInTime(result.checkedInAt)}.</p>
              {result.name ? <p className="yv-tiny">{result.name}</p> : null}
            </div>
          ) : null}
          {result?.kind === 'not_found' ? (
            <div className="pub-result pub-result-red" role="status">
              <Badge tone="danger">Ticket not found</Badge>
              <p>Check the QR code or search manually. Do not admit this attendee yet.</p>
            </div>
          ) : null}
          {result?.kind === 'rejected' || result?.kind === 'cancelled' ? (
            <div className="pub-result pub-result-red" role="status">
              <Badge tone="danger">{result.kind === 'cancelled' ? 'Ticket cancelled' : 'Registration rejected'}</Badge>
              <p>This ticket is not valid for entry.</p>
            </div>
          ) : null}
          {result?.kind === 'error' ? (
            <div className="pub-result pub-result-red" role="alert">
              <Badge tone="danger">Check-in failed</Badge>
              <p>{result.message || 'Try again or use the help desk.'}</p>
            </div>
          ) : null}
        </section>
      </div>

      <section className="yv-card" aria-labelledby="manual-heading">
        <h3 id="manual-heading">Manual search (poor network fallback)</h3>
        <p className="yv-muted">Search by ticket code, email or phone. Results from this session are kept on this device only.</p>
        <form className="pub-form-stack" onSubmit={manualLookup}>
          <div className="yv-field">
            <label htmlFor="manual-identifier">Ticket code, email or phone</label>
            <input id="manual-identifier" value={manual} onChange={(event) => setManual(event.target.value)} />
          </div>
          <Button type="submit" size="sm">Search attendee</Button>
        </form>
        {recent.length ? (
          <div style={{ marginTop: '1rem' }}>
            {recent.map((item) => (
              <div className="pub-scanner-row" key={String(item.code)}>
                <span>
                  <strong>{String(item.attendeeName ?? item.name ?? 'Attendee')}</strong>
                  <span className="yv-muted"> — {String(item.ticketTypeName ?? 'Ticket')} — {String(item.code).slice(0, 12)}…</span>
                </span>
                <Button type="button" size="sm" variant="outline" onClick={() => void checkInCode(String(item.code))}>
                  Check in
                </Button>
              </div>
            ))}
          </div>
        ) : null}
      </section>
    </div>
  );
}
