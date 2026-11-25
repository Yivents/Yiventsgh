import { hashIdentifier, isValidGhanaPhone, normalizeGhanaPhone, registrationSubmissionSchema } from '@yivents/shared';

describe('Ghana phone validation', () => {
  it.each([
    ['0241234567', '+233241234567'],
    ['+233241234567', '+233241234567'],
    ['233241234567', '+233241234567'],
    ['0551234567', '+233551234567'],
  ])('normalises %s to %s', (input, expected) => {
    expect(normalizeGhanaPhone(input)).toBe(expected);
    expect(isValidGhanaPhone(input)).toBe(true);
  });

  it.each(['02012345', '1234567890', '02412345678', '0111234567', 'not-a-phone'])('rejects %s', (input) => {
    expect(isValidGhanaPhone(input)).toBe(false);
  });

  it('rejects invalid phone numbers in the shared submission schema', () => {
    const result = registrationSubmissionSchema.safeParse({
      programId: 'p1',
      ticketTypeId: 't1',
      answers: {},
      contact: { name: 'Ama Mensah', phone: '0111234567' },
    });
    expect(result.success).toBe(false);
  });

  it('produces stable, non-reversible duplicate keys', () => {
    expect(hashIdentifier('+233241234567')).toBe(hashIdentifier('+233241234567'));
    expect(hashIdentifier('+233241234567')).not.toBe(hashIdentifier('+233241234568'));
    expect(hashIdentifier('a@b.com')).toMatch(/^[0-9a-f]{16}$/);
  });
});
