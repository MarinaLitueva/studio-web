# Phase 3 Native Shell Test Spec

Phase 3 covers the native Theia shell only. The runtime remains fail-closed at this stage: there is no iframe-backed editor canvas, no webview host, and no editable Draw.io rendering surface yet.

## Scope

- Require the compiled native shell modules:
  - `lib/browser/drawio-editor-widget.js`
  - `lib/browser/drawio-editor-open-handler.js`
  - `lib/browser/drawio-editor-contribution.js`
  - `lib/browser/drawio-frontend-module.js`
- Require the corresponding browser sources:
  - `src/browser/drawio-editor-widget.tsx`
  - `src/browser/drawio-editor-open-handler.ts`
  - `src/browser/drawio-editor-contribution.ts`
  - `src/browser/drawio-frontend-module.ts`
- Validate the public inheritance chain against Theia 1.73.1:
  - `DrawioEditorWidget` extends `ReactWidget`
  - `DrawioEditorOpenHandler` extends `NavigatableWidgetOpenHandler`
- Lock the open-handler contract:
  - ID `drawio.editor`
  - label `Draw.io Editor`
  - priority `600` for `file://` resources ending case-insensitively in `.drawio`, `.dio`, `.drawio.svg`, `.drawio.png`
  - priority `0` for non-file schemes, generic `.svg` / `.png`, unrelated files, and deceptive suffixes
- Require the widget lifecycle/navigation shell surface:
  - `configure`
  - `getResourceUri`
  - `createMoveToUri`
  - `storeState`
  - `restoreState`
  - `dispose`
  - a `saveable` contract source-grounded against the local Markdown editor pattern
- Require the contribution shell hooks:
  - `onStart`
  - `registerCommands`
  - `registerMenus`
  - `dispose` only if the implementation allocates registrations that need cleanup
- Reject non-native approaches in future `src/browser` sources:
  - `vscode`
  - `@theia/plugin-ext`
  - `WebviewWidget`
  - `CustomEditorWidget`
  - `registerCustomEditorProvider`
  - webview endpoint configuration
  - executable iframe creation or iframe JSX
- Require source-text bindings in `src/browser/drawio-frontend-module.ts` for:
  - `WidgetFactory`
  - `OpenHandler -> DrawioEditorOpenHandler`
  - `FrontendApplicationContribution -> DrawioEditorContribution`
- Require the frontend module to stay on public Theia entry points only.
- Keep the harness limited to Node built-ins, future compiled Draw.io modules, and installed public Theia modules.
- Add a browser integration suite that launches the Theia browser app against a disposable local Git workspace and proves:
  - Quick Open routes `.drawio`, `.dio`, `.drawio.svg`, and `.drawio.png` into the native shell
  - generic `plain.svg` and `plain.png` do not select the native shell
  - the rendered shell shows `Draw.io native shell`, the exact file name, and the Phase 3 runtime-unavailable copy
  - page reload restores the active Draw.io native shell widget and file identity

## Commands

Build the extension before the focused verification runs:

```bash
npm --prefix drawio-editor run build
```

Check the structural suite syntax:

```bash
node --check drawio-editor/tests/phase3/native-shell.acceptance.test.js
```

Run the Node structural contract suite:

```bash
node --test drawio-editor/tests/phase3/native-shell.acceptance.test.js
```

Run the browser integration suite:

```bash
npx playwright test tests/e2e/drawio-native-shell.spec.ts
```

## Expected Current Result

Current repository state is green for the focused Phase 3 native-shell coverage.

- `node --check drawio-editor/tests/phase3/native-shell.acceptance.test.js`
  - expected now: `0` syntax failures
- `node --test drawio-editor/tests/phase3/native-shell.acceptance.test.js`
  - expected now: green after a fresh `drawio-editor` build
  - expected now: `10` passing tests
  - expected now: `0` failing tests
- `npx playwright test tests/e2e/drawio-native-shell.spec.ts`
  - expected now: green in a browser-capable environment after the application bundle is available
  - expected now: `1` passing test
  - coverage proves real open-handler selection, widget/container rendering, generic-image fallback, and browser-level restoration for the native shell
