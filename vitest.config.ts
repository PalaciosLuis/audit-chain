import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'happy-dom',
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/**/*.ts'],
      exclude: ['src/main.ts', 'src/vite-env.d.ts', 'src/**/*.d.ts'],
      // Honest floors measured on this suite: a regression now fails `pnpm coverage`
      // instead of passing silently. `theme.ts` is pinned at 100% because it had no
      // test at all when the accessibility review found this gap.
      thresholds: {
        statements: 93,
        branches: 68,
        functions: 93,
        lines: 93,
        'src/theme.ts': {
          statements: 100,
          branches: 100,
          functions: 100,
          lines: 100,
        },
      },
    },
  },
});
