import { SaxesParser } from 'saxes';

export type DrawioEditableFormat = 'xml' | 'svg' | 'png';
export type DrawioPreviewReason =
    | 'missing-embedded-diagram'
    | 'invalid-embedded-diagram'
    | 'invalid-container';

export interface EditableDrawioDocument {
    readonly mode: 'editable';
    readonly format: DrawioEditableFormat;
    readonly xml: string;
}

export interface PreviewOnlyDrawioDocument {
    readonly mode: 'preview-only';
    readonly format: 'svg' | 'png';
    readonly reason: DrawioPreviewReason;
}

export type DrawioDocumentInspectionResult = EditableDrawioDocument | PreviewOnlyDrawioDocument;

const UTF8_DECODER = new TextDecoder('utf-8', { fatal: true });
const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const MXFILE_KEYWORDS = new Set(['mxfile', 'mxGraphModel']);
const BASE64_PATTERN = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const MAX_PNG_CHUNK_LENGTH = 0x7fffffff;

interface ParsedXmlDocument {
    readonly rootName: string | undefined;
    readonly xml: string;
}

interface ParsedSvgContainer {
    readonly rootName: string | undefined;
    readonly content: string | undefined;
}

interface ParsedPngTextChunk {
    readonly keyword: string;
    readonly text: string;
}

export function inspectDrawioDocument(fileName: string, bytes: Uint8Array): DrawioDocumentInspectionResult {
    const lowerCaseName = fileName.toLowerCase();

    if (lowerCaseName.endsWith('.drawio.svg')) {
        return inspectSvgDocument(bytes);
    }
    if (lowerCaseName.endsWith('.drawio.png')) {
        return inspectPngDocument(bytes);
    }
    if (lowerCaseName.endsWith('.drawio') || lowerCaseName.endsWith('.dio')) {
        return inspectXmlDocument(bytes);
    }

    throw new Error(`unsupported-format: ${fileName}`);
}

function inspectXmlDocument(bytes: Uint8Array): EditableDrawioDocument {
    try {
        const xml = decodeUtf8(bytes).trim();
        const parsed = parseXmlDocument(xml);
        assertDrawioRoot(parsed.rootName, 'invalid-diagram');
        return { mode: 'editable', format: 'xml', xml: parsed.xml };
    } catch (error) {
        throw new Error(`invalid-diagram: ${toErrorMessage(error)}`);
    }
}

function inspectSvgDocument(bytes: Uint8Array): DrawioDocumentInspectionResult {
    let parsedSvg: ParsedSvgContainer;
    try {
        parsedSvg = parseSvgContainer(decodeUtf8(bytes));
    } catch {
        return { mode: 'preview-only', format: 'svg', reason: 'invalid-container' };
    }

    if (parsedSvg.rootName !== 'svg') {
        return { mode: 'preview-only', format: 'svg', reason: 'invalid-container' };
    }

    const embeddedContent = parsedSvg.content?.trim();
    if (!embeddedContent) {
        return { mode: 'preview-only', format: 'svg', reason: 'missing-embedded-diagram' };
    }

    try {
        const xml = decodeEmbeddedXml(embeddedContent);
        assertDrawioRoot(parseXmlDocument(xml).rootName, 'invalid-embedded-diagram');
        return { mode: 'editable', format: 'svg', xml };
    } catch {
        return { mode: 'preview-only', format: 'svg', reason: 'invalid-embedded-diagram' };
    }
}

function inspectPngDocument(bytes: Uint8Array): DrawioDocumentInspectionResult {
    let chunk: ParsedPngTextChunk | undefined;
    try {
        chunk = extractDrawioPngTextChunk(bytes);
    } catch {
        return { mode: 'preview-only', format: 'png', reason: 'invalid-container' };
    }

    if (!chunk) {
        return { mode: 'preview-only', format: 'png', reason: 'missing-embedded-diagram' };
    }

    try {
        const xml = decodePercentEncodedXml(chunk.text);
        assertDrawioRoot(parseXmlDocument(xml).rootName, 'invalid-embedded-diagram');
        return { mode: 'editable', format: 'png', xml };
    } catch {
        return { mode: 'preview-only', format: 'png', reason: 'invalid-embedded-diagram' };
    }
}

function decodeUtf8(bytes: Uint8Array): string {
    return UTF8_DECODER.decode(bytes);
}

function parseXmlDocument(xml: string): ParsedXmlDocument {
    let rootName: string | undefined;
    parseWithSaxes(xml, tag => {
        if (rootName === undefined) {
            rootName = tag.name;
        }
    });
    return { rootName, xml: xml.trim() };
}

function parseSvgContainer(xml: string): ParsedSvgContainer {
    let rootName: string | undefined;
    let content: string | undefined;

    parseWithSaxes(xml, tag => {
        if (rootName === undefined) {
            rootName = tag.name;
            const value = tag.attributes.content;
            if (typeof value === 'string') {
                content = value;
            }
        }
    });

    return { rootName, content };
}

function parseWithSaxes(
    xml: string,
    onOpenTag: (tag: { name: string; attributes: Record<string, string> }) => void
): void {
    const parser = new SaxesParser({ xmlns: false, fragment: false });
    let failure: Error | undefined;

    parser.on('opentag', tag => {
        if (failure) {
            return;
        }
        onOpenTag(tag);
    });
    parser.on('error', error => {
        failure = error;
    });

    try {
        parser.write(xml).close();
    } catch (error) {
        throw error instanceof Error ? error : new Error(String(error));
    }

    if (failure) {
        throw failure;
    }
}

function assertDrawioRoot(rootName: string | undefined, reason: string): void {
    if (!rootName || !MXFILE_KEYWORDS.has(rootName)) {
        throw new Error(reason);
    }
}

function decodeEmbeddedXml(value: string): string {
    if (value.startsWith('<')) {
        return value.trim();
    }
    if (value.startsWith('%')) {
        return decodePercentEncodedXml(value);
    }
    return decodeBase64Xml(value);
}

function decodePercentEncodedXml(value: string): string {
    let decoded = value;
    for (let index = 0; index < 2 && decoded.startsWith('%'); index += 1) {
        decoded = decodeURIComponent(decoded);
    }
    return decoded.trim();
}

function decodeBase64Xml(value: string): string {
    const compactValue = value.replace(/\s+/g, '');
    if (!compactValue || compactValue.length % 4 !== 0 || !BASE64_PATTERN.test(compactValue)) {
        throw new Error('invalid base64 payload');
    }

    const binary = atob(compactValue);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
        bytes[index] = binary.charCodeAt(index);
    }
    return decodeUtf8(bytes).trim();
}

function extractDrawioPngTextChunk(bytes: Uint8Array): ParsedPngTextChunk | undefined {
    if (bytes.length < PNG_SIGNATURE.length + 12) {
        throw new Error('PNG container too short');
    }
    for (let index = 0; index < PNG_SIGNATURE.length; index += 1) {
        if (bytes[index] !== PNG_SIGNATURE[index]) {
            throw new Error('invalid PNG signature');
        }
    }

    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let offset = PNG_SIGNATURE.length;
    let sawIdat = false;
    let sawIend = false;
    let firstChunk = true;
    let embeddedChunk: ParsedPngTextChunk | undefined;

    while (offset < bytes.length) {
        if (offset > bytes.length - 12) {
            throw new Error('truncated PNG chunk header');
        }

        const length = view.getUint32(offset);
        if (length > MAX_PNG_CHUNK_LENGTH) {
            throw new Error('invalid PNG chunk length');
        }
        offset += 4;

        const type = readAscii(bytes, offset, 4);
        offset += 4;

        const chunkEnd = offset + length;
        const crcOffset = chunkEnd;
        const nextOffset = crcOffset + 4;
        if (chunkEnd < offset || nextOffset > bytes.length) {
            throw new Error('PNG chunk exceeds bounds');
        }

        const data = bytes.subarray(offset, chunkEnd);
        const storedCrc = view.getUint32(crcOffset);
        const computedCrc = crc32(bytes.subarray(offset - 4, chunkEnd));
        if (storedCrc !== computedCrc) {
            throw new Error('invalid PNG CRC');
        }

        if (firstChunk) {
            firstChunk = false;
            if (type !== 'IHDR' || length !== 13) {
                throw new Error('missing IHDR');
            }
        } else if (type === 'IHDR') {
            throw new Error('duplicate IHDR');
        }

        if (type === 'IDAT') {
            sawIdat = true;
        } else if (type === 'IEND') {
            if (length !== 0) {
                throw new Error('invalid IEND');
            }
            sawIend = true;
            offset = nextOffset;
            break;
        } else if (!sawIdat && type === 'tEXt' && embeddedChunk === undefined) {
            const parsedChunk = parsePngTextChunk(data);
            if (parsedChunk && MXFILE_KEYWORDS.has(parsedChunk.keyword)) {
                embeddedChunk = parsedChunk;
            }
        }

        offset = nextOffset;
    }

    if (!sawIdat || !sawIend || offset !== bytes.length) {
        throw new Error('invalid PNG structure');
    }

    return embeddedChunk;
}

function parsePngTextChunk(data: Uint8Array): ParsedPngTextChunk | undefined {
    const separatorIndex = data.indexOf(0);
    if (separatorIndex <= 0) {
        return undefined;
    }

    return {
        keyword: decodeLatin1(data.subarray(0, separatorIndex)),
        text: decodeLatin1(data.subarray(separatorIndex + 1))
    };
}

function decodeLatin1(bytes: Uint8Array): string {
    let value = '';
    for (const byte of bytes) {
        value += String.fromCharCode(byte);
    }
    return value;
}

function readAscii(bytes: Uint8Array, offset: number, length: number): string {
    let value = '';
    for (let index = 0; index < length; index += 1) {
        value += String.fromCharCode(bytes[offset + index]);
    }
    return value;
}

function crc32(bytes: Uint8Array): number {
    let crc = 0xffffffff;
    for (const byte of bytes) {
        crc ^= byte;
        for (let index = 0; index < 8; index += 1) {
            const mask = -(crc & 1);
            crc = (crc >>> 1) ^ (0xedb88320 & mask);
        }
    }
    return (crc ^ 0xffffffff) >>> 0;
}

function toErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
