'use client';

import { collection, doc, setDoc, updateDoc } from 'firebase/firestore';
import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { CURRENCY, type PaymentMethod } from '@yivents/shared';
import { Button, Card, ErrorBanner, Field, LoadingState, SuccessBanner, WarningBanner } from '@yivents/ui';
import { db } from '@/lib/firebase/client';
import { usePaymentMethods, useProgram } from '@/components/organizer/data';
import { patchProgram } from '@/components/organizer/program';
import { friendlyError, ghsToPesewas, pesewasToInput } from '@/components/organizer/utils';

const NETWORKS: Array<PaymentMethod['network']> = ['MTN MoMo', 'Telecel Cash', 'AirtelTigo Money'];

export default function PaymentsPage() {
  const params = useParams<{ id: string }>();
  const programId = String(params?.id ?? '');
  const { program } = useProgram(programId);
  const { methods, loading } = usePaymentMethods(programId);
  const [draft, setDraft] = useState<PaymentMethod[]>([]);
  const [ready, setReady] = useState(false);
  const [allowance, setAllowance] = useState('0.00');
  const [tolerance, setTolerance] = useState('0.00');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const loadedKey = JSON.stringify(methods);

  useEffect(() => {
    if (loading) return;
    setDraft([...methods].sort((a, b) => a.order - b.order));
    setReady(true);
  }, [loadedKey, loading]);

  useEffect(() => {
    if (!program) return;
    setAllowance(pesewasToInput(program.settings.allowancePesewas));
    setTolerance(pesewasToInput(program.settings.tolerancePesewas));
  }, [program?.id, program?.settings.allowancePesewas, program?.settings.tolerancePesewas]);

  const patch = (id: string, change: Partial<PaymentMethod>) =>
    setDraft((current) => current.map((method) => (method.id === id ? { ...method, ...change } : method)));

  const add = (type: PaymentMethod['type']) => {
    const id = doc(collection(db, 'programs', programId, 'paymentMethods')).id;
    setDraft((current) => [
      ...current,
      {
        id,
        type,
        ...(type === 'momo' ? { network: NETWORKS[0] } : { bankName: '' }),
        accountName: '',
        enabled: true,
        currency: CURRENCY,
        order: current.length,
      },
    ]);
  };

  const save = async () => {
    setError('');
    setNotice('');
    if (draft.some((method) => !method.accountName.trim())) {
      setError('Every payment method needs an account name.');
      return;
    }
    setBusy(true);
    try {
      const existing = new Map(methods.map((method) => [method.id, method]));
      for (const method of draft) {
        const saved: PaymentMethod = {
          ...method,
          accountName: method.accountName.trim(),
          ...(method.type === 'momo'
            ? { network: method.network, number: method.number?.trim(), accountNumber: undefined }
            : { bankName: method.bankName?.trim(), accountNumber: method.accountNumber?.trim() }),
        };
        // Firestore rejects undefined values; strip empty optional fields.
        const clean = JSON.parse(JSON.stringify(saved)) as PaymentMethod;
        const target = doc(db, 'programs', programId, 'paymentMethods', method.id);
        if (existing.has(method.id)) await updateDoc(target, clean);
        else await setDoc(target, clean);
      }
      await patchProgram(programId, {
        'settings.allowancePesewas': ghsToPesewas(allowance),
        'settings.tolerancePesewas': ghsToPesewas(tolerance),
      });
      setNotice('Payment methods saved. Participants only see enabled methods.');
    } catch (err) {
      setError(friendlyError(err, 'Could not save payment methods.'));
    } finally {
      setBusy(false);
    }
  };

  if (loading || !ready) return <LoadingState label="Loading payment methods…" />;
  const readOnly = program?.status === 'archived';

  return (
    <div className="org-stack">
      <div>
        <h1 style={{ margin: 0 }}>Payment methods</h1>
        <p className="yv-muted" style={{ margin: '.35rem 0 0' }}>MoMo and bank details for manual verification. No payment gateway is used.</p>
      </div>
      {error ? <ErrorBanner message={error} onDismiss={() => setError('')} /> : null}
      {notice ? <SuccessBanner message={notice} /> : null}
      {readOnly ? <WarningBanner>This program is archived and read-only.</WarningBanner> : null}
      <WarningBanner>
        Students only see enabled methods. Never share a PIN or password — a payment is verified from the transaction ID and proof of payment.
      </WarningBanner>

      <Card>
        <h2 style={{ marginTop: 0 }}>Amount tolerance</h2>
        <div className="org-preview-grid">
          <Field label="Allowance above ticket price (GHS)" id="allowance" hint="Extra amount senders may add, e.g. transfer fee.">
            <input className="org-input" id="allowance" type="number" min="0" step="0.01" value={allowance} disabled={readOnly} onChange={(event) => setAllowance(event.target.value)} />
          </Field>
          <Field label="Short tolerance (GHS)" id="tolerance" hint="Small shortfall that is still accepted.">
            <input className="org-input" id="tolerance" type="number" min="0" step="0.01" value={tolerance} disabled={readOnly} onChange={(event) => setTolerance(event.target.value)} />
          </Field>
        </div>
      </Card>

      {draft.length === 0 ? <Card><p className="yv-muted">No payment methods yet. Add a MoMo number or a bank account.</p></Card> : null}

      {draft.map((method, index) => (
        <Card key={method.id}>
          <div className="org-row" style={{ justifyContent: 'space-between' }}>
            <strong>{method.type === 'momo' ? `MoMo ${index + 1}` : `Bank ${index + 1}`}</strong>
            <div className="org-row">
              <label className="org-check"><input type="checkbox" checked={method.enabled} disabled={readOnly} onChange={(event) => patch(method.id, { enabled: event.target.checked })} /> Enabled</label>
              <Button variant="danger" size="sm" disabled={readOnly} onClick={() => setDraft((current) => current.filter((item) => item.id !== method.id))}>Remove</Button>
            </div>
          </div>
          <Field label="Account name" id={`pay-name-${method.id}`} required>
            <input className="org-input" id={`pay-name-${method.id}`} value={method.accountName} disabled={readOnly} onChange={(event) => patch(method.id, { accountName: event.target.value })} />
          </Field>
          {method.type === 'momo' ? (
            <div className="org-preview-grid">
              <Field label="Network" id={`pay-network-${method.id}`}>
                <select className="org-input" id={`pay-network-${method.id}`} value={method.network ?? NETWORKS[0]} disabled={readOnly} onChange={(event) => patch(method.id, { network: event.target.value as PaymentMethod['network'] })}>
                  {NETWORKS.map((network) => <option key={network} value={network}>{network}</option>)}
                </select>
              </Field>
              <Field label="MoMo number" id={`pay-number-${method.id}`}>
                <input className="org-input" id={`pay-number-${method.id}`} type="tel" value={method.number ?? ''} disabled={readOnly} onChange={(event) => patch(method.id, { number: event.target.value })} />
              </Field>
            </div>
          ) : (
            <div className="org-preview-grid">
              <Field label="Bank name" id={`pay-bank-${method.id}`}>
                <input className="org-input" id={`pay-bank-${method.id}`} value={method.bankName ?? ''} disabled={readOnly} onChange={(event) => patch(method.id, { bankName: event.target.value })} />
              </Field>
              <Field label="Account number" id={`pay-account-${method.id}`}>
                <input className="org-input" id={`pay-account-${method.id}`} value={method.accountNumber ?? ''} disabled={readOnly} onChange={(event) => patch(method.id, { accountNumber: event.target.value })} />
              </Field>
              <Field label="Ticket issue for this bank" id={`pay-bank-instant-${method.id}`}>
                <select
                  className="org-input"
                  id={`pay-bank-instant-${method.id}`}
                  value={method.bankInstantTicket ? 'instant' : 'after_approval'}
                  disabled={readOnly}
                  onChange={(event) => patch(method.id, { bankInstantTicket: event.target.value === 'instant' })}
                >
                  <option value="instant">Instant ticket</option>
                  <option value="after_approval">After approval</option>
                </select>
              </Field>
            </div>
          )}
          <p className="org-muted">Currency: {method.currency}</p>
        </Card>
      ))}

      <div className="org-row">
        <Button variant="outline" onClick={() => add('momo')} disabled={readOnly}>Add MoMo</Button>
        <Button variant="outline" onClick={() => add('bank')} disabled={readOnly}>Add bank</Button>
        <Button onClick={() => void save()} loading={busy} disabled={readOnly}>Save payment methods</Button>
      </div>
    </div>
  );
}
