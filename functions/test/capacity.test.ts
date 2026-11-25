import type { Program, TicketType } from '@yivents/shared';
import {
  assertCapacityAvailable,
  capacityDelta,
  capacityLimits,
  counterUpdates,
  statusToSlot,
} from '../src/capacity';

function program(overall?: number, perTicketType: Record<string, number> = {}): Program {
  return {
    capacity: { overall, perTicketType, almostFullThreshold: 0.1 },
    counters: { confirmed: 0, pending: 0, waitlisted: 0, checkedIn: 0 },
    settings: {},
  } as unknown as Program;
}

describe('capacity transaction behaviour', () => {
  it('combines overall and per-ticket limits', () => {
    const limits = capacityLimits(program(100, { vip: 10 }), 'vip', { capacity: 8 } as TicketType);
    expect(limits.overall).toBe(100);
    expect(limits.perType).toBe(10);
    expect(limits.threshold).toBe(0.1);
  });

  it('refuses a spot once pending + confirmed reaches capacity', () => {
    const full = program(1);
    full.counters.pending = 1;
    expect(() => assertCapacityAvailable(full, 0, 'general')).toThrow();
  });

  it('releases a spot on reject/cancel and reuses it on approval', () => {
    expect(capacityDelta('none', 'pending')).toEqual({ pending: 1, confirmed: 0, taken: 1 });
    expect(capacityDelta('pending', 'verified')).toEqual({ pending: -1, confirmed: 1, taken: 0 });
    expect(capacityDelta('pending', 'none')).toEqual({ pending: -1, confirmed: 0, taken: -1 });
    expect(capacityDelta('verified', 'none')).toEqual({ pending: 0, confirmed: -1, taken: -1 });
    expect(statusToSlot('waitlisted')).toBe('pending');
    expect(statusToSlot('cancelled')).toBe('none');
  });

  it('never oversells when two submissions serialize on the same counter', () => {
    // Mimics runTransaction: each attempt re-reads state before applying its delta.
    const state = { taken: 0 };
    const reserve = () => {
      const fresh = program(1);
      assertCapacityAvailable(fresh, state.taken, 'general');
      state.taken += capacityDelta('none', 'pending').taken;
    };
    reserve();
    expect(() => reserve()).toThrow();
    expect(state.taken).toBe(1);
  });

  it('emits atomic increment updates only for changed counters', () => {
    const updates = counterUpdates(capacityDelta('none', 'verified'));
    expect(Object.keys(updates)).toContain('counters.confirmed');
    expect(Object.keys(updates)).not.toContain('counters.pending');
    expect(Object.keys(counterUpdates(capacityDelta('pending', 'none')))).toContain('counters.pending');
  });
});
