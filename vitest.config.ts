import {defineConfig} from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
    // test/emulator needs a running Auth Emulator: npm run test:emulator.
    exclude: ['test/emulator/**', 'node_modules/**'],
  },
});
