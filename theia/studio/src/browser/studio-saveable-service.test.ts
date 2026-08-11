import 'reflect-metadata';
jest.mock('@theia/filesystem/lib/browser/filesystem-saveable-service', () => ({
    FilesystemSaveableService: class {
        autoSave = 'off';
        onDidInitializeLayout(): void {}
        protected updateAutoSaveMode(): void {}
        async save(): Promise<URI | undefined> {
            return undefined;
        }
    }
}));
jest.mock('@theia/workspace/lib/browser/workspace-service', () => ({
    WorkspaceService: class {}
}));
jest.mock('./git-operations-contribution', () => ({
    GitOperationsFrontendController: class {}
}));
jest.mock('@theia/core/lib/browser/language-service', () => ({
    LanguageService: class {}
}));
jest.mock('@theia/core/lib/browser/shell/application-shell', () => ({
    ApplicationShell: class {}
}));
import URI from '@theia/core/lib/common/uri';
import { BinaryBuffer } from '@theia/core/lib/common/buffer';
import { SaveReason } from '@theia/core/lib/browser/saveable';
import { StudioSaveableService } from './studio-saveable-service';

describe('StudioSaveableService', () => {
    const markdownUri = new URI('file:///workspace/project/src/file.md');
    const textUri = new URI('file:///workspace/project/src/file.txt');
    const aliasMarkdownUri = new URI('file:///workspace/project/src/README.mdown');
    const originalCrypto = globalThis.crypto;

    beforeAll(() => {
        Object.defineProperty(globalThis, 'crypto', {
            configurable: true,
            value: {
                subtle: {
                    digest: jest.fn(async () => new Uint8Array([1, 2, 3, 4]).buffer)
                }
            }
        });
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    afterAll(() => {
        Object.defineProperty(globalThis, 'crypto', {
            configurable: true,
            value: originalCrypto
        });
    });

    it('enqueues exactly once after a successful explicit save', async () => {
        const service = createService();
        mockBaseSave(markdownUri);

        await service.save(createSaveableWidget(true) as never, { saveReason: SaveReason.Manual });
        await flushMicrotasks();

        expect(service['operationsController'].enqueueOperation).toHaveBeenCalledTimes(1);
        expect(Object.keys((service['operationsController'].enqueueOperation as jest.Mock).mock.calls[0][0]).sort()).toEqual([
            'contentHash',
            'idempotencyKey',
            'languageId',
            'relativePath',
            'repositoryId',
            'savedAt',
            'workspaceId'
        ]);
        expect(service['operationsController'].enqueueOperation).toHaveBeenCalledWith(expect.objectContaining({
            languageId: 'markdown',
            savedAt: expect.stringMatching(/^20\d\d-\d\d-\d\dT/)
        }));
    });

    it('enqueues after a manual save from a Studio markdown widget saveable source', async () => {
        const service = createService();
        mockBaseSave(markdownUri);
        const widget = createSaveableSourceWidget(createSaveableWidget(true, () => ({ value: '# Studio markdown\n' })));
        Object.defineProperty(service['applicationShellProvider'](), 'currentWidget', {
            configurable: true,
            value: widget
        });

        await service.save(widget as never, { saveReason: SaveReason.Manual });
        await flushMicrotasks();

        expect(service['operationsController'].enqueueOperation).toHaveBeenCalledTimes(1);
        expect(service['operationsController'].enqueueOperation).toHaveBeenCalledWith(expect.objectContaining({
            languageId: 'markdown',
            relativePath: 'src/file.md'
        }));
        expect(service['operationsController'].selectRepository).toHaveBeenCalledWith('repository-1');
    });

    it('enqueues after a manual save from a standard text editor widget saveable source', async () => {
        const service = createService();
        mockBaseSave(markdownUri);
        const widget = createEditorWidgetSaveableSource(markdownUri, createSaveableWidget(true, () => ({ value: '# Text editor markdown\n' })));
        Object.defineProperty(service['applicationShellProvider'](), 'currentWidget', {
            configurable: true,
            value: widget
        });

        await service.save(widget as never, { saveReason: SaveReason.Manual });
        await flushMicrotasks();

        expect(service['operationsController'].enqueueOperation).toHaveBeenCalledTimes(1);
        expect(service['operationsController'].enqueueOperation).toHaveBeenCalledWith(expect.objectContaining({
            languageId: 'markdown',
            relativePath: 'src/file.md'
        }));
        expect(service['operationsController'].selectRepository).toHaveBeenCalledWith('repository-1');
    });

    it('does not enqueue when the underlying save fails', async () => {
        const service = createService();
        jest.spyOn(Object.getPrototypeOf(Object.getPrototypeOf(service)), 'save').mockRejectedValue(new Error('save failed'));

        await expect(service.save(createSaveableWidget(true) as never, { saveReason: SaveReason.Manual })).rejects.toThrow('save failed');
        expect(service['operationsController'].enqueueOperation).not.toHaveBeenCalled();
    });

    it('suppresses autosave enqueueing', async () => {
        const service = createService();
        mockBaseSave(markdownUri);

        await service.save(createSaveableWidget(true) as never, { saveReason: SaveReason.AfterDelay });
        await service.save(createSaveableWidget(true) as never, { saveReason: SaveReason.FocusChange });

        expect(service['operationsController'].enqueueOperation).not.toHaveBeenCalled();
    });

    it('suppresses no-change explicit saves', async () => {
        const service = createService();
        mockBaseSave(markdownUri);

        await service.save(createSaveableWidget(false) as never, { saveReason: SaveReason.Manual });

        expect(service['operationsController'].enqueueOperation).not.toHaveBeenCalled();
    });

    it('does not enqueue files outside the fixed workspace', async () => {
        const service = createService();
        mockBaseSave(markdownUri);
        (service['workspaceService'].getWorkspaceRootUri as jest.Mock).mockReturnValue(undefined);
        (service['operationsController'].resolveWorkspaceResource as jest.Mock).mockResolvedValue(undefined);

        await service.save(createSaveableWidget(true) as never, { saveReason: SaveReason.Manual });

        expect(service['operationsController'].enqueueOperation).not.toHaveBeenCalled();
    });

    it('uses backend-canonicalized resource resolution when frontend workspace roots use a symlink alias', async () => {
        const service = createService();
        mockBaseSave(markdownUri);
        (service['workspaceService'].getWorkspaceRootUri as jest.Mock).mockReturnValue(undefined);

        await service.save(createSaveableWidget(true) as never, { saveReason: SaveReason.Manual });
        await flushMicrotasks();

        expect(service['operationsController'].resolveWorkspaceResource).toHaveBeenCalledWith(markdownUri.toString());
        expect(service['operationsController'].enqueueOperation).toHaveBeenCalledWith(expect.objectContaining({
            repositoryId: 'repository-1',
            relativePath: 'src/file.md'
        }));
    });

    it('does not enqueue when backend Git mutations are disabled', async () => {
        const service = createService();
        mockBaseSave(markdownUri);
        (service['operationsController'].getSession as jest.Mock).mockResolvedValue({
            workspaceId: 'workspace-1',
            features: { allowGitMutations: false }
        });

        await service.save(createSaveableWidget(true) as never, { saveReason: SaveReason.Manual });

        expect(service['operationsController'].enqueueOperation).not.toHaveBeenCalled();
    });

    it('creates a distinct operation for each completed explicit save of identical content', async () => {
        const service = createService();
        mockBaseSave(markdownUri, markdownUri);
        Object.defineProperty(service, 'computeIdempotencyKey', {
            configurable: true,
            value: jest.fn(async (...args: unknown[]) => `key:${args[4]}`)
        });

        await service.save(createSaveableWidget(true) as never, { saveReason: SaveReason.Manual });
        await service.save(createSaveableWidget(true) as never, { saveReason: SaveReason.Manual });
        await flushMicrotasks();

        expect(service['operationsController'].enqueueOperation).toHaveBeenCalledTimes(2);
        const [first, second] = (service['operationsController'].enqueueOperation as jest.Mock).mock.calls;
        expect(first[0].contentHash).toBe(second[0].contentHash);
        expect(first[0].idempotencyKey).not.toBe(second[0].idempotencyKey);
    });

    it('queues each persisted save while preserving enqueue ordering', async () => {
        const service = createService();
        mockBaseSave(markdownUri, markdownUri);
        let releaseEnqueue: (() => void) | undefined;
        (service['operationsController'].enqueueOperation as jest.Mock).mockImplementation(() =>
            new Promise<void>(resolve => {
                releaseEnqueue = resolve;
            })
        );

        const firstSave = service.save(createSaveableWidget(true) as never, { saveReason: SaveReason.Manual });
        await waitFor(() => (service['operationsController'].enqueueOperation as jest.Mock).mock.calls.length === 1);
        const secondSave = service.save(createSaveableWidget(true) as never, { saveReason: SaveReason.Manual });

        expect(service['operationsController'].enqueueOperation).toHaveBeenCalledTimes(1);
        await secondSave;
        releaseEnqueue?.();
        await firstSave;
        await waitFor(() => (service['operationsController'].enqueueOperation as jest.Mock).mock.calls.length === 2);
    });

    it('preserves save-all ordering', async () => {
        const service = createService();
        const secondUri = new URI('file:///workspace/project/src/second.md');
        const calls: string[] = [];
        mockBaseSave(markdownUri, secondUri);
        (service['operationsController'].enqueueOperation as jest.Mock).mockImplementation(async (request: { relativePath: string }) => {
            calls.push(request.relativePath);
        });

        await service.save(createSaveableWidget(true) as never, { saveReason: SaveReason.Manual });
        (service['workspaceService'].getWorkspaceRootUri as jest.Mock).mockReturnValueOnce(new URI('file:///workspace/project')).mockReturnValueOnce(new URI('file:///workspace/project'));
        (service['fileService'].readFile as jest.Mock).mockResolvedValueOnce({ value: BinaryBuffer.fromString('second') });
        await service.save(createSaveableWidget(true) as never, { saveReason: SaveReason.Manual });
        await flushMicrotasks();

        expect(calls).toEqual(['src/file.md', 'src/second.md']);
    });

    it('serializes preparation in save invocation order even when the first preparation is delayed', async () => {
        const service = createService();
        const secondUri = new URI('file:///workspace/project/src/second.md');
        mockBaseSave(markdownUri, secondUri);
        let releaseFirstSession: (() => void) | undefined;
        const session = {
            workspaceId: 'workspace-1',
            features: { allowGitMutations: true }
        };
        (service['operationsController'].getSession as jest.Mock)
            .mockImplementationOnce(() => new Promise(resolve => {
                releaseFirstSession = () => resolve(session);
            }))
            .mockResolvedValue(session);

        const firstSave = service.save(createSaveableWidget(true) as never, { saveReason: SaveReason.Manual });
        const secondSave = service.save(createSaveableWidget(true) as never, { saveReason: SaveReason.Manual });
        await Promise.all([firstSave, secondSave]);
        await waitFor(() => (service['operationsController'].getSession as jest.Mock).mock.calls.length === 1);
        expect(service['operationsController'].enqueueOperation).not.toHaveBeenCalled();

        releaseFirstSession?.();
        await waitFor(() => (service['operationsController'].enqueueOperation as jest.Mock).mock.calls.length === 2);

        expect((service['operationsController'].enqueueOperation as jest.Mock).mock.calls.map(call => call[0].relativePath))
            .toEqual(['src/file.md', 'src/second.md']);
    });

    it('selects the owning SCM repository only for a manual save of the active widget', async () => {
        const service = createService();
        const activeWidget = createSaveableWidget(true);
        const backgroundWidget = createSaveableWidget(true);
        const shell = service['applicationShellProvider']();
        Object.defineProperty(shell, 'currentWidget', {
            configurable: true,
            value: activeWidget
        });
        mockBaseSave(markdownUri, markdownUri);

        await service.save(activeWidget as never, { saveReason: SaveReason.Manual });
        await service.save(backgroundWidget as never, { saveReason: SaveReason.Manual });
        await flushMicrotasks();

        expect(service['operationsController'].selectRepository).toHaveBeenCalledTimes(1);
        expect(service['operationsController'].selectRepository).toHaveBeenCalledWith('repository-1');
    });

    it('does not enqueue non-markdown files after a successful manual save', async () => {
        const service = createService();
        mockBaseSave(textUri);
        (service['languageService'].detectLanguage as jest.Mock).mockReturnValueOnce({ id: 'plaintext' });

        await service.save(createSaveableWidget(true) as never, { saveReason: SaveReason.Manual });

        expect(service['operationsController'].enqueueOperation).not.toHaveBeenCalled();
    });

    it('enqueues a non-.md file when LanguageService detects markdown', async () => {
        const service = createService();
        mockBaseSave(aliasMarkdownUri);
        (service['languageService'].detectLanguage as jest.Mock).mockReturnValueOnce({ id: 'markdown' });

        await service.save(createSaveableWidget(true) as never, { saveReason: SaveReason.Manual });
        await flushMicrotasks();

        expect(service['operationsController'].enqueueOperation).toHaveBeenCalledTimes(1);
        expect(service['operationsController'].enqueueOperation).toHaveBeenCalledWith(expect.objectContaining({
            languageId: 'markdown',
            relativePath: 'src/README.mdown'
        }));
    });

    it('does not enqueue an .md file when LanguageService reports a different language or no language', async () => {
        const service = createService();
        mockBaseSave(markdownUri, markdownUri);
        (service['languageService'].detectLanguage as jest.Mock)
            .mockReturnValueOnce({ id: 'yaml' })
            .mockReturnValueOnce(undefined);

        await service.save(createSaveableWidget(true) as never, { saveReason: SaveReason.Manual });
        await service.save(createSaveableWidget(true) as never, { saveReason: SaveReason.Manual });
        await waitFor(() => (service['languageService'].detectLanguage as jest.Mock).mock.calls.length === 2);

        expect(service['operationsController'].enqueueOperation).not.toHaveBeenCalled();
        expect(service['languageService'].detectLanguage).toHaveBeenCalledWith(markdownUri);
        expect(service['languageService'].detectLanguage).toHaveBeenCalledTimes(2);
    });

    it('passes the saved uri to LanguageService detection', async () => {
        const service = createService();
        mockBaseSave(markdownUri);

        await service.save(createSaveableWidget(true) as never, { saveReason: SaveReason.Manual });
        await flushMicrotasks();

        expect(service['languageService'].detectLanguage).toHaveBeenCalledWith(markdownUri);
        expect(service['operationsController'].enqueueOperation).toHaveBeenCalledWith(expect.objectContaining({
            relativePath: 'src/file.md'
        }));
    });

    it('captures the editor snapshot before awaiting the runtime session', async () => {
        const service = createService();
        mockBaseSave(markdownUri);
        let currentContents = 'first saved contents';
        const widget = createSaveableWidget(true, () => ({ value: currentContents }));
        (service['operationsController'].getSession as jest.Mock).mockImplementation(async () => {
            currentContents = 'later edit';
            return {
                workspaceId: 'workspace-1',
                features: { allowGitMutations: true }
            };
        });

        await service.save(widget as never, { saveReason: SaveReason.Manual });
        await waitFor(() => (globalThis.crypto.subtle.digest as jest.Mock).mock.calls.some(call =>
            BinaryBuffer.wrap(new Uint8Array(call[1] as ArrayBuffer)).toString() === 'first saved contents'
        ));

        expect(service['fileService'].readFile).not.toHaveBeenCalled();
        const digestCalls = (globalThis.crypto.subtle.digest as jest.Mock).mock.calls;
        const digestInputs = digestCalls.map(call =>
            BinaryBuffer.wrap(new Uint8Array(call[1] as ArrayBuffer)).toString()
        );
        expect(digestInputs).toContain('first saved contents');
        expect(digestInputs).not.toContain('later edit');
    });

    it('resolves save before the background enqueue completes', async () => {
        const service = createService();
        mockBaseSave(markdownUri);
        let releaseEnqueue: (() => void) | undefined;
        (service['operationsController'].enqueueOperation as jest.Mock).mockImplementation(() =>
            new Promise<void>(resolve => {
                releaseEnqueue = resolve;
            })
        );

        const savePromise = service.save(createSaveableWidget(true) as never, { saveReason: SaveReason.Manual });

        await expect(Promise.race([
            savePromise.then(() => 'resolved'),
            new Promise(resolve => setTimeout(() => resolve('timeout'), 0))
        ])).resolves.toBe('resolved');
        await waitFor(() => (service['operationsController'].enqueueOperation as jest.Mock).mock.calls.length === 1);
        expect(service['operationsController'].enqueueOperation).toHaveBeenCalledTimes(1);

        releaseEnqueue?.();
        await flushMicrotasks();
    });

    it('logs asynchronous enqueue failures without rejecting the completed save', async () => {
        const service = createService();
        mockBaseSave(markdownUri);
        const enqueueError = new Error('enqueue failed');
        const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
        (service['operationsController'].enqueueOperation as jest.Mock).mockRejectedValue(enqueueError);

        await expect(service.save(createSaveableWidget(true) as never, { saveReason: SaveReason.Manual })).resolves.toBe(markdownUri);
        await flushMicrotasks();

        expect(consoleSpy).toHaveBeenCalledWith('Studio post-save enqueue failed', enqueueError);
    });

    it('does not reject a persisted save when post-save preparation fails', async () => {
        const service = createService();
        mockBaseSave(markdownUri);
        const preparationError = new Error('session unavailable');
        const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
        (service['operationsController'].getSession as jest.Mock).mockRejectedValue(preparationError);

        await expect(service.save(createSaveableWidget(true) as never, { saveReason: SaveReason.Manual }))
            .resolves.toBe(markdownUri);
        await flushMicrotasks();

        expect(consoleSpy).toHaveBeenCalledWith('Studio post-save preparation failed', preparationError);
    });
});

async function waitFor(predicate: () => boolean): Promise<void> {
    for (let attempt = 0; attempt < 50; attempt += 1) {
        if (predicate()) {
            return;
        }
        await new Promise(resolve => setTimeout(resolve, 0));
    }
    throw new Error('Timed out waiting for test condition');
}

async function flushMicrotasks(): Promise<void> {
    for (let attempt = 0; attempt < 20; attempt += 1) {
        await Promise.resolve();
    }
}

function createService(): StudioSaveableService {
    const service = new StudioSaveableService();
    const shell = {
        currentWidget: undefined as unknown
    };
    Object.defineProperty(service, 'operationsController', {
        value: {
            getSession: jest.fn().mockResolvedValue({
                workspaceId: 'workspace-1',
                features: { allowGitMutations: true }
            }),
            enqueueOperation: jest.fn().mockResolvedValue(undefined),
            resolveRepository: jest.fn().mockResolvedValue({
                repositoryId: 'repository-1'
            }),
            resolveWorkspaceResource: jest.fn().mockResolvedValue({
                relativePath: 'src/file.md',
                repository: {
                    repositoryId: 'repository-1'
                }
            }),
            selectRepository: jest.fn().mockResolvedValue(undefined)
        }
    });
    Object.defineProperty(service, 'workspaceService', {
        value: {
            getWorkspaceRootUri: jest.fn().mockReturnValue(new URI('file:///workspace/project'))
        }
    });
    Object.defineProperty(service, 'languageService', {
        value: {
            detectLanguage: jest.fn((uri: URI) => uri.toString().endsWith('.md') ? { id: 'markdown' } : undefined)
        }
    });
    Object.defineProperty(service, 'fileService', {
        value: {
            readFile: jest.fn().mockResolvedValue({ value: BinaryBuffer.fromString('saved-file') })
        }
    });
    Object.defineProperty(service, 'applicationShellProvider', {
        value: jest.fn(() => shell)
    });
    return service;
}

function mockBaseSave(...uris: URI[]): void {
    const spy = jest.spyOn(Object.getPrototypeOf(Object.getPrototypeOf(new StudioSaveableService())), 'save');
    let index = 0;
    spy.mockImplementation(async () => uris[index++] ?? uris[uris.length - 1]);
}

function createSaveableWidget(dirty: boolean, createSnapshot?: () => { value: string }) {
    return {
        dirty,
        ...(createSnapshot ? { createSnapshot } : {}),
        onDirtyChanged: jest.fn(() => ({ dispose: jest.fn() })),
        onContentChanged: jest.fn(() => ({ dispose: jest.fn() }))
    };
}

function createSaveableSourceWidget(saveable: ReturnType<typeof createSaveableWidget>) {
    return {
        saveable
    };
}

function createEditorWidgetSaveableSource(uri: URI, saveable: ReturnType<typeof createSaveableWidget>) {
    return {
        id: 'editor-widget:guide.md',
        saveable,
        editor: {
            document: {
                uri
            }
        }
    };
}
