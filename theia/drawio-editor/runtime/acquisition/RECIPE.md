# Draw.io Runtime Artifact Acquisition Recipe

## Scope

This recipe records how the repository-local quarantined diagrams.net runtime artifact was acquired and verified for provenance and integrity. The retained object is the raw upstream WAR only. The source and integration archives listed below are verification inputs only and are not retained in this repository.

## Retained Artifact

- Path: `drawio-editor/runtime/artifacts/draw-30.0.4.war`
- Upstream release URL: `https://github.com/jgraph/drawio/releases/download/v30.0.4/draw.war`
- Size: `52723743` bytes
- SHA-256: `cb40abb5f750f549444c94c00de086218b47e30b33fbc4dd0476118afd8ec19d`
- Repository status: quarantined, not activated, Phase 0 fail-closed entrypoint remains `blocked.html`

## Verification Inputs

- diagrams.net source archive URL: `https://github.com/jgraph/drawio/archive/refs/tags/v30.0.4.tar.gz`
- diagrams.net source archive SHA-256: `3196a93468ff901546054d0f19edd55fe972bc6c546da327b6f3db51d533e084`
- drawio-integration archive URL: `https://github.com/jgraph/drawio-integration/archive/321f82a19dd7f619bddfe5e0866bf548d98bd8f4.tar.gz`
- drawio-integration archive SHA-256: `6910df1e6c39e7093f2da1ef0b2955ce8b4c6bfbcaac31185a279af517224a1f`

## Reproducible Checks

1. Confirm the retained binary path is `drawio-editor/runtime/artifacts/draw-30.0.4.war`.
2. Confirm the retained binary size is `52723743` bytes.
3. Confirm the retained binary SHA-256 is `cb40abb5f750f549444c94c00de086218b47e30b33fbc4dd0476118afd8ec19d`.
4. Confirm `drawio-editor/runtime/runtime-manifest.json` records:
   - `runtimeVersion = "30.0.4"`
   - `runtimeIdentity = "diagrams.net"`
   - `provenance.diagramsNet.sourceArchiveSha256 = "3196a93468ff901546054d0f19edd55fe972bc6c546da327b6f3db51d533e084"`
   - `provenance.integration.identity = "jgraph/drawio-integration"`
   - `provenance.integration.commit = "321f82a19dd7f619bddfe5e0866bf548d98bd8f4"`
   - `provenance.integration.archiveSha256 = "6910df1e6c39e7093f2da1ef0b2955ce8b4c6bfbcaac31185a279af517224a1f"`
5. Confirm `drawio-editor/runtime/licenses/diagrams-net-LICENSE.txt` exists.
6. Confirm the retained object is still quarantined and not activated because the unresolved Phase 0 compatibility evidence in `drawio-editor/runtime/COMPATIBILITY.md` remains authoritative.

## Retention Boundary

- The raw upstream WAR is retained for integrity-audited provenance only.
- The diagrams.net source archive is not retained after verification.
- The drawio-integration archive is not retained after verification.
- The integration source is not copied into this repository because the archive has no `LICENSE`.
