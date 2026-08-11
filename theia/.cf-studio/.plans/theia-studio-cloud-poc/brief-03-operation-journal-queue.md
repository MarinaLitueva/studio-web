# Compilation Brief: Phase 3/9 — Implement the operation journal and repository queue

--- CONTEXT BOUNDARY ---
Disregard all previous context. This brief is self-contained.
Read ONLY the files listed below. Follow the instructions exactly.
---

## Phase Metadata
```toml
[phase]
number = 3
total = 9
type = "implement"
title = "Implement the operation journal and repository queue"
depends_on = [2]
input_manifest = ""
input_signature = ""
input_files = ["studio/package.json", "studio/configs/jest.config.ts", "studio/src/common/studio-protocol.ts", "studio/src/node/studio-runtime-config.ts", "studio/src/node/workspace-boundary.ts", "studio/src/node/studio-backend-module.ts"]
output_files = ["studio/src/common/studio-protocol.ts", "studio/src/node/operation-journal.ts", "studio/src/node/repository-operation-queue.ts", "studio/src/node/operation-journal.test.ts", "studio/src/node/repository-operation-queue.test.ts"]
outputs = ["out/phase-03-operation-journal-queue.md"]
inputs = ["out/phase-02-runtime-workspace-protocol.md"]
```

## Compilation Clarification

- Compile persistence and serialization before any real commit is permitted.
- Use append-only JSONL under `STUDIO_DATA_DIR`; repository files are never journal storage.
- Implement the accepted operation state machine and monotonic event sequence.
- Idempotency binds key to workspace, relative path, and content hash.
- One in-process queue serializes operations for the fixed repository.
- Crash replay, duplicate requests, trailing corrupt records, and reconnect deltas require deterministic tests.

## Load Instructions

1. **Plan manifest**: Read `.cf-studio/.plans/theia-studio-cloud-poc/plan.toml`.
   - Action: compile-time metadata only.
2. **Prior handoff**: Read `/Volumes/coding/cf-work/workspace-sources/constructorfabric/fabric-poc/poc/theia/.cf-studio/.plans/theia-studio-cloud-poc/out/phase-02-runtime-workspace-protocol.md` at runtime.
   - Scope: use established DTO, config, data directory, and boundary contracts.
3. **Protocol and backend files**: Runtime-read the Phase 2 common/node implementation.
4. **Node persistence primitives**: Runtime-read only the standard-library file APIs needed for append, fsync/close, atomic replacement, and replay.

**Do NOT load**: Git execution code, UI components, graph parsers, or the UI reference project.

## Compile Phase File

Write to: `.cf-studio/.plans/theia-studio-cloud-poc/phase-03-operation-journal-queue.md`

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

The Task must implement `queued → validating → no-changes|committing → committed → pushing → pushed` plus `failed`, `push-pending`, and `blocked`; persist every transition before exposing it; replay current state; return existing results for duplicate idempotency keys; stream/retrieve events after sequence; and prove strict queue ordering. It must use a fake executor only.

## Context Budget

- Phase file target: ≤ 420 lines.
- Inlined content estimate: ~200 lines.
- Runtime code and tests: ~850 lines.
- Total execution context: ≤ 1,300 lines.

## After Compilation

Report: `Phase 3 compiled → phase-03-operation-journal-queue.md (N lines)`.
