PHASE 2/9 COMPLETE
Status: PASS
Files created: studio/src/common/studio-protocol.ts, studio/src/node/studio-backend-module.ts, studio/src/node/studio-runtime-config.ts, studio/src/node/workspace-boundary.ts, studio/src/node/studio-runtime-config.test.ts, studio/src/node/workspace-boundary.test.ts, .cf-studio/.plans/theia-studio-cloud-poc/out/phase-02-runtime-workspace-protocol.md
Files modified: studio/package.json, studio/src/browser/studio-frontend-module.ts
Acceptance criteria:
  [x] Criterion 1 — PASS
  [x] Criterion 2 — PASS
  [x] Criterion 3 — PASS
  [x] Criterion 4 — PASS
  [x] Criterion 5 — PASS
  [x] Criterion 6 — PASS
  [x] Criterion 7 — PASS
  [x] Criterion 8 — PASS
  [x] Criterion 9 — PASS
Line count: 173/380
Notes: Runtime-read the authoritative Phase 1 handoff, current Studio frontend entrypoint, Theia `RpcConnectionHandler` and `createProxy` patterns, Theia `URI` normalization behavior, backend fail-fast config patterns, WebSocket origin validation rules, and the domain-model invariants for single-workspace authorization, secret handling, and audit context. Added a fixed Studio JSON-RPC service path at `/services/studio-runtime`, browser-safe session DTOs, and a browser proxy binding while preserving the existing widget/contribution bindings. The RPC path request contains only a relative path and existence flag; browser callers cannot supply actor or workspace identity. Added a backend Theia extension entry and a singleton backend endpoint that validates server-owned `STUDIO_ACTOR_ID`, `STUDIO_WORKSPACE_ID`, `STUDIO_REPOSITORY_ROOT`, `STUDIO_DATA_DIR`, `STUDIO_ALLOWED_ORIGINS`, and `STUDIO_TRUST_PROXY`, produces a redacted browser-safe session view, canonicalizes the configured repository root with `realpath`, rejects absolute paths, `..` traversal, backend workspace mismatch, and symlink escapes, and never exposes repository/data paths or secret values through RPC DTOs. Missing-Origin handling explicitly mirrors Theia same-origin polling semantics and is regression-tested. Validation evidence: `npm --prefix studio test -- --runInBand` exit 0; `npm --prefix studio run build` exit 0; `npm run build:browser` exit 0; `npm run build:electron` exit 0; `cfs --json validate` PASS with 0 errors and 0 warnings. Bounded runtime smoke with valid server-owned environment logged `Theia app listening on http://127.0.0.1:3011.`, returned `HTTP/1.1 200 OK`, and was stopped intentionally. No Git command execution path, Git executor import, workspace switching behavior, or later-phase graph/UI/business logic was introduced.

Controller prerequisite addendum for Phase 4: runtime config now owns the discriminated Git policy. `STUDIO_GIT_MODE` defaults to `disabled`; `commit` and `push` require server-owned `STUDIO_GIT_BRANCH`, `STUDIO_GIT_REMOTE`, `STUDIO_GIT_AUTHOR_NAME`, and `STUDIO_GIT_AUTHOR_EMAIL`. Only the boolean `allowGitMutations` capability is exposed to the browser; repository, remote, author, data paths, and secrets remain backend-only.

```text
Next phase prompt (copy-paste into new chat if needed):

I have a Studio execution plan at:
  /Volumes/coding/cf-work/workspace-sources/constructorfabric/fabric-poc/poc/theia/.cf-studio/.plans/theia-studio-cloud-poc/plan.toml

Phase 2 is complete (PASS).
Please read the plan manifest, then execute Phase 3: "Implement the operation journal and repository queue".
The phase file is:
  /Volumes/coding/cf-work/workspace-sources/constructorfabric/fabric-poc/poc/theia/.cf-studio/.plans/theia-studio-cloud-poc/phase-03-operation-journal-queue.md

It is self-contained. Follow it exactly, report results, and stop after Phase 3.
```
