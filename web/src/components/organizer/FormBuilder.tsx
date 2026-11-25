'use client';

/** Simple, drag-free form builder shared by registration and feedback forms. */
import { deleteDoc, deleteField, doc, setDoc, updateDoc } from 'firebase/firestore';
import { useEffect, useState } from 'react';
import { isSensitiveLabel, slugify, type FieldType, type FormField } from '@yivents/shared';
import { Badge, Button, Card, ErrorBanner, Field, LoadingState, SuccessBanner, WarningBanner } from '@yivents/ui';
import { db, storageUrl } from '@/lib/firebase/client';
import { useFormFields } from './data';
import type { SessionUser } from '@/lib/auth';
import { uploadImage } from './upload';
import { friendlyError } from './utils';

const FIELD_TYPES: FieldType[] = [
  'short_text',
  'paragraph',
  'multiple_choice',
  'checkboxes',
  'dropdown',
  'linear_scale',
  'date',
  'time',
  'number',
  'email',
  'phone',
  'file',
  'rating',
];

const LABELS: Record<FieldType, string> = {
  short_text: 'Short text',
  paragraph: 'Paragraph',
  multiple_choice: 'Multiple choice (one answer)',
  checkboxes: 'Checkboxes (many answers)',
  dropdown: 'Dropdown',
  linear_scale: 'Linear scale',
  date: 'Date',
  time: 'Time',
  number: 'Number',
  email: 'Email',
  phone: 'Phone',
  file: 'File upload',
  rating: 'Rating (stars)',
};

function cleanField(field: FormField): Record<string, unknown> {
  const result: Record<string, unknown> = {
    id: field.id,
    type: field.type,
    label: field.label.trim(),
    required: field.required,
    section: field.section.trim() || 'General',
    order: field.order,
  };
  // Explicit deletes let a cleared option disappear instead of staying stale.
  result.description = field.description?.trim() ? field.description.trim() : deleteField();
  result.options = field.options?.length ? field.options : deleteField();
  result.imagePath = field.imagePath || deleteField();
  result.caption = field.caption?.trim() ? field.caption.trim() : deleteField();
  result.min = typeof field.min === 'number' ? field.min : deleteField();
  result.max = typeof field.max === 'number' ? field.max : deleteField();
  result.sensitiveFlag = field.sensitiveFlag || deleteField();
  return result;
}

function FieldPreview({ field, imageUrl }: { field: FormField; imageUrl?: string }) {
  const options = (field.options ?? []).filter(Boolean);
  const nativeType =
    field.type === 'phone'
      ? 'tel'
      : field.type === 'email' || field.type === 'number' || field.type === 'date' || field.type === 'time'
        ? field.type
        : 'text';
  return (
    <div style={{ marginBottom: '1rem' }}>
      {imageUrl ? <img src={imageUrl} alt={field.caption || 'Question'} style={{ maxWidth: '100%', borderRadius: 8 }} /> : null}
      {field.caption ? <p className="yv-tiny yv-muted">{field.caption}</p> : null}
      <p style={{ fontWeight: 700, margin: '.25rem 0' }}>
        {field.label || 'Untitled question'}
        {field.required ? <span aria-hidden="true"> *</span> : null}
      </p>
      {field.description ? <p className="yv-tiny yv-muted">{field.description}</p> : null}
      {['short_text', 'email', 'phone', 'number', 'date', 'time'].includes(field.type) ? (
        <input className="org-input" type={nativeType} disabled style={{ width: '100%', minHeight: 44 }} />
      ) : null}
      {field.type === 'paragraph' ? <textarea className="org-input" disabled rows={3} style={{ width: '100%' }} /> : null}
      {field.type === 'dropdown' ? (
        <select className="org-input" disabled style={{ minHeight: 44 }}>
          <option>Choose an option</option>
          {options.map((option) => <option key={option}>{option}</option>)}
        </select>
      ) : null}
      {field.type === 'multiple_choice' || field.type === 'checkboxes' ? (
        <div>
          {options.length ? options.map((option) => (
            <label key={option} style={{ display: 'block', minHeight: 44 }}>
              <input type={field.type === 'checkboxes' ? 'checkbox' : 'radio'} name={`preview-${field.id}`} disabled /> {option}
            </label>
          )) : <p className="yv-tiny yv-muted">Add options to see them here.</p>}
        </div>
      ) : null}
      {(field.type === 'linear_scale' || field.type === 'rating') ? (
        <div style={{ display: 'flex', gap: '.3rem', flexWrap: 'wrap' }}>
          {Array.from({ length: Math.max(1, Math.min(10, (field.max ?? 5) - (field.min ?? 1) + 1)) }, (_, i) => (
            <button key={i} type="button" className="yv-btn yv-btn-sm yv-btn-outline" disabled>
              {(field.min ?? 1) + i}
            </button>
          ))}
        </div>
      ) : null}
      {field.type === 'file' ? <input type="file" disabled aria-label={field.label} /> : null}
      {field.sensitiveFlag === 'flagged' ? (
        <WarningBanner>This question asks for a secret. Participants should never enter a PIN or password here.</WarningBanner>
      ) : null}
    </div>
  );
}

export function FormBuilder({
  programId,
  user,
  kind,
  disabled = false,
}: {
  programId: string;
  user: SessionUser;
  kind: 'registration' | 'feedback';
  disabled?: boolean;
}) {
  const collectionName = kind === 'feedback' ? 'feedbackFields' : 'formFields';
  const { fields: loaded, loading, error: loadError } = useFormFields(programId, kind);
  const [draft, setDraft] = useState<FormField[]>([]);
  const [ready, setReady] = useState(false);
  const [allowedSensitive, setAllowedSensitive] = useState<string[]>([]);
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const loadedKey = JSON.stringify(loaded);

  useEffect(() => {
    if (loading) return;
    setDraft([...loaded].sort((a, b) => a.order - b.order));
    setReady(true);
  }, [loadedKey, loading]);

  useEffect(() => {
    let alive = true;
    Promise.all(
      loaded.map(async (field) => {
        if (!field.imagePath) return null;
        try {
          return [field.id, await storageUrl(field.imagePath)] as const;
        } catch {
          return null;
        }
      }),
    ).then((entries) => {
      if (!alive) return;
      const urls: Record<string, string> = {};
      entries.forEach((entry) => {
        if (entry) urls[entry[0]] = entry[1] ?? '';
      });
      setImageUrls(urls);
    });
    return () => {
      alive = false;
    };
  }, [loadedKey]);

  const patch = (id: string, change: Partial<FormField>) =>
    setDraft((current) => current.map((field) => (field.id === id ? { ...field, ...change } : field)));

  const addField = () => {
    const ref = doc(collectionNameRef(programId, collectionName));
    setDraft((current) => [
      ...current,
      { id: ref.id, type: 'short_text', label: '', required: false, section: 'General', order: current.length },
    ]);
  };

  const move = (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= draft.length) return;
    const next = [...draft];
    [next[index], next[target]] = [next[target], next[index]];
    setDraft(next.map((field, i) => ({ ...field, order: i })));
  };

  const remove = (id: string) =>
    setDraft((current) => current.filter((field) => field.id !== id).map((field, i) => ({ ...field, order: i })));

  const uploadQuestionImage = async (field: FormField, file: File) => {
    setError('');
    try {
      const { path, url } = await uploadImage(user.uid, programId, `question-${slugify(field.label) || field.id}`, file);
      patch(field.id, { imagePath: path });
      setImageUrls((current) => ({ ...current, [field.id]: url }));
    } catch (err) {
      setError(friendlyError(err, 'The question image could not be uploaded.'));
    }
  };

  const sensitiveBlocked = draft.some((field) => isSensitiveLabel(field.label) && !allowedSensitive.includes(field.id));

  const save = async () => {
    setError('');
    setMessage('');
    if (sensitiveBlocked) {
      setError('A question asks for a PIN, password or OTP. Remove it, or tick “allow with warning” to flag it.');
      return;
    }
    if (draft.some((field) => !field.label.trim())) {
      setError('Every question needs a label before you can save.');
      return;
    }
    setBusy(true);
    try {
      const existing = new Map(loaded.map((field) => [field.id, field]));
      for (const field of draft) {
        const data = cleanField({
          ...field,
          sensitiveFlag: isSensitiveLabel(field.label) ? 'flagged' : undefined,
        });
        const target = doc(db, 'programs', programId, collectionName, field.id);
        if (existing.has(field.id)) await updateDoc(target, data);
        else await setDoc(target, data);
      }
      for (const old of loaded) {
        if (!draft.some((field) => field.id === old.id)) {
          await deleteDoc(doc(db, 'programs', programId, collectionName, old.id));
        }
      }
      setMessage(`Saved ${draft.length} question${draft.length === 1 ? '' : 's'}.`);
    } catch (err) {
      setError(friendlyError(err, 'Could not save the form. Please try again.'));
    } finally {
      setBusy(false);
    }
  };

  if (loading || !ready) return <LoadingState label="Loading questions…" />;

  const sections = Array.from(new Set(draft.map((field) => field.section.trim() || 'General')));

  return (
    <div style={{ display: 'grid', gap: '1.25rem', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}>
      <div>
        {loadError ? <ErrorBanner message={loadError} /> : null}
        {error ? <ErrorBanner message={error} onDismiss={() => setError('')} /> : null}
        {message ? <SuccessBanner message={message} /> : null}
        {draft.length === 0 ? (
          <Card>
            <p className="yv-muted">No questions yet. Add your first question below.</p>
          </Card>
        ) : null}
        {draft.map((field, index) => {
          const sensitive = isSensitiveLabel(field.label);
          const needsChoice = ['multiple_choice', 'checkboxes', 'dropdown'].includes(field.type);
          const needsScale = ['linear_scale', 'rating'].includes(field.type);
          return (
            <Card key={field.id} style={{ marginBottom: '.9rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '.5rem', alignItems: 'center' }}>
                <strong>Question {index + 1}</strong>
                <div style={{ display: 'flex', gap: '.25rem' }}>
                  <Button variant="ghost" size="sm" disabled={disabled || index === 0} onClick={() => move(index, -1)} aria-label={`Move question ${index + 1} up`}>↑</Button>
                  <Button variant="ghost" size="sm" disabled={disabled || index === draft.length - 1} onClick={() => move(index, 1)} aria-label={`Move question ${index + 1} down`}>↓</Button>
                  <Button variant="danger" size="sm" disabled={disabled} onClick={() => remove(field.id)} aria-label={`Remove question ${index + 1}`}>Remove</Button>
                </div>
              </div>

              <div style={{ display: 'grid', gap: '0 1rem', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' }}>
                <Field label="Question type" id={`${field.id}-type`}>
                  <select className="org-input" id={`${field.id}-type`} value={field.type} disabled={disabled} onChange={(event) => patch(field.id, { type: event.target.value as FieldType })}>
                    {FIELD_TYPES.map((type) => <option key={type} value={type}>{LABELS[type]}</option>)}
                  </select>
                </Field>
                <Field label="Section" id={`${field.id}-section`} hint="Group questions under a heading">
                  <input className="org-input" id={`${field.id}-section`} value={field.section} disabled={disabled} onChange={(event) => patch(field.id, { section: event.target.value })} />
                </Field>
              </div>

              <Field label="Question" id={`${field.id}-label`} required>
                <input className="org-input" id={`${field.id}-label`} value={field.label} disabled={disabled} onChange={(event) => patch(field.id, { label: event.target.value })} placeholder="e.g. What is your full name?" />
              </Field>
              <Field label="Description (optional)" id={`${field.id}-description`}>
                <input className="org-input" id={`${field.id}-description`} value={field.description ?? ''} disabled={disabled} onChange={(event) => patch(field.id, { description: event.target.value })} />
              </Field>

              <label style={{ display: 'flex', alignItems: 'center', gap: '.6rem', minHeight: 44 }}>
                <input type="checkbox" checked={field.required} disabled={disabled} onChange={(event) => patch(field.id, { required: event.target.checked })} /> Required
              </label>

              {needsChoice ? (
                <Field label="Options" id={`${field.id}-options`} hint="Separate options with commas">
                  <input className="org-input" id={`${field.id}-options`} value={(field.options ?? []).join(', ')} disabled={disabled} onChange={(event) => patch(field.id, { options: event.target.value.split(',').map((option) => option.trim()).filter(Boolean) })} />
                </Field>
              ) : null}
              {needsScale ? (
                <div style={{ display: 'flex', gap: '.8rem' }}>
                  <Field label="From" id={`${field.id}-min`}>
                    <input className="org-input" id={`${field.id}-min`} type="number" value={field.min ?? 1} disabled={disabled} onChange={(event) => patch(field.id, { min: Number(event.target.value) })} />
                  </Field>
                  <Field label="To" id={`${field.id}-max`}>
                    <input className="org-input" id={`${field.id}-max`} type="number" value={field.max ?? 5} disabled={disabled} onChange={(event) => patch(field.id, { max: Number(event.target.value) })} />
                  </Field>
                </div>
              ) : null}

              <Field label="Question image (optional)" id={`${field.id}-image`} hint="JPEG, PNG or WebP, under 6 MB">
                <input id={`${field.id}-image`} type="file" accept="image/jpeg,image/png,image/webp" disabled={disabled} onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void uploadQuestionImage(field, file);
                }} />
              </Field>
              {imageUrls[field.id] ? (
                <img src={imageUrls[field.id]} alt="Uploaded question" style={{ maxWidth: 180, borderRadius: 8 }} />
              ) : null}
              <Field label="Image caption (optional)" id={`${field.id}-caption`}>
                <input className="org-input" id={`${field.id}-caption`} value={field.caption ?? ''} disabled={disabled} onChange={(event) => patch(field.id, { caption: event.target.value })} />
              </Field>

              {sensitive ? (
                <div style={{ marginTop: '.5rem' }}>
                  <WarningBanner>
                    This looks like a PIN, password or OTP question. Never collect secrets on a registration form.
                  </WarningBanner>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '.6rem', minHeight: 44 }}>
                    <input
                      type="checkbox"
                      checked={allowedSensitive.includes(field.id)}
                      disabled={disabled}
                      onChange={(event) => setAllowedSensitive((current) =>
                        event.target.checked ? [...current, field.id] : current.filter((id) => id !== field.id),
                      )}
                    />
                    Allow with warning (the field will be flagged)
                  </label>
                  {allowedSensitive.includes(field.id) ? <Badge tone="warning">Flagged</Badge> : null}
                </div>
              ) : null}
            </Card>
          );
        })}

        <Button variant="outline" onClick={addField} disabled={disabled || busy}>Add question</Button>{' '}
        <Button onClick={save} loading={busy} disabled={disabled}>Save questions</Button>
      </div>

      <Card>
        <h2 style={{ marginTop: 0 }}>Live preview</h2>
        <p className="yv-tiny yv-muted">This is how participants will see each question.</p>
        {sections.map((section) => (
          <div key={section}>
            <h3 style={{ fontSize: '1rem', marginTop: '1rem' }}>{section}</h3>
            {draft.filter((field) => (field.section.trim() || 'General') === section).map((field) => (
              <FieldPreview key={field.id} field={field} imageUrl={imageUrls[field.id]} />
            ))}
          </div>
        ))}
      </Card>
    </div>
  );
}

function collectionNameRef(programId: string, name: string) {
  return collection(db, 'programs', programId, name);
}
