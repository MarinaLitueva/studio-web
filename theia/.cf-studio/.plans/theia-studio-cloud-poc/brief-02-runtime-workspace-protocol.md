# Compilation Brief: Phase 2/9 — Establish runtime configuration and workspace protocol

--- CONTEXT BOUNDARY ---
Disregard all previous context. This brief is self-contained.
Read ONLY the files listed below. Follow the instructions exactly.
---

## Phase Metadata
```toml
[phase]
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

## Compilation Clarification

- Compile the authoritative backend boundary before any Git mutation exists.
- Preserve the Theia `common/browser/node` platform split and JSON-RPC conventions.
- Configuration is typed and fail-fast; browser DTOs never expose absolute paths or secrets.
- The PoC is single-user but keeps server-owned `actorId` and `workspaceId`.
- Fixed workspace commands, canonical paths, symlink escape protection, allowed origins, and proxy trust belong in this phase.
- Tests stay with configuration and boundary implementation.

## Load Instructions

1. **Plan manifest**: Read `.cf-studio/.plans/theia-studio-cloud-poc/plan.toml`.
   - Action: compile-time metadata only.
2. **Prior handoff**: Read `/Volumes/coding/cf-work/workspace-sources/constructorfabric/fabric-poc/poc/theia/.cf-studio/.plans/theia-studio-cloud-poc/out/phase-01-application-composition.md` at runtime.
   - Scope: consume verified package/plugin composition and build constraints.
3. **Current extension**: Runtime-read `studio/package.json`, `studio/src/browser/studio-frontend-module.ts`, and generated Theia backend connection examples in installed packages.
4. **Theia architecture sources**: Runtime-read `node_modules/@theia/workspace/src/node/workspace-backend-module.ts`, `node_modules/@theia/core/src/common/messaging/handler.ts`, `node_modules/@theia/core/src/common/messaging/proxy-factory.ts`, `node_modules/@theia/core/src/common/uri.ts`, `node_modules/@theia/core/src/node/backend-application-config-provider.ts`, `node_modules/@theia/core/src/node/env-variables/env-variables-server.ts`, and the relevant backend origin-validation example under `node_modules/@theia/core/src/node/`.
5. **Domain constraints**: Runtime-read `/Volumes/coding/cf-work/workspace-sources/constructorfabric/fabric-poc/docs/domain-model.md` sections covering workspace isolation, actor/workspace context, secrets, authorization, and audit.

**Do NOT load**: the whole domain model, UI mock data, graph view code, or Git executor designs.

## Compile Phase File

Write to: `.cf-studio/.plans/theia-studio-cloud-poc/phase-02-runtime-workspace-protocol.md`

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

The Task must define safe session/config DTOs, register the backend RPC endpoint, validate required environment configuration, constrain every path to the canonical repository root, block workspace switching/mismatch, and test traversal, absolute path, symlink, origin, and secret-redaction cases. No Git command may run in this phase.

## Context Budget

- Phase file target: ≤ 380 lines.
- Inlined content estimate: ~180 lines.
- Runtime project and Theia source reads: ~800 lines.
- Total execution context: ≤ 1,150 lines.

## After Compilation

Report: `Phase 2 compiled → phase-02-runtime-workspace-protocol.md (N lines)`.
