const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const runtimeRoot = path.join(repoRoot, 'drawio-editor', 'runtime');
const manifestPath = path.join(runtimeRoot, 'runtime-manifest.json');
const descriptorPath = path.join(runtimeRoot, 'runtime-artifact.json');
const relativeManifestPath = path.relative(repoRoot, manifestPath);
const relativeDescriptorPath = path.relative(repoRoot, descriptorPath);
const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const descriptorExists = fs.existsSync(descriptorPath);
const placeholderTokens = ['TO' + 'DO', 'T' + 'BD', 'FIX' + 'ME'];
const missingDescriptorMessage =
    'DIO-P4A requires a repository-local runtime audit descriptor at '
    + relativeDescriptorPath
    + '. Add drawio-editor/runtime/runtime-artifact.json with audited provenance, CSP, exact-origin messaging, LICENSE, SBOM, acquisition-audit metadata, and activation-audit gating before replacing blocked.html.';

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

function assertObject(value, label) {
    assert.ok(value && typeof value === 'object' && !Array.isArray(value), `${label} must be an object`);
    return value;
}

function assertArray(value, label) {
    assert.ok(Array.isArray(value), `${label} must be an array`);
    return value;
}

function assertNonEmptyString(value, label) {
    assert.equal(typeof value, 'string', `${label} must be a string`);
    assert.ok(value.trim().length > 0, `${label} must not be empty`);
    return value;
}

function assertLocalRuntimePath(value, label, options = {}) {
    const { mustExist = true, expectedType = 'file' } = options;
    assert.ok(isLocalRelativePath(value), `${label} must be a repository-local relative path without URL schemes`);
    const absolutePath = path.resolve(runtimeRoot, value);
    assert.ok(isContainedPath(runtimeRoot, absolutePath), `${label} must stay within drawio-editor/runtime`);

    const runtimeRealPath = fs.realpathSync(runtimeRoot);
    const parentPath = path.dirname(absolutePath);
    assert.ok(fs.existsSync(parentPath), `${label} parent directory must exist under drawio-editor/runtime`);
    const parentRealPath = fs.realpathSync(parentPath);
    assert.ok(
        isContainedPath(runtimeRealPath, parentRealPath),
        `${label} parent directory resolves outside drawio-editor/runtime; symlink escapes are forbidden`
    );

    if (!fs.existsSync(absolutePath)) {
        assert.ok(!mustExist, `${label} must exist as a contained local ${expectedType}`);
        return absolutePath;
    }

    const entryStats = fs.lstatSync(absolutePath);
    assert.ok(!entryStats.isSymbolicLink(), `${label} must not be a symlink`);
    const entryRealPath = fs.realpathSync(absolutePath);
    assert.ok(
        isContainedPath(runtimeRealPath, entryRealPath),
        `${label} resolves outside drawio-editor/runtime; symlink escapes are forbidden`
    );
    if (expectedType === 'file') {
        assert.ok(entryStats.isFile(), `${label} must resolve to a regular file`);
    }
    return absolutePath;
}

function sha256Hex(absolutePath) {
    return crypto.createHash('sha256').update(fs.readFileSync(absolutePath)).digest('hex');
}

function readJson(absolutePath, label) {
    const source = fs.readFileSync(absolutePath, 'utf8');
    assertNoPlaceholderMarkers(source, label);
    return JSON.parse(source);
}

function readDescriptor() {
    return readJson(descriptorPath, 'runtime artifact descriptor');
}

function assertNoPlaceholderMarkers(source, label) {
    for (const token of placeholderTokens) {
        assert.ok(!new RegExp(`\\b${token}\\b`).test(source), `${label} must not contain placeholder markers`);
    }
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
            `descriptor.security.csp must not repeat the ${directiveName} directive`
        );
        directives.set(directiveName, parts.slice(1));
    }
    return directives;
}

function findManifestAssetByPath(manifestObject, assetPath) {
    if (manifestObject.assets === undefined) {
        return null;
    }
    const assets = assertArray(manifestObject.assets, 'runtime-manifest.json assets');
    return assets.find(asset => asset && asset.path === assetPath) ?? null;
}

function assertReadyForActivationBinding(manifestObject, compatibility, provenance, activation, activationEntrypointPath) {
    assert.equal(compatibility.status, 'approved', 'compatibility.status must equal approved once activation is fully authorized');
    assert.notEqual(manifestObject.entrypoint, 'blocked.html', 'runtime-manifest entrypoint must move off blocked.html once activation is fully authorized');
    assert.equal(
        manifestObject.entrypoint,
        activation.entrypoint,
        'runtime-manifest entrypoint must exactly match descriptor.activation.entrypoint once activation is fully authorized'
    );
    const entrypointPath = assertLocalRuntimePath(manifestObject.entrypoint, 'runtime-manifest entrypoint');
    assert.equal(
        entrypointPath,
        activationEntrypointPath,
        'runtime-manifest entrypoint must resolve to the same contained file as descriptor.activation.entrypoint once activation is fully authorized'
    );
    assert.equal(
        sha256Hex(entrypointPath),
        activation.sha256,
        'the activated runtime-manifest entrypoint must match descriptor.activation.sha256'
    );

    const manifestAsset = findManifestAssetByPath(manifestObject, manifestObject.entrypoint);
    if (manifestAsset) {
        const assetRecord = assertObject(manifestAsset, 'runtime-manifest.json activated entrypoint asset');
        assert.equal(
            assetRecord.sha256,
            activation.sha256,
            'runtime-manifest assets entry for the activated entrypoint must match descriptor.activation.sha256'
        );
    }

    assert.equal(
        provenance.usability,
        'usable',
        'runtime-manifest provenance.usability must equal usable once activation is fully authorized'
    );
}

function getActivationReadiness(descriptor) {
    const lifecycle = assertObject(descriptor.lifecycle, 'descriptor.lifecycle');
    const security = assertObject(descriptor.security, 'descriptor.security');
    const phase0HostGate = assertObject(security.phase0HostSecurityGate, 'descriptor.security.phase0HostSecurityGate');
    const descriptorReady = lifecycle.status === 'ready';
    const activation = descriptor.activation === undefined
        ? null
        : assertObject(descriptor.activation, 'descriptor.activation');
    const activationAudit = security.activationAudit === undefined
        ? null
        : assertObject(security.activationAudit, 'descriptor.security.activationAudit');
    const activationEntrypointPath = activation === null
        ? null
        : assertLocalRuntimePath(activation.entrypoint, 'descriptor.activation.entrypoint', { mustExist: descriptorReady });
    const activationEntrypointDigestMatches = activation !== null
        && activationEntrypointPath !== null
        && fs.existsSync(activationEntrypointPath)
        && /^[a-f0-9]{64}$/.test(activation.sha256)
        && sha256Hex(activationEntrypointPath) === activation.sha256;
    const activationAuditPath = activationAudit === null
        ? null
        : assertLocalRuntimePath(activationAudit.path, 'descriptor.security.activationAudit.path', { mustExist: descriptorReady });
    const activationAuditDigestMatches = activationAudit !== null
        && activationAuditPath !== null
        && fs.existsSync(activationAuditPath)
        && /^[a-f0-9]{64}$/.test(activationAudit.sha256)
        && sha256Hex(activationAuditPath) === activationAudit.sha256;
    const phase0HostGateActive = phase0HostGate.authority === 'required' && phase0HostGate.formallyActivated === true;
    const readyForActivation = descriptorReady
        && activation !== null
        && activationAudit !== null
        && activationAudit.verdict === 'approved'
        && activationEntrypointDigestMatches
        && activationAuditDigestMatches
        && phase0HostGateActive;

    return {
        activation,
        activationAudit,
        activationAuditPath,
        activationEntrypointPath,
        descriptorReady,
        phase0HostGate,
        readyForActivation,
    };
}

function assertTextFileWithoutPlaceholders(absolutePath, label) {
    const source = fs.readFileSync(absolutePath, 'utf8');
    assertNoPlaceholderMarkers(source, label);
}

function collectUnsafeDirectiveOccurrences(directives) {
    const matches = [];
    for (const [directive, sources] of directives.entries()) {
        for (const source of sources) {
            if (source === "'unsafe-inline'" || source === "'unsafe-eval'") {
                matches.push({ directive, source });
            }
        }
    }
    return matches;
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

function getManifestLocals() {
    const manifestObject = assertObject(manifest, 'runtime-manifest.json');
    const compatibility = assertObject(manifestObject.compatibility, 'runtime-manifest.json compatibility');
    const provenance = assertObject(manifestObject.provenance, 'runtime-manifest.json provenance');
    const integration = assertObject(provenance.integration, 'runtime-manifest.json provenance.integration');
    return { manifestObject, compatibility, provenance, integration };
}

test('DIO-P4A-001 expects drawio-editor/runtime/runtime-artifact.json before blocked.html can be replaced', () => {
    assert.equal(relativeManifestPath, path.join('drawio-editor', 'runtime', 'runtime-manifest.json'));
    assert.equal(relativeDescriptorPath, path.join('drawio-editor', 'runtime', 'runtime-artifact.json'));
    assert.ok(descriptorExists, missingDescriptorMessage);
});

test('DIO-P4A-002 keeps the acceptance harness self-contained on Node built-ins only', () => {
    const testSource = fs.readFileSync(__filename, 'utf8');
    const requires = Array.from(testSource.matchAll(/require\('([^']+)'\)/g), match => match[1]).sort();

    assert.deepEqual(requires, ['node:assert/strict', 'node:crypto', 'node:fs', 'node:path', 'node:test']);
    assertNoPlaceholderMarkers(testSource, 'Phase 4A acceptance harness');
});

test('Phase 4A helper rejects duplicate CSP directives before overwrite', () => {
    assert.throws(
        () => getCspDirectives("default-src 'none'; script-src 'self'; Script-Src 'unsafe-inline'; connect-src 'none'"),
        /must not repeat the script-src directive/
    );
    assert.throws(
        () => getCspDirectives("default-src 'none'; connect-src 'none'; CONNECT-SRC https:\/\/example\.com"),
        /must not repeat the connect-src directive/
    );
});

test('Phase 4A helper binds activated runtime entrypoint to descriptor.activation.entrypoint exactly', () => {
    const compatibilityPath = path.join(runtimeRoot, 'COMPATIBILITY.md');
    const compatibilitySha256 = sha256Hex(compatibilityPath);
    const manifestObject = {
        entrypoint: 'COMPATIBILITY.md',
        assets: [
            {
                path: 'COMPATIBILITY.md',
                sha256: compatibilitySha256,
            },
        ],
    };
    const compatibility = { status: 'approved' };
    const provenance = { usability: 'usable' };
    const activation = {
        entrypoint: 'COMPATIBILITY.md',
        sha256: compatibilitySha256,
    };
    const activationEntrypointPath = compatibilityPath;

    assert.throws(
        () => assertReadyForActivationBinding(
            {
                ...manifestObject,
                entrypoint: 'COMPATIBILITY.md',
            },
            compatibility,
            provenance,
            {
                ...activation,
                entrypoint: 'blocked.html',
            },
            activationEntrypointPath
        ),
        /must exactly match descriptor\.activation\.entrypoint/
    );
    assert.throws(
        () => assertReadyForActivationBinding(
            manifestObject,
            compatibility,
            provenance,
            {
                ...activation,
                sha256: '0'.repeat(64),
            },
            activationEntrypointPath
        ),
        /must match descriptor\.activation\.sha256/
    );
    assert.throws(
        () => assertReadyForActivationBinding(
            {
                ...manifestObject,
                assets: [
                    {
                        path: 'COMPATIBILITY.md',
                        sha256: '1'.repeat(64),
                    },
                ],
            },
            compatibility,
            provenance,
            activation,
            activationEntrypointPath
        ),
        /assets entry for the activated entrypoint must match descriptor\.activation\.sha256/
    );
});

test('Phase 4A helper requires activation audit approval and does not treat acquisition audit pass as activation approval', () => {
    const compatibilityPath = path.join(runtimeRoot, 'COMPATIBILITY.md');
    const compatibilitySha256 = sha256Hex(compatibilityPath);
    const descriptor = {
        lifecycle: {
            status: 'ready',
        },
        activation: {
            entrypoint: 'COMPATIBILITY.md',
            sha256: compatibilitySha256,
        },
        security: {
            acquisitionAudit: {
                path: 'audits/drawio-30.0.4-acquisition-audit.md',
                sha256: 'bcc107cc5c868f6a4b4641218fc595b0345225f6daa765cc2a81873ff46e5527',
                verdict: 'pass',
            },
            phase0HostSecurityGate: {
                authority: 'required',
                exceptionMetadataOverride: false,
                formallyActivated: true,
            },
        },
    };

    assert.equal(
        getActivationReadiness(descriptor).readyForActivation,
        false,
        'descriptor.security.acquisitionAudit pass alone must not satisfy activation readiness without descriptor.security.activationAudit approved'
    );
});

test('DIO-P4A-003 defines the shallow descriptor schema, exact version match, explicit lifecycle gate, and browser-only target', { skip: !descriptorExists }, () => {
    const descriptor = readDescriptor();
    const lifecycle = assertObject(descriptor.lifecycle, 'descriptor.lifecycle');

    assert.equal(descriptor.schemaVersion, 1, 'descriptor.schemaVersion must equal 1');
    assert.equal(
        descriptor.runtimeVersion,
        manifest.runtimeVersion,
        `descriptor.runtimeVersion must exactly match ${relativeManifestPath} runtimeVersion`
    );
    assert.equal(typeof lifecycle.status, 'string', 'descriptor.lifecycle.status must be a string');
    assert.match(
        lifecycle.status,
        /^(?:ready|blocked|audit-pending|artifact-pending)$/,
        'descriptor.lifecycle.status must be an explicit gate such as ready, blocked, audit-pending, or artifact-pending'
    );
    assert.equal(descriptor.target, 'browser', 'descriptor.target must declare the browser-only Phase 4A target');
});

test('DIO-P4A-004 requires pinned upstream provenance, reproducible recipe, local retained artifact path, and SHA-256 metadata', { skip: !descriptorExists }, () => {
    const descriptor = readDescriptor();
    const { integration: manifestIntegration } = getManifestLocals();
    const upstream = assertObject(descriptor.upstream, 'descriptor.upstream');
    const retainedArtifact = assertObject(descriptor.retainedArtifact, 'descriptor.retainedArtifact');
    const provenance = assertObject(descriptor.provenance, 'descriptor.provenance');
    const integration = assertObject(provenance.integration, 'descriptor.provenance.integration');

    assert.equal(upstream.identity, 'diagrams.net', 'descriptor.upstream.identity must declare diagrams.net');
    assert.equal(
        upstream.version,
        manifest.runtimeVersion,
        'descriptor.upstream.version must exactly match runtime-manifest.json'
    );
    assert.match(
        upstream.sourceArchiveSha256,
        /^[a-f0-9]{64}$/,
        'descriptor.upstream.sourceArchiveSha256 must be a lowercase SHA-256 hex digest'
    );
    const recipePath = assertLocalRuntimePath(upstream.recipePath, 'descriptor.upstream.recipePath');
    assertTextFileWithoutPlaceholders(recipePath, 'runtime build recipe');

    const retainedArtifactPath = assertLocalRuntimePath(retainedArtifact.path, 'descriptor.retainedArtifact.path');
    assert.match(
        retainedArtifact.sha256,
        /^[a-f0-9]{64}$/,
        'descriptor.retainedArtifact.sha256 must be a lowercase SHA-256 hex digest'
    );
    assert.equal(sha256Hex(retainedArtifactPath), retainedArtifact.sha256, 'descriptor.retainedArtifact.sha256 must match the local retained runtime artifact');

    assert.equal(
        integration.identity,
        manifestIntegration.identity,
        'descriptor.provenance.integration.identity must exactly match runtime-manifest.json'
    );
    assert.match(
        integration.commit,
        /^[a-f0-9]{40}$/,
        'descriptor.provenance.integration.commit must be a full lowercase git commit hash'
    );
    assert.equal(
        integration.commit,
        manifestIntegration.commit,
        'descriptor.provenance.integration.commit must exactly match runtime-manifest.json'
    );
    assert.match(
        integration.archiveSha256,
        /^[a-f0-9]{64}$/,
        'descriptor.provenance.integration.archiveSha256 must be a lowercase SHA-256 hex digest'
    );
    assert.equal(
        integration.archiveSha256,
        manifestIntegration.archiveSha256,
        'descriptor.provenance.integration.archiveSha256 must exactly match runtime-manifest.json'
    );
});

test('DIO-P4A-005 requires contained LICENSE, SPDX-style SBOM, and passing acquisition audit metadata', { skip: !descriptorExists }, () => {
    const descriptor = readDescriptor();
    const compliance = assertObject(descriptor.compliance, 'descriptor.compliance');
    const security = assertObject(descriptor.security, 'descriptor.security');
    const acquisitionAudit = assertObject(security.acquisitionAudit, 'descriptor.security.acquisitionAudit');

    const licensePath = assertLocalRuntimePath(compliance.licensePath, 'descriptor.compliance.licensePath');
    const sbomPath = assertLocalRuntimePath(compliance.sbomPath, 'descriptor.compliance.sbomPath');
    assertTextFileWithoutPlaceholders(licensePath, 'runtime license file');
    const sbom = readJson(sbomPath, 'runtime SBOM');
    assert.equal(typeof sbom.spdxVersion, 'string', 'descriptor.compliance.sbomPath must point to an SPDX-style SBOM JSON document');

    const auditPath = assertLocalRuntimePath(acquisitionAudit.path, 'descriptor.security.acquisitionAudit.path');
    assert.match(
        acquisitionAudit.sha256,
        /^[a-f0-9]{64}$/,
        'descriptor.security.acquisitionAudit.sha256 must be a lowercase SHA-256 hex digest'
    );
    assert.equal(sha256Hex(auditPath), acquisitionAudit.sha256, 'descriptor.security.acquisitionAudit.sha256 must match the acquisition audit record');
    assert.equal(acquisitionAudit.verdict, 'pass', 'descriptor.security.acquisitionAudit.verdict must equal pass for retained artifact integrity evidence');
    assertTextFileWithoutPlaceholders(auditPath, 'runtime acquisition audit');
});

test('DIO-P4A-006 requires strict CSP, exact target origin, empty network origins, no wildcards, and audited unsafe exceptions', { skip: !descriptorExists }, () => {
    const descriptor = readDescriptor();
    const security = assertObject(descriptor.security, 'descriptor.security');
    const csp = assertNonEmptyString(security.csp, 'descriptor.security.csp');
    const unsafeExceptions = security.unsafeExceptions === undefined
        ? []
        : assertArray(security.unsafeExceptions, 'descriptor.security.unsafeExceptions');
    const phase0HostGate = assertObject(security.phase0HostSecurityGate, 'descriptor.security.phase0HostSecurityGate');

    assert.equal(
        security.exactTargetOriginRequired,
        true,
        'descriptor.security.exactTargetOriginRequired must require exact postMessage targetOrigin matching'
    );
    assert.deepEqual(security.networkOrigins, [], 'descriptor.security.networkOrigins must remain an empty list');
    assert.equal(
        phase0HostGate.authority,
        'required',
        'descriptor.security.phase0HostSecurityGate.authority must record that the Phase 0 host CSP/security gate remains required'
    );
    assert.equal(
        phase0HostGate.exceptionMetadataOverride,
        false,
        'descriptor.security.phase0HostSecurityGate.exceptionMetadataOverride must remain false until formal activation'
    );

    const directives = getCspDirectives(csp);
    assert.ok(directives.size > 0, 'descriptor.security.csp must define at least one directive');
    assert.ok(directives.has('default-src'), 'descriptor.security.csp must define default-src');
    assert.ok(directives.has('connect-src'), 'descriptor.security.csp must define connect-src');
    assert.deepEqual(
        directives.get('default-src'),
        ["'none'"],
        'descriptor.security.csp default-src must equal exactly \'none\''
    );
    assert.deepEqual(
        directives.get('connect-src'),
        ["'none'"],
        'descriptor.security.csp connect-src must equal exactly \'none\''
    );
    for (const [directive, sources] of directives.entries()) {
        for (const source of sources) {
            assertNoNetworkCapableSource(source, directive);
        }
    }

    const unsafeOccurrences = collectUnsafeDirectiveOccurrences(directives);
    for (const occurrence of unsafeOccurrences) {
        const matchingException = unsafeExceptions.find(exceptionEntry =>
            exceptionEntry
            && exceptionEntry.directive === occurrence.directive
            && exceptionEntry.source === occurrence.source
        );
        assert.ok(
            matchingException,
            `CSP ${occurrence.directive} ${occurrence.source} requires an explicit audited unsafe exception entry`
        );
        assertNonEmptyString(matchingException.rationale, 'unsafe exception rationale');
        assert.equal(
            matchingException.activationScope,
            'descriptor-only',
            'unsafe exception activationScope must remain descriptor-only until the Phase 0 host CSP/security gate is formally lifted'
        );
        const evidencePath = assertLocalRuntimePath(matchingException.evidencePath, 'unsafe exception evidencePath');
        assert.equal(
            matchingException.acceptedRiskStatus,
            'accepted',
            'unsafe exception acceptedRiskStatus must equal accepted'
        );
        assertTextFileWithoutPlaceholders(evidencePath, 'unsafe exception evidence');
    }

    for (const unsafeException of unsafeExceptions) {
        assert.ok(
            unsafeOccurrences.some(occurrence =>
                occurrence.directive === unsafeException.directive
                && occurrence.source === unsafeException.source
            ),
            'unsafe exception entries must correspond to actual CSP unsafe directives'
        );
    }
});

test('DIO-P4A-007 couples descriptor readiness to compatibility activation and blocked entrypoint policy', { skip: !descriptorExists }, () => {
    const descriptor = readDescriptor();
    const { manifestObject, compatibility, provenance } = getManifestLocals();
    const {
        activation,
        activationAudit,
        activationEntrypointPath,
        phase0HostGate,
        readyForActivation,
    } = getActivationReadiness(descriptor);

    assert.equal(typeof manifestObject.entrypoint, 'string', 'runtime-manifest entrypoint must be a string');

    if (readyForActivation) {
        assertReadyForActivationBinding(
            manifestObject,
            compatibility,
            provenance,
            activation,
            activationEntrypointPath
        );
    } else {
        assert.ok(
            activation === null || activation.entrypoint !== 'blocked.html',
            'descriptor.activation must not fabricate blocked.html as a browser activation entrypoint'
        );
        assert.ok(
            activationAudit === null || activationAudit.verdict !== 'approved' || phase0HostGate.formallyActivated === true,
            'activation approval metadata alone cannot bypass the Phase 0 formal activation gate'
        );
        assert.equal(compatibility.status, 'blocked', 'compatibility.status must remain blocked until readiness, activation entrypoint, activation audit approval, and Phase 0 host-gate activation all pass');
        assert.equal(manifestObject.entrypoint, 'blocked.html', 'runtime-manifest entrypoint must remain blocked.html until readiness, activation entrypoint, activation audit approval, and Phase 0 host-gate activation all pass');
        assert.equal(
            provenance.usability,
            'blocked',
            'runtime-manifest provenance.usability must remain blocked until readiness, activation entrypoint, activation audit approval, and Phase 0 host-gate activation all pass'
        );
    }
});

test('DIO-P4A-008 rejects placeholder markers in the descriptor and referenced JSON or text records', { skip: !descriptorExists }, () => {
    const descriptor = readDescriptor();
    const upstream = assertObject(descriptor.upstream, 'descriptor.upstream');
    const compliance = assertObject(descriptor.compliance, 'descriptor.compliance');
    const security = assertObject(descriptor.security, 'descriptor.security');
    const acquisitionAudit = assertObject(security.acquisitionAudit, 'descriptor.security.acquisitionAudit');
    const provenance = assertObject(descriptor.provenance, 'descriptor.provenance');
    const integration = assertObject(provenance.integration, 'descriptor.provenance.integration');

    assertNonEmptyString(integration.identity, 'descriptor.provenance.integration.identity');
    assert.match(integration.commit, /^[a-f0-9]{40}$/, 'descriptor.provenance.integration.commit must be a full lowercase git commit hash');
    assert.match(
        integration.archiveSha256,
        /^[a-f0-9]{64}$/,
        'descriptor.provenance.integration.archiveSha256 must be a lowercase SHA-256 hex digest'
    );
    const referencedTextOrJsonPaths = [
        assertLocalRuntimePath(upstream.recipePath, 'descriptor.upstream.recipePath'),
        assertLocalRuntimePath(compliance.licensePath, 'descriptor.compliance.licensePath'),
        assertLocalRuntimePath(compliance.sbomPath, 'descriptor.compliance.sbomPath'),
        assertLocalRuntimePath(acquisitionAudit.path, 'descriptor.security.acquisitionAudit.path'),
    ];

    for (const absolutePath of referencedTextOrJsonPaths) {
        assertTextFileWithoutPlaceholders(absolutePath, path.relative(repoRoot, absolutePath));
    }
});
