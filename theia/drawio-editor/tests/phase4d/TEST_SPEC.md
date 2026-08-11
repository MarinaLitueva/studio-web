# Draw.io Phase 4D-1 Runtime Activation Acceptance

Phase 4D-1 defines a tests-first activation validator contract for the already packaged diagrams.net candidate runtime. Current repository state must remain fail-closed: candidate packaging is not compatibility approval, and compatibility approval is not formal activation authority.

## Scope

- Keep the current blocked state unchanged:
  - `drawio-editor/runtime/runtime-manifest.json` must stay `entrypoint = "blocked.html"`
  - `drawio-editor/runtime/runtime-manifest.json` must stay `compatibility.status = "blocked"`
  - `drawio-editor/runtime/runtime-manifest.json` must stay `provenance.usability = "blocked"`
  - `drawio-editor/runtime/runtime-artifact.json` must stay `lifecycle.status = "blocked"`
  - `drawio-editor/runtime/runtime-artifact.json` Phase 0 host gate must stay `formallyActivated = false`
- Preserve native Theia architecture while authority remains blocked:
  - outer shell remains `src/browser/drawio-editor-widget.tsx` as a native `ReactWidget`
  - backend runtime HTTP integration remains `src/node/drawio-runtime-endpoint.ts`
  - browser iframe/message seam remains isolated to `src/browser/drawio-runtime-frame.ts`
  - no shared RPC, plugin-ext, webview, VS Code extension, service rebind, or upstream Theia patch
- Preserve mandatory document scope and future export narrative:
  - editable document scope remains `.drawio`, `.dio`, `.drawio.svg`
  - `.drawio.png` remains within Draw.io custom-editor/open-handler scope as `preview-only`
  - generic `.svg` and `.png` remain outside Draw.io custom-editor selection
  - future save/export expectations remain limited to XML, SVG container, and PNG container outcomes without claiming they are implemented in this activation-validator phase
- Keep the harness on Node built-ins only.

## Activation Module Contract

The implementation surface is a Node-only activation validator:

- source path: `drawio-editor/src/node/drawio-runtime-activation.ts`
- compiled path: `drawio-editor/lib/node/drawio-runtime-activation.js`

The compiled module exports exactly:

- `DRAWIO_RUNTIME_ACTIVATION_VERSION`
- `loadDrawioRuntimeCandidate({ bundleRoot, bundleManifestPath, assetIntegrityPath, packagingReportPath })`
- `auditDrawioRuntimeCompatibility({ candidate, entrypoint, sandbox, csp, messagingTargets, messagingOrigins, networkOrigins, networkUrls, requiresInlineStyle, requiresInlineScript, requiresEval, requiresFunctionConstructor })`
- `authorizeDrawioRuntimeActivation({ candidate, compatibility, runtimeOrigin, studioOrigin, sandbox, networkOrigins, unsafeExceptions, activationAudit })`

`DIO-P4D-001` readiness is stricter than file existence. The compiled module must load successfully, export exactly those four public names and no others, and set `DRAWIO_RUNTIME_ACTIVATION_VERSION === "30.0.4"` before any implementation-dependent test is allowed to run.

## Contract Semantics

### Candidate loading

`loadDrawioRuntimeCandidate(...)` must fail closed and must:

- require all three generated metadata documents:
  - `bundle-manifest.json`
  - `asset-integrity.json`
  - `packaging-report.json`
- treat only those three bundle-root control-plane metadata files as allowed non-inventory files in the realized candidate tree
- verify the three documents agree on:
  - `runtimeVersion`
  - retained source archive identity
  - `bundleSha256`
  - policy object
  - included inventory
  - excluded inventory
  - verdict `candidate`
- verify the realized candidate tree exactly matches the integrity inventory by:
  - path
  - byte count
  - lowercase SHA-256
- reject root replacement, entry, metadata, or read-time identity changes between discovery and descriptor-backed reads
- reject raw whitespace or case-normalized identity variants instead of normalizing them across runtimeVersion, SHA-256 identity, source-archive path, and inventory paths
- reject:
  - missing files
  - extra files
  - symlinks
  - traversal paths
  - duplicate normalized paths
  - case-fold collisions
  - wrong hash
  - wrong size
  - metadata drift between the three documents

### Compatibility audit

`auditDrawioRuntimeCompatibility(...)` must return an explicit verdict object and must never auto-authorize activation. It must return `verdict = "blocked"` with normalized reason strings when any of these are required or observed:

- `inline-style-required`
- `inline-script-required`
- `eval-required`
- `function-constructor-required`
- `network-origin-required`
- `network-url-required`
- `wildcard-message-target`
- `wildcard-message-origin`
- `disallowed-sandbox-token`
- `unsafe-csp-exception`
- `invalid-entrypoint`

The compatibility gate must not encode any automatic CSP relaxation or exception.

For `invalid-entrypoint`, the gate must fail closed not only for missing or malformed entrypoint strings, but also when the entrypoint carries surrounding whitespace, is not already a normalized portable relative path, or is absent from the exact case-sensitive candidate included inventory.

For `network-origin-required` and `network-url-required`, malformed collections also fail closed using those same existing reason codes; the gate must not treat malformed collections as absent.

For `wildcard-message-target` and `wildcard-message-origin`, the arrays must contain exact already-normalized valid `http(s)` origins on every element. Empty arrays, whitespace variants, path/query variants, credential-bearing URLs, wildcard hosts, templated hosts, default-port variants, and any other noncanonical or malformed origin entries fail closed on those same existing reason-code axes.

Each compatibility reason code above is an isolated contract axis. A single-hazard input may return that one exact reason, and a multi-hazard input may return the applicable reason set in any safe order.

### Formal activation authority

`authorizeDrawioRuntimeActivation(...)` must require all of the following exactly:

- candidate verdict remains `candidate`
- compatibility verdict is `pass`
- exact runtime and Studio origins are both valid `http(s)` origins and are distinct
- exact sandbox allowlist is `allow-scripts` plus `allow-same-origin` and nothing else
- `networkOrigins` is empty
- `unsafeExceptions` is empty
- activation audit descriptor exists, is explicit, and matches the exact runtime version and bundle SHA identity being authorized

Any missing or mismatched field must reject with `verdict = "blocked"`.

Candidate runtime identity is part of the activation contract: candidate `runtimeVersion` must be exactly `"30.0.4"` with no surrounding whitespace, candidate `bundleSha256` must be exact lowercase 64-hex with no surrounding whitespace, runtime and Studio origins must be exact already-normalized origin strings, and the approved activation audit must match the candidate identity exactly. Missing, malformed, or mismatched candidate/audit runtime version or bundle identity stay normalized to the existing `activation-audit-runtime-version-mismatch` and `activation-audit-bundle-sha-mismatch` reason codes.

Normalized activation-block reason codes are:

- `candidate-verdict-not-candidate`
- `compatibility-not-pass`
- `invalid-runtime-origin`
- `invalid-studio-origin`
- `origins-not-distinct`
- `sandbox-mismatch`
- `network-origins-not-empty`
- `unsafe-exceptions-not-empty`
- `activation-audit-missing`
- `activation-audit-not-approved`
- `activation-audit-runtime-version-mismatch`
- `activation-audit-bundle-sha-mismatch`

Origin validation stays aligned with the Phase 4B shared-origin contract: the shared common policy supplies the `http(s)` parsing and distinct-origin semantics, while Phase 4D authorization adds the stricter raw already-normalized input requirement. Scheme, path, credential, wildcard-host, templated-host, whitespace, and other noncanonical variants normalize to `invalid-runtime-origin` or `invalid-studio-origin`.

## Bounded Runtime Rule

- The always-running red-phase coverage proves metadata agreement, blocked authority, exact realized path and byte agreement, and narrowly selected real-file hash checks against the published candidate.
- The bundle root may contain exactly three non-inventory control-plane files:
  - `bundle-manifest.json`
  - `asset-integrity.json`
  - `packaging-report.json`
- Those three control-plane metadata files are not runtime asset inventory entries. All other files, including inventoried JSON assets such as `monday-app-association.json`, must remain in the exact realized-tree comparison.
- Full realized-tree hash verification belongs to `loadDrawioRuntimeCandidate(...)` in the implemented activation module, and same-size/coarse-timestamp stability is enforced by comparing explicit content witnesses across the discovery and final-validation boundaries rather than by timestamp precision alone.
- Synthetic fixtures cover negative-path integrity rejection and keep the focused suite bounded without rehashing the full packaged runtime repeatedly.

## Executable Acceptance Mapping

| ID | Executable assertion |
| --- | --- |
| DIO-P4D-001 | `runtime-activation.acceptance.test.js` fails once with one actionable message until `src/node/drawio-runtime-activation.ts` exists, is built to `lib/node/drawio-runtime-activation.js`, and exports the exact Phase 4D contract names. |
| DIO-P4D-002 | The harness uses only Node built-ins directly, contains no placeholder markers, and preserves a Node 22-compatible direct `node --test` surface while loading compiled project seams only through bounded runtime preflight or behavior checks. |
| DIO-P4D-003 | The always-running current-state regression proves `runtime-manifest.json`, `runtime-artifact.json`, `bundle-manifest.json`, `asset-integrity.json`, and `packaging-report.json` agree on runtime version, retained source archive identity, bundle SHA, policy, included inventory, excluded inventory, and candidate verdict while still keeping candidate packaging separate from compatibility and activation authority. |
| DIO-P4D-004 | The always-running current-state regression proves the published candidate tree exactly matches the recorded included inventory by path set and byte count, excluding only the three allowed bundle-root control-plane metadata files that are not runtime asset inventory entries, rejects symlink or case-fold ambiguity in the realized tree shape, and confirms a small fixed sample of real files still matches recorded lowercase SHA-256 digests without rehashing the full runtime tree. |
| DIO-P4D-005 | The always-running current-state regression proves blocked authority remains intact: `blocked.html`, blocked compatibility, blocked usability, blocked lifecycle, inactive Phase 0 host gate, absent activation audit, continued mandatory document and open-handler scope for `.drawio`, `.dio`, `.drawio.svg`, and `.drawio.png` with generic `.svg` and `.png` outside the custom editor contract by executable compiled behavior, and bounded static proof that the blocked widget still has no runtime-frame or iframe wiring. |
| DIO-P4D-006 | The final current-state regression proves the suite does not mutate authority or candidate metadata bytes by comparing before-and-after bytes for `runtime-manifest.json`, `runtime-artifact.json`, `bundle-manifest.json`, `asset-integrity.json`, and `packaging-report.json` after all earlier tests have run. |
| DIO-P4D-007 | The activation module loads the published candidate bundle, exposes exactly the four documented exports and no others, and returns a candidate summary whose runtime version, bundle SHA, policy, included inventory, excluded inventory, and verdict deep-match the normalized published metadata while remaining `candidate` rather than activation. |
| DIO-P4D-008 | Synthetic candidate fixtures prove `loadDrawioRuntimeCandidate(...)` rejects missing, extra, symlink, traversal, duplicate, case-fold collision, wrong-hash, wrong-size, root replacement, identity-swap, same-size in-place rewrite, whitespace/case identity variants, and one-axis-at-a-time metadata-drift cases across `runtimeVersion`, source archive identity, bundle SHA, policy, included inventory, excluded inventory, and verdict. Loader rejection order is intentionally unconstrained as long as the invalid candidate is rejected safely. |
| DIO-P4D-009 | `auditDrawioRuntimeCompatibility(...)` returns `verdict = "blocked"` with the exact normalized reason code for each isolated hazard: inline style, inline script, eval, Function constructor, network origin, network URL, wildcard messaging target, wildcard messaging origin, disallowed sandbox token, unsafe CSP exception, invalid or missing entrypoint, whitespace-variant or non-normalized entrypoint such as `./index.html` or `dir/../index.html`, absent entrypoint inventory membership, and malformed or noncanonical messaging-origin arrays on the existing messaging axes. A fully constrained input returns `verdict = "pass"` with no reasons. |
| DIO-P4D-010 | `authorizeDrawioRuntimeActivation(...)` rejects isolated mismatches for candidate verdict, compatibility verdict, invalid runtime origin, invalid Studio origin, non-distinct origins, sandbox mismatch, non-empty network origins, non-empty unsafe exceptions, missing activation audit, non-approved activation audit, activation-audit runtime-version mismatch, and activation-audit bundle-SHA mismatch using the documented normalized activation-block reason codes, including whitespace/case identity variants on origins, runtime version, and SHA identity that are not already exact canonical values, and returns `verdict = "pass"` only for the exact all-good baseline. |

## Expected Current Result

Current expected result remains intentionally RED with one actionable bootstrap failure until the implementation is built and loaded through the compiled module:

- `1` failed test:
  - `DIO-P4D-001`
- `5` passing tests:
  - `DIO-P4D-002`
  - `DIO-P4D-003`
  - `DIO-P4D-004`
  - `DIO-P4D-005`
  - `DIO-P4D-006`
- `4` skipped tests until the activation module exists:
  - `DIO-P4D-007`
  - `DIO-P4D-008`
  - `DIO-P4D-009`
  - `DIO-P4D-010`

## Run Commands

Use the project-local Node 22-compatible built-in runner:

```bash
node --check drawio-editor/tests/phase4d/runtime-activation.acceptance.test.js
node --test drawio-editor/tests/phase4d/runtime-activation.acceptance.test.js
```

## Boundaries

- Theia extension points used:
  - none in the Phase 4D-1 harness itself
  - the existing production pattern remains public Theia only: native `ReactWidget` plus backend `BackendApplicationContribution.configure(app)` and the browser iframe/message seam
- Frontend/backend boundary:
  - frontend UI remains in `src/browser`
  - Node serving and future activation validation remain in `src/node`
  - cross-boundary protocol types remain in `src/common`
- RPC contract:
  - none
- Services rebound or overridden:
  - none
- Dependence on internal or unstable Theia APIs:
  - none allowed
- Tests performed in this authoring change:
  - this revision only authors the red-first executable contract and does not run builds or tests directly
