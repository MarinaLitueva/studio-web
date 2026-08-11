# Draw.io 30.0.4 Acquisition Audit

## Verdict

PASS

This PASS verdict covers acquisition, provenance, containment, and integrity checks for the quarantined upstream WAR artifact only. It is not runtime execution approval, not a CSP exception approval, and not authorization to replace `blocked.html`.

## Audited Object

- Retained file: `drawio-editor/runtime/artifacts/draw-30.0.4.war`
- Size: `52723743` bytes
- SHA-256: `cb40abb5f750f549444c94c00de086218b47e30b33fbc4dd0476118afd8ec19d`

## Provenance Inputs

- diagrams.net source archive: `https://github.com/jgraph/drawio/archive/refs/tags/v30.0.4.tar.gz`
- diagrams.net source archive SHA-256: `3196a93468ff901546054d0f19edd55fe972bc6c546da327b6f3db51d533e084`
- drawio-integration archive: `https://github.com/jgraph/drawio-integration/archive/321f82a19dd7f619bddfe5e0866bf548d98bd8f4.tar.gz`
- drawio-integration archive SHA-256: `6910df1e6c39e7093f2da1ef0b2955ce8b4c6bfbcaac31185a279af517224a1f`
- Retained license file: `drawio-editor/runtime/licenses/diagrams-net-LICENSE.txt`

## Audit Findings

1. The retained WAR exists at the recorded repository-local path and matches the expected size and SHA-256 digest.
2. The runtime manifest records the same diagrams.net version, source archive digest, integration identity, integration commit, and integration archive digest as the acquisition record.
3. The retained runtime remains a raw upstream WAR under quarantine. No unpacked web application is activated in this repository.
4. The Phase 0 compatibility gate remains blocked because unresolved evidence still exists for inline style usage, external URL allowance in observed bootstrap policy, `eval` or `Function` patterns, and wildcard `postMessage` targets.
5. The integration source archive is a verification input only and is not copied into this repository because the archive has no `LICENSE`.

## Non-Activation Statement

- `blocked.html` remains the only active local entrypoint.
- `runtime-manifest.json` compatibility status remains blocked.
- Phase 0 compatibility is still unresolved for the raw WAR because the recorded evidence in `drawio-editor/runtime/COMPATIBILITY.md` remains authoritative.
- No claim is made that the browser runtime works under the required repository CSP and message-origin policy.
