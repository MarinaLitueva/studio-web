# Compilation Brief: Phase 6/9 — Build commit-addressed workspace graph snapshots

--- CONTEXT BOUNDARY ---
Disregard all previous context. This brief is self-contained.
Read ONLY the files listed below. Follow the instructions exactly.
---

## Phase Metadata
```toml
[phase]
number = 6
total = 9
type = "implement"
title = "Build commit-addressed workspace graph snapshots"
depends_on = [4]
input_manifest = ""
input_signature = ""
input_files = ["studio/package.json", "studio/configs/jest.config.ts", "studio/src/node/studio-backend-module.ts", "studio/src/node/studio-runtime-config.ts", "studio/src/node/workspace-boundary.ts", "node_modules/typescript/lib/typescript.js", "/Volumes/coding/cf-work/workspace-sources/constructorfabric/fabric-poc/docs/domain-model.md", "/Volumes/coding/cf-work/workspace-sources/constructorfabric/fabric-poc/poc/ui-1/src/components/graph/ObjectGraph.tsx", "/Volumes/coding/cf-work/workspace-sources/constructorfabric/fabric-poc/poc/ui-1/src/types/domain.ts"]
output_files = ["studio/src/common/graph-model.ts", "studio/src/node/workspace-graph-service.ts", "studio/src/node/graph-parsers.ts", "studio/src/node/workspace-graph-service.test.ts", "studio/src/node/studio-backend-module.ts"]
outputs = ["out/phase-06-graph-indexer.md"]
inputs = ["out/phase-04-git-publish-pipeline.md"]
```

## Compilation Clarification

- Canonical graph snapshots read an immutable Git tree at one commit SHA.
- File contents, snippets, absolute paths, and raw HTML never enter graph DTOs.
- Dirty overlay is a separate non-canonical contract.
- Parsers are contributors for files/contains, CPT definitions/references, Markdown links, and relative TypeScript imports.
- Indexing is bounded, deterministic, cached by schema version plus commit SHA, and independent of push success.
- Unsupported, oversized, ignored, malformed, and unresolved inputs produce diagnostics.

## Load Instructions

1. **Plan manifest**: Read `.cf-studio/.plans/theia-studio-cloud-poc/plan.toml`.
   - Action: compile-time metadata only.
2. **Prior handoff**: Read `/Volumes/coding/cf-work/workspace-sources/constructorfabric/fabric-poc/poc/theia/.cf-studio/.plans/theia-studio-cloud-poc/out/phase-04-git-publish-pipeline.md` at runtime.
   - Scope: consume commit events, safe Git executor, workspace boundary, and data directory.
3. **Domain model**: Runtime-read only object identity, workspace-local relationships, version/provenance, and UI extension boundary sections in `/Volumes/coding/cf-work/workspace-sources/constructorfabric/fabric-poc/docs/domain-model.md`.
4. **UI reference graph**: Runtime-read focused `../ui-1/src/components/graph/ObjectGraph.tsx` and domain types for visual vocabulary only.
5. **Parser/runtime APIs**: Runtime-read installed TypeScript parser APIs and existing project test conventions.

**Do NOT load**: full UI mock data, frontend graph implementation, full domain model, or mutable worktree as canonical input.

## Compile Phase File

Write to: `.cf-studio/.plans/theia-studio-cloud-poc/phase-06-graph-indexer.md`

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

The Task must define the accepted `GraphSnapshot`, node, edge, diagnostic, and dirty-overlay DTOs; scan sorted allowlisted Git-tree entries under configurable limits; generate stable IDs; parse supported relations without full package resolution; persist cache outside the repository; emit independent graph-refresh states; and test determinism, commit versioning, malicious labels, traversal, binary/limit skips, and unresolved links.

## Context Budget

- Phase file target: ≤ 480 lines.
- Inlined content estimate: ~230 lines.
- Runtime domain slices, source, fixtures, and tests: ~1,050 lines.
- Total execution context: ≤ 1,500 lines.

## After Compilation

Report: `Phase 6 compiled → phase-06-graph-indexer.md (N lines)`.
