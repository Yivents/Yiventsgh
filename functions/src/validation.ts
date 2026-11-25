/** Input parsing, sensitive-answer protection and payment amount validation. */
import {
  computeOverShort,
  isSensitiveLabel,
  type FormField,
  type PaymentMethod,
  type Program,
} from '@yivents/shared';
import { z } from 'zod';
import {
  MAX_PAYMENT_MULTIPLE_OF_PRICE,
  MAX_PAYMENT_PESEWAS,
} from './config';
import { fail } from './errors';
import { settingsOf, type PaymentRecordExtras, type ProgramSettingsExtras } from './types';

export type AnswerValue = string | string[] | number | boolean;

export function parseInput<T extends z.ZodTypeAny>(schema: T, data: unknown): z.infer<T> {
  const result = schema.safeParse(data);
  if (!result.success) {
    fail('invalid-argument', result.error.issues[0]?.message ?? 'Invalid input.');
  }
  return result.data;
}

function hasAnswer(value: AnswerValue | undefined): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

/**
 * Required-field check plus PIN/password protection: blocked fields reject the
 * submission, flagged/sensitive fields are kept out of storage and flagged.
 */
export function validateAnswers(
  fields: FormField[],
  answers: Record<string, AnswerValue>,
): { answers: Record<string, AnswerValue>; flagReasons: string[] } {
  const cleaned: Record<string, AnswerValue> = {};
  const flagReasons: string[] = [];
  for (const field of fields) {
    const value = answers[field.id];
    const sensitive = field.sensitiveFlag != null || isSensitiveLabel(field.label);
    if (field.required && !hasAnswer(value)) {
      fail('invalid-argument', `Answer required: ${field.label}`);
    }
    if (!hasAnswer(value)) continue;
    if (sensitive) {
      if (field.sensitiveFlag === 'blocked') {
        fail('invalid-argument', `Do not submit a PIN, password or secret in “${field.label}”.`);
      }
      flagReasons.push(`Sensitive answer removed: ${field.label}`);
      continue; // never persist secrets
    }
    cleaned[field.id] = value;
  }
  return { answers: cleaned, flagReasons };
}

/** Reject impossible amounts before doing any money maths. */
export function checkAmountRange(paidPesewas: number, pricePesewas: number, settings: ProgramSettingsExtras): void {
  const ceiling = settings.maxPaymentPesewas && settings.maxPaymentPesewas > 0
    ? settings.maxPaymentPesewas
    : MAX_PAYMENT_PESEWAS;
  if (!Number.isSafeInteger(paidPesewas) || paidPesewas <= 0) {
    fail('invalid-argument', 'Enter a valid amount in pesewas.');
  }
  if (paidPesewas > ceiling || paidPesewas > Math.max(pricePesewas * MAX_PAYMENT_MULTIPLE_OF_PRICE, 100_000)) {
    fail('invalid-argument', 'The amount paid is out of range for this ticket.');
  }
}

export function computePaymentTotals(
  pricePesewas: number,
  paidPesewas: number,
  settings: ProgramSettingsExtras,
): { overByPesewas: number; shortByPesewas: number } {
  checkAmountRange(paidPesewas, pricePesewas, settings);
  return computeOverShort(
    pricePesewas,
    paidPesewas,
    Math.max(0, settings.paymentAllowancePesewas ?? settings.allowancePesewas ?? 0),
    Math.max(0, settings.paymentTolerancePesewas ?? settings.tolerancePesewas ?? 0),
  );
}

export function requirePaymentMethod(methodId: string, methods: PaymentMethod[]): PaymentMethod {
  const method = methods.find((m) => m.id === methodId && m.enabled);
  if (!method) fail('invalid-argument', 'That payment method is not available.');
  return method;
}

export function paymentRecord(
  method: PaymentMethod,
  input: {
    transactionId: string;
    amountPesewas: number;
    senderName: string;
    senderPhone?: string;
    payerName?: string;
    referenceCode?: string;
  },
  pricePesewas: number,
  program: Program,
): PaymentRecordExtras {
  const totals = computePaymentTotals(pricePesewas, input.amountPesewas, settingsOf(program));
  return {
    methodId: method.id,
    methodType: method.type,
    transactionId: input.transactionId.trim(),
    amountPaidPesewas: input.amountPesewas,
    ticketPricePesewas: pricePesewas,
    currency: method.currency,
    ...totals,
    senderName: input.senderName.trim(),
    senderPhone: input.senderPhone?.trim() || undefined,
    payerName: input.payerName?.trim() || undefined,
    referenceCode: input.referenceCode?.trim() || undefined,
    verified: false,
    verificationStatus: 'unverified',
  };
}

export function validateDeadline(next: string, program: Program): string {
  const parsed = z.string().datetime({ offset: true }).safeParse(next);
  if (!parsed.success) fail('invalid-argument', 'Enter a valid deadline with a timezone.');
  const nextMs = Date.parse(parsed.data);
  const currentMs = Date.parse(program.registrationDeadline);
  const endMs = program.event.endAt ? Date.parse(program.event.endAt) : Date.parse(program.event.startAt);
  if (nextMs <= Date.now()) fail('invalid-argument', 'The new deadline must be in the future.');
  if (!Number.isFinite(currentMs) || nextMs <= currentMs) fail('invalid-argument', 'The new deadline must be later than the current one.');
  if (!Number.isFinite(endMs) || nextMs > endMs) fail('invalid-argument', 'The deadline cannot be after the event ends.');
  return parsed.data;
}
