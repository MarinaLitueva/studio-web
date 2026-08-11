```toml
[phase]
plan = "theia-studio-cloud-poc"
number = 5
total = 9
type = "implement"
title = "Connect Theia Save to Git Operations UI"
depends_on = [4]
input_manifest = ""
input_signature = ""
input_files = ["studio/src/browser/", "node_modules/@theia/core/src/browser/saveable.ts", "node_modules/@theia/core/src/browser/saveable-service.ts", "node_modules/@theia/filesystem/src/browser/filesystem-saveable-service.ts", "node_modules/@theia/core/src/browser/status-bar/status-bar-types.ts", "node_modules/@theia/core/src/browser/status-bar/", "/Volumes/coding/cf-work/workspace-sources/constructorfabric/fabric-poc/poc/ui-1/src/components", "/Volumes/coding/cf-work/workspace-sources/constructorfabric/fabric-poc/poc/ui-1/src/types"]
output_files = ["studio/src/browser/studio-saveable-service.ts", "studio/src/browser/studio-saveable-service.test.ts", "studio/src/browser/git-operations-widget.tsx", "studio/src/browser/git-operations-widget.test.tsx", "studio/src/browser/git-operations-contribution.ts", "studio/src/browser/studio-frontend-module.ts", "studio/src/browser/style/index.css"]
outputs = ["out/phase-05-save-git-operations-ui.md"]
inputs = ["out/phase-04-git-publish-pipeline.md"]
```

## Preamble

This is a self-contained phase file. All rules, constraints, and kit content
are included below. Project files listed in the Task section must be read
at runtime. Follow the instructions exactly, run any EXECUTE commands as
written, and report results against the acceptance criteria at the end.

## What

Implement the first functional Studio browser slice by intercepting explicit Theia file saves and connecting them to the backend Git operation pipeline plus a visible operations UI and status bar state. Scope is limited to browser-side save interception, RPC request shaping, reconnect synchronization, operations/status presentation, and focused tests for explicit save behavior and visible operation states. Do not change native filesystem persistence semantics, autosave into Git behavior, Electron-specific flows, graph UI, or backend Git pipeline contracts beyond consuming the already-defined Phase 4 RPC surface.

## Prior Context

- This phase depends only on Phase 4 and uses `out/phase-04-git-publish-pipeline.md` as its prior handoff input.
- The plan assigns this phase only `studio/src/browser/studio-saveable-service.ts`, `studio/src/browser/studio-saveable-service.test.ts`, `studio/src/browser/git-operations-widget.tsx`, `studio/src/browser/git-operations-widget.test.tsx`, `studio/src/browser/git-operations-contribution.ts`, `studio/src/browser/studio-frontend-module.ts`, and `studio/src/browser/style/index.css`.
- The current browser extension contains only `studio-contribution.ts`, `studio-frontend-module.ts`, `studio-widget.tsx`, `studio-widget.test.ts`, and `style/index.css`.
- `studio/src/browser/studio-frontend-module.ts` already binds the existing view contribution and widget factory and is the integration point for new browser services and widgets.
- Theia `SaveableService` and `FilesystemSaveableService` currently own explicit save, save-all, close-with-save, and autosave behavior; this phase must preserve successful filesystem writes before invoking backend RPC.
- The brief fixes autosave to off for Git triggering, requires relative-path plus hash/idempotency RPC payloads only, and requires UI state to come from backend journal events and reconnect deltas rather than optimistic frontend inference.

## User Decisions
### Already Decided (pre-resolved during planning)
- **Save trigger**: Only explicit successful saves trigger Git operations.
- **Autosave policy**: Focus-change and delay autosaves never trigger Git; autosave is forced off for this vertical slice.
- **Save service strategy**: Rebind `FilesystemSaveableService` compatibly so Save, Save All, and close-with-save preserve native Theia semantics before Studio RPC runs.
- **Browser payload**: The browser sends only relative path, content hash, workspace ID, and idempotency key.
- **UI truth source**: Operation state is driven by backend journal events plus reconnect synchronization deltas.
- **UI scope**: Git Operations view and status bar entries are the first functional vertical slice.
- **Visible states**: Committed, pushing, pushed, pending, and blocked must be rendered explicitly.
- **Testing priority**: Exactly one operation per explicit changed-file save, none for autosave and no-change saves, ordered Save All, reconnect sync, and stable `data-testid` coverage.

## Rules

### Save Semantics Rules

- MUST preserve native Theia editor and filesystem save semantics.
- MUST invoke Studio RPC only after the underlying save succeeds.
- MUST rebind `FilesystemSaveableService` compatibly for explicit Save, Save All, and confirmed close-save flows.
- MUST ensure autosave remains off for Git-triggering behavior.
- MUST NOT enqueue Git work for `SaveReason.AfterDelay`, focus-change saves, or any autosave path.
- MUST NOT enqueue Git work when file content did not change.
- MUST ensure Save All preserves deterministic ordering and emits at most one operation per changed file in that order.
- MUST keep untitled, Save As, revert, and plain filesystem persistence behavior compatible with upstream Theia expectations.

### Browser-to-Backend Contract Rules

- MUST consume the existing backend RPC/journal behavior from Phase 4 instead of redefining backend semantics in this phase.
- MUST send only relative path, content hash, workspace ID, and idempotency key from the browser save hook.
- MUST NOT send absolute paths, actor IDs, secrets, file contents, branch overrides, or raw workspace-root data from the browser.
- MUST derive UI state from backend journal events and reconnect deltas, not optimistic local status transitions.
- MUST implement reconnect synchronization so browser state can recover from dropped connections or page reloads without duplicating operations.

### UI and Test Rules

- MUST add a dedicated Git Operations widget and contribution with stable `data-testid` values for list rows, retry actions, state badges, and status surfaces.
- MUST surface branch, mode, and operation status bar entries using Theia status bar APIs.
- MUST include retry actions for retryable blocked or failed-visible operation states only when the backend contract permits retry.
- MUST keep styling confined to `studio/src/browser/style/index.css` for this phase.
- MUST read UI reference material only for Git/workspace badges and operation-state presentation, not for shell layout or store architecture.
- MUST add or update focused browser tests for explicit save, no-change save, autosave suppression, Save All ordering, reconnect synchronization, and visible pending/blocked/committed/pushing/pushed states.

## Input

### Stable Reference Constraints

- Theia `SaveableService` distinguishes manual saves from `SaveReason.FocusChange` and `SaveReason.AfterDelay`; autosave hooks already exist and must be bypassed for Git.
- `FilesystemSaveableService` is the compatible extension point for preserving successful file persistence before any Studio-specific post-save behavior.
- Theia status bar entries are registered by ID and can present left/right aligned text, icons, commands, tooltips, and affinity relationships.
- The existing Studio frontend module already binds a widget contribution and widget factory and must be extended rather than replaced.

### Save API Facts To Respect

- The manual save path must remain the source of truth for when Studio may enqueue a Git operation.
- Closing a dirty widget with save confirmation must still execute the confirmed save path and only then run post-save Studio logic.
- Save All can iterate across multiple dirty widgets; this phase must preserve that behavior while deduplicating no-change saves.

### UI Reference Shape

- Workspace and status surfaces in the UI reference use compact status badges, branch/workspace indicators, and explicit state labels.
- The reference contributes presentation cues only: status chips, lightweight badges, and clear pending/running/done/error distinctions.
- The reference does not authorize copying shell layout, global store shape, or mock data structures into the Theia extension.

## Task

1. Runtime-read `/Volumes/coding/cf-work/workspace-sources/constructorfabric/fabric-poc/poc/theia/.cf-studio/.plans/theia-studio-cloud-poc/out/phase-04-git-publish-pipeline.md`, then runtime-read all current files under `studio/src/browser`; record the effective frontend extension boundaries, existing widget/contribution bindings, and the exact insertion points for the new save service, Git Operations view, and status bar state.
2. Runtime-read the focused Theia 1.73.1 browser sources that define the save/status integration contract: `node_modules/@theia/core/src/browser/saveable.ts`, `node_modules/@theia/core/src/browser/saveable-service.ts`, `node_modules/@theia/filesystem/src/browser/filesystem-saveable-service.ts`, `node_modules/@theia/core/src/browser/status-bar/status-bar-types.ts`, and `node_modules/@theia/core/src/browser/status-bar/`; extract the exact manual-save, autosave, Save All, close-save, and status-bar patterns the Studio browser code must follow.
3. Runtime-read only the Git/workspace badge and operation-state presentation surfaces in `/Volumes/coding/cf-work/workspace-sources/constructorfabric/fabric-poc/poc/ui-1/src/components` and `/Volumes/coding/cf-work/workspace-sources/constructorfabric/fabric-poc/poc/ui-1/src/types`; translate them into compact Theia-compatible UI guidance for branch, mode, operation badges, reconnect deltas, and blocked/pending/pushing/pushed/committed visibility without copying shell layout or store design.
4. Implement `studio/src/browser/studio-saveable-service.ts` and update `studio/src/browser/studio-frontend-module.ts` so the Studio frontend rebinds `FilesystemSaveableService` compatibly, forces autosave off for Git triggering, runs the underlying filesystem save first, and then invokes backend RPC only for explicit changed-file saves using relative path, content hash, workspace ID, and idempotency key.
5. Implement `studio/src/browser/git-operations-widget.tsx` and `studio/src/browser/git-operations-contribution.ts` so the browser subscribes to backend journal events, performs reconnect synchronization, renders operation rows and retry actions with stable `data-testid` values, and updates status bar entries for branch, mode, and operation state without optimistic local inference.
6. Update `studio/src/browser/style/index.css`, `studio/src/browser/studio-saveable-service.test.ts`, and `studio/src/browser/git-operations-widget.test.tsx` so the vertical slice visibly supports committed, pushing, pushed, pending, and blocked states and verifies exactly one operation per explicit changed-file save, no operation for autosave or no-change saves, ordered Save All behavior, reconnect resynchronization, and retry/status surfaces.
7. Self-verify every acceptance criterion and confirm no graph/Electron/unrelated services were added.
8. Write the exact completion report and next-phase prompt to `/Volumes/coding/cf-work/workspace-sources/constructorfabric/fabric-poc/poc/theia/.cf-studio/.plans/theia-studio-cloud-poc/out/phase-05-save-git-operations-ui.md` after the self-check passes.

## Acceptance Criteria

1. `studio/src/browser/studio-saveable-service.ts` extends or rebinds Theia save behavior so Studio RPC runs only after a successful explicit save and never for autosave paths.
2. Browser RPC payloads for save-triggered Git operations contain only relative path, content hash, workspace ID, and idempotency key.
3. `studio/src/browser/git-operations-widget.tsx` and `studio/src/browser/git-operations-contribution.ts` render backend-driven operation state, reconnect synchronization, retry actions, and stable `data-testid` values.
4. `studio/src/browser/studio-frontend-module.ts` wires the save service, Git Operations UI slice, and status bar integrations without removing existing Studio frontend bindings.
5. Branch, mode, and operation state appear through Theia status bar entries and visibly support committed, pushing, pushed, pending, and blocked states.
6. Tests verify exactly one operation per explicit changed-file save, zero operations for autosave and no-change saves, deterministic Save All ordering, reconnect synchronization, and visible state rendering.
7. The implementation does not load graph components, Electron APIs, mock-data bodies, or unrelated Theia services for this phase.
8. This phase file remains at or below 440 lines.
9. The completion report contains no unresolved template variables outside fenced examples.

## Output Format

When complete, report results in this exact format:
```text
PHASE 5/9 COMPLETE
Status: PASS | FAIL
Files created: {list}
Files modified: {list}
Acceptance criteria:
  [x] Criterion 1 — PASS
  [ ] Criterion 2 — FAIL: {reason}
  ...
Line count: {actual}/440
Notes: {any issues or decisions made}
```

If `Status: PASS`, then generate a **copy-pasteable prompt** for the next phase inside a single code fence:

```text
Next phase prompt (copy-paste into new chat if needed):

I have a Studio execution plan at:
  /Volumes/coding/cf-work/workspace-sources/constructorfabric/fabric-poc/poc/theia/.cf-studio/.plans/theia-studio-cloud-poc/plan.toml

Phase 5 is complete (PASS).
Please read the plan manifest, then execute Phase 6: "Build commit-addressed workspace graph snapshots".
The phase file is:
  /Volumes/coding/cf-work/workspace-sources/constructorfabric/fabric-poc/poc/theia/.cf-studio/.plans/theia-studio-cloud-poc/phase-06-graph-indexer.md

It is self-contained. Follow it exactly, report results, and stop after Phase 6.
```

If `Status: FAIL`, do not generate a next-phase execution prompt. Instead, emit:

```text
Phase 5 failed. Do not proceed to Phase 6.
Fix the failed acceptance criteria in:
  /Volumes/coding/cf-work/workspace-sources/constructorfabric/fabric-poc/poc/theia/.cf-studio/.plans/theia-studio-cloud-poc/phase-05-save-git-operations-ui.md
Then rerun Phase 5 and report PASS before continuing.
```
