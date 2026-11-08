import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

// Identifiers recorded in a saved model (docs/MODEL_FORMAT.md `codeVersion`, `appVersion`): the commit the build was made
// from, when the build environment names one (Vercel and GitHub Actions both do), else "dev"; and the package version.
const packageJson = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')) as { version: string };
const codeVersion = (process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.GITHUB_SHA ?? 'dev').slice(0, 40);

export default defineConfig({
  // Static site: relative asset paths work on Vercel and on any other static host.
  base: './',
  define: {
    __CODE_VERSION__: JSON.stringify(codeVersion),
    __APP_VERSION__: JSON.stringify(packageJson.version),
  },
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
