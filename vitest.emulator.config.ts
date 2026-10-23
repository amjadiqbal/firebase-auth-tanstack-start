import {defineConfig} from 'vitest/config';

// Run through scripts/test-emulator.sh, which starts the Firebase Auth Emulator around it.
export default defineConfig({
  test: {include: ['test/emulator/**/*.test.ts'], testTimeout: 20_000},
});
