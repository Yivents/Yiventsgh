/** Unit tests live here; Firestore rules tests live in firebase/tests (emulator required). */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/test', '<rootDir>/../../firebase/tests'],
  testMatch: ['**/*.test.ts'],
  globals: { 'ts-jest': { tsconfig: '<rootDir>/tsconfig.test.json' } },
  testTimeout: 30000,
};
