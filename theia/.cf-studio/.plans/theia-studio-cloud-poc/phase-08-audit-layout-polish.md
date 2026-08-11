```toml
[phase]
plan = "theia-studio-cloud-poc"
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

## Preamble

This is a self-contained phase file. All rules, constraints, and kit content
are included below. Project files listed in the Task section must be read
at runtime. Follow the instructions exactly, run any EXECUTE commands as
written, and report results against the acceptance criteria at the end.

## What

Add the final browser-only polish layer for the Studio PoC by introducing a sanitized Audit view, first-run layout composition, and coherent command/menu/status styling across custom Studio views. Scope is limited to browser presentation and lifecycle behavior: audit DTO rendering, layout initialization that respects restored user layouts, theme-aware styling, keyboard focus, and focused tests for redaction, restore behavior, theme variables, and command accessibility. Do not add new Git behavior, graph business logic, backend journal storage access, or any non-browser feature in this phase.

## Prior Context

- This phase depends on Phase 5 and Phase 7 and keeps their `out/` handoff files as future runtime-read inputs even when absent during compilation.
- The plan assigns this phase only `studio/src/browser/audit-widget.tsx`, `studio/src/browser/audit-widget.test.tsx`, `studio/src/browser/audit-contribution.ts`, `studio/src/browser/studio-contribution.ts`, `studio/src/browser/studio-contribution.test.ts`, `studio/src/browser/studio-frontend-module.ts`, and `studio/src/browser/style/index.css`.
- The current Studio browser package still contains only the starter contribution, frontend module, sample widget, test, and stylesheet.
- The brief fixes audit as a sanitized backend DTO view over journal events rather than direct JSONL access.
- Theia `FrontendApplicationContribution.initializeLayout` runs only when no saved layout exists, and `ShellLayoutRestorer` restores persisted layout from browser storage before that hook.
- Theia remains the application shell; `ui-1` is reference-only for visual vocabulary such as badges, breadcrumbs, cards, and state labels.

## User Decisions
### Already Decided (pre-resolved during planning)
- **Audit source**: Audit data is a sanitized backend DTO view over journal events only.
- **Audit fields**: The Audit view shows sequence, relative path, content hash, SHA, time, and sanitized outcome only.
- **Layout policy**: First-run layout initialization executes only when no saved user layout exists and must never overwrite restored layouts.
- **Shell ownership**: Theia remains the shell; `ui-1` contributes only visual vocabulary, not state shape or shell structure.
- **View quality bar**: All custom views support dark and light themes, keyboard focus, stable commands, and stable test selectors.
- **Status vocabulary**: Labels must distinguish modified, committed, pushing, pushed, pending, failed, and blocked.
- **Business-logic boundary**: No new Git logic or graph logic may be added in this phase.
- **Testing focus**: Audit redaction, layout restore behavior, theme variables, and command accessibility are mandatory.

## Rules

### Audit View Rules

- MUST render audit data from sanitized backend DTOs only.
- MUST NOT read JSONL files, backend journal storage, or raw executor output directly from the browser.
- MUST display only sequence, path, hash, SHA, time, and sanitized outcome fields from audit entries.
- MUST redact or omit secrets, raw payload bodies, absolute paths, token values, and internal backend-only fields.
- MUST preserve stable `data-testid` values for audit rows, filters, badges, and command surfaces.

### Layout and Lifecycle Rules

- MUST compose the first-run Studio layout only when no saved user layout exists.
- MUST respect Theia shell layout restoration and MUST NOT overwrite restored layouts.
- MUST use Theia frontend lifecycle APIs, shell placement APIs, and storage-aware layout behavior instead of ad hoc persistence.
- MUST place custom views into left, main, right, and bottom areas only as an initial default composition.
- MUST keep Theia as the top-level shell and MUST NOT recreate `ui-1` application structure inside the extension.

### Polish, Theme, and Accessibility Rules

- MUST finalize view, command, menu, and status presentation for custom Studio views in this phase.
- MUST support dark and light themes through Theia theme variables and compatible CSS, not hard-coded single-theme assumptions.
- MUST provide keyboard focus behavior for custom views and actionable controls.
- MUST keep command IDs, menu entries, toggle behavior, and status labels stable and testable.
- MUST distinguish modified, committed, pushing, pushed, pending, failed, and blocked states visually.
- MUST NOT add new Git business logic, graph parsing logic, graph indexing logic, or backend executor behavior.

## Input

### Stable Reference Constraints

- `FrontendApplicationContribution.initializeLayout` is the correct hook for default view composition when no prior layout exists.
- `ShellLayoutRestorer.restoreLayout` returns early when no saved layout is available and otherwise restores persisted shell state before default layout code should run.
- Theia `StorageService` persists layout state by browser location-scoped keys, so this phase must avoid parallel custom layout persistence.
- Theia status bar entries support stable IDs, alignments, commands, tooltips, and accessibility metadata for final status presentation.
- Theia `ThemeService` and theme variables are the baseline for dark/light-compatible Studio styling.

### UI Reference Vocabulary

- `ui-1` top-level shell uses breadcrumbs, compact badges, clear card boundaries, and explicit state labels to keep navigation and state readable.
- `ui-1` audit presentation uses a list/card style with visible timestamps, severity/state markers, and expandable detail surfaces.
- `ui-1` workspace and status surfaces use compact labels and small badges rather than large custom shell chrome.
- These reference cues are presentation-only and do not authorize copying mock data, shell layout, or store architecture.

### Future Runtime Inputs

- `out/phase-05-save-git-operations-ui.md` remains a required runtime-read input for finished operation/status/frontend-service behavior.
- `out/phase-07-graph-editor-ui.md` remains a required runtime-read input for finished graph/details/layout/frontend behavior.
- Their future runtime availability does not change this phase file at compile time; executing the phase must still runtime-read both declared handoff files before acting.

## Task

1. Runtime-read `/Volumes/coding/cf-work/workspace-sources/constructorfabric/fabric-poc/poc/theia/.cf-studio/.plans/theia-studio-cloud-poc/out/phase-05-save-git-operations-ui.md` and `/Volumes/coding/cf-work/workspace-sources/constructorfabric/fabric-poc/poc/theia/.cf-studio/.plans/theia-studio-cloud-poc/out/phase-07-graph-editor-ui.md`, then runtime-read all current custom browser contributions, widgets, styles, and focused tests under `studio/src/browser/`; record the effective status, operation, graph, details, and frontend-service behaviors that the audit and layout polish layer must preserve.
2. Runtime-read the focused Theia lifecycle and shell sources needed for this phase: `node_modules/@theia/core/src/browser/frontend-application-contribution.ts`, `node_modules/@theia/core/src/browser/shell/application-shell.ts`, `node_modules/@theia/core/src/browser/shell/shell-layout-restorer.ts`, `node_modules/@theia/core/src/browser/storage-service.ts`, `node_modules/@theia/core/src/browser/status-bar/status-bar-types.ts`, and `node_modules/@theia/core/src/browser/`; extract the exact default-layout, restore-layout, storage, status-bar, and theme contracts the Studio browser code must follow.
3. Runtime-read only the focused `ui-1` App shell, audit, workspace-badge, breadcrumb, card, and state-label surfaces under `/Volumes/coding/cf-work/workspace-sources/constructorfabric/fabric-poc/poc/ui-1/src/components`; translate them into Theia-compatible presentation guidance for audit cards, breadcrumbs, status chips, and responsive shell polish without copying shell structure, store state, or mock-data bodies.
4. Implement `studio/src/browser/audit-widget.tsx` and `studio/src/browser/audit-contribution.ts` so Studio exposes an Audit view backed by sanitized backend DTOs only, rendering sequence, path, hash, SHA, time, and sanitized outcome with stable commands, keyboard focus, and stable `data-testid` selectors.
5. Update `studio/src/browser/studio-contribution.ts` and `studio/src/browser/studio-frontend-module.ts` so first-run left/main/right/bottom placement is composed only when no saved layout exists, restored user layouts remain untouched, and final view/command/menu/status presentation is wired across the custom Studio views.
6. Update `studio/src/browser/style/index.css`, `studio/src/browser/audit-widget.test.tsx`, and `studio/src/browser/studio-contribution.test.ts` so all custom views support responsive dark/light styling, keyboard focus, state labels for modified/committed/pushing/pushed/pending/failed/blocked, audit redaction, layout-restore preservation, theme-variable usage, and command accessibility.
7. Self-verify every acceptance criterion, confirm no new Git or graph business logic was introduced, and write `/Volumes/coding/cf-work/workspace-sources/constructorfabric/fabric-poc/poc/theia/.cf-studio/.plans/theia-studio-cloud-poc/out/phase-08-audit-layout-polish.md` with the exact completion report plus the next-phase prompt when all criteria pass.

## Acceptance Criteria

1. `studio/src/browser/audit-widget.tsx` renders a sanitized audit DTO view that exposes only sequence, path, hash, SHA, time, and sanitized outcome fields.
2. `studio/src/browser/audit-contribution.ts`, `studio/src/browser/studio-contribution.ts`, and `studio/src/browser/studio-frontend-module.ts` wire stable commands, menus, and view presentation for the Audit and Studio custom views.
3. Default left/main/right/bottom view composition runs only when no saved layout exists and does not overwrite restored user layouts.
4. `studio/src/browser/style/index.css` uses theme-compatible styling that works in both dark and light themes and preserves keyboard-focus visibility.
5. Visible labels across custom views distinguish modified, committed, pushing, pushed, pending, failed, and blocked states.
6. Tests verify audit redaction, layout-restore preservation, theme-variable-based styling, stable test selectors, and command accessibility.
7. No new Git business logic, graph business logic, graph parser internals, backend executor behavior, or mock-data-body dependencies are introduced in this phase.
8. This phase file remains at or below 340 lines.
9. The completion report contains no unresolved template variables outside fenced examples.

## Output Format

When complete, report results in this exact format:
```text
PHASE 8/9 COMPLETE
Status: PASS | FAIL
Files created: {list}
Files modified: {list}
Acceptance criteria:
  [x] Criterion 1 — PASS
  [ ] Criterion 2 — FAIL: {reason}
  ...
Line count: {actual}/340
Notes: {any issues or decisions made}
```

If `Status: PASS`, then generate a **copy-pasteable prompt** for the next phase inside a single code fence:

```text
Next phase prompt (copy-paste into new chat if needed):

I have a Studio execution plan at:
  /Volumes/coding/cf-work/workspace-sources/constructorfabric/fabric-poc/poc/theia/.cf-studio/.plans/theia-studio-cloud-poc/plan.toml

Phase 8 is complete (PASS).
Please read the plan manifest, then execute Phase 9: "Integrate, harden, document, and validate the PoC".
The phase file is:
  /Volumes/coding/cf-work/workspace-sources/constructorfabric/fabric-poc/poc/theia/.cf-studio/.plans/theia-studio-cloud-poc/phase-09-integration-hardening.md

It is self-contained. Follow it exactly, report results, and stop after Phase 9.
```

If `Status: FAIL`, do not generate a next-phase execution prompt. Instead, emit:

```text
Phase 8 failed. Do not proceed to Phase 9.
Fix the failed acceptance criteria in:
  /Volumes/coding/cf-work/workspace-sources/constructorfabric/fabric-poc/poc/theia/.cf-studio/.plans/theia-studio-cloud-poc/phase-08-audit-layout-polish.md
Then rerun Phase 8 and report PASS before continuing.
```
