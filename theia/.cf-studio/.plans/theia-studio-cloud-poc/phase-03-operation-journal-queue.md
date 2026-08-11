```toml
[phase]
plan = "theia-studio-cloud-poc"
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

## Preamble

This is a self-contained phase file. All rules, constraints, and kit content
are included below. Project files listed in the Task section must be read
at runtime. Follow the instructions exactly, run any EXECUTE commands as
written, and report results against the acceptance criteria at the end.

## What

Implement the backend persistence layer that records every save-to-publish operation and the single in-process queue that serializes those operations for the fixed repository. Scope is limited to protocol additions, append-only JSONL journal storage under `STUDIO_DATA_DIR`, deterministic replay and event retrieval, and fake-executor tests that prove ordering, idempotency, and crash recovery behavior. Do not introduce real Git execution, browser UI work, graph features, or any repository-local journal files in this phase.

## Prior Context

Phase 1 established the browser, electron, and studio package boundaries for the PoC.
Phase 2 defined the runtime configuration and workspace boundary contracts that this phase must reuse.
The runtime config contract owns `STUDIO_DATA_DIR` and the fixed single-user workspace identity used by backend services.
The workspace boundary contract owns normalized relative paths and the rule that writes must stay inside the allowed workspace root.
The common protocol contract is the only place where cross-process DTOs and RPC payloads may be shared.
This phase requires the Phase 2 handoff at `/Volumes/coding/cf-work/workspace-sources/constructorfabric/fabric-poc/poc/theia/.cf-studio/.plans/theia-studio-cloud-poc/out/phase-02-runtime-workspace-protocol.md` when it executes and then uses the matching code contracts in `studio/src/common/studio-protocol.ts`, `studio/src/node/studio-runtime-config.ts`, `studio/src/node/workspace-boundary.ts`, and `studio/src/node/studio-backend-module.ts`.
The current checkout already contains `studio/package.json`, `studio/configs/jest.config.ts`, and the browser-side `studio/src/browser/*` shell created earlier.
Phase 4 will consume the journal and queue interfaces from this phase to add real Git publish execution.

## User Decisions
### Already Decided (pre-resolved during planning)
- **Journal storage**: append-only JSONL files under `STUDIO_DATA_DIR`; repository files are never used for journal persistence.
- **Repository scope**: one fixed repository and one in-process queue for the PoC.
- **State machine**: `queued -> validating -> no-changes|committing -> committed -> pushing -> pushed` plus terminal or recoverable states `failed`, `push-pending`, and `blocked`.
- **Durability rule**: every state transition is persisted before it is exposed to readers or subscribers.
- **Idempotency scope**: an idempotency key is bound to workspace ID, normalized relative path, and content hash.
- **Execution backend**: tests use a fake executor only; no real Git commands are allowed in this phase.
### Decisions Needed During This Phase
None.

## Rules

### Scope And File Ownership
- MUST modify only `studio/src/common/studio-protocol.ts`, `studio/src/node/operation-journal.ts`, `studio/src/node/repository-operation-queue.ts`, `studio/src/node/operation-journal.test.ts`, and `studio/src/node/repository-operation-queue.test.ts`.
- MUST keep this phase self-contained and MUST NOT depend on UI components, graph code, or real Git execution code.
- MUST NOT create journal files inside the workspace repository being edited.

### Persistence And Replay
- MUST store journal records as append-only JSONL under `STUDIO_DATA_DIR`.
- MUST persist every operation transition before returning the transition to callers or stream subscribers.
- MUST maintain a monotonic event sequence for all persisted journal events.
- MUST replay persisted records into current operation state on service startup.
- MUST tolerate a trailing corrupt or partial JSONL record by ignoring only the invalid tail and preserving prior valid events.
- MUST use standard Node file APIs needed for append, fsync or equivalent durable flush, close, atomic replacement, and replay.

### State Machine And Idempotency
- MUST implement `queued -> validating -> no-changes|committing -> committed -> pushing -> pushed`.
- MUST support `failed`, `push-pending`, and `blocked` states where required by executor outcomes or retry constraints.
- MUST return the existing operation result instead of enqueuing duplicate work when the same idempotency key, workspace ID, relative path, and content hash are submitted again.
- MUST reject or isolate mismatched reuse of an idempotency key across a different workspace ID, relative path, or content hash.
- MUST expose event streaming and event retrieval using sequence-based deltas.

### Queue Semantics
- MUST serialize operations strictly in enqueue order for the fixed repository.
- MUST ensure only one operation is actively executing at a time inside the process.
- MUST preserve queue order across reconnect reads and replayed state.
- MUST keep the queue implementation independent from concrete Git execution by using a fake executor contract in tests.

### Testing And Quality
- MUST add deterministic tests for crash replay, duplicate requests, trailing corrupt records, reconnect deltas, and strict queue ordering.
- MUST verify the no-change path without producing commit or push transitions.
- MUST verify blocking or failure behavior without using time-sensitive flaky assertions.
- MUST keep the phase file under 420 lines.
- MUST leave no unresolved brace-delimited template placeholders outside fenced examples.

## Input

### Stable references
- Plan manifest metadata:
  - Phase number: `3`
  - Phase title: `Implement the operation journal and repository queue`
  - Depends on: Phase `2`
  - Declared outputs: `studio/src/common/studio-protocol.ts`, `studio/src/node/operation-journal.ts`, `studio/src/node/repository-operation-queue.ts`, `studio/src/node/operation-journal.test.ts`, `studio/src/node/repository-operation-queue.test.ts`
- Accepted implementation constraints:
  - Persist before expose.
  - Replay current state from the journal.
  - Stream and retrieve events after a supplied sequence number.
  - Bind idempotency to workspace, relative path, and content hash.
  - Prove strict queue ordering with a fake executor only.

## Task

1. Read the compile-time context, then read the Phase 2 handoff and current project contracts at runtime.
   Read `.cf-studio/.plans/theia-studio-cloud-poc/plan.toml` for metadata only.
   Read `/Volumes/coding/cf-work/workspace-sources/constructorfabric/fabric-poc/poc/theia/.cf-studio/.plans/theia-studio-cloud-poc/out/phase-02-runtime-workspace-protocol.md`.
   Read `studio/src/common/studio-protocol.ts`, `studio/src/node/studio-runtime-config.ts`, `studio/src/node/workspace-boundary.ts`, and `studio/src/node/studio-backend-module.ts`.
   Read `studio/package.json` and `studio/configs/jest.config.ts` to match the local test environment.

2. Extend the shared protocol to describe journaled operations and delta retrieval.
   Update `studio/src/common/studio-protocol.ts` with the operation state union, persisted event shape, current operation snapshot, enqueue request and response DTOs, and sequence-based event retrieval or subscription payloads.
   Keep DTOs stable and serialization-friendly.
   Reuse the workspace ID, relative path, and content hash vocabulary established by Phase 2.

3. Implement durable append-only journal persistence and replay.
   Create `studio/src/node/operation-journal.ts`.
   Store journal files only under `STUDIO_DATA_DIR`.
   Implement append with durable flush, monotonic sequence assignment, replay into current state, lookup by idempotency scope, retrieval after sequence, and tolerant handling of a trailing corrupt JSONL record.
   If compaction or snapshot support is helpful, implement it with atomic replacement and without changing the append-only external contract.

4. Implement the repository operation queue on top of the journal.
   Create `studio/src/node/repository-operation-queue.ts`.
   Enqueue operations using the idempotency scope of workspace ID, normalized relative path, and content hash.
   Return an existing result for duplicates.
   Drive the accepted state machine through a fake executor interface only, persisting each transition before publishing it to readers.
   Guarantee exactly one active operation at a time and preserve strict FIFO ordering for the single repository.

5. Add deterministic persistence and queue tests.
   Create `studio/src/node/operation-journal.test.ts` covering replay, delta retrieval after sequence, idempotent lookup behavior, and trailing corrupt record recovery.
   Create `studio/src/node/repository-operation-queue.test.ts` covering strict queue ordering, duplicate request reuse, `no-changes`, `failed`, `push-pending`, and `blocked` transitions, plus reconnect-visible deltas after replay.
   Use only fake executors, temp directories, and deterministic assertions.

6. Self-verify the implementation against the acceptance criteria.
   Confirm every declared output file exists and matches this phase scope.
   Confirm journal persistence stays under `STUDIO_DATA_DIR`, no real Git execution was introduced, and no unresolved placeholders remain in edited files.
   Run the smallest relevant test command for the new node tests if the local package scripts support it, then report PASS or FAIL criterion by criterion.
7. Write the exact completion report and next-phase prompt to `/Volumes/coding/cf-work/workspace-sources/constructorfabric/fabric-poc/poc/theia/.cf-studio/.plans/theia-studio-cloud-poc/out/phase-03-operation-journal-queue.md` after the self-check passes.

## Acceptance Criteria

1. `studio/src/common/studio-protocol.ts` defines operation DTOs for the accepted state machine, persisted events, and sequence-based delta retrieval with no UI-only types mixed in.
2. `studio/src/node/operation-journal.ts` persists append-only JSONL under `STUDIO_DATA_DIR`, assigns monotonic event sequences, replays current state, and ignores only a trailing corrupt record during recovery.
3. `studio/src/node/repository-operation-queue.ts` enforces one active in-process operation, strict FIFO ordering, persisted-before-exposed transitions, and duplicate-result reuse keyed by workspace ID, normalized relative path, and content hash.
4. Tests prove `queued -> validating -> no-changes|committing -> committed -> pushing -> pushed` and the `failed`, `push-pending`, and `blocked` branches using fake executors only.
5. Tests prove replay after restart, reconnect delta retrieval after a supplied sequence number, duplicate request handling, and strict queue ordering deterministically.
6. No journal storage is written to repository files, and no real Git executor or unrelated UI or graph code is added in this phase.
7. This phase file is 420 lines or fewer.
8. This phase file contains no unresolved brace-delimited template placeholders outside fenced examples.

## Output Format

When complete, report results in this exact format:
```text
PHASE 3/9 COMPLETE
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

If `Status: PASS`, then generate a **copy-pasteable prompt** for the next phase inside a single code fence:

```text
Next phase prompt (copy-paste into new chat if needed):

I have a Studio execution plan at:
  /Volumes/coding/cf-work/workspace-sources/constructorfabric/fabric-poc/poc/theia/.cf-studio/.plans/theia-studio-cloud-poc/plan.toml

Phase 3 is complete (PASS).
Please read the plan manifest, then execute Phase 4: "Implement the safe Git publish pipeline".
The phase file is:
  /Volumes/coding/cf-work/workspace-sources/constructorfabric/fabric-poc/poc/theia/.cf-studio/.plans/theia-studio-cloud-poc/phase-04-git-publish-pipeline.md

It is self-contained. Follow it exactly, report results, and stop after Phase 4.
```

If `Status: FAIL`, do not generate a next-phase execution prompt. Instead, emit:

```text
Phase 3 failed. Do not proceed to Phase 4.
Fix the failed acceptance criteria in:
  /Volumes/coding/cf-work/workspace-sources/constructorfabric/fabric-poc/poc/theia/.cf-studio/.plans/theia-studio-cloud-poc/phase-03-operation-journal-queue.md
Then rerun Phase 3 and report PASS before continuing.
```
