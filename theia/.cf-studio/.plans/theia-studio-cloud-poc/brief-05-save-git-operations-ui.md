# Compilation Brief: Phase 5/9 — Connect Theia Save to Git Operations UI

--- CONTEXT BOUNDARY ---
Disregard all previous context. This brief is self-contained.
Read ONLY the files listed below. Follow the instructions exactly.
---

## Phase Metadata
```toml
[phase]
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

## Compilation Clarification

- Preserve native Theia editor/filesystem save semantics and run RPC only after a successful save.
- Rebind `FilesystemSaveableService` compatibly for explicit Save, Save All, and confirmed close-save.
- Force autosave off; focus/delay saves never trigger Git.
- Browser sends relative path, content hash, workspace ID, and idempotency key only.
- UI state comes from backend journal events and reconnect deltas, not optimistic inference.
- Git Operations and status bar are the first functional vertical UI slice.

## Load Instructions

1. **Plan manifest**: Read `.cf-studio/.plans/theia-studio-cloud-poc/plan.toml`.
   - Action: compile-time metadata only.
2. **Prior handoff**: Read `/Volumes/coding/cf-work/workspace-sources/constructorfabric/fabric-poc/poc/theia/.cf-studio/.plans/theia-studio-cloud-poc/out/phase-04-git-publish-pipeline.md` at runtime.
   - Scope: use verified backend operation/RPC behavior.
3. **Current Studio browser extension**: Runtime-read all files under `studio/src/browser` and focused current tests.
4. **Theia Save APIs**: Runtime-read installed 1.73.1 `SaveableService`, `FilesystemSaveableService`, `SaveReason`, status bar, widget, and contribution sources.
5. **UI reference**: Runtime-read only Git/workspace badges and operation-state presentation in `../ui-1`; do not copy shell or state store.

**Do NOT load**: graph components, mock data bodies, Electron APIs, or unrelated Theia services.

## Compile Phase File

Write to: `.cf-studio/.plans/theia-studio-cloud-poc/phase-05-save-git-operations-ui.md`

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

The Task must implement save interception, hash/idempotency RPC, reconnect synchronization, operation list/retry actions, stable `data-testid` values, and branch/mode/operation status bar entries. Tests must verify exactly one operation per explicit changed-file save, none for autosave/no-change, ordered Save All behavior, and visible committed/pushing/pushed/pending/blocked states.

## Context Budget

- Phase file target: ≤ 440 lines.
- Inlined content estimate: ~210 lines.
- Runtime browser/backend source reads: ~1,000 lines.
- Total execution context: ≤ 1,450 lines.

## After Compilation

Report: `Phase 5 compiled → phase-05-save-git-operations-ui.md (N lines)`.
