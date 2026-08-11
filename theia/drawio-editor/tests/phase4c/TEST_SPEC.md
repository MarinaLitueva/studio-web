# Draw.io Phase 4C Runtime Packager Test Spec

Phase 4C defines the tests-first executable acceptance contract for a deterministic, auditable, Node-only candidate packager for the quarantined diagrams.net WAR. This phase does not activate Draw.io, does not serve a packaged runtime, and does not loosen the current blocked runtime gate.

## Scope

- Validate the exact retained input artifact before any future packaging run:
  - `drawio-editor/runtime/artifacts/draw-30.0.4.war`
  - exact bytes: `52,723,743`
  - exact SHA-256: `cb40abb5f750f549444c94c00de086218b47e30b33fbc4dd0476118afd8ec19d`
- Preserve the current blocked runtime state:
  - `drawio-editor/runtime/runtime-manifest.json` must remain `entrypoint = "blocked.html"`
  - `drawio-editor/runtime/runtime-manifest.json` must remain `compatibility.status = "blocked"`
  - `drawio-editor/runtime/runtime-manifest.json` must remain `provenance.usability = "blocked"`
  - `drawio-editor/runtime/runtime-artifact.json` must not gain activation authorization during this tests-only phase
- Lock the future generated output layout to caller-provided output roots only:
  - `drawio-editor/lib/runtime/drawio/30.0.4/<bundle-sha256>/`
  - `bundle-manifest.json`
  - `asset-integrity.json`
  - `packaging-report.json`
- Lock the future production surfaces without creating them yet:
  - `drawio-editor/src/node/drawio-runtime-packager.ts`
  - `drawio-editor/lib/node/drawio-runtime-packager.js`
  - `drawio-editor/package.json` direct dependency `yauzl = 2.10.0`
  - `drawio-editor/package.json` script `package:drawio-runtime = node lib/node/drawio-runtime-packager.js`
- Keep the implementation boundary explicit:
  - backend-only Node packaging
  - no browser UI
  - no shared RPC
  - no Theia service rebind or override
  - no plugin-ext or webview
  - no internal or unstable Theia APIs

## Explicit Future Production Export Contract

The future compiled module at `drawio-editor/lib/node/drawio-runtime-packager.js` must export:

- `DRAWIO_RUNTIME_PACKAGER_VERSION`
- `buildDrawioRuntimePolicy({ runtimeVersion, maxEntries, maxEntryUncompressedBytes, maxTotalUncompressedBytes, maxCompressionRatio })`
- `createArchiveValidationState(policy)`
- `validateArchiveEntry({ rawPath, unixFileType, uncompressedBytes, compressedBytes }, state)`
- `createBundleManifestBytes({ runtimeVersion, sourceArchive, bundleSha256, policy, includedEntries, excludedEntries, verdict })`
- `createAssetIntegrityBytes({ runtimeVersion, sourceArchive, bundleSha256, policy, includedEntries, excludedEntries, verdict })`
- `createPackagingReportBytes({ runtimeVersion, sourceArchive, bundleSha256, policy, includedEntries, excludedEntries, verdict })`
- `packageDrawioRuntime({ inputWarPath, expectedWarBytes, expectedWarSha256, outputRoot, policy })`
- `publishPackagedRuntime({ outputRoot, bundleSha256, files, bundleManifestBytes, assetIntegrityBytes, packagingReportBytes })`

The contract above is intentionally cheap to exercise:

- `validateArchiveEntry(...)` must reject any raw backslash path as ambiguous input, enforce normalized path safety, non-regular Unix type rejection, duplicate and case-fold collision rejection, file-vs-directory collision rejection, hard exclusions, entry-count limit, per-entry uncompressed-size limit, total uncompressed-size limit, and suspicious compression-ratio limit without extracting the real WAR.
- `packageDrawioRuntime(...)` must verify the exact input WAR size and digest before any extraction or publication work.
- `publishPackagedRuntime(...)` must implement atomic temp-to-final publication, idempotent identical output, fail-closed conflicting output, and temp-residue cleanup using synthetic files.
- Aggregate bundle identity must be deterministic over sorted canonical file records that bind each included file path, byte count, and lowercase SHA-256 digest.

## Executable Acceptance Mapping

| ID | Executable assertion |
| --- | --- |
| DIO-P4C-001 | In the current P4C-3 package-integration repository state, `runtime-packager.acceptance.test.js` is expected to pass because the remaining package-integration prerequisites are present in source and, after build, in compiled output; the historical ordinary P4C-2 repository state on July 30, 2026 remained intentionally red until the exact direct `yauzl` pin and separate `package:drawio-runtime` script landed. |
| DIO-P4C-002 | The harness proves the quarantined WAR exists as a regular file, matches the exact byte count, matches the exact SHA-256 digest, and remains the exact artifact recorded by `runtime-artifact.json`. |
| DIO-P4C-003 | The harness proves `runtime-manifest.json` remains blocked on `blocked.html`, `compatibility.status` remains `blocked`, `provenance.usability` remains `blocked`, the Phase 0 host gate remains required and inactive, and `runtime-artifact.json` still has no activation authorization. |
| DIO-P4C-004 | The helper regression proves normalized archive paths reject absolute paths, drive and UNC prefixes, slash traversal, raw backslash ambiguity, NUL, duplicate normalized paths, case-fold collisions, and file-vs-directory collisions. |
| DIO-P4C-005 | The helper regression proves `META-INF/**`, `WEB-INF/**`, `.class`, and `.jar` are always hard-excluded, deterministic bundle identity is reorder-invariant while binding each included file path, byte count, and lowercase SHA-256 digest, stable JSON bytes end with one trailing newline, and atomic temp-to-final publication uses a content-addressed final directory distinct from the temp directory under the caller output root. |
| DIO-P4C-006 | The harness proves the Phase 4C contract uses only Node built-ins; in the current P4C-3 package-integration state it requires `dependencies.yauzl === "2.10.0"`, the exact separate script `node lib/node/drawio-runtime-packager.js`, and continued isolation from root build and test scripts, while the historical pre-integration P4C-2 state on July 30, 2026 intentionally lacked those package prerequisites. |
| DIO-P4C-007 | When `implementationReady` is true, the compiled packager must expose `DRAWIO_RUNTIME_PACKAGER_VERSION`, `buildDrawioRuntimePolicy`, `createArchiveValidationState`, and `validateArchiveEntry`, keep source free of Theia, plugin-ext, and webview dependencies, and execute real policy validation for raw backslash rejection, non-regular Unix types, duplicate normalized paths, case-fold collisions, file-vs-directory collisions, entry-count limits, per-entry limits, total limits, suspicious compression ratios, and hard exclusions. |
| DIO-P4C-008 | When `implementationReady` is true, the metadata builders must generate byte-for-byte stable JSON from a synthetic inventory, preserve lowercase SHA-256 digests, record source archive identity, applied policy values, included inventory, excluded inventory with reasons, aggregate bundle identity bound to path, size, and per-file hash, packaging verdict `candidate`, and must not claim activation. |
| DIO-P4C-009 | When `implementationReady` is true, `packageDrawioRuntime(...)` must reject a deliberately wrong expected digest using a temp output root, leave no final directory or temp residue, and leave `runtime-manifest.json` and `runtime-artifact.json` bytes unchanged. |
| DIO-P4C-010 | When `implementationReady` is true, `publishPackagedRuntime(...)` must atomically publish a synthetic bundle, be idempotent for identical content, fail closed for conflicting content at the same bundle identity, reject output-root replacement during staging, reject stage replacement during descendant preparation before any payload file is written into the replacement, preserve the previously published final output, and leave no temp residue for ordinary failures or idempotent retries; a hostile root or stage replacement may strand the displaced temp stage for operator cleanup rather than deleting through an untrusted replacement path, and portable Node pathname APIs still leave an irreducible micro-window between the final identity check and the pathname syscall. |

## Expected Current Result

Current P4C-3 package-integration repository state is expected to be GREEN after build:

- `10` passing tests:
  - `DIO-P4C-001`
  - `DIO-P4C-002`
  - `DIO-P4C-003`
  - `DIO-P4C-004`
  - `DIO-P4C-005`
  - `DIO-P4C-006`
  - `DIO-P4C-007`
  - `DIO-P4C-008`
  - `DIO-P4C-009`
  - `DIO-P4C-010`
- `0` skipped tests

Historical pre-integration evidence from the ordinary P4C-2 repository state on July 30, 2026 remains relevant:

- `9` passing
- `1` failed bootstrap test:
  - `DIO-P4C-001`
- `0` skipped

## Run Commands

```bash
node --check drawio-editor/tests/phase4c/runtime-packager.acceptance.test.js
node --test drawio-editor/tests/phase4c/runtime-packager.acceptance.test.js
```

## Boundaries

- Theia extension points used:
  - none in Phase 4C itself
  - the future implementation is a plain Node/backend packaging surface and must not use Theia APIs
- Frontend/backend boundary:
  - unchanged from current state
  - this phase adds no browser code and no serving endpoint changes
- RPC contract:
  - none
- Services rebound or overridden:
  - none
- Dependence on internal or unstable Theia APIs:
  - none
- Tests performed in this phase:
  - historical controller evidence on July 30, 2026: Node 22 TypeScript build passed in the pre-integration P4C-2 state
  - historical controller evidence on July 30, 2026: ordinary `node --test drawio-editor/tests/phase4c/runtime-packager.acceptance.test.js` produced the expected controlled RED result in the pre-integration P4C-2 state: `9` passed, `1` failed bootstrap, `0` skipped
  - historical controller evidence on July 30, 2026: process-local package overlay produced `10` passing, `0` failed, `0` skipped without claiming package integration landed in the repository
  - controller evidence on July 30, 2026: Phase 4B suite produced `10` passing, `0` failed, `0` skipped
  - controller evidence on July 30, 2026: hostile output-root replacement is expected to fail closed without publication, and any displaced unreachable temp stage is treated as operator-cleanup residue rather than a packager guarantee violation
  - this P4C-3 authoring revision did not run the package build, package command, or tests directly
- Activation status:
  - this package-integration revision does not activate or serve Draw.io
  - `blocked.html` remains the only allowed runtime entrypoint today
