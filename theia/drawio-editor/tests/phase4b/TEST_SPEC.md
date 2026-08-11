# Draw.io Phase 4B Runtime Boundary Test Spec

Phase 4B defines the future safe browser runtime boundary for a diagrams.net canvas without changing the current blocked runtime state. The outer editor remains a native Theia `ReactWidget`. The future canvas is a single dedicated cross-origin iframe that is still absent today.

This Phase 4B contract takes precedence over the older general Phase 3 runtime narrative only for dormant runtime-boundary preparation. Phase 3 remains authoritative for the current shell: `drawio-editor-widget.tsx` and `drawio-frontend-module.ts` must stay iframe-free and must not import or instantiate `drawio-runtime-frame` while the manifest remains blocked. Activation work must update that older Phase 3 narrative and its executable contract atomically before any iframe wiring lands.

## Scope

- Keep the current runtime blocked:
  - `drawio-editor/runtime/runtime-manifest.json` must stay on `blocked.html`
  - `drawio-editor/runtime/runtime-artifact.json` acquisition PASS must remain insufficient for activation
  - no test in this phase writes or assumes `activationAudit`
- Add a future implementation contract for these planned files only:
  - `drawio-editor/src/common/drawio-runtime-origin-policy.ts`
  - `drawio-editor/lib/common/drawio-runtime-origin-policy.js`
  - `drawio-editor/src/browser/drawio-runtime-frame.ts`
  - `drawio-editor/lib/browser/drawio-runtime-frame.js`
  - `drawio-editor/src/node/drawio-runtime-endpoint.ts`
  - `drawio-editor/lib/node/drawio-runtime-endpoint.js`
  - `drawio-editor/src/node/drawio-backend-module.ts`
  - `drawio-editor/lib/node/drawio-backend-module.js`
- Preserve the accepted frontend/backend boundary:
  - outer shell stays a native Theia `ReactWidget`
  - browser-only iframe boundary logic lives in `src/browser/drawio-runtime-frame.ts`
  - native backend HTTP integration lives in `src/node/drawio-runtime-endpoint.ts`
  - native backend registration lives in `src/node/drawio-backend-module.ts`
  - no RPC is needed for this boundary; the browser talks to the dedicated runtime iframe with `postMessage`, and the backend serves runtime assets/headers over an Express surface
- Lock the Theia activation pattern to the installed public `@theia/filesystem` precedent:
  - until the implementation exists, `drawio-editor/package.json` `theiaExtensions` must remain exactly one current frontend-only entry:
    - `frontend: lib/browser/drawio-frontend-module`
  - `drawio-editor/package.json` `theiaExtensions` must become exactly one entry containing:
    - `frontend: lib/browser/drawio-frontend-module`
    - `backend: lib/node/drawio-backend-module`
  - `src/node/drawio-backend-module.ts` must default-export a `ContainerModule`
  - the backend module must bind `DrawioRuntimeEndpoint` `toSelf().inSingletonScope()`
  - the backend module must bind `BackendApplicationContribution` `toService(DrawioRuntimeEndpoint)`
- Lock the shared origin policy:
  - `normalizeDrawioRuntimeOrigin(value)` must normalize to an exact `http` or `https` origin
  - `assertDistinctDrawioOrigins(runtimeOriginInput, studioOriginInput)` must reject same-origin runtime and Studio deployments
  - reject relative URLs, credentials, wildcard hosts, templated hosts, query strings, fragments, and path-bearing URLs
  - `src/browser/drawio-runtime-frame.ts` and `src/node/drawio-runtime-endpoint.ts` must both import `../common/drawio-runtime-origin-policy` and call both shared APIs
  - the common module must stay pure and side-effect free
- Lock the browser message boundary to executable compiled seams:
  - compiled browser module must export `resolveDrawioRuntimeFrameConfig({ runtimeOriginInput, studioOriginInput })`
  - `resolveDrawioRuntimeFrameConfig` must normalize both origins, reject same-origin runtime/Studio deployments, and reject invalid runtime inputs before any messaging seam is used
  - a valid `resolveDrawioRuntimeFrameConfig` result must return exact normalized `runtimeOrigin` and `studioOrigin`
  - compiled browser module must export `acceptDrawioRuntimeMessage(eventLike, expectedOrigin, expectedSource, parseEditorMessage)`
  - `acceptDrawioRuntimeMessage` must reject wrong `event.origin` and wrong `event.source` before calling `parseEditorMessage`
  - `acceptDrawioRuntimeMessage` must return `undefined` on rejection and return the parser result on success
  - compiled browser module must export `postDrawioRuntimeMessage(targetWindow, payload, runtimeOrigin)`
  - `postDrawioRuntimeMessage` must call `targetWindow.postMessage(payload, runtimeOrigin)` and must never target `*`
  - payload parsing remains delegated to `DrawioProtocolService.parseEditorMessage` only after exact origin/source checks
- Lock the future iframe sandbox to an exact allowlist:
  - compiled browser module must export `DRAWIO_RUNTIME_SANDBOX`
  - `DRAWIO_RUNTIME_SANDBOX` must equal exactly `['allow-scripts', 'allow-same-origin']`
  - reject additional sandbox capabilities
- Lock the future native backend endpoint to actual compiled request-origin and header behavior:
  - compiled node endpoint module must export `buildDrawioRuntimeHeaders({ runtimeOriginInput, studioOriginInput, assetHash? })`
  - compiled node endpoint module must export `DRAWIO_RUNTIME_TRUSTED_PROXY_TOKEN_ENV` and `DRAWIO_RUNTIME_TRUSTED_PROXY_TOKEN_HEADER`
  - compiled node endpoint module must export `resolveDrawioRuntimeRequestOrigin(request, trustProxy?, trustedProxyToken?)`
  - compiled node endpoint module must export `assertDrawioRuntimeRequestOrigin({ request, runtimeOriginInput, studioOriginInput, trustProxy?, trustedProxyToken? })`
  - `buildDrawioRuntimeHeaders` must reject same-origin runtime/Studio deployments and reject invalid runtime or Studio origin inputs before returning headers
  - the request-origin guard must compare the exact effective request origin to the normalized configured runtime origin before serving `blocked.html`
  - direct mode must derive the request origin only from the raw `Host` header plus the direct socket scheme and must ignore `X-Forwarded-*` headers
  - proxy trust must be opt-in only through `DRAWIO_RUNTIME_TRUST_PROXY=true`
  - trusted proxy mode must require `DRAWIO_RUNTIME_TRUSTED_PROXY_TOKEN` with at least 32 UTF-8 bytes and exactly one non-empty trimmed `x-drawio-runtime-proxy-token` header before any forwarded headers are read
  - trusted proxy token comparison must use a constant-time public Node `crypto` path and must never expose token material in thrown errors
  - trusted proxy mode may use exactly one `x-forwarded-proto` plus one `x-forwarded-host` only when both are present and the trusted proxy token authenticates first; comma-separated, empty, malformed, or partially-present forwarded values must still fail closed
  - deployment invariant: ingress must strip any client-supplied `x-drawio-runtime-proxy-token` header and inject only its configured secret, and the backend must not be directly reachable from untrusted networks while proxy trust mode is enabled
  - requests resolving to the configured Studio origin or any other non-runtime origin must fail closed at the same 503 seam
  - without `assetHash`, headers must represent a development `Cache-Control: no-store` mode
  - with a content hash, headers must represent immutable content-addressed caching
  - actual builder output, not a synthetic safe object, must satisfy:
    - `Content-Security-Policy` with `default-src 'none'`
    - `connect-src 'none'`
    - no wildcard, `unsafe-inline`, `unsafe-eval`, or explicit network-capable sources
    - `frame-ancestors` equals the exact configured Studio origin
    - `X-Content-Type-Options: nosniff`
    - `Cache-Control: no-store` during development or immutable content-addressed caching only
    - no permissive CORS
  - endpoint source must implement/use `BackendApplicationContribution` and configure an Express `Application` or `Router` surface
  - the route must read the fixed `blocked.html` path through an explicit asynchronous file-read callback and map any read failure to the same deterministic safe 503 response
- Keep the harness on Node built-ins plus the minimum public installed Theia APIs needed to execute compiled backend module activation:
  - `@theia/core/shared/inversify`
  - `@theia/core/lib/node/backend-application`

## Executable Acceptance Mapping

| ID | Executable assertion |
| --- | --- |
| DIO-P4B-001 | `runtime-boundary.acceptance.test.js` requires the planned common, browser, node endpoint, and backend module files and fails with one actionable bootstrap message only when those implementation surfaces are missing. |
| DIO-P4B-002 | The always-running helper regression proves runtime and Studio origins must normalize to distinct exact `http(s)` origins and rejects relative, credentialed, wildcard, templated, query, fragment, and path-bearing runtime inputs. |
| DIO-P4B-003 | The always-running helper regression proves host-to-frame messaging must never use `*` and proves frame-to-host acceptance is invalid when `event.source` does not match the owned iframe window even if `event.origin` matches. |
| DIO-P4B-004 | The always-running current-state regression proves acquisition-audit PASS does not authorize activation, `runtime-manifest.json` remains blocked on `blocked.html`, `activationAudit` is absent, and both the source and compiled current widget/frontend artifacts loaded by Theia remain iframe-free without importing `drawio-runtime-frame`. |
| DIO-P4B-005 | The always-running helper regression proves a valid header set with exact `frame-ancestors` passes, wildcard `frame-ancestors` fails, explicit `connect-src` network origins fail, the package shape remains frontend-only until implementation exists, and the harness uses only Node built-ins plus the minimum public Theia APIs required for compiled backend DI activation checks. |
| DIO-P4B-006 | When implementation files exist, the compiled browser frame module must export `resolveDrawioRuntimeFrameConfig`, `acceptDrawioRuntimeMessage`, and `postDrawioRuntimeMessage`; reject same-origin, path-bearing, wildcard, and templated runtime inputs up front; reject wrong origin and wrong source before parser invocation; parse exactly once for a valid message; and post outbound messages only to the exact runtime origin. |
| DIO-P4B-007 | When implementation files exist, the compiled browser frame module must export `DRAWIO_RUNTIME_SANDBOX` equal exactly to `allow-scripts` and `allow-same-origin`, and the blocked outer editor/frontend shell must still remain iframe-free until activation updates the older Phase 3 contract. |
| DIO-P4B-008 | When implementation files exist, the common origin-policy module must stay pure, export `normalizeDrawioRuntimeOrigin` and `assertDistinctDrawioOrigins`, and both the browser frame source and node endpoint source must import and call that shared policy. |
| DIO-P4B-009 | When implementation files exist, the compiled node endpoint module must export `buildDrawioRuntimeHeaders({ runtimeOriginInput, studioOriginInput, assetHash? })`, `DRAWIO_RUNTIME_TRUSTED_PROXY_TOKEN_ENV`, `DRAWIO_RUNTIME_TRUSTED_PROXY_TOKEN_HEADER`, `resolveDrawioRuntimeRequestOrigin(request, trustProxy?, trustedProxyToken?)`, and `assertDrawioRuntimeRequestOrigin({ request, runtimeOriginInput, studioOriginInput, trustProxy?, trustedProxyToken? })`; direct Host+scheme requests must succeed while spoofed forwarded and proxy-token headers are ignored in direct mode, trusted proxy mode must reject missing, weak, or mismatched proxy tokens before using forwarded headers, a valid 32-byte token plus one exact forwarded host/proto pair must succeed, malformed forwarded values must still reject after successful proxy authentication, token values must never appear in errors, the real Express route must pass `trustedProxyToken` into the request-origin guard before reading the fixed `blocked.html` file, and any file-read failure must map to the deterministic safe 503 response. |
| DIO-P4B-010 | When implementation files exist, package activation must follow the public Theia frontend/backend extension pattern, the compiled backend module default `ContainerModule` must load into a real Inversify container, `BackendApplicationContribution` must resolve to the same singleton as `DrawioRuntimeEndpoint`, Node must stay `>=22 <=24`, and the native runtime boundary must not introduce RPC, plugin-ext, or webview surfaces. |

## Expected Current Result

Current expected result is fully green:

- `10` passing executable acceptance tests:
  - `DIO-P4B-001`
  - `DIO-P4B-002`
  - `DIO-P4B-003`
  - `DIO-P4B-004`
  - `DIO-P4B-005`
  - `DIO-P4B-006`
  - `DIO-P4B-007`
  - `DIO-P4B-008`
  - `DIO-P4B-009`
  - `DIO-P4B-010`
- `0` failed
- `0` skipped

## Run Commands

Use the project Node 22-compatible built-in test runner:

```bash
node --check drawio-editor/tests/phase4b/runtime-boundary.acceptance.test.js
node --test drawio-editor/tests/phase4b/runtime-boundary.acceptance.test.js
```
