PHASE 6/9 COMPLETE
Status: PASS
Files created: studio/src/common/graph-model.ts, studio/src/node/graph-parsers.ts, studio/src/node/workspace-graph-service.ts, studio/src/node/workspace-graph-service.test.ts, .cf-studio/.plans/theia-studio-cloud-poc/out/phase-06-graph-indexer.md
Files modified: studio/src/node/studio-backend-module.ts
Acceptance criteria:
  [x] Criterion 1 — PASS
  [x] Criterion 2 — PASS
  [x] Criterion 3 — PASS
  [x] Criterion 4 — PASS
  [x] Criterion 5 — PASS
  [x] Criterion 6 — PASS
  [x] Criterion 7 — PASS
  [x] Criterion 8 — PASS
Line count: 194/480
Notes: Inspected the pinned Theia version in studio/package.json (`@theia/*` 1.73.1), the current extension entrypoints (`lib/browser/studio-frontend-module`, `lib/node/studio-backend-module`), the existing backend wiring, RepositoryRegistry, RepositoryDiscoveryService, WorkspaceBoundary, and the GitExecutor immutable-tree APIs before editing. The implementation uses public Theia extension points only: `ContainerModule` bindings, `BackendApplicationContribution`, and `ConnectionHandler`/`RpcConnectionHandler` for a separate `/services/workspace-graph` RPC endpoint. Frontend/backend boundary: graph indexing, cache persistence, dirty-overlay collection, and status fanout remain backend-only in `src/node`; shared DTOs and RPC contracts live in `src/common`; no browser graph files were added. RPC contract: `graph-model.ts` defines `WorkspaceGraphService`, `WorkspaceGraphClient`, `WorkspaceGraphSnapshot`, `WorkspaceGraphStatus`, `WorkspaceGraphDirtyOverlay`, and request/response DTOs for refresh and snapshot fetch with not-modified support. Rebinds/overrides: none; the phase adds a new backend singleton and endpoint without altering the existing Studio runtime RPC. Cache identity is `GRAPH_SCHEMA_VERSION` plus a deterministic repository revision vector digest, stored under `STUDIO_DATA_DIR/workspace-graph-cache` outside the repository. Canonical snapshots are built from immutable Git tree entries only, with stable sorted node/edge/diagnostic output, allowlisted parser families (file containment, CPT definition/reference, Markdown links, relative TS/JS imports), and diagnostics for ignored, oversized, binary, malformed, traversal, unknown-file-type, and unresolved-link cases. Labels are sanitized, DTOs exclude file contents, snippets, raw HTML, and absolute paths, and dirty worktree state remains a separate overlay. Tests performed: `npm --prefix studio test -- --runInBand src/node/workspace-graph-service.test.ts` PASS (6/6); `npm --prefix studio run build` PASS. Unstable/internal API dependence: none from Theia; the implementation uses public Theia DI/RPC APIs and public TypeScript parser APIs.

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
