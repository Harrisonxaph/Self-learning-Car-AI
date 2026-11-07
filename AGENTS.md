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
- Before submitting a PR for review, run `npm run lint`, `npm run typecheck`, `npm test`, `npm run build` and `npm run test:e2e` once those scripts exist (see `docs/TESTING.md`). Later commits on the same PR follow the verification contract in "Usage-efficient development workflow" below. Every required CI job still runs on every PR head.

## Persistence

- Saved models follow `docs/MODEL_FORMAT.md`. Validate everything you load; treat imported JSON and localStorage contents as untrusted.
- localStorage can be cleared or unavailable (private browsing, storage pressure, iOS eviction). Always offer JSON export and never present localStorage as permanent storage.

## Workflow (Codex and Claude Code)

- GitHub is the source of truth for code and docs.
- Work on a dedicated branch per feature (`feat/<roadmap-id>-short-name`, `docs/...`, `fix/...`) and open a pull request that names the roadmap ID and issue. Never push directly to `main` and never merge without the owner's approval.
- Claude Code is the main developer: take ownership of approved implementation tasks, write and maintain tests, use dedicated feature branches, prepare PRs, explain decisions, address Codex review findings, and coordinate the work as set out in "Coordination and owner decisions" below. Do not start a phase merely because its issue exists.
- Codex is the independent reviewer: inspect the latest issues, branches, PR head, full diff and test evidence; review architecture, simulation, neural networks, evolution, reward design, reproducibility, performance and mobile behaviour. Report defects for Claude to fix rather than editing Claude's branch. Codex does not take implementation ownership unless the owner explicitly requests an exception.
- Do not edit the same files as another agent at the same time unless coordinated in the issue or PR.
- Phase 6 items in `docs/ROADMAP.md` are documented research ideas only. Do not implement them without approval.
- Stretch targets ST1 to ST5 must stay visible in every roadmap revision.

### Coordination and owner decisions

This is the single policy for who coordinates the work and when the owner is asked. Other sections refer here and do not restate it. It adds no gate and removes none.

1. **Claude Code owns development coordination.** Before opening a branch or PR, inspect the open PRs, branches and the issue, and update an existing PR rather than opening a duplicate. Resolve routine implementation and Git choices (branch layout, commit split, how to sync a branch, test selection, wording) within the approved scope. Batch corrections, and request Codex review directly on the PR through GitHub, at the full head SHA.
2. **GitHub is the coordination record.** Issues, PR comments and reviews carry the state. Claude reads Codex's findings there and addresses them. The owner is not asked to copy messages or prompts between agents. A review request does not guarantee that a separate Codex session runs, so report which of these exists for the head:
   - an *automated receipt*: the connector's summary, a "no major issues" comment or a reaction. It is not technical approval.
   - a *formal technical approval*: a Codex review record in the format below, naming the agent, the reviewed head SHA and the outcome. Only this satisfies completion criterion 8, and only for the SHA it names.
3. **Check the records before asking the owner anything:** the recorded owner decisions (the evidence forms below), the issue discussion and the current PR state. Do not ask again for an approval that is already recorded, unless the proposed action materially changes what was approved. An approval counts only if it is traceable to one of those records.
4. **Make routine, reversible decisions without asking, within approved scope,** and record the choice in one line on the PR (what and why). A decision is reversible when a normal commit or branch operation undoes it and it touches no deployment, repository setting, shared `main` history or other contributor's work. To bring a reviewed branch up to date, prefer merging `main` into it over rebasing or force-pushing, which keeps the reviewed commits and review anchors intact.
5. **While a review is pending, leave one concise status** (the PR link, the full head SHA and the exact outstanding gate) and update it rather than adding comments. Do not issue overlapping review requests or ask the owner to relay prompts. Request review again only for a new head.
6. **Batch genuine owner decisions into one message.** For each decision, say which owner gate makes it the owner's and recommend one answer.
7. **The owner's gates are these, and agents do not add others:**
   - starting work that is not yet approved (a feature, a phase, or a Phase 6 research item);
   - changes to scope or acceptance criteria;
   - running a new study, or re-running one after a failure or interruption as its protocol requires;
   - deployment, and repository, CI or Vercel settings;
   - completion decisions for a feature or a phase;
   - merges.
8. **Unchanged safeguards:** independent Codex review at the current full head SHA, every required CI job on that head, the applicable tests and device checks, the scientific-honesty rules, and the owner-evidence rules. At most three correction cycles per PR; then report the unresolved blockers once, as in the usage-efficient workflow.
9. **When Codex's formal technical approval covers the current head and required CI is green on it, stop with one clear merge request** to the owner naming the PR, the head SHA, the review and the CI run. Agents do not merge automatically.

### GitHub review using the shared account

The owner chose independent AI review recorded in GitHub comments. Both integrations may act through the same GitHub account; GitHub can reject a formal Approve action as a self-review even when Claude and Codex are separate agents. A formal approval badge is therefore optional, not the review gate. Do not create a second identity or weaken existing checks to obtain a badge.

1. Claude opens a PR with its roadmap ID/issue, change summary, actual test results and outstanding manual checks. Include the full current head SHA and request Codex review.
2. Claude requests the review itself, directly on the PR, and does not ask the owner to relay it. Use the configured Codex GitHub integration: open the PR for review, mark a draft ready, or comment `@codex review`. After new commits, request review again once and verify the reviewed SHA. An automated receipt (the connector's summary or a reaction) is not formal technical approval of any commit, and an older one is not approval of a later commit; see "Coordination and owner decisions". If the integration is unavailable, a separate Codex session may review and post its findings through the connector.
3. Codex posts a review comment identifying the agent, reviewed head SHA, scope, checks actually run, unavailable environments, findings and disposition. The outcome is `Changes required` or `Technical approval`. Findings include file/line references where practical; approval requires no unresolved blocking findings. Claude replies to findings and links its fixes, then requests re-review.
4. Link the current Codex review in the PR description/template. New commits require re-review or explicit Codex confirmation covering the new head. For stacked PRs, name the combined snapshot and integration order; approval of that snapshot does not approve an older incomplete branch by itself.
5. The owner explicitly approves the final PR/combined snapshot for merging, using one of the forms of owner evidence below and referencing the PR and reviewed version. Technical approval by Codex does not authorize merging. Claude asks for the merge once, in the single merge request described in "Coordination and owner decisions". Agents never auto-merge or merge without that owner instruction. All required CI, acceptance and relevant device checks still apply; unavailable required checks keep the feature In Review.

#### Owner evidence on a shared account

Every agent comment and review shows the owner's account as its author, so GitHub authorship cannot tell an owner decision from agent text. Owner decisions are therefore recorded only in these forms. They are a procedural convention, not proof of authorship.

- **Merge:** the owner performing the merge is the owner's merge approval for the merged head. Agents do not merge. An agent may merge only if the owner instructs it directly in that agent's session for a named PR and head SHA. The agent must then first post the relayed instruction (next item) on the PR.
- **Relayed instruction:** a direct instruction from the owner to an agent in that agent's session. The agent posts it verbatim on the PR or issue, beginning `Relayed owner instruction (<agent>, <date>):`, with the quoted words and what they cover (PR/issue, head SHA or decision). It is evidence only of what the owner told that agent, and the owner may correct or withdraw it.
- **Owner decision comment:** a comment the owner writes themself, whose first line begins `Owner decision:` and names the PR or issue, the head SHA where relevant, and the decision (merge approval, completion approval, implementation authorization, criterion change).

Rules for agents:
- Agents never begin any text with `Owner decision:`.
- Agents never state or imply that the owner approved, authorized or decided something, except by linking one of the records above.
- Every agent comment, review and PR description identifies its agent. For example, Codex review records begin `Reviewer: Codex`, and Claude Code text ends with the Claude Code footer. Agent text never presents itself as written by the owner.
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

Codex PR review is already configured for this repository (observed on PR #52). No new paid service, bot identity or workflow is required. GitHub branch metadata reported main as unprotected when this was written. Since 2026-11-01 the active ruleset "Protect main" requires pull requests (0 approvals) and both CI jobs, with no bypass (see P1-10 in `docs/ROADMAP.md`). Agents can read the ruleset but cannot administer it. If the owner changes protection, keep requiring PRs and available CI checks without making an unattainable same-account approval badge the gate for this workflow. Review comments themselves are a procedural gate, not a GitHub-enforced status check.

## Usage-efficient development workflow

This applies to all approved project work: every phase from 1 to 6, including Phase 1 regression and maintenance work, and cross-cutting quality, documentation and workflow tasks. Research items (Phase 6 R-items) still need their own implementation authorisation first. It saves agent usage. It adds no new gate and removes none. Where it seems to conflict with another rule in this file or in `docs/`, the stricter rule wins. It never relaxes the scientific evaluation (`docs/AI_EVALUATION.md`), security, accessibility, CI, independent-review or owner-approval requirements.

Work every task through six stages: **INSPECT → PLAN → IMPLEMENT → VERIFY → REVIEW → RECORD.**

1. **INSPECT.** Read only what the task needs:
   - the task's roadmap entry and acceptance criteria;
   - the source files it changes, and their direct dependencies and dependants;
   - the tests that cover those files;
   - the docs sections it names.

   Do not survey the whole repository or re-read unchanged files without a reason. Check first for existing code, tests, fixtures and documentation to reuse.
2. **PLAN.** State the bounded scope in a few lines: what changes, what does not, and which tests prove it. Where the roadmap or the owner asks for a design note first, commit it before the code. Anything outside the approved scope goes back to the owner as part of one batched decision (see "Coordination and owner decisions"), not into the PR.
3. **IMPLEMENT.** Change only what the approved scope needs:
   - reuse existing modules, helpers, fixtures and test patterns rather than adding parallel ones;
   - no drive-by refactors, renames or formatting changes;
   - no speculative features.
4. **VERIFY.** One contract applies, and it is the one §Tests refers to:
   - **While developing:** run targeted checks for what you changed.
   - **First submission for review:** run every check required by §Tests and `docs/TESTING.md` on that head, and report the actual results.
   - **Later commits on the same PR:** rerun locally whatever the change can affect, chosen by impact rather than by file:
     - the changed modules' tests;
     - the tests of every module that depends on them, and the integration, determinism and contract tests covering that path;
     - lint, typecheck and build.

     Rerun the full suite when the impact is broad or unclear, for example a change to shared simulation, RNG, training or format code, or to configuration and dependencies. A documentation-only commit needs no application rerun; record it as not applicable. Name what you reran, and why that is enough.
   - **Every PR head proposed for merge:** every required CI job passes on that exact head. The relevant review and the required device evidence for that head are recorded before the owner is asked to merge. A local rerun never replaces a required CI job, test layer or acceptance criterion.
   - **After merge:** check the required CI on the resulting `main` commit, and record the result where the work is tracked. A failure there is fixed before further work builds on it.
5. **REVIEW.** Request Codex review at the full head SHA, as in the shared-account workflow above.
   - **Batch the corrections.** Fix every finding in one review round, in one focused commit or a small set of commits. Run the checks once for that batch, reply once per finding, then request re-review once.
   - **At most three correction cycles per PR.** A correction cycle is one push answering a review. If the fourth review still requires changes, stop. Post a short blocker report on the PR, saying what is still open, why it keeps recurring and the options with a recommendation, and ask the owner how to proceed, batched with any other pending owner decision. Do not keep iterating.
   - **No relaxed standards.** The limit never lowers the bar for approval. Independent Codex review and explicit owner merge approval are still required.
6. **RECORD.** Update only the records the change affects: the roadmap status or changelog row, `docs/TESTING.md` when tests change, and design notes when behaviour changes. Make these updates in the same PR as the change, and avoid preventable follow-up PRs for wording, status or evidence that could have gone in it.

   A focused follow-up is appropriate when the original PR can no longer be updated, for example after it is merged or closed. That covers:
   - evidence that becomes available later, such as post-merge CI, a retrospective review or device results;
   - a factual error discovered in the docs;
   - required review or completion records.

   Such a follow-up keeps the actual chronology. It never backdates an approval and never infers a test that was not run.

**Communication.** Keep PR descriptions, review replies and status reports short and factual. Cover what changed, why, the actual checks run with their results, what was not run and why, open items, and the full head SHA. Link rather than repeat earlier evidence. Concise never means omitting a limitation, an unavailable environment, a failed check or a scientific caveat.

## Roadmap reconciliation defaults

- The owner's detailed project request is the initial master specification. Preserve useful existing work and verify code, tests and PR history before changing statuses.
- Built-in training, validation and held-out fixtures are required in Phase 2 (P2-10); the Phase 4 editor must not block controlled experiments.
- The primary release evolves each run on one selected training circuit. Selecting from multiple circuits and evaluating on unseen circuits are required; evolving over multiple training tracks is approval-gated R-06.
- ST5 uses simultaneous non-colliding human and AI cars on the same track. Physical multi-car racing is R-01 and requires separate approval.
- A completed experiment with a negative result is useful evidence, but it does not satisfy Phase 2's requirement to demonstrate improvement over random baselines. Track experiment completion and phase acceptance separately.
- A champion model is not a resumable population checkpoint. Follow MODEL_FORMAT.md for the additional state needed to resume evolution.
- Documentation-only PRs record application/device tests as not applicable when no executable behaviour changes. Feature PRs retain all eight completion gates. Q-01 is Complete (see `docs/ROADMAP.md`); later workflow changes need the same independent review and owner approval. The implementing agent must not self-review; shared GitHub identity is acceptable only when the reviewer is a separate agent. Workflow changes authored by Codex need independent review by Claude or another fresh development agent.
