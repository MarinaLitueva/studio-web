```toml
[phase]
plan = "theia-studio-cloud-poc"
number = 2
total = 9
type = "implement"
title = "Establish runtime configuration and workspace protocol"
depends_on = [1]
input_manifest = ""
input_signature = ""
input_files = ["studio/package.json", "studio/src/browser/studio-frontend-module.ts", "node_modules/@theia/workspace/src/node/workspace-backend-module.ts", "node_modules/@theia/core/src/common/messaging/handler.ts", "node_modules/@theia/core/src/common/messaging/proxy-factory.ts", "node_modules/@theia/core/src/common/uri.ts", "node_modules/@theia/core/src/node/backend-application-config-provider.ts", "node_modules/@theia/core/src/node/env-variables/env-variables-server.ts", "node_modules/@theia/core/src/node/", "/Volumes/coding/cf-work/workspace-sources/constructorfabric/fabric-poc/docs/domain-model.md"]
output_files = ["studio/package.json", "studio/src/common/studio-protocol.ts", "studio/src/browser/studio-frontend-module.ts", "studio/src/node/studio-backend-module.ts", "studio/src/node/studio-runtime-config.ts", "studio/src/node/workspace-boundary.ts", "studio/src/node/studio-runtime-config.test.ts", "studio/src/node/workspace-boundary.test.ts"]
outputs = ["out/phase-02-runtime-workspace-protocol.md"]
inputs = ["out/phase-01-application-composition.md"]
```

## Preamble

This is a self-contained phase file. All rules, constraints, and kit content
are included below. Project files listed in the Task section must be read
at runtime. Follow the instructions exactly, run any EXECUTE commands as
written, and report results against the acceptance criteria at the end.

## What

Create the backend runtime boundary for the single-user Studio cloud PoC by adding typed runtime configuration, a backend JSON-RPC endpoint, and canonical workspace path enforcement in the `studio` Theia extension. Scope is limited to configuration validation, safe DTO/protocol design, workspace boundary enforcement, backend module wiring, and tests for traversal, symlink, origin, and redaction behavior. Do not implement Git mutations, UI widgets, graph indexing, or any browser feature beyond the DTO/proxy needed to reach the new backend endpoint.

## Prior Context

- Phase 1 is the application-composition handoff for this plan and is the only prior intermediate input for this phase.
- The plan declares this phase modifies only `studio/package.json`, `studio/src/common/studio-protocol.ts`, `studio/src/browser/studio-frontend-module.ts`, `studio/src/node/studio-backend-module.ts`, `studio/src/node/studio-runtime-config.ts`, `studio/src/node/workspace-boundary.ts`, `studio/src/node/studio-runtime-config.test.ts`, and `studio/src/node/workspace-boundary.test.ts`.
- `studio/package.json` currently exposes only a frontend Theia module and depends on `@theia/core`.
- `studio/src/browser/studio-frontend-module.ts` already follows the normal Theia frontend container-module pattern and is the browser-side anchor for adding a backend proxy later in this phase.
- The brief requires the backend boundary to be established before any Git mutation service exists.
- The brief fixes this phase as single-user, server-owned `actorId` and `workspaceId`, typed fail-fast configuration, JSON-RPC transport, canonical path checks, allowed-origin/proxy-trust handling, and no Git commands.

## User Decisions
### Already Decided (pre-resolved during planning)
- **Runtime mode**: Single-user cloud PoC with server-owned `actorId` and `workspaceId`.
- **Transport**: Theia backend JSON-RPC using the common/browser/node split.
- **Workspace scope**: One canonical repository root; workspace switching and workspace mismatch are blocked.
- **Security boundary**: Browser DTOs never expose absolute paths or secret values.
- **Path policy**: Fixed workspace commands only; every requested path must stay within the canonical repository root after normalization and symlink resolution.
- **Network policy**: Allowed origins and proxy-trust validation are implemented in this phase.
- **Git policy**: No Git command may run in this phase.
- **Testing focus**: Traversal, absolute path, symlink escape, origin, and secret-redaction cases are mandatory.

## Rules

### Phase Execution Rules

- MUST implement only the runtime configuration and workspace protocol boundary described in this file.
- MUST keep all edits inside the `studio` package and its tests for this phase.
- MUST preserve the Theia `common`, `browser`, and `node` separation.
- MUST use Theia JSON-RPC conventions for the backend service path, common protocol types, backend binding, and frontend proxy wiring.
- MUST compile the authoritative backend boundary before any Git mutation or publish logic exists.
- MUST treat this as a single-user PoC while still sourcing `actorId` and `workspaceId` from validated server configuration instead of browser input.
- MUST validate required runtime configuration at backend startup and fail fast on missing or malformed values.
- MUST constrain all workspace-relative requests to the canonical repository root after normalization and symlink resolution.
- MUST block workspace switching, alternate workspace selection, and any workspace identifier mismatch.
- MUST ensure browser-visible DTOs redact or omit absolute filesystem paths, raw secret values, and proxy credentials.
- MUST keep fixed workspace commands explicit; no generic arbitrary-command executor is allowed.
- MUST add or update tests together with the runtime configuration and boundary implementation.
- MUST NOT run any Git command or add any Git executor in this phase.
- MUST NOT expose mutable trust decisions to the browser; trust is server-owned configuration.
- MUST NOT leak secrets through RPC payloads, thrown error messages, logs asserted by tests, or serialized config objects.

### Theia Integration Rules

- MUST mirror Theia backend service registration with `ConnectionHandler` plus `RpcConnectionHandler`.
- MUST define the RPC contract in `studio/src/common/studio-protocol.ts` and keep browser/node imports pointed at that common contract.
- MUST register the backend service from `studio/src/node/studio-backend-module.ts`.
- MUST add the `node` Theia extension entry in `studio/package.json` if it is not already present.
- MUST use `URI` and canonical file-path handling compatible with Theia path semantics when representing workspace locations.
- MUST preserve compatibility with the existing frontend module rather than replacing its widget bindings.

### Boundary and Security Rules

- MUST canonicalize the configured repository root before accepting any operation.
- MUST reject path traversal, absolute paths outside the root, missing files when existence is required, and symlink escapes that resolve outside the root.
- MUST keep the workspace protocol fixed to the configured workspace identity; the browser cannot choose another workspace.
- MUST validate allowed origins and proxy-trust configuration in deterministic code paths covered by tests.
- MUST model origin policy as allow/deny with explicit defaults; silent permissive fallback is forbidden.
- MUST separate safe session/config DTOs from internal backend config so browser callers receive only redacted values.

## Input

### Stable Reference Constraints

- Theia backend services are registered by binding `ConnectionHandler` to a singleton `RpcConnectionHandler` for a fixed service path.
- Theia RPC proxies are defined in common code and connected on the browser side through a `createProxy` call against the same service path.
- Theia `URI` supports path normalization and parent/equality checks and is the baseline for consistent workspace-relative path handling.
- Theia workspace boot logic can restore or switch workspaces; this phase must explicitly prevent Studio from honoring arbitrary browser-selected workspaces.
- Electron-origin validation in Theia is implemented as an explicit allowlist decision instead of implicit trust.

### Domain Invariants To Enforce

- Every object and operation belongs to exactly one `workspaceId`; cross-workspace identity is not inferred.
- Every graph read, mutation, and execution is authorized for the subject workspace before access.
- Child operations cannot widen permissions or scope beyond the server-owned actor and workspace context.
- Secrets never become durable graph, contract, audit, or snapshot content; the same rule applies to browser DTOs in this PoC.
- Auditability requires stable actor identity and exact workspace context even in a single-user deployment.

### Pre-Resolved Runtime Shape

- `actorId` and `workspaceId` are required backend configuration values.
- The repository root is configured once, canonicalized once, and reused as the only allowed workspace root.
- Browser DTOs may include safe identifiers, feature flags, and workspace-relative metadata, but not absolute paths or secret material.
- Allowed origins and proxy-trust configuration are part of validated backend runtime config, not browser preferences.

## Task

1. Runtime-read `/Volumes/coding/cf-work/workspace-sources/constructorfabric/fabric-poc/poc/theia/.cf-studio/.plans/theia-studio-cloud-poc/out/phase-01-application-composition.md`, then runtime-read `studio/package.json` and `studio/src/browser/studio-frontend-module.ts`; record the effective Phase 1 composition constraints, current `studio` extension entries, and the exact frontend proxy insertion point needed for the new backend endpoint.
2. Runtime-read the focused Theia sources that define the required integration pattern: `node_modules/@theia/workspace/src/node/workspace-backend-module.ts`, `node_modules/@theia/core/src/common/messaging/handler.ts`, `node_modules/@theia/core/src/common/messaging/proxy-factory.ts`, `node_modules/@theia/core/src/common/uri.ts`, `node_modules/@theia/core/src/node/backend-application-config-provider.ts`, `node_modules/@theia/core/src/node/env-variables/env-variables-server.ts`, and `node_modules/@theia/core/src/node/` to locate the relevant backend origin-validation example; extract the fixed service-path, singleton binding, proxy, URI, and fail-fast configuration patterns to follow exactly.
3. Runtime-read only the relevant sections of `/Volumes/coding/cf-work/workspace-sources/constructorfabric/fabric-poc/docs/domain-model.md` covering workspace isolation, actor/workspace context, authorization, secrets, and audit; translate them into concrete backend invariants for this PoC: one server-owned workspace, one server-owned actor, no cross-workspace access, no secret exposure, and auditable workspace-scoped decisions.
4. Implement `studio/src/common/studio-protocol.ts`, `studio/src/browser/studio-frontend-module.ts`, and `studio/src/node/studio-backend-module.ts` so Studio exposes a dedicated JSON-RPC backend service with a fixed path, typed request/response contracts, safe session/config DTOs, and browser proxy wiring that never accepts browser-supplied absolute paths, `actorId`, `workspaceId`, or secret values.
5. Implement `studio/src/node/studio-runtime-config.ts` and `studio/src/node/workspace-boundary.ts` so backend startup validates required environment/config values, canonicalizes the repository root, validates allowed origins and proxy-trust settings, resolves requested workspace-relative paths safely, rejects traversal and symlink escapes, and blocks workspace switching or workspace mismatch before any later Git or graph service can run.
6. Update `studio/package.json` to declare the backend module and any minimal test/runtime dependencies required by the new node-side code, then add or update `studio/src/node/studio-runtime-config.test.ts` and `studio/src/node/workspace-boundary.test.ts` covering: missing required config, malformed origin policy, secret redaction in DTOs, absolute path rejection, `..` traversal rejection, symlink escape rejection, fixed-workspace mismatch rejection, and allowed-origin/proxy-trust decisions.
7. Self-verify the implementation against every acceptance criterion and confirm no Git command or Git executor was introduced.
8. Write the exact completion report and next-phase prompt to `/Volumes/coding/cf-work/workspace-sources/constructorfabric/fabric-poc/poc/theia/.cf-studio/.plans/theia-studio-cloud-poc/out/phase-02-runtime-workspace-protocol.md` after the self-check passes.

## Acceptance Criteria

1. `studio/package.json` declares the `studio` backend Theia extension entry and still preserves the existing frontend entry.
2. `studio/src/common/studio-protocol.ts` defines a fixed Studio service path and typed safe DTOs that do not contain absolute-path or secret fields.
3. `studio/src/node/studio-backend-module.ts` registers the backend service with Theia `ConnectionHandler` and `RpcConnectionHandler` conventions for a singleton JSON-RPC endpoint.
4. `studio/src/node/studio-runtime-config.ts` fails fast on missing or malformed required runtime configuration and produces a redacted browser-safe session/config shape.
5. `studio/src/node/workspace-boundary.ts` canonicalizes the repository root and rejects traversal, out-of-root absolute paths, workspace mismatch, and symlink escapes.
6. Automated tests cover origin allow/deny logic, proxy-trust validation, secret redaction, traversal rejection, absolute-path rejection, symlink escape rejection, and fixed-workspace mismatch rejection.
7. No Git command execution path, Git executor import, or mutable workspace-switching behavior is introduced by this phase.
8. This phase file remains at or below 380 lines.
9. The completion report contains no unresolved template variables outside fenced examples.

## Output Format

When complete, report results in this exact format:
```text
PHASE 2/9 COMPLETE
Status: PASS | FAIL
Files created: {list}
Files modified: {list}
Acceptance criteria:
  [x] Criterion 1 — PASS
  [ ] Criterion 2 — FAIL: {reason}
  ...
Line count: {actual}/380
Notes: {any issues or decisions made}
```

If `Status: PASS`, then generate a **copy-pasteable prompt** for the next phase inside a single code fence:

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

If `Status: FAIL`, do not generate a next-phase execution prompt. Instead, emit:

```text
Phase 2 failed. Do not proceed to Phase 3.
Fix the failed acceptance criteria in:
  /Volumes/coding/cf-work/workspace-sources/constructorfabric/fabric-poc/poc/theia/.cf-studio/.plans/theia-studio-cloud-poc/phase-02-runtime-workspace-protocol.md
Then rerun Phase 2 and report PASS before continuing.
```
