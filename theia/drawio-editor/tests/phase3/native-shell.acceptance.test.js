const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const phaseRoot = __dirname;
const packageRoot = path.resolve(phaseRoot, '..', '..');
const libBrowserRoot = path.join(packageRoot, 'lib', 'browser');
const srcBrowserRoot = path.join(packageRoot, 'src', 'browser');

const compiledModulePaths = {
    widget: path.join(libBrowserRoot, 'drawio-editor-widget.js'),
    openHandler: path.join(libBrowserRoot, 'drawio-editor-open-handler.js'),
    contribution: path.join(libBrowserRoot, 'drawio-editor-contribution.js'),
    frontendModule: path.join(libBrowserRoot, 'drawio-frontend-module.js')
};

const sourceModulePaths = {
    widget: path.join(srcBrowserRoot, 'drawio-editor-widget.tsx'),
    openHandler: path.join(srcBrowserRoot, 'drawio-editor-open-handler.ts'),
    contribution: path.join(srcBrowserRoot, 'drawio-editor-contribution.ts'),
    frontendModule: path.join(srcBrowserRoot, 'drawio-frontend-module.ts')
};

const compiledReady = Object.values(compiledModulePaths).every(fs.existsSync);
const nativeShellReady = compiledReady && Object.values(sourceModulePaths).every(fs.existsSync);
const missingBuildMessage =
    'Phase 3 native shell implementation is incomplete. Add '
    + 'src/browser/drawio-editor-widget.tsx, src/browser/drawio-editor-open-handler.ts, '
    + 'src/browser/drawio-editor-contribution.ts, update src/browser/drawio-frontend-module.ts, '
    + 'run `npm --prefix drawio-editor run build`, then rerun '
    + '`node --test drawio-editor/tests/phase3/native-shell.acceptance.test.js`.';

function requireNativeShellImplementation() {
    assert.ok(nativeShellReady, missingBuildMessage);
}

function readSource(modulePath) {
    return fs.readFileSync(modulePath, 'utf8');
}

function stripComments(source) {
    return source
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^\\])\/\/.*$/gm, '$1');
}

function getImportSpecifiers(source) {
    const matches = [
        ...source.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g),
        ...source.matchAll(/\brequire\(\s*['"]([^'"]+)['"]\s*\)/g)
    ];
    return matches.map(match => match[1]).sort();
}

function assertPublicTheiaImportsOnly(source, label) {
    for (const specifier of getImportSpecifiers(source)) {
        if (!specifier.startsWith('@theia/')) {
            continue;
        }
        assert.match(
            specifier,
            /^@theia\/[^/]+(?:\/(?:lib|shared)(?:\/.*)?)?$/,
            `${label} must import only public Theia package, lib, or shared entry points, got ${specifier}`
        );
        assert.ok(!specifier.includes('/src/'), `${label} must not import internal Theia src paths, got ${specifier}`);
    }
}

function assertNoForbiddenEditorPatterns(source, label) {
    const executableSource = stripComments(source);
    const forbiddenPatterns = [
        { pattern: /\bfrom\s+['"]vscode['"]|\brequire\(\s*['"]vscode['"]\s*\)/, label: 'vscode imports' },
        { pattern: /\bfrom\s+['"]@theia\/plugin-ext(?:\/[^'"]*)?['"]|\brequire\(\s*['"]@theia\/plugin-ext(?:\/[^'"]*)?['"]\s*\)/, label: '@theia/plugin-ext imports' },
        { pattern: /\bWebviewWidget\b/, label: 'WebviewWidget references' },
        { pattern: /\bCustomEditorWidget\b/, label: 'CustomEditorWidget references' },
        { pattern: /\bregisterCustomEditorProvider\b/, label: 'registerCustomEditorProvider references' },
        { pattern: /\bwebviewEndpoint\b|\bwebview[^.\n;]{0,40}endpoint\b|\bendpoint[^.\n;]{0,40}webview\b/i, label: 'webview endpoint configuration' },
        { pattern: /<iframe\b/i, label: 'iframe JSX markup' },
        { pattern: /\b(?:document\.)?createElement\(\s*['"]iframe['"]\s*\)/i, label: 'iframe DOM creation' }
    ];

    for (const forbidden of forbiddenPatterns) {
        assert.ok(!forbidden.pattern.test(executableSource), `${label} must not include ${forbidden.label}`);
    }
}

function hasSaveableContract(widgetConstructor, widgetSource) {
    if (widgetConstructor?.prototype) {
        const descriptor = Object.getOwnPropertyDescriptor(widgetConstructor.prototype, 'saveable');
        if (descriptor && (typeof descriptor.get === 'function' || typeof descriptor.set === 'function' || 'value' in descriptor)) {
            return true;
        }
    }
    return /\breadonly\s+saveable\b|\bsaveable\s*[:=]/.test(stripComments(widgetSource));
}

function shouldRequireDispose(source) {
    const executableSource = stripComments(source);
    return /\bDisposableCollection\b|\btoDispose\b|\bdispose\(/.test(executableSource);
}

function assertMethodDeclaration(source, className, methodName) {
    assert.match(
        stripComments(source),
        new RegExp(`\\bclass\\s+${className}\\b[\\s\\S]*?\\b${methodName}\\s*\\(`),
        `${className}.${methodName} must be declared in source`
    );
}

function assertStaticReadonlyValue(source, className, propertyName, expectedValue) {
    const escapedValue = expectedValue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    assert.match(
        stripComments(source),
        new RegExp(`\\bclass\\s+${className}\\b[\\s\\S]*?\\b${propertyName}\\s*=\\s*['"]${escapedValue}['"]`),
        `${className}.${propertyName} must equal ${expectedValue}`
    );
}

function assertCompiledExport(compiledSource, exportName) {
    assert.match(
        compiledSource,
        new RegExp(`exports\\.${exportName}\\s*=`),
        `${exportName} must be exported in the compiled module`
    );
}

function assertSourceContainsAll(source, expectations, label) {
    for (const expectation of expectations) {
        assert.match(source, expectation, `${label} is missing expected pattern ${expectation}`);
    }
}

test('PHASE3-SHELL-001 requires the compiled native shell modules and updated frontend module before the structural contract suite can run', () => {
    assert.equal(path.relative(packageRoot, compiledModulePaths.widget), path.join('lib', 'browser', 'drawio-editor-widget.js'));
    assert.equal(path.relative(packageRoot, compiledModulePaths.openHandler), path.join('lib', 'browser', 'drawio-editor-open-handler.js'));
    assert.equal(path.relative(packageRoot, compiledModulePaths.contribution), path.join('lib', 'browser', 'drawio-editor-contribution.js'));
    assert.equal(path.relative(packageRoot, compiledModulePaths.frontendModule), path.join('lib', 'browser', 'drawio-frontend-module.js'));
    requireNativeShellImplementation();
});

test('PHASE3-SHELL-002 source and compiled modules encode the public ReactWidget and NavigatableWidgetOpenHandler inheritance chains', { skip: !nativeShellReady }, () => {
    const widgetSource = stripComments(readSource(sourceModulePaths.widget));
    const openHandlerSource = stripComments(readSource(sourceModulePaths.openHandler));
    const compiledWidgetSource = readSource(compiledModulePaths.widget);
    const compiledOpenHandlerSource = readSource(compiledModulePaths.openHandler);

    assert.match(widgetSource, /\bclass\s+DrawioEditorWidget\s+extends\s+ReactWidget\b/);
    assert.match(openHandlerSource, /\bclass\s+DrawioEditorOpenHandler\s+extends\s+NavigatableWidgetOpenHandler\b/);
    assert.match(compiledWidgetSource, /\bextends\s+browser_1\.ReactWidget\b/);
    assert.match(compiledOpenHandlerSource, /\bextends\s+browser_1\.NavigatableWidgetOpenHandler\b/);
    assertCompiledExport(compiledWidgetSource, 'DrawioEditorWidget');
    assertCompiledExport(compiledOpenHandlerSource, 'DrawioEditorOpenHandler');
});

test('PHASE3-SHELL-003 open handler source and compiled output keep the native-shell ID, label, and file-priority contract for Draw.io resources', { skip: !nativeShellReady }, () => {
    const openHandlerSource = stripComments(readSource(sourceModulePaths.openHandler));
    const compiledOpenHandlerSource = readSource(compiledModulePaths.openHandler);

    assertStaticReadonlyValue(openHandlerSource, 'DrawioEditorOpenHandler', 'ID', 'drawio.editor');
    assertStaticReadonlyValue(openHandlerSource, 'DrawioEditorOpenHandler', 'LABEL', 'Draw.io Editor');
    assertSourceContainsAll(
        openHandlerSource,
        [
            /\buri\.scheme\s*!==\s*'file'/,
            /\breturn\s+this\.isDrawioResourceName\(name\)\s*\?\s*600\s*:\s*0/,
            /\.endsWith\('\.drawio'\)/,
            /\.endsWith\('\.dio'\)/,
            /\.endsWith\('\.drawio\.svg'\)/,
            /\.endsWith\('\.drawio\.png'\)/
        ],
        'drawio-editor-open-handler.ts'
    );
    assert.match(compiledOpenHandlerSource, /DrawioEditorOpenHandler\.ID = 'drawio\.editor'/);
    assert.match(compiledOpenHandlerSource, /DrawioEditorOpenHandler\.LABEL = 'Draw\.io Editor'/);
});

test('PHASE3-SHELL-004 open handler source text rejects non-file URIs, generic image names, unrelated files, and deceptive suffixes', { skip: !nativeShellReady }, () => {
    const openHandlerSource = stripComments(readSource(sourceModulePaths.openHandler));

    assert.ok(!/\.endsWith\('\.svg'\)(?![\s\S]*\.drawio\.svg)/.test(openHandlerSource), 'generic .svg files must stay unhandled');
    assert.ok(!/\.endsWith\('\.png'\)(?![\s\S]*\.drawio\.png)/.test(openHandlerSource), 'generic .png files must stay unhandled');
    assert.ok(!/includes\(|match\(|regex/i.test(openHandlerSource), 'open handler should rely on exact suffix checks rather than loose matching');
});

test('PHASE3-SHELL-005 widget source and compiled exports expose the native lifecycle, navigation, and saveable surface without claiming canvas runtime behavior', { skip: !nativeShellReady }, () => {
    const widgetSource = readSource(sourceModulePaths.widget);
    const compiledWidgetSource = readSource(compiledModulePaths.widget);

    for (const methodName of ['configure', 'getResourceUri', 'createMoveToUri', 'storeState', 'restoreState']) {
        assertMethodDeclaration(widgetSource, 'DrawioEditorWidget', methodName);
    }
    assertMethodDeclaration(widgetSource, 'DrawioEditorWidget', 'dispose');
    assert.ok(
        hasSaveableContract(undefined, widgetSource),
        'DrawioEditorWidget must expose a saveable contract comparable to MarkdownEditorWidget'
    );
    assertCompiledExport(compiledWidgetSource, 'DrawioEditorWidget');
});

test('PHASE3-SHELL-006 contribution source and compiled exports expose the startup, command, and menu hooks needed for native shell integration', { skip: !nativeShellReady }, () => {
    const contributionSource = readSource(sourceModulePaths.contribution);
    const compiledContributionSource = readSource(compiledModulePaths.contribution);

    for (const methodName of ['onStart', 'registerCommands', 'registerMenus']) {
        assertMethodDeclaration(contributionSource, 'DrawioEditorContribution', methodName);
    }
    if (shouldRequireDispose(contributionSource)) {
        assertMethodDeclaration(contributionSource, 'DrawioEditorContribution', 'dispose');
    }
    assertCompiledExport(compiledContributionSource, 'DrawioEditorContribution');
});

test('PHASE3-SHELL-007 source files stay on the native Theia shell path and reject VS Code, plugin-ext, webview, and iframe implementations by source inspection', { skip: !nativeShellReady }, () => {
    for (const [label, modulePath] of Object.entries(sourceModulePaths)) {
        assertNoForbiddenEditorPatterns(readSource(modulePath), label);
    }
});

test('PHASE3-SHELL-008 source files declare the ReactWidget and NavigatableWidgetOpenHandler inheritance path and frontend bindings by source text', { skip: !nativeShellReady }, () => {
    const widgetSource = stripComments(readSource(sourceModulePaths.widget));
    const openHandlerSource = stripComments(readSource(sourceModulePaths.openHandler));
    const frontendSource = stripComments(readSource(sourceModulePaths.frontendModule));

    assert.match(widgetSource, /\bclass\s+DrawioEditorWidget\s+extends\s+ReactWidget\b/, 'DrawioEditorWidget must extend ReactWidget by source text');
    assert.match(
        openHandlerSource,
        /\bclass\s+DrawioEditorOpenHandler\s+extends\s+NavigatableWidgetOpenHandler\b/,
        'DrawioEditorOpenHandler must extend NavigatableWidgetOpenHandler by source text'
    );
    assert.match(frontendSource, /\bbind\(WidgetFactory\)/, 'frontend module must bind a WidgetFactory');
    assert.match(
        frontendSource,
        /\bbind\(OpenHandler\)\.toService\(DrawioEditorOpenHandler\)/,
        'frontend module must bind DrawioEditorOpenHandler as an OpenHandler'
    );
    assert.match(
        frontendSource,
        /\bbind\(FrontendApplicationContribution\)\.toService\(DrawioEditorContribution\)/,
        'frontend module must bind DrawioEditorContribution as a FrontendApplicationContribution'
    );
});

test('PHASE3-SHELL-009 frontend module remains a public ContainerModule and uses only public Theia entry points', { skip: !nativeShellReady }, () => {
    const frontendSource = readSource(sourceModulePaths.frontendModule);
    const compiledFrontendSource = readSource(compiledModulePaths.frontendModule);

    assert.match(frontendSource, /\bexport\s+default\s+new\s+ContainerModule\b/, 'drawio-frontend-module must keep a default ContainerModule export');
    assert.match(compiledFrontendSource, /exports\.default = new inversify_1\.ContainerModule/, 'compiled frontend module must export a ContainerModule');
    assertPublicTheiaImportsOnly(frontendSource, 'drawio-frontend-module.ts');
    assertPublicTheiaImportsOnly(compiledFrontendSource, 'drawio-frontend-module.js');
});

test('PHASE3-SHELL-010 the Phase 3 harness uses only Node built-ins, future compiled drawio modules, and public installed Theia modules', () => {
    const source = fs.readFileSync(__filename, 'utf8');
    const requireSpecifiers = Array.from(source.matchAll(/require\('([^']+)'\)/g), match => match[1]).sort();

    assert.deepEqual(requireSpecifiers, [
        'node:assert/strict',
        'node:fs',
        'node:path',
        'node:test'
    ]);
});
