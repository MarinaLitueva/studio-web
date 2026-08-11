import {
    DrawioExportFormat,
    DrawioExportRequestMessage,
    DrawioLoadMessage,
    DrawioProtocolService,
    DrawioEditorMessage,
    isDrawioExportFormat,
    parseDrawioEditorMessage
} from './drawio-protocol';

export class DefaultDrawioProtocolService implements DrawioProtocolService {
    createLoadMessage(xml: string, title: string): DrawioLoadMessage {
        return {
            action: 'load',
            autosave: 1,
            saveAndExit: '1',
            modified: 'unsavedChanges',
            xml,
            title
        };
    }

    createExportMessage(format: DrawioExportFormat, xml: string): DrawioExportRequestMessage {
        if (!this.isExportFormat(format)) {
            throw new Error(`Unsupported Draw.io export format: ${String(format)}.`);
        }
        return {
            action: 'export',
            format,
            xml,
            spinKey: 'export'
        };
    }

    parseEditorMessage(payload: unknown): DrawioEditorMessage {
        return parseDrawioEditorMessage(payload);
    }

    isExportFormat(value: unknown): value is DrawioExportFormat {
        return isDrawioExportFormat(value);
    }
}

const drawioProtocolService: DrawioProtocolService = new DefaultDrawioProtocolService();

export function createDrawioProtocolService(): DrawioProtocolService {
    return drawioProtocolService;
}
