/** Capacity helpers used by submission, approval, rejection and cancellation. */
import { FieldValue } from 'firebase-admin/firestore';
import { isAlmostFull, type Program, type TicketType } from '@yivents/shared';
import { fail } from './errors';

export interface CapacityLimits {
  overall?: number;
  perType?: number;
  threshold: number;
}

export function capacityLimits(program: Program, ticketTypeId: string, ticketType?: TicketType): CapacityLimits {
  const explicit = program.capacity.perTicketType[ticketTypeId];
  return {
    overall: program.capacity.overall && program.capacity.overall > 0 ? program.capacity.overall : undefined,
    perType: explicit && explicit > 0 ? explicit : ticketType?.capacity,
    threshold: program.capacity.almostFullThreshold ?? 0.1,
  };
}

/** `taken` includes pending submissions: a spot is reserved as soon as submitted. */
export function assertCapacityAvailable(
  program: Program,
  takenByType: number,
  ticketTypeId: string,
  ticketType?: TicketType,
): void {
  const limits = capacityLimits(program, ticketTypeId, ticketType);
  const confirmedPlusPending = (program.counters.confirmed ?? 0) + (program.counters.pending ?? 0);
  if (limits.overall !== undefined && confirmedPlusPending >= limits.overall) {
    fail('resource-exhausted', 'This programme is fully booked.');
  }
  if (limits.perType !== undefined && takenByType >= limits.perType) {
    fail('resource-exhausted', 'This ticket type is fully booked.');
  }
}

export function capacityState(program: Program, taken = (program.counters.confirmed ?? 0) + (program.counters.pending ?? 0)) {
  const { overall, threshold } = capacityLimits(program, '', undefined);
  return {
    total: overall,
    taken,
    almostFull: isAlmostFull(taken, overall, threshold),
    full: overall !== undefined && taken >= overall,
  };
}

export type SlotStatus = 'none' | 'pending' | 'verified';

/** Pure delta calculation: callers apply these inside one Firestore transaction. */
export function capacityDelta(previous: SlotStatus, next: SlotStatus) {
  return {
    pending: (next === 'pending' ? 1 : 0) - (previous === 'pending' ? 1 : 0),
    confirmed: (next === 'verified' ? 1 : 0) - (previous === 'verified' ? 1 : 0),
    taken: (next === 'none' ? 0 : 1) - (previous === 'none' ? 0 : 1),
  };
}

export function statusToSlot(status: string): SlotStatus {
  if (status === 'pending' || status === 'waitlisted') return 'pending';
  if (status === 'verified') return 'verified';
  return 'none';
}

export function counterUpdates(delta: ReturnType<typeof capacityDelta>): Record<string, unknown> {
  const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() };
  if (delta.pending !== 0) updates['counters.pending'] = FieldValue.increment(delta.pending);
  if (delta.confirmed !== 0) updates['counters.confirmed'] = FieldValue.increment(delta.confirmed);
  return updates;
}

export function checkedInUpdate(checkedInAt: string): Record<string, unknown> {
  return { 'counters.checkedIn': FieldValue.increment(1), updatedAt: checkedInAt };
}
