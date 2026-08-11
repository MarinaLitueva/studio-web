const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const runtimeRoot = path.join(repoRoot, 'drawio-editor', 'runtime');
const manifestPath = path.join(runtimeRoot, 'runtime-manifest.json');
const relativeManifestPath = path.relative(repoRoot, manifestPath);
const manifestExists = fs.existsSync(manifestPath);
const placeholderTokens = ['TO' + 'DO', 'T' + 'BD', 'FIX' + 'ME'];
const missingManifestMessage =
    'Phase 0 implementation has not supplied the pinned runtime contract at '
    + relativeManifestPath
    + '. Create drawio-editor/runtime/runtime-manifest.json before enabling the native Draw.io editor.';

function isContainedPath(rootPath, candidatePath) {
    const relative = path.relative(rootPath, candidatePath);
    return relative === '' || (!path.isAbsolute(relative) && !relative.startsWith(`..${path.sep}`) && relative !== '..');
}

function isLocalRelativePath(value) {
    return typeof value === 'string'
        && value.length > 0
        && !path.isAbsolute(value)
        && !/^(?:[a-z]+:)?\/\//i.test(value)
        && !/^(?:data|blob):/i.test(value);
}

function assertLocalRuntimePath(value, label) {
    assert.ok(isLocalRelativePath(value), `${label} must be a repository-local relative path without URL schemes`);
    const absolutePath = path.resolve(runtimeRoot, value);
    assert.ok(isContainedPath(runtimeRoot, absolutePath), `${label} must stay within drawio-editor/runtime`);
    return absolutePath;
}

function readManifest() {
    const raw = fs.readFileSync(manifestPath, 'utf8');
    return JSON.parse(raw);
}

function assertNonEmptyString(value, label) {
    assert.equal(typeof value, 'string', `${label} must be a string`);
    assert.ok(value.trim().length > 0, `${label} must not be empty`);
    return value;
}

function assertUniqueArray(values, label) {
    assert.ok(Array.isArray(values), `${label} must be an array`);
    const uniqueValues = new Set(values);
    assert.equal(uniqueValues.size, values.length, `${label} must not contain duplicates`);
}

function sha256Hex(absolutePath) {
    return crypto.createHash('sha256').update(fs.readFileSync(absolutePath)).digest('hex');
}

function getCspDirectives(csp) {
    const directives = new Map();
    for (const directive of csp.split(';')) {
        const trimmedDirective = directive.trim();
        if (!trimmedDirective) {
            continue;
        }
        const parts = trimmedDirective.split(/\s+/);
        const directiveName = assertNonEmptyString(parts[0], 'CSP directive name').toLowerCase();
        assert.ok(
            !directives.has(directiveName),
            `security.csp must not repeat the ${directiveName} directive`
        );
        directives.set(directiveName, parts.slice(1));
    }
    return directives;
}

function assertNoNetworkCapableSource(source, directive) {
    assert.ok(!source.includes('*'), `CSP source ${source} in ${directive} must not use wildcard matching`);
    assert.ok(
        !source.startsWith('//'),
        `CSP source ${source} in ${directive} must not allow protocol-relative network origins`
    );
    assert.ok(
        !/^(?:https?|wss?|ftp):$/i.test(source),
        `CSP source ${source} in ${directive} must not allow network-capable schemes`
    );
    assert.ok(
        !/^(?:https?|wss?|ftp):\/\//i.test(source),
        `CSP source ${source} in ${directive} must not allow explicit network origins`
    );
    assert.ok(
        !/^(?:\*\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i.test(source),
        `CSP source ${source} in ${directive} must not allow explicit hosts`
    );
    assert.ok(
        !/^\[[0-9a-f:.]+\](?::\d+)?$/i.test(source),
        `CSP source ${source} in ${directive} must not allow IPv6 host sources`
    );
    assert.ok(
        !/^[a-z0-9-]+(?::\d+)?$/i.test(source),
        `CSP source ${source} in ${directive} must not allow localhost or other single-label host sources`
    );
}

function assertNoPlaceholderMarkers(source, label) {
    for (const token of placeholderTokens) {
        assert.ok(!new RegExp(`\\b${token}\\b`).test(source), `${label} must not contain placeholder markers`);
    }
}

test('DRAWSPIKE-001 expects the pinned runtime manifest at drawio-editor/runtime/runtime-manifest.json', () => {
    assert.equal(relativeManifestPath, path.join('drawio-editor', 'runtime', 'runtime-manifest.json'));
    assert.ok(manifestExists, missingManifestMessage);
});

test('DRAWSPIKE helper rejects duplicate and network-capable CSP directives before overwrite', () => {
    assert.throws(
        () => getCspDirectives("default-src 'none'; CONNECT-SRC https://example.com; connect-src 'none'"),
        /must not repeat the connect-src directive/
    );
    assert.throws(
        () => {
            const directives = getCspDirectives("default-src 'none'; connect-src https://example.com");
            for (const [directive, sourceList] of directives.entries()) {
                for (const source of sourceList) {
                    assertNoNetworkCapableSource(source, directive);
                }
            }
        },
        /must not allow explicit network origins/
    );
});

test('DRAWSPIKE-002 requires schemaVersion 1, exact runtime semver, identities, relative entrypoint, and offline mode', { skip: !manifestExists }, () => {
    const manifest = readManifest();

    assert.equal(manifest.schemaVersion, 1, 'schemaVersion must equal 1');
    assert.match(
        manifest.runtimeVersion,
        /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/,
        'runtimeVersion must be an exact semver without ranges'
    );
    assert.equal(manifest.runtimeIdentity, 'diagrams.net', 'runtimeIdentity must declare diagrams.net');
    assert.equal(
        manifest.integrationIdentity,
        'jgraph/drawio-integration',
        'integrationIdentity must declare the official jgraph/drawio-integration package'
    );
    assert.equal(manifest.offline, true, 'offline must be true');
    assertLocalRuntimePath(manifest.entrypoint, 'entrypoint');
});

test('DRAWSPIKE-003 requires offline-only network policy and forbids URL-like runtime paths', { skip: !manifestExists }, () => {
    const manifest = readManifest();

    assert.deepEqual(manifest.allowedNetworkOrigins, [], 'allowedNetworkOrigins must be an empty list for Phase 0 offline runtime');
    assertLocalRuntimePath(manifest.entrypoint, 'entrypoint');
    for (const asset of manifest.assets || []) {
        assertLocalRuntimePath(asset.path, `asset ${asset.path}`);
    }
});

test('DRAWSPIKE-004 validates every declared runtime asset path, containment, existence, and SHA-256 digest', { skip: !manifestExists }, () => {
    const manifest = readManifest();

    assert.ok(Array.isArray(manifest.assets), 'assets must be an array');
    assert.ok(manifest.assets.length > 0, 'assets must declare the pinned diagrams.net runtime files');
    for (const asset of manifest.assets) {
        assert.ok(asset && typeof asset === 'object', 'each asset must be an object');
        const absolutePath = assertLocalRuntimePath(asset.path, `asset ${asset.path}`);
        assert.match(asset.sha256, /^[a-f0-9]{64}$/, `asset ${asset.path} must declare a lowercase SHA-256 hex digest`);
        assert.ok(fs.existsSync(absolutePath), `asset ${asset.path} must exist under drawio-editor/runtime`);
        assert.equal(sha256Hex(absolutePath), asset.sha256, `asset ${asset.path} digest must match the declared SHA-256`);
    }
});

test('DRAWSPIKE-005 requires at least one license file contained under the runtime root', { skip: !manifestExists }, () => {
    const manifest = readManifest();

    assert.ok(Array.isArray(manifest.licenseFiles), 'licenseFiles must be an array');
    assert.ok(manifest.licenseFiles.length > 0, 'licenseFiles must list at least one runtime license file');
    for (const licensePath of manifest.licenseFiles) {
        const absolutePath = assertLocalRuntimePath(licensePath, `license file ${licensePath}`);
        assert.ok(fs.existsSync(absolutePath), `license file ${licensePath} must exist under drawio-editor/runtime`);
    }
});

test('DRAWSPIKE-006 requires unique-origin isolation and a restrictive CSP without wildcards or unsafe directives', { skip: !manifestExists }, () => {
    const manifest = readManifest();

    assert.ok(manifest.security && typeof manifest.security === 'object', 'security must be an object');
    assert.equal(manifest.security.uniqueOriginRequired, true, 'security.uniqueOriginRequired must be true');
    assert.equal(typeof manifest.security.csp, 'string', 'security.csp must be a string');

    const directives = getCspDirectives(manifest.security.csp);
    assert.deepEqual(directives.get('default-src'), ["'none'"], "CSP must contain default-src 'none'");
    assert.deepEqual(directives.get('connect-src'), ["'none'"], "CSP must contain connect-src 'none'");
    for (const [directive, sourceList] of directives.entries()) {
        for (const source of sourceList) {
            assertNoNetworkCapableSource(source, directive);
            assert.notEqual(source, "'unsafe-inline'", "CSP must not allow 'unsafe-inline'");
            assert.notEqual(source, "'unsafe-eval'", "CSP must not allow 'unsafe-eval'");
        }
    }
});

test('DRAWSPIKE-007 requires an explicit sandbox capability allowlist', { skip: !manifestExists }, () => {
    const manifest = readManifest();

    assert.ok(manifest.security && typeof manifest.security === 'object', 'security must be an object');
    assertUniqueArray(manifest.security.sandbox, 'security.sandbox');
    assert.ok(manifest.security.sandbox.length > 0, 'security.sandbox must not be empty');
    assert.ok(manifest.security.sandbox.includes('allow-scripts'), 'security.sandbox must include allow-scripts');
    assert.ok(!manifest.security.sandbox.includes('allow-top-navigation'), 'security.sandbox must not include allow-top-navigation');
    assert.ok(
        !manifest.security.sandbox.includes('allow-top-navigation-by-user-activation'),
        'security.sandbox must not include allow-top-navigation-by-user-activation'
    );
    assert.ok(
        !manifest.security.sandbox.includes('allow-popups-to-escape-sandbox'),
        'security.sandbox must not include allow-popups-to-escape-sandbox'
    );
});

test('DRAWSPIKE-008 requires explicit protocol allowlists with no path or command semantics', { skip: !manifestExists }, () => {
    const manifest = readManifest();

    assert.ok(manifest.protocol && typeof manifest.protocol === 'object', 'protocol must be an object');
    assertUniqueArray(manifest.protocol.hostToEditor, 'protocol.hostToEditor');
    assertUniqueArray(manifest.protocol.editorToHost, 'protocol.editorToHost');
    assert.ok(manifest.protocol.hostToEditor.includes('load'), 'protocol.hostToEditor must include load');
    assert.ok(manifest.protocol.hostToEditor.includes('export'), 'protocol.hostToEditor must include export');
    assert.ok(manifest.protocol.editorToHost.includes('init'), 'protocol.editorToHost must include init');
    assert.ok(manifest.protocol.editorToHost.includes('save'), 'protocol.editorToHost must include save');
    assert.ok(manifest.protocol.editorToHost.includes('export'), 'protocol.editorToHost must include export');
    assert.ok(manifest.protocol.editorToHost.includes('exit'), 'protocol.editorToHost must include exit');

    for (const channelName of ['hostToEditor', 'editorToHost']) {
        for (const messageName of manifest.protocol[channelName]) {
            assert.match(messageName, /^[a-z][a-z0-9-]*$/i, `protocol ${channelName} message ${messageName} must be a simple identifier`);
            assert.ok(
                !/(path|uri|file|command|execute)/i.test(messageName),
                `protocol ${channelName} message ${messageName} must not imply path, URI, file, command, or execute semantics`
            );
        }
    }
});

test('DRAWSPIKE-009 rejects placeholder language inside the runtime manifest', { skip: !manifestExists }, () => {
    const manifestSource = fs.readFileSync(manifestPath, 'utf8');
    assertNoPlaceholderMarkers(manifestSource, 'runtime manifest');
});

test('DRAWSPIKE-010 keeps the acceptance harness self-contained on Node built-ins only', () => {
    const testSource = fs.readFileSync(__filename, 'utf8');
    const requires = Array.from(testSource.matchAll(/require\('([^']+)'\)/g), match => match[1]).sort();

    assert.deepEqual(requires, ['node:assert/strict', 'node:crypto', 'node:fs', 'node:path', 'node:test']);
    assertNoPlaceholderMarkers(testSource, 'acceptance harness');
});
