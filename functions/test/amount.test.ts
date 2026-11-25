import { computeOverShort, GHANA_TIMEZONE, type Program } from '@yivents/shared';
import { checkAmountRange, computePaymentTotals } from '../src/validation';
import { settingsOf } from '../src/types';

function programWith(extra: Record<string, unknown> = {}): Program {
  return {
    settings: { ...settingsOf({ settings: {} as Program['settings'] }), ...extra },
  } as unknown as Program;
}

describe('payment amount computation', () => {
  it('treats exact payment as settled', () => {
    expect(computeOverShort(10_000, 10_000)).toEqual({ overByPesewas: 0, shortByPesewas: 0 });
  });

  it('applies the configured allowance and tolerance', () => {
    const { overByPesewas, shortByPesewas } = computePaymentTotals(10_000, 10_060, programWith({ paymentAllowancePesewas: 50 }));
    expect(overByPesewas).toBe(10);
    expect(shortByPesewas).toBe(0);
    expect(computePaymentTotals(10_000, 9_850, programWith({ paymentTolerancePesewas: 100 })).shortByPesewas).toBe(50);
  });

  it('blocks zero, fractional, huge and implausible amounts', () => {
    const plain = programWith();
    expect(() => checkAmountRange(0, 10_000, settingsOf(plain))).toThrow();
    expect(() => checkAmountRange(10_000.5, 10_000, settingsOf(plain))).toThrow();
    expect(() => checkAmountRange(200_000_000, 10_000, settingsOf(plain))).toThrow();
    expect(() => checkAmountRange(200_000, 10_000, settingsOf(plain))).toThrow();
  });

  it('honours a program-specific ceiling', () => {
    const custom = programWith({ maxPaymentPesewas: 15_000 });
    expect(() => checkAmountRange(16_000, 10_000, settingsOf(custom))).toThrow();
    expect(() => checkAmountRange(15_000, 10_000, settingsOf(custom))).not.toThrow();
  });

  it('keeps Ghana timezone constant in shared helpers', () => {
    expect(GHANA_TIMEZONE).toBe('Africa/Accra');
  });
});
