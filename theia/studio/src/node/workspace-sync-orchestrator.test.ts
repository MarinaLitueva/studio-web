import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { pathToFileURL } from 'url';
import { WorkspaceSourceRegistry } from './workspace-source-registry';
import { WorkspaceSyncOrchestrator } from './workspace-sync-orchestrator';
import type { WorkspaceConfigLoadResult } from './workspace-config-service';
import type { WorkspaceGitInspection, WorkspaceGitMutationResult, WorkspaceGitSourceTarget } from './workspace-git-service';

describe('workspace sync orchestrator', () => {
    let tempDir: string;
    let workspaceRoot: string;
    let configPath: string;
    let stateDir: string;
    let config: WorkspaceConfigLoadResult;
    let configService: { load: jest.Mock<Promise<WorkspaceConfigLoadResult>, [string]> };
    let git: FakeGitService;
    let orchestrator: WorkspaceSyncOrchestrator;
    let registry: WorkspaceSourceRegistry;

    beforeEach(async () => {
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'workspace-sync-orchestrator-'));
        workspaceRoot = path.join(tempDir, 'workspace');
        configPath = path.join(workspaceRoot, '.cf-workspace.toml');
        stateDir = path.join(tempDir, 'state');
        await fs.mkdir(workspaceRoot, { recursive: true });
        registry = new WorkspaceSourceRegistry();
        git = new FakeGitService();
        config = createLoadResult(configPath, 'rev-1', {
            docs: { path: 'docs' },
            studio: { url: 'https://example.test/studio.git', branch: 'main' },
            api: { url: 'https://example.test/api.git', branch: 'main' }
        });
        configService = {
            load: jest.fn(async (_workspaceRoot: string) => config)
        };
        orchestrator = createOrchestrator();
        await orchestrator.initialize();
    });

    afterEach(async () => {
        orchestrator.dispose();
        registry.dispose();
        await fs.rm(tempDir, { recursive: true, force: true });
    });

    it('refreshes read-only without git inspection until explicitly requested', async () => {
        await fs.mkdir(path.join(workspaceRoot, 'docs'), { recursive: true });

        const snapshot = await orchestrator.refresh();

        expect(snapshot.configuredSources.map(source => source.sourceId)).toEqual(['api', 'docs', 'studio']);
        expect(snapshot.observedSources.find(source => source.sourceId === 'docs')).toMatchObject({
            status: 'present',
            syncEligibility: 'not-configured'
        });
        expect(git.inspectCalls).toEqual([]);

        git.setInspection('studio', inspection('studio', path.join(workspaceRoot, '.workspace-sources', 'studio'), 'behind', {
            currentRevision: 'a'.repeat(40),
            behindCount: 2
        }));
        const inspected = await orchestrator.refresh({ includeGitInspection: true, sourceIds: ['studio'] });
        expect(inspected.observedSources.find(source => source.sourceId === 'studio')).toMatchObject({
            status: 'behind',
            syncEligibility: 'safe',
            behindCount: 2
        });
    });

    it('projects resolve.workdir into the workspace snapshot', async () => {
        config = {
            ...config,
            parsedData: {
                ...config.parsedData!,
                resolve: { workdir: 'workspace-sources' },
                sources: {
                    ...config.parsedData!.sources,
                    studio: { url: 'https://github.com/example/studio.git', branch: 'main' }
                }
            }
        };

        const snapshot = await orchestrator.refresh();
        const canonicalWorkspaceRoot = await fs.realpath(workspaceRoot);

        expect(snapshot.config.resolveWorkdir).toBe('workspace-sources');
        expect(snapshot.config.resolveRootUri).toBe(pathToFileURL(path.join(workspaceRoot, 'workspace-sources')).toString());
        expect(snapshot.config.canonicalResolveRootUri).toBeUndefined();
        expect(snapshot.configuredSources.find(source => source.sourceId === 'studio')?.localPath)
            .toBe(path.join(canonicalWorkspaceRoot, 'workspace-sources', 'example', 'studio'));
    });

    it('creates awaiting-confirmation sync jobs without git mutations when trust is absent', async () => {
        git.setInspection('studio', inspection('studio', path.join(workspaceRoot, '.workspace-sources', 'studio'), 'missing'));

        const response = await orchestrator.startSync({
            expectedRevision: 'rev-1',
            sourceIds: ['studio']
        });

        await waitFor(() => orchestrator.currentSnapshot.jobs.some(job => job.state === 'awaiting-confirmation'));
        const job = orchestrator.currentSnapshot.jobs.find(candidate => candidate.jobId === response.job.jobId)!;
        expect(job.state).toBe('awaiting-confirmation');
        expect(job.sourcePreviews?.[0]).toMatchObject({
            sourceId: 'studio',
            status: 'missing',
            eligibility: 'requires-trust'
        });
        expect(git.cloneCalls).toEqual([]);
        expect(git.fastForwardCalls).toEqual([]);
    });

    it('confirms and clones a missing source after trust approval', async () => {
        git.setInspection('studio', inspection('studio', path.join(workspaceRoot, '.workspace-sources', 'studio'), 'missing'));
        git.cloneResult = {
            outcome: 'cloned',
            sourceId: 'studio',
            localPath: path.join(workspaceRoot, '.workspace-sources', 'studio'),
            revision: 'b'.repeat(40)
        };

        const initial = await orchestrator.startSync({
            expectedRevision: 'rev-1',
            sourceIds: ['studio']
        });
        await waitFor(() => orchestrator.currentSnapshot.jobs.some(job => job.state === 'awaiting-confirmation'));

        const confirmed = await orchestrator.confirmSync({
            jobId: initial.job.jobId,
            trustConfirmed: true,
            expectedRevision: 'rev-1'
        });
        await waitFor(() => orchestrator.currentSnapshot.jobs.some(job => job.jobId === confirmed.job.jobId && job.state === 'completed'));

        expect(git.cloneCalls).toEqual(['studio']);
        expect(orchestrator.currentSnapshot.jobs.find(job => job.jobId === confirmed.job.jobId)?.state).toBe('completed');
    });

    it('updates clean or behind sources and keeps partial batch failures isolated', async () => {
        git.setInspection('studio', inspection('studio', path.join(workspaceRoot, '.workspace-sources', 'studio'), 'behind', {
            currentRevision: '1'.repeat(40),
            behindCount: 1
        }));
        git.setInspection('api', inspection('api', path.join(workspaceRoot, '.workspace-sources', 'api'), 'behind', {
            currentRevision: '2'.repeat(40),
            behindCount: 1
        }));
        git.fastForwardResults.set('studio', {
            outcome: 'updated',
            sourceId: 'studio',
            localPath: path.join(workspaceRoot, '.workspace-sources', 'studio'),
            revision: '3'.repeat(40)
        });
        git.fastForwardResults.set('api', {
            outcome: 'auth-required',
            sourceId: 'api',
            message: 'token=[redacted] password=[redacted]'
        });

        const response = await orchestrator.startSync({
            expectedRevision: 'rev-1',
            sourceIds: ['studio', 'api'],
            trustConfirmed: true
        });
        expect(['queued', 'running', 'completed']).toContain(response.job.state);
        await waitFor(() =>
            orchestrator.currentSnapshot.jobs.some(job => job.state === 'completed')
            && orchestrator.currentSnapshot.jobs.some(job => job.lastError?.code === 'auth-required')
        );

        expect(git.fastForwardCalls).toContain('api');
        expect(orchestrator.currentSnapshot.jobs.some(job => job.state === 'completed')).toBe(true);
        expect(orchestrator.currentSnapshot.jobs.some(job => job.lastError?.code === 'auth-required')).toBe(true);
        expect(orchestrator.currentSnapshot.jobs.find(job => job.lastError?.code === 'auth-required')).toBeDefined();
        expect(orchestrator.currentSnapshot.observedSources.find(source => source.sourceId === 'api')).toMatchObject({
            status: 'auth-required',
            blockedReason: 'token=[redacted] password=[redacted]'
        });
        expect(orchestrator.currentSnapshot.jobs.some(job => job.state === 'completed')).toBe(true);
    });

    it('blocks dirty sources and requires per-source force plus revision for diverged sources', async () => {
        git.setInspection('studio', inspection('studio', path.join(workspaceRoot, '.workspace-sources', 'studio'), 'dirty', {
            currentRevision: '4'.repeat(40)
        }));
        git.setInspection('api', inspection('api', path.join(workspaceRoot, '.workspace-sources', 'api'), 'diverged', {
            currentRevision: '5'.repeat(40),
            remoteRevision: '9'.repeat(40),
            aheadCount: 2,
            behindCount: 1
        }));
        const response = await orchestrator.startSync({
            expectedRevision: 'rev-1',
            sourceIds: ['studio', 'api'],
            trustConfirmed: true
        });
        await waitFor(() => orchestrator.currentSnapshot.jobs.some(job => job.sourcePreviews?.some(preview => preview.sourceId === 'api')));

        expect(orchestrator.currentSnapshot.observedSources.find(source => source.sourceId === 'studio')).toMatchObject({
            status: 'dirty',
            syncEligibility: 'blocked'
        });
        const apiJob = orchestrator.currentSnapshot.jobs.find(job => job.jobId !== response.job.jobId && job.sourcePreviews?.some(preview => preview.sourceId === 'api'))
            ?? orchestrator.currentSnapshot.jobs.find(job => job.sourcePreviews?.some(preview => preview.sourceId === 'api'))!;
        expect(apiJob.sourcePreviews?.[0]).toMatchObject({
            sourceId: 'api',
            status: 'diverged',
            eligibility: 'requires-force',
            expectedRevision: '5'.repeat(40),
            expectedRemoteRevision: '9'.repeat(40)
        });

        git.forceResult = {
            outcome: 'force-updated',
            sourceId: 'api',
            localPath: path.join(workspaceRoot, '.workspace-sources', 'api'),
            revision: '6'.repeat(40)
        };
        const confirmed = await orchestrator.confirmSync({
            jobId: apiJob.jobId,
            trustConfirmed: true,
            expectedRevision: 'rev-1',
            forceSourceIds: ['api']
        });
        await waitFor(() => orchestrator.currentSnapshot.jobs.some(job => job.jobId === confirmed.job.jobId && job.state === 'completed'));
        expect(git.forceCalls).toEqual([{
            sourceId: 'api',
            expectedRevision: '5'.repeat(40),
            expectedRemoteRevision: '9'.repeat(40)
        }]);
    });

    it('cancels running jobs and keeps cleanup reflected', async () => {
        let release: () => void = () => undefined;
        git.setInspection('studio', inspection('studio', path.join(workspaceRoot, '.workspace-sources', 'studio'), 'behind', {
            currentRevision: '7'.repeat(40),
            behindCount: 1
        }));
        git.fastForwardResults.set('studio', new Promise<WorkspaceGitMutationResult>(resolve => {
            release = () => resolve({
                outcome: 'cancelled',
                sourceId: 'studio',
                phase: 'sync'
            });
        }));

        const response = await orchestrator.startSync({
            expectedRevision: 'rev-1',
            sourceIds: ['studio'],
            trustConfirmed: true
        });
        await waitFor(() => orchestrator.currentSnapshot.jobs.some(job => job.jobId === response.job.jobId && job.state === 'running'));

        await orchestrator.cancelJob({ jobId: response.job.jobId });
        release();
        await waitFor(() => orchestrator.currentSnapshot.jobs.some(job => job.jobId === response.job.jobId && job.state === 'cancelled'));

        expect(orchestrator.currentSnapshot.jobs.find(job => job.jobId === response.job.jobId)?.state).toBe('cancelled');
    });

    it('requires fresh confirmation when retrying auth or confirmation failures', async () => {
        git.setInspection('studio', inspection('studio', path.join(workspaceRoot, '.workspace-sources', 'studio'), 'behind', {
            currentRevision: '8'.repeat(40),
            behindCount: 1
        }));
        git.fastForwardResults.set('studio', {
            outcome: 'auth-required',
            sourceId: 'studio',
            message: 'auth failed'
        });

        const response = await orchestrator.startSync({
            expectedRevision: 'rev-1',
            sourceIds: ['studio'],
            trustConfirmed: true
        });
        await waitFor(() => orchestrator.currentSnapshot.jobs.some(job => job.jobId === response.job.jobId && job.state === 'failed'));

        await expect(orchestrator.retryJob({ jobId: response.job.jobId })).rejects.toThrow('fresh explicit confirmation');
        git.fastForwardResults.set('studio', {
            outcome: 'updated',
            sourceId: 'studio',
            localPath: path.join(workspaceRoot, '.workspace-sources', 'studio'),
            revision: '9'.repeat(40)
        });
        const retried = await orchestrator.retryJob({
            jobId: response.job.jobId,
            trustConfirmed: true,
            expectedRevision: 'rev-1'
        });
        await waitFor(() => orchestrator.currentSnapshot.jobs.some(job => job.jobId === retried.job.jobId && job.state === 'completed'));
    });

    it('does not enqueue sync work when config mutation did not apply', async () => {
        const result = await orchestrator.startSyncAfterMutation({
            status: 'conflict',
            code: 'revision-mismatch',
            message: 'stale',
            configPath,
            currentRevision: 'rev-2',
            diagnostics: []
        }, {
            sourceIds: ['studio'],
            trustConfirmed: true
        });

        expect(result).toBeUndefined();
        expect(orchestrator.currentSnapshot.jobs).toHaveLength(0);
        expect(git.inspectCalls).toEqual([]);
    });

    it('emits snapshot and activity events only when the meaningful shape changes', async () => {
        const snapshots: string[] = [];
        const activities: string[] = [];
        orchestrator.onDidChangeSnapshot(snapshot => snapshots.push(snapshot.config.revision));
        orchestrator.onDidChangeActivity(event => activities.push(`${event.job.jobId}:${event.job.state}`));

        await orchestrator.refresh();
        await orchestrator.refresh();
        expect(snapshots).toEqual([]);

        git.setInspection('studio', inspection('studio', path.join(workspaceRoot, '.workspace-sources', 'studio'), 'missing'));
        const response = await orchestrator.startSync({
            expectedRevision: 'rev-1',
            sourceIds: ['studio']
        });
        await waitFor(() => orchestrator.currentSnapshot.jobs.some(job => job.jobId === response.job.jobId && job.state === 'awaiting-confirmation'));
        expect(activities.some(activity => activity.endsWith(':awaiting-confirmation'))).toBe(true);
        expect(snapshots.length).toBeGreaterThan(0);
    });

    function createOrchestrator(): WorkspaceSyncOrchestrator {
        return new WorkspaceSyncOrchestrator({
            workspaceId: 'workspace-1',
            workspaceRoot,
            dataDir: stateDir,
            now: (() => {
                let index = 0;
                return () => `2026-07-29T00:00:${String(index++).padStart(2, '0')}.000Z`;
            })()
        }, configService, registry, git);
    }
});

class FakeGitService {
    readonly inspectCalls: string[] = [];
    readonly cloneCalls: string[] = [];
    readonly fastForwardCalls: string[] = [];
    readonly forceCalls: Array<{ sourceId: string; expectedRevision?: string; expectedRemoteRevision?: string }> = [];
    readonly inspections = new Map<string, WorkspaceGitInspection>();
    readonly fastForwardResults = new Map<string, WorkspaceGitMutationResult | Promise<WorkspaceGitMutationResult>>();
    cloneResult: WorkspaceGitMutationResult = {
        outcome: 'cloned',
        sourceId: 'missing',
        localPath: '',
        revision: 'c'.repeat(40)
    };
    forceResult: WorkspaceGitMutationResult = {
        outcome: 'force-updated',
        sourceId: 'missing',
        localPath: '',
        revision: 'd'.repeat(40)
    };

    setInspection(sourceId: string, value: WorkspaceGitInspection): void {
        this.inspections.set(sourceId, value);
    }

    async inspectConfiguredSource(target: WorkspaceGitSourceTarget): Promise<WorkspaceGitInspection> {
        this.inspectCalls.push(target.sourceId);
        return this.inspections.get(target.sourceId) ?? inspection(target.sourceId, target.localPath, 'clean', {
            currentRevision: '0'.repeat(40)
        });
    }

    async cloneMissingSource(target: WorkspaceGitSourceTarget): Promise<WorkspaceGitMutationResult> {
        this.cloneCalls.push(target.sourceId);
        return { ...this.cloneResult, sourceId: target.sourceId };
    }

    async fastForwardUpdate(target: WorkspaceGitSourceTarget): Promise<WorkspaceGitMutationResult> {
        this.fastForwardCalls.push(target.sourceId);
        const result = this.fastForwardResults.get(target.sourceId);
        if (result instanceof Promise) {
            return result;
        }
        return result ?? {
            outcome: 'updated',
            sourceId: target.sourceId,
            localPath: target.localPath,
            revision: 'e'.repeat(40)
        };
    }

    async reconcileExistingRemote(target: WorkspaceGitSourceTarget): Promise<WorkspaceGitMutationResult> {
        return {
            outcome: 'reconciled-remote',
            sourceId: target.sourceId,
            localPath: target.localPath,
            revision: 'f'.repeat(40)
        };
    }

    async forceUpdate(target: WorkspaceGitSourceTarget & {
        forceConfirmed: boolean;
        expectedRevision?: string;
        expectedRemoteRevision?: string;
    }): Promise<WorkspaceGitMutationResult> {
        this.forceCalls.push({
            sourceId: target.sourceId,
            expectedRevision: target.expectedRevision,
            expectedRemoteRevision: target.expectedRemoteRevision
        });
        return { ...this.forceResult, sourceId: target.sourceId };
    }
}

function createLoadResult(
    configPath: string,
    revision: string,
    sources: Record<string, { path?: string; url?: string; branch?: string }>
): WorkspaceConfigLoadResult {
    return {
        detection: 'canonical',
        state: 'valid',
        configPath,
        revision,
        rawToml: '[sources]\n',
        diagnostics: [],
        parsedData: {
            version: '1.0',
            sources
        }
    };
}

function inspection(
    sourceId: string,
    localPath: string,
    state: WorkspaceGitInspection['state'],
    overrides: Partial<WorkspaceGitInspection> = {}
): WorkspaceGitInspection {
    return {
        sourceId,
        state,
        localPath,
        aheadCount: 0,
        behindCount: 0,
        hasTrackedChanges: false,
        hasUntrackedChanges: false,
        ...overrides
    };
}

async function waitFor(predicate: () => boolean): Promise<void> {
    const start = Date.now();
    while (!predicate()) {
        if (Date.now() - start > 5000) {
            throw new Error('Timed out waiting for predicate');
        }
        await new Promise(resolve => setTimeout(resolve, 10));
    }
}
