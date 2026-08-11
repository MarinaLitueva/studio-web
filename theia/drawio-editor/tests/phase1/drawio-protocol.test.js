const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const phaseRoot = __dirname;
const packageRoot = path.resolve(phaseRoot, '..', '..');
const libRoot = path.join(packageRoot, 'lib');
const protocolModulePath = path.join(libRoot, 'common', 'drawio-protocol.js');
const protocolServiceModulePath = path.join(libRoot, 'common', 'drawio-protocol-service.js');
const relativeLibRoot = path.relative(packageRoot, libRoot);
const missingBuildMessage =
    `Compiled drawio-editor outputs are required under ${relativeLibRoot}. `
    + 'Run `npm --prefix drawio-editor run build` before `node --test drawio-editor/tests/phase1/drawio-protocol.test.js`.';

const libExists = fs.existsSync(protocolModulePath) && fs.existsSync(protocolServiceModulePath);

let protocolModule;
let protocolServiceModule;
if (libExists) {
    protocolModule = require('../../lib/common/drawio-protocol.js');
    protocolServiceModule = require('../../lib/common/drawio-protocol-service.js');
}

function requireBuild() {
    assert.ok(libExists, missingBuildMessage);
}

function assertThrowsMessage(fn, pattern) {
    assert.throws(fn, error => {
        assert.match(error.message, pattern);
        return true;
    });
}

function collectDangerousKeys(value, results = []) {
    if (!value || typeof value !== 'object') {
        return results;
    }
    for (const key of Object.keys(value)) {
        if (/(path|uri|file|command|execute)/i.test(key)) {
            results.push(key);
        }
        collectDangerousKeys(value[key], results);
    }
    return results;
}

test('PHASE1-PROTOCOL-001 requires compiled drawio-editor protocol outputs before Phase 1 tests can run', () => {
    assert.equal(relativeLibRoot, 'lib');
    requireBuild();
});

test('PHASE1-PROTOCOL-002 createLoadMessage returns the exact load envelope and treats XML and title as data only', { skip: !libExists }, () => {
    const service = protocolServiceModule.createDrawioProtocolService();
    const xml = '<mxfile><diagram>path uri file command execute</diagram></mxfile>';
    const title = 'diagram path uri file command execute.drawio';
    const message = service.createLoadMessage(xml, title);

    assert.deepEqual(message, {
        action: 'load',
        autosave: 1,
        saveAndExit: '1',
        modified: 'unsavedChanges',
        xml,
        title
    });
    assert.deepEqual(Object.keys(message), ['action', 'autosave', 'saveAndExit', 'modified', 'xml', 'title']);
    assert.deepEqual(collectDangerousKeys(message), []);
    assert.match(message.xml, /path uri file command execute/);
    assert.match(message.title, /path uri file command execute/);
});

test('PHASE1-PROTOCOL-003 createExportMessage returns the exact envelope for every allowed export format', { skip: !libExists }, () => {
    const service = protocolServiceModule.createDrawioProtocolService();
    const xml = '<mxfile><diagram>export me</diagram></mxfile>';

    for (const format of ['xml', 'xmlsvg', 'xmlpng', 'svg', 'png']) {
        const message = service.createExportMessage(format, xml);
        assert.deepEqual(message, {
            action: 'export',
            format,
            xml,
            spinKey: 'export'
        });
        assert.deepEqual(Object.keys(message), ['action', 'format', 'xml', 'spinKey']);
    }
});

test('PHASE1-PROTOCOL-004 createExportMessage rejects unsupported runtime export formats', { skip: !libExists }, () => {
    const service = protocolServiceModule.createDrawioProtocolService();

    assertThrowsMessage(
        () => service.createExportMessage('pdf', '<mxfile />'),
        /Unsupported Draw\.io export format: pdf\./
    );
});

test('PHASE1-PROTOCOL-005 parseEditorMessage accepts and normalizes init, save, export, and exit payloads', { skip: !libExists }, () => {
    const service = protocolServiceModule.createDrawioProtocolService();

    assert.deepEqual(service.parseEditorMessage({ event: 'init' }), { event: 'init' });
    assert.deepEqual(
        service.parseEditorMessage({ event: 'save', xml: '<mxfile>path</mxfile>' }),
        { event: 'save', xml: '<mxfile>path</mxfile>', exit: undefined }
    );
    assert.deepEqual(
        service.parseEditorMessage({ event: 'save', xml: '<mxfile>uri</mxfile>', exit: true }),
        { event: 'save', xml: '<mxfile>uri</mxfile>', exit: true }
    );
    assert.deepEqual(
        service.parseEditorMessage({ event: 'export', data: 'data:image/png;base64,file-command' }),
        { event: 'export', data: 'data:image/png;base64,file-command' }
    );
    assert.deepEqual(
        service.parseEditorMessage({ event: 'exit' }),
        { event: 'exit', xml: undefined, modified: undefined }
    );
    assert.deepEqual(
        service.parseEditorMessage({ event: 'exit', xml: '<mxfile>execute</mxfile>', modified: false }),
        { event: 'exit', xml: '<mxfile>execute</mxfile>', modified: false }
    );
});

test('PHASE1-PROTOCOL-006 parseEditorMessage rejects null, arrays, and custom-prototype objects', { skip: !libExists }, () => {
    const service = protocolServiceModule.createDrawioProtocolService();

    assertThrowsMessage(() => service.parseEditorMessage(null), /must be a plain object/);
    assertThrowsMessage(() => service.parseEditorMessage([]), /must be a plain object/);
    assertThrowsMessage(
        () => service.parseEditorMessage(new (class SaveMessage {
            constructor() {
                this.event = 'save';
                this.xml = '<mxfile />';
            }
        })()),
        /must not use a custom prototype/
    );
});

test('PHASE1-PROTOCOL-007 parseEditorMessage rejects unsupported events and wrong or missing required properties', { skip: !libExists }, () => {
    const service = protocolServiceModule.createDrawioProtocolService();

    assertThrowsMessage(() => service.parseEditorMessage({ event: 'open' }), /Unsupported Draw\.io editor event: open\./);
    assertThrowsMessage(() => service.parseEditorMessage({}), /Draw\.io editor message\.event must be a string\./);
    assertThrowsMessage(
        () => service.parseEditorMessage({ event: 'save' }),
        /Draw\.io save message\.xml must be a string\./
    );
    assertThrowsMessage(
        () => service.parseEditorMessage({ event: 'save', xml: '<mxfile />', exit: 'true' }),
        /Draw\.io save message\.exit must be a boolean when present\./
    );
    assertThrowsMessage(
        () => service.parseEditorMessage({ event: 'export' }),
        /Draw\.io export message\.data must be a string\./
    );
    assertThrowsMessage(
        () => service.parseEditorMessage({ event: 'exit', modified: 'false' }),
        /Draw\.io exit message\.modified must be a boolean when present\./
    );
});

test('PHASE1-PROTOCOL-008 parseEditorMessage rejects every extra property, including benign and dangerous names', { skip: !libExists }, () => {
    const service = protocolServiceModule.createDrawioProtocolService();

    const cases = [
        [{ event: 'init', extra: true }, /unsupported property: extra/],
        [{ event: 'save', xml: '<mxfile />', note: 'ok' }, /unsupported property: note/],
        [{ event: 'export', data: 'ok', uri: '/tmp/file' }, /forbidden property name: uri/],
        [{ event: 'exit', modified: true, command: 'save' }, /forbidden property name: command/],
        [{ event: 'save', xml: '<mxfile />', filePath: 'diagram.drawio' }, /forbidden property name: filePath/]
    ];

    for (const [payload, pattern] of cases) {
        assertThrowsMessage(() => service.parseEditorMessage(payload), pattern);
    }
});

test('PHASE1-PROTOCOL-009 export format guard accepts only the allowlist', { skip: !libExists }, () => {
    const service = protocolServiceModule.createDrawioProtocolService();

    for (const format of ['xml', 'xmlsvg', 'xmlpng', 'svg', 'png']) {
        assert.equal(protocolModule.isDrawioExportFormat(format), true);
        assert.equal(service.isExportFormat(format), true);
    }

    for (const value of ['pdf', 'jpeg', '', 'XML', 1, null, {}, []]) {
        assert.equal(protocolModule.isDrawioExportFormat(value), false);
        assert.equal(service.isExportFormat(value), false);
    }

    assert.deepEqual(protocolModule.DRAWIO_EXPORT_FORMATS, ['xml', 'xmlsvg', 'xmlpng', 'svg', 'png']);
});

test('PHASE1-PROTOCOL-010 protocol service factory returns a stable singleton from the common Node-safe module', { skip: !libExists }, () => {
    const first = protocolServiceModule.createDrawioProtocolService();
    const second = protocolServiceModule.createDrawioProtocolService();

    assert.strictEqual(first, second);
    assert.equal(typeof first.createLoadMessage, 'function');
    assert.equal(typeof first.createExportMessage, 'function');
    assert.equal(typeof first.parseEditorMessage, 'function');
    assert.equal(typeof first.isExportFormat, 'function');
});

test('PHASE1-PROTOCOL-011 accepted payloads never expose filesystem or command property names, but allow those words inside string values', { skip: !libExists }, () => {
    const service = protocolServiceModule.createDrawioProtocolService();
    const acceptedMessages = [
        service.createLoadMessage('<mxfile>path uri file command execute</mxfile>', 'title execute file'),
        service.createExportMessage('png', '<mxfile>path uri file command execute</mxfile>'),
        service.parseEditorMessage({ event: 'save', xml: '<mxfile>path uri file command execute</mxfile>' }),
        service.parseEditorMessage({ event: 'export', data: 'data:image/svg+xml;path,uri,file,command,execute' }),
        service.parseEditorMessage({ event: 'exit', xml: '<mxfile>path uri file command execute</mxfile>', modified: true })
    ];

    for (const message of acceptedMessages) {
        assert.deepEqual(collectDangerousKeys(message), []);
    }
});

test('PHASE1-PROTOCOL-012 the Phase 1 harness uses only Node built-ins plus compiled drawio-editor modules', () => {
    const source = fs.readFileSync(__filename, 'utf8');
    const requireSpecifiers = Array.from(source.matchAll(/require\('([^']+)'\)/g), match => match[1]).sort();

    assert.deepEqual(requireSpecifiers, [
        '../../lib/common/drawio-protocol-service.js',
        '../../lib/common/drawio-protocol.js',
        'node:assert/strict',
        'node:fs',
        'node:path',
        'node:test'
    ]);
});
