# Phase 2 Draw.io Document Inspection Acceptance

Build command: `npm --prefix drawio-editor run build`

Test command: `node --test drawio-editor/tests/phase2/drawio-document.acceptance.test.js`

## Scope

This Phase 2 harness defines the future compiled `drawio-editor/lib/common/drawio-document.js` contract for inspecting Draw.io document bytes before any Theia frontend or backend integration consumes them.

The API under test is:

```js
inspectDrawioDocument(fileName, bytes)
```

where `fileName` is the original user-visible name and `bytes` is a `Uint8Array`.

## Coverage Map

- `PHASE2-DOCUMENT-001`: Fails once with an actionable implement-and-build message when `drawio-editor/lib/common/drawio-document.js` is missing. All remaining implementation tests skip until that compiled module exists.
- `PHASE2-DOCUMENT-002`: Verifies `.drawio` and `.dio` accept UTF-8 XML rooted at `mxfile` or `mxGraphModel`, return `{ mode: 'editable', format: 'xml', xml }`, and match file names case-insensitively.
- `PHASE2-DOCUMENT-003`: Verifies malformed XML, plain text, or wrong-root XML supplied as `.drawio` or `.dio` reject with an explicit `invalid-diagram` error instead of falling back silently.
- `PHASE2-DOCUMENT-004`: Verifies `.drawio.svg` returns editable SVG results when the root `<svg>` `content` attribute carries XML entity-escaped content, percent-encoded XML, double-percent-encoded XML, or base64-encoded XML.
- `PHASE2-DOCUMENT-005`: Verifies `.drawio.svg` returns preview-only results for missing embedded content, invalid embedded content, and malformed SVG containers using `missing-embedded-diagram`, `invalid-embedded-diagram`, and `invalid-container`.
- `PHASE2-DOCUMENT-006`: Verifies `.drawio.png` reads modern PNG `tEXt` chunks with `mxfile` or `mxGraphModel` keywords, supports percent and double-percent decoding, and returns decoded XML only.
- `PHASE2-DOCUMENT-007`: Verifies `.drawio.png` returns preview-only results for plain PNGs with no embedded diagram, invalid embedded text payloads, and malformed PNG containers without throwing.
- `PHASE2-DOCUMENT-008`: Verifies unsupported names reject explicitly: generic `.svg`, generic `.png`, unrelated extensions, and non-mandatory image formats are all outside the accepted contract.
- `PHASE2-DOCUMENT-009`: Verifies editable SVG and PNG results return canonical decoded Draw.io XML beginning with `mxfile` or `mxGraphModel` and never leak wrapper image bytes or markers.
- `PHASE2-DOCUMENT-010`: Verifies the acceptance harness imports only Node built-ins plus the future compiled module.

## Format Notes

- Mandatory XML formats in scope now: `.drawio`, `.dio`, `.drawio.svg`, and `.drawio.png`.
- Generic `.svg` and `.png` are intentionally unsupported even if they happen to contain compatible payloads.
- Modern PNG `tEXt` extraction is mandatory in Phase 2.
- Legacy PNG `zTXt` extraction is intentionally deferred. A `zTXt`-only image may remain `preview-only` until a reviewed decompressor is introduced in a later phase.

## Current Red-Phase Expectation

- `node --check drawio-editor/tests/phase2/drawio-document.acceptance.test.js` passes.
- `node --test drawio-editor/tests/phase2/drawio-document.acceptance.test.js` currently reports exactly 1 failed bootstrap test and the remaining implementation tests skipped until the compiled module exists.
