import 'reflect-metadata';
jest.mock('@theia/core/lib/browser', () => ({
    OpenerService: class {},
    open: jest.fn()
}));
jest.mock('./git-operations-contribution', () => ({
    GitOperationsFrontendController: class {}
}));
import URI from '@theia/core/lib/common/uri';
import { open } from '@theia/core/lib/browser';
import type { WorkspaceGraphNode } from '../common/graph-model';
import { GraphOpenHandler, toEditorSelection, validateRepositoryRelativePath } from './graph-open-handler';

describe('graph open handler helpers', () => {
    it('rejects traversal and absolute repository-relative paths', () => {
        expect(() => validateRepositoryRelativePath('../secret.txt')).toThrow('Path traversal');
        expect(() => validateRepositoryRelativePath('/etc/passwd')).toThrow('Invalid repository-relative');
        expect(() => validateRepositoryRelativePath('folder\\file.md')).toThrow('Invalid repository-relative');
    });

    it('builds a validated editor selection from an object key suffix', () => {
        expect(toEditorSelection('cpt:12:4')).toMatchObject({
            selection: {
                start: { line: 11, character: 3 }
            }
        });
        expect(toEditorSelection('cpt')).toBeUndefined();
    });

    it('opens a verified repository file through the opener service', async () => {
        const handler = new GraphOpenHandler();
        const openerService = {};
        const runtimeService = {
            resolveWorkspacePath: jest.fn().mockResolvedValue({
                exists: true,
                isDirectory: false,
                repositoryId: 'repo',
                repositoryRootUri: 'file:///workspace/repo',
                repositoryRelativePath: 'docs/file.md'
            })
        };
        const gitOperationsController = {
            getRepositories: () => [{
                schemaVersion: 1 as const,
                repositoryId: 'repo',
                fingerprint: 'fp',
                rootUri: 'file:///workspace/repo',
                workspaceRelativeRoot: 'repo',
                label: 'repo',
                git: {
                    configRevision: 'cfg',
                    mode: 'commit' as const,
                    publishEnabled: true
                }
            }]
        };
        Object.defineProperty(handler, 'openerService', { value: openerService });
        Object.defineProperty(handler, 'runtimeService', { value: runtimeService });
        Object.defineProperty(handler, 'gitOperationsController', { value: gitOperationsController });
        await handler.openNode(graphNode({
            id: 'node-1',
            label: 'File',
            cptUses: [{
                cptId: 'cpt-file',
                line: 4,
                snippet: '<!-- @cpt-file -->',
                markerKind: 'md-def'
            }],
            location: {
                workspaceId: 'ws',
                repositoryId: 'repo',
                repositoryRelativePath: 'docs/file.md'
            }
        }));
        expect(runtimeService.resolveWorkspacePath).toHaveBeenCalledWith({
            relativePath: 'repo/docs/file.md',
            requireExists: true
        });
        expect(open).toHaveBeenCalledWith(
            openerService,
            new URI('file:///workspace/repo').resolve('docs/file.md'),
            expect.objectContaining({
                selection: {
                    start: { line: 3, character: 0 },
                    end: { line: 3, character: 0 }
                }
            })
        );
    });

    it('rejects missing verified file targets', async () => {
        const handler = new GraphOpenHandler();
        Object.defineProperty(handler, 'openerService', { value: {} });
        Object.defineProperty(handler, 'runtimeService', {
            value: {
                resolveWorkspacePath: jest.fn().mockResolvedValue({
                    exists: false,
                    isDirectory: false,
                    repositoryRootUri: 'file:///workspace/repo',
                    repositoryRelativePath: 'missing.md'
                })
            }
        });
        Object.defineProperty(handler, 'gitOperationsController', {
            value: {
                getRepositories: () => [{
                    schemaVersion: 1 as const,
                    repositoryId: 'repo',
                    fingerprint: 'fp',
                    rootUri: 'file:///workspace/repo',
                    workspaceRelativeRoot: '',
                    label: 'repo',
                    git: { configRevision: 'cfg', mode: 'commit' as const, publishEnabled: true }
                }]
            }
        });
        await expect(handler.openNode(graphNode({
            id: 'node-1',
            label: 'File',
            relPath: 'missing.md',
            location: {
                workspaceId: 'ws',
                repositoryId: 'repo',
                repositoryRelativePath: 'missing.md'
            }
        }))).rejects.toThrow('does not exist');
    });

    it('rejects repository verification mismatches after resolution', async () => {
        const handler = new GraphOpenHandler();
        Object.defineProperty(handler, 'openerService', { value: {} });
        Object.defineProperty(handler, 'runtimeService', {
            value: {
                resolveWorkspacePath: jest.fn().mockResolvedValue({
                    exists: true,
                    isDirectory: false,
                    repositoryId: 'other-repo',
                    repositoryRootUri: 'file:///workspace/other',
                    repositoryRelativePath: 'docs/file.md'
                })
            }
        });
        Object.defineProperty(handler, 'gitOperationsController', {
            value: {
                getRepositories: () => [{
                    schemaVersion: 1 as const,
                    repositoryId: 'repo',
                    fingerprint: 'fp',
                    rootUri: 'file:///workspace/repo',
                    workspaceRelativeRoot: 'repo',
                    label: 'repo',
                    git: { configRevision: 'cfg', mode: 'commit' as const, publishEnabled: true }
                }]
            }
        });
        await expect(handler.openNode(graphNode({
            id: 'node-1',
            label: 'File',
            location: {
                workspaceId: 'ws',
                repositoryId: 'repo',
                repositoryRelativePath: 'docs/file.md'
            }
        }))).rejects.toThrow('expected');
    });

    it('rejects canonical phantom nodes before repository resolution', async () => {
        const handler = new GraphOpenHandler();
        Object.defineProperty(handler, 'gitOperationsController', {
            value: { getRepositories: jest.fn() }
        });

        await expect(handler.openNode(graphNode({
            id: 'phantom:cpt-missing',
            relPath: null,
            source: null,
            kind: 'phantom-cpt',
            language: null,
            category: 'phantom',
            categoryOrigin: 'phantom',
            content: null
        }))).rejects.toThrow('does not represent an openable workspace file');
    });
});

function graphNode(overrides: Partial<WorkspaceGraphNode>): WorkspaceGraphNode {
    return {
        id: 'docs:docs/file.md',
        relPath: 'docs/file.md',
        source: 'docs',
        kind: 'markdown',
        language: 'markdown',
        category: 'requirements',
        categoryOrigin: 'registry',
        content: '# File',
        loc: 1,
        cptDefs: [],
        cptUses: [],
        label: 'file.md',
        location: {
            workspaceId: 'ws',
            repositoryId: 'repo',
            repositoryRelativePath: 'docs/file.md'
        },
        position: { x: 0, y: 0 },
        ...overrides
    };
}
