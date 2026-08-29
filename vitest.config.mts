import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
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
