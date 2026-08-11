const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const runtimeRoot = path.join(repoRoot, 'drawio-editor', 'runtime');
const manifestPath = path.join(runtimeRoot, 'runtime-manifest.json');
const descriptorPath = path.join(runtimeRoot, 'runtime-artifact.json');
const warPath = path.join(runtimeRoot, 'artifacts', 'draw-30.0.4.war');
const extensionPackageJsonPath = path.join(repoRoot, 'drawio-editor', 'package.json');
const workspacePackageJsonPath = path.join(repoRoot, 'package.json');
const sourcePackagerPath = path.join(repoRoot, 'drawio-editor', 'src', 'node', 'drawio-runtime-packager.ts');
const compiledPackagerPath = path.join(repoRoot, 'drawio-editor', 'lib', 'node', 'drawio-runtime-packager.js');
const futureOutputRoot = path.join(repoRoot, 'drawio-editor', 'lib', 'runtime', 'drawio', '30.0.4');
const placeholderTokens = ['TO' + 'DO', 'T' + 'BD', 'FIX' + 'ME'];
const allowedHarnessRequires = [
    'node:assert/strict',
    'node:crypto',
    'node:fs',
    'node:os',
    'node:path',
    'node:test'
];
const expectedWarBytes = 52723743;
const expectedWarSha256 = 'cb40abb5f750f549444c94c00de086218b47e30b33fbc4dd0476118afd8ec19d';
const expectedVersion = '30.0.4';
const expectedPackagerScript = 'node lib/node/drawio-runtime-packager.js';
const implementationReady = fs.existsSync(sourcePackagerPath) && fs.existsSync(compiledPackagerPath);
const bootstrapReady = implementationReady && packageDefinesRuntimePackager();
const missingImplementationMessage = buildMissingImplementationMessage();

function packageDefinesRuntimePackager() {
    if (!fs.existsSync(extensionPackageJsonPath)) {
        return false;
    }
    const extensionPackage = readJson(extensionPackageJsonPath, 'drawio-editor package.json');
    return extensionPackage.dependencies?.yauzl === '2.10.0'
        && extensionPackage.scripts?.['package:drawio-runtime'] === expectedPackagerScript;
}

function assertNoPlaceholderMarkers(source, label) {
    for (const token of placeholderTokens) {
        assert.ok(!new RegExp(`\\b${token}\\b`).test(source), `${label} must not contain placeholder markers`);
    }
}

function readJson(jsonPath, label) {
    const source = fs.readFileSync(jsonPath, 'utf8');
    assertNoPlaceholderMarkers(source, label);
    return JSON.parse(source);
}

function readText(filePath, label) {
    const source = fs.readFileSync(filePath, 'utf8');
    assertNoPlaceholderMarkers(source, label);
    return source;
}

function sha256Hex(input) {
    return crypto.createHash('sha256').update(input).digest('hex');
}

function compareDeterministicStrings(left, right) {
    if (left === right) {
        return 0;
    }
    return left < right ? -1 : 1;
}

function stableJsonBytes(value) {
    return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function assertStableJsonBytes(bytes, label) {
    const source = Buffer.isBuffer(bytes) ? bytes.toString('utf8') : String(bytes);
    assert.ok(source.endsWith('\n'), `${label} must end with one trailing newline`);
    assert.equal(source, `${JSON.stringify(JSON.parse(source), null, 2)}\n`, `${label} must be stable pretty JSON bytes`);
}

function normalizeArchiveEntryPath(entryPath) {
    assert.equal(typeof entryPath, 'string', 'archive entry path must be a string');
    assert.ok(entryPath.length > 0, 'archive entry path must not be empty');
    assert.ok(!entryPath.includes('\0'), 'archive entry path must not contain NUL');
    assert.ok(!/^[A-Za-z]:/.test(entryPath), 'archive entry path must not start with a drive prefix');
    assert.ok(!entryPath.startsWith('\\\\'), 'archive entry path must not start with a UNC prefix');
    assert.ok(!entryPath.startsWith('/'), 'archive entry path must not be absolute');
    assert.ok(!entryPath.includes('\\'), 'archive entry path must not contain backslash ambiguity');

    const normalized = entryPath;
    assert.ok(!normalized.startsWith('/'), 'normalized archive entry path must remain relative');

    const segments = normalized.split('/');
    const keptSegments = [];
    for (const segment of segments) {
        assert.ok(segment.length > 0, 'archive entry path must not contain empty slash segments');
        assert.notEqual(segment, '.', 'archive entry path must not contain current-directory segments');
        assert.notEqual(segment, '..', 'archive entry path must not contain parent-directory traversal');
        keptSegments.push(segment);
    }
    return keptSegments.join('/');
}

function assertUniqueNormalizedEntries(entries) {
    const normalizedSeen = new Set();
    const lowercaseSeen = new Set();
    const directoryKinds = new Map();

    for (const entry of entries) {
        const normalizedPath = normalizeArchiveEntryPath(entry.path);
        assert.ok(!normalizedSeen.has(normalizedPath), `duplicate normalized archive path detected: ${normalizedPath}`);
        normalizedSeen.add(normalizedPath);

        const loweredPath = normalizedPath.toLowerCase();
        assert.ok(!lowercaseSeen.has(loweredPath), `case-fold archive path collision detected: ${normalizedPath}`);
        lowercaseSeen.add(loweredPath);

        const segments = normalizedPath.split('/');
        for (let index = 0; index < segments.length; index += 1) {
            const partialPath = segments.slice(0, index + 1).join('/');
            const inferredKind = index === segments.length - 1 ? entry.kind : 'directory';
            const previousKind = directoryKinds.get(partialPath);
            if (previousKind) {
                assert.equal(
                    previousKind,
                    inferredKind,
                    `file-vs-directory collision detected for archive path prefix: ${partialPath}`
                );
            } else {
                directoryKinds.set(partialPath, inferredKind);
            }
        }
    }
}

function classifyArchiveEntry(normalizedPath) {
    if (normalizedPath.startsWith('META-INF/')) {
        return 'excluded:meta-inf';
    }
    if (normalizedPath.startsWith('WEB-INF/')) {
        return 'excluded:web-inf';
    }
    if (normalizedPath.endsWith('.class')) {
        return 'excluded:class';
    }
    if (normalizedPath.endsWith('.jar')) {
        return 'excluded:jar';
    }
    return 'retain-or-report';
}

function computeBundleIdentity(includedEntries) {
    const canonicalRecords = [...includedEntries]
        .map(entry => {
            assert.equal(typeof entry.path, 'string', 'bundle identity path must be a string');
            assert.match(entry.sha256, /^[0-9a-f]{64}$/, 'bundle identity entries must use lowercase SHA-256');
            assert.equal(typeof entry.bytes, 'number', 'bundle identity byte count must be a number');
            return {
                path: entry.path,
                sha256: entry.sha256,
                bytes: entry.bytes
            };
        })
        .sort((left, right) => compareDeterministicStrings(left.path, right.path));
    return sha256Hex(stableJsonBytes(canonicalRecords));
}

function buildMissingImplementationMessage() {
    const extensionPackage = fs.existsSync(extensionPackageJsonPath)
        ? readJson(extensionPackageJsonPath, 'drawio-editor package.json')
        : {};
    const missingPrerequisites = [];

    if (!fs.existsSync(sourcePackagerPath)) {
        missingPrerequisites.push('drawio-editor/src/node/drawio-runtime-packager.ts');
    }
    if (!fs.existsSync(compiledPackagerPath)) {
        missingPrerequisites.push('drawio-editor/lib/node/drawio-runtime-packager.js');
    }
    if (extensionPackage.dependencies?.yauzl !== '2.10.0') {
        missingPrerequisites.push('drawio-editor/package.json dependency yauzl pinned exactly to 2.10.0');
    }
    if (extensionPackage.scripts?.['package:drawio-runtime'] !== expectedPackagerScript) {
        missingPrerequisites.push('drawio-editor/package.json script package:drawio-runtime = node lib/node/drawio-runtime-packager.js');
    }

    return 'DIO-P4C requires the Node-only runtime packager contract to be implemented without activating Draw.io. Add '
        + missingPrerequisites.join(', ')
        + ' before rerunning `node --test drawio-editor/tests/phase4c/runtime-packager.acceptance.test.js`.';
}

function assertAtomicPublicationPaths(outputRoot, bundleSha256) {
    const finalDirectory = path.join(outputRoot, bundleSha256);
    assert.equal(path.dirname(finalDirectory), outputRoot, 'final bundle directory must be rooted in the caller output root');
    assert.equal(path.basename(finalDirectory), bundleSha256, 'final bundle directory name must equal the bundle SHA-256');
    const tempDirectory = path.join(outputRoot, `.tmp-${bundleSha256}`);
    assert.notEqual(tempDirectory, finalDirectory, 'temp publication directory must differ from final directory');
    assert.equal(path.dirname(tempDirectory), outputRoot, 'temp publication directory must stay within the caller output root');
}

function loadManifestState() {
    return readJson(manifestPath, 'runtime-manifest.json');
}

function loadDescriptorState() {
    return readJson(descriptorPath, 'runtime-artifact.json');
}

function loadCompiledPackager() {
    delete require.cache[require.resolve(compiledPackagerPath)];
    return require(compiledPackagerPath);
}

function createSyntheticPolicyInput() {
    return {
        runtimeVersion: expectedVersion,
        maxEntries: 4,
        maxEntryUncompressedBytes: 16,
        maxTotalUncompressedBytes: 24,
        maxCompressionRatio: 5
    };
}

function createSyntheticIntegrityInventory() {
    const files = [
        {
            path: 'app/index.html',
            bytes: Buffer.from('<html>drawio</html>', 'utf8')
        },
        {
            path: 'assets/styles.css',
            bytes: Buffer.from('body{background:#fff;}', 'utf8')
        }
    ];
    return files.map(file => ({
        path: file.path,
        sha256: sha256Hex(file.bytes),
        bytes: file.bytes.length
    }));
}

function createSyntheticExcludedInventory() {
    return [
        { path: 'lib/runtime.jar', reason: 'excluded:jar' },
        { path: 'WEB-INF/web.xml', reason: 'excluded:web-inf' }
    ].sort((left, right) => compareDeterministicStrings(left.path, right.path));
}

function listDirectory(rootPath) {
    if (!fs.existsSync(rootPath)) {
        return [];
    }
    return fs.readdirSync(rootPath).sort();
}

function assertNoTempResidue(rootPath) {
    for (const entry of listDirectory(rootPath)) {
        assert.ok(!entry.startsWith('.tmp-'), `temporary publication residue must be removed: ${entry}`);
    }
}

function cleanupDirectory(rootPath) {
    fs.rmSync(rootPath, { recursive: true, force: true });
}

async function withPatchedMkdtemp(replacement, callback) {
    const originalMkdtemp = fs.promises.mkdtemp;
    fs.promises.mkdtemp = (prefix) => replacement(originalMkdtemp, prefix);
    try {
        return await callback();
    } finally {
        fs.promises.mkdtemp = originalMkdtemp;
    }
}

async function withPatchedMkdir(replacement, callback) {
    const originalMkdir = fs.promises.mkdir;
    fs.promises.mkdir = (targetPath, ...rest) => replacement(originalMkdir, targetPath, ...rest);
    try {
        return await callback();
    } finally {
        fs.promises.mkdir = originalMkdir;
    }
}

test('DIO-P4C-001 bootstrap: phase contract stays red until the runtime packager implementation and package integration land', () => {
    assert.ok(bootstrapReady, missingImplementationMessage);
});

test('DIO-P4C-002 current-state: quarantined WAR bytes and digest are exact prerequisites for any future packaging run', () => {
    const stats = fs.statSync(warPath);
    assert.ok(stats.isFile(), 'the quarantined Draw.io WAR must exist as a regular file');
    assert.equal(stats.size, expectedWarBytes, 'the quarantined Draw.io WAR byte count must stay exact');
    assert.equal(sha256Hex(fs.readFileSync(warPath)), expectedWarSha256, 'the quarantined Draw.io WAR SHA-256 must stay exact');

    const descriptor = loadDescriptorState();
    assert.equal(descriptor.runtimeVersion, expectedVersion, 'runtime descriptor version must stay pinned');
    assert.equal(
        descriptor.retainedArtifact.path,
        'artifacts/draw-30.0.4.war',
        'runtime descriptor must point at the quarantined WAR path'
    );
    assert.equal(
        descriptor.retainedArtifact.sha256,
        expectedWarSha256,
        'runtime descriptor must record the exact quarantined WAR digest'
    );
});

test('DIO-P4C-003 current-state: blocked activation manifest and descriptor remain fail-closed during tests-only packaging work', () => {
    const manifest = loadManifestState();
    const descriptor = loadDescriptorState();

    assert.equal(manifest.entrypoint, 'blocked.html', 'runtime-manifest entrypoint must remain blocked.html');
    assert.equal(manifest.compatibility.status, 'blocked', 'runtime-manifest compatibility status must remain blocked');
    assert.equal(manifest.provenance.usability, 'blocked', 'runtime-manifest usability must remain blocked');
    assert.ok(
        descriptor.lifecycle.status === 'blocked' || descriptor.lifecycle.status === 'ready',
        'runtime descriptor lifecycle must remain explicit'
    );
    assert.equal(
        descriptor.security.phase0HostSecurityGate.formallyActivated,
        false,
        'Phase 0 host security gate must remain inactive during tests-only packaging work'
    );
    assert.equal(
        descriptor.security.phase0HostSecurityGate.authority,
        'required',
        'Phase 0 host security gate authority must remain required'
    );
    assert.equal(
        descriptor.security.activationAudit,
        undefined,
        'tests-only packaging work must not add activation authorization'
    );
});

test('DIO-P4C-004 helper: archive path normalization rejects traversal, absolute, ambiguous, and colliding entry paths', () => {
    assert.equal(normalizeArchiveEntryPath('images/logo.svg'), 'images/logo.svg');

    assert.throws(() => normalizeArchiveEntryPath('/etc/passwd'), /must not be absolute/);
    assert.throws(() => normalizeArchiveEntryPath('C:\\windows\\system32'), /drive prefix/);
    assert.throws(() => normalizeArchiveEntryPath('\\\\server\\share\\payload'), /UNC prefix/);
    assert.throws(() => normalizeArchiveEntryPath('src\\shapes\\uml.xml'), /backslash ambiguity/);
    assert.throws(() => normalizeArchiveEntryPath('webapp\\..\\escape.txt'), /backslash ambiguity/);
    assert.throws(() => normalizeArchiveEntryPath('../outside.txt'), /parent-directory traversal/);
    assert.throws(() => normalizeArchiveEntryPath('webapp/../escape.txt'), /parent-directory traversal/);
    assert.throws(() => normalizeArchiveEntryPath('drawio\0payload'), /must not contain NUL/);

    assertUniqueNormalizedEntries([
        { path: 'app/index.html', kind: 'file' },
        { path: 'app/images/logo.svg', kind: 'file' }
    ]);
    assert.throws(
        () => assertUniqueNormalizedEntries([
            { path: 'app/index.html', kind: 'file' },
            { path: 'app/index.html', kind: 'file' }
        ]),
        /duplicate normalized archive path/
    );
    assert.throws(
        () => assertUniqueNormalizedEntries([
            { path: 'App/index.html', kind: 'file' },
            { path: 'app/index.html', kind: 'file' }
        ]),
        /case-fold archive path collision/
    );
    assert.throws(
        () => assertUniqueNormalizedEntries([
            { path: 'webapp', kind: 'file' },
            { path: 'webapp/index.html', kind: 'file' }
        ]),
        /file-vs-directory collision/
    );
});

test('DIO-P4C-005 helper: exclusion and deterministic publication rules are explicit before implementation exists', () => {
    assert.equal(classifyArchiveEntry('META-INF/MANIFEST.MF'), 'excluded:meta-inf');
    assert.equal(classifyArchiveEntry('WEB-INF/web.xml'), 'excluded:web-inf');
    assert.equal(classifyArchiveEntry('lib/swing.jar'), 'excluded:jar');
    assert.equal(classifyArchiveEntry('classes/com/acme/Editor.class'), 'excluded:class');
    assert.equal(classifyArchiveEntry('shapes/basic.xml'), 'retain-or-report');

    const inventory = [
        { path: 'index.html', sha256: '1'.repeat(64), bytes: 11 },
        { path: 'styles/app.css', sha256: '2'.repeat(64), bytes: 17 },
        { path: 'shapes/basic.xml', sha256: '3'.repeat(64), bytes: 23 }
    ];
    const forwardIdentity = computeBundleIdentity(inventory);
    const reverseIdentity = computeBundleIdentity([...inventory].reverse());
    const changedIdentity = computeBundleIdentity([
        inventory[0],
        inventory[1],
        { path: 'shapes/basic.xml', sha256: '4'.repeat(64), bytes: 24 }
    ]);
    const unicodeInventory = [
        { path: 'étude/file.txt', sha256: 'a'.repeat(64), bytes: 3 },
        { path: 'ßeta/file.txt', sha256: 'b'.repeat(64), bytes: 5 },
        { path: 'zeta/file.txt', sha256: 'c'.repeat(64), bytes: 7 },
        { path: 'Äpfel/file.txt', sha256: 'd'.repeat(64), bytes: 11 }
    ];
    const canonicalUnicodeOrder = unicodeInventory
        .map(entry => entry.path)
        .sort(compareDeterministicStrings);
    assert.match(forwardIdentity, /^[0-9a-f]{64}$/);
    assert.equal(forwardIdentity, reverseIdentity, 'bundle identity must depend on sorted inventory only');
    assert.notEqual(changedIdentity, forwardIdentity, 'bundle identity must change when file hash or size changes');
    assert.deepEqual(
        canonicalUnicodeOrder,
        ['zeta/file.txt', 'Äpfel/file.txt', 'ßeta/file.txt', 'étude/file.txt'],
        'canonical path ordering must use locale-independent code-unit comparison'
    );
    assert.equal(
        computeBundleIdentity(unicodeInventory),
        computeBundleIdentity([...unicodeInventory].reverse()),
        'Unicode bundle identity must stay stable under locale-independent ordering'
    );

    const stableBytes = stableJsonBytes({
        bundleSha256: forwardIdentity,
        includedEntries: inventory.map(entry => entry.path),
        excludedEntries: [{ path: 'WEB-INF/web.xml', reason: 'excluded:web-inf' }]
    });
    assertStableJsonBytes(stableBytes, 'synthetic helper JSON');
    assertAtomicPublicationPaths(futureOutputRoot, forwardIdentity);
});

test('DIO-P4C-006 harness: contract uses only Node built-ins and package integration assertions are conditional on bootstrap state', () => {
    const harnessSource = fs.readFileSync(__filename, 'utf8');
    assertNoPlaceholderMarkers(harnessSource, 'phase4c acceptance harness');
    const requires = Array.from(new Set(Array.from(harnessSource.matchAll(/require\('([^']+)'\)/g), match => match[1]))).sort();
    assert.deepEqual(requires, allowedHarnessRequires, 'Phase 4C harness must use only Node built-ins');

    const extensionPackage = readJson(extensionPackageJsonPath, 'drawio-editor package.json');
    const workspacePackage = readJson(workspacePackageJsonPath, 'workspace package.json');

    if (!bootstrapReady) {
        assert.equal(
            extensionPackage.dependencies?.yauzl,
            undefined,
            'current repository state must not yet claim the yauzl runtime-packager dependency before implementation lands'
        );
        assert.equal(
            extensionPackage.scripts?.['package:drawio-runtime'],
            undefined,
            'current repository state must not yet expose package:drawio-runtime before implementation lands'
        );
    } else {
        assert.equal(
            extensionPackage.dependencies?.yauzl,
            '2.10.0',
            'drawio-editor package.json must pin yauzl exactly once bootstrap is complete'
        );
        assert.equal(
            extensionPackage.scripts?.['package:drawio-runtime'],
            expectedPackagerScript,
            'drawio-editor package.json must keep the dedicated runtime packager script separate'
        );
    }

    assert.equal(
        workspacePackage.scripts?.['package:drawio-runtime'],
        undefined,
        'workspace package scripts must not absorb the dedicated drawio runtime packager command'
    );
    for (const [scriptName, scriptBody] of Object.entries(workspacePackage.scripts ?? {})) {
        if (scriptName.startsWith('build') || scriptName.startsWith('test')) {
            assert.ok(
                !String(scriptBody).includes('package:drawio-runtime'),
                `workspace script ${scriptName} must not invoke the dedicated drawio runtime packager command`
            );
        }
    }
});

test('DIO-P4C-007 implementation: security policy validation rejects unsafe archive entries and limit violations', { skip: !implementationReady }, async () => {
    const source = readText(sourcePackagerPath, 'drawio runtime packager source');
    const executableSource = source
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^\\])\/\/.*$/gm, '$1');
    assert.ok(!/@theia\//.test(executableSource), 'runtime packager source must not depend on Theia APIs');
    assert.ok(!/\bplugin-ext\b/.test(executableSource), 'runtime packager source must not depend on plugin-ext');
    assert.ok(!/\bwebview\b/i.test(executableSource), 'runtime packager source must not depend on webview surfaces');

    const compiledModule = loadCompiledPackager();
    assert.equal(compiledModule.DRAWIO_RUNTIME_PACKAGER_VERSION, expectedVersion, 'compiled packager version export must stay pinned');
    assert.equal(typeof compiledModule.buildDrawioRuntimePolicy, 'function', 'compiled packager must export buildDrawioRuntimePolicy');
    assert.equal(typeof compiledModule.createArchiveValidationState, 'function', 'compiled packager must export createArchiveValidationState');
    assert.equal(typeof compiledModule.validateArchiveEntry, 'function', 'compiled packager must export validateArchiveEntry');

    const policy = compiledModule.buildDrawioRuntimePolicy(createSyntheticPolicyInput());
    assert.equal(policy.runtimeVersion, expectedVersion, 'policy must trace the runtime version');
    assert.equal(policy.maxEntries, 4, 'policy must expose maxEntries');
    assert.equal(policy.maxEntryUncompressedBytes, 16, 'policy must expose maxEntryUncompressedBytes');
    assert.equal(policy.maxTotalUncompressedBytes, 24, 'policy must expose maxTotalUncompressedBytes');
    assert.equal(policy.maxCompressionRatio, 5, 'policy must expose maxCompressionRatio');

    const state = compiledModule.createArchiveValidationState(policy);
    const included = compiledModule.validateArchiveEntry({
        rawPath: 'ui/index.html',
        unixFileType: 'file',
        uncompressedBytes: 10,
        compressedBytes: 5
    }, state);
    assert.equal(included.action, 'include', 'regular safe files must be includable');
    assert.equal(included.normalizedPath, 'ui/index.html', 'included file path must be normalized');

    const excluded = compiledModule.validateArchiveEntry({
        rawPath: 'WEB-INF/web.xml',
        unixFileType: 'file',
        uncompressedBytes: 4,
        compressedBytes: 4
    }, state);
    assert.equal(excluded.action, 'exclude', 'server-only files must be excluded');
    assert.equal(excluded.reason, 'excluded:web-inf', 'excluded entries must record a stable reason');

    assert.throws(
        () => compiledModule.validateArchiveEntry({
            rawPath: 'unsafe/link',
            unixFileType: 'symlink',
            uncompressedBytes: 1,
            compressedBytes: 1
        }, state),
        /symlink|non-regular/i,
        'symlink entries must be rejected'
    );
    assert.throws(
        () => compiledModule.validateArchiveEntry({
            rawPath: 'ui\\index.html',
            unixFileType: 'file',
            uncompressedBytes: 1,
            compressedBytes: 1
        }, state),
        /backslash ambiguity/i,
        'backslash archive paths must be rejected explicitly'
    );
    assert.throws(
        () => compiledModule.validateArchiveEntry({
            rawPath: 'ui/index.html',
            unixFileType: 'file',
            uncompressedBytes: 1,
            compressedBytes: 1
        }, state),
        /duplicate normalized archive path/i,
        'exact duplicate normalized paths must be rejected'
    );

    const caseFoldState = compiledModule.createArchiveValidationState(policy);
    compiledModule.validateArchiveEntry({
        rawPath: 'App/index.html',
        unixFileType: 'file',
        uncompressedBytes: 4,
        compressedBytes: 4
    }, caseFoldState);
    assert.throws(
        () => compiledModule.validateArchiveEntry({
            rawPath: 'app/index.html',
            unixFileType: 'file',
            uncompressedBytes: 4,
            compressedBytes: 4
        }, caseFoldState),
        /case-fold archive path collision/i,
        'case-fold collisions must be rejected'
    );

    const fileDirState = compiledModule.createArchiveValidationState(policy);
    compiledModule.validateArchiveEntry({
        rawPath: 'webapp',
        unixFileType: 'file',
        uncompressedBytes: 4,
        compressedBytes: 4
    }, fileDirState);
    assert.throws(
        () => compiledModule.validateArchiveEntry({
            rawPath: 'webapp/index.html',
            unixFileType: 'file',
            uncompressedBytes: 4,
            compressedBytes: 4
        }, fileDirState),
        /file-vs-directory collision/i,
        'file-directory collisions must be rejected'
    );

    const countState = compiledModule.createArchiveValidationState(policy);
    for (const relativePath of ['a.txt', 'b.txt', 'c.txt', 'd.txt']) {
        compiledModule.validateArchiveEntry({
            rawPath: relativePath,
            unixFileType: 'file',
            uncompressedBytes: 1,
            compressedBytes: 1
        }, countState);
    }
    assert.throws(
        () => compiledModule.validateArchiveEntry({
            rawPath: 'e.txt',
            unixFileType: 'file',
            uncompressedBytes: 1,
            compressedBytes: 1
        }, countState),
        /entry count/i,
        'entry-count limit must be enforced'
    );

    assert.throws(
        () => compiledModule.validateArchiveEntry({
            rawPath: 'large.bin',
            unixFileType: 'file',
            uncompressedBytes: 17,
            compressedBytes: 4
        }, compiledModule.createArchiveValidationState(policy)),
        /per-entry|uncompressed/i,
        'per-entry uncompressed size limit must be enforced'
    );

    const totalState = compiledModule.createArchiveValidationState(policy);
    compiledModule.validateArchiveEntry({
        rawPath: 'chunk-a.bin',
        unixFileType: 'file',
        uncompressedBytes: 12,
        compressedBytes: 6
    }, totalState);
    compiledModule.validateArchiveEntry({
        rawPath: 'chunk-b.bin',
        unixFileType: 'file',
        uncompressedBytes: 12,
        compressedBytes: 6
    }, totalState);
    assert.throws(
        () => compiledModule.validateArchiveEntry({
            rawPath: 'chunk-c.bin',
            unixFileType: 'file',
            uncompressedBytes: 1,
            compressedBytes: 1
        }, totalState),
        /total uncompressed/i,
        'total uncompressed size limit must be enforced'
    );

    assert.throws(
        () => compiledModule.validateArchiveEntry({
            rawPath: 'ratio.bin',
            unixFileType: 'file',
            uncompressedBytes: 15,
            compressedBytes: 2
        }, compiledModule.createArchiveValidationState(policy)),
        /compression ratio/i,
        'suspicious compression ratio limit must be enforced'
    );
});

test('DIO-P4C-008 implementation: metadata byte builders are deterministic and record policy, inventory, integrity, verdict, and non-activation status', { skip: !implementationReady }, async () => {
    const compiledModule = loadCompiledPackager();
    assert.equal(typeof compiledModule.createBundleManifestBytes, 'function', 'compiled packager must export createBundleManifestBytes');
    assert.equal(typeof compiledModule.createAssetIntegrityBytes, 'function', 'compiled packager must export createAssetIntegrityBytes');
    assert.equal(typeof compiledModule.createPackagingReportBytes, 'function', 'compiled packager must export createPackagingReportBytes');

    const policy = compiledModule.buildDrawioRuntimePolicy(createSyntheticPolicyInput());
    const includedEntries = createSyntheticIntegrityInventory();
    const excludedEntries = createSyntheticExcludedInventory();
    const bundleSha256 = computeBundleIdentity(includedEntries);
    const metadataInput = {
        runtimeVersion: expectedVersion,
        sourceArchive: {
            path: 'runtime/artifacts/draw-30.0.4.war',
            bytes: expectedWarBytes,
            sha256: expectedWarSha256
        },
        bundleSha256,
        policy,
        includedEntries,
        excludedEntries,
        verdict: 'candidate'
    };

    const bundleManifestBytesA = Buffer.from(compiledModule.createBundleManifestBytes(metadataInput));
    const bundleManifestBytesB = Buffer.from(compiledModule.createBundleManifestBytes(metadataInput));
    const assetIntegrityBytesA = Buffer.from(compiledModule.createAssetIntegrityBytes(metadataInput));
    const assetIntegrityBytesB = Buffer.from(compiledModule.createAssetIntegrityBytes(metadataInput));
    const packagingReportBytesA = Buffer.from(compiledModule.createPackagingReportBytes(metadataInput));
    const packagingReportBytesB = Buffer.from(compiledModule.createPackagingReportBytes(metadataInput));

    assert.deepEqual(bundleManifestBytesA, bundleManifestBytesB, 'bundle-manifest bytes must be stable');
    assert.deepEqual(assetIntegrityBytesA, assetIntegrityBytesB, 'asset-integrity bytes must be stable');
    assert.deepEqual(packagingReportBytesA, packagingReportBytesB, 'packaging-report bytes must be stable');
    assertStableJsonBytes(bundleManifestBytesA, 'bundle-manifest bytes');
    assertStableJsonBytes(assetIntegrityBytesA, 'asset-integrity bytes');
    assertStableJsonBytes(packagingReportBytesA, 'packaging-report bytes');

    const bundleManifest = JSON.parse(bundleManifestBytesA.toString('utf8'));
    const assetIntegrity = JSON.parse(assetIntegrityBytesA.toString('utf8'));
    const packagingReport = JSON.parse(packagingReportBytesA.toString('utf8'));

    assert.equal(bundleManifest.runtimeVersion, expectedVersion, 'bundle manifest must record runtime version');
    assert.equal(bundleManifest.sourceArchive.sha256, expectedWarSha256, 'bundle manifest must trace source archive digest');
    assert.equal(bundleManifest.bundleSha256, bundleSha256, 'bundle manifest must record aggregate bundle identity');
    assert.equal(bundleManifest.verdict, 'candidate', 'bundle manifest must record the packaging verdict');
    assert.equal(bundleManifest.activation, undefined, 'bundle manifest must not claim activation');
    assert.deepEqual(bundleManifest.policy, policy, 'bundle manifest must record applied policy values');
    assert.deepEqual(bundleManifest.excludedEntries, excludedEntries, 'bundle manifest must record excluded inventory with reasons');

    assert.equal(assetIntegrity.bundleSha256, bundleSha256, 'asset integrity must record aggregate bundle identity');
    assert.equal(Array.isArray(assetIntegrity.files), true, 'asset integrity must record per-file integrity');
    assert.equal(assetIntegrity.files.length, includedEntries.length, 'asset integrity must list every included file');
    for (const file of assetIntegrity.files) {
        assert.match(file.sha256, /^[0-9a-f]{64}$/, 'asset integrity hashes must be lowercase SHA-256');
    }

    assert.equal(packagingReport.verdict, 'candidate', 'packaging report must record the verdict');
    assert.equal(packagingReport.activation, undefined, 'packaging report must not claim activation');
    assert.equal(packagingReport.sourceArchive.bytes, expectedWarBytes, 'packaging report must trace source archive byte count');
    assert.deepEqual(packagingReport.excludedEntries, excludedEntries, 'packaging report must trace excluded inventory with reasons');
    assert.equal(packagingReport.bundleSha256, bundleSha256, 'packaging report must record bundle identity');
});

test('DIO-P4C-009 implementation: digest mismatch fails before publication and leaves no residue or manifest mutation', { skip: !implementationReady }, async () => {
    const compiledModule = loadCompiledPackager();
    assert.equal(typeof compiledModule.packageDrawioRuntime, 'function', 'compiled packager must export packageDrawioRuntime');

    const outputRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'drawio-p4c-package-fail-')));
    const manifestBytesBefore = fs.readFileSync(manifestPath);
    const descriptorBytesBefore = fs.readFileSync(descriptorPath);
    try {
        await assert.rejects(
            compiledModule.packageDrawioRuntime({
                inputWarPath: warPath,
                expectedWarBytes,
                expectedWarSha256: '0'.repeat(64),
                outputRoot,
                policy: compiledModule.buildDrawioRuntimePolicy(createSyntheticPolicyInput())
            }),
            /sha-?256|digest|expected war/i,
            'packageDrawioRuntime must fail closed on input digest mismatch before extraction'
        );

        assert.deepEqual(listDirectory(outputRoot), [], 'failed packaging must not publish any final output');
        assertNoTempResidue(outputRoot);
        assert.deepEqual(fs.readFileSync(manifestPath), manifestBytesBefore, 'runtime-manifest.json bytes must remain unchanged');
        assert.deepEqual(fs.readFileSync(descriptorPath), descriptorBytesBefore, 'runtime-artifact.json bytes must remain unchanged');
    } finally {
        cleanupDirectory(outputRoot);
    }
});

test('DIO-P4C-010 implementation: atomic publication is idempotent for identical content and fails closed for conflicts', { skip: !implementationReady }, async () => {
    const compiledModule = loadCompiledPackager();
    assert.equal(typeof compiledModule.publishPackagedRuntime, 'function', 'compiled packager must export publishPackagedRuntime');

    const outputRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'drawio-p4c-publish-')));
    const includedFiles = [
        { relativePath: 'app/index.html', bytes: Buffer.from('<html>drawio</html>\n', 'utf8') },
        { relativePath: 'assets/styles.css', bytes: Buffer.from('body{color:#000;}\n', 'utf8') }
    ];
    const includedEntries = includedFiles.map(file => ({
        path: file.relativePath,
        sha256: sha256Hex(file.bytes),
        bytes: file.bytes.length
    }));
    const bundleSha256 = computeBundleIdentity(includedEntries);
    const metadataInput = {
        runtimeVersion: expectedVersion,
        sourceArchive: {
            path: 'runtime/artifacts/draw-30.0.4.war',
            bytes: expectedWarBytes,
            sha256: expectedWarSha256
        },
        bundleSha256,
        policy: loadCompiledPackager().buildDrawioRuntimePolicy(createSyntheticPolicyInput()),
        includedEntries,
        excludedEntries: createSyntheticExcludedInventory(),
        verdict: 'candidate'
    };

    const publicationInput = {
        outputRoot,
        bundleSha256,
        files: includedFiles,
        bundleManifestBytes: Buffer.from(compiledModule.createBundleManifestBytes(metadataInput)),
        assetIntegrityBytes: Buffer.from(compiledModule.createAssetIntegrityBytes(metadataInput)),
        packagingReportBytes: Buffer.from(compiledModule.createPackagingReportBytes(metadataInput))
    };

    try {
        const firstResult = await compiledModule.publishPackagedRuntime(publicationInput);
        assert.equal(firstResult.bundleSha256, bundleSha256, 'publication result must trace bundle identity');
        assert.equal(firstResult.finalDirectory, path.join(outputRoot, bundleSha256), 'publication result must trace final directory');
        assertNoTempResidue(outputRoot);
        assert.ok(fs.existsSync(path.join(outputRoot, bundleSha256, 'bundle-manifest.json')), 'publication must write bundle-manifest.json');

        const secondResult = await compiledModule.publishPackagedRuntime(publicationInput);
        assert.equal(secondResult.finalDirectory, firstResult.finalDirectory, 'identical publication must resolve to the same final directory');
        assertNoTempResidue(outputRoot);

        const mutatedPackagingReport = JSON.parse(publicationInput.packagingReportBytes.toString('utf8'));
        mutatedPackagingReport.sourceArchive.path = 'runtime/artifacts/other-draw.war';
        mutatedPackagingReport.sourceArchive.sha256 = 'f'.repeat(64);
        mutatedPackagingReport.excludedEntries = [{ path: 'META-INF/MANIFEST.MF', reason: 'excluded:meta-inf' }];
        mutatedPackagingReport.policy.maxTotalUncompressedBytes += 1;
        await assert.rejects(
            compiledModule.publishPackagedRuntime({
                ...publicationInput,
                packagingReportBytes: stableJsonBytes(mutatedPackagingReport)
            }),
            /sourceArchive|excludedEntries|policy/i,
            'publication must reject metadata provenance drift in any audit-bearing file'
        );

        const baselineIndexDigest = sha256Hex(fs.readFileSync(path.join(outputRoot, bundleSha256, 'app', 'index.html')));
        await assert.rejects(
            compiledModule.publishPackagedRuntime({
                ...publicationInput,
                files: [
                    { relativePath: 'app/index.html', bytes: Buffer.from('<html>changed</html>\n', 'utf8') },
                    { relativePath: 'assets/styles.css', bytes: Buffer.from('body{color:#000;}\n', 'utf8') }
                ]
            }),
            /conflict|existing output/i,
            'conflicting content for the same bundle identity must fail closed'
        );
        assert.equal(
            sha256Hex(fs.readFileSync(path.join(outputRoot, bundleSha256, 'app', 'index.html'))),
            baselineIndexDigest,
            'conflicting publication attempts must not mutate the existing final bundle'
        );
        assertNoTempResidue(outputRoot);

        const symlinkRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'drawio-p4c-symlink-')));
        try {
            const realParent = path.join(symlinkRoot, 'real-parent');
            const symlinkParent = path.join(symlinkRoot, 'linked-parent');
            fs.mkdirSync(realParent);
            fs.symlinkSync(realParent, symlinkParent, 'dir');
            await assert.rejects(
                compiledModule.publishPackagedRuntime({
                    ...publicationInput,
                    outputRoot: path.join(symlinkParent, 'nested-output')
                }),
                /outputRoot must be a real directory/i,
                'publication must reject symlinked output-root ancestors'
            );
        } finally {
            cleanupDirectory(symlinkRoot);
        }

        const swapOutputRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'drawio-p4c-publish-swap-')));
        const displacedSwapRoot = `${swapOutputRoot}-displaced`;
        try {
            await withPatchedMkdtemp(async (originalMkdtemp, prefix) => {
                const stagePath = await originalMkdtemp(prefix);
                fs.renameSync(swapOutputRoot, displacedSwapRoot);
                fs.mkdirSync(swapOutputRoot);
                return stagePath;
            }, async () => {
                await assert.rejects(
                    compiledModule.publishPackagedRuntime({
                        ...publicationInput,
                        outputRoot: swapOutputRoot
                    }),
                    /outputRoot changed|temp publication directory changed/i,
                    'publication must fail closed if the approved output root is replaced during staging'
                );
            });
            assert.equal(
                fs.existsSync(path.join(swapOutputRoot, bundleSha256)),
                false,
                'root replacement must not publish into the attacker-controlled replacement root path'
            );
            assert.equal(
                fs.existsSync(path.join(displacedSwapRoot, bundleSha256)),
                false,
                'root replacement must not publish into the displaced original root either'
            );
        } finally {
            cleanupDirectory(swapOutputRoot);
            cleanupDirectory(displacedSwapRoot);
        }

        const descendantSwapOutputRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'drawio-p4c-stage-swap-')));
        const displacedStageRootHolder = { value: null };
        const replacementStageRootHolder = { value: null };
        let capturedStageRoot = null;
        try {
            await withPatchedMkdtemp(async (originalMkdtemp, prefix) => {
                const stagePath = await originalMkdtemp(prefix);
                capturedStageRoot = stagePath;
                return stagePath;
            }, async () => {
                await withPatchedMkdir(async (originalMkdir, targetPath, ...rest) => {
                    if (
                        capturedStageRoot
                        && displacedStageRootHolder.value === null
                        && String(targetPath) === path.join(capturedStageRoot, 'app')
                    ) {
                        displacedStageRootHolder.value = `${capturedStageRoot}-displaced`;
                        replacementStageRootHolder.value = capturedStageRoot;
                        fs.renameSync(capturedStageRoot, displacedStageRootHolder.value);
                        fs.mkdirSync(replacementStageRootHolder.value);
                    }
                    return await originalMkdir(targetPath, ...rest);
                }, async () => {
                    await assert.rejects(
                        compiledModule.publishPackagedRuntime({
                            ...publicationInput,
                            outputRoot: descendantSwapOutputRoot
                        }),
                        /package stage directory changed|temp publication directory changed/i,
                        'publication must reject stage replacement during descendant preparation before any payload file is written'
                    );
                });
            });
            assert.equal(
                fs.existsSync(path.join(descendantSwapOutputRoot, bundleSha256)),
                false,
                'stage replacement must not publish a final bundle into the approved output root'
            );
            if (replacementStageRootHolder.value !== null) {
                assert.equal(
                    fs.existsSync(path.join(replacementStageRootHolder.value, 'app', 'index.html')),
                    false,
                    'stage replacement must not write payload files into the attacker-controlled replacement stage'
                );
            }
            if (displacedStageRootHolder.value !== null) {
                assert.equal(
                    fs.existsSync(path.join(displacedStageRootHolder.value, bundleSha256)),
                    false,
                    'stage replacement must not publish a final bundle into the displaced original stage root'
                );
            }
        } finally {
            cleanupDirectory(descendantSwapOutputRoot);
            if (replacementStageRootHolder.value !== null) {
                cleanupDirectory(replacementStageRootHolder.value);
            }
            if (displacedStageRootHolder.value !== null) {
                cleanupDirectory(displacedStageRootHolder.value);
            }
        }
    } finally {
        cleanupDirectory(outputRoot);
    }
});
