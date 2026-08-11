# Compilation Brief: Phase 9/9 — Integrate, harden, document, and validate the PoC

\--- CONTEXT BOUNDARY ---
Disregard all previous context. This brief is self-contained.
Read ONLY the files listed below. Follow the instructions exactly.
------------------------------------------------------------------

## Phase Metadata

```toml
[phase]
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

## Compilation Clarification

* This is integration and validation only. Revision 2 authorizes the minimum
  owner fixes needed to reconcile the already-started Analyze gauge/trend
  contract, Graph-to-Markdown opening, and explicit Markdown Save-to-Git flow.
* Keep Graph-to-Markdown opening on public Theia `OpenerService` /
  `OpenHandler` contribution points and keep Save interception on the public
  `SaveableService` binding; do not invent or patch upstream APIs.
* The save flow applies only to detected Markdown files and remains per-file:
  pull --rebase, add the saved file, commit it, then push.
* Use one real browser E2E over a temporary repository and local bare remote.
* Interact through stable Studio commands/test IDs, not private Monaco/Theia CSS selectors.
* Browser functional behavior and Electron compile are separate gates.
* README must describe safe loopback/cloud-proxy launch, required config, Git modes, credentials, limitations, and threat boundary.
* Manual real-remote smoke requires user-supplied root, branch, credentials, and authenticated proxy; automated validation must not contact an external remote.

## Load Instructions

1. **Plan manifest**: Read `.cf-studio/.plans/theia-studio-cloud-poc/plan.toml`.
   * Action: compile-time metadata only.
2. **All phase handoffs**: Runtime-read every required phase handoff from `/Volumes/coding/cf-work/workspace-sources/constructorfabric/fabric-poc/poc/theia/.cf-studio/.plans/theia-studio-cloud-poc/out/phase-01-application-composition.md` through `/Volumes/coding/cf-work/workspace-sources/constructorfabric/fabric-poc/poc/theia/.cf-studio/.plans/theia-studio-cloud-poc/out/phase-08-audit-layout-polish.md`.
   * Scope: collect implemented commands, configuration, files, selectors, tests, and known limitations; do not reopen implementation scope.
3. **Application/test configuration**: Runtime-read root manifests, current README, browser/electron manifests, test configs, and custom Studio public interfaces.
4. **Official Theia deployment guidance**: Runtime-read current official browser/remote architecture and WebSocket deployment documentation for documentation accuracy only.

**Do NOT load**: whole `node_modules`, full UI reference/mock data, or unrelated parent-repository documentation.

## Compile Phase File

Write to: `.cf-studio/.plans/theia-studio-cloud-poc/phase-09-integration-hardening.md`

Required sections:

1. TOML frontmatter
2. Preamble
3. What
4. Prior Context
5. User Decisions
6. Rules
7. Input
8. Task
9. Acceptance Criteria
10. Output Format

The Task must reconcile the existing Analyze controller/widget contract, route
Graph Markdown navigation through the registered Studio Markdown open handler,
verify the public SaveableService interception for detected Markdown, move the
existing backend pull --rebase step before per-file add/commit, add
Playwright configuration and a deterministic Save→Committed→Pushed test, run
unit/integration tests, build browser and Electron, verify
reconnect/layout/graph navigation and failure states, scan RPC/audit/test output
for secrets/absolute paths, document exact safe launch commands and non-goals,
and produce the final phase report. Any discovered defect must be fixed only in
its declared owning component without adding unrelated capabilities.

## User Decisions During Execution

* Before a manual real-remote smoke, ask for the exact `STUDIO_WORKSPACE_ROOT`, `STUDIO_GIT_BRANCH`, credential mechanism, and authenticated proxy URL.
* Automated local-bare-remote validation does not require additional input and runs first.

## Context Budget

* Phase file target: ≤ 420 lines.
* Inlined content estimate: \~200 lines.
* Runtime handoffs, configs, and selected sources: \~1,250 lines.
* Total execution context: ≤ 1,800 lines.

## After Compilation

Report: `Phase 9 compiled → phase-09-integration-hardening.md (N lines)`.

**Done**
