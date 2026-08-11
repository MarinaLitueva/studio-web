```toml
[phase]
plan = "theia-studio-cloud-poc"
number = 9
total = 9
type = "implement"
title = "Integrate, harden, document, and validate the PoC"
depends_on = [1, 2, 3, 4, 5, 6, 7, 8]
input_manifest = ""
input_signature = ""
input_files = ["package.json", "package-lock.json", "README.md", "browser-app/package.json", "electron-app/package.json", "studio/package.json", "studio/src/browser/", "studio/src/common/", "studio/src/node/", "node_modules/@theia/core/src/browser/open-with-service.ts", "node_modules/@theia/core/src/browser/saveable-service.ts", "node_modules/@theia/filesystem/src/browser/filesystem-saveable-service.ts"]
output_files = ["package.json", "package-lock.json", "playwright.config.ts", "tests/e2e/studio-save-push.spec.ts", "README.md", "studio/src/browser/workspace-graph-widget.tsx", "studio/src/browser/workspace-graph-widget.test.tsx", "studio/src/common/graph-model.ts", "studio/src/node/workspace-graph-service.ts", "studio/src/node/workspace-graph-service.test.ts", "studio/src/browser/graph-open-handler.ts", "studio/src/browser/graph-open-handler.test.ts", "studio/src/browser/studio-saveable-service.ts", "studio/src/browser/studio-saveable-service.test.ts", "studio/src/browser/studio-frontend-module.ts", "studio/src/browser/analyze-controller.ts", "studio/src/browser/analyze-controller.test.ts", "studio/src/browser/analyze-widget.tsx", "studio/src/browser/analyze-widget.test.tsx", "studio/src/browser/style/index.css", "studio/src/node/git-publish-service.ts", "studio/src/node/git-publish-service.test.ts"]
outputs = ["out/phase-09-integration-hardening.md"]
inputs = ["out/phase-01-application-composition.md", "out/phase-02-runtime-workspace-protocol.md", "out/phase-03-operation-journal-queue.md", "out/phase-04-git-publish-pipeline.md", "out/phase-05-save-git-operations-ui.md", "out/phase-06-graph-indexer.md", "out/phase-07-graph-editor-ui.md", "out/phase-08-audit-layout-polish.md"]
```

## Preamble

This is a self-contained phase file. All rules, constraints, and kit content
are included below. Revision 1 authorized the missing-SCM-revision fix.
Revision 2 authorizes the minimum owner fixes required to reconcile the
already-started Analyze gauge/trend contract, Graph-to-Markdown opening through
public Theia open handlers, and detected-Markdown Save-to-Git interception.
Project files listed in the Task section must be read
at runtime. Follow the instructions exactly, run any EXECUTE commands as
written, and report results against the acceptance criteria at the end.

## What

Integrate the previously implemented PoC components, add the final automated validation harness, harden documentation and output safety, and produce the final execution report for the secure single-user Studio browser workflow. Scope is limited to integration fixes inside already-owned components, one real browser end-to-end test against a temporary repository and local bare remote, browser and Electron build validation, documentation updates, and safety scans over logs and outputs. Do not introduce new business capabilities, external-remote automation, or architectural changes beyond fixes required to make the existing plan pass end to end.

## Prior Context

Phase 1 established the browser and Electron application composition and root workspace scripts.
Phase 2 established runtime configuration, backend RPC shape, and workspace boundary enforcement.
Phase 3 established the durable operation journal and single-repository queue semantics.
Phase 4 established the safe Git publish pipeline and commit or push state progression.
Phase 5 established save interception, operation status UI, and stable test IDs and commands for browser-driven save workflows.
Phase 6 established commit-addressed graph snapshots, graph refresh states, and cache safety boundaries.
Phase 7 is the planned owner of graph views, Monaco navigation, and related selectors or commands consumed here if implemented.
Phase 8 is the planned owner of audit, layout restoration, and Studio polish behavior consumed here if implemented.
This phase is integration and validation only. Revision 2 permits only the
explicitly listed owner corrections required by the accepted Studio UI and
Save-to-Git behavior; it does not authorize unrelated product capabilities or
fixes outside the declared output files.
Automated validation must use a local bare Git remote only; any real remote smoke is manual and gated on explicit user input.

## User Decisions
### Already Decided (pre-resolved during planning)
- **Automation boundary**: automated validation runs first and uses a temporary repository plus a local bare remote only.
- **Selector policy**: end-to-end automation must use stable Studio commands and `data-testid` values, not private Monaco or Theia CSS selectors.
- **Gate separation**: browser functional validation and Electron compile validation are separate acceptance gates.
- **Documentation scope**: `README.md` must describe safe loopback or cloud-proxy launch, required configuration, Git modes, credentials, limitations, and the threat boundary.
- **Defect policy**: any discovered integration defect is fixed only in its owning existing component without adding new capabilities.
- **Markdown opening**: Graph navigation for `.md` files uses the registered
  Studio Markdown `OpenHandler` through public Theia opener services.
- **Markdown publish flow**: every explicit Save of a detected Markdown file
  queues one per-file pull --rebase, add, commit, and push operation.
- **Analyze reconciliation**: complete the already-started five-gauge and
  twelve-week trend contract; do not introduce additional metrics or analysis
  backends.
### Decisions Needed During This Phase
#### User Input Required
- [ ] **Manual real-remote smoke inputs** — before any manual external smoke, ask for the exact `STUDIO_WORKSPACE_ROOT`, `STUDIO_GIT_BRANCH`, credential mechanism, and authenticated proxy URL.

## Rules

### Scope And Ownership
- MUST modify only the files declared in `output_files` above.
- MUST treat this phase as integration and validation only and MUST NOT introduce new business behavior.
- MUST report a blocker and require plan revision if validation exposes a defect that would require editing any file outside the declared output files.
- MUST preserve concurrent/user changes already present in the declared files
  and reconcile them rather than resetting or replacing them wholesale.

### Theia Integration Boundaries
- MUST use public `OpenerService` / `OpenHandler` contribution points for
  Graph-to-Markdown opening and preserve editor selection when supported.
- MUST keep Save interception in the existing `SaveableService` /
  `FilesystemSaveableService` rebind and use Theia language detection for
  Markdown rather than extension-only UI assumptions.
- MUST keep RPC contracts in `src/common`, browser behavior in `src/browser`,
  and Git/filesystem/process work in `src/node`.
- MUST NOT patch installed `@theia` packages.

### Validation And Execution
- MUST add one deterministic browser E2E that drives `Save -> Committed -> Pushed` against a temporary repository and local bare remote.
- MUST interact through stable Studio commands and `data-testid` values rather than private Monaco or Theia CSS selectors.
- MUST run unit and integration validation, browser build, and Electron build as separate checks.
- MUST validate reconnect behavior, layout restoration, graph navigation, and failure-state visibility using the already-implemented contracts from prior phases.
- MUST keep automated validation fully local and MUST NOT contact an external remote.

### Safety And Output Scanning
- MUST scan RPC output, audit output, and test or validation output for leaked secrets and absolute filesystem paths.
- MUST document exact safe launch commands, required environment or proxy configuration, supported Git modes, credential expectations, limitations, non-goals, and the threat boundary.
- MUST keep manual real-remote smoke outside automation and require explicit user input before attempting it.
- MUST ensure browser functional behavior and Electron compile are reported as distinct gates.

### Runtime Reads And Documentation Accuracy
- MUST runtime-read every declared phase handoff from the absolute `.cf-studio/.plans/theia-studio-cloud-poc/out/phase-01-*.md` through `.cf-studio/.plans/theia-studio-cloud-poc/out/phase-08-*.md` paths and use them only to collect implemented commands, selectors, tests, files, and known limitations.
- MUST runtime-read root manifests, the current `README.md`, browser and Electron manifests, test configs, and public Studio interfaces before editing integration or documentation files.
- MUST runtime-read current official Theia browser or remote deployment guidance for documentation accuracy only, specifically the current Architecture Overview and current developing or deployment guidance covering remote backend messaging and WebSocket or HTTP transport behavior.

### Quality
- MUST keep the phase file under 420 lines.
- MUST leave no unresolved brace-delimited template placeholders outside fenced examples.

## Input

### Stable references
- Plan manifest metadata:
  - Phase number: `9`
  - Phase title: `Integrate, harden, document, and validate the PoC`
  - Depends on: phases `1` through `8`
  - Declared outputs: `package.json`, `package-lock.json`, `playwright.config.ts`, `tests/e2e/studio-save-push.spec.ts`, `README.md`
- Accepted validation decisions:
  - Integration only; no new business behavior.
  - Automated validation uses a local bare remote and one real browser E2E.
  - Stable Studio commands and test IDs are the only UI automation surface.
  - Manual real-remote smoke is user-gated and non-automated.
- Official Theia documentation targets for runtime read:
  - `https://theia-ide.org/docs/architecture/`
  - `https://eclipse-theia.github.io/theia/docs/next/modules/_theia_remote.html`
  - `https://eclipse-theia.github.io/theia/docs/next/documents/Developing.html`

## Task

1. Read the compile-time context, all prior handoffs, and the current local integration surface.
   Read `.cf-studio/.plans/theia-studio-cloud-poc/plan.toml` for metadata only.
   Read `/Volumes/coding/cf-work/workspace-sources/constructorfabric/fabric-poc/poc/theia/.cf-studio/.plans/theia-studio-cloud-poc/out/phase-01-application-composition.md`, `/Volumes/coding/cf-work/workspace-sources/constructorfabric/fabric-poc/poc/theia/.cf-studio/.plans/theia-studio-cloud-poc/out/phase-02-runtime-workspace-protocol.md`, `/Volumes/coding/cf-work/workspace-sources/constructorfabric/fabric-poc/poc/theia/.cf-studio/.plans/theia-studio-cloud-poc/out/phase-03-operation-journal-queue.md`, `/Volumes/coding/cf-work/workspace-sources/constructorfabric/fabric-poc/poc/theia/.cf-studio/.plans/theia-studio-cloud-poc/out/phase-04-git-publish-pipeline.md`, `/Volumes/coding/cf-work/workspace-sources/constructorfabric/fabric-poc/poc/theia/.cf-studio/.plans/theia-studio-cloud-poc/out/phase-05-save-git-operations-ui.md`, `/Volumes/coding/cf-work/workspace-sources/constructorfabric/fabric-poc/poc/theia/.cf-studio/.plans/theia-studio-cloud-poc/out/phase-06-graph-indexer.md`, `/Volumes/coding/cf-work/workspace-sources/constructorfabric/fabric-poc/poc/theia/.cf-studio/.plans/theia-studio-cloud-poc/out/phase-07-graph-editor-ui.md`, and `/Volumes/coding/cf-work/workspace-sources/constructorfabric/fabric-poc/poc/theia/.cf-studio/.plans/theia-studio-cloud-poc/out/phase-08-audit-layout-polish.md`.
   Read `package.json`, `package-lock.json`, `README.md`, `browser-app/package.json`, `electron-app/package.json`, `studio/package.json`, `studio/src/browser/`, `studio/src/common/`, current test configs, and the public Studio browser or common interfaces that define commands, selectors, and reconnect or graph behaviors.
   Read the current official Theia browser or remote architecture guidance at `https://theia-ide.org/docs/architecture/`, `https://eclipse-theia.github.io/theia/docs/next/modules/_theia_remote.html`, and `https://eclipse-theia.github.io/theia/docs/next/documents/Developing.html` for documentation accuracy only.

2. Prepare the integration and validation harness without adding new business behavior.
   Add or update `playwright.config.ts` and `tests/e2e/studio-save-push.spec.ts`.
   Use a temporary repository and a local bare remote.
   Drive one deterministic browser flow that verifies explicit save, durable commit progression, successful push, and the expected visible status transitions through stable Studio commands and `data-testid` values only.
   Keep all integration fixes confined to the declared output files. Revision
   2 also authorizes the declared Analyze, Graph opening, and SaveableService
   owner fixes; if the harness exposes a defect in any other file, stop and
   report a blocker that requires plan revision.

3. Reconcile the declared owner components before the final browser flow.
   Complete the existing Analyze controller/widget gauge and twelve-week trend
   contract with deterministic tests and accessible stable test IDs.
   Route Graph navigation for detected Markdown through public Theia opener
   services so the registered Studio Markdown editor is selected without
   private widget or CSS coupling.
   Verify that explicit Save reaches the rebound `StudioSaveableService` for
   both the Studio Markdown editor and the standard Theia text editor.
   Move the existing backend pull --rebase step before mutation, then keep the
   operation per-file and Markdown-only: add only the saved file, create the
   generated commit message, and push. Add a focused ordering regression test.

4. Harden root manifests and validation scripts for final execution.
   Update `package.json` and `package-lock.json` only as needed to support the final local validation flow.
   Keep browser functional validation and Electron compile validation as separate runnable gates.
   Ensure no automated step requires an external remote, external credentials, or network access beyond local loopback.

5. Verify reconnect, layout, graph, and failure-state behavior through the existing system surface.
   Use the prior handoffs and public interfaces to validate reconnect synchronization, layout restoration, graph navigation, and visible failed, pending, or blocked states.
   If defects are found outside the declared output files, report a blocker and require plan revision instead of patching them.
   Keep all verification tied to the already-defined selectors, commands, and public contracts rather than private implementation details.

6. Update the README for safe deployment and operating guidance.
   Revise `README.md` with exact safe launch commands, required configuration, loopback or authenticated proxy expectations, Git modes, credential model, limitations, non-goals, and the threat boundary.
   Document that automated validation uses a local bare remote only.
   Document that manual real-remote smoke is optional and requires explicit user-supplied `STUDIO_WORKSPACE_ROOT`, `STUDIO_GIT_BRANCH`, credential mechanism, and authenticated proxy URL before execution.

7. Run final validation and safety scans.
   Run the relevant unit or integration tests, the Playwright E2E, `npm run build:browser`, and `npm run build:electron`.
   Scan RPC, audit, test, and validation outputs for secrets and absolute filesystem paths.
   Record browser functional and Electron compile results as separate gates and capture any remaining non-goals or limitations in the final report.

8. Gate the optional manual external smoke explicitly.
   Before any real remote smoke, ask the user for the exact `STUDIO_WORKSPACE_ROOT`, `STUDIO_GIT_BRANCH`, credential mechanism, and authenticated proxy URL.
   Do not attempt manual external smoke without that input.
   If the input is not supplied, report the manual smoke gate as not run rather than failing automated validation.

9. Self-verify the phase against the acceptance criteria and produce the final phase report.
   Confirm every declared output file exists and that all integration fixes stayed inside the declared output files.
   Confirm no new business behavior or external-remote automation was added.
   Report each acceptance criterion as PASS or FAIL with the browser functional gate, Electron compile gate, and manual external smoke gate stated separately.
10. Write the exact completion report, final workflow summary, and next-actions menu to `/Volumes/coding/cf-work/workspace-sources/constructorfabric/fabric-poc/poc/theia/.cf-studio/.plans/theia-studio-cloud-poc/out/phase-09-integration-hardening.md` after the self-check passes.

## Acceptance Criteria

1. `playwright.config.ts` and `tests/e2e/studio-save-push.spec.ts` define one deterministic local-bare-remote browser E2E that validates `Save -> Committed -> Pushed` using stable Studio commands and `data-testid` values only.
2. `package.json` and `package-lock.json` support final local validation without requiring an external remote, external credentials, or new business behavior.
3. `README.md` documents exact safe launch commands, required configuration, Git modes, credential expectations, limitations, non-goals, local-bare validation, and the security or threat boundary accurately against current official Theia browser or remote guidance.
4. Final validation runs unit or integration tests, the browser E2E, `npm run build:browser`, and `npm run build:electron`, with browser functional and Electron compile reported as separate gates.
5. Validation verifies reconnect, layout restoration, native Graph-to-Studio-Markdown navigation, five-gauge Analyze rendering, detected-Markdown Save interception, and visible failure or pending states through public commands, selectors, and contracts, with any required fixes confined to the declared output files and any out-of-scope defect reported as a blocker requiring plan revision.
6. RPC, audit, test, and validation outputs are checked for secrets and absolute paths, and automated validation performs no external-remote access.
7. Manual real-remote smoke is gated on explicit user input for `STUDIO_WORKSPACE_ROOT`, `STUDIO_GIT_BRANCH`, credential mechanism, and authenticated proxy URL and is reported separately when not run.
8. This phase file is 420 lines or fewer.
9. This phase file contains no unresolved brace-delimited template placeholders outside fenced examples.

## Output Format

When complete, report results in this exact format:
```text
PHASE 9/9 COMPLETE
Status: PASS | FAIL
Files created: {list}
Files modified: {list}
Acceptance criteria:
  [x] Criterion 1 — PASS
  [ ] Criterion 2 — FAIL: {reason}
  ...
Line count: {actual}/420
Notes: {any issues or decisions made}
```

If `Status: PASS`, output:

```text
ALL PHASES COMPLETE (9/9)
Plan: /Volumes/coding/cf-work/workspace-sources/constructorfabric/fabric-poc/poc/theia/.cf-studio/.plans/theia-studio-cloud-poc/plan.toml
Lifecycle: manual
```

Then ask:

```text
Continue in this chat?
1. Run post-execution validation now — review the completed implementation with cf-analyze.
2. Choose the next task or workflow to run in this chat.
3. No — end the workflow here; the completed plan remains at the path above.

Suggested: 1 until validation has been completed; otherwise 3 when no further work remains.
Reply 1, 2, or 3.
```

If `Status: FAIL`, do not report all phases complete. Instead, emit:

```text
Phase 9 failed. Do not report all phases complete.
Fix the failed acceptance criteria in:
  /Volumes/coding/cf-work/workspace-sources/constructorfabric/fabric-poc/poc/theia/.cf-studio/.plans/theia-studio-cloud-poc/phase-09-integration-hardening.md
Then rerun Phase 9 and report PASS before continuing.
```
