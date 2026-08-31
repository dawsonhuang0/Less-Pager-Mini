import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // ONLY our own suite. The default glob is rooted at the package,
    // which happily walks into any checkout sitting inside it - a
    // clone of another project here turned `npm test` into a run of
    // ITS tests
    include: ['tests/**/*.test.ts'],

    // swallows the display's raw fd-1 writes, which no stdout spy can
    // intercept and which otherwise scribble on the real terminal
    setupFiles: ['./tests/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      reportsDirectory: './coverage',
    },
  },
});
