```toml
[phase]
plan = "theia-studio-cloud-poc"
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

## Preamble

This is a self-contained phase file. All rules, constraints, and kit content
are included below. Project files listed in the Task section must be read
at runtime. Follow the instructions exactly, run any EXECUTE commands as
written, and report results against the acceptance criteria at the end.

## What

Add the Studio graph browsing UI using native Theia widgets, contributions, dependency injection, and Monaco editor navigation. This phase is limited to browser-side graph views, commands, layout integration, styling, and tests; React Flow may be used only inside the graph widget and must not replace the Theia application shell. The deliverable is a restorable graph exploration experience that consumes backend graph snapshots as the source of truth, opens verified file or range locations in Monaco, and keeps repository-derived labels safely escaped.

## Prior Context

- Plan path: `/Volumes/coding/cf-work/workspace-sources/constructorfabric/fabric-poc/poc/theia/.cf-studio/.plans/theia-studio-cloud-poc/plan.toml`.
- Phase 7 depends on prior outputs `out/phase-05-save-git-operations-ui.md` and `out/phase-06-graph-indexer.md`.
- Phase 5 established Studio frontend service conventions, save UI patterns, and current browser style integration.
- Phase 6 established graph DTO, RPC, and event contracts that remain the source of truth for snapshots and refreshes.
- Declared Phase 7 output files are `studio/src/browser/workspace-graph-widget.tsx`, `studio/src/browser/workspace-graph-widget.test.tsx`, `studio/src/browser/workspace-graph-contribution.ts`, `studio/src/browser/object-details-widget.tsx`, `studio/src/browser/graph-open-handler.ts`, `studio/src/browser/graph-open-handler.test.ts`, `studio/src/browser/studio-frontend-module.ts`, and `studio/src/browser/style/index.css`.
- Browser remains the functional target; Electron remains compile-only.
- Plan validation commands are `npm test`, `npm run build:browser`, and `npm run build:electron`.

## User Decisions

### Already Decided (pre-resolved during planning)

- **UI platform**: use native Theia widgets, widget factories, contributions, dependency injection services, commands, menus, and editor navigation.
- **React Flow boundary**: React Flow is allowed only inside the Workspace Graph widget.
- **Shell boundary**: do not replace or bypass the Theia application shell.
- **Label safety**: render repository-derived labels as escaped text with allowlisted styles only.
- **Restored state**: persist only selection, filters, viewport, and last SHA in widget state.
- **Source of truth after restore**: backend snapshots and events remain authoritative after restore or reconnect.
- **Large graph default**: large graphs default to filtered connected-neighborhood presentation.
- **Scope boundary**: do not load Zustand implementation, mock-data bodies, backend Git internals, or Electron-specific UI.

### Decisions Needed During This Phase

- None. Execute the graph UI phase using the pre-resolved Theia-native view and safety decisions above.

## Rules

### Theia UI Composition Rules

- MUST implement the graph experience with native Theia widgets, widget factories, contributions, dependency injection services, commands, menus, and editor navigation.
- MUST create a main-area Workspace Graph view.
- MUST create a right-area Object Details view.
- MUST keep React Flow confined to the graph widget implementation.
- MUST keep the Theia shell, docking model, and view lifecycle intact.
- MUST wire all new browser components through `studio/src/browser/studio-frontend-module.ts`.

### Graph Behavior Rules

- MUST fetch and refetch graph snapshots from the backend contracts defined by the graph indexer phase.
- MUST treat backend snapshots and events as the source of truth after restore or reconnect.
- MUST show diagnostics and a dirty overlay when graph data is stale, incomplete, or out of date.
- MUST default large graphs to a filtered connected-neighborhood presentation.
- MUST support filtering and highlighting of connected neighborhoods.
- MUST persist only selection, filters, viewport, and last SHA in widget state.
- MUST restore only from the persisted state subset above.

### Navigation and Safety Rules

- MUST open only verified file and range locations in Monaco through Theia editor APIs.
- MUST validate target file and range data before navigation.
- MUST render repository-derived labels as escaped text only.
- MUST restrict visual styling for labels and graph adornments to an allowlisted set.
- MUST use Theia theme variables for colors, surfaces, and text treatment.
- MUST support keyboard actions for graph interaction and navigation.

### Source and Reference Rules

- MUST runtime-read both prior handoffs before implementing any graph UI behavior.
- MUST runtime-read the current Studio frontend module, operation UI, styles, and relevant tests before editing browser code.
- MUST runtime-read installed Theia `ReactWidget`, `WidgetFactory`, `AbstractViewContribution`, `OpenHandler`, `EditorManager`, selection, state, and theme APIs before finalizing the implementation shape.
- MUST runtime-read focused graph, file tree, file viewer, and shell layout files under `/Volumes/coding/cf-work/workspace-sources/constructorfabric/fabric-poc/poc/ui-1` and use them only for interaction and visual vocabulary.
- MUST avoid loading Zustand store implementation, mock data bodies, backend Git internals, and Electron-specific UI.

### Test and Scope Rules

- MUST test escaped labels, state restoration, and Monaco navigation behavior.
- MUST keep all changes inside the eight declared output files.
- MUST keep this phase limited to graph views, details views, navigation handlers, commands, styles, and frontend wiring.
- MUST make all acceptance criteria binary and objectively verifiable.
- MUST leave no unresolved template variables outside fenced code blocks.
- MUST keep this phase file at or below 430 lines.
- MUST finish with a self-check against every acceptance criterion.

### Prohibitions

- MUST NOT replace the Theia shell with a custom application container.
- MUST NOT render unescaped repository-derived label content.
- MUST NOT persist backend snapshots as local source-of-truth state.
- MUST NOT edit backend graph code, Git internals, Electron UI, or unrelated browser components.
- MUST NOT edit plan files, briefs, or output files outside the declared Phase 7 list.

## Input

### Stable Plan Metadata

- Project root: `/Volumes/coding/cf-work/workspace-sources/constructorfabric/fabric-poc/poc/theia`
- Plan directory: `/Volumes/coding/cf-work/workspace-sources/constructorfabric/fabric-poc/poc/theia/.cf-studio/.plans/theia-studio-cloud-poc`
- Phase file: `/Volumes/coding/cf-work/workspace-sources/constructorfabric/fabric-poc/poc/theia/.cf-studio/.plans/theia-studio-cloud-poc/phase-07-graph-editor-ui.md`
- Prior handoff paths:
  - `/Volumes/coding/cf-work/workspace-sources/constructorfabric/fabric-poc/poc/theia/.cf-studio/.plans/theia-studio-cloud-poc/out/phase-05-save-git-operations-ui.md`
  - `/Volumes/coding/cf-work/workspace-sources/constructorfabric/fabric-poc/poc/theia/.cf-studio/.plans/theia-studio-cloud-poc/out/phase-06-graph-indexer.md`
- Declared output files:
  - `/Volumes/coding/cf-work/workspace-sources/constructorfabric/fabric-poc/poc/theia/studio/src/browser/workspace-graph-widget.tsx`
  - `/Volumes/coding/cf-work/workspace-sources/constructorfabric/fabric-poc/poc/theia/studio/src/browser/workspace-graph-widget.test.tsx`
  - `/Volumes/coding/cf-work/workspace-sources/constructorfabric/fabric-poc/poc/theia/studio/src/browser/workspace-graph-contribution.ts`
  - `/Volumes/coding/cf-work/workspace-sources/constructorfabric/fabric-poc/poc/theia/studio/src/browser/object-details-widget.tsx`
  - `/Volumes/coding/cf-work/workspace-sources/constructorfabric/fabric-poc/poc/theia/studio/src/browser/graph-open-handler.ts`
  - `/Volumes/coding/cf-work/workspace-sources/constructorfabric/fabric-poc/poc/theia/studio/src/browser/graph-open-handler.test.ts`
  - `/Volumes/coding/cf-work/workspace-sources/constructorfabric/fabric-poc/poc/theia/studio/src/browser/studio-frontend-module.ts`
  - `/Volumes/coding/cf-work/workspace-sources/constructorfabric/fabric-poc/poc/theia/studio/src/browser/style/index.css`

### Required Implementation Facts

- Phase 5 frontend conventions determine how Studio browser widgets, commands, notifications, and styles integrate into the existing frontend module.
- Phase 6 graph contracts define the exact snapshot DTOs, graph object identity, diagnostics shape, RPC entry points, and event semantics that the graph UI must consume.
- Theia `ReactWidget`, `WidgetFactory`, `AbstractViewContribution`, and related APIs determine view lifecycle, restoration, area placement, commands, and menus.
- Theia `OpenHandler` and `EditorManager` determine verified Monaco navigation behavior.
- Theia selection, state, and theme APIs determine selection propagation, persisted widget state, and theme-variable-based styling.
- The `ui-1` reference files are visual and interaction references only; they are not implementation architecture or state-management authority.

## Task

1. Read the prior handoffs at `/Volumes/coding/cf-work/workspace-sources/constructorfabric/fabric-poc/poc/theia/.cf-studio/.plans/theia-studio-cloud-poc/out/phase-05-save-git-operations-ui.md` and `/Volumes/coding/cf-work/workspace-sources/constructorfabric/fabric-poc/poc/theia/.cf-studio/.plans/theia-studio-cloud-poc/out/phase-06-graph-indexer.md` to extract frontend service conventions plus the exact graph DTO, RPC, event, diagnostics, and snapshot contracts that the new views must consume.
2. Read the current browser implementation surface before editing: `/Volumes/coding/cf-work/workspace-sources/constructorfabric/fabric-poc/poc/theia/studio/src/browser/`, including `studio-frontend-module.ts`, the current operation UI browser files produced by Phase 5, the current browser styles, and any relevant browser tests that define existing widget, command, and layout conventions.
3. Read the installed Theia APIs that govern this phase from `node_modules/@theia/core/src/browser/` and `node_modules/@theia/editor/src/browser/`, including the local sources for `ReactWidget`, `WidgetFactory`, `AbstractViewContribution`, `OpenHandler`, `EditorManager`, selection, state restoration, and theme APIs. Use them to determine the correct native Theia registration, view placement, restore, command, menu, and Monaco navigation patterns.
4. Read focused reference files under `/Volumes/coding/cf-work/workspace-sources/constructorfabric/fabric-poc/poc/ui-1/src/components/graph`, `/Volumes/coding/cf-work/workspace-sources/constructorfabric/fabric-poc/poc/ui-1/src/components/files`, and `/Volumes/coding/cf-work/workspace-sources/constructorfabric/fabric-poc/poc/ui-1/src/components/layout`. Use them only for interaction and visual vocabulary, not for state-store architecture or backend assumptions.
5. Implement `/Volumes/coding/cf-work/workspace-sources/constructorfabric/fabric-poc/poc/theia/studio/src/browser/workspace-graph-widget.tsx`, `/Volumes/coding/cf-work/workspace-sources/constructorfabric/fabric-poc/poc/theia/studio/src/browser/object-details-widget.tsx`, `/Volumes/coding/cf-work/workspace-sources/constructorfabric/fabric-poc/poc/theia/studio/src/browser/workspace-graph-contribution.ts`, `/Volumes/coding/cf-work/workspace-sources/constructorfabric/fabric-poc/poc/theia/studio/src/browser/graph-open-handler.ts`, and `/Volumes/coding/cf-work/workspace-sources/constructorfabric/fabric-poc/poc/theia/studio/src/browser/studio-frontend-module.ts` so the UI registers main-area Workspace Graph and right-area Object Details views, fetches and refetches snapshots, shows diagnostics and dirty overlays, filters and highlights connected neighborhoods, supports keyboard actions, and opens verified file and range locations in Monaco.
6. Update `/Volumes/coding/cf-work/workspace-sources/constructorfabric/fabric-poc/poc/theia/studio/src/browser/style/index.css` to style the graph and object-details views using Theia theme variables only, while keeping repository-derived labels escaped and visually constrained to allowlisted treatments.
7. Add or update `studio/src/browser/workspace-graph-widget.test.tsx` and `studio/src/browser/graph-open-handler.test.ts` so they prove escaped-label rendering, state restoration for selection or filters or viewport or last SHA, and verified Monaco navigation behavior. Then run and record `npm test`, `npm run build:browser`, and `npm run build:electron` from `/Volumes/coding/cf-work/workspace-sources/constructorfabric/fabric-poc/poc/theia`, and self-check every acceptance criterion before reporting PASS.
8. Write the exact completion report and next-phase prompt to `/Volumes/coding/cf-work/workspace-sources/constructorfabric/fabric-poc/poc/theia/.cf-studio/.plans/theia-studio-cloud-poc/out/phase-07-graph-editor-ui.md` after the self-check passes.

## Acceptance Criteria

- [ ] `studio/src/browser/workspace-graph-widget.tsx` implements a native Theia graph widget that uses React Flow only inside the widget, fetches and refetches backend snapshots, shows diagnostics and dirty overlay states, and defaults large graphs to filtered connected-neighborhood presentation.
- [ ] `studio/src/browser/object-details-widget.tsx` and `studio/src/browser/workspace-graph-contribution.ts` register a right-area Object Details view and main-area Workspace Graph view with native Theia widget factories, contributions, commands, and menus.
- [ ] `studio/src/browser/graph-open-handler.ts` and the graph widget open only verified file and range locations in Monaco through Theia editor APIs, with keyboard-accessible actions.
- [ ] `studio/src/browser/studio-frontend-module.ts` wires the new widgets and services without replacing the Theia shell or introducing backend or Electron UI scope.
- [ ] `studio/src/browser/style/index.css` uses Theia theme variables and allows only escaped text plus allowlisted visual styles for repository-derived labels.
- [ ] Persisted widget state is limited to selection, filters, viewport, and last SHA, and backend snapshots or events remain the source of truth after restore or reconnect.
- [ ] Tests cover escaped labels, state restoration, and Monaco navigation behavior, and `npm test`, `npm run build:browser`, and `npm run build:electron` all pass.
- [ ] This phase file contains no unresolved template variables outside fenced code blocks and stays at or below 430 lines.

## Output Format

When complete, report results in this exact format:
```text
PHASE 7/9 COMPLETE
Status: PASS | FAIL
Files created: {list}
Files modified: {list}
Acceptance criteria:
  [x] Criterion 1 — PASS
  [ ] Criterion 2 — FAIL: {reason}
  ...
Line count: {actual}/430
Notes: {any issues or decisions made}
```

If `Status: PASS`, then generate a copy-pasteable prompt for the next phase inside a single code fence:

```text
Next phase prompt (copy-paste into new chat if needed):

I have a Studio execution plan at:
  /Volumes/coding/cf-work/workspace-sources/constructorfabric/fabric-poc/poc/theia/.cf-studio/.plans/theia-studio-cloud-poc/plan.toml

Phase 7 is complete (PASS).
Please read the plan manifest, then execute Phase 8: "Add audit, layout restoration, and Studio polish".
The phase file is:
  /Volumes/coding/cf-work/workspace-sources/constructorfabric/fabric-poc/poc/theia/.cf-studio/.plans/theia-studio-cloud-poc/phase-08-audit-layout-polish.md

It is self-contained. Follow it exactly, report results, and stop after Phase 8.
```

If `Status: FAIL`, do not generate a next-phase execution prompt. Instead, emit:

```text
Phase 7 failed. Do not proceed to Phase 8.
Fix the failed acceptance criteria in:
  /Volumes/coding/cf-work/workspace-sources/constructorfabric/fabric-poc/poc/theia/.cf-studio/.plans/theia-studio-cloud-poc/phase-07-graph-editor-ui.md
Then rerun Phase 7 and report PASS before continuing.
```
