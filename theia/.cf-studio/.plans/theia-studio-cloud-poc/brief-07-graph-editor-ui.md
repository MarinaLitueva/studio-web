# Compilation Brief: Phase 7/9 — Add graph views and Monaco navigation

--- CONTEXT BOUNDARY ---
Disregard all previous context. This brief is self-contained.
Read ONLY the files listed below. Follow the instructions exactly.
---

## Phase Metadata
```toml
[phase]
number = 7
total = 9
type = "implement"
title = "Add graph views and Monaco navigation"
depends_on = [5, 6]
input_manifest = ""
input_signature = ""
input_files = ["studio/src/browser/", "node_modules/@theia/core/src/browser/", "node_modules/@theia/editor/src/browser/", "/Volumes/coding/cf-work/workspace-sources/constructorfabric/fabric-poc/poc/ui-1/src/components/graph", "/Volumes/coding/cf-work/workspace-sources/constructorfabric/fabric-poc/poc/ui-1/src/components/files", "/Volumes/coding/cf-work/workspace-sources/constructorfabric/fabric-poc/poc/ui-1/src/components/layout"]
output_files = ["studio/src/browser/workspace-graph-widget.tsx", "studio/src/browser/workspace-graph-widget.test.tsx", "studio/src/browser/workspace-graph-contribution.ts", "studio/src/browser/object-details-widget.tsx", "studio/src/browser/graph-open-handler.ts", "studio/src/browser/graph-open-handler.test.ts", "studio/src/browser/studio-frontend-module.ts", "studio/src/browser/style/index.css"]
outputs = ["out/phase-07-graph-editor-ui.md"]
inputs = ["out/phase-05-save-git-operations-ui.md", "out/phase-06-graph-indexer.md"]
```

## Compilation Clarification

- Use native Theia widgets, factories, contributions, DI services, commands, menus, and editor navigation.
- Use React Flow only inside the graph widget; do not replace the Theia application shell.
- Render repository-derived labels as escaped text with allowlisted styles.
- Persist only selection, filters, viewport, and last SHA in widget state.
- Backend snapshots/events remain the source of truth after restore/reconnect.
- Large graphs default to filtered connected-neighborhood presentation.

## Load Instructions

1. **Plan manifest**: Read `.cf-studio/.plans/theia-studio-cloud-poc/plan.toml`.
   - Action: compile-time metadata only.
2. **Prior handoffs**: Read `/Volumes/coding/cf-work/workspace-sources/constructorfabric/fabric-poc/poc/theia/.cf-studio/.plans/theia-studio-cloud-poc/out/phase-05-save-git-operations-ui.md` and `/Volumes/coding/cf-work/workspace-sources/constructorfabric/fabric-poc/poc/theia/.cf-studio/.plans/theia-studio-cloud-poc/out/phase-06-graph-indexer.md` at runtime.
   - Scope: consume frontend service conventions and exact graph DTO/RPC contracts.
3. **Current browser code**: Runtime-read Studio frontend module, operation UI, styles, and tests.
4. **Theia view APIs**: Runtime-read installed `ReactWidget`, `WidgetFactory`, `AbstractViewContribution`, `OpenHandler`, `EditorManager`, selection, state, and theme APIs.
5. **UI reference**: Runtime-read focused graph, file tree, file viewer, and shell layout files under `../ui-1`; use interaction and visual vocabulary only.

**Do NOT load**: Zustand store implementation, mock data bodies, backend Git internals, or Electron-specific UI.

## Compile Phase File

Write to: `.cf-studio/.plans/theia-studio-cloud-poc/phase-07-graph-editor-ui.md`

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

The Task must create main-area Workspace Graph and right-area Object Details views, register commands/menu/factories, fetch/refetch snapshots, show diagnostics and dirty overlay, filter/highlight connected neighborhoods, open verified file/range locations in Monaco, use Theia theme variables, support keyboard actions, and test escaped labels, state restoration, and navigation.

## Context Budget

- Phase file target: ≤ 430 lines.
- Inlined content estimate: ~210 lines.
- Runtime UI, Theia API, and prior-output reads: ~950 lines.
- Total execution context: ≤ 1,400 lines.

## After Compilation

Report: `Phase 7 compiled → phase-07-graph-editor-ui.md (N lines)`.
