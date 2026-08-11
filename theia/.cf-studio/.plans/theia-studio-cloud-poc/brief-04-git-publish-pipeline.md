# Compilation Brief: Phase 4/9 — Implement the safe Git publish pipeline

--- CONTEXT BOUNDARY ---
Disregard all previous context. This brief is self-contained.
Read ONLY the files listed below. Follow the instructions exactly.
---

## Phase Metadata
```toml
[phase]
number = 4
total = 9
type = "implement"
title = "Implement the safe Git publish pipeline"
depends_on = [3]
input_manifest = ""
input_signature = ""
input_files = ["studio/src/common/studio-protocol.ts", "studio/src/node/studio-runtime-config.ts", "studio/src/node/workspace-boundary.ts", "studio/src/node/operation-journal.ts", "studio/src/node/repository-operation-queue.ts", "studio/src/node/studio-backend-module.ts"]
output_files = ["studio/src/node/git-executor.ts", "studio/src/node/git-publish-service.ts", "studio/src/node/git-publish-service.test.ts", "studio/src/node/studio-backend-module.ts"]
outputs = ["out/phase-04-git-publish-pipeline.md"]
inputs = ["out/phase-03-operation-journal-queue.md"]
```

## Compilation Clarification

- Compile one allowlisted system-Git transaction algorithm; never invoke a shell.
- `STUDIO_GIT_MODE` defaults to `disabled`; tests explicitly select `commit` or `push`.
- Workspace root, branch, remote, author name, and author email are server-owned config.
- Reject detached HEAD, unsafe Git config, dirty index, path mismatch, and content-hash mismatch before mutation.
- Preserve local commits after push failure and retry only the push step.
- Use temporary repositories and local bare remotes for all automated tests.

## Load Instructions

1. **Plan manifest**: Read `.cf-studio/.plans/theia-studio-cloud-poc/plan.toml`.
   - Action: compile-time metadata only.
2. **Prior handoff**: Read `/Volumes/coding/cf-work/workspace-sources/constructorfabric/fabric-poc/poc/theia/.cf-studio/.plans/theia-studio-cloud-poc/out/phase-03-operation-journal-queue.md` at runtime.
   - Scope: use the journal, idempotency, state transition, and queue interfaces.
3. **Phase 2–3 node code**: Runtime-read config, workspace boundary, protocol, journal, and queue implementations.
4. **Git behavior**: Runtime-read local `git help`/installed Git documentation for exact non-interactive arguments used by tests.

**Do NOT load**: frontend code, graph implementation, or arbitrary repository Git configuration.

## Compile Phase File

Write to: `.cf-studio/.plans/theia-studio-cloud-poc/phase-04-git-publish-pipeline.md`

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

The Task must use `execFile` with fixed arguments, disabled prompts/hooks/signing/fsmonitor, sanitized bounded output and timeouts; create `chore(studio): save <file>` commits containing only the saved path; block pre-staged content; push the configured branch; implement no-change, pending, retry, non-fast-forward, restart, and duplicate-key cases; and prove no force/history rewrite command exists.

## Context Budget

- Phase file target: ≤ 470 lines.
- Inlined content estimate: ~220 lines.
- Runtime implementation and tests: ~1,000 lines.
- Total execution context: ≤ 1,500 lines.

## After Compilation

Report: `Phase 4 compiled → phase-04-git-publish-pipeline.md (N lines)`.
