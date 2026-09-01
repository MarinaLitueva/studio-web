import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import {
    WorkspaceSourceRegistry,
    type WorkspaceSourceRepositoryRegistration
} from './workspace-source-registry';
import type { WorkspaceConfigLoadResult } from './workspace-config-service';

describe('workspace source registry', () => {
    let tempDir: string;
    let workspaceRoot: string;
    let configPath: string;
    let registry: WorkspaceSourceRegistry;

    beforeEach(async () => {
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'workspace-source-registry-'));
        workspaceRoot = path.join(tempDir, 'workspace');
        configPath = path.join(workspaceRoot, '.cf-workspace.toml');
        await fs.mkdir(workspaceRoot, { recursive: true });
        registry = new WorkspaceSourceRegistry();
    });

    afterEach(async () => {
        registry.dispose();
        await fs.rm(tempDir, { recursive: true, force: true });
    });

    it('reconciles configured and missing sources without admitting unconfigured directories', async () => {
        const docsRoot = path.join(workspaceRoot, 'docs');
        const strayRoot = path.join(workspaceRoot, 'stray');
        await fs.mkdir(docsRoot, { recursive: true });
        await fs.mkdir(path.join(strayRoot, '.git'), { recursive: true });
        const canonicalDocsRoot = await fs.realpath(docsRoot);

        const snapshot = await registry.reconcile(createLoadResult(configPath, {
            docs: { path: 'docs' },
            remote: { url: 'https://github.com/example/remote.git', branch: 'main' }
        }), '2026-07-29T10:00:00.000Z');

        expect(snapshot.configuredSources.map(source => source.sourceId)).toEqual(['docs', 'remote']);
        expect(snapshot.configuredSources.find(source => source.sourceId === 'docs')?.localPath).toBe(canonicalDocsRoot);
        expect(snapshot.observedSources).toEqual([
            expect.objectContaining({
                sourceId: 'docs',
                status: 'present',
                syncEligibility: 'not-configured',
                isPresent: true
            }),
            expect.objectContaining({
                sourceId: 'remote',
                status: 'missing',
                syncEligibility: 'requires-trust',
                isPresent: false
            })
        ]);
        expect(snapshot.diagnostics.map(diagnostic => diagnostic.code)).toContain('workspace.source.missing');
    });

    it('derives deterministic URL destinations under resolve.workdir', async () => {
        const expectedLocalPath = await fs.realpath(workspaceRoot);
        const snapshot = await registry.reconcile(createLoadResult(configPath, {
            remote: { url: 'https://gitlab.example.com/group/repo.git', branch: 'main' }
        }, {
            workdir: '.sources-cache'
        }), '2026-07-29T10:00:00.000Z');

        expect(snapshot.configuredSources[0]).toMatchObject({
            sourceId: 'remote',
            localPath: path.join(expectedLocalPath, '.sources-cache', 'group', 'repo'),
            remoteUrl: 'https://gitlab.example.com/group/repo.git',
            provider: 'gitlab',
            ref: 'main',
            defaultBranch: 'main'
        });
    });

    it('keeps remote identity for an already-materialized managed checkout', async () => {
        const sourceRoot = path.join(workspaceRoot, 'studio-web');
        await fs.mkdir(path.join(sourceRoot, '.git'), { recursive: true });

        const snapshot = await registry.reconcile(createLoadResult(configPath, {
            'studio-web': {
                path: 'studio-web',
                url: 'https://github.com/constructorfabric/studio-web.git',
                branch: 'main'
            }
        }), '2026-09-01T10:00:00.000Z');

        expect(snapshot.configuredSources[0]).toMatchObject({
            sourceId: 'studio-web',
            localPath: await fs.realpath(sourceRoot),
            remoteUrl: 'https://github.com/constructorfabric/studio-web.git',
            provider: 'github',
            ref: 'main',
            defaultBranch: 'main'
        });
        expect(snapshot.observedSources[0]).toMatchObject({
            status: 'present',
            syncEligibility: 'safe'
        });
    });

    it.each([
        ['a parent-escaping value', '../outside'],
        ['an absolute value', path.join(os.tmpdir(), 'outside')]
    ])('rejects %s for resolve.workdir', async (_label, workdir) => {
        await expect(registry.reconcile(createLoadResult(configPath, {
            remote: { url: 'https://github.com/example/remote.git' }
        }, {
            workdir
        }), '2026-07-29T10:00:00.000Z')).rejects.toThrow(
            'Workspace resolve.workdir must be relative and stay within the workspace root'
        );
    });

    it('marks duplicate and nested configured roots distinctly', async () => {
        const docsRoot = path.join(workspaceRoot, 'docs');
        const nestedRoot = path.join(docsRoot, 'nested');
        await fs.mkdir(nestedRoot, { recursive: true });

        const duplicateSnapshot = await registry.reconcile(createLoadResult(configPath, {
            docs: { path: 'docs' },
            docsAlias: { path: './docs' }
        }), '2026-07-29T10:00:00.000Z');
        expect(duplicateSnapshot.observedSources.every(source => source.status === 'duplicate')).toBe(true);
        expect(duplicateSnapshot.diagnostics.map(diagnostic => diagnostic.code)).toContain('workspace.source.duplicate_root');

        const nestedSnapshot = await registry.reconcile(createLoadResult(configPath, {
            docs: { path: 'docs' },
            nested: { path: 'docs/nested' }
        }), '2026-07-29T10:05:00.000Z');
        expect(nestedSnapshot.observedSources.every(source => source.status === 'nested')).toBe(true);
        expect(nestedSnapshot.diagnostics.map(diagnostic => diagnostic.code)).toContain('workspace.source.nested_root');
    });

    it('allows explicit external paths and blocks internal symlink escapes', async () => {
        const externalRoot = path.join(tempDir, 'external');
        const linkedTarget = path.join(tempDir, 'linked-target');
        await fs.mkdir(externalRoot, { recursive: true });
        await fs.mkdir(linkedTarget, { recursive: true });
        await fs.symlink(linkedTarget, path.join(workspaceRoot, 'linked'));

        const snapshot = await registry.reconcile(createLoadResult(configPath, {
            external: { path: '../external' },
            escaped: { path: 'linked' }
        }), '2026-07-29T10:00:00.000Z');
        const canonicalExternalRoot = await fs.realpath(externalRoot);

        expect(snapshot.configuredSources.find(source => source.sourceId === 'external')?.localPath)
            .toBe(canonicalExternalRoot);
        expect(snapshot.observedSources).toEqual(expect.arrayContaining([
            expect.objectContaining({
                sourceId: 'external',
                status: 'present',
                syncEligibility: 'not-configured'
            }),
            expect.objectContaining({
                sourceId: 'escaped',
                status: 'blocked',
                syncEligibility: 'blocked'
            })
        ]));
        expect(snapshot.diagnostics.map(diagnostic => diagnostic.code)).toEqual(expect.arrayContaining([
            'workspace.source.external_path',
            'workspace.source.symlink_escape'
        ]));
    });

    it('suppresses change events when only observedAt changes', async () => {
        const docsRoot = path.join(workspaceRoot, 'docs');
        await fs.mkdir(docsRoot, { recursive: true });
        const listener = jest.fn();
        registry.onDidChangeSnapshot(listener);

        await registry.reconcile(createLoadResult(configPath, { docs: { path: 'docs' } }), '2026-07-29T10:00:00.000Z');
        await registry.reconcile(createLoadResult(configPath, { docs: { path: 'docs' } }), '2026-07-29T10:05:00.000Z');

        expect(listener).toHaveBeenCalledTimes(1);
        expect(registry.currentSnapshot.observedAt).toBe('2026-07-29T10:05:00.000Z');
    });

    it('projects SCM registrations only for configured present git working trees', async () => {
        const appRoot = path.join(workspaceRoot, 'app');
        const nestedRoot = path.join(appRoot, 'nested');
        const detachedRoot = path.join(workspaceRoot, 'detached');
        const externalGitDir = path.join(tempDir, 'gitdirs', 'detached');
        await fs.mkdir(path.join(appRoot, '.git'), { recursive: true });
        await fs.mkdir(path.join(nestedRoot, '.git'), { recursive: true });
        await fs.mkdir(detachedRoot, { recursive: true });
        await fs.mkdir(externalGitDir, { recursive: true });
        await fs.writeFile(path.join(detachedRoot, '.git'), `gitdir: ${path.relative(detachedRoot, externalGitDir)}\n`, 'utf8');
        const canonicalAppRoot = await fs.realpath(appRoot);
        const canonicalNestedRoot = await fs.realpath(nestedRoot);
        const canonicalDetachedRoot = await fs.realpath(detachedRoot);
        const canonicalExternalGitDir = await fs.realpath(externalGitDir);

        await registry.reconcile(createLoadResult(configPath, {
            app: { path: 'app' },
            nested: { path: 'app/nested' },
            detached: { path: 'detached' },
            remoteOnly: { url: 'https://github.com/example/remote-only.git' }
        }), '2026-07-29T10:00:00.000Z');

        const registrations = await registry.projectRepositories();

        expect(registrations.map(registration => registration.sourceId)).toEqual(['app', 'detached', 'nested']);
        expect(registrations).toEqual(expect.arrayContaining<WorkspaceSourceRepositoryRegistration>([
            expect.objectContaining({
                sourceId: 'app',
                repositoryRoot: canonicalAppRoot,
                gitDirectory: path.join(canonicalAppRoot, '.git')
            }),
            expect.objectContaining({
                sourceId: 'detached',
                repositoryRoot: canonicalDetachedRoot,
                gitDirectory: canonicalExternalGitDir
            }),
            expect.objectContaining({
                sourceId: 'nested',
                repositoryRoot: canonicalNestedRoot,
                gitDirectory: path.join(canonicalNestedRoot, '.git')
            })
        ]));
        expect(registrations.find(registration => registration.sourceId === 'remoteOnly')).toBeUndefined();
    });
});

function createLoadResult(
    configPath: string,
    sources: Record<string, {
        path?: string;
        url?: string;
        branch?: string;
    }>,
    resolve?: { workdir?: string }
): WorkspaceConfigLoadResult {
    return {
        detection: 'canonical',
        state: 'valid',
        configPath,
        revision: 'revision-1',
        diagnostics: [],
        parsedData: {
            version: '1.0',
            sources,
            resolve
        }
    };
}
