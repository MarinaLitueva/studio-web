export const DrawioProtocolService = Symbol('DrawioProtocolService');

export const DRAWIO_EXPORT_FORMATS = ['xml', 'xmlsvg', 'xmlpng', 'svg', 'png'] as const;

export type DrawioExportFormat = typeof DRAWIO_EXPORT_FORMATS[number];

export interface DrawioLoadMessage {
    readonly action: 'load';
    readonly autosave: 1;
    readonly saveAndExit: '1';
    readonly modified: 'unsavedChanges';
    readonly xml: string;
    readonly title: string;
}

export interface DrawioExportRequestMessage {
    readonly action: 'export';
    readonly format: DrawioExportFormat;
    readonly xml: string;
    readonly spinKey: 'export';
}

export type DrawioHostMessage = DrawioLoadMessage | DrawioExportRequestMessage;

export interface DrawioInitMessage {
    readonly event: 'init';
}

export interface DrawioSaveMessage {
    readonly event: 'save';
    readonly xml: string;
    readonly exit?: boolean;
}

export interface DrawioExportResultMessage {
    readonly event: 'export';
    readonly data: string;
}

export interface DrawioExitMessage {
    readonly event: 'exit';
    readonly xml?: string;
    readonly modified?: boolean;
}

export type DrawioEditorMessage =
    | DrawioInitMessage
    | DrawioSaveMessage
    | DrawioExportResultMessage
    | DrawioExitMessage;

export interface DrawioProtocolService {
    createLoadMessage(xml: string, title: string): DrawioLoadMessage;
    createExportMessage(format: DrawioExportFormat, xml: string): DrawioExportRequestMessage;
    parseEditorMessage(payload: unknown): DrawioEditorMessage;
    isExportFormat(value: unknown): value is DrawioExportFormat;
}

const DANGEROUS_KEY_PATTERN = /(path|uri|file|command|execute)/i;

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function assertPlainRecord(value: unknown, context: string): Record<string, unknown> {
    if (!isObject(value) || Array.isArray(value)) {
        throw new Error(`${context} must be a plain object.`);
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
        throw new Error(`${context} must not use a custom prototype.`);
    }
    return value;
}

function assertExactKeys(
    record: Record<string, unknown>,
    allowedKeys: readonly string[],
    context: string
): void {
    const allowedKeySet = new Set(allowedKeys);
    for (const key of Object.keys(record)) {
        if (DANGEROUS_KEY_PATTERN.test(key)) {
            throw new Error(`${context} contains a forbidden property name: ${key}.`);
        }
        if (!allowedKeySet.has(key)) {
            throw new Error(`${context} contains an unsupported property: ${key}.`);
        }
    }
}

function readRequiredString(record: Record<string, unknown>, key: string, context: string): string {
    const value = record[key];
    if (typeof value !== 'string') {
        throw new Error(`${context}.${key} must be a string.`);
    }
    return value;
}

function readOptionalString(record: Record<string, unknown>, key: string, context: string): string | undefined {
    const value = record[key];
    if (value === undefined) {
        return undefined;
    }
    if (typeof value !== 'string') {
        throw new Error(`${context}.${key} must be a string when present.`);
    }
    return value;
}

function readOptionalBoolean(record: Record<string, unknown>, key: string, context: string): boolean | undefined {
    const value = record[key];
    if (value === undefined) {
        return undefined;
    }
    if (typeof value !== 'boolean') {
        throw new Error(`${context}.${key} must be a boolean when present.`);
    }
    return value;
}

export function isDrawioExportFormat(value: unknown): value is DrawioExportFormat {
    return typeof value === 'string'
        && (DRAWIO_EXPORT_FORMATS as readonly string[]).includes(value);
}

export function parseDrawioEditorMessage(payload: unknown): DrawioEditorMessage {
    const record = assertPlainRecord(payload, 'Draw.io editor message');
    const event = readRequiredString(record, 'event', 'Draw.io editor message');
    if (DANGEROUS_KEY_PATTERN.test(event)) {
        throw new Error(`Draw.io editor message event is forbidden: ${event}.`);
    }

    switch (event) {
        case 'init':
            assertExactKeys(record, ['event'], 'Draw.io init message');
            return { event: 'init' };
        case 'save': {
            assertExactKeys(record, ['event', 'xml', 'exit'], 'Draw.io save message');
            return {
                event: 'save',
                xml: readRequiredString(record, 'xml', 'Draw.io save message'),
                exit: readOptionalBoolean(record, 'exit', 'Draw.io save message')
            };
        }
        case 'export':
            assertExactKeys(record, ['event', 'data'], 'Draw.io export message');
            return {
                event: 'export',
                data: readRequiredString(record, 'data', 'Draw.io export message')
            };
        case 'exit':
            assertExactKeys(record, ['event', 'xml', 'modified'], 'Draw.io exit message');
            return {
                event: 'exit',
                xml: readOptionalString(record, 'xml', 'Draw.io exit message'),
                modified: readOptionalBoolean(record, 'modified', 'Draw.io exit message')
            };
        default:
            throw new Error(`Unsupported Draw.io editor event: ${event}.`);
    }
}
