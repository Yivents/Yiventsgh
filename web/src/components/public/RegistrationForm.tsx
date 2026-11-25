'use client';

/**
 * Public registration. All trusted writes go through `submitRegistration`;
 * no Firestore writes or private reads happen here. Sensitive labels are
 * blocked/flagged and payment UI only appears for paid ticket types.
 */
import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { ref, uploadBytes } from 'firebase/storage';
import { Button, ErrorBanner, WarningBanner } from '@yivents/ui';
import {
  formatGHS,
  isMalformedTransactionId,
  isSensitiveLabel,
  isValidGhanaPhone,
  normalizeGhanaPhone,
  registrationSubmissionSchema,
  type FormField,
  type RegistrationSubmission,
} from '@yivents/shared';
import { callFunction, storage } from '@/lib/firebase/client';
import { FormFieldRenderer } from './FormFieldRenderer';
import { useRecaptchaToken } from './useRecaptcha';
import { HOST_EVENT_URL } from './site-chrome';
import type { AnswerValue, PublicFormField, PublicProgramView } from './types';

const DEFAULT_FIELDS: FormField[] = [
  { id: 'fullName', type: 'short_text', label: 'Full name', required: true, section: 'Your details', order: 1 },
  { id: 'phone', type: 'phone', label: 'Phone number', required: true, section: 'Your details', order: 2 },
  { id: 'email', type: 'email', label: 'Email address', required: false, section: 'Your details', order: 3 },
];

const FALLBACK_TICKET = { id: 'general', name: 'General admission', pricePesewas: 0 };

interface PaymentDraft {
  methodId: string;
  amountGhs: string;
  transactionId: string;
  senderName: string;
  senderPhone: string;
  payerName: string;
  referenceCode: string;
  screenshotPath: string;
}

const EMPTY_PAYMENT: PaymentDraft = {
  methodId: '',
  amountGhs: '',
  transactionId: '',
  senderName: '',
  senderPhone: '',
  payerName: '',
  referenceCode: '',
  screenshotPath: '',
};

interface Draft {
  draftId: string;
  values: Record<string, AnswerValue>;
  contact: { name: string; email: string; phone: string };
  ticketTypeId: string;
  payment: PaymentDraft;
}

interface SubmitResponse {
  ticketCode?: string;
  code?: string;
  registrationId?: string;
  message?: string;
  [key: string]: unknown;
}

function createId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `draft-${Math.random().toString(36).slice(2)}`;
}

function text(value: AnswerValue | undefined): string {
  return typeof value === 'string' ? value : '';
}

function empty(value: AnswerValue | undefined): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === 'string') return value.trim() === '' || value.trim() === '+233';
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'number') return !Number.isFinite(value);
  return false;
}

function isNameField(field: FormField) {
  return (
    /^(fullname|name|contactname|attendeename)$/i.test(field.id) ||
    (/\b(full name|your name|name)\b/i.test(field.label) && !/payer|sender|bank|sponsor|company/i.test(field.label))
  );
}

function isPhoneField(field: FormField) {
  return /^(phone|contactphone|mobile)$/i.test(field.id) || /\b(phone|mobile|telephone)\b/i.test(field.label);
}

function isEmailField(field: FormField) {
  return /^(email|contactemail)$/i.test(field.id) || /\b(email|e-mail)\b/i.test(field.label);
}

function isBlockedField(field: PublicFormField) {
  return field.sensitiveFlag === 'blocked' || (isSensitiveLabel(field.label) && field.sensitiveFlag !== 'flagged');
}

/** Canvas compression keeps uploads inside Storage's 6 MB rule. */
async function compressImage(file: File): Promise<{ blob: Blob; extension: string }> {
  if (!file.type.startsWith('image/')) throw new Error('Please choose an image file (JPG, PNG or WebP).');
  const objectUrl = URL.createObjectURL(file);
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('That image could not be opened.'));
      image.src = objectUrl;
    });
    const maxSide = 1280;
    const scale = Math.min(1, maxSide / Math.max(image.width || 1, image.height || 1));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Image compression is not supported on this device.');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.78));
    if (!blob) throw new Error('That image could not be compressed. Please try a smaller photo.');
    if (blob.size > 5.5 * 1024 * 1024) throw new Error('The compressed image is still too large. Please use a smaller photo.');
    return { blob, extension: 'jpg' };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export function RegistrationForm({ program }: { program: PublicProgramView }) {
  const getCaptchaToken = useRecaptchaToken();
  const draftKey = `yivents:draft:${program.programId}`;
  const [values, setValues] = useState<Record<string, AnswerValue>>({});
  const [contact, setContact] = useState({ name: '', email: '', phone: '' });
  const [ticketTypeId, setTicketTypeId] = useState('');
  const [payment, setPayment] = useState<PaymentDraft>(EMPTY_PAYMENT);
  const [draftId, setDraftId] = useState('');
  const [draftLoaded, setDraftLoaded] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [success, setSuccess] = useState<{ code?: string; paid: boolean } | null>(null);

  const fields = useMemo<PublicFormField[]>(() => {
    const supplied = program.formFields?.filter((field) => Boolean(field?.id));
    const base: PublicFormField[] = supplied?.length ? supplied : DEFAULT_FIELDS;
    return base.some(isNameField) ? base : [{ ...DEFAULT_FIELDS[0], order: 0 }, ...base];
  }, [program.formFields]);

  const sections = useMemo(() => {
    const grouped = new Map<string, PublicFormField[]>();
    fields.forEach((field) => {
      const name = field.section || 'Your details';
      grouped.set(name, [...(grouped.get(name) ?? []), field]);
    });
    return Array.from(grouped, ([name, items]) => ({ name, items: [...items].sort((a, b) => a.order - b.order) }));
  }, [fields]);

  const tickets = program.ticketTypes.length ? program.ticketTypes : [FALLBACK_TICKET];
  const selectedTicket = tickets.find((ticket) => ticket.id === ticketTypeId) ?? tickets[0];
  const paid = selectedTicket.pricePesewas > 0;
  const nameField = fields.find(isNameField);
  const phoneField = fields.find(isPhoneField);
  const emailField = fields.find(isEmailField);
  const methods = program.paymentMethods ?? [];

  useEffect(() => {
    let saved: Partial<Draft> = {};
    try {
      const raw = localStorage.getItem(draftKey);
      if (raw) saved = JSON.parse(raw) as Partial<Draft>;
    } catch {
      // Corrupt or unavailable storage: start a fresh form.
    }
    const nextValues = { ...(saved.values ?? {}) };
    const phoneCandidate = fields.find(isPhoneField);
    if (phoneCandidate && empty(nextValues[phoneCandidate.id])) nextValues[phoneCandidate.id] = '+233';
    setValues(nextValues);
    setContact({
      name: saved.contact?.name ?? (nameField ? text(nextValues[nameField.id]) : ''),
      email: saved.contact?.email ?? (emailField ? text(nextValues[emailField.id]) : ''),
      phone: saved.contact?.phone ?? (phoneField ? text(nextValues[phoneField.id]) : ''),
    });
    setPayment({ ...EMPTY_PAYMENT, ...(saved.payment ?? {}) });
    setTicketTypeId(saved.ticketTypeId || tickets[0].id);
    setDraftId(saved.draftId || createId());
    setDraftLoaded(true);
    // Draft load is intentionally once-per-program; `tickets` derive from props.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey]);

  useEffect(() => {
    if (!draftLoaded || !draftId) return;
    const draft: Draft = { draftId, values, contact, ticketTypeId, payment };
    try {
      localStorage.setItem(draftKey, JSON.stringify(draft));
    } catch {
      // Private browsing may block localStorage; the form still works.
    }
  }, [draftLoaded, draftId, draftKey, values, contact, ticketTypeId, payment]);

  const updateValue = useCallback(
    (field: PublicFormField, value: AnswerValue) => {
      setValues((previous) => ({ ...previous, [field.id]: value }));
      if (isNameField(field)) setContact((previous) => ({ ...previous, name: text(value) }));
      if (isPhoneField(field)) setContact((previous) => ({ ...previous, phone: text(value) }));
      if (isEmailField(field)) setContact((previous) => ({ ...previous, email: text(value) }));
      setErrors((previous) => {
        if (!previous[field.id]) return previous;
        const next = { ...previous };
        delete next[field.id];
        return next;
      });
    },
    [],
  );

  const uploadImage = useCallback(
    async (file: File, kind: 'field' | 'screenshot'): Promise<string> => {
      // Registrants have no account: a trusted callable issues a scoped upload
      // token (and, in production, a short-lived signed write URL).
      const compressed = await compressImage(file);
      const captchaToken = await getCaptchaToken('upload_photo');
      const issued = await callFunction<{ path: string; uploadUrl?: string }, {
        programId: string;
        fileName: string;
        contentType: 'image/jpeg';
        captchaToken?: string;
      }>('requestUploadUrl', {
        programId: program.programId,
        fileName: `${kind}-${createId()}.${compressed.extension}`,
        contentType: 'image/jpeg',
        ...(captchaToken ? { captchaToken } : {}),
      });
      if (issued.uploadUrl) {
        const response = await fetch(issued.uploadUrl, {
          method: 'PUT',
          headers: { 'Content-Type': 'image/jpeg' },
          body: compressed.blob,
        });
        if (!response.ok) throw new Error('The photo could not be uploaded. Please try again.');
      } else {
        // Emulator fallback: storage rules allow this token-scoped path without
        // an account and revalidate the image in the finalize trigger.
        await uploadBytes(ref(storage, issued.path), compressed.blob, { contentType: 'image/jpeg' });
      }
      return issued.path;
    },
    [getCaptchaToken, program.programId],
  );

  const validate = (): Record<string, string> => {
    const next: Record<string, string> = {};
    fields.forEach((field) => {
      if (isBlockedField(field)) return;
      const value = values[field.id];
      if (field.required && empty(value)) next[field.id] = 'This question is required.';
      if (!empty(value) && field.type === 'phone' && !isValidGhanaPhone(text(value))) {
        next[field.id] = 'Enter a valid Ghana phone number (0XX or +233XXXXXXXXX).';
      }
      if (!empty(value) && field.type === 'email' && !/^\S+@\S+\.\S+$/.test(text(value))) {
        next[field.id] = 'Enter a valid email address.';
      }
    });
    if (!nameField || contact.name.trim().length < 2) {
      next[nameField?.id ?? 'fullName'] = 'Enter your full name.';
    }
    if (phoneField && !empty(values[phoneField.id]) && !isValidGhanaPhone(text(values[phoneField.id]))) {
      next[phoneField.id] = 'Enter a valid Ghana phone number.';
    }
    if (paid) {
      if (!payment.methodId) next.paymentMethod = 'Choose a payment method.';
      if (isMalformedTransactionId(payment.transactionId)) next.transactionId = 'Enter a valid transaction ID or bank reference.';
      const amount = Number(payment.amountGhs);
      if (!Number.isFinite(amount) || amount <= 0) next.amountGhs = 'Enter the amount you sent in GHS.';
      if (payment.senderName.trim().length < 2) next.senderName = 'Enter the sender name.';
      if (payment.senderPhone.trim() && !isValidGhanaPhone(payment.senderPhone)) {
        next.senderPhone = 'Enter a valid Ghana phone number.';
      }
    }
    return next;
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitError('');
    const found = validate();
    setErrors(found);
    if (Object.keys(found).length) {
      setSubmitError('Please check the highlighted questions before submitting.');
      return;
    }

    setSubmitting(true);
    const captchaToken = await getCaptchaToken('submit_registration');
    try {
      const answers: Record<string, AnswerValue> = {};
      fields.forEach((field) => {
        if (isBlockedField(field)) return;
        const value = values[field.id];
        if (value !== undefined && !empty(value)) answers[field.id] = value;
      });
      const normalizedPhone = contact.phone.trim() ? normalizeGhanaPhone(contact.phone) : null;
      const submission: RegistrationSubmission = {
        programId: program.programId,
        ticketTypeId: selectedTicket.id,
        answers,
        contact: {
          name: contact.name.trim(),
          ...(contact.email.trim() ? { email: contact.email.trim() } : {}),
          ...(normalizedPhone ? { phone: normalizedPhone } : {}),
        },
        ...(paid
          ? {
              payment: {
                methodId: payment.methodId,
                transactionId: payment.transactionId.trim(),
                amountPesewas: Math.round(Number(payment.amountGhs) * 100),
                senderName: payment.senderName.trim(),
                ...(payment.senderPhone.trim() && normalizeGhanaPhone(payment.senderPhone)
                  ? { senderPhone: normalizeGhanaPhone(payment.senderPhone) as string }
                  : {}),
                ...(payment.payerName.trim() ? { payerName: payment.payerName.trim() } : {}),
                ...(payment.referenceCode.trim() ? { referenceCode: payment.referenceCode.trim() } : {}),
                ...(payment.screenshotPath ? { screenshotToken: payment.screenshotPath } : {}),
              },
            }
          : {}),
        ...(captchaToken ? { captchaToken } : {}),
        ...(draftId ? { draftId } : {}),
      };
      const parsed = registrationSubmissionSchema.safeParse(submission);
      if (!parsed.success) {
        const first = parsed.error.issues[0];
        setSubmitError(first?.message ?? 'Please check your details and try again.');
        return;
      }
      const response = await callFunction<SubmitResponse, RegistrationSubmission>('submitRegistration', parsed.data);
      try {
        localStorage.removeItem(draftKey);
      } catch {
        // Draft cleanup is best-effort.
      }
      setSuccess({ code: response.ticketCode ?? response.code, paid });
    } catch (error) {
      setSubmitError(error instanceof Error ? error.message : 'We could not submit your registration. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  if (success) {
    return (
      <div className="pub-success-card yv-stack" role="status">
        <h3>{success.paid ? 'Your registration was received' : "You're registered"}</h3>
        <p>
          {success.paid
            ? 'The organizer will review your payment and issue your ticket after approval. Keep your transaction ID handy.'
            : 'Your place is confirmed. You can open your ticket below at any time.'}
        </p>
        {success.code ? (
          <a className="yv-btn yv-btn-primary" href={`/t/${encodeURIComponent(success.code)}`}>
            Get your ticket
          </a>
        ) : (
          <p className="yv-muted">
            Already registered? <a href="/lookup">Get your ticket</a> once it is ready.
          </p>
        )}
        <p className="yv-tiny">Never share your PIN or password. We will never ask you for them.</p>
        <p>
          Planning something yourself? <a href={HOST_EVENT_URL}>Host your own event</a> on Yivents.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="yv-stack">
      {submitError ? <ErrorBanner message={submitError} onDismiss={() => setSubmitError('')} /> : null}
      <p className="yv-tiny yv-muted">
        Your answers are saved as a draft on this device only. Email is optional; phone is used for your ticket lookup.
      </p>

      {tickets.length > 1 ? (
        <div className="yv-field">
          <label htmlFor="ticket-type">Ticket type</label>
          <select
            id="ticket-type"
            value={selectedTicket.id}
            onChange={(event) => setTicketTypeId(event.target.value)}
          >
            {tickets.map((ticket) => (
              <option key={ticket.id} value={ticket.id}>
                {ticket.name} — {ticket.pricePesewas === 0 ? 'Free' : formatGHS(ticket.pricePesewas)}
              </option>
            ))}
          </select>
        </div>
      ) : (
        <p className="yv-muted">
          Ticket: <strong>{selectedTicket.name}</strong> — {selectedTicket.pricePesewas === 0 ? 'Free' : formatGHS(selectedTicket.pricePesewas)}
        </p>
      )}

      <div className="pub-form-sections">
        {sections.map((section) => (
          <fieldset className="pub-form-section" key={section.name}>
            <legend>{section.name}</legend>
            {section.items.map((field) => (
              <FormFieldRenderer
                key={field.id}
                field={field}
                value={values[field.id]}
                error={errors[field.id]}
                onChange={(value) => updateValue(field, value)}
                onUpload={(file) => uploadImage(file, 'field')}
              />
            ))}
          </fieldset>
        ))}
      </div>

      {paid ? (
        <section className="pub-payment-panel yv-stack" aria-labelledby="payment-heading">
          <h3 id="payment-heading">Payment details</h3>
          <p className="yv-tiny">
            Ticket price: <strong>{formatGHS(selectedTicket.pricePesewas)}</strong>. Yivents never processes or holds payments —
            you pay the organizer directly.
          </p>
          <div className="pub-payment-instructions">
            {program.paymentInstructions || methods.map((method) => method.instructions).filter(Boolean).join('\n') || (
              'The organizer has not published payment instructions in this listing. Contact the organizer before sending any money.'
            )}
          </div>
          <p className="yv-tiny"><strong>Network charges are your responsibility.</strong></p>

          {methods.length > 0 ? (
            <fieldset aria-describedby={errors.paymentMethod ? 'payment-method-error' : undefined}>
              <legend>Payment method</legend>
              {methods.map((method) => (
                <div className="pub-choice-row" key={method.id}>
                  <input
                    type="radio"
                    id={`payment-${method.id}`}
                    name="payment-method"
                    checked={payment.methodId === method.id}
                    onChange={() => setPayment((previous) => ({ ...previous, methodId: method.id }))}
                  />
                  <label htmlFor={`payment-${method.id}`}>
                    {method.network ?? method.bankName ?? method.accountName}
                    {method.number ? ` — ${method.number}` : ''}
                    {method.accountNumber ? ` — ${method.accountNumber}` : ''}
                    {method.accountName ? ` (${method.accountName})` : ''}
                  </label>
                </div>
              ))}
              {errors.paymentMethod ? <p className="yv-field-error" id="payment-method-error" role="alert">{errors.paymentMethod}</p> : null}
            </fieldset>
          ) : (
            <div className="yv-field">
              <label htmlFor="payment-method-fallback">Payment method</label>
              <select
                id="payment-method-fallback"
                value={payment.methodId}
                onChange={(event) => setPayment((previous) => ({ ...previous, methodId: event.target.value }))}
              >
                <option value="">Choose one…</option>
                <option value="mtn_momo">MTN MoMo</option>
                <option value="telecel_cash">Telecel Cash</option>
                <option value="airteltigo_money">AirtelTigo Money</option>
                <option value="bank">Bank transfer</option>
              </select>
            </div>
          )}

          <div className="yv-field">
            <label htmlFor="transaction-id">Transaction ID or bank reference</label>
            <input
              id="transaction-id"
              value={payment.transactionId}
              aria-invalid={Boolean(errors.transactionId)}
              onChange={(event) => setPayment((previous) => ({ ...previous, transactionId: event.target.value }))}
            />
            {errors.transactionId ? <p className="yv-field-error" role="alert">{errors.transactionId}</p> : null}
          </div>
          <div className="yv-field">
            <label htmlFor="amount-ghs">Amount sent (GHS)</label>
            <input
              id="amount-ghs"
              type="number"
              step="0.01"
              min="0.01"
              inputMode="decimal"
              value={payment.amountGhs}
              aria-invalid={Boolean(errors.amountGhs)}
              onChange={(event) => setPayment((previous) => ({ ...previous, amountGhs: event.target.value }))}
            />
            {errors.amountGhs ? <p className="yv-field-error" role="alert">{errors.amountGhs}</p> : null}
          </div>
          <div className="yv-field">
            <label htmlFor="sender-name">Sender name on the payment</label>
            <input
              id="sender-name"
              value={payment.senderName}
              aria-invalid={Boolean(errors.senderName)}
              onChange={(event) => setPayment((previous) => ({ ...previous, senderName: event.target.value }))}
            />
            {errors.senderName ? <p className="yv-field-error" role="alert">{errors.senderName}</p> : null}
          </div>
          <div className="yv-field">
            <label htmlFor="sender-phone">Sender number (optional)</label>
            <input
              id="sender-phone"
              type="tel"
              inputMode="tel"
              placeholder="+233"
              value={payment.senderPhone}
              aria-invalid={Boolean(errors.senderPhone)}
              onChange={(event) => setPayment((previous) => ({ ...previous, senderPhone: event.target.value }))}
            />
            {errors.senderPhone ? <p className="yv-field-error" role="alert">{errors.senderPhone}</p> : null}
          </div>
          <div className="yv-field">
            <label htmlFor="payer-name">Payer name (optional)</label>
            <input
              id="payer-name"
              value={payment.payerName}
              onChange={(event) => setPayment((previous) => ({ ...previous, payerName: event.target.value }))}
            />
          </div>
          <div className="yv-field">
            <label htmlFor="reference-code">Reference code (optional)</label>
            <input
              id="reference-code"
              value={payment.referenceCode}
              onChange={(event) => setPayment((previous) => ({ ...previous, referenceCode: event.target.value }))}
            />
          </div>
          <FormFieldRenderer
            field={{
              id: 'payment-screenshot',
              type: 'file',
              label: 'Payment screenshot (optional)',
              description: 'A clear photo of the confirmation message. Images are compressed before upload.',
              required: false,
              section: 'Payment',
              order: 99,
            }}
            value={payment.screenshotPath}
            onChange={(value) => setPayment((previous) => ({ ...previous, screenshotPath: text(value) }))}
            onUpload={(file) => uploadImage(file, 'screenshot')}
          />
          <WarningBanner>
            Payment is made directly to the organizer. Your registration is reviewed after payment; your ticket is not instant.
          </WarningBanner>
        </section>
      ) : null}

      <div className="pub-notice">
        <p><strong>Never share your PIN or password.</strong> We will never ask you for them.</p>
        <p className="yv-tiny">{program.privacyNotice}</p>
      </div>

      <Button type="submit" size="lg" loading={submitting}>
        {paid ? 'Submit registration for review' : 'Register'}
      </Button>
      <p className="yv-tiny">
        Already registered? <a href="/lookup">Get your ticket</a>.
      </p>
    </form>
  );
}
