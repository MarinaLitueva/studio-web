const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const runtimeRoot = path.join(repoRoot, 'drawio-editor', 'runtime');
const packageRoot = path.join(repoRoot, 'drawio-editor');
const manifestPath = path.join(runtimeRoot, 'runtime-manifest.json');
const descriptorPath = path.join(runtimeRoot, 'runtime-artifact.json');
const widgetSourcePath = path.join(packageRoot, 'src', 'browser', 'drawio-editor-widget.tsx');
const compiledWidgetPath = path.join(packageRoot, 'lib', 'browser', 'drawio-editor-widget.js');
const runtimeFrameSourcePath = path.join(packageRoot, 'src', 'browser', 'drawio-runtime-frame.ts');
const compiledDocumentPath = path.join(packageRoot, 'lib', 'common', 'drawio-document.js');
const compiledOpenHandlerPath = path.join(packageRoot, 'lib', 'browser', 'drawio-editor-open-handler.js');
const sourceActivationPath = path.join(packageRoot, 'src', 'node', 'drawio-runtime-activation.ts');
const compiledActivationPath = path.join(packageRoot, 'lib', 'node', 'drawio-runtime-activation.js');
const candidateBundleRoot = path.join(
    packageRoot,
    'lib',
    'runtime',
    'drawio',
    '30.0.4',
    '7c169691c32b046dafe6e9640dd1de952c51f75885fe3e445f730d9c8cdf6a20'
);
const bundleManifestPath = path.join(candidateBundleRoot, 'bundle-manifest.json');
const assetIntegrityPath = path.join(candidateBundleRoot, 'asset-integrity.json');
const packagingReportPath = path.join(candidateBundleRoot, 'packaging-report.json');
const placeholderTokens = ['TO' + 'DO', 'T' + 'BD', 'FIX' + 'ME'];
const allowedLiteralRequires = [
    'node:assert/strict',
    'node:crypto',
    'node:fs',
    'node:os',
    'node:path',
    'node:test',
    'node:vm'
];
const expectedRuntimeVersion = '30.0.4';
const expectedBundleSha256 = '7c169691c32b046dafe6e9640dd1de952c51f75885fe3e445f730d9c8cdf6a20';
const expectedSourceArchive = {
    path: 'runtime/artifacts/draw-30.0.4.war',
    bytes: 52723743,
    sha256: 'cb40abb5f750f549444c94c00de086218b47e30b33fbc4dd0476118afd8ec19d'
};
const expectedPolicy = {
    runtimeVersion: expectedRuntimeVersion,
    maxEntries: 4096,
    maxEntryUncompressedBytes: 33554432,
    maxTotalUncompressedBytes: 201326592,
    maxCompressionRatio: 64
};
const expectedActivationExports = [
    'DRAWIO_RUNTIME_ACTIVATION_VERSION',
    'loadDrawioRuntimeCandidate',
    'auditDrawioRuntimeCompatibility',
    'authorizeDrawioRuntimeActivation'
];
const selectedHashPaths = [
    'clear.html',
    'index.html',
    'connect/common/js/mxReader.js',
    'service-worker.js'
];
const controlMetadataRelativePaths = [
    'bundle-manifest.json',
    'asset-integrity.json',
    'packaging-report.json'
];
const authoritySnapshot = new Map([
    [manifestPath, fs.readFileSync(manifestPath)],
    [descriptorPath, fs.readFileSync(descriptorPath)],
    [bundleManifestPath, fs.readFileSync(bundleManifestPath)],
    [assetIntegrityPath, fs.readFileSync(assetIntegrityPath)],
    [packagingReportPath, fs.readFileSync(packagingReportPath)]
]);

function assertNoPlaceholderMarkers(source, label) {
    for (const token of placeholderTokens) {
        assert.ok(!new RegExp(`\\b${token}\\b`).test(source), `${label} must not contain placeholder markers`);
    }
}

function readText(filePath, label) {
    const source = fs.readFileSync(filePath, 'utf8');
    assertNoPlaceholderMarkers(source, label);
    return source;
}

function readJson(filePath, label) {
    return JSON.parse(readText(filePath, label));
}

function stripComments(source) {
    return source
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^\\])\/\/.*$/gm, '$1');
}

function sha256Hex(value) {
    return crypto.createHash('sha256').update(value).digest('hex');
}

function sha256HexOfFile(filePath) {
    return sha256Hex(fs.readFileSync(filePath));
}

function compareStrings(left, right) {
    if (left === right) {
        return 0;
    }
    return left < right ? -1 : 1;
}

function stableJsonBytes(value) {
    return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function normalizeInventoryEntries(entries) {
    return [...entries]
        .map(entry => ({
            path: entry.path,
            sha256: entry.sha256,
            bytes: entry.bytes
        }))
        .sort((left, right) => compareStrings(left.path, right.path));
}

function normalizeExcludedEntries(entries) {
    return [...entries]
        .map(entry => ({
            path: entry.path,
            reason: entry.reason
        }))
        .sort((left, right) => compareStrings(left.path, right.path));
}

function normalizeMetadataDocument(document, label) {
    const includedEntries = Array.isArray(document.includedEntries)
        ? document.includedEntries
        : document.files;
    assert.ok(Array.isArray(includedEntries), `${label} must expose included inventory`);
    assert.ok(Array.isArray(document.excludedEntries), `${label} must expose excluded inventory`);
    assert.equal(document.runtimeVersion, expectedRuntimeVersion, `${label} runtimeVersion must stay pinned`);
    assert.deepEqual(document.sourceArchive, expectedSourceArchive, `${label} sourceArchive must stay exact`);
    assert.equal(document.bundleSha256, expectedBundleSha256, `${label} bundleSha256 must stay exact`);
    assert.deepEqual(document.policy, expectedPolicy, `${label} policy must stay exact`);
    assert.equal(document.verdict, 'candidate', `${label} verdict must remain candidate`);
    return {
        runtimeVersion: document.runtimeVersion,
        sourceArchive: document.sourceArchive,
        bundleSha256: document.bundleSha256,
        policy: document.policy,
        verdict: document.verdict,
        includedEntries: normalizeInventoryEntries(includedEntries),
        excludedEntries: normalizeExcludedEntries(document.excludedEntries)
    };
}

function assertPortableRelativePath(relativePath, label) {
    assert.equal(typeof relativePath, 'string', `${label} path must be a string`);
    assert.ok(relativePath.length > 0, `${label} path must not be empty`);
    assert.ok(!path.isAbsolute(relativePath), `${label} path must remain relative`);
    assert.ok(!relativePath.includes('\\'), `${label} path must use forward slashes only`);
    for (const segment of relativePath.split('/')) {
        assert.ok(segment.length > 0, `${label} path must not contain empty segments`);
        assert.notEqual(segment, '.', `${label} path must not contain current-directory segments`);
        assert.notEqual(segment, '..', `${label} path must not contain traversal segments`);
    }
}

function collectRealizedBundleRecords(rootPath) {
    const records = [];
    const loweredPaths = new Set();

    function visit(currentPath) {
        const entries = fs.readdirSync(currentPath, { withFileTypes: true })
            .sort((left, right) => compareStrings(left.name, right.name));
        for (const entry of entries) {
            const absolutePath = path.join(currentPath, entry.name);
            const relativePath = path.relative(rootPath, absolutePath).split(path.sep).join('/');
            const stats = fs.lstatSync(absolutePath);
            assert.ok(!stats.isSymbolicLink(), `realized bundle must not contain symlinks: ${relativePath}`);
            if (stats.isDirectory()) {
                visit(absolutePath);
                continue;
            }
            assert.ok(stats.isFile(), `realized bundle entries must be regular files: ${relativePath}`);
            assertPortableRelativePath(relativePath, 'realized bundle');
            const loweredPath = relativePath.toLowerCase();
            assert.ok(!loweredPaths.has(loweredPath), `realized bundle must not contain case-fold collisions: ${relativePath}`);
            loweredPaths.add(loweredPath);
            records.push({ path: relativePath, bytes: stats.size, absolutePath });
        }
    }

    visit(rootPath);
    return records.sort((left, right) => compareStrings(left.path, right.path));
}

function isControlMetadataPath(relativePath) {
    return controlMetadataRelativePaths.includes(relativePath);
}

function requireFreshModule(modulePath) {
    delete require.cache[require.resolve(modulePath)];
    return require(modulePath);
}

function getActivationPreflight() {
    const missingPieces = [];
    if (!fs.existsSync(sourceActivationPath)) {
        missingPieces.push('drawio-editor/src/node/drawio-runtime-activation.ts');
    }
    if (!fs.existsSync(compiledActivationPath)) {
        missingPieces.push('drawio-editor/lib/node/drawio-runtime-activation.js');
    }
    if (missingPieces.length > 0) {
        return {
            ready: false,
            message:
                'DIO-P4D requires the fail-closed activation validator module before implementation-dependent tests can run. Add '
                + `${missingPieces.join(', ')}, export ${expectedActivationExports.join(', ')}, `
                + 'build drawio-editor, and rerun `node --test drawio-editor/tests/phase4d/runtime-activation.acceptance.test.js`.'
        };
    }

    let activationModule;
    try {
        activationModule = requireFreshModule(compiledActivationPath);
    } catch (error) {
        return {
            ready: false,
            message:
                'DIO-P4D activation preflight could not load `drawio-editor/lib/node/drawio-runtime-activation.js`. '
                + `Keep DIO-P4D-001 red until the compiled module loads cleanly and exports ${expectedActivationExports.join(', ')}: `
                + `${error instanceof Error ? error.message : String(error)}`
        };
    }

    const actualExportKeys = Object.keys(activationModule).sort();
    const expectedExportKeys = [...expectedActivationExports].sort();
    if (actualExportKeys.length !== expectedExportKeys.length || actualExportKeys.some((key, index) => key !== expectedExportKeys[index])) {
        return {
            ready: false,
            message:
                'DIO-P4D activation preflight loaded the compiled module, but the public export surface is incomplete or widened. '
                + `Expected exactly ${expectedExportKeys.join(', ')}; found ${actualExportKeys.join(', ')}.`
        };
    }
    if (activationModule.DRAWIO_RUNTIME_ACTIVATION_VERSION !== expectedRuntimeVersion) {
        return {
            ready: false,
            message:
                'DIO-P4D activation preflight loaded the compiled module, but DRAWIO_RUNTIME_ACTIVATION_VERSION is incorrect. '
                + `Expected ${expectedRuntimeVersion}; found ${String(activationModule.DRAWIO_RUNTIME_ACTIVATION_VERSION)}.`
        };
    }

    return {
        ready: true,
        message: undefined,
        module: activationModule,
        exportKeys: actualExportKeys
    };
}

const activationPreflight = getActivationPreflight();
const implementationReady = activationPreflight.ready;

function buildMissingImplementationMessage() {
    return activationPreflight.message;
}

function loadCompiledActivation() {
    assert.ok(implementationReady, activationPreflight.message);
    return activationPreflight.module;
}

function buildChunk(type, data) {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length, 0);
    const name = Buffer.from(type, 'ascii');
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([name, data])), 0);
    return Buffer.concat([length, name, data, crc]);
}

function crc32(buffer) {
    let crc = 0xffffffff;
    for (const byte of buffer) {
        crc ^= byte;
        for (let index = 0; index < 8; index += 1) {
            const mask = -(crc & 1);
            crc = (crc >>> 1) ^ (0xedb88320 & mask);
        }
    }
    return (crc ^ 0xffffffff) >>> 0;
}

function buildMinimalPngBytes() {
    const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
    const ihdr = buildChunk('IHDR', Buffer.from([
        0, 0, 0, 1,
        0, 0, 0, 1,
        8,
        6,
        0,
        0,
        0
    ]));
    const idat = buildChunk('IDAT', Buffer.from([
        0x78, 0x01,
        0x01, 0x05, 0x00, 0xfa, 0xff,
        0x00, 0x00, 0x00, 0x00,
        0x05, 0x00, 0x01
    ]));
    const iend = buildChunk('IEND', Buffer.alloc(0));
    return Buffer.concat([signature, ihdr, idat, iend]);
}

function createXmlBytes() {
    return Buffer.from('<mxfile host="app.diagrams.net"><diagram id="phase4d">ok</diagram></mxfile>', 'utf8');
}

function createSvgBytes() {
    const content = '&lt;mxfile host=&quot;app.diagrams.net&quot;&gt;&lt;diagram id=&quot;phase4d-svg&quot;&gt;ok&lt;/diagram&gt;&lt;/mxfile&gt;';
    return Buffer.from(`<?xml version="1.0" encoding="UTF-8"?><svg xmlns="http://www.w3.org/2000/svg" content="${content}"></svg>`, 'utf8');
}

function loadCompiledDocumentInspector() {
    assert.ok(fs.existsSync(compiledDocumentPath), 'drawio-editor/lib/common/drawio-document.js must exist for current-state scope checks');
    return requireFreshModule(compiledDocumentPath);
}

function loadCompiledOpenHandlerClass() {
    assert.ok(fs.existsSync(compiledOpenHandlerPath), 'drawio-editor/lib/browser/drawio-editor-open-handler.js must exist for current-state scope checks');
    const compiledSource = readText(compiledOpenHandlerPath, 'drawio-editor-open-handler.js');
    class NavigatableWidgetOpenHandler {
        createWidgetOptions(uri, options) {
            return { uri, ...options };
        }
    }
    class DrawioEditorWidget {}
    const stubModules = new Map([
        [
            '@theia/core/shared/inversify',
            {
                injectable() {
                    return target => target;
                }
            }
        ],
        [
            '@theia/core/lib/browser',
            {
                NavigatableWidgetOpenHandler
            }
        ],
        [
            './drawio-editor-widget',
            {
                DrawioEditorWidget
            }
        ]
    ]);
    const module = { exports: {} };
    const sandbox = {
        exports: module.exports,
        module,
        require(specifier) {
            if (!stubModules.has(specifier)) {
                throw new Error(`Unsupported module specifier in Drawio open handler harness: ${specifier}`);
            }
            return stubModules.get(specifier);
        },
        __filename: compiledOpenHandlerPath,
        __dirname: path.dirname(compiledOpenHandlerPath),
        Object,
        Reflect
    };
    vm.runInNewContext(compiledSource, sandbox, {
        filename: compiledOpenHandlerPath
    });
    const DrawioEditorOpenHandler = sandbox.module.exports.DrawioEditorOpenHandler;
    assert.equal(typeof DrawioEditorOpenHandler, 'function', 'DrawioEditorOpenHandler export must be a class/function');
    return DrawioEditorOpenHandler;
}

function createFileLikeUri(basename) {
    return {
        scheme: 'file',
        path: { base: basename }
    };
}

function assertThrows(fn, label) {
    assert.throws(fn, undefined, label);
}

function assertExactSortedKeys(object, expectedKeys, label) {
    assert.deepEqual(Object.keys(object).sort(), [...expectedKeys].sort(), label);
}

function assertBlockedReasons(result, expectedReasons) {
    assert.equal(result.verdict, 'blocked', 'compatibility or activation verdict must remain blocked');
    assert.deepEqual([...result.reasons].sort(), [...expectedReasons].sort());
}

function createPassCompatibility() {
    return {
        verdict: 'pass',
        reasons: []
    };
}

function createActivationAudit(overrides = {}) {
    return {
        verdict: 'approved',
        runtimeVersion: expectedRuntimeVersion,
        bundleSha256: expectedBundleSha256,
        descriptorSha256: 'a'.repeat(64),
        ...overrides
    };
}

function createValidCompatibilityInput() {
    const publishedMetadata = readCurrentNormalizedPublishedMetadata();
    return {
        candidate: {
            runtimeVersion: expectedRuntimeVersion,
            bundleSha256: expectedBundleSha256,
            verdict: 'candidate',
            includedEntries: publishedMetadata.includedEntries
        },
        entrypoint: 'index.html',
        sandbox: ['allow-scripts', 'allow-same-origin'],
        csp: "default-src 'none'; connect-src 'none'; script-src 'self'; style-src 'self'",
        messagingTargets: ['https://runtime.example.com'],
        messagingOrigins: ['https://runtime.example.com'],
        networkOrigins: [],
        networkUrls: [],
        requiresInlineStyle: false,
        requiresInlineScript: false,
        requiresEval: false,
        requiresFunctionConstructor: false
    };
}

function createValidActivationInput() {
    return {
        candidate: {
            runtimeVersion: expectedRuntimeVersion,
            bundleSha256: expectedBundleSha256,
            verdict: 'candidate'
        },
        compatibility: createPassCompatibility(),
        runtimeOrigin: 'https://runtime.example.com',
        studioOrigin: 'https://studio.example.com',
        sandbox: ['allow-scripts', 'allow-same-origin'],
        networkOrigins: [],
        unsafeExceptions: [],
        activationAudit: createActivationAudit()
    };
}

function assertNoExecutableIframeOrRuntimeFrameWiring(source, label) {
    const executableSource = stripComments(source);
    assert.ok(!/\bdrawio-runtime-frame\b/.test(executableSource), `${label} must not reference drawio-runtime-frame before activation`);
    assert.ok(!/<iframe\b/i.test(executableSource), `${label} must not render iframe markup before activation`);
    assert.ok(!/\b(?:document\.)?createElement\(\s*['"]iframe['"]\s*\)/i.test(executableSource), `${label} must not create iframe DOM nodes before activation`);
    assert.ok(!/\bReact\s*\.\s*createElement\(\s*['"]iframe['"]\s*[,)]/i.test(executableSource), `${label} must not create iframe React elements before activation`);
}

function createSyntheticFiles(rootPath, fileMap) {
    const includedEntries = [];
    for (const [relativePath, content] of Object.entries(fileMap)) {
        const absolutePath = path.join(rootPath, ...relativePath.split('/'));
        fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
        const bytes = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
        fs.writeFileSync(absolutePath, bytes);
        includedEntries.push({
            path: relativePath,
            bytes: bytes.length,
            sha256: sha256Hex(bytes)
        });
    }
    return normalizeInventoryEntries(includedEntries);
}

function createSyntheticCandidateDocument(includedEntries, excludedEntries, overrides = {}) {
    return {
        runtimeVersion: expectedRuntimeVersion,
        sourceArchive: expectedSourceArchive,
        bundleSha256: expectedBundleSha256,
        policy: expectedPolicy,
        includedEntries,
        excludedEntries,
        verdict: 'candidate',
        ...overrides
    };
}

function writeSyntheticCandidateMetadata(bundleRoot, options = {}) {
    const files = options.files ?? {
        'index.html': '<!doctype html><html><body>blocked</body></html>',
        'app/main.js': 'console.log("drawio");'
    };
    const includedEntries = options.includedEntries ?? createSyntheticFiles(bundleRoot, files);
    const excludedEntries = options.excludedEntries ?? [
        { path: 'WEB-INF/web.xml', reason: 'excluded:web-inf' }
    ];
    const bundleDocument = createSyntheticCandidateDocument(includedEntries, excludedEntries, options.bundleOverrides);
    const integrityDocument = {
        ...createSyntheticCandidateDocument(includedEntries, excludedEntries, options.integrityOverrides),
        files: includedEntries
    };
    delete integrityDocument.includedEntries;
    const reportDocument = createSyntheticCandidateDocument(includedEntries, excludedEntries, options.reportOverrides);

    const bundleManifestFixturePath = path.join(bundleRoot, 'bundle-manifest.json');
    const assetIntegrityFixturePath = path.join(bundleRoot, 'asset-integrity.json');
    const packagingReportFixturePath = path.join(bundleRoot, 'packaging-report.json');
    fs.writeFileSync(bundleManifestFixturePath, stableJsonBytes(bundleDocument));
    fs.writeFileSync(assetIntegrityFixturePath, stableJsonBytes(integrityDocument));
    fs.writeFileSync(packagingReportFixturePath, stableJsonBytes(reportDocument));

    return {
        bundleRoot,
        bundleManifestPath: bundleManifestFixturePath,
        assetIntegrityPath: assetIntegrityFixturePath,
        packagingReportPath: packagingReportFixturePath
    };
}

function mutateOneMetadataDocument(fixture, documentKey, mutator) {
    const filePath = fixture[documentKey];
    const document = readJson(filePath, path.basename(filePath));
    mutator(document);
    fs.writeFileSync(filePath, stableJsonBytes(document));
}

function cloneStatsWithTimes(stats, { mtimeMs, ctimeMs }) {
    return Object.assign(
        Object.create(Object.getPrototypeOf(stats)),
        stats,
        { mtimeMs, ctimeMs }
    );
}

function readCurrentNormalizedPublishedMetadata() {
    return normalizeMetadataDocument(readJson(bundleManifestPath, 'bundle-manifest.json'), 'bundle-manifest.json');
}

test('DIO-P4D-001 bootstrap: phase contract stays red until the activation validator implementation exists and is built', () => {
    assert.ok(implementationReady, buildMissingImplementationMessage());
});

test('DIO-P4D-002 harness: uses only Node built-ins, stays placeholder-free, and remains directly runnable under node --test', () => {
    const source = readText(__filename, 'phase4d harness');
    const literalRequires = Array.from(source.matchAll(/require\('([^']+)'\)/g), match => match[1]).sort();
    assert.deepEqual(literalRequires, allowedLiteralRequires);
});

test('DIO-P4D-003 current-state: metadata trio agrees on candidate identity while blocked compatibility and activation remain separate', () => {
    const manifest = readJson(manifestPath, 'runtime-manifest.json');
    const descriptor = readJson(descriptorPath, 'runtime-artifact.json');
    const normalizedBundleManifest = normalizeMetadataDocument(readJson(bundleManifestPath, 'bundle-manifest.json'), 'bundle-manifest.json');
    const normalizedAssetIntegrity = normalizeMetadataDocument(readJson(assetIntegrityPath, 'asset-integrity.json'), 'asset-integrity.json');
    const normalizedPackagingReport = normalizeMetadataDocument(readJson(packagingReportPath, 'packaging-report.json'), 'packaging-report.json');

    assert.deepEqual(normalizedBundleManifest, normalizedAssetIntegrity);
    assert.deepEqual(normalizedBundleManifest, normalizedPackagingReport);
    assert.equal(manifest.runtimeVersion, expectedRuntimeVersion);
    assert.equal(descriptor.runtimeVersion, expectedRuntimeVersion);
    assert.equal(manifest.entrypoint, 'blocked.html');
    assert.equal(manifest.compatibility.status, 'blocked');
    assert.equal(manifest.provenance.usability, 'blocked');
    assert.equal(descriptor.lifecycle.status, 'blocked');
    assert.equal(descriptor.security.phase0HostSecurityGate.formallyActivated, false);
    assert.equal(Object.prototype.hasOwnProperty.call(descriptor.security, 'activationAudit'), false);
    assert.deepEqual(descriptor.retainedArtifact, {
        path: 'artifacts/draw-30.0.4.war',
        sha256: expectedSourceArchive.sha256
    });
    assert.deepEqual(normalizedBundleManifest.sourceArchive, expectedSourceArchive);
});

test('DIO-P4D-004 current-state: realized candidate tree matches recorded paths and bytes exactly, with fixed sample hashes', () => {
    const metadata = normalizeMetadataDocument(readJson(assetIntegrityPath, 'asset-integrity.json'), 'asset-integrity.json');
    const realizedRecords = collectRealizedBundleRecords(candidateBundleRoot).filter(record => !isControlMetadataPath(record.path));
    const expectedRecords = metadata.includedEntries
        .map(entry => ({ path: entry.path, bytes: entry.bytes }))
        .sort((left, right) => compareStrings(left.path, right.path));

    assert.deepEqual(
        realizedRecords.map(record => ({ path: record.path, bytes: record.bytes })),
        expectedRecords,
        'realized bundle path set and byte counts must match the integrity inventory exactly'
    );

    for (const controlMetadataPath of controlMetadataRelativePaths) {
        assert.ok(
            fs.existsSync(path.join(candidateBundleRoot, controlMetadataPath)),
            `required control metadata file must exist at bundle root: ${controlMetadataPath}`
        );
        assert.ok(
            !metadata.includedEntries.some(entry => entry.path === controlMetadataPath),
            `control metadata file must not be treated as a runtime inventory entry: ${controlMetadataPath}`
        );
    }

    const expectedByPath = new Map(metadata.includedEntries.map(entry => [entry.path, entry]));
    for (const relativePath of selectedHashPaths) {
        const expected = expectedByPath.get(relativePath);
        assert.ok(expected, `selected hash fixture must exist in metadata: ${relativePath}`);
        assert.equal(
            sha256HexOfFile(path.join(candidateBundleRoot, ...relativePath.split('/'))),
            expected.sha256,
            `selected file hash must match metadata: ${relativePath}`
        );
    }
});

test('DIO-P4D-005 current-state: blocked authority, iframe-free widget wiring, and mandatory Draw.io document scope remain intact', () => {
    const manifest = readJson(manifestPath, 'runtime-manifest.json');
    const descriptor = readJson(descriptorPath, 'runtime-artifact.json');
    const widgetSource = readText(widgetSourcePath, 'drawio-editor-widget.tsx');
    const compiledWidgetSource = readText(compiledWidgetPath, 'drawio-editor-widget.js');
    const frameSource = readText(runtimeFrameSourcePath, 'drawio-runtime-frame.ts');
    const { inspectDrawioDocument } = loadCompiledDocumentInspector();
    const DrawioEditorOpenHandler = loadCompiledOpenHandlerClass();
    const openHandler = new DrawioEditorOpenHandler();

    assert.equal(manifest.entrypoint, 'blocked.html');
    assert.equal(manifest.compatibility.status, 'blocked');
    assert.equal(manifest.provenance.usability, 'blocked');
    assert.equal(descriptor.lifecycle.status, 'blocked');
    assert.equal(descriptor.security.phase0HostSecurityGate.formallyActivated, false);
    assert.equal(Object.prototype.hasOwnProperty.call(descriptor.security, 'activationAudit'), false);

    assert.equal(inspectDrawioDocument('diagram.drawio', createXmlBytes()).mode, 'editable');
    assert.equal(inspectDrawioDocument('diagram.dio', createXmlBytes()).mode, 'editable');
    assert.equal(inspectDrawioDocument('diagram.drawio.svg', createSvgBytes()).mode, 'editable');
    assert.equal(inspectDrawioDocument('diagram.drawio.png', buildMinimalPngBytes()).mode, 'preview-only');
    assertThrows(() => inspectDrawioDocument('diagram.svg', createSvgBytes()), 'generic .svg must remain outside Draw.io scope');
    assertThrows(() => inspectDrawioDocument('diagram.png', buildMinimalPngBytes()), 'generic .png must remain outside Draw.io scope');

    assert.equal(openHandler.canHandle(createFileLikeUri('diagram.drawio')), 600);
    assert.equal(openHandler.canHandle(createFileLikeUri('diagram.dio')), 600);
    assert.equal(openHandler.canHandle(createFileLikeUri('diagram.drawio.svg')), 600);
    assert.equal(openHandler.canHandle(createFileLikeUri('diagram.drawio.png')), 600);
    assert.equal(openHandler.canHandle(createFileLikeUri('diagram.svg')), 0);
    assert.equal(openHandler.canHandle(createFileLikeUri('diagram.png')), 0);
    assert.equal(openHandler.canHandle({ scheme: 'http', path: { base: 'diagram.drawio' } }), 0);

    assertNoExecutableIframeOrRuntimeFrameWiring(widgetSource, 'drawio-editor-widget.tsx');
    assertNoExecutableIframeOrRuntimeFrameWiring(compiledWidgetSource, 'drawio-editor-widget.js');
    assert.ok(frameSource.includes('postMessage'), 'runtime frame message seam must remain isolated to the dedicated browser boundary module');
});

test('DIO-P4D-007 implementation: compiled activation module exports the exact contract and loads the published candidate summary', { skip: !implementationReady }, () => {
    const activation = loadCompiledActivation();
    const publishedMetadata = readCurrentNormalizedPublishedMetadata();

    assertExactSortedKeys(activation, expectedActivationExports, 'activation module must export exactly the documented public contract');

    const candidate = activation.loadDrawioRuntimeCandidate({
        bundleRoot: candidateBundleRoot,
        bundleManifestPath,
        assetIntegrityPath,
        packagingReportPath
    });

    assert.equal(candidate.runtimeVersion, expectedRuntimeVersion);
    assert.equal(candidate.bundleSha256, expectedBundleSha256);
    assert.equal(candidate.verdict, 'candidate');
    assert.deepEqual(candidate.sourceArchive, expectedSourceArchive);
    assert.deepEqual(candidate.policy, expectedPolicy);
    assert.deepEqual(normalizeInventoryEntries(candidate.includedEntries), publishedMetadata.includedEntries);
    assert.deepEqual(normalizeExcludedEntries(candidate.excludedEntries), publishedMetadata.excludedEntries);
});

test('DIO-P4D-008 implementation: synthetic fixtures reject missing, extra, symlink, traversal, duplicate, case-fold, hash, size, and metadata drift failures', { skip: !implementationReady }, () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'drawio-phase4d-'));

    try {
        {
            const bundleRoot = path.join(tempRoot, 'missing');
            fs.mkdirSync(bundleRoot, { recursive: true });
            const fixture = writeSyntheticCandidateMetadata(bundleRoot);
            fs.rmSync(path.join(bundleRoot, 'app', 'main.js'));
            assertThrows(() => loadCompiledActivation().loadDrawioRuntimeCandidate(fixture), 'missing runtime file must reject');
        }

        {
            const bundleRoot = path.join(tempRoot, 'extra');
            fs.mkdirSync(bundleRoot, { recursive: true });
            const fixture = writeSyntheticCandidateMetadata(bundleRoot);
            fs.writeFileSync(path.join(bundleRoot, 'extra.txt'), 'extra');
            assertThrows(() => loadCompiledActivation().loadDrawioRuntimeCandidate(fixture), 'extra runtime file must reject');
        }

        {
            const bundleRoot = path.join(tempRoot, 'symlink');
            fs.mkdirSync(bundleRoot, { recursive: true });
            const fixture = writeSyntheticCandidateMetadata(bundleRoot);
            fs.symlinkSync(path.join(bundleRoot, 'index.html'), path.join(bundleRoot, 'linked-index.html'));
            assertThrows(() => loadCompiledActivation().loadDrawioRuntimeCandidate(fixture), 'symlink runtime file must reject');
        }

        {
            const bundleRoot = path.join(tempRoot, 'traversal');
            fs.mkdirSync(bundleRoot, { recursive: true });
            const fixture = writeSyntheticCandidateMetadata(bundleRoot, {
                includedEntries: normalizeInventoryEntries([
                    { path: '../escape.js', bytes: 4, sha256: sha256Hex(Buffer.from('evil')) }
                ])
            });
            assertThrows(() => loadCompiledActivation().loadDrawioRuntimeCandidate(fixture), 'traversal inventory path must reject');
        }

        {
            const bundleRoot = path.join(tempRoot, 'duplicate');
            fs.mkdirSync(bundleRoot, { recursive: true });
            createSyntheticFiles(bundleRoot, { 'index.html': 'a' });
            const fixture = writeSyntheticCandidateMetadata(bundleRoot, {
                includedEntries: normalizeInventoryEntries([
                    { path: 'index.html', bytes: 1, sha256: sha256Hex(Buffer.from('a')) },
                    { path: 'index.html', bytes: 1, sha256: sha256Hex(Buffer.from('a')) }
                ])
            });
            assertThrows(() => loadCompiledActivation().loadDrawioRuntimeCandidate(fixture), 'duplicate inventory path must reject');
        }

        {
            const bundleRoot = path.join(tempRoot, 'case-fold');
            fs.mkdirSync(bundleRoot, { recursive: true });
            createSyntheticFiles(bundleRoot, { 'index.html': 'a' });
            const fixture = writeSyntheticCandidateMetadata(bundleRoot, {
                includedEntries: normalizeInventoryEntries([
                    { path: 'Index.html', bytes: 1, sha256: sha256Hex(Buffer.from('a')) },
                    { path: 'index.html', bytes: 1, sha256: sha256Hex(Buffer.from('a')) }
                ])
            });
            assertThrows(() => loadCompiledActivation().loadDrawioRuntimeCandidate(fixture), 'case-fold inventory collision must reject');
        }

        {
            const bundleRoot = path.join(tempRoot, 'wrong-hash');
            fs.mkdirSync(bundleRoot, { recursive: true });
            const fixture = writeSyntheticCandidateMetadata(bundleRoot);
            mutateOneMetadataDocument(fixture, 'bundleManifestPath', document => {
                document.includedEntries[0].sha256 = '0'.repeat(64);
            });
            assertThrows(() => loadCompiledActivation().loadDrawioRuntimeCandidate(fixture), 'wrong runtime hash must reject');
        }

        {
            const bundleRoot = path.join(tempRoot, 'wrong-size');
            fs.mkdirSync(bundleRoot, { recursive: true });
            const fixture = writeSyntheticCandidateMetadata(bundleRoot);
            mutateOneMetadataDocument(fixture, 'assetIntegrityPath', document => {
                document.files[0].bytes += 1;
            });
            assertThrows(() => loadCompiledActivation().loadDrawioRuntimeCandidate(fixture), 'wrong runtime size must reject');
        }

        {
            const bundleRoot = path.join(tempRoot, 'root-replacement');
            fs.mkdirSync(bundleRoot, { recursive: true });
            const fixture = writeSyntheticCandidateMetadata(bundleRoot);
            const replacementRoot = path.join(tempRoot, 'root-replacement-next');
            fs.cpSync(bundleRoot, replacementRoot, { recursive: true, preserveTimestamps: true });
            const displacedRoot = path.join(tempRoot, 'root-replacement-old');
            const originalOpenSync = fs.openSync;
            const originalLstatSync = fs.lstatSync;
            let rootPinned = false;
            let swapped = false;
            fs.openSync = function patchedOpenSync(filePath, ...rest) {
                if (path.resolve(filePath) === path.resolve(bundleRoot)) {
                    rootPinned = true;
                }
                return originalOpenSync.call(this, filePath, ...rest);
            };
            fs.lstatSync = function patchedLstatSync(filePath, ...rest) {
                if (rootPinned && !swapped && path.resolve(filePath) === path.resolve(bundleRoot)) {
                    swapped = true;
                    fs.renameSync(bundleRoot, displacedRoot);
                    fs.renameSync(replacementRoot, bundleRoot);
                }
                return originalLstatSync.call(this, filePath, ...rest);
            };
            try {
                assertThrows(
                    () => loadCompiledActivation().loadDrawioRuntimeCandidate(fixture),
                    'root replacement must reject'
                );
            } finally {
                fs.openSync = originalOpenSync;
                fs.lstatSync = originalLstatSync;
            }
        }

        {
            const bundleRoot = path.join(tempRoot, 'metadata-same-size-rewrite');
            fs.mkdirSync(bundleRoot, { recursive: true });
            const fixture = writeSyntheticCandidateMetadata(bundleRoot);
            const originalBytes = fs.readFileSync(fixture.bundleManifestPath);
            const staleDocument = readJson(fixture.bundleManifestPath, 'bundle-manifest.json');
            staleDocument.runtimeVersion = '30.0.5';
            const staleBytes = stableJsonBytes(staleDocument);
            assert.equal(staleBytes.length, originalBytes.length, 'metadata same-size rewrite fixture must preserve byte length');
            const originalLstatSync = fs.lstatSync;
            const originalFstatSync = fs.fstatSync;
            const originalOpenSync = fs.openSync;
            const originalReaddirSync = fs.readdirSync;
            const originalStats = fs.lstatSync(fixture.bundleManifestPath);
            const manifestFds = new Set();
            let rewritten = false;
            fs.openSync = function patchedOpenSync(filePath, ...rest) {
                const fd = originalOpenSync.call(this, filePath, ...rest);
                if (path.resolve(filePath) === path.resolve(fixture.bundleManifestPath)) {
                    manifestFds.add(fd);
                }
                return fd;
            };
            fs.lstatSync = function patchedLstatSync(filePath, ...rest) {
                const stats = originalLstatSync.call(this, filePath, ...rest);
                if (path.resolve(filePath) === path.resolve(fixture.bundleManifestPath)) {
                    return cloneStatsWithTimes(stats, originalStats);
                }
                return stats;
            };
            fs.fstatSync = function patchedFstatSync(fd, ...rest) {
                const stats = originalFstatSync.call(this, fd, ...rest);
                if (manifestFds.has(fd)) {
                    return cloneStatsWithTimes(stats, originalStats);
                }
                return stats;
            };
            fs.readdirSync = function patchedReaddirSync(filePath, ...rest) {
                if (!rewritten && path.resolve(filePath) === path.resolve(bundleRoot)) {
                    rewritten = true;
                    fs.writeFileSync(fixture.bundleManifestPath, staleBytes);
                }
                return originalReaddirSync.call(this, filePath, ...rest);
            };
            try {
                assertThrows(
                    () => loadCompiledActivation().loadDrawioRuntimeCandidate(fixture),
                    'metadata same-size rewrite must reject on identity change'
                );
            } finally {
                fs.openSync = originalOpenSync;
                fs.lstatSync = originalLstatSync;
                fs.fstatSync = originalFstatSync;
                fs.readdirSync = originalReaddirSync;
            }
        }

        {
            const bundleRoot = path.join(tempRoot, 'runtime-identity-change');
            fs.mkdirSync(bundleRoot, { recursive: true });
            const fixture = writeSyntheticCandidateMetadata(bundleRoot);
            const targetRuntimePath = path.join(bundleRoot, 'index.html');
            const canonicalTargetRuntimePath = fs.realpathSync.native(targetRuntimePath);
            const originalOpenSync = fs.openSync;
            let swapped = false;
            fs.openSync = function patchedOpenSync(filePath, ...rest) {
                const canonicalFilePath = fs.realpathSync.native(path.resolve(filePath));
                if (!swapped && canonicalFilePath === canonicalTargetRuntimePath) {
                    swapped = true;
                    fs.openSync = originalOpenSync;
                    const replacementPath = `${targetRuntimePath}.replacement`;
                    fs.renameSync(targetRuntimePath, replacementPath);
                    fs.writeFileSync(targetRuntimePath, '<!doctype html><html><body>tampered</body></html>');
                    fs.openSync = patchedOpenSync;
                }
                return originalOpenSync.call(this, filePath, ...rest);
            };
            try {
                assertThrows(
                    () => loadCompiledActivation().loadDrawioRuntimeCandidate(fixture),
                    'runtime identity swap must reject'
                );
            } finally {
                fs.openSync = originalOpenSync;
            }
        }

        {
            const bundleRoot = path.join(tempRoot, 'runtime-same-size-rewrite');
            fs.mkdirSync(bundleRoot, { recursive: true });
            const fixture = writeSyntheticCandidateMetadata(bundleRoot);
            const targetRuntimePath = path.join(bundleRoot, 'app', 'main.js');
            const triggerRuntimePath = path.join(bundleRoot, 'index.html');
            const canonicalTriggerRuntimePath = fs.realpathSync.native(triggerRuntimePath);
            const originalBytes = fs.readFileSync(targetRuntimePath);
            const rewrittenBytes = Buffer.from(originalBytes.toString('utf8').replace('drawio', 'mirror'), 'utf8');
            assert.equal(rewrittenBytes.length, originalBytes.length, 'runtime same-size rewrite fixture must preserve byte length');
            const originalOpenSync = fs.openSync;
            const originalLstatSync = fs.lstatSync;
            const originalFstatSync = fs.fstatSync;
            const originalStats = fs.lstatSync(targetRuntimePath);
            const targetFds = new Set();
            let rewritten = false;
            fs.openSync = function patchedOpenSync(filePath, ...rest) {
                const fd = originalOpenSync.call(this, filePath, ...rest);
                const canonicalFilePath = fs.realpathSync.native(path.resolve(filePath));
                if (path.resolve(filePath) === path.resolve(targetRuntimePath)) {
                    targetFds.add(fd);
                }
                if (!rewritten && canonicalFilePath === canonicalTriggerRuntimePath) {
                    rewritten = true;
                    fs.writeFileSync(targetRuntimePath, rewrittenBytes);
                }
                return fd;
            };
            fs.lstatSync = function patchedLstatSync(filePath, ...rest) {
                const stats = originalLstatSync.call(this, filePath, ...rest);
                if (path.resolve(filePath) === path.resolve(targetRuntimePath)) {
                    return cloneStatsWithTimes(stats, originalStats);
                }
                return stats;
            };
            fs.fstatSync = function patchedFstatSync(fd, ...rest) {
                const stats = originalFstatSync.call(this, fd, ...rest);
                if (targetFds.has(fd)) {
                    return cloneStatsWithTimes(stats, originalStats);
                }
                return stats;
            };
            try {
                assertThrows(
                    () => loadCompiledActivation().loadDrawioRuntimeCandidate(fixture),
                    'runtime same-size rewrite must reject on identity change'
                );
            } finally {
                fs.openSync = originalOpenSync;
                fs.lstatSync = originalLstatSync;
                fs.fstatSync = originalFstatSync;
            }
        }

        for (const driftCase of [
            {
                name: 'runtime-version-drift',
                documentKey: 'packagingReportPath',
                mutate(document) { document.runtimeVersion = '30.0.5'; }
            },
            {
                name: 'runtime-version-whitespace',
                documentKey: 'packagingReportPath',
                mutate(document) { document.runtimeVersion = ' 30.0.4'; }
            },
            {
                name: 'source-archive-drift',
                documentKey: 'bundleManifestPath',
                mutate(document) { document.sourceArchive.sha256 = '1'.repeat(64); }
            },
            {
                name: 'source-archive-path-whitespace',
                documentKey: 'bundleManifestPath',
                mutate(document) { document.sourceArchive.path = ` ${expectedSourceArchive.path}`; }
            },
            {
                name: 'bundle-sha-drift',
                documentKey: 'assetIntegrityPath',
                mutate(document) { document.bundleSha256 = '2'.repeat(64); }
            },
            {
                name: 'bundle-sha-uppercase',
                documentKey: 'assetIntegrityPath',
                mutate(document) { document.bundleSha256 = expectedBundleSha256.toUpperCase(); }
            },
            {
                name: 'policy-drift',
                documentKey: 'packagingReportPath',
                mutate(document) { document.policy.maxEntries += 1; }
            },
            {
                name: 'included-inventory-drift',
                documentKey: 'bundleManifestPath',
                mutate(document) { document.includedEntries[0].bytes += 1; }
            },
            {
                name: 'included-inventory-path-whitespace',
                documentKey: 'bundleManifestPath',
                mutate(document) { document.includedEntries[0].path = ` ${document.includedEntries[0].path}`; }
            },
            {
                name: 'excluded-inventory-drift',
                documentKey: 'assetIntegrityPath',
                mutate(document) { document.excludedEntries[0].reason = 'excluded:changed'; }
            },
            {
                name: 'excluded-inventory-path-whitespace',
                documentKey: 'assetIntegrityPath',
                mutate(document) { document.excludedEntries[0].path = ` ${document.excludedEntries[0].path}`; }
            },
            {
                name: 'verdict-drift',
                documentKey: 'packagingReportPath',
                mutate(document) { document.verdict = 'approved'; }
            }
        ]) {
            const bundleRoot = path.join(tempRoot, driftCase.name);
            fs.mkdirSync(bundleRoot, { recursive: true });
            const fixture = writeSyntheticCandidateMetadata(bundleRoot);
            mutateOneMetadataDocument(fixture, driftCase.documentKey, driftCase.mutate);
            assertThrows(() => loadCompiledActivation().loadDrawioRuntimeCandidate(fixture), `${driftCase.name} must reject`);
        }
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
});

test('DIO-P4D-009 implementation: compatibility audit blocks unsafe requirements with normalized reasons and passes only for a fully constrained candidate', { skip: !implementationReady }, () => {
    const activation = loadCompiledActivation();
    const passed = activation.auditDrawioRuntimeCompatibility(createValidCompatibilityInput());
    assert.equal(passed.verdict, 'pass');
    assert.deepEqual(passed.reasons, []);

    for (const hazardCase of [
        {
            expectedReason: 'inline-style-required',
            apply(input) { input.requiresInlineStyle = true; }
        },
        {
            expectedReason: 'inline-script-required',
            apply(input) { input.requiresInlineScript = true; }
        },
        {
            expectedReason: 'eval-required',
            apply(input) { input.requiresEval = true; }
        },
        {
            expectedReason: 'function-constructor-required',
            apply(input) { input.requiresFunctionConstructor = true; }
        },
        {
            expectedReason: 'network-origin-required',
            apply(input) { input.networkOrigins = ['https://api.example.com']; }
        },
        {
            expectedReason: 'network-origin-required',
            apply(input) { input.networkOrigins = 'https://api.example.com'; }
        },
        {
            expectedReason: 'network-origin-required',
            apply(input) { input.networkOrigins = ['https://api.example.com', 7]; }
        },
        {
            expectedReason: 'network-url-required',
            apply(input) { input.networkUrls = ['https://cdn.example.com/app.js']; }
        },
        {
            expectedReason: 'network-url-required',
            apply(input) { input.networkUrls = { href: 'https://cdn.example.com/app.js' }; }
        },
        {
            expectedReason: 'network-url-required',
            apply(input) { input.networkUrls = ['https://cdn.example.com/app.js', false]; }
        },
        {
            expectedReason: 'wildcard-message-target',
            apply(input) { input.messagingTargets = ['*']; }
        },
        {
            expectedReason: 'wildcard-message-target',
            apply(input) { input.messagingTargets = []; }
        },
        {
            expectedReason: 'wildcard-message-target',
            apply(input) { input.messagingTargets = 'https://runtime.example.com'; }
        },
        {
            expectedReason: 'wildcard-message-target',
            apply(input) { input.messagingTargets = ['https://runtime.example.com', 1]; }
        },
        {
            expectedReason: 'wildcard-message-target',
            apply(input) { input.messagingTargets = ['']; }
        },
        {
            expectedReason: 'wildcard-message-target',
            apply(input) { input.messagingTargets = [' https://runtime.example.com']; }
        },
        {
            expectedReason: 'wildcard-message-target',
            apply(input) { input.messagingTargets = ['https://runtime.example.com/path']; }
        },
        {
            expectedReason: 'wildcard-message-target',
            apply(input) { input.messagingTargets = ['https://runtime.example.com?x=1']; }
        },
        {
            expectedReason: 'wildcard-message-target',
            apply(input) { input.messagingTargets = ['https://user:pass@runtime.example.com']; }
        },
        {
            expectedReason: 'wildcard-message-target',
            apply(input) { input.messagingTargets = ['https://*.example.com']; }
        },
        {
            expectedReason: 'wildcard-message-target',
            apply(input) { input.messagingTargets = ['https://{tenant}.example.com']; }
        },
        {
            expectedReason: 'wildcard-message-target',
            apply(input) { input.messagingTargets = ['https://runtime.example.com:443']; }
        },
        {
            expectedReason: 'wildcard-message-origin',
            apply(input) { input.messagingOrigins = ['*']; }
        },
        {
            expectedReason: 'wildcard-message-origin',
            apply(input) { input.messagingOrigins = []; }
        },
        {
            expectedReason: 'wildcard-message-origin',
            apply(input) { input.messagingOrigins = { origin: 'https://runtime.example.com' }; }
        },
        {
            expectedReason: 'wildcard-message-origin',
            apply(input) { input.messagingOrigins = ['https://runtime.example.com', null]; }
        },
        {
            expectedReason: 'wildcard-message-origin',
            apply(input) { input.messagingOrigins = ['']; }
        },
        {
            expectedReason: 'wildcard-message-origin',
            apply(input) { input.messagingOrigins = [' https://runtime.example.com']; }
        },
        {
            expectedReason: 'wildcard-message-origin',
            apply(input) { input.messagingOrigins = ['https://runtime.example.com/path']; }
        },
        {
            expectedReason: 'wildcard-message-origin',
            apply(input) { input.messagingOrigins = ['https://runtime.example.com?x=1']; }
        },
        {
            expectedReason: 'wildcard-message-origin',
            apply(input) { input.messagingOrigins = ['https://user:pass@runtime.example.com']; }
        },
        {
            expectedReason: 'wildcard-message-origin',
            apply(input) { input.messagingOrigins = ['https://*.example.com']; }
        },
        {
            expectedReason: 'wildcard-message-origin',
            apply(input) { input.messagingOrigins = ['https://{tenant}.example.com']; }
        },
        {
            expectedReason: 'wildcard-message-origin',
            apply(input) { input.messagingOrigins = ['https://runtime.example.com:443']; }
        },
        {
            expectedReason: 'disallowed-sandbox-token',
            apply(input) { input.sandbox = ['allow-scripts', 'allow-same-origin', 'allow-popups']; }
        },
        {
            expectedReason: 'unsafe-csp-exception',
            apply(input) { input.csp = "default-src 'none'; connect-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self'"; }
        },
        {
            expectedReason: 'invalid-entrypoint',
            apply(input) { input.entrypoint = ''; }
        },
        {
            expectedReason: 'invalid-entrypoint',
            apply(input) { input.entrypoint = 'missing.html'; }
        },
        {
            expectedReason: 'invalid-entrypoint',
            apply(input) { input.entrypoint = './index.html'; }
        },
        {
            expectedReason: 'invalid-entrypoint',
            apply(input) { input.entrypoint = 'dir/../index.html'; }
        },
        {
            expectedReason: 'invalid-entrypoint',
            apply(input) { input.entrypoint = ' index.html'; }
        },
        {
            expectedReason: 'invalid-entrypoint',
            apply(input) { input.entrypoint = 'index.html '; }
        },
        {
            expectedReason: 'invalid-entrypoint',
            apply(input) {
                input.entrypoint = 'Index.html';
                input.candidate = {
                    ...input.candidate,
                    includedEntries: [{ path: 'index.html' }]
                };
            }
        }
    ]) {
        const input = createValidCompatibilityInput();
        hazardCase.apply(input);
        const blocked = activation.auditDrawioRuntimeCompatibility(input);
        assertBlockedReasons(blocked, [hazardCase.expectedReason]);
    }
});

test('DIO-P4D-010 implementation: formal activation requires exact identity, compatibility pass, distinct origins, exact sandbox, and explicit approved audit metadata', { skip: !implementationReady }, () => {
    const activation = loadCompiledActivation();
    const passed = activation.authorizeDrawioRuntimeActivation(createValidActivationInput());
    assert.equal(passed.verdict, 'pass');
    assert.deepEqual(passed.reasons, []);

    for (const invalidCase of [
        {
            expectedReasons: ['candidate-verdict-not-candidate'],
            apply(input) { input.candidate = { ...input.candidate, verdict: 'approved' }; }
        },
        {
            expectedReasons: ['compatibility-not-pass'],
            apply(input) { input.compatibility = { verdict: 'blocked', reasons: ['inline-style-required'] }; }
        },
        {
            expectedReasons: ['invalid-runtime-origin'],
            apply(input) { input.runtimeOrigin = 'ftp://runtime.example.com'; }
        },
        {
            expectedReasons: ['invalid-runtime-origin'],
            apply(input) { input.runtimeOrigin = 'https://runtime.example.com/path'; }
        },
        {
            expectedReasons: ['invalid-runtime-origin'],
            apply(input) { input.runtimeOrigin = 'https://user:pass@runtime.example.com'; }
        },
        {
            expectedReasons: ['invalid-runtime-origin'],
            apply(input) { input.runtimeOrigin = 'https://*.example.com'; }
        },
        {
            expectedReasons: ['invalid-runtime-origin'],
            apply(input) { input.runtimeOrigin = 'https://{runtime}.example.com'; }
        },
        {
            expectedReasons: ['invalid-runtime-origin'],
            apply(input) { input.runtimeOrigin = ' https://runtime.example.com'; }
        },
        {
            expectedReasons: ['invalid-runtime-origin'],
            apply(input) { input.runtimeOrigin = 'HTTPS://runtime.example.com'; }
        },
        {
            expectedReasons: ['invalid-studio-origin'],
            apply(input) { input.studioOrigin = 'file://studio.example.com'; }
        },
        {
            expectedReasons: ['invalid-studio-origin'],
            apply(input) { input.studioOrigin = ' https://studio.example.com'; }
        },
        {
            expectedReasons: ['origins-not-distinct'],
            apply(input) { input.studioOrigin = input.runtimeOrigin; }
        },
        {
            expectedReasons: ['sandbox-mismatch'],
            apply(input) { input.sandbox = ['allow-scripts']; }
        },
        {
            expectedReasons: ['sandbox-mismatch'],
            apply(input) { input.sandbox = ['allow-scripts', 'allow-same-origin', 'allow-popups']; }
        },
        {
            expectedReasons: ['network-origins-not-empty'],
            apply(input) { input.networkOrigins = ['https://api.example.com']; }
        },
        {
            expectedReasons: ['unsafe-exceptions-not-empty'],
            apply(input) { input.unsafeExceptions = ['unsafe-inline']; }
        },
        {
            expectedReasons: ['activation-audit-missing'],
            apply(input) { delete input.activationAudit; }
        },
        {
            expectedReasons: ['activation-audit-not-approved'],
            apply(input) { input.activationAudit = createActivationAudit({ verdict: 'rejected' }); }
        },
        {
            expectedReasons: ['activation-audit-runtime-version-mismatch'],
            apply(input) { input.activationAudit = createActivationAudit({ runtimeVersion: '30.0.5' }); }
        },
        {
            expectedReasons: ['activation-audit-runtime-version-mismatch'],
            apply(input) { delete input.candidate.runtimeVersion; }
        },
        {
            expectedReasons: ['activation-audit-runtime-version-mismatch'],
            apply(input) { input.candidate.runtimeVersion = '30.0.5'; }
        },
        {
            expectedReasons: ['activation-audit-runtime-version-mismatch'],
            apply(input) { input.candidate.runtimeVersion = '30.0.4 '; }
        },
        {
            expectedReasons: ['activation-audit-bundle-sha-mismatch'],
            apply(input) { input.activationAudit = createActivationAudit({ bundleSha256: '0'.repeat(64) }); }
        },
        {
            expectedReasons: ['activation-audit-bundle-sha-mismatch'],
            apply(input) { delete input.candidate.bundleSha256; }
        },
        {
            expectedReasons: ['activation-audit-bundle-sha-mismatch'],
            apply(input) { input.candidate.bundleSha256 = expectedBundleSha256.toUpperCase(); }
        },
        {
            expectedReasons: ['activation-audit-bundle-sha-mismatch'],
            apply(input) { input.candidate.bundleSha256 = ` ${expectedBundleSha256}`; }
        },
        {
            expectedReasons: ['activation-audit-bundle-sha-mismatch'],
            apply(input) { input.activationAudit = createActivationAudit({ bundleSha256: expectedBundleSha256.toUpperCase() }); }
        }
    ]) {
        const input = createValidActivationInput();
        invalidCase.apply(input);
        const blocked = activation.authorizeDrawioRuntimeActivation(input);
        assertBlockedReasons(blocked, invalidCase.expectedReasons);
    }
});

test('DIO-P4D-006 current-state: authority and candidate metadata bytes remain unchanged after all earlier tests run', () => {
    for (const [filePath, beforeBytes] of authoritySnapshot.entries()) {
        const afterBytes = fs.readFileSync(filePath);
        assert.deepEqual(afterBytes, beforeBytes, `${path.relative(repoRoot, filePath)} bytes must remain unchanged`);
    }
});
