```toml
[phase]
plan = "theia-studio-cloud-poc"
number = 1
total = 9
type = "implement"
title = "Compose the safe browser application"
depends_on = []
input_manifest = ""
input_signature = ""
input_files = ["package.json", "browser-app/package.json", "electron-app/package.json", "studio/package.json", "package-lock.json", "node_modules/@theia/cli/lib/download-plugins.js"]
output_files = ["browser-app/package.json", "electron-app/package.json", "studio/package.json", "package-lock.json"]
outputs = ["out/phase-01-application-composition.md"]
inputs = []
```

## Preamble

This is a self-contained phase file. All rules, constraints, and kit content
are included below. Project files listed in the Task section must be read
at runtime. Follow the instructions exactly, run any EXECUTE commands as
written, and report results against the acceptance criteria at the end.

## What

Compose the browser and Electron application manifests so the browser target becomes the functional Studio shell without introducing Studio business logic. This phase is limited to dependency wiring, plugin-host configuration, and build or smoke verification for browser and Electron packaging. Source Control must be available in the browser build through the VS Code Git extension path supported by Theia 1.73.1, while terminal and arbitrary process execution must be removed from the browser composition.

## Prior Context

- Plan path: `/Volumes/coding/cf-work/workspace-sources/constructorfabric/fabric-poc/poc/theia/.cf-studio/.plans/theia-studio-cloud-poc/plan.toml`.
- Plan task: implement a secure single-user cloud Studio proof of concept on Eclipse Theia.
- Phase 1 has no dependencies and no prior phase outputs.
- Declared phase outputs are `browser-app/package.json`, `electron-app/package.json`, `studio/package.json`, and `package-lock.json`.
- Browser target is functional.
- Electron target is compile-only.
- Plan validation commands are `npm test`, `npm run build:browser`, and `npm run build:electron`.

## User Decisions

### Already Decided (pre-resolved during planning)

- **Theia version**: every Eclipse Theia package stays on exact version `1.73.1`.
- **Browser target role**: browser is the functional application target.
- **Electron target role**: Electron is compile-only and exists as a regression gate.
- **Git capability path**: use the built-in VS Code Git extension path supported by Theia 1.73.1.
- **Forbidden package**: do not add `@theia/git`.
- **Browser safety boundary**: remove terminal and process capability from browser composition.
- **Scope boundary**: do not add Studio application services, workflows, or UI beyond dependency wiring.

### Decisions Needed During This Phase

- None. Execute the phase with the pre-resolved decisions above.

## Rules

### Composition Rules

- MUST compile only dependency and composition changes for this phase.
- MUST keep every Eclipse Theia package on exact version `1.73.1`.
- MUST preserve `browser-app`, `electron-app`, and `studio` workspace linkage.
- MUST keep the browser target functional.
- MUST keep Electron buildable as a compile regression gate.
- MUST use the built-in VS Code Git extension path supported by Theia 1.73.1.
- MUST record the exact plugin configuration used for Git support in the phase report.
- MUST record build and smoke evidence in the phase report.
- MUST align any package-lock updates with the manifest changes.
- MUST keep the phase file self-contained and executable without Studio context.

### Browser Safety Rules

- MUST remove terminal capability from the browser application composition.
- MUST remove process capability from the browser application composition.
- MUST avoid introducing arbitrary command execution capability in the browser composition.
- MUST avoid UI or service work beyond wiring dependencies and plugin support.

### Source and Validation Rules

- MUST runtime-read the project manifests listed in Task before editing them.
- MUST runtime-read the official Theia composition, migration, and VS Code extension guidance listed in Task before deciding the plugin manifest shape.
- MUST runtime-read the local `@theia/cli` plugin download source before finalizing the plugin manifest shape.
- MUST make every acceptance criterion pass or fail objectively.
- MUST include the final self-check against the acceptance criteria.
- MUST leave no unresolved template variables outside fenced code blocks.
- MUST keep this file at or below 280 lines.

### Prohibitions

- MUST NOT add `@theia/git`.
- MUST NOT rely on removed Theia Git package behavior.
- MUST NOT load unrelated UI reference code, graph code, or Git pipeline implementation while executing this phase.
- MUST NOT edit plan files, briefs, or later-phase outputs during execution.
- MUST NOT proceed to later-phase logic in this phase.

## Input

### Stable Plan Metadata

- Project root: `/Volumes/coding/cf-work/workspace-sources/constructorfabric/fabric-poc/poc/theia`
- Plan directory: `/Volumes/coding/cf-work/workspace-sources/constructorfabric/fabric-poc/poc/theia/.cf-studio/.plans/theia-studio-cloud-poc`
- Phase file: `/Volumes/coding/cf-work/workspace-sources/constructorfabric/fabric-poc/poc/theia/.cf-studio/.plans/theia-studio-cloud-poc/phase-01-application-composition.md`
- Root scripts currently expose `build:browser`, `build:electron`, `start:browser`, `start:electron`, `watch:browser`, `watch:electron`, and `test`.
- Current manifests already pin `@theia/core`, related browser packages, `@theia/electron`, and `@theia/cli` to `1.73.1`.
- Current browser manifest still includes `@theia/process` and `@theia/terminal`.
- Current Electron manifest also includes `@theia/process` and `@theia/terminal`.
- Current `studio/package.json` exposes a frontend Theia extension and depends on `@theia/core` `1.73.1`.

### Official Theia Guidance To Apply

- Theia composing applications guidance defines the monorepo shape, browser and Electron package roles, and the `theia.target` manifest contract.
- Theia migration guidance for v1.70.0 states that `@theia/git` was removed and adopters must migrate to the built-in VS Code Git extension through built-in extension packs or explicit plugin configuration.
- Theia VS Code extension guidance states that applications can load extensions from a plugins directory by starting Theia with `--plugins=local-dir:../plugins`.
- The same guidance states that build-time bundled extensions use `theiaPluginsDir`, `theiaPlugins`, and `theia download:plugins`.
- The installed `@theia/cli` source proves that `theia download:plugins` reads `package.json`, requires `theiaPlugins`, defaults `theiaPluginsDir` to `plugins`, and downloads declared plugin URLs into that directory.

## Task

1. Read the runtime project inputs before changing anything: `/Volumes/coding/cf-work/workspace-sources/constructorfabric/fabric-poc/poc/theia/package.json`, `/Volumes/coding/cf-work/workspace-sources/constructorfabric/fabric-poc/poc/theia/browser-app/package.json`, `/Volumes/coding/cf-work/workspace-sources/constructorfabric/fabric-poc/poc/theia/electron-app/package.json`, `/Volumes/coding/cf-work/workspace-sources/constructorfabric/fabric-poc/poc/theia/studio/package.json`, and the relevant root `package-lock.json` entries for the workspace packages and any added or removed Theia dependencies.
2. Read the runtime external references before finalizing the manifest shape: `https://theia-ide.org/docs/composing_applications/`, `https://eclipse-theia.github.io/theia/docs/next/documents/Migration.html`, and `https://theia-ide.org/docs/authoring_vscode_extensions/`. Extract only the facts needed for Theia 1.73.1 browser and Electron composition, Git extension bundling, plugins directory startup wiring, and the prohibition on `@theia/git`.
3. Read the local installation proof for plugin configuration shape: `/Volumes/coding/cf-work/workspace-sources/constructorfabric/fabric-poc/poc/theia/node_modules/@theia/cli/lib/download-plugins.js`. Confirm that the application package using bundled VS Code extensions must define `theiaPlugins`, can set `theiaPluginsDir`, and that the download target defaults to `plugins` when unspecified.
4. Update `browser-app/package.json`, `electron-app/package.json`, `studio/package.json`, and `package-lock.json` so the browser app remains the functional target, all Eclipse Theia dependencies stay on exact `1.73.1`, browser composition removes `@theia/process` and `@theia/terminal`, and Source Control is available through bundled VS Code Git extension wiring rather than `@theia/git`. Keep Electron aligned as a compile-only gate, and if plugin startup flags or plugin download scripts are required for Git support, wire them in the correct package manifests without adding business logic.
5. Run and record the required verification commands from `/Volumes/coding/cf-work/workspace-sources/constructorfabric/fabric-poc/poc/theia`: `npm test`, `npm run build:browser`, and `npm run build:electron`. After a successful browser build, run a browser launch smoke that starts the browser app with the bundled plugin configuration and confirms the application boots without terminal or process capability being reintroduced. Record the exact command used and the observable boot evidence.
6. Self-check the resulting changes against every acceptance criterion, verify this phase stayed within scope, and report PASS only if all criteria pass.
7. Write the exact completion report and next-phase prompt to `/Volumes/coding/cf-work/workspace-sources/constructorfabric/fabric-poc/poc/theia/.cf-studio/.plans/theia-studio-cloud-poc/out/phase-01-application-composition.md` after the self-check passes.

## Acceptance Criteria

- [ ] `browser-app/package.json` contains no `@theia/process`, no `@theia/terminal`, no `@theia/git`, and all remaining Eclipse Theia dependencies are exact `1.73.1`.
- [ ] The application manifests and lockfile include a concrete VS Code Git extension bundling path compatible with Theia 1.73.1, including any required `theiaPlugins`, `theiaPluginsDir`, download script, and startup `--plugins` wiring, without depending on `@theia/git`.
- [ ] `electron-app/package.json` remains buildable as a compile-only target and stays version-aligned with exact `1.73.1` Theia packages for the dependencies it still uses.
- [ ] `studio/package.json` remains a Theia extension package and contains no Phase 2 or later business logic changes.
- [ ] `npm test`, `npm run build:browser`, and `npm run build:electron` all pass, and the phase report includes the exact browser smoke command plus boot evidence.
- [ ] The resulting implementation adds no terminal or arbitrary process execution capability to the browser composition.
- [ ] This phase file contains no unresolved template variables outside fenced code blocks and stays at or below 280 lines.

## Output Format

When complete, report results in this exact format:
```text
PHASE 1/9 COMPLETE
Status: PASS | FAIL
Files created: {list}
Files modified: {list}
Acceptance criteria:
  [x] Criterion 1 — PASS
  [ ] Criterion 2 — FAIL: {reason}
  ...
Line count: {actual}/280
Notes: {any issues or decisions made}
```

If `Status: PASS`, then generate a copy-pasteable prompt for the next phase inside a single code fence:

```text
Next phase prompt (copy-paste into new chat if needed):

I have a Studio execution plan at:
  /Volumes/coding/cf-work/workspace-sources/constructorfabric/fabric-poc/poc/theia/.cf-studio/.plans/theia-studio-cloud-poc/plan.toml

Phase 1 is complete (PASS).
Please read the plan manifest, then execute Phase 2: "Establish runtime configuration and workspace protocol".
The phase file is:
  /Volumes/coding/cf-work/workspace-sources/constructorfabric/fabric-poc/poc/theia/.cf-studio/.plans/theia-studio-cloud-poc/phase-02-runtime-workspace-protocol.md

It is self-contained. Follow it exactly, report results, and stop after Phase 2.
```

If `Status: FAIL`, do not generate a next-phase execution prompt. Instead, emit:

```text
Phase 1 failed. Do not proceed to Phase 2.
Fix the failed acceptance criteria in:
  /Volumes/coding/cf-work/workspace-sources/constructorfabric/fabric-poc/poc/theia/.cf-studio/.plans/theia-studio-cloud-poc/phase-01-application-composition.md
Then rerun Phase 1 and report PASS before continuing.
```
