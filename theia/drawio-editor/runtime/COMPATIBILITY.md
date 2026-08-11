# Draw.io Phase 0 Compatibility Gate

## Status

Blocked. This runtime directory records the Phase 0 security contract and provenance only. It does not vendor a working diagrams.net web application and it does not enable a native Theia editor.

## Evidence Recorded For This Gate

- diagrams.net source archive version: `30.0.4`
- diagrams.net source archive SHA-256: `3196a93468ff901546054d0f19edd55fe972bc6c546da327b6f3db51d533e084`
- diagrams.net release artifact: `draw.war`
- diagrams.net release artifact size: `52723743` bytes
- diagrams.net unpacked webapp size: about `149 MB`
- official integration wrapper commit: `321f82a19dd7f619bddfe5e0866bf548d98bd8f4`
- official integration wrapper archive SHA-256: `6910df1e6c39e7093f2da1ef0b2955ce8b4c6bfbcaac31185a279af517224a1f`
- official integration wrapper archive has no `LICENSE`, so its source is not copied here

## Why The Gate Is Blocked

- The upstream `index.html` contains inline style usage and therefore does not satisfy the required no-inline policy.
- The bootstrap Electron CSP observed in the upstream integration allows `style-src 'unsafe-inline'`, wildcard `img-src`, wildcard `media-src`, wildcard `font-src`, and network connections.
- Twenty-three upstream JavaScript files matched `eval` or `Function` patterns during inspection, which is incompatible with a no-eval policy.
- The official integration wrapper uses wildcard `postMessage` targets, which does not satisfy a constrained message-origin contract.
- The required target policy is stricter than the inspected upstream runtime: `default-src 'none'`, `connect-src 'none'`, no wildcard sources, no `unsafe-inline`, no `unsafe-eval`, and a unique origin.

## Decision Required

One of these conditions must be met before a native Draw.io editor can be enabled in this repository:

1. Upstream diagrams.net and the integration layer provide a verifiable build that satisfies the required offline sandbox and CSP contract.
2. A separately licensed and reviewed local packaging strategy is approved, with the same security properties and full provenance for every shipped asset.

Until then, `blocked.html` remains the only local entrypoint and exists solely to fail closed.
