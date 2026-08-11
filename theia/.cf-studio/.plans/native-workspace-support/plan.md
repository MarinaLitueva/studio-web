# Native `.cf-workspace.toml` Workspace Support

Status: accepted
Workflow: `cf-coding`
Scope: implement the complete approved config-first Workspace design in the
Theia Studio POC without a runtime dependency on `cfs` and without using the
VS Code/Theia workspace configuration model.

## Safety constraints

- Preserve every unrelated or pre-existing working-tree change.
- Never reset, checkout over, or rewrite user changes.
- Treat `package-lock.json` and `studio/src/browser/style/index.css` as
  overlapping user-owned files and patch them narrowly.
- Obtain explicit approval before downloading or installing any dependency.
- Do not perform real remote clone/fetch operations during tests.
- Keep config writes, Git jobs, and operational state separated.

## Phase 0 — Safety baseline

Exit condition: baseline, path ownership, and dependency strategy are known.

### 1. Audit overlapping worktree changes

- Directive: `INLINE: controller-owned safety gate; no sub-agent can authorize overlap resolution`
- Owner: controller
- Input: current `git status`, resource context
- Output: task-owned paths, overlapping user paths, patch strategy
- Dependencies: none
- Verification: scoped read-only diffs; no reset or checkout
- Intent: avoid disturbing existing user work.

### 2. Establish deterministic baseline

- Directive: `INLINE: controller owns project-command baseline`
- Owner: controller
- Input: `poc/theia/studio`
- Output: baseline Jest/build status with existing failures separated
- Dependencies: action 1
- Verification: `npm test`, `npm run build`
- Intent: distinguish new regressions from baseline debt.

### 3. Resolve TOML/schema dependencies

- Directive: `INLINE: explicit network/dependency approval gate`
- Owner: controller
- Input: lossless TOML and schema-validation requirements
- Output: exact package choice and install command
- Dependencies: action 1
- Verification: dependency and lockfile diff limited to approved packages
- Intent: avoid a fragile hand-written TOML parser.
- Gate: any download/install requires separate approval of the exact command.

## Phase 1 — Contract-first config foundation

Exit condition: the canonical file can be read, validated, and safely edited
without a GUI.

### 4. Add Workspace domain and RPC contracts

- Directive: `DISPATCH: cf-generate-coder-smart` — sequential
- Owner: shared-contract worker
- Input: approved brainstorm decisions and vendored schema
- Output: source/config/snapshot/diagnostic/job DTOs and compatibility fixtures
- Dependencies: phase 0
- Verification: protocol type tests and TypeScript build
- Intent: create the stable contract before backend and UI work.

### 5. Implement lossless config reader

- Directive: `DISPATCH: cf-generate-coder-smart` — sequential
- Owner: backend config worker
- Input: action 4 contracts
- Output: `WorkspaceConfigService`, detection precedence, schema validation,
  revision hash, and `ConfigInvalid`
- Dependencies: action 4
- Verification: temp-directory tests for canonical, missing, invalid, and
  unsupported-version files
- Intent: establish the read-only canonical Workspace foundation.

### 6. Implement config mutations

- Directive: `DISPATCH: cf-generate-coder-smart` — sequential
- Owner: backend config worker
- Input: action 5
- Output: create/add/update/remove/impact-aware rename, lossless patching,
  atomic save, revision CAS, and external-change handling
- Dependencies: action 5
- Verification: comment/order preservation, rollback, and concurrent-edit tests
- Intent: complete native CRUD without `cfs`.

## Phase 2 — Registry and discovery

Exit condition: config-first snapshots govern membership and eager recursive
scan is disabled in canonical mode.

### 7. Build Workspace registry and reconciliation

- Directive: `DISPATCH: cf-generate-coder-smart` — sequential
- Owner: backend registry worker
- Input: config snapshot and existing repository registry
- Output: normalized sources, duplicate-root detection, nested ownership,
  live `observedAt` statuses, and SCM projection
- Dependencies: action 6
- Verification: configured/missing/duplicate/nested/external-change tests
- Intent: make configured sources the only Workspace membership authority.

### 8. Replace eager discovery with explicit flows

- Directive: `DISPATCH: cf-generate-coder-smart` — sequential
- Owner: discovery worker
- Input: action 7 registry
- Output: bounded manual scan, preview candidates, containing-repository
  detection, ignored suggestions, and canonical-mode watcher behavior
- Dependencies: action 7
- Verification: depth, symlink, ignored-directory, no-network, and no-auto-add tests
- Intent: implement the Scan button and opened-folder suggestion.

## Phase 3 — Git source lifecycle

Exit condition: missing URL sources can be synchronized safely as observable jobs.

### 9. Implement Git Workspace operations

- Directive: `DISPATCH: cf-generate-coder-smart` — parallel with action 10
- Owner: Git worker
- Input: source contracts and existing `GitExecutor`
- Output: destination resolution, temporary clone/atomic move, remote
  reconciliation, dirty/diverged checks, fast-forward-only update, and safe
  cancellation phases
- Dependencies: action 7
- Verification: mocked Git-command tests and temp-repository integration tests
- Intent: provide safe clone/fetch/update without changing publish behavior.

### 10. Implement Workspace job queue and recovery

- Directive: `DISPATCH: cf-generate-coder-smart` — parallel with action 9
- Owner: job-runtime worker
- Input: job DTOs and existing journal patterns
- Output: per-source jobs, batch aggregation, retry/interrupted recovery, and
  local operational storage
- Dependencies: action 7
- Verification: replay, cancellation, partial-failure, concurrency, and
  cleanup-marker tests
- Intent: keep sync lifecycle outside UI and TOML.

### 11. Integrate sync, trust, and snapshots

- Directive: `DISPATCH: cf-generate-coder-smart` — sequential
- Owner: backend orchestration worker
- Input: actions 9 and 10
- Output: Save & Sync, trust preview, authentication-required state,
  per-source force gate, and live snapshot updates
- Dependencies: actions 9 and 10
- Verification: end-to-end service tests with no secrets in DTOs or logs
- Intent: connect config, Git, and jobs without automatic network effects.

## Phase 4 — RPC and migration

Exit condition: frontend has a complete typed API and rollout/rollback work
per Workspace.

### 12. Extend runtime RPC and DI

- Directive: `DISPATCH: cf-generate-coder-smart` — sequential
- Owner: integration worker
- Input: actions 4 through 11
- Output: snapshot queries/events, CRUD/scan/sync/cancel/retry RPCs, and
  backend/frontend bindings
- Dependencies: action 11
- Verification: endpoint/client broadcast and authorization tests
- Intent: expose one typed boundary to the GUI.

### 13. Implement legacy migration and rollout modes

- Directive: `DISPATCH: cf-generate-coder-smart` — sequential
- Owner: migration worker
- Input: config service and runtime integration
- Output: Legacy, Single-folder, Canonical shadow, Canonical active,
  transaction journal, shadow comparison, and rollback adapter
- Dependencies: action 12
- Verification: crash recovery, inline/legacy migration, no-network shadow,
  and rollback tests
- Intent: avoid a big-bang cutover.

## Phase 5 — Workspace Sources frontend

Exit condition: all approved Workspace UX is available in the application.

### 14. Add frontend controller, commands, and notifications

- Directive: `DISPATCH: cf-generate-coder-smart` — sequential
- Owner: frontend state worker
- Input: action 12 RPC
- Output: snapshot controller, actionable notifications, deduplication, and
  create/open/scan/sync commands
- Dependencies: actions 12 and 13
- Verification: controller and command tests
- Intent: isolate UI from RPC and filesystem details.

### 15. Build Workspace Sources view

- Directive: `DISPATCH: cf-generate-coder-smart` — sequential
- Owner: frontend UI worker
- Input: action 14 controller
- Output: configured sources, suggestions, activity, and empty/config-invalid/
  migration states
- Dependencies: action 14
- Verification: stable test-id rendering and interaction tests
- Intent: implement the single Workspace view without VS Code workspace UI.

### 16. Add source editor and advanced flows

- Directive: `DISPATCH: cf-generate-coder-smart` — sequential
- Owner: frontend forms worker
- Input: action 15
- Output: Add/Edit, Save, Save & Sync, removal, rename impact, raw TOML/conflict
  recovery, trust, and force dialogs
- Dependencies: action 15
- Verification: form validation, destructive confirmation, and conflict tests
- Intent: complete GUI CRUD and recovery.

### 17. Cut SCM projection over to canonical Workspace

- Directive: `DISPATCH: cf-generate-coder-smart` — sequential
- Owner: SCM integration worker
- Input: registry and frontend controller
- Output: configured-only SCM membership, missing-source handling,
  single-folder fallback, and legacy banner
- Dependencies: actions 13 through 16
- Verification: SCM reconciliation and feature-mode tests
- Intent: complete config-first migration.

## Phase 6 — Validation and review

Exit condition: deterministic gates pass and no semantic findings remain.

### 18. Run project validation

- Directive: `INLINE: controller owns npm project commands`
- Owner: controller
- Input: completed implementation
- Output: Jest, TypeScript, and browser-build results
- Dependencies: action 17
- Verification: `npm test`, `npm run build`, and root browser build when applicable
- Intent: run the deterministic regression gate.

### 19. Run Studio-applicable validation

- Directive: `DISPATCH: cf-deterministic-validator` — sequential
- Owner: deterministic validator
- Input: changed code/config/assets
- Output: canonical deterministic gate report
- Dependencies: action 18
- Verification: reported exit codes and error counts
- Intent: verify Constructor Studio contracts where applicable.

### 20. Semantic code review

- Directive: `DISPATCH: cf-semantic-reviewer-code` — parallel with action 21
- Owner: semantic reviewer
- Input: implementation and approved brainstorm design
- Output: structured findings
- Dependencies: actions 18 and 19
- Verification: every checklist category covered
- Intent: check design compliance and integration boundaries.

### 21. Bug-finding review

- Directive: `DISPATCH: cf-code-bug-finder` — parallel with action 20
- Owner: bug-finding reviewer
- Input: implementation diff
- Output: correctness, security, concurrency, and reliability findings
- Dependencies: actions 18 and 19
- Verification: structured finding contract
- Intent: inspect Git, filesystem, cancellation, and migration risks.

### 22. Approved fix loop

- Directive: `DISPATCH: cf-generate-coder-smart` — sequential and only after
  the review-fix approval gate
- Owner: fix worker
- Input: user-approved finding IDs
- Output: fixes and focused tests
- Dependencies: actions 20 and 21 plus required approval
- Verification: actions 18 through 21 repeat until clean
- Intent: never fix findings without explicit approval.

## Phase 7 — Git finalization

### 23. Inspect final repository state

- Directive: `GIT_FINALIZATION: inspect-only`
- Owner: controller
- Input: clean validation/review outcome
- Output: scoped diff/status report; no staging or commit
- Dependencies: action 22
- Verification: only task-owned paths are reported and unrelated changes remain
  preserved

CONTINUE workflow protocol: CONTINUE CodingDispatch
