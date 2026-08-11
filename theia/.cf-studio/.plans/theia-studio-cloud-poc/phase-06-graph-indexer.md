```toml
[phase]
plan = "theia-studio-cloud-poc"
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

## Preamble

This is a self-contained phase file. All rules, constraints, and kit content
are included below. Project files listed in the Task section must be read
at runtime. Follow the instructions exactly, run any EXECUTE commands as
written, and report results against the acceptance criteria at the end.

## What

Implement the backend graph indexing layer that builds canonical workspace graph snapshots from an immutable Git tree at a specific commit SHA and exposes the DTOs and refresh states needed by later UI phases. Scope is limited to graph model definitions, deterministic Git-tree scanning, parser contributors for the allowed relation families, cache persistence outside the repository, backend wiring, and tests that prove bounded, reproducible behavior. Do not implement graph UI rendering, mutable worktree canonicalization, full package-resolution logic, or any DTO that leaks file contents, snippets, raw HTML, or absolute paths.

## Prior Context

Phase 2 established the runtime config and workspace boundary contracts that protect repository-relative access.
Phase 3 established append-only journal semantics and deterministic backend persistence patterns.
Phase 4 established the safe Git executor, commit-oriented operation flow, and the commit SHA boundary this phase consumes.
Canonical graph snapshots in this phase must read one immutable Git tree at one commit SHA and must remain independent of push success.
Dirty worktree information is not part of the canonical snapshot and must be represented through a separate overlay contract.
The graph cache must persist under `STUDIO_DATA_DIR` or another non-repository backend data location.
The current checkout already contains `studio/package.json`, `studio/configs/jest.config.ts`, and browser shell files, but no graph backend implementation yet.
The domain model brief limits runtime domain reads to object identity, workspace-local relationships, version or provenance, and UI extension boundary material.
The UI reference graph is vocabulary-only; this phase must not copy frontend implementation structure into backend DTO contracts.
Phase 7 will consume the exact graph DTO and backend service contracts compiled here.

## User Decisions
### Already Decided (pre-resolved during planning)
- **Canonical source**: every canonical `GraphSnapshot` is built from an immutable Git tree at one commit SHA.
- **DTO redaction**: file contents, snippets, raw HTML, and absolute filesystem paths never enter graph DTOs.
- **Dirty state**: mutable worktree differences are represented only through a separate dirty-overlay contract.
- **Parser scope**: contributors cover files or contains, CPT definitions and references, Markdown links, and relative TypeScript imports.
- **Indexing behavior**: indexing is bounded, deterministic, cached by schema version plus commit SHA, and independent of push success.
- **Diagnostics policy**: unsupported, oversized, ignored, malformed, and unresolved inputs become diagnostics instead of silent omission.
### Decisions Needed During This Phase
None.

## Rules

### Scope And File Ownership
- MUST modify only `studio/src/common/graph-model.ts`, `studio/src/node/workspace-graph-service.ts`, `studio/src/node/graph-parsers.ts`, `studio/src/node/workspace-graph-service.test.ts`, and `studio/src/node/studio-backend-module.ts`.
- MUST keep graph implementation backend-only in this phase and MUST NOT add browser widgets, React Flow code, or UI layout changes.
- MUST keep canonical graph generation independent from push success, browser state, and mutable worktree content.

### Canonical Snapshot Contract
- MUST define `GraphSnapshot`, graph node, graph edge, graph diagnostic, and dirty-overlay DTOs in a shared common file.
- MUST address each canonical snapshot by commit SHA and schema version.
- MUST generate stable node and edge identifiers deterministically from canonical inputs.
- MUST NOT include file contents, snippets, raw HTML, or absolute paths in any graph DTO.
- MUST model dirty worktree state as a separate non-canonical overlay contract rather than mutating the canonical snapshot.

### Indexing And Parsing
- MUST scan sorted allowlisted Git-tree entries under explicit configurable limits.
- MUST read canonical inputs from the immutable Git tree for the target commit SHA, not from the mutable worktree.
- MUST parse only the accepted relation families: files or contains, CPT definitions and references, Markdown links, and relative TypeScript imports.
- MUST avoid full package resolution, transitive dependency solving, or arbitrary language-server behavior.
- MUST emit diagnostics for unsupported, oversized, ignored, malformed, binary, traversal, and unresolved-link cases.
- MUST keep indexing deterministic for identical commit SHA, limits, and schema version inputs.

### Persistence And Refresh
- MUST persist graph cache outside the repository under backend-managed data storage.
- MUST key cache reuse by schema version plus commit SHA.
- MUST expose graph refresh states independently from Git publish states so UI consumers can track indexing separately.
- MUST preserve workspace boundary checks for every repository-relative path surfaced in diagnostics or graph references.

### Testing And Safety
- MUST add deterministic tests for commit versioning, stable ordering, malicious labels, traversal handling, binary or size-limit skips, and unresolved links.
- MUST prove canonical snapshot determinism across repeated runs for the same commit SHA.
- MUST prove different commit SHAs produce separately addressable snapshots and cache entries.
- MUST keep the phase file under 480 lines.
- MUST leave no unresolved brace-delimited template placeholders outside fenced examples.

## Input

### Stable references
- Plan manifest metadata:
  - Phase number: `6`
  - Phase title: `Build commit-addressed workspace graph snapshots`
  - Depends on: Phase `4`
  - Declared outputs: `studio/src/common/graph-model.ts`, `studio/src/node/workspace-graph-service.ts`, `studio/src/node/graph-parsers.ts`, `studio/src/node/workspace-graph-service.test.ts`, `studio/src/node/studio-backend-module.ts`
- Accepted graph decisions:
  - Canonical graph reads one immutable Git tree at one commit SHA.
  - DTOs exclude file contents, snippets, absolute paths, and raw HTML.
  - Dirty overlay is separate from canonical snapshots.
  - Parsing is limited to CPT, Markdown link, relative TypeScript import, and file-containment relations.
  - Cache identity is schema version plus commit SHA.
- Visual vocabulary hints from the focused UI reference:
  - Nodes and edges need stable IDs and safe labels.
  - Relationship kinds are displayed as normalized labels rather than raw source payloads.
  - Rendering concerns remain outside this backend phase.

## Task

1. Read the compile-time context, then read the exact runtime sources named by this phase.
   Read `.cf-studio/.plans/theia-studio-cloud-poc/plan.toml` for metadata only.
   Read `/Volumes/coding/cf-work/workspace-sources/constructorfabric/fabric-poc/poc/theia/.cf-studio/.plans/theia-studio-cloud-poc/out/phase-04-git-publish-pipeline.md`.
   Read `/Volumes/coding/cf-work/workspace-sources/constructorfabric/fabric-poc/docs/domain-model.md` and focus only on object identity, workspace-local relationships, version or provenance, and UI extension boundary sections.
   Read `/Volumes/coding/cf-work/workspace-sources/constructorfabric/fabric-poc/poc/ui-1/src/components/graph/ObjectGraph.tsx` and `/Volumes/coding/cf-work/workspace-sources/constructorfabric/fabric-poc/poc/ui-1/src/types/domain.ts` for graph vocabulary only.
   Read `studio/package.json`, `studio/configs/jest.config.ts`, `node_modules/typescript/lib/typescript.js`, and the current backend files `studio/src/node/studio-backend-module.ts`, `studio/src/node/studio-runtime-config.ts`, and `studio/src/node/workspace-boundary.ts`.

2. Define the shared graph DTO contract.
   Create `studio/src/common/graph-model.ts` with `GraphSnapshot`, node, edge, diagnostic, dirty-overlay, graph refresh state, and any bounded request or response DTOs needed by later backend and UI phases.
   Make commit SHA and schema version first-class fields.
   Represent file locations only as workspace-relative verified references, never absolute paths or file contents.
   Ensure labels and identifiers are safe for later UI rendering without embedding raw HTML.

3. Implement parser contributors for the accepted relation families.
   Create `studio/src/node/graph-parsers.ts`.
   Parse sorted allowlisted tree entries only.
   Extract file or contains relations, CPT definitions and references, Markdown links, and relative TypeScript imports without full package resolution.
   Emit diagnostics for unsupported, malformed, binary, oversized, ignored, traversal, and unresolved-link inputs.

4. Implement commit-addressed graph indexing and cache management.
   Create `studio/src/node/workspace-graph-service.ts`.
   Use the safe Git executor and workspace boundary contracts to enumerate immutable tree entries at a target commit SHA.
   Build deterministic snapshots with stable IDs, bounded traversal, explicit limits, schema-version plus commit-SHA cache keys, and cache storage outside the repository.
   Expose graph-refresh lifecycle states independently from Git publish states and keep dirty-overlay production separate from canonical snapshot generation.

5. Wire the backend service and add deterministic tests.
   Update `studio/src/node/studio-backend-module.ts` to register the graph service without disturbing unrelated backend wiring.
   Create `studio/src/node/workspace-graph-service.test.ts` covering determinism, commit versioning, malicious labels, traversal defense, binary or limit skips, unresolved links, and separate dirty-overlay behavior.
   Use fixtures or fake executor data that exercise immutable Git-tree reads without depending on frontend code.

6. Self-verify the implementation against the acceptance criteria.
   Confirm every declared output file exists and stays within this phase scope.
   Confirm cache storage stays outside the repository, DTOs exclude file contents and absolute paths, and no frontend graph implementation was added.
   Run the smallest relevant test command for the new backend graph tests if the local scripts support it, then report PASS or FAIL for each acceptance criterion.
7. Write the exact completion report and next-phase prompt to `/Volumes/coding/cf-work/workspace-sources/constructorfabric/fabric-poc/poc/theia/.cf-studio/.plans/theia-studio-cloud-poc/out/phase-06-graph-indexer.md` after the self-check passes.

## Acceptance Criteria

1. `studio/src/common/graph-model.ts` defines canonical `GraphSnapshot`, node, edge, diagnostic, dirty-overlay, and graph-refresh DTOs with commit SHA and schema version fields and without file contents, snippets, raw HTML, or absolute paths.
2. `studio/src/node/graph-parsers.ts` parses only the accepted relation families and emits diagnostics for unsupported, oversized, ignored, malformed, binary, traversal, and unresolved-link cases.
3. `studio/src/node/workspace-graph-service.ts` builds canonical snapshots from immutable Git-tree entries at one commit SHA, scans sorted allowlisted entries under limits, generates stable IDs, and persists cache outside the repository keyed by schema version plus commit SHA.
4. `studio/src/node/studio-backend-module.ts` wires the graph service as a backend concern independent from push success and separate from frontend implementation.
5. Tests prove deterministic repeated indexing, separate commit-addressed snapshots, malicious-label safety, traversal handling, binary or limit skips, unresolved-link diagnostics, and separate dirty-overlay behavior.
6. No full package resolution, mutable-worktree canonical reads, raw HTML, file-content leakage, or unrelated UI graph implementation is introduced in this phase.
7. This phase file is 480 lines or fewer.
8. This phase file contains no unresolved brace-delimited template placeholders outside fenced examples.

## Output Format

When complete, report results in this exact format:
```text
PHASE 6/9 COMPLETE
Status: PASS | FAIL
Files created: {list}
Files modified: {list}
Acceptance criteria:
  [x] Criterion 1 — PASS
  [ ] Criterion 2 — FAIL: {reason}
  ...
Line count: {actual}/480
Notes: {any issues or decisions made}
```

If `Status: PASS`, then generate a **copy-pasteable prompt** for the next phase inside a single code fence:

```text
Next phase prompt (copy-paste into new chat if needed):

I have a Studio execution plan at:
  /Volumes/coding/cf-work/workspace-sources/constructorfabric/fabric-poc/poc/theia/.cf-studio/.plans/theia-studio-cloud-poc/plan.toml

Phase 6 is complete (PASS).
Please read the plan manifest, then execute Phase 7: "Add graph views and Monaco navigation".
The phase file is:
  /Volumes/coding/cf-work/workspace-sources/constructorfabric/fabric-poc/poc/theia/.cf-studio/.plans/theia-studio-cloud-poc/phase-07-graph-editor-ui.md

It is self-contained. Follow it exactly, report results, and stop after Phase 7.
```

If `Status: FAIL`, do not generate a next-phase execution prompt. Instead, emit:

```text
Phase 6 failed. Do not proceed to Phase 7.
Fix the failed acceptance criteria in:
  /Volumes/coding/cf-work/workspace-sources/constructorfabric/fabric-poc/poc/theia/.cf-studio/.plans/theia-studio-cloud-poc/phase-06-graph-indexer.md
Then rerun Phase 6 and report PASS before continuing.
```
