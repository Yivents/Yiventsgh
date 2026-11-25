'use client';

/** Reusable renderer for every shared FieldType. All output is plain text/React nodes. */
import { useState, type ChangeEvent } from 'react';
import { Field, LoadingState } from '@yivents/ui';
import { isSensitiveLabel } from '@yivents/shared';
import type { AnswerValue, PublicFormField } from './types';

interface Props {
  field: PublicFormField;
  value: AnswerValue | undefined;
  error?: string;
  onChange: (value: AnswerValue) => void;
  /** Compresses and uploads the file, returning a Storage path/token. */
  onUpload: (file: File) => Promise<string>;
}

function asText(value: AnswerValue | undefined): string {
  return typeof value === 'string' ? value : '';
}

function asList(value: AnswerValue | undefined): string[] {
  return Array.isArray(value) ? value : [];
}

function inputId(field: PublicFormField) {
  return `field-${field.id.replace(/[^A-Za-z0-9_-]/g, '_')}`;
}

export function FormFieldRenderer({ field, value, error, onChange, onUpload }: Props) {
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const labelSensitive = isSensitiveLabel(field.label);
  const blocked = field.sensitiveFlag === 'blocked' || (labelSensitive && field.sensitiveFlag !== 'flagged');
  const flagged = field.sensitiveFlag === 'flagged' || labelSensitive;
  const id = inputId(field);

  const warning = flagged ? (
    <p className="pub-sensitive" role="note">
      {blocked
        ? 'This question asks for a PIN, password or secret. We have hidden it — never share your PIN or password with an event organizer.'
        : 'Warning: this question mentions a PIN, password or secret. Never share your real PIN or password; use a non-sensitive answer.'}
    </p>
  ) : null;

  if (blocked) {
    return (
      <div className="yv-field">
        <label htmlFor={id}>{field.label}</label>
        {field.description ? <p className="yv-tiny yv-muted">{field.description}</p> : null}
        {warning}
      </div>
    );
  }

  const options = Array.isArray(field.options) ? field.options : [];

  const handleFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setUploadError('');
    try {
      onChange(await onUpload(file));
    } catch (uploadFailure) {
      setUploadError(uploadFailure instanceof Error ? uploadFailure.message : 'That file could not be uploaded.');
    } finally {
      setUploading(false);
      event.target.value = '';
    }
  };

  const renderInput = () => {
    switch (field.type) {
      case 'paragraph':
        return (
          <textarea
            id={id}
            rows={4}
            value={asText(value)}
            required={field.required}
            aria-invalid={Boolean(error)}
            onChange={(event) => onChange(event.target.value)}
          />
        );
      case 'multiple_choice':
        return (
          <fieldset aria-describedby={error ? `${id}-error` : undefined}>
            <legend className="yv-visually-hidden">{field.label}</legend>
            {options.length === 0 ? <p className="yv-tiny yv-muted">No choices were provided for this question.</p> : null}
            {options.map((option, index) => (
              <div className="pub-choice-row" key={`${option}-${index}`}>
                <input
                  type="radio"
                  id={`${id}-${index}`}
                  name={id}
                  value={option}
                  checked={asText(value) === option}
                  onChange={() => onChange(option)}
                />
                <label htmlFor={`${id}-${index}`}>{option}</label>
              </div>
            ))}
          </fieldset>
        );
      case 'checkboxes':
        return (
          <fieldset aria-describedby={error ? `${id}-error` : undefined}>
            <legend className="yv-visually-hidden">{field.label}</legend>
            {options.map((option, index) => {
              const selected = asList(value).includes(option);
              return (
                <div className="pub-choice-row" key={`${option}-${index}`}>
                  <input
                    type="checkbox"
                    id={`${id}-${index}`}
                    checked={selected}
                    onChange={() =>
                      onChange(selected ? asList(value).filter((item) => item !== option) : [...asList(value), option])
                    }
                  />
                  <label htmlFor={`${id}-${index}`}>{option}</label>
                </div>
              );
            })}
          </fieldset>
        );
      case 'dropdown':
        return (
          <select
            id={id}
            value={asText(value)}
            required={field.required}
            aria-invalid={Boolean(error)}
            onChange={(event) => onChange(event.target.value)}
          >
            <option value="">Choose one…</option>
            {options.map((option, index) => (
              <option key={`${option}-${index}`} value={option}>
                {option}
              </option>
            ))}
          </select>
        );
      case 'linear_scale': {
        const min = typeof field.min === 'number' ? field.min : 1;
        const max = typeof field.max === 'number' ? field.max : 5;
        const count = Math.max(2, Math.min(10, max - min + 1));
        return (
          <div>
            <div className="pub-choice-grid" role="group" aria-label={field.label}>
              {Array.from({ length: count }, (_, index) => min + index).map((step) => (
                <button
                  type="button"
                  key={step}
                  className={`pub-choice-chip ${Number(value) === step ? 'pub-choice-chip-active' : ''}`}
                  aria-pressed={Number(value) === step}
                  onClick={() => onChange(step)}
                >
                  {step}
                </button>
              ))}
            </div>
            <div className="pub-scale-labels">
              <span>{min}</span>
              <span>{min + count - 1}</span>
            </div>
          </div>
        );
      }
      case 'rating':
        return (
          <div className="pub-choice-grid" role="group" aria-label={field.label}>
            {[1, 2, 3, 4, 5].map((score) => (
              <button
                type="button"
                key={score}
                className={`pub-choice-chip ${Number(value) === score ? 'pub-choice-chip-active' : ''}`}
                aria-label={`${score} out of 5`}
                aria-pressed={Number(value) === score}
                onClick={() => onChange(score)}
              >
                {score} ★
              </button>
            ))}
          </div>
        );
      case 'date':
        return (
          <input
            id={id}
            type="date"
            value={asText(value)}
            required={field.required}
            aria-invalid={Boolean(error)}
            onChange={(event) => onChange(event.target.value)}
          />
        );
      case 'time':
        return (
          <input
            id={id}
            type="time"
            value={asText(value)}
            required={field.required}
            aria-invalid={Boolean(error)}
            onChange={(event) => onChange(event.target.value)}
          />
        );
      case 'number':
        return (
          <input
            id={id}
            type="number"
            value={typeof value === 'number' || typeof value === 'string' ? String(value) : ''}
            min={field.min}
            max={field.max}
            required={field.required}
            aria-invalid={Boolean(error)}
            onChange={(event) => onChange(event.target.value === '' ? '' : Number(event.target.value))}
          />
        );
      case 'email':
        return (
          <input
            id={id}
            type="email"
            autoComplete="email"
            value={asText(value)}
            required={field.required}
            aria-invalid={Boolean(error)}
            onChange={(event) => onChange(event.target.value)}
          />
        );
      case 'phone':
        return (
          <input
            id={id}
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="+233 5X XXX XXXX"
            value={asText(value) || '+233'}
            required={field.required}
            aria-invalid={Boolean(error)}
            onFocus={() => {
              if (!asText(value)) onChange('+233');
            }}
            onChange={(event) => onChange(event.target.value)}
          />
        );
      case 'file':
        return (
          <div>
            <input id={id} type="file" accept="image/*" onChange={handleFile} aria-invalid={Boolean(error)} />
            {uploading ? <LoadingState label="Compressing and uploading…" /> : null}
            {asText(value) ? <p className="pub-file-name">File ready: {asText(value).split('/').pop()}</p> : null}
            {uploadError ? (
              <p className="yv-field-error" role="alert">
                {uploadError}
              </p>
            ) : null}
          </div>
        );
      case 'short_text':
      default:
        return (
          <input
            id={id}
            type="text"
            value={asText(value)}
            required={field.required}
            aria-invalid={Boolean(error)}
            onChange={(event) => onChange(event.target.value)}
          />
        );
    }
  };

  return (
    <div className="yv-field">
      {field.type === 'multiple_choice' || field.type === 'checkboxes' || field.type === 'linear_scale' || field.type === 'rating' ? (
        <>
          <label htmlFor={id}>
            {field.label}
            {field.required ? <span aria-hidden="true"> *</span> : null}
          </label>
          {field.description ? <p className="yv-tiny yv-muted">{field.description}</p> : null}
          {warning}
          {renderInput()}
        </>
      ) : (
        <>
          <Field
            id={id}
            label={field.label}
            hint={field.description}
            error={error}
            required={field.required}
          >
            {warning}
            {renderInput()}
          </Field>
        </>
      )}
      {field.imageUrl ? (
        <figure style={{ margin: '.6rem 0 0' }}>
          <img className="pub-field-image" src={field.imageUrl} alt={field.caption || field.label} loading="lazy" />
          {field.caption ? <figcaption className="pub-field-caption">{field.caption}</figcaption> : null}
        </figure>
      ) : null}
      {error && (field.type === 'multiple_choice' || field.type === 'checkboxes' || field.type === 'linear_scale' || field.type === 'rating') ? (
        <p className="yv-field-error" id={`${id}-error`} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}
