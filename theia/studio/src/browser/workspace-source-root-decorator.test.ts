import 'reflect-metadata';
import { Emitter } from '@theia/core/lib/common';
import URI from '@theia/core/lib/common/uri';
import type { FileChangesEvent } from '@theia/filesystem/lib/common/files';
import type { FileService } from '@theia/filesystem/lib/browser/file-service';
import type { Tree } from '@theia/core/lib/browser/tree/tree';
import type { WorkspaceSnapshot } from '../common/workspace-protocol';
import { WorkspaceSourceRootDecorator, WorkspaceSourceRootService } from './workspace-source-root-decorator';

describe('Workspace Sources root decoration', () => {
    it('decorates only the exact resolve root, not its owner or repository descendants', () => {
        const harness = createHarness();
        harness.service.updateSnapshot(snapshotWith('file:///workspace/workspace-sources'));
        const root = directoryNode('workspace', 'file:///workspace', [
            directoryNode('sources', 'file:///workspace/workspace-sources', [
                directoryNode('owner', 'file:///workspace/workspace-sources/constructorfabric', [
                    directoryNode('repo', 'file:///workspace/workspace-sources/constructorfabric/studio')
                ])
            ]),
            directoryNode('other', 'file:///workspace/other')
        ]);

        const decorations = harness.decorator.decorations({ root } as Tree);

        expect([...decorations.keys()]).toEqual(['sources']);
        expect(decorations.get('sources')).toMatchObject({
            priority: -100,
            tailDecorations: [{
                data: 'Sources',
                tooltip: 'Workspace Sources root — /workspace/workspace-sources'
            }]
        });
    });

    it('moves the decoration when a new valid snapshot changes resolve.workdir', () => {
        const harness = createHarness();
        const changed = jest.fn();
        harness.decorator.onDidChangeDecorations(changed);
        harness.service.updateSnapshot(snapshotWith('file:///workspace/first'));
        harness.service.updateSnapshot(snapshotWith('file:///workspace/second'));

        const root = directoryNode('workspace', 'file:///workspace', [
            directoryNode('first', 'file:///workspace/first'),
            directoryNode('second', 'file:///workspace/second')
        ]);

        expect([...harness.decorator.decorations({ root } as Tree).keys()]).toEqual(['second']);
        expect(changed).toHaveBeenCalledTimes(2);
        expect(harness.watches.map(uri => uri.toString())).toEqual([
            'file:///workspace',
            'file:///workspace'
        ]);
    });

    it('recalculates when the planned root appears without inventing a ghost node', () => {
        const harness = createHarness();
        const changed = jest.fn();
        harness.decorator.onDidChangeDecorations(changed);
        harness.service.updateSnapshot(snapshotWith('file:///workspace/missing'));

        expect(harness.decorator.decorations({
            root: directoryNode('workspace', 'file:///workspace')
        } as Tree).size).toBe(0);

        harness.fileChanges.fire({
            contains: (candidate: URI) => candidate.isEqual(new URI('file:///workspace/missing'))
        } as FileChangesEvent);

        expect(changed).toHaveBeenCalledTimes(2);
    });
});

function createHarness() {
    const fileChanges = new Emitter<FileChangesEvent>();
    const watches: URI[] = [];
    const fileService = {
        onDidFilesChange: fileChanges.event,
        watch: (uri: URI) => {
            watches.push(uri);
            return { dispose: jest.fn() };
        }
    } as unknown as FileService;
    const service = new WorkspaceSourceRootService(fileService);
    const decorator = new WorkspaceSourceRootDecorator(service);
    return { decorator, fileChanges, service, watches };
}

function directoryNode(id: string, uri: string, children: unknown[] = []): any {
    const resource = new URI(uri);
    return {
        id,
        uri: resource,
        fileStat: {
            resource,
            isDirectory: true
        },
        children,
        parent: undefined,
        selected: false
    };
}

function snapshotWith(resolveRootUri: string): WorkspaceSnapshot {
    return {
        schemaVersion: 1,
        identity: {
            workspaceId: 'workspace-1',
            configPath: '/workspace/.cf-workspace.toml',
            configFileName: '.cf-workspace.toml'
        },
        config: {
            revision: resolveRootUri,
            schemaVersion: 1,
            rawTomlAvailable: true,
            resolveRootUri
        },
        state: 'ready',
        configuredSources: [],
        observedSources: [],
        suggestions: [],
        jobs: [],
        migration: {
            mode: 'canonical-active',
            status: 'completed',
            rollbackAvailable: false
        },
        diagnostics: []
    };
}
