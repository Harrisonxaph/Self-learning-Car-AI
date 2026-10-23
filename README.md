# Self-learning-Car-AI
Self learning 2D car AI. Self drive, self brake, change due to environment

**Self-Driving AI Evolution** is a free, browser-based sandbox (Vite, TypeScript and Canvas 2D) where cars learn to steer, accelerate and brake through neural networks evolved by a genetic algorithm. It is planned to run on iPhone, iPad and desktop browsers.

> Status: project foundation only. The page opens with an empty, screen-sized drawing area. The racetrack, driving, AI and training are not built yet. See the roadmap for verified progress.

## Getting started

You need [Node.js 24](https://nodejs.org/) (the version is in `.nvmrc`; with nvm, run `nvm use`).

```bash
npm ci              # install the exact dependency versions from package-lock.json
npm run dev         # start a local development server, then open the printed URL
```

To try it on a phone or tablet on the same network, run `npm run dev -- --host` and open the "Network" URL on the device.

## Checks

| Command | What it does |
|---------|--------------|
| `npm run lint` | ESLint, including the architecture rules that stop modules importing the wrong layers |
| `npm run typecheck` | TypeScript in strict mode |
| `npm test` | Unit tests (Vitest, in Node) |
| `npm run build` | Production build into `dist/` (a static site) |
| `npm run test:e2e` | Browser tests (Playwright) against the production build in Chromium and WebKit, including phone and tablet touch emulation |

Before the first browser test run, install the browsers: `npx playwright install --with-deps chromium webkit`. See [docs/TESTING.md](docs/TESTING.md) for details and the manual device checks.

## Project layout

```
index.html            the page
src/main.ts           entry point
src/render/           canvas sizing and drawing
tests/                unit tests, mirroring src/
tests/e2e/            browser tests
```

More folders (simulation, sensors, AI, evolution, training) are added by later roadmap tasks; see [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Project documents

- [AGENTS.md](AGENTS.md): rules for every contributor and agent (read first)
- [docs/ROADMAP.md](docs/ROADMAP.md): features, status, dependencies, stretch targets and issues
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): planned module structure
- [docs/AI_EVALUATION.md](docs/AI_EVALUATION.md): how genuine learning is measured
- [docs/MODEL_FORMAT.md](docs/MODEL_FORMAT.md): saved-model standard
- [docs/TESTING.md](docs/TESTING.md): test plan and device checks
