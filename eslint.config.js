// ESLint flat config. The boundary rules below enforce the module layout in
// docs/ARCHITECTURE.md; tests/config/eslint-boundaries.test.ts proves they fire.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/** Import patterns for each source folder, so a rule can name the folders it forbids. */
const folder = (name) => [`**/${name}`, `**/${name}/**`];

/**
 * Forbid a folder from importing the listed folders.
 * @param {string} from source folder under src/
 * @param {string[]} forbidden folders it must not import
 * @param {string} reason shown in the lint error
 */
const boundary = (from, forbidden, reason) => ({
  files: [`src/${from}/**/*.ts`],
  rules: {
    'no-restricted-imports': [
      'error',
      {
        patterns: [
          {
            group: forbidden.flatMap(folder),
            message: `src/${from} must not import ${forbidden.join(', ')}: ${reason} (see docs/ARCHITECTURE.md).`,
          },
        ],
      },
    ],
  },
});

/** Folders that must run headless and deterministically (no DOM, clock or Math.random). */
const HEADLESS = ['sim', 'sensors', 'ai', 'evolution', 'training', 'utils'];

export default tseslint.config(
  { ignores: ['dist/', 'playwright-report/', 'test-results/', 'node_modules/'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,

  boundary('sim', ['sensors', 'ai', 'evolution', 'training', 'persistence', 'render', 'ui'], 'simulation depends only on utils'),
  boundary('sensors', ['ai', 'evolution', 'training', 'persistence', 'render', 'ui'], 'sensors read the simulation only'),
  boundary('ai', ['evolution', 'training', 'persistence', 'render', 'ui'], 'inference never imports evolution'),
  boundary('evolution', ['training', 'persistence', 'render', 'ui'], 'evolution works on flat genomes'),
  boundary('training', ['persistence', 'render', 'ui'], 'training runs headless'),
  boundary('utils', ['sim', 'sensors', 'ai', 'evolution', 'training', 'persistence', 'render', 'ui'], 'utils are leaf helpers'),
  boundary('persistence', ['evolution', 'training', 'render', 'ui'], 'persistence handles saved data only'),
  boundary('render', ['evolution', 'training', 'persistence', 'ui'], 'rendering reads state and never drives the app'),

  // Command-line scripts run in Node (for example scripts/experiment.mjs, P2-07).
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: { globals: { process: 'readonly', console: 'readonly' } },
  },

  {
    files: HEADLESS.map((name) => `src/${name}/**/*.ts`),
    rules: {
      'no-restricted-globals': [
        'error',
        ...['window', 'document', 'navigator', 'localStorage', 'requestAnimationFrame', 'performance', 'Date'].map(
          (name) => ({ name, message: `${name} is not allowed in headless, deterministic code.` }),
        ),
      ],
      'no-restricted-properties': [
        'error',
        { object: 'Math', property: 'random', message: 'Use the seeded generator in src/utils/rng.ts.' },
      ],
    },
  },
);
