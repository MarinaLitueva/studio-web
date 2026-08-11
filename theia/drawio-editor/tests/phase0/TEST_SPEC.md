# Draw.io Phase 0 Runtime Security Acceptance

## Scope

This Phase 0 harness codifies the static runtime manifest and offline security contract for a future native Eclipse Theia Draw.io editor. It does not implement the editor or claim any browser-driven behavior already works.

## Expected Status Today

Current expected result is fully GREEN:

- `11` tests pass.
- The helper regression for CSP parsing still passes without depending on browser runtime state or external packages.

## Executable Acceptance Mapping

| ID | Executable assertion |
| --- | --- |
| DRAWSPIKE-001 | `runtime-security.acceptance.test.js` asserts that the repository root resolves from `__dirname`, the expected manifest path is `drawio-editor/runtime/runtime-manifest.json`, and a missing manifest fails with one clear actionable message. |
| DRAWSPIKE-002 | `runtime-security.acceptance.test.js` asserts `schemaVersion === 1`, an exact semver `runtimeVersion`, `runtimeIdentity === "diagrams.net"`, `integrationIdentity === "jgraph/drawio-integration"`, `offline === true`, and a repository-local relative `entrypoint`. |
| DRAWSPIKE-003 | `runtime-security.acceptance.test.js` asserts `allowedNetworkOrigins` is exactly `[]` and rejects URL-like runtime entrypoint or asset paths. |
| DRAWSPIKE-004 | `runtime-security.acceptance.test.js` asserts every declared runtime asset stays under `drawio-editor/runtime`, exists, declares a lowercase 64-hex SHA-256 digest, and matches the file content digest. |
| DRAWSPIKE-005 | `runtime-security.acceptance.test.js` asserts at least one declared license file exists and remains contained under the runtime root. |
| DRAWSPIKE-006 | `runtime-security.acceptance.test.js` asserts `uniqueOriginRequired === true`, `default-src 'none'`, `connect-src 'none'`, rejects case-insensitive duplicate directive names before overwrite, and rejects wildcard, protocol-relative, explicit network-capable scheme, explicit origin, explicit host, localhost, single-label host, IPv6 host, `unsafe-inline`, and `unsafe-eval` CSP sources. |
| DRAWSPIKE-007 | `runtime-security.acceptance.test.js` asserts the sandbox capability list is explicit, unique, non-empty, includes `allow-scripts`, and forbids top-navigation and popup escape capabilities. |
| DRAWSPIKE-008 | `runtime-security.acceptance.test.js` asserts explicit unique protocol allowlists, requires host-to-editor `load` and `export`, requires editor-to-host `init`, `save`, `export`, and `exit`, and rejects message names containing `path`, `uri`, `file`, `command`, or `execute`. |
| DRAWSPIKE-009 | `runtime-security.acceptance.test.js` asserts the runtime manifest source contains no common placeholder markers. |
| DRAWSPIKE-010 | `runtime-security.acceptance.test.js` asserts the harness itself uses only `node:test`, `node:assert/strict`, `fs`, `path`, and `crypto`, and contains no common placeholder markers. |

The always-running helper regression separately proves `CONNECT-SRC https://example.com; connect-src 'none'` is rejected before overwrite and that explicit network origins are still rejected even without manifest-dependent coverage.

## Later Dynamic Browser Checks

The following checks are intentionally deferred to later phases and are not claimed as implemented by this harness:

| Future check | Reason it stays out of Phase 0 |
| --- | --- |
| Verify the iframe receives a unique origin at runtime | Requires a live browser host and instantiated iframe. |
| Verify the iframe sandbox flags match the manifest at runtime | Requires DOM inspection after the editor shell is implemented. |
| Verify CSP enforcement blocks network access and inline script execution | Requires browser execution and negative-path probes. |
| Verify postMessage payloads conform to the allowlisted protocol schema | Requires a running host/editor bridge with message capture. |
| Verify trusted input validation before atomic save/export writes | Requires production save and export flows. |
| Verify `.drawio`, `.dio`, `.drawio.svg`, and `.drawio.png` round trips | Requires the native editor runtime, parsers, and persistence wiring. |
