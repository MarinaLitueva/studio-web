```toml
[phase]
plan = "theia-studio-cloud-poc"
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

## Preamble

This is a self-contained phase file. All rules, constraints, and kit content
are included below. Project files listed in the Task section must be read
at runtime. Follow the instructions exactly, run any EXECUTE commands as
written, and report results against the acceptance criteria at the end.

## What

Implement the backend Git publish path that turns an approved Studio save into one bounded system-Git transaction sequence. This phase is limited to Node-side execution, publish orchestration, dependency injection wiring, and automated tests; it must not add frontend behavior, graph logic, or arbitrary shell execution. The resulting pipeline must protect repository safety before any mutation, create a single-path commit for the saved file, and preserve local commits when push fails.

## Prior Context

- Plan path: `/Volumes/coding/cf-work/workspace-sources/constructorfabric/fabric-poc/poc/theia/.cf-studio/.plans/theia-studio-cloud-poc/plan.toml`.
- Phase 4 depends on Phase 3 output `out/phase-03-operation-journal-queue.md`.
- Phase 2 created runtime config, protocol, backend module, and workspace-boundary surfaces used by this phase.
- Phase 3 created the operation journal and repository queue abstractions this phase must integrate with.
- Declared Phase 4 output files are `studio/src/node/git-executor.ts`, `studio/src/node/git-publish-service.ts`, `studio/src/node/git-publish-service.test.ts`, and `studio/src/node/studio-backend-module.ts`.
- Browser remains the functional target; Electron remains compile-only.
- Plan validation commands are `npm test`, `npm run build:browser`, and `npm run build:electron`.
- Plan git commit mode is `commit`.

## User Decisions

### Already Decided (pre-resolved during planning)

- **Git execution model**: use one allowlisted system-Git transaction algorithm and never invoke a shell.
- **Runtime toggle default**: `STUDIO_GIT_MODE` defaults to `disabled`.
- **Test mode selection**: tests explicitly select `commit` or `push`.
- **Server-owned repository config**: workspace root, branch, remote, author name, and author email come from server-owned config.
- **Pre-mutation safety gate**: reject detached HEAD, unsafe Git config, dirty index, path mismatch, and content-hash mismatch before mutation.
- **Push failure handling**: preserve the local commit after push failure and retry only the push step.
- **Test isolation**: automated tests use temporary repositories and local bare remotes only.
- **Scope boundary**: do not add frontend code, graph logic, or arbitrary repository configuration reads.

### Decisions Needed During This Phase

- None. Execute the phase using the pre-resolved safety and Git rules above.

## Rules

### Git Execution Rules

- MUST implement exactly one allowlisted system-Git transaction path for this phase.
- MUST use `execFile` or an equivalent non-shell fixed-argv process API; shell invocation is forbidden.
- MUST use fixed Git subcommands and bounded arguments only.
- MUST disable interactive prompts, hooks, signing, and fsmonitor for every Git invocation used by the pipeline and tests.
- MUST sanitize and bound captured stdout and stderr.
- MUST enforce execution timeouts for all Git invocations.
- MUST prove no force-push or history-rewrite command exists in the implementation.
- MUST push only the configured branch to the configured remote.

### Safety Rules

- MUST default `STUDIO_GIT_MODE` to `disabled`.
- MUST treat workspace root, branch, remote, author name, and author email as server-owned configuration.
- MUST reject detached HEAD before mutation.
- MUST reject unsafe Git configuration before mutation.
- MUST reject a dirty index before mutation.
- MUST reject repository path mismatch before mutation.
- MUST reject saved-content hash mismatch before mutation.
- MUST block pre-staged content before staging the target file.
- MUST create commits in the form `chore(studio): save <file>`.
- MUST ensure the commit contains only the saved file path.
- MUST preserve the local commit if push fails and retry only the push step.

### Integration and Scope Rules

- MUST runtime-read the prior Phase 3 handoff before implementing publish orchestration.
- MUST runtime-read the Phase 2 and Phase 3 Node code that defines config, workspace boundary, protocol, journal, and queue behavior before editing.
- MUST wire new backend services through `studio/src/node/studio-backend-module.ts`.
- MUST keep all changes inside the four declared output files.
- MUST avoid frontend work, graph work, and unrelated repository Git config logic.
- MUST keep implementation limited to save-to-commit or save-to-push orchestration, safety checks, and tests.

### Test Rules

- MUST cover no-change, pending, retry, non-fast-forward, restart, and duplicate-key cases.
- MUST use temporary repositories and local bare remotes for automated Git tests.
- MUST runtime-read local installed Git help or documentation for the exact non-interactive arguments asserted by tests.
- MUST verify that push failure leaves the local commit in place.
- MUST verify that duplicate-key or restart scenarios do not create duplicate mutations.

### Compilation Rules

- MUST include explicit runtime read steps for `/Volumes/coding/cf-work/workspace-sources/constructorfabric/fabric-poc/poc/theia/.cf-studio/.plans/theia-studio-cloud-poc/out/phase-03-operation-journal-queue.md` and every project file needed by this phase.
- MUST keep acceptance criteria binary and objectively checkable.
- MUST leave no unresolved template variables outside fenced code blocks.
- MUST keep this phase file at or below 470 lines.
- MUST finish with a self-check against every acceptance criterion.

### Prohibitions

- MUST NOT invoke `sh`, `bash`, `zsh`, `cmd`, `powershell`, or any shell wrapper.
- MUST NOT use force push, rebase, reset, checkout rollback, or history rewrite commands.
- MUST NOT read frontend code, graph implementation, or arbitrary repository Git config during execution.
- MUST NOT stage, commit, or push outside the controlled test repositories created by the automated tests.
- MUST NOT edit plan files, briefs, phase outputs other than the declared ones, or Git state outside the implementation under test.

## Input

### Stable Plan Metadata

- Project root: `/Volumes/coding/cf-work/workspace-sources/constructorfabric/fabric-poc/poc/theia`
- Plan directory: `/Volumes/coding/cf-work/workspace-sources/constructorfabric/fabric-poc/poc/theia/.cf-studio/.plans/theia-studio-cloud-poc`
- Phase file: `/Volumes/coding/cf-work/workspace-sources/constructorfabric/fabric-poc/poc/theia/.cf-studio/.plans/theia-studio-cloud-poc/phase-04-git-publish-pipeline.md`
- Prior handoff path: `/Volumes/coding/cf-work/workspace-sources/constructorfabric/fabric-poc/poc/theia/.cf-studio/.plans/theia-studio-cloud-poc/out/phase-03-operation-journal-queue.md`
- Declared output files:
  - `/Volumes/coding/cf-work/workspace-sources/constructorfabric/fabric-poc/poc/theia/studio/src/node/git-executor.ts`
  - `/Volumes/coding/cf-work/workspace-sources/constructorfabric/fabric-poc/poc/theia/studio/src/node/git-publish-service.ts`
  - `/Volumes/coding/cf-work/workspace-sources/constructorfabric/fabric-poc/poc/theia/studio/src/node/git-publish-service.test.ts`
  - `/Volumes/coding/cf-work/workspace-sources/constructorfabric/fabric-poc/poc/theia/studio/src/node/studio-backend-module.ts`

### Required Implementation Facts

- The Git executor must be a narrow adapter around system Git with a non-shell process API and fixed argument construction.
- Runtime config decides whether Git publish is disabled, commit-only, or push-enabled; default remains disabled until explicitly enabled.
- Workspace boundary and protocol surfaces from earlier phases define which saved file path and content hash are authoritative.
- Journal and queue behavior from Phase 3 define operation identity, idempotency, restart handling, pending state transitions, and retry semantics that this phase must preserve.
- Test repositories must be isolated from the user workspace and use local filesystem remotes only.
- Local installed Git documentation is the authority for the exact non-interactive flags used to disable prompts, hooks, signing, and related side effects in tests.

## Task

1. Read the prior handoff at `/Volumes/coding/cf-work/workspace-sources/constructorfabric/fabric-poc/poc/theia/.cf-studio/.plans/theia-studio-cloud-poc/out/phase-03-operation-journal-queue.md` to extract the journal, queue, idempotency, restart, and state-transition contracts that the publish pipeline must honor.
2. Read the runtime project code needed for this phase: `/Volumes/coding/cf-work/workspace-sources/constructorfabric/fabric-poc/poc/theia/studio/src/common/studio-protocol.ts`, `/Volumes/coding/cf-work/workspace-sources/constructorfabric/fabric-poc/poc/theia/studio/src/node/studio-runtime-config.ts`, `/Volumes/coding/cf-work/workspace-sources/constructorfabric/fabric-poc/poc/theia/studio/src/node/workspace-boundary.ts`, `/Volumes/coding/cf-work/workspace-sources/constructorfabric/fabric-poc/poc/theia/studio/src/node/operation-journal.ts`, `/Volumes/coding/cf-work/workspace-sources/constructorfabric/fabric-poc/poc/theia/studio/src/node/repository-operation-queue.ts`, and the current `/Volumes/coding/cf-work/workspace-sources/constructorfabric/fabric-poc/poc/theia/studio/src/node/studio-backend-module.ts`.
3. Read the local installed Git documentation for the exact non-interactive arguments you will enforce and assert in tests. Use only local `git help` or installed Git documentation pages relevant to `git`, `git commit`, `git push`, `git status`, `git diff`, `git add`, and `git rev-parse`; extract only the flags needed to disable prompts, hooks, signing, and unsafe side effects while keeping output bounded and deterministic.
4. Implement `/Volumes/coding/cf-work/workspace-sources/constructorfabric/fabric-poc/poc/theia/studio/src/node/git-executor.ts` and `/Volumes/coding/cf-work/workspace-sources/constructorfabric/fabric-poc/poc/theia/studio/src/node/git-publish-service.ts` so the pipeline performs pre-mutation safety checks, stages only the saved path, creates `chore(studio): save <file>` commits containing only that path, optionally pushes the configured branch, preserves local commits after push failure, retries only the push step, and never invokes a shell or any history-rewrite command.
5. Update `/Volumes/coding/cf-work/workspace-sources/constructorfabric/fabric-poc/poc/theia/studio/src/node/studio-backend-module.ts` to wire the new executor and publish service into the backend graph without expanding scope into later-phase logic.
6. Implement `/Volumes/coding/cf-work/workspace-sources/constructorfabric/fabric-poc/poc/theia/studio/src/node/git-publish-service.test.ts` with temporary repositories and local bare remotes that prove disabled-mode behavior, no-change handling, pending and restart recovery, duplicate-key idempotency, non-fast-forward push failure, push-only retry after failure, pre-staged-content rejection, and the absence of force or history-rewrite commands in the executor path.
7. Run and record `npm test`, `npm run build:browser`, and `npm run build:electron` from `/Volumes/coding/cf-work/workspace-sources/constructorfabric/fabric-poc/poc/theia`, then self-check every acceptance criterion and report PASS only if all criteria succeed.
8. Write the exact completion report and next-phase prompt to `/Volumes/coding/cf-work/workspace-sources/constructorfabric/fabric-poc/poc/theia/.cf-studio/.plans/theia-studio-cloud-poc/out/phase-04-git-publish-pipeline.md` after the self-check passes.

## Acceptance Criteria

- [ ] `studio/src/node/git-executor.ts` uses `execFile` or an equivalent non-shell fixed-argv API, enforces bounded output and timeouts, disables prompts/hooks/signing/fsmonitor for its Git invocations, and contains no shell wrapper or force/history-rewrite command path.
- [ ] `studio/src/node/git-publish-service.ts` rejects detached HEAD, unsafe Git config, dirty index, path mismatch, content-hash mismatch, and pre-staged content before mutation, then creates only `chore(studio): save <file>` commits that stage exactly the saved path.
- [ ] The publish pipeline preserves the local commit after push failure and retries only the push step when the queued operation is resumed.
- [ ] `STUDIO_GIT_MODE` defaults to `disabled`, and server-owned workspace root, branch, remote, author name, and author email remain the only repository config inputs used by the implementation.
- [ ] `studio/src/node/studio-backend-module.ts` wires the Git executor and publish service without adding frontend or later-phase business logic.
- [ ] `studio/src/node/git-publish-service.test.ts` uses temporary repositories and local bare remotes only, and covers no-change, pending, retry, non-fast-forward, restart, duplicate-key, and pre-staged-content cases.
- [ ] `npm test`, `npm run build:browser`, and `npm run build:electron` all pass and the report includes the exact local Git documentation commands consulted for non-interactive flag selection.
- [ ] This phase file contains no unresolved template variables outside fenced code blocks and stays at or below 470 lines.

## Output Format

When complete, report results in this exact format:
```text
PHASE 4/9 COMPLETE
Status: PASS | FAIL
Files created: {list}
Files modified: {list}
Acceptance criteria:
  [x] Criterion 1 — PASS
  [ ] Criterion 2 — FAIL: {reason}
  ...
Line count: {actual}/470
Notes: {any issues or decisions made}
```

If `Status: PASS`, then generate a copy-pasteable prompt for the next phase inside a single code fence:

```text
Next phase prompt (copy-paste into new chat if needed):

I have a Studio execution plan at:
  /Volumes/coding/cf-work/workspace-sources/constructorfabric/fabric-poc/poc/theia/.cf-studio/.plans/theia-studio-cloud-poc/plan.toml

Phase 4 is complete (PASS).
Please read the plan manifest, then execute Phase 5: "Connect Theia Save to Git Operations UI".
The phase file is:
  /Volumes/coding/cf-work/workspace-sources/constructorfabric/fabric-poc/poc/theia/.cf-studio/.plans/theia-studio-cloud-poc/phase-05-save-git-operations-ui.md

It is self-contained. Follow it exactly, report results, and stop after Phase 5.
```

If `Status: FAIL`, do not generate a next-phase execution prompt. Instead, emit:

```text
Phase 4 failed. Do not proceed to Phase 5.
Fix the failed acceptance criteria in:
  /Volumes/coding/cf-work/workspace-sources/constructorfabric/fabric-poc/poc/theia/.cf-studio/.plans/theia-studio-cloud-poc/phase-04-git-publish-pipeline.md
Then rerun Phase 4 and report PASS before continuing.
```
