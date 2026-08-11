# Compilation Brief: Phase 1/9 — Compose the safe browser application

--- CONTEXT BOUNDARY ---
Disregard all previous context. This brief is self-contained.
Read ONLY the files listed below. Follow the instructions exactly.
---

## Phase Metadata
```toml
[phase]
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

## Compilation Clarification

- Compile a dependency/composition phase; do not add Studio business logic.
- Keep every Eclipse Theia package on exact version `1.73.1`.
- Browser is the functional target; Electron receives only a compile regression gate.
- Use the built-in VS Code Git extension path supported by Theia 1.73.1; never add removed `@theia/git`.
- Remove Terminal and Process capability from the cloud browser target because no container sandbox exists.
- Record exact compatible plugin configuration and build evidence in the phase output.

## Load Instructions

1. **Plan manifest**: Read `.cf-studio/.plans/theia-studio-cloud-poc/plan.toml`.
   - Action: compile-time metadata only.
2. **Application manifests**: Runtime-read `package.json`, `browser-app/package.json`, `electron-app/package.json`, `studio/package.json`, and relevant `package-lock.json` entries.
   - Scope: dependency composition, scripts, Theia target declarations, exact versions.
3. **Official Theia guidance**: Runtime-read current official composing-applications, extension, VS Code extension, and v1.73 migration documentation.
   - Scope: plugin host and bundled VS Code Git configuration only.
4. **Installed Theia sources**: Runtime-read `node_modules/@theia/cli/lib/download-plugins.js`.
   - Scope: prove the manifest shape used by this exact installation.

**Do NOT load**: UI reference code, graph implementation, Git pipeline code, or unrelated Theia packages.

## Compile Phase File

Write to: `.cf-studio/.plans/theia-studio-cloud-poc/phase-01-application-composition.md`

Required sections:
1. TOML frontmatter
2. Preamble
3. What
4. Prior Context
5. User Decisions
6. Rules
7. Input
8. Task
9. Acceptance Criteria
10. Output Format

The Task must prove Source Control availability in the browser application, preserve exact package alignment, remove arbitrary command execution from browser composition, run browser build/launch smoke, and run the Electron compile gate. It must not introduce application services or UI beyond dependency wiring.

## Context Budget

- Phase file target: ≤ 280 lines.
- Inlined content estimate: ~130 lines.
- Runtime manifests and focused source reads: ~420 lines.
- Total execution context: ≤ 700 lines.

## After Compilation

Report: `Phase 1 compiled → phase-01-application-composition.md (N lines)`.
