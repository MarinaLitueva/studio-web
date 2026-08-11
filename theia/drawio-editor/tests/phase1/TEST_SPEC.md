# Phase 1 Protocol Test Spec

Build command: `npm --prefix drawio-editor run build`

Test command: `node --test drawio-editor/tests/phase1/drawio-protocol.test.js`

## Coverage Map

- `PHASE1-PROTOCOL-001`: Fails with an actionable build-first message when compiled outputs under `drawio-editor/lib` are missing.
- `PHASE1-PROTOCOL-002`: Verifies `createLoadMessage` returns the exact load message shape and preserves XML/title content strictly as data.
- `PHASE1-PROTOCOL-003`: Verifies `createExportMessage` returns the exact export message shape for `xml`, `xmlsvg`, `xmlpng`, `svg`, and `png`.
- `PHASE1-PROTOCOL-004`: Verifies `createExportMessage` rejects an unsupported runtime export format.
- `PHASE1-PROTOCOL-005`: Verifies `parseEditorMessage` accepts and normalizes `init`, `save` with and without `exit`, `export`, and `exit` with and without `xml` and `modified`.
- `PHASE1-PROTOCOL-006`: Verifies `parseEditorMessage` rejects `null`, arrays, and custom-prototype objects.
- `PHASE1-PROTOCOL-007`: Verifies `parseEditorMessage` rejects unsupported events plus missing or wrong-type required properties.
- `PHASE1-PROTOCOL-008`: Verifies `parseEditorMessage` rejects extra properties, including benign extras and representative dangerous names such as `uri`, `command`, and `filePath`.
- `PHASE1-PROTOCOL-009`: Verifies the exported format guard returns `true` only for the allowlisted formats.
- `PHASE1-PROTOCOL-010`: Verifies the public browser service factory returns a stable singleton and the compiled frontend `ContainerModule` remains importable.
- `PHASE1-PROTOCOL-011`: Verifies accepted message objects never expose filesystem or command-style property names while allowing those words inside XML/title/data string values.
- `PHASE1-PROTOCOL-012`: Verifies the Phase 1 harness itself uses only Node built-ins plus the package's compiled modules.
