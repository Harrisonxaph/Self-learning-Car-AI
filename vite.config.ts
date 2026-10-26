import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Static site: relative asset paths work on Vercel and on any other static host.
  base: './',
  build: {
    target: 'es2022',
  },
  preview: {
    host: '127.0.0.1',
    port: 4173,
    strictPort: true,
  },
  test: {
    // Simulation and helpers must run without a DOM, so unit tests run in plain Node.
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    exclude: ['tests/e2e/**', 'node_modules/**'],
    // Several deterministic driving tests take about 2 s alone, and more on a busy two-CPU runner, which pushed
    // some past Vitest's 5 s default. The limit only catches hangs; it does not change what any test checks.
    testTimeout: 30_000,
  },
});
