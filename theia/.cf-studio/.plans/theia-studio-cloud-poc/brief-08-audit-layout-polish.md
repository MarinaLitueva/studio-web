# Compilation Brief: Phase 8/9 — Add audit, layout restoration, and Studio polish

--- CONTEXT BOUNDARY ---
Disregard all previous context. This brief is self-contained.
Read ONLY the files listed below. Follow the instructions exactly.
---

## Phase Metadata
```toml
[phase]
number = 8
total = 9
type = "implement"
title = "Add audit, layout restoration, and Studio polish"
depends_on = [5, 7]
input_manifest = ""
input_signature = ""
input_files = ["studio/src/browser/", "node_modules/@theia/core/src/browser/frontend-application-contribution.ts", "node_modules/@theia/core/src/browser/shell/application-shell.ts", "node_modules/@theia/core/src/browser/shell/shell-layout-restorer.ts", "node_modules/@theia/core/src/browser/storage-service.ts", "node_modules/@theia/core/src/browser/status-bar/status-bar-types.ts", "node_modules/@theia/core/src/browser/", "/Volumes/coding/cf-work/workspace-sources/constructorfabric/fabric-poc/poc/ui-1/src/components"]
output_files = ["studio/src/browser/audit-widget.tsx", "studio/src/browser/audit-widget.test.tsx", "studio/src/browser/audit-contribution.ts", "studio/src/browser/studio-contribution.ts", "studio/src/browser/studio-contribution.test.ts", "studio/src/browser/studio-frontend-module.ts", "studio/src/browser/style/index.css"]
outputs = ["out/phase-08-audit-layout-polish.md"]
inputs = ["out/phase-05-save-git-operations-ui.md", "out/phase-07-graph-editor-ui.md"]
```

## Compilation Clarification

- Audit is a sanitized backend DTO view over journal events, never direct JSONL access.
- Layout initialization runs only when no saved user layout exists.
- Theia remains the shell; `ui-1` supplies visual vocabulary rather than structure/state.
- All custom views support dark/light themes, keyboard focus, stable commands, and stable test selectors.
- Status labels distinguish modified, committed, pushing, pushed, pending, failed, and blocked.
- Do not add new Git or graph business logic in this phase.

## Load Instructions

1. **Plan manifest**: Read `.cf-studio/.plans/theia-studio-cloud-poc/plan.toml`.
   - Action: compile-time metadata only.
2. **Prior handoffs**: Read `/Volumes/coding/cf-work/workspace-sources/constructorfabric/fabric-poc/poc/theia/.cf-studio/.plans/theia-studio-cloud-poc/out/phase-05-save-git-operations-ui.md` and `/Volumes/coding/cf-work/workspace-sources/constructorfabric/fabric-poc/poc/theia/.cf-studio/.plans/theia-studio-cloud-poc/out/phase-07-graph-editor-ui.md` at runtime.
   - Scope: use the finished operation, graph, details, status, and frontend-service behavior.
3. **Current Studio browser code**: Runtime-read all custom contributions/widgets/styles and focused tests.
4. **Theia lifecycle APIs**: Runtime-read installed frontend application contribution, layout, storage, shell area, status bar, and theme sources.
5. **UI reference**: Runtime-read focused `ui-1` App shell, audit/workspace badges, cards, breadcrumbs, and state labels.

**Do NOT load**: mock data bodies, backend executor implementation, graph parser internals, or unrelated application pages.

## Compile Phase File

Write to: `.cf-studio/.plans/theia-studio-cloud-poc/phase-08-audit-layout-polish.md`

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

The Task must add an Audit view with sequence/path/hash/SHA/time/sanitized outcome only; compose first-run left/main/right/bottom placement without overwriting restored layouts; finalize view/command/menu/status presentation; ensure responsive dark/light styling and keyboard focus; and test audit redaction, layout restore, theme variables, and command accessibility.

## Context Budget

- Phase file target: ≤ 340 lines.
- Inlined content estimate: ~170 lines.
- Runtime frontend and lifecycle API reads: ~700 lines.
- Total execution context: ≤ 1,050 lines.

## After Compilation

Report: `Phase 8 compiled → phase-08-audit-layout-polish.md (N lines)`.
