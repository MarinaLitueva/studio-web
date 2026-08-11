# Draw.io Phase 4A Runtime Artifact Acceptance

## Scope

This Phase 4A harness defines the repository-local runtime artifact audit contract for a future browser-only diagrams.net runtime in Theia. It retains the raw upstream WAR as a quarantined acquisition artifact, but it does not unpack, serve, activate, or claim browser runtime behavior, and it does not change the current `blocked.html` activation gate.

## Expected Status Today

Current expected result is GREEN for the descriptor audit contract and still BLOCKED for runtime activation:

- `DIO-P4A-001` passes because `drawio-editor/runtime/runtime-artifact.json` now exists at the required repository-local path.
- `DIO-P4A-002` passes to prove the harness remains deterministic and uses only Node built-ins.
- `DIO-P4A-003` through `DIO-P4A-008` are expected to run and pass because the descriptor, recipe, SBOM, and audit records now exist and are internally consistent.
- The helper-level regression tests still pass: one rejects duplicate CSP directives before any overwrite, one proves activated `runtime-manifest.json.entrypoint` must equal `descriptor.activation.entrypoint` exactly while also rejecting entrypoint and manifest-asset digest mismatches, and one proves acquisition-audit PASS alone cannot satisfy activation readiness.
- `runtime-manifest.json` must still remain blocked with `entrypoint = "blocked.html"` and `provenance.usability = "blocked"` because retained WAR integrity evidence and acquisition-audit PASS do not authorize runtime activation.

Run with:

```bash
node --test drawio-editor/tests/phase4a/runtime-artifact.acceptance.test.js
```

## Executable Acceptance Mapping

| ID | Executable assertion |
| --- | --- |
| DIO-P4A-001 | `runtime-artifact.acceptance.test.js` asserts the expected repository path is `drawio-editor/runtime/runtime-artifact.json` and fails with one clear actionable message until the descriptor exists. |
| DIO-P4A-002 | `runtime-artifact.acceptance.test.js` asserts the harness itself uses only `node:test`, `node:assert/strict`, `node:fs`, `node:path`, and `node:crypto`, and contains no placeholder markers. |
| DIO-P4A-003 | `runtime-artifact.acceptance.test.js` asserts `schemaVersion === 1`, exact `runtimeVersion` match with `runtime-manifest.json`, an explicit lifecycle gate field, and `target === "browser"`. |
| DIO-P4A-004 | `runtime-artifact.acceptance.test.js` asserts pinned upstream identity and version, upstream archive SHA-256, a contained reproducible recipe path, a repository-local retained WAR path that must exist as a real contained non-symlink file, a declared retained WAR SHA-256 that must always match, and descriptor provenance for `jgraph/drawio-integration` identity plus immutable commit and archive SHA-256 that exactly match `runtime-manifest.json`. |
| DIO-P4A-005 | `runtime-artifact.acceptance.test.js` asserts contained non-symlink LICENSE, SPDX-style SBOM, and acquisition-audit files exist under `drawio-editor/runtime`, guards nested descriptor and `runtime-manifest.json` object shapes explicitly before access, requires matching SHA-256 for the acquisition audit record, and requires acquisition-audit verdict `pass`. |
| DIO-P4A-006 | `runtime-artifact.acceptance.test.js` asserts a non-empty CSP with `default-src` exactly `'none'` and `connect-src` exactly `'none'`, rejects duplicate directive names before later entries can overwrite earlier ones, requires exact-origin messaging, `networkOrigins === []`, no wildcard, protocol-relative, explicit network-capable scheme, explicit host, localhost, single-label host, or IPv6 host sources, and audited exception entries for any `unsafe-inline` or `unsafe-eval` directive. It also requires descriptor metadata to record that the Phase 0 host CSP/security gate remains authoritative and that exception metadata cannot override that gate before formal activation. |
| DIO-P4A-007 | `runtime-artifact.acceptance.test.js` asserts the second-stage activation gate separately from retained acquisition evidence: activation requires `lifecycle.status === "ready"`, a distinct `descriptor.activation.entrypoint` plus SHA-256 for the future browser entrypoint, a distinct `descriptor.security.activationAudit` record whose contained existing file matches its SHA-256 and whose verdict equals `approved`, and explicit formal activation of the Phase 0 host CSP/security gate. It also requires exact equality between `runtime-manifest.json.entrypoint` and `descriptor.activation.entrypoint`, rejects any activated-file digest mismatch against `descriptor.activation.sha256`, and if `runtime-manifest.json.assets` records the activated entrypoint digest, that digest must also match `descriptor.activation.sha256`. Acquisition-audit PASS and retained WAR integrity alone are never sufficient. Until all of those are true, `runtime-manifest.json` must remain `compatibility.status = "blocked"`, `entrypoint = "blocked.html"`, and `provenance.usability = "blocked"`. |
| DIO-P4A-008 | `runtime-artifact.acceptance.test.js` asserts the descriptor and all referenced JSON or text records contain no common placeholder markers, and it revalidates the recorded integration identity, commit hash, and archive SHA-256 shapes before traversing referenced files. When a future activation-audit record is added, it must satisfy the same contained-path and no-placeholder rules. |

## Two-Stage Model

1. Acquisition stage: `descriptor.retainedArtifact` identifies the quarantined raw upstream WAR and `descriptor.security.acquisitionAudit` records provenance and integrity verification with verdict `pass`.
2. Activation stage: a future `descriptor.activation` must identify the browser entrypoint, and a separate `descriptor.security.activationAudit` must point to an activation-specific record with verdict `approved`.
3. Authorization rule: acquisition-audit PASS plus retained WAR integrity never authorizes activation. Runtime activation additionally requires the separate browser entrypoint, activation-audit approval, and `phase0HostSecurityGate.formallyActivated = true`.

## Intentional Boundaries

- This harness keeps the current Phase 0 blocked runtime model intact even after descriptor acquisition records land.
- Descriptor completion and a passing acquisition audit do not supersede the Phase 0 host CSP/security gate or authorize activation on their own.
- The retained WAR and the future browser activation entrypoint are intentionally modeled as different objects with different audit requirements.
- Descriptor exception metadata is descriptive only in Phase 4A and cannot override the blocked compatibility decision while `formallyActivated` remains false.
- This harness does not claim Electron support; the target remains browser-only for Phase 4A.
- This harness does not define a Theia backend serving endpoint or runtime bundle layout beyond repository-local contained paths.
