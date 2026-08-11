const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const phaseRoot = __dirname;
const packageRoot = path.resolve(phaseRoot, '..', '..');
const libRoot = path.join(packageRoot, 'lib');
const documentModulePath = path.join(libRoot, 'common', 'drawio-document.js');
const relativeModulePath = path.relative(packageRoot, documentModulePath);
const missingBuildMessage =
    `Compiled Draw.io document inspection output is required at ${relativeModulePath}. `
    + 'Implement `src/common/drawio-document.ts`, run `npm --prefix drawio-editor run build`, '
    + 'then rerun `node --test drawio-editor/tests/phase2/drawio-document.acceptance.test.js`.';

const implementationExists = fs.existsSync(documentModulePath);

let documentModule;
if (implementationExists) {
    documentModule = require('../../lib/common/drawio-document.js');
}

function requireImplementation() {
    assert.ok(implementationExists, missingBuildMessage);
}

function inspect(fileName, bytes) {
    return documentModule.inspectDrawioDocument(fileName, bytes);
}

function utf8Bytes(value) {
    return Buffer.from(value, 'utf8');
}

function assertUnsupportedFormat(fn) {
    assert.throws(fn, error => {
        assert.match(error.message, /unsupported-format/i);
        return true;
    });
}

function assertInvalidDiagram(fn) {
    assert.throws(fn, error => {
        assert.match(error.message, /invalid-diagram/i);
        return true;
    });
}

function assertEditable(result, expectedFormat, expectedXml) {
    assert.deepEqual(result, {
        mode: 'editable',
        format: expectedFormat,
        xml: expectedXml
    });
    assert.match(result.xml, /^<(?:mxfile|mxGraphModel)\b/);
    assert.ok(!result.xml.includes('<svg'), 'editable XML must not contain SVG wrapper markup');
    assert.ok(!result.xml.includes('PNG'), 'editable XML must not contain PNG container bytes');
}

function assertPreviewOnly(result, expectedFormat, expectedReason) {
    assert.deepEqual(result, {
        mode: 'preview-only',
        format: expectedFormat,
        reason: expectedReason
    });
}

function encodeSvgContent(xml, mode) {
    if (mode === 'entity') {
        return xml
            .replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');
    }
    if (mode === 'percent') {
        return encodeURIComponent(xml);
    }
    if (mode === 'double-percent') {
        return encodeURIComponent(encodeURIComponent(xml));
    }
    if (mode === 'base64') {
        return Buffer.from(xml, 'utf8').toString('base64');
    }
    throw new Error(`Unknown SVG content encoding mode: ${mode}`);
}

function svgBytesWithContent(contentValue) {
    return utf8Bytes(
        `<?xml version="1.0" encoding="UTF-8"?>`
        + `<svg xmlns="http://www.w3.org/2000/svg" content="${contentValue}">`
        + '<rect width="1" height="1" />'
        + '</svg>'
    );
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

function buildTextChunk(keyword, text) {
    return buildChunk('tEXt', Buffer.concat([
        Buffer.from(keyword, 'latin1'),
        Buffer.from([0]),
        Buffer.from(text, 'latin1')
    ]));
}

function createPngBytes(textChunkData) {
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
    const textChunk = textChunkData ? buildTextChunk(textChunkData.keyword, textChunkData.text) : Buffer.alloc(0);
    const idat = buildChunk('IDAT', Buffer.from([
        0x78, 0x01,
        0x01, 0x05, 0x00, 0xfa, 0xff,
        0x00, 0x00, 0x00, 0x00,
        0x05, 0x00, 0x01
    ]));
    const iend = buildChunk('IEND', Buffer.alloc(0));
    return Buffer.concat([signature, ihdr, textChunk, idat, iend]);
}

test('PHASE2-DOCUMENT-001 requires the compiled Draw.io document inspection module before Phase 2 tests can run', () => {
    assert.equal(relativeModulePath, path.join('lib', 'common', 'drawio-document.js'));
    requireImplementation();
});

test('PHASE2-DOCUMENT-002 .drawio and .dio XML inputs become editable documents and file matching is case-insensitive', { skip: !implementationExists }, () => {
    const mxfileXml = '<mxfile host="app.diagrams.net"><diagram id="a">hello</diagram></mxfile>';
    const mxGraphModelXml = '<mxGraphModel dx="10" dy="10"><root /></mxGraphModel>';

    assertEditable(inspect('diagram.drawio', utf8Bytes(mxfileXml)), 'xml', mxfileXml);
    assertEditable(inspect('DIAGRAM.DRAWIO', utf8Bytes(mxfileXml)), 'xml', mxfileXml);
    assertEditable(inspect('diagram.dio', utf8Bytes(mxGraphModelXml)), 'xml', mxGraphModelXml);
    assertEditable(inspect('DIAGRAM.DIO', utf8Bytes(mxGraphModelXml)), 'xml', mxGraphModelXml);
});

test('PHASE2-DOCUMENT-003 malformed or non-Diagram XML inputs for .drawio and .dio reject with an explicit invalid-diagram error', { skip: !implementationExists }, () => {
    assertInvalidDiagram(() => inspect('broken.drawio', utf8Bytes('<mxfile><diagram></mxfile>')));
    assertInvalidDiagram(() => inspect('plain.dio', utf8Bytes('<svg><text>not drawio xml</text></svg>')));
    assertInvalidDiagram(() => inspect('text.drawio', utf8Bytes('just plain text')));
});

test('PHASE2-DOCUMENT-004 .drawio.svg accepts entity-escaped, percent, double-percent, and base64-encoded embedded XML', { skip: !implementationExists }, () => {
    const mxfileXml = '<mxfile host="app.diagrams.net"><diagram id="svg-direct">ok</diagram></mxfile>';
    const mxGraphModelXml = '<mxGraphModel dx="7" dy="8"><root><mxCell id="0" /></root></mxGraphModel>';

    assertEditable(inspect('diagram.drawio.svg', svgBytesWithContent(encodeSvgContent(mxfileXml, 'entity'))), 'svg', mxfileXml);
    assertEditable(inspect('diagram.drawio.svg', svgBytesWithContent(encodeSvgContent(mxGraphModelXml, 'entity'))), 'svg', mxGraphModelXml);
    assertEditable(inspect('diagram.drawio.svg', svgBytesWithContent(encodeSvgContent(mxfileXml, 'percent'))), 'svg', mxfileXml);
    assertEditable(inspect('diagram.drawio.svg', svgBytesWithContent(encodeSvgContent(mxGraphModelXml, 'double-percent'))), 'svg', mxGraphModelXml);
    assertEditable(inspect('diagram.drawio.svg', svgBytesWithContent(encodeSvgContent(mxfileXml, 'base64'))), 'svg', mxfileXml);
});

test('PHASE2-DOCUMENT-005 .drawio.svg falls back to preview-only for missing or invalid embedded diagrams and invalid containers', { skip: !implementationExists }, () => {
    assertPreviewOnly(inspect('missing.drawio.svg', utf8Bytes('<svg xmlns="http://www.w3.org/2000/svg"></svg>')), 'svg', 'missing-embedded-diagram');
    assertPreviewOnly(inspect('invalid.drawio.svg', svgBytesWithContent('%%%not-xml%%%')), 'svg', 'invalid-embedded-diagram');
    assertPreviewOnly(inspect('broken.drawio.svg', utf8Bytes('<svg content="abc">')), 'svg', 'invalid-container');
});

test('PHASE2-DOCUMENT-006 .drawio.png reads embedded tEXt chunks with mxfile or mxGraphModel keywords and returns canonical XML only', { skip: !implementationExists }, () => {
    const mxfileXml = '<mxfile host="app.diagrams.net"><diagram id="png-a">png</diagram></mxfile>';
    const mxGraphModelXml = '<mxGraphModel dx="1" dy="2"><root><mxCell id="0" /></root></mxGraphModel>';

    assertEditable(
        inspect('diagram.drawio.png', createPngBytes({ keyword: 'mxfile', text: encodeURIComponent(mxfileXml) })),
        'png',
        mxfileXml
    );
    assertEditable(
        inspect('diagram.drawio.png', createPngBytes({ keyword: 'mxGraphModel', text: encodeURIComponent(encodeURIComponent(mxGraphModelXml)) })),
        'png',
        mxGraphModelXml
    );
});

test('PHASE2-DOCUMENT-007 .drawio.png falls back to preview-only for plain PNGs, invalid embedded data, and malformed containers without throwing', { skip: !implementationExists }, () => {
    assertPreviewOnly(inspect('plain.drawio.png', createPngBytes()), 'png', 'missing-embedded-diagram');
    assertPreviewOnly(
        inspect('invalid.drawio.png', createPngBytes({ keyword: 'mxfile', text: '%E0%A4%A' })),
        'png',
        'invalid-embedded-diagram'
    );
    assertPreviewOnly(inspect('broken-signature.drawio.png', Buffer.from('not-a-png', 'utf8')), 'png', 'invalid-container');

    const truncatedChunkLength = Buffer.from(createPngBytes());
    truncatedChunkLength.writeUInt32BE(0x7fffffff, 8);
    assertPreviewOnly(inspect('broken-length.drawio.png', truncatedChunkLength), 'png', 'invalid-container');
});

test('PHASE2-DOCUMENT-008 rejects generic .svg and .png names plus unrelated extensions with an explicit unsupported-format error', { skip: !implementationExists }, () => {
    const svgBytes = svgBytesWithContent(encodeSvgContent('<mxfile><diagram id="x">x</diagram></mxfile>', 'entity'));
    const pngBytes = createPngBytes({ keyword: 'mxfile', text: encodeURIComponent('<mxfile><diagram id="x">x</diagram></mxfile>') });

    assertUnsupportedFormat(() => inspect('diagram.svg', svgBytes));
    assertUnsupportedFormat(() => inspect('diagram.png', pngBytes));
    assertUnsupportedFormat(() => inspect('diagram.drawio.jpeg', Buffer.from([0xff, 0xd8, 0xff])));
    assertUnsupportedFormat(() => inspect('diagram.txt', utf8Bytes('<mxfile />')));
});

test('PHASE2-DOCUMENT-009 editable outputs return decoded XML only and never wrapper bytes from SVG or PNG containers', { skip: !implementationExists }, () => {
    const svgXml = '<mxfile host="app.diagrams.net"><diagram id="svg-clean">clean</diagram></mxfile>';
    const pngXml = '<mxGraphModel dx="4" dy="5"><root><mxCell id="0" /></root></mxGraphModel>';

    const svgResult = inspect('clean.drawio.svg', svgBytesWithContent(encodeSvgContent(svgXml, 'percent')));
    const pngResult = inspect('clean.drawio.png', createPngBytes({ keyword: 'mxGraphModel', text: encodeURIComponent(pngXml) }));

    assert.equal(svgResult.xml, svgXml);
    assert.equal(pngResult.xml, pngXml);
    assert.ok(!svgResult.xml.includes('content='), 'editable SVG result must not expose the source wrapper attribute');
    assert.ok(!pngResult.xml.includes('IDAT'), 'editable PNG result must not expose PNG chunk markers');
});

test('PHASE2-DOCUMENT-010 the Phase 2 harness imports only Node built-ins plus the future compiled document module', () => {
    const source = fs.readFileSync(__filename, 'utf8');
    const requireSpecifiers = Array.from(source.matchAll(/require\('([^']+)'\)/g), match => match[1]).sort();

    assert.deepEqual(requireSpecifiers, [
        '../../lib/common/drawio-document.js',
        'node:assert/strict',
        'node:fs',
        'node:path',
        'node:test'
    ]);
});
