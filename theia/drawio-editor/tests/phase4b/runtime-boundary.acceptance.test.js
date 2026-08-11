const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const runtimeRoot = path.join(repoRoot, 'drawio-editor', 'runtime');
const manifestPath = path.join(runtimeRoot, 'runtime-manifest.json');
const descriptorPath = path.join(runtimeRoot, 'runtime-artifact.json');
const packageJsonPath = path.join(repoRoot, 'package.json');
const extensionPackageJsonPath = path.join(repoRoot, 'drawio-editor', 'package.json');
const placeholderTokens = ['TO' + 'DO', 'T' + 'BD', 'FIX' + 'ME'];
const allowedHarnessRequires = [
    '@theia/core/lib/node/backend-application',
    '@theia/core/shared/inversify',
    'fs',
    'node:assert/strict',
    'node:fs',
    'node:path',
    'node:test'
];

const plannedModulePaths = {
    commonPolicySource: path.join(repoRoot, 'drawio-editor', 'src', 'common', 'drawio-runtime-origin-policy.ts'),
    commonPolicyCompiled: path.join(repoRoot, 'drawio-editor', 'lib', 'common', 'drawio-runtime-origin-policy.js'),
    browserFrameSource: path.join(repoRoot, 'drawio-editor', 'src', 'browser', 'drawio-runtime-frame.ts'),
    browserFrameCompiled: path.join(repoRoot, 'drawio-editor', 'lib', 'browser', 'drawio-runtime-frame.js'),
    nodeEndpointSource: path.join(repoRoot, 'drawio-editor', 'src', 'node', 'drawio-runtime-endpoint.ts'),
    nodeEndpointCompiled: path.join(repoRoot, 'drawio-editor', 'lib', 'node', 'drawio-runtime-endpoint.js'),
    backendModuleSource: path.join(repoRoot, 'drawio-editor', 'src', 'node', 'drawio-backend-module.ts'),
    backendModuleCompiled: path.join(repoRoot, 'drawio-editor', 'lib', 'node', 'drawio-backend-module.js')
};

const implementationReady = Object.values(plannedModulePaths).every(fs.existsSync);
const missingImplementationMessage =
    'DIO-P4B requires a dedicated cross-origin runtime boundary implementation. Add '
    + 'drawio-editor/src/common/drawio-runtime-origin-policy.ts, '
    + 'drawio-editor/src/browser/drawio-runtime-frame.ts, '
    + 'drawio-editor/src/node/drawio-runtime-endpoint.ts, '
    + 'drawio-editor/src/node/drawio-backend-module.ts, build drawio-editor, '
    + 'and rerun `node --test drawio-editor/tests/phase4b/runtime-boundary.acceptance.test.js`.';

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

function normalizeOrigin(value, label) {
    assert.equal(typeof value, 'string', `${label} must be a string`);
    assert.ok(value.trim().length > 0, `${label} must not be empty`);
    assert.equal(value, value.trim(), `${label} must not include surrounding whitespace`);

    let parsed;
    try {
        parsed = new URL(value);
    } catch (error) {
        assert.fail(`${label} must be a valid absolute URL: ${error.message}`);
    }

    assert.ok(
        parsed.protocol === 'http:' || parsed.protocol === 'https:',
        `${label} must use http or https`
    );
    assert.ok(parsed.username === '' && parsed.password === '', `${label} must not include credentials`);
    assert.ok(parsed.pathname === '/' || parsed.pathname === '', `${label} must not include a path`);
    assert.equal(parsed.search, '', `${label} must not include a query string`);
    assert.equal(parsed.hash, '', `${label} must not include a fragment`);
    assert.ok(!parsed.hostname.includes('*'), `${label} must not include wildcard host patterns`);
    assert.ok(!/[{}]/.test(parsed.hostname), `${label} must not include template host markers`);

    return parsed.origin;
}

function assertDistinctOrigins(runtimeOriginInput, studioOriginInput) {
    const runtimeOrigin = normalizeOrigin(runtimeOriginInput, 'runtime origin');
    const studioOrigin = normalizeOrigin(studioOriginInput, 'studio origin');
    assert.notEqual(runtimeOrigin, studioOrigin, 'runtime origin must differ from studio origin');
    return { runtimeOrigin, studioOrigin };
}

function assertExactTargetOrigin(value, expectedOrigin) {
    assert.equal(value, expectedOrigin, 'host-to-frame messaging must target the exact normalized runtime origin');
    assert.notEqual(value, '*', 'host-to-frame messaging must never use wildcard target origin');
}

function assertAcceptedIncomingMessage(eventLike, expectedOrigin, expectedSource) {
    assert.equal(eventLike.origin, expectedOrigin, 'frame-to-host messaging must match the exact runtime origin');
    assert.equal(eventLike.source, expectedSource, 'frame-to-host messaging must match the exact frame source identity');
}

function getHeaderValue(headers, name) {
    const record = headers && typeof headers === 'object' ? headers : {};
    const expectedName = name.toLowerCase();
    for (const [key, value] of Object.entries(record)) {
        if (key.toLowerCase() === expectedName) {
            return value;
        }
    }
    return undefined;
}

function cloneHeadersWithoutName(headers, name) {
    const cloned = {};
    const expectedName = name.toLowerCase();
    for (const [key, value] of Object.entries(headers && typeof headers === 'object' ? headers : {})) {
        if (key.toLowerCase() !== expectedName) {
            cloned[key] = value;
        }
    }
    return cloned;
}

function cloneHeadersWithName(headers, name, value) {
    return {
        ...cloneHeadersWithoutName(headers, name),
        [name]: value
    };
}

function getCspDirectives(csp) {
    const directives = new Map();
    for (const directive of csp.split(';')) {
        const trimmedDirective = directive.trim();
        if (!trimmedDirective) {
            continue;
        }
        const parts = trimmedDirective.split(/\s+/);
        const directiveName = parts[0].toLowerCase();
        assert.ok(!directives.has(directiveName), `CSP must not repeat the ${directiveName} directive`);
        directives.set(directiveName, parts.slice(1));
    }
    return directives;
}

function assertNoPermissiveNetworkSource(source, directiveName) {
    assert.notEqual(source, "'unsafe-inline'", `${directiveName} must not allow unsafe-inline`);
    assert.notEqual(source, "'unsafe-eval'", `${directiveName} must not allow unsafe-eval`);
    assert.ok(!source.includes('*'), `${directiveName} must not use wildcard sources`);
    assert.ok(
        !/^(?:https?|wss?):$/i.test(source),
        `${directiveName} must not allow scheme-wide network sources`
    );
    assert.ok(
        !/^(?:https?|wss?):\/\//i.test(source),
        `${directiveName} must not allow explicit network origins`
    );
}

function assertBoundaryHeaders(headers, studioOrigin) {
    const csp = getHeaderValue(headers, 'content-security-policy');
    assert.equal(typeof csp, 'string', 'runtime endpoint must emit a Content-Security-Policy header');
    const directives = getCspDirectives(csp);

    assert.deepEqual(directives.get('default-src'), ["'none'"], "runtime CSP must set default-src 'none'");
    assert.deepEqual(directives.get('connect-src'), ["'none'"], "runtime CSP must set connect-src 'none'");
    assert.deepEqual(
        directives.get('frame-ancestors'),
        [studioOrigin],
        'runtime CSP must restrict frame-ancestors to the exact configured Studio origin'
    );

    for (const [directiveName, sources] of directives.entries()) {
        if (directiveName === 'frame-ancestors') {
            continue;
        }
        for (const source of sources) {
            assertNoPermissiveNetworkSource(source, directiveName);
        }
    }

    const contentTypeOptions = getHeaderValue(headers, 'x-content-type-options');
    assert.equal(contentTypeOptions, 'nosniff', 'runtime endpoint must emit X-Content-Type-Options: nosniff');

    const cacheControl = getHeaderValue(headers, 'cache-control');
    assert.equal(typeof cacheControl, 'string', 'runtime endpoint must emit a Cache-Control header');
    const normalizedCacheControl = cacheControl.toLowerCase();
    const isDevelopmentStyle = normalizedCacheControl === 'no-store';
    const isImmutableStyle =
        normalizedCacheControl.includes('immutable')
        && !normalizedCacheControl.includes('no-store')
        && !normalizedCacheControl.includes('public, max-age=0');
    assert.ok(
        isDevelopmentStyle || isImmutableStyle,
        'runtime endpoint must use no-store or an immutable content-addressed cache policy'
    );

    const cors = getHeaderValue(headers, 'access-control-allow-origin');
    assert.equal(cors, undefined, 'runtime endpoint must not emit permissive CORS headers');
}

function stripComments(source) {
    return source
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^\\])\/\/.*$/gm, '$1');
}

function requireImplementationFile(modulePath) {
    assert.ok(fs.existsSync(modulePath), `${path.relative(repoRoot, modulePath)} must exist`);
    return readText(modulePath, path.relative(repoRoot, modulePath));
}

function requireCompiledModule(modulePath) {
    assert.ok(fs.existsSync(modulePath), `${path.relative(repoRoot, modulePath)} must exist`);
    delete require.cache[require.resolve(modulePath)];
    return require(modulePath);
}

function assertHarnessRequiresAllowed(source, label) {
    const requires = Array.from(new Set(Array.from(source.matchAll(/require\('([^']+)'\)/g), match => match[1]))).sort();
    assert.deepEqual(requires, allowedHarnessRequires, `${label} must use only Node built-ins plus the minimum public Theia APIs required for backend DI activation checks`);
}

function assertNoExecutableIframeOrRuntimeFrameWiring(source, label) {
    const executableSource = stripComments(source);
    assert.ok(!/\bdrawio-runtime-frame\b/.test(executableSource), `${label} must not import or reference drawio-runtime-frame before activation`);
    assert.ok(!/\biframe\b/i.test(executableSource), `${label} must not contain executable iframe tokens before activation`);
    assert.ok(!/<iframe\b/i.test(executableSource), `${label} must not render iframe markup before activation`);
    assert.ok(
        !/\b(?:document\.)?createElement\(\s*['"]iframe['"]\s*\)/i.test(executableSource),
        `${label} must not create iframe elements before activation`
    );
    assert.ok(
        !/\bReact\s*\.\s*createElement\(\s*['"]iframe['"]\s*[,)]/i.test(executableSource),
        `${label} must not create iframe React elements before activation`
    );
}

function assertCurrentOrFutureTheiaExtensionShape(extensionPackage) {
    const currentFrontendOnlyShape = [{ frontend: 'lib/browser/drawio-frontend-module' }];
    const futureFrontendBackendShape = [{ frontend: 'lib/browser/drawio-frontend-module', backend: 'lib/node/drawio-backend-module' }];
    if (!implementationReady) {
        assert.deepEqual(
            extensionPackage.theiaExtensions,
            currentFrontendOnlyShape,
            'drawio-editor package.json must remain frontend-only until the runtime boundary implementation is complete'
        );
        return;
    }
    assert.deepEqual(
        extensionPackage.theiaExtensions,
        futureFrontendBackendShape,
        'drawio-editor package.json must advertise exactly one frontend/backend Theia extension entry once the runtime boundary implementation is complete'
    );
}

function loadCompiledBackendActivationHarness() {
    const { Container } = require('@theia/core/shared/inversify');
    const { BackendApplicationContribution } = require('@theia/core/lib/node/backend-application');
    return { Container, BackendApplicationContribution };
}

function createRequestLike(headers, encrypted = false) {
    const normalized = {};
    for (const [name, value] of Object.entries(headers || {})) {
        normalized[name.toLowerCase()] = value;
    }
    return {
        socket: { encrypted },
        get(name) {
            return normalized[name.toLowerCase()];
        }
    };
}

function captureConfiguredRouteHandler(endpoint) {
    let capturedPath;
    let capturedRouter;
    endpoint.configure({
        use(routePath, router) {
            capturedPath = routePath;
            capturedRouter = router;
        }
    });

    assert.equal(capturedPath, '/drawio-runtime', 'backend endpoint must register on /drawio-runtime');
    assert.ok(capturedRouter && Array.isArray(capturedRouter.stack), 'backend endpoint must register an Express router');
    assert.equal(capturedRouter.stack.length, 1, 'backend endpoint must register exactly one GET handler');

    const layer = capturedRouter.stack[0];
    assert.equal(layer.route.path, '/', 'backend router must serve only the blocked runtime root path');
    assert.deepEqual(layer.route.methods, { get: true }, 'backend router must expose only GET /');

    return layer.route.stack[0].handle;
}

function invokeRouteHandler(handler, request, readFileImpl) {
    const standardFs = require('fs');
    const nodeFs = require('node:fs');
    const originalStandardReadFile = standardFs.readFile;
    const originalNodeReadFile = nodeFs.readFile;

    if (readFileImpl) {
        standardFs.readFile = readFileImpl;
        nodeFs.readFile = readFileImpl;
    }

    return new Promise((resolve, reject) => {
        let finished = false;
        const response = {
            statusCode: 200,
            headers: {},
            contentType: undefined,
            body: undefined,
            status(code) {
                this.statusCode = code;
                return this;
            },
            set(headers) {
                this.headers = { ...this.headers, ...headers };
                return this;
            },
            type(contentType) {
                this.contentType = contentType;
                return this;
            },
            send(body) {
                this.body = body;
                if (!finished) {
                    finished = true;
                    resolve({
                        statusCode: this.statusCode,
                        headers: this.headers,
                        contentType: this.contentType,
                        body: this.body
                    });
                }
                return this;
            }
        };

        try {
            handler(request, response);
        } catch (error) {
            reject(error);
        }
    }).finally(() => {
        standardFs.readFile = originalStandardReadFile;
        nodeFs.readFile = originalNodeReadFile;
    });
}

function assertUnavailableResponse(result) {
    assert.equal(result.statusCode, 503, 'unavailable runtime responses must use HTTP 503');
    assert.equal(result.contentType, 'text/plain', 'unavailable runtime responses must be plain text');
    assert.equal(result.body, 'Draw.io runtime endpoint is unavailable.', 'unavailable runtime responses must stay stable and actionable');
    assert.equal(
        getHeaderValue(result.headers, 'content-security-policy'),
        "default-src 'none'; connect-src 'none'; frame-ancestors 'none'",
        'unavailable runtime responses must set the fail-closed CSP'
    );
    assert.equal(getHeaderValue(result.headers, 'x-content-type-options'), 'nosniff', 'unavailable runtime responses must keep nosniff');
    assert.equal(getHeaderValue(result.headers, 'cache-control'), 'no-store', 'unavailable runtime responses must disable caching');
    assert.equal(getHeaderValue(result.headers, 'access-control-allow-origin'), undefined, 'unavailable runtime responses must not enable CORS');
}

function captureThrownError(fn, expected, message) {
    let caught;
    assert.throws(() => {
        try {
            fn();
        } catch (error) {
            caught = error;
            throw error;
        }
    }, expected, message);
    return caught;
}

function assertErrorDoesNotExposeTokens(error, tokens, label) {
    assert.ok(error instanceof Error, `${label} must throw an Error instance`);
    for (const token of tokens) {
        if (token) {
            assert.doesNotMatch(error.message, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), `${label} must not expose trusted proxy token material`);
        }
    }
}

function assertExactSandboxTokens(tokens) {
    const normalized = Array.isArray(tokens) ? [...tokens] : [];
    assert.deepEqual(
        [...normalized].sort(),
        ['allow-same-origin', 'allow-scripts'],
        'browser frame sandbox must contain exactly allow-same-origin and allow-scripts'
    );
}

test('DIO-P4B-001 requires the future dedicated runtime-boundary implementation surfaces before Phase 4B implementation checks can run', () => {
    assert.equal(
        path.relative(repoRoot, plannedModulePaths.commonPolicySource),
        path.join('drawio-editor', 'src', 'common', 'drawio-runtime-origin-policy.ts')
    );
    assert.equal(
        path.relative(repoRoot, plannedModulePaths.browserFrameSource),
        path.join('drawio-editor', 'src', 'browser', 'drawio-runtime-frame.ts')
    );
    assert.equal(
        path.relative(repoRoot, plannedModulePaths.nodeEndpointSource),
        path.join('drawio-editor', 'src', 'node', 'drawio-runtime-endpoint.ts')
    );
    assert.equal(
        path.relative(repoRoot, plannedModulePaths.backendModuleSource),
        path.join('drawio-editor', 'src', 'node', 'drawio-backend-module.ts')
    );
    assert.ok(implementationReady, missingImplementationMessage);
});

test('DIO-P4B-002 helper rejects same-origin, non-http(s), credentialed, wildcard, templated, query, fragment, and relative runtime origins', () => {
    assert.deepEqual(
        assertDistinctOrigins('https://drawio-runtime.example.com', 'https://studio.example.com'),
        {
            runtimeOrigin: 'https://drawio-runtime.example.com',
            studioOrigin: 'https://studio.example.com'
        }
    );
    assert.throws(() => assertDistinctOrigins('https://studio.example.com', 'https://studio.example.com'), /must differ/);
    assert.throws(() => normalizeOrigin('/drawio', 'runtime origin'), /must be a valid absolute URL/);
    assert.throws(() => normalizeOrigin('data:text/html,hello', 'runtime origin'), /must use http or https/);
    assert.throws(() => normalizeOrigin('https://user:pass@drawio.example.com', 'runtime origin'), /must not include credentials/);
    assert.throws(() => normalizeOrigin('https://*.example.com', 'runtime origin'), /must not include wildcard host patterns/);
    assert.throws(() => normalizeOrigin('https://{tenant}.example.com', 'runtime origin'), /must not include template host markers/);
    assert.throws(() => normalizeOrigin('https://drawio.example.com/frame', 'runtime origin'), /must not include a path/);
    assert.throws(() => normalizeOrigin('https://drawio.example.com?x=1', 'runtime origin'), /must not include a query string/);
    assert.throws(() => normalizeOrigin('https://drawio.example.com#hash', 'runtime origin'), /must not include a fragment/);
});

test('DIO-P4B-003 helper rejects wildcard target origin and origin-only message checks without frame source identity', () => {
    const frameWindow = { name: 'frame-window' };
    const otherWindow = { name: 'other-window' };

    assert.doesNotThrow(() => assertExactTargetOrigin('https://drawio-runtime.example.com', 'https://drawio-runtime.example.com'));
    assert.throws(() => assertExactTargetOrigin('*', 'https://drawio-runtime.example.com'), /must target the exact normalized runtime origin/);
    assert.throws(
        () => assertAcceptedIncomingMessage({ origin: 'https://drawio-runtime.example.com', source: otherWindow }, 'https://drawio-runtime.example.com', frameWindow),
        /must match the exact frame source identity/
    );
});

test('DIO-P4B-004 helper rejects acquisition-only activation assumptions, preserves the blocked runtime state, and keeps Phase 3 iframe wiring authoritative until activation', () => {
    const manifest = readJson(manifestPath, 'runtime manifest');
    const descriptor = readJson(descriptorPath, 'runtime descriptor');
    const widgetSource = readText(path.join(repoRoot, 'drawio-editor', 'src', 'browser', 'drawio-editor-widget.tsx'), 'drawio-editor-widget.tsx');
    const widgetCompiled = readText(path.join(repoRoot, 'drawio-editor', 'lib', 'browser', 'drawio-editor-widget.js'), 'drawio-editor-widget.js');
    const frontendSource = readText(path.join(repoRoot, 'drawio-editor', 'src', 'browser', 'drawio-frontend-module.ts'), 'drawio-frontend-module.ts');
    const frontendCompiled = readText(path.join(repoRoot, 'drawio-editor', 'lib', 'browser', 'drawio-frontend-module.js'), 'drawio-frontend-module.js');

    assert.equal(manifest.compatibility.status, 'blocked', 'runtime-manifest.json must remain blocked today');
    assert.equal(manifest.entrypoint, 'blocked.html', 'runtime-manifest.json must remain on blocked.html today');
    assert.equal(manifest.provenance.usability, 'blocked', 'runtime-manifest.json usability must remain blocked today');
    assert.equal(descriptor.lifecycle.status, 'blocked', 'runtime-artifact.json lifecycle must remain blocked today');
    assert.equal(
        descriptor.security.acquisitionAudit.verdict,
        'pass',
        'runtime-artifact acquisition audit must remain recorded as pass'
    );
    assert.equal(
        Object.prototype.hasOwnProperty.call(descriptor.security, 'activationAudit'),
        false,
        'activationAudit must not be fabricated in the current blocked state'
    );
    assertNoExecutableIframeOrRuntimeFrameWiring(widgetSource, 'drawio-editor-widget.tsx');
    assertNoExecutableIframeOrRuntimeFrameWiring(widgetCompiled, 'drawio-editor-widget.js');
    assertNoExecutableIframeOrRuntimeFrameWiring(frontendSource, 'drawio-frontend-module.ts');
    assertNoExecutableIframeOrRuntimeFrameWiring(frontendCompiled, 'drawio-frontend-module.js');
});

test('DIO-P4B-005 helper accepts exact frame-ancestors while rejecting wildcard frame-ancestors and explicit connect-src origins, and the harness/package shape stay on the approved activation contract', () => {
    assert.doesNotThrow(() => assertBoundaryHeaders(
        {
            'Content-Security-Policy': "default-src 'none'; connect-src 'none'; frame-ancestors https://studio.example.com",
            'X-Content-Type-Options': 'nosniff',
            'Cache-Control': 'no-store'
        },
        'https://studio.example.com'
    ));
    assert.throws(
        () => assertBoundaryHeaders(
            {
                'Content-Security-Policy': "default-src 'none'; connect-src 'none'; frame-ancestors *",
                'X-Content-Type-Options': 'nosniff',
                'Cache-Control': 'no-store'
            },
            'https://studio.example.com'
        ),
        /must restrict frame-ancestors to the exact configured Studio origin/
    );
    assert.throws(
        () => assertBoundaryHeaders(
            {
                'Content-Security-Policy': "default-src 'none'; connect-src https://api.example.com; frame-ancestors https://studio.example.com",
                'X-Content-Type-Options': 'nosniff',
                'Cache-Control': 'no-store'
            },
            'https://studio.example.com'
        ),
        /connect-src 'none'/
    );

    const extensionPackage = readJson(extensionPackageJsonPath, 'drawio-editor package.json');
    assertCurrentOrFutureTheiaExtensionShape(extensionPackage);

    const source = fs.readFileSync(__filename, 'utf8');
    assertHarnessRequiresAllowed(source, 'Phase 4B acceptance harness');
    assertNoPlaceholderMarkers(source, 'Phase 4B acceptance harness');
});

test('DIO-P4B-006 implementation uses exported browser message-gate seams so invalid origin inputs reject up front, wrong origin or wrong source reject before parsing, and outbound messages target the exact runtime origin', { skip: !implementationReady }, () => {
    const browserFrame = requireCompiledModule(plannedModulePaths.browserFrameCompiled);
    const source = stripComments(requireImplementationFile(plannedModulePaths.browserFrameSource));

    assert.equal(typeof browserFrame.resolveDrawioRuntimeFrameConfig, 'function', 'compiled browser frame module must export resolveDrawioRuntimeFrameConfig');
    assert.equal(typeof browserFrame.acceptDrawioRuntimeMessage, 'function', 'compiled browser frame module must export acceptDrawioRuntimeMessage');
    assert.equal(typeof browserFrame.postDrawioRuntimeMessage, 'function', 'compiled browser frame module must export postDrawioRuntimeMessage');
    assert.match(source, /\bresolveDrawioRuntimeFrameConfig(?:<[^>(]+>)?\s*\(/, 'browser frame source must declare resolveDrawioRuntimeFrameConfig');
    assert.match(source, /\bacceptDrawioRuntimeMessage(?:<[^>(]+>)?\s*\(/, 'browser frame source must declare acceptDrawioRuntimeMessage');
    assert.match(source, /\bpostDrawioRuntimeMessage(?:<[^>(]+>)?\s*\(/, 'browser frame source must declare postDrawioRuntimeMessage');

    assert.throws(
        () => browserFrame.resolveDrawioRuntimeFrameConfig({
            runtimeOriginInput: 'https://studio.example.com',
            studioOriginInput: 'https://studio.example.com'
        }),
        /must differ/,
        'browser frame config must reject same-origin runtime and Studio deployments'
    );
    assert.throws(
        () => browserFrame.resolveDrawioRuntimeFrameConfig({
            runtimeOriginInput: 'https://drawio-runtime.example.com/frame',
            studioOriginInput: 'https://studio.example.com'
        }),
        /must not include a path/,
        'browser frame config must reject path-bearing runtime origins'
    );
    assert.throws(
        () => browserFrame.resolveDrawioRuntimeFrameConfig({
            runtimeOriginInput: 'https://*.example.com',
            studioOriginInput: 'https://studio.example.com'
        }),
        /must not include wildcard host patterns/,
        'browser frame config must reject wildcard runtime origins'
    );
    assert.throws(
        () => browserFrame.resolveDrawioRuntimeFrameConfig({
            runtimeOriginInput: 'https://{tenant}.example.com',
            studioOriginInput: 'https://studio.example.com'
        }),
        /must not include template host markers/,
        'browser frame config must reject templated runtime origins'
    );

    const frameConfig = browserFrame.resolveDrawioRuntimeFrameConfig({
        runtimeOriginInput: 'https://drawio-runtime.example.com',
        studioOriginInput: 'https://studio.example.com'
    });
    assert.deepEqual(
        frameConfig,
        {
            runtimeOrigin: 'https://drawio-runtime.example.com',
            studioOrigin: 'https://studio.example.com'
        },
        'browser frame config must expose exact normalized runtime and Studio origins'
    );

    const frameWindow = { name: 'frame-window' };
    const otherWindow = { name: 'other-window' };
    const parseCalls = [];
    const parseEditorMessage = payload => {
        parseCalls.push(payload);
        return { kind: 'parsed', payload };
    };

    assert.equal(
        browserFrame.acceptDrawioRuntimeMessage(
            { origin: 'https://wrong.example.com', source: frameWindow, data: { seq: 1 } },
            frameConfig.runtimeOrigin,
            frameWindow,
            parseEditorMessage
        ),
        undefined,
        'wrong-origin events must be rejected before parsing'
    );
    assert.equal(parseCalls.length, 0, 'wrong-origin events must not call parseEditorMessage');

    assert.equal(
        browserFrame.acceptDrawioRuntimeMessage(
            { origin: frameConfig.runtimeOrigin, source: otherWindow, data: { seq: 2 } },
            frameConfig.runtimeOrigin,
            frameWindow,
            parseEditorMessage
        ),
        undefined,
        'wrong-source events must be rejected before parsing'
    );
    assert.equal(parseCalls.length, 0, 'wrong-source events must not call parseEditorMessage');

    const accepted = browserFrame.acceptDrawioRuntimeMessage(
        { origin: frameConfig.runtimeOrigin, source: frameWindow, data: { seq: 3 } },
        frameConfig.runtimeOrigin,
        frameWindow,
        parseEditorMessage
    );
    assert.deepEqual(accepted, { kind: 'parsed', payload: { seq: 3 } }, 'accepted events must return the parser result');
    assert.deepEqual(parseCalls, [{ seq: 3 }], 'accepted events must parse exactly once');

    const outboundCalls = [];
    const targetWindow = {
        postMessage(payload, targetOrigin) {
            outboundCalls.push({ payload, targetOrigin });
        }
    };
    browserFrame.postDrawioRuntimeMessage(targetWindow, { kind: 'load' }, frameConfig.runtimeOrigin);
    assert.deepEqual(
        outboundCalls,
        [{ payload: { kind: 'load' }, targetOrigin: frameConfig.runtimeOrigin }],
        'outbound host messages must use the exact runtime origin'
    );
});

test('DIO-P4B-007 implementation constrains the sandbox allowlist exactly while the blocked outer editor and frontend stay iframe-free until activation', { skip: !implementationReady }, () => {
    const widgetSource = stripComments(requireImplementationFile(path.join(repoRoot, 'drawio-editor', 'src', 'browser', 'drawio-editor-widget.tsx')));
    const frontendSource = stripComments(requireImplementationFile(path.join(repoRoot, 'drawio-editor', 'src', 'browser', 'drawio-frontend-module.ts')));
    const browserFrame = requireCompiledModule(plannedModulePaths.browserFrameCompiled);

    assert.match(widgetSource, /\bclass\s+DrawioEditorWidget\s+extends\s+ReactWidget\b/, 'outer editor must remain a native ReactWidget');
    assert.ok(!/\bWebviewWidget\b|\bCustomEditorWidget\b|\bregisterCustomEditorProvider\b/.test(widgetSource), 'outer editor must not switch to a webview or VS Code custom editor path');
    assertNoExecutableIframeOrRuntimeFrameWiring(widgetSource, 'drawio-editor-widget.tsx');
    assertNoExecutableIframeOrRuntimeFrameWiring(frontendSource, 'drawio-frontend-module.ts');

    assert.ok(Array.isArray(browserFrame.DRAWIO_RUNTIME_SANDBOX), 'compiled browser frame module must export DRAWIO_RUNTIME_SANDBOX');
    assertExactSandboxTokens(browserFrame.DRAWIO_RUNTIME_SANDBOX);
    assert.throws(
        () => assertExactSandboxTokens([...browserFrame.DRAWIO_RUNTIME_SANDBOX, 'allow-popups']),
        /must contain exactly allow-same-origin and allow-scripts/
    );
});

test('DIO-P4B-008 implementation keeps the common origin policy pure and proves both browser and backend layers import and consume it', { skip: !implementationReady }, () => {
    const commonSource = stripComments(requireImplementationFile(plannedModulePaths.commonPolicySource));
    const commonCompiled = requireImplementationFile(plannedModulePaths.commonPolicyCompiled);
    const browserFrameSource = stripComments(requireImplementationFile(plannedModulePaths.browserFrameSource));
    const nodeEndpointSource = stripComments(requireImplementationFile(plannedModulePaths.nodeEndpointSource));

    assert.match(commonSource, /\bexport\s+function\s+normalizeDrawioRuntimeOrigin\b/, 'common policy module must export normalizeDrawioRuntimeOrigin');
    assert.match(commonSource, /\bexport\s+function\s+assertDistinctDrawioOrigins\b/, 'common policy module must export assertDistinctDrawioOrigins');
    assert.match(commonSource, /\bnew\s+URL\(/, 'common policy module must normalize origins via URL parsing');
    assert.match(commonSource, /\bprotocol\b/, 'common policy module must enforce protocol checks');
    assert.ok(!/\bwindow\b|\bdocument\b|\bfetch\b/.test(commonSource), 'common policy module must remain side-effect free and browser-independent');
    assert.match(commonCompiled, /exports\.normalizeDrawioRuntimeOrigin\s*=/, 'compiled common policy module must export normalizeDrawioRuntimeOrigin');
    assert.match(commonCompiled, /exports\.assertDistinctDrawioOrigins\s*=/, 'compiled common policy module must export assertDistinctDrawioOrigins');

    for (const [label, source] of [
        ['browser frame source', browserFrameSource],
        ['node endpoint source', nodeEndpointSource]
    ]) {
        assert.match(source, /\.\.\/common\/drawio-runtime-origin-policy/, `${label} must import the shared origin-policy module`);
        assert.match(source, /\bnormalizeDrawioRuntimeOrigin\s*\(/, `${label} must call normalizeDrawioRuntimeOrigin`);
        assert.match(source, /\bassertDistinctDrawioOrigins\s*\(/, `${label} must call assertDistinctDrawioOrigins`);
    }
});

test('DIO-P4B-009 implementation serves actual runtime security headers from a compiled native backend endpoint seam, enforces exact request-origin policy, and fails closed when blocked.html cannot be read', { skip: !implementationReady }, async () => {
    const nodeEndpoint = requireCompiledModule(plannedModulePaths.nodeEndpointCompiled);
    const nodeEndpointSource = stripComments(requireImplementationFile(plannedModulePaths.nodeEndpointSource));
    const trustedProxyToken = '12345678901234567890123456789012';
    const wrongTrustedProxyToken = 'abcdefghijklmnopqrstuvwxyzABCDEF';
    const weakTrustedProxyToken = 'too-short-trusted-token';

    assert.equal(typeof nodeEndpoint.buildDrawioRuntimeHeaders, 'function', 'compiled node endpoint module must export buildDrawioRuntimeHeaders');
    assert.equal(typeof nodeEndpoint.resolveDrawioRuntimeRequestOrigin, 'function', 'compiled node endpoint module must export resolveDrawioRuntimeRequestOrigin');
    assert.equal(typeof nodeEndpoint.assertDrawioRuntimeRequestOrigin, 'function', 'compiled node endpoint module must export assertDrawioRuntimeRequestOrigin');
    assert.equal(nodeEndpoint.DRAWIO_RUNTIME_TRUSTED_PROXY_TOKEN_ENV, 'DRAWIO_RUNTIME_TRUSTED_PROXY_TOKEN', 'compiled node endpoint module must export the trusted proxy token env name');
    assert.equal(nodeEndpoint.DRAWIO_RUNTIME_TRUSTED_PROXY_TOKEN_HEADER, 'x-drawio-runtime-proxy-token', 'compiled node endpoint module must export the trusted proxy token header name');
    assert.match(nodeEndpointSource, /\bbuildDrawioRuntimeHeaders\s*\(/, 'node endpoint source must declare buildDrawioRuntimeHeaders');
    assert.match(nodeEndpointSource, /\bresolveDrawioRuntimeRequestOrigin\s*\(/, 'node endpoint source must declare resolveDrawioRuntimeRequestOrigin');
    assert.match(nodeEndpointSource, /\bassertDrawioRuntimeRequestOrigin\s*\(/, 'node endpoint source must declare assertDrawioRuntimeRequestOrigin');
    assert.match(nodeEndpointSource, /\bBackendApplicationContribution\b/, 'node endpoint source must implement BackendApplicationContribution');
    assert.match(nodeEndpointSource, /\bconfigure\s*\(\s*app\b/, 'node endpoint source must expose a configure(app) backend entry point');
    assert.match(nodeEndpointSource, /\bassertDrawioRuntimeRequestOrigin\s*\(\s*\{/, 'backend route must call the request-origin guard before serving content');
    assert.match(nodeEndpointSource, /\btrustedProxyToken\s*:\s*this\.runtimeConfig\.trustedProxyToken\b/, 'backend route must pass trustedProxyToken from runtimeConfig into the request-origin guard');
    assert.match(nodeEndpointSource, /\bfs\.readFile\s*\(\s*BLOCKED_RUNTIME_FILE_PATH\s*,\s*'utf8'\s*,\s*\(\s*error\s*,\s*content\s*\)\s*=>/, 'backend route must read blocked.html through an explicit async callback');
    assert.match(nodeEndpointSource, /\bbuildUnavailableResponse\s*\(\s*response\s*\)/, 'backend route must reuse the deterministic unavailable response path');

    assert.throws(
        () => nodeEndpoint.buildDrawioRuntimeHeaders({
            runtimeOriginInput: 'https://studio.example.com',
            studioOriginInput: 'https://studio.example.com'
        }),
        /must differ/,
        'backend header builder must reject same-origin runtime and Studio deployments'
    );
    assert.throws(
        () => nodeEndpoint.buildDrawioRuntimeHeaders({
            runtimeOriginInput: 'https://drawio-runtime.example.com/frame',
            studioOriginInput: 'https://studio.example.com'
        }),
        /must not include a path/,
        'backend header builder must reject path-bearing runtime origins'
    );
    assert.throws(
        () => nodeEndpoint.buildDrawioRuntimeHeaders({
            runtimeOriginInput: 'https://*.example.com',
            studioOriginInput: 'https://studio.example.com'
        }),
        /must not include wildcard host patterns/,
        'backend header builder must reject wildcard runtime origins'
    );
    assert.throws(
        () => nodeEndpoint.buildDrawioRuntimeHeaders({
            runtimeOriginInput: 'https://drawio-runtime.example.com',
            studioOriginInput: 'https://{tenant}.example.com'
        }),
        /must not include template host markers/,
        'backend header builder must reject templated Studio origins'
    );

    const developmentHeaders = nodeEndpoint.buildDrawioRuntimeHeaders({
        runtimeOriginInput: 'https://drawio-runtime.example.com',
        studioOriginInput: 'https://studio.example.com'
    });
    const immutableHeaders = nodeEndpoint.buildDrawioRuntimeHeaders({
        runtimeOriginInput: 'https://drawio-runtime.example.com',
        studioOriginInput: 'https://studio.example.com',
        assetHash: '1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef'
    });

    assertBoundaryHeaders(developmentHeaders, 'https://studio.example.com');
    assertBoundaryHeaders(immutableHeaders, 'https://studio.example.com');
    assert.equal(getHeaderValue(developmentHeaders, 'cache-control').toLowerCase(), 'no-store', 'development headers must be no-store');
    assert.match(
        getHeaderValue(immutableHeaders, 'cache-control').toLowerCase(),
        /\bimmutable\b/,
        'content-addressed headers must be immutable'
    );
    assert.throws(
        () => assertBoundaryHeaders(
            cloneHeadersWithoutName(developmentHeaders, 'Content-Security-Policy'),
            'https://studio.example.com'
        ),
        /Content-Security-Policy/
    );
    assert.throws(
        () => assertBoundaryHeaders(
            cloneHeadersWithName(developmentHeaders, 'Cache-Control', 'public, max-age=0'),
            'https://studio.example.com'
        ),
        /no-store or an immutable content-addressed cache policy/
    );

    const directRequest = createRequestLike({
        host: 'drawio-runtime.example.com',
        'x-forwarded-proto': 'http',
        'x-forwarded-host': 'studio.example.com'
    }, true);
    assert.equal(
        nodeEndpoint.resolveDrawioRuntimeRequestOrigin(directRequest, false),
        'https://drawio-runtime.example.com',
        'direct socket scheme and raw Host must win when proxy trust is disabled, even with spoofed forwarded headers present'
    );

    const trustedForwardedRequestWithoutToken = createRequestLike({
        host: 'internal.example.local',
        'x-forwarded-proto': 'https',
        'x-forwarded-host': 'drawio-runtime.example.com'
    });
    const missingTrustedProxyTokenError = captureThrownError(
        () => nodeEndpoint.resolveDrawioRuntimeRequestOrigin(trustedForwardedRequestWithoutToken, true, trustedProxyToken),
        /x-drawio-runtime-proxy-token header is required/,
        'trusted proxy mode must reject matching forwarded origins before acceptance when the service token is missing'
    );
    assertErrorDoesNotExposeTokens(
        missingTrustedProxyTokenError,
        [trustedProxyToken, wrongTrustedProxyToken, weakTrustedProxyToken],
        'missing trusted proxy token errors'
    );

    const weakTrustedProxyTokenError = captureThrownError(
        () => nodeEndpoint.resolveDrawioRuntimeRequestOrigin(
            createRequestLike({
                host: 'internal.example.local',
                'x-forwarded-proto': 'https',
                'x-forwarded-host': 'drawio-runtime.example.com',
                'x-drawio-runtime-proxy-token': trustedProxyToken
            }),
            true,
            weakTrustedProxyToken
        ),
        /DRAWIO_RUNTIME_TRUSTED_PROXY_TOKEN must be configured with at least 32 UTF-8 bytes/,
        'trusted proxy mode must reject weak configured tokens'
    );
    assertErrorDoesNotExposeTokens(
        weakTrustedProxyTokenError,
        [trustedProxyToken, wrongTrustedProxyToken, weakTrustedProxyToken],
        'weak trusted proxy token errors'
    );

    const wrongTrustedProxyTokenError = captureThrownError(
        () => nodeEndpoint.resolveDrawioRuntimeRequestOrigin(
            createRequestLike({
                host: 'internal.example.local',
                'x-forwarded-proto': 'https',
                'x-forwarded-host': 'drawio-runtime.example.com',
                'x-drawio-runtime-proxy-token': wrongTrustedProxyToken
            }),
            true,
            trustedProxyToken
        ),
        /did not authenticate the trusted proxy request/,
        'trusted proxy mode must reject wrong trusted proxy tokens'
    );
    assertErrorDoesNotExposeTokens(
        wrongTrustedProxyTokenError,
        [trustedProxyToken, wrongTrustedProxyToken, weakTrustedProxyToken],
        'wrong trusted proxy token errors'
    );

    const trustedForwardedRequest = createRequestLike({
        host: 'internal.example.local',
        'x-forwarded-proto': 'https',
        'x-forwarded-host': 'drawio-runtime.example.com',
        'x-drawio-runtime-proxy-token': trustedProxyToken
    });
    assert.equal(
        nodeEndpoint.resolveDrawioRuntimeRequestOrigin(trustedForwardedRequest, true, trustedProxyToken),
        'https://drawio-runtime.example.com',
        'trusted proxy mode must accept one exact forwarded host/proto pair only after trusted proxy authentication succeeds'
    );
    assert.throws(
        () => nodeEndpoint.resolveDrawioRuntimeRequestOrigin(createRequestLike({
            host: 'drawio-runtime.example.com',
            'x-drawio-runtime-proxy-token': trustedProxyToken
        }, true), true, trustedProxyToken),
        /requires both x-forwarded-proto and x-forwarded-host/,
        'trusted proxy mode must fail closed instead of falling back to direct request metadata'
    );
    assert.throws(
        () => nodeEndpoint.resolveDrawioRuntimeRequestOrigin(createRequestLike({
            host: 'internal.example.local',
            'x-forwarded-proto': 'https',
            'x-forwarded-host': 'drawio-runtime.example.com, studio.example.com',
            'x-drawio-runtime-proxy-token': trustedProxyToken
        }), true, trustedProxyToken),
        /must contain exactly one value/,
        'trusted proxy mode must reject comma-separated forwarded hosts even with a valid trusted proxy token'
    );
    assert.throws(
        () => nodeEndpoint.resolveDrawioRuntimeRequestOrigin(createRequestLike({
            host: 'internal.example.local',
            'x-forwarded-proto': 'gopher',
            'x-forwarded-host': 'drawio-runtime.example.com',
            'x-drawio-runtime-proxy-token': trustedProxyToken
        }), true, trustedProxyToken),
        /request protocol must be http or https/,
        'trusted proxy mode must reject non-http(s) forwarded protocols'
    );
    assert.throws(
        () => nodeEndpoint.resolveDrawioRuntimeRequestOrigin(createRequestLike({
            host: 'internal.example.local',
            'x-forwarded-proto': 'https',
            'x-drawio-runtime-proxy-token': trustedProxyToken
        }), true, trustedProxyToken),
        /requires both x-forwarded-proto and x-forwarded-host/,
        'trusted proxy mode must fail closed when forwarded headers are incomplete'
    );

    assert.deepEqual(
        nodeEndpoint.assertDrawioRuntimeRequestOrigin({
            request: createRequestLike({ host: 'drawio-runtime.example.com' }, true),
            runtimeOriginInput: 'https://drawio-runtime.example.com',
            studioOriginInput: 'https://studio.example.com',
            trustProxy: false
        }),
        {
            runtimeOrigin: 'https://drawio-runtime.example.com',
            studioOrigin: 'https://studio.example.com',
            requestOrigin: 'https://drawio-runtime.example.com'
        },
        'request-origin guard must accept an exact direct runtime origin match'
    );
    assert.throws(
        () => nodeEndpoint.assertDrawioRuntimeRequestOrigin({
            request: createRequestLike({ host: 'studio.example.com' }, true),
            runtimeOriginInput: 'https://drawio-runtime.example.com',
            studioOriginInput: 'https://studio.example.com',
            trustProxy: false
        }),
        /must not match the configured Studio origin/,
        'request-origin guard must reject Studio-origin requests even when runtime and Studio origins differ'
    );
    assert.throws(
        () => nodeEndpoint.assertDrawioRuntimeRequestOrigin({
            request: createRequestLike({ host: 'wrong.example.com' }, true),
            runtimeOriginInput: 'https://drawio-runtime.example.com',
            studioOriginInput: 'https://studio.example.com',
            trustProxy: false
        }),
        /must match the configured Draw\.io runtime origin/,
        'request-origin guard must reject mismatched effective origins'
    );

    const endpoint = new nodeEndpoint.DrawioRuntimeEndpoint();
    endpoint.runtimeConfig = {
        runtimeOriginInput: 'https://drawio-runtime.example.com',
        studioOriginInput: 'https://studio.example.com',
        trustProxy: true,
        trustedProxyToken
    };
    const routeHandler = captureConfiguredRouteHandler(endpoint);

    let invalidReadFileCalls = 0;
    const invalidRouteResult = await invokeRouteHandler(
        routeHandler,
        createRequestLike({
            host: 'internal.example.local',
            'x-forwarded-proto': 'https',
            'x-forwarded-host': 'drawio-runtime.example.com'
        }, true),
        (_filePath, _encoding, callback) => {
            invalidReadFileCalls += 1;
            callback(null, '<html>should-not-be-served</html>');
        }
    );
    assert.equal(invalidReadFileCalls, 0, 'route must reject an unauthenticated trusted proxy request before reading blocked.html');
    assertUnavailableResponse(invalidRouteResult);

    let servedFilePath;
    let servedEncoding;
    const validRouteResult = await invokeRouteHandler(
        routeHandler,
        createRequestLike({
            host: 'internal.example.local',
            'x-forwarded-proto': 'https',
            'x-forwarded-host': 'drawio-runtime.example.com',
            'x-drawio-runtime-proxy-token': trustedProxyToken
        }, true),
        (filePath, encoding, callback) => {
            servedFilePath = filePath;
            servedEncoding = encoding;
            callback(null, '<html>blocked runtime</html>');
        }
    );
    assert.match(servedFilePath, /drawio-editor[\\/]+runtime[\\/]+blocked\.html$/, 'route must serve only the fixed blocked.html asset');
    assert.equal(servedEncoding, 'utf8', 'route must read blocked.html as utf8 text');
    assert.equal(validRouteResult.statusCode, 200, 'valid runtime requests must keep the success status');
    assert.equal(validRouteResult.contentType, 'html', 'valid runtime requests must send blocked.html as html');
    assert.equal(validRouteResult.body, '<html>blocked runtime</html>', 'valid runtime requests must return the blocked.html contents');
    assertBoundaryHeaders(validRouteResult.headers, 'https://studio.example.com');

    const readFailureResult = await invokeRouteHandler(
        routeHandler,
        createRequestLike({
            host: 'internal.example.local',
            'x-forwarded-proto': 'https',
            'x-forwarded-host': 'drawio-runtime.example.com',
            'x-drawio-runtime-proxy-token': trustedProxyToken
        }, true),
        (_filePath, _encoding, callback) => {
            callback(new Error('ENOENT'));
        }
    );
    assertUnavailableResponse(readFailureResult);
});

test('DIO-P4B-010 implementation activates the native Theia backend path with a single frontend/backend extension entry, executable backend module wiring, and no RPC surface', { skip: !implementationReady }, () => {
    const rootPackage = readJson(packageJsonPath, 'root package.json');
    const extensionPackage = readJson(extensionPackageJsonPath, 'drawio-editor package.json');
    const backendModuleSource = stripComments(requireImplementationFile(plannedModulePaths.backendModuleSource));
    const nodeEndpoint = requireCompiledModule(plannedModulePaths.nodeEndpointCompiled);
    const backendModule = requireCompiledModule(plannedModulePaths.backendModuleCompiled);
    const { Container, BackendApplicationContribution } = loadCompiledBackendActivationHarness();

    assert.equal(extensionPackage.dependencies['@theia/core'], '1.73.1', 'drawio-editor must remain pinned to Theia 1.73.1');
    assertCurrentOrFutureTheiaExtensionShape(extensionPackage);
    assert.equal(rootPackage.engines.node, '>=22 <=24', 'workspace Node engine range must remain compatible with Node 22');

    assert.match(backendModuleSource, /\bexport\s+default\s+new\s+ContainerModule\b/, 'backend module source must export a default ContainerModule');
    assert.match(backendModuleSource, /\bbind\(DrawioRuntimeEndpoint\)\.toSelf\(\)\.inSingletonScope\(\)/, 'backend module source must bind DrawioRuntimeEndpoint toSelf in singleton scope');
    assert.match(backendModuleSource, /\bbind\(BackendApplicationContribution\)\.toService\(DrawioRuntimeEndpoint\)/, 'backend module source must bind BackendApplicationContribution toService DrawioRuntimeEndpoint');
    assert.ok(backendModule.default, 'compiled backend module must export a default module surface');
    assert.equal(typeof nodeEndpoint.DrawioRuntimeEndpoint, 'function', 'compiled node endpoint module must export DrawioRuntimeEndpoint');

    const container = new Container();
    container.load(backendModule.default);
    const endpoint = container.get(nodeEndpoint.DrawioRuntimeEndpoint);
    const backendContribution = container.get(BackendApplicationContribution);
    assert.equal(backendContribution, endpoint, 'backend contribution binding must resolve to the DrawioRuntimeEndpoint singleton');

    const endpointAndModuleSource = `${stripComments(requireImplementationFile(plannedModulePaths.nodeEndpointSource))}\n${backendModuleSource}`;
    assert.ok(!/\bJsonRpc\b|\bConnectionHandler\b|\bRPC\b/.test(endpointAndModuleSource), 'Phase 4B native runtime boundary must not introduce RPC wiring');
    assert.ok(!/\b@theia\/plugin-ext\b|\bWebviewWidget\b|\bTHEIA_WEBVIEW_EXTERNAL_ENDPOINT\b/.test(endpointAndModuleSource), 'Phase 4B native runtime boundary must stay on public native Theia browser/backend extension points');
});
