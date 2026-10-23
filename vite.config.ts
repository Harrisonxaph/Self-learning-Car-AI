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
  },
});
