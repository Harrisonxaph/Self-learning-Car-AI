# Contributor and agent instructions

Self-Driving AI Evolution: a free, browser-based sandbox where 2D cars learn to steer, accelerate and brake through small neural networks evolved by a genetic algorithm. It runs on iPhone, iPad and desktop browsers and is built so a beginner learning software engineering can follow it.

This file is authoritative for every contributor, human or agent (Codex, Claude Code or others). Read it before making changes. `CLAUDE.md` only points here.

## Where the plan lives

- `docs/ROADMAP.md`: every feature with its ID, phase, priority, status, dependencies, acceptance criteria, test requirements and GitHub issue. Update the status in the same pull request that changes it.
- `docs/ARCHITECTURE.md`: module boundaries and data flow.
- `docs/AI_EVALUATION.md`: how learning is measured. Follow it before claiming any improvement.
- `docs/MODEL_FORMAT.md`: the saved-model standard.
- `docs/TESTING.md`: test layers, commands and manual device checks.

## Stack

- Vite, TypeScript (strict mode) and Canvas 2D. No game engine, no WebGL, no server.
- Node 24, `npm ci`, and a committed `package-lock.json`. Pin runtime dependencies to exact versions.
- Free and open-source tools only. Do not add paid AI APIs, paid services, analytics, accounts or tracking without an explicit, agreed requirement. Never commit credentials.
- The build must remain a static site deployable to Vercel (or any static host) with no server code.

## Architecture rules

- Keep these concerns in separate modules (see `docs/ARCHITECTURE.md`): simulation (physics, track, collision, checkpoints), sensors, neural-network inference, evolution, training orchestration, persistence, rendering and UI.
- Simulation code must not import rendering, UI or DOM APIs. It must run headless in Node for tests and accelerated training.
- Network inference (`src/ai/`) must not import evolution code. Evolution (`src/evolution/`) operates on flat genomes and never reads the canvas.
- Use the fixed simulation timestep from `src/sim/config.ts`. Never step physics by the frame's elapsed time.
- All randomness in simulation, sensors, AI and evolution goes through the seeded generator in `src/utils/rng.ts`. Do not call `Math.random()` there.
- Every training run records its full configuration and seed (see `docs/AI_EVALUATION.md`).

## Scientific honesty

- Do not claim that the AI has learned, improved or generalised unless the relevant experiment in `docs/AI_EVALUATION.md` has been run and its results recorded with seeds and configuration. Rising fitness alone is not evidence of general driving ability.
- Never fabricate results, screenshots, benchmark numbers or test output.
- Keep training, validation and held-out test tracks separate. Do not tune on held-out tracks.
- Describe limitations plainly in user-facing text and docs.

## Feature completion

A roadmap feature can be marked **Complete** only when all of the following are true:

1. The implementation exists and can be demonstrated.
2. Its required automated tests have been run and pass.
3. Relevant mobile-browser behaviour has been tested (record which device and browser, or say that it is outstanding).
4. Existing functionality still works.
5. It meets its acceptance criteria in `docs/ROADMAP.md`.
6. Documentation is updated.
7. A second development agent has independently reviewed the relevant changes; human review is additional and does not replace this gate.
8. Codex has recorded technical approval of the reviewed commit and the owner has explicitly approved the PR for merging. Under the shared-account workflow below, neither requires GitHub's formal Approved badge.

Until then, use `Not Started`, `In Progress`, `Blocked` or `In Review`. Never describe tests as passing unless you ran them in this change and they passed. Report unavailable environments (for example, no real iPhone) and outstanding manual checks explicitly.

## Accessibility and mobile

- Touch targets at least 44 × 44 CSS pixels; controls usable with one thumb in landscape on a phone.
- Full keyboard control on desktop, visible focus, and text readable at default zoom.
- Respect `prefers-reduced-motion` for decorative animation (the simulation itself may still run).
- Keep a low-cost rendering mode for phones and support running training without drawing every frame.
- Handle iOS Safari pausing background tabs: pause cleanly on `visibilitychange` and resume without a time jump.

## Tests

- Unit and integration tests live under `tests/`, mirroring `src/` (for example `src/sim/physics.ts` → `tests/sim/physics.test.ts`). Browser tests go in `tests/e2e/`. No tests next to source files.
- Physics and evolution must have determinism tests: same seed and configuration give identical results.
- Before submitting, run `npm run lint`, `npm run typecheck`, `npm test`, `npm run build` and `npm run test:e2e` once those scripts exist (see `docs/TESTING.md`).

## Persistence

- Saved models follow `docs/MODEL_FORMAT.md`. Validate everything you load; treat imported JSON and localStorage contents as untrusted.
- localStorage can be cleared or unavailable (private browsing, storage pressure, iOS eviction). Always offer JSON export and never present localStorage as permanent storage.

## Workflow (Codex and Claude Code)

- GitHub is the source of truth for code and docs.
- Work on a dedicated branch per feature (`feat/<roadmap-id>-short-name`, `docs/...`, `fix/...`) and open a pull request that names the roadmap ID and issue. Never push directly to `main` and never merge without the owner's approval.
- Claude Code is the main developer: take ownership of approved implementation tasks, write and maintain tests, use dedicated feature branches, prepare PRs, explain decisions, and address Codex review findings. Do not start a phase merely because its issue exists.
- Codex is the independent reviewer: inspect the latest issues, branches, PR head, full diff and test evidence; review architecture, simulation, neural networks, evolution, reward design, reproducibility, performance and mobile behaviour. Report defects for Claude to fix rather than editing Claude's branch. Codex does not take implementation ownership unless the owner explicitly requests an exception.
- Do not edit the same files as another agent at the same time unless coordinated in the issue or PR.
- Phase 6 items in `docs/ROADMAP.md` are documented research ideas only. Do not implement them without approval.
- Stretch targets ST1 to ST5 must stay visible in every roadmap revision.

### GitHub review using the shared account

The owner chose independent AI review recorded in GitHub comments. Both integrations may act through the same GitHub account; GitHub can reject a formal Approve action as a self-review even when Claude and Codex are separate agents. A formal approval badge is therefore optional, not the review gate. Do not create a second identity or weaken existing checks to obtain a badge.

1. Claude opens a PR with its roadmap ID/issue, change summary, actual test results and outstanding manual checks. Include the full current head SHA and request Codex review.
2. Use the configured Codex GitHub integration: open the PR for review, mark a draft ready, or comment `@codex review`. After new commits, request review again and verify the reviewed SHA. An older automated summary or a reaction alone is not approval of a later commit. If the integration is unavailable, a separate Codex session may review and post its findings through the connector.
3. Codex posts a review comment identifying the agent, reviewed head SHA, scope, checks actually run, unavailable environments, findings and disposition. The outcome is `Changes required` or `Technical approval`. Findings include file/line references where practical; approval requires no unresolved blocking findings. Claude replies to findings and links its fixes, then requests re-review.
4. Link the current Codex review in the PR description/template. New commits require re-review or explicit Codex confirmation covering the new head. For stacked PRs, name the combined snapshot and integration order; approval of that snapshot does not approve an older incomplete branch by itself.
5. The owner explicitly approves the final PR/combined snapshot for merging, using one of the forms of owner evidence below and referencing the PR and reviewed version. Technical approval by Codex does not authorize merging. Agents never auto-merge or merge without that owner instruction. All required CI, acceptance and relevant device checks still apply; unavailable required checks keep the feature In Review.

#### Owner evidence on a shared account

Every agent comment and review shows the owner's account as its author, so GitHub authorship cannot tell an owner decision from agent text. Owner decisions are therefore recorded only in these forms. They are a procedural convention, not proof of authorship.

- **Merge:** the owner performing the merge is the owner's merge approval for the merged head. Agents do not merge. An agent may merge only if the owner instructs it directly in that agent's session for a named PR and head SHA. The agent must then first post the relayed instruction (next item) on the PR.
- **Relayed instruction:** a direct instruction from the owner to an agent in that agent's session. The agent posts it verbatim on the PR or issue, beginning `Relayed owner instruction (<agent>, <date>):`, with the quoted words and what they cover (PR/issue, head SHA or decision). It is evidence only of what the owner told that agent, and the owner may correct or withdraw it.
- **Owner decision comment:** a comment the owner writes themself, whose first line begins `Owner decision:` and names the PR or issue, the head SHA where relevant, and the decision (merge approval, completion approval, implementation authorization, criterion change).

Rules for agents:
- Agents never begin any text with `Owner decision:`.
- Agents never state or imply that the owner approved, authorized or decided something, except by linking one of the records above.
- Every agent comment identifies its agent: Codex review records begin `Reviewer: Codex`, and Claude Code comments end with the Claude Code footer.
- If an agent cannot trace a claimed owner decision to one of these records, it treats the decision as not given.

These forms also cover owner decisions that are not merges: completion approval, implementation authorization and changes to acceptance criteria.

Review record format (Codex completes this in a PR comment; Claude links it):

```text
Reviewer: Codex (independent of implementation author)
Reviewed head: <full commit SHA>
Scope: <PR number; combined snapshot and integration order if stacked>
Outcome: <Changes required | Technical approval>
Checks and limitations: <commands/results, manual checks, unavailable environments>
Findings and disposition: <open findings or links to verified fixes>
Owner merge approval: pending; recorded separately by the owner
```

Codex PR review is already configured for this repository (observed on PR #52). No new paid service, bot identity or workflow is required. GitHub branch metadata currently reports main as unprotected and the ruleset list is empty; the connector cannot inspect or administer protected-branch settings requiring administration access. If the owner later configures protection, require PRs and available CI checks without making an unattainable same-account approval badge the gate for this workflow. Review comments themselves are a procedural gate, not a GitHub-enforced status check.

## Roadmap reconciliation defaults

- The owner's detailed project request is the initial master specification. Preserve useful existing work and verify code, tests and PR history before changing statuses.
- Built-in training, validation and held-out fixtures are required in Phase 2 (P2-10); the Phase 4 editor must not block controlled experiments.
- The primary release evolves each run on one selected training circuit. Selecting from multiple circuits and evaluating on unseen circuits are required; evolving over multiple training tracks is approval-gated R-06.
- ST5 uses simultaneous non-colliding human and AI cars on the same track. Physical multi-car racing is R-01 and requires separate approval.
- A completed experiment with a negative result is useful evidence, but it does not satisfy Phase 2's requirement to demonstrate improvement over random baselines. Track experiment completion and phase acceptance separately.
- A champion model is not a resumable population checkpoint. Follow MODEL_FORMAT.md for the additional state needed to resume evolution.
- Documentation-only PRs record application/device tests as not applicable when no executable behaviour changes. Feature PRs retain all eight completion gates. Keep Q-01 In Review until independent review and owner approval. The implementing agent must not self-review; shared GitHub identity is acceptable only when the reviewer is a separate agent. Workflow changes authored by Codex need independent review by Claude or another fresh development agent.
