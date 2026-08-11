import * as path from 'path';
import * as fs from 'fs/promises';
import { createHash, randomUUID } from 'crypto';
import { pathToFileURL } from 'url';
import { Disposable, Emitter, Event } from '@theia/core/lib/common';
import type {
    CancelWorkspaceJobRequest,
    ConfirmWorkspaceSyncRequest,
    RetryWorkspaceJobRequest,
    StartWorkspaceSyncRequest,
    WorkspaceConfigIdentity,
    WorkspaceConfigMode,
    WorkspaceDiagnostic,
    WorkspaceJobActivity,
    WorkspaceMigrationState,
    WorkspaceObservedSourceState,
    WorkspaceSnapshot,
    WorkspaceSnapshotResponse,
    WorkspaceSourceSyncPreview,
    WorkspaceSyncError,
    WorkspaceSyncResponse,
    WorkspaceActivityEvent
} from '../common/workspace-protocol';
import {
    WORKSPACE_PROTOCOL_SCHEMA_VERSION
} from '../common/workspace-protocol';
import {
    CANONICAL_WORKSPACE_CONFIG_FILENAME,
    type WorkspaceConfigLoadResult,
    type WorkspaceConfigService
} from './workspace-config-service';
import {
    type WorkspaceConfigMutationResult
} from './workspace-config-mutation-service';
import { WorkspaceSourceRegistry, type WorkspaceSourceSnapshot } from './workspace-source-registry';
import {
    WorkspaceJobQueue,
    type EnqueueWorkspaceBatchResponse,
    type WorkspaceJobExecutionContext,
    type WorkspaceJobExecutionResult,
    type WorkspaceJobExecutor
} from './workspace-job-queue';
import {
    WorkspaceJobJournal,
    type WorkspaceJobJournalEvent,
    type WorkspaceJobSnapshot
} from './workspace-job-journal';
import {
    type WorkspaceGitConflictResult,
    type WorkspaceGitInspection,
    type WorkspaceGitMutationResult,
    type WorkspaceGitService,
    type WorkspaceGitSourceTarget
} from './workspace-git-service';

interface WorkspaceSyncOrchestratorOptions {
    readonly workspaceId: string;
    readonly workspaceRoot: string;
    readonly dataDir: string;
    readonly now?: () => string;
}

interface WorkspaceSyncJobGrant {
    readonly configRevision?: string;
    readonly trustConfirmed: boolean;
    readonly forceSourceIds: ReadonlySet<string>;
    readonly confirmedAt: string;
}

type JobMap = Map<string, WorkspaceJobSnapshot>;

interface WorkspaceResolveProjection {
    readonly workdir: string;
    readonly namespace: Readonly<Record<string, string>>;
    readonly rootUri: string;
    readonly canonicalRootUri?: string;
}

export class WorkspaceSyncOrchestrator implements Disposable, WorkspaceJobExecutor {
    protected readonly onDidChangeSnapshotEmitter = new Emitter<WorkspaceSnapshot>();
    protected readonly onDidChangeActivityEmitter = new Emitter<WorkspaceActivityEvent>();
    protected readonly workspaceRoot: string;
    protected readonly snapshotIdentity: WorkspaceConfigIdentity;
    protected readonly inspections = new Map<string, WorkspaceGitInspection>();
    protected readonly jobGrants = new Map<string, WorkspaceSyncJobGrant>();
    protected readonly batchGrants = new Map<string, WorkspaceSyncJobGrant>();
    protected readonly jobs: JobMap = new Map();
    protected sourceSnapshot: WorkspaceSourceSnapshot = Object.freeze({
        observedAt: new Date(0).toISOString(),
        configPath: '',
        configuredSources: [],
        observedSources: [],
        diagnostics: []
    });
    protected currentLoadResult: WorkspaceConfigLoadResult | undefined;
    protected resolveProjection: WorkspaceResolveProjection;
    protected snapshot: WorkspaceSnapshot;
    protected snapshotShapeKey = '';
    protected disposed = false;
    protected queueSubscription: (() => void) | undefined;
    protected sourceSubscription: Disposable | undefined;
    protected refreshTail: Promise<void> = Promise.resolve();
    protected readonly queue: WorkspaceJobQueue;
    protected initialized = false;

    readonly onDidChangeSnapshot: Event<WorkspaceSnapshot> = this.onDidChangeSnapshotEmitter.event;
    readonly onDidChangeActivity: Event<WorkspaceActivityEvent> = this.onDidChangeActivityEmitter.event;

    constructor(
        protected readonly options: WorkspaceSyncOrchestratorOptions,
        protected readonly configService: Pick<WorkspaceConfigService, 'load'>,
        protected readonly sourceRegistry: WorkspaceSourceRegistry,
        protected readonly gitService: Pick<WorkspaceGitService, 'inspectConfiguredSource' | 'cloneMissingSource' | 'fastForwardUpdate' | 'reconcileExistingRemote' | 'forceUpdate'>,
        queue?: WorkspaceJobQueue
    ) {
        this.workspaceRoot = path.resolve(options.workspaceRoot);
        const defaultResolveRoot = path.resolve(this.workspaceRoot, '.workspace-sources');
        this.resolveProjection = Object.freeze({
            workdir: '.workspace-sources',
            namespace: Object.freeze({}),
            rootUri: pathToFileURL(defaultResolveRoot).toString()
        });
        this.snapshotIdentity = Object.freeze({
            workspaceId: options.workspaceId,
            configPath: path.join(this.workspaceRoot, CANONICAL_WORKSPACE_CONFIG_FILENAME),
            configFileName: CANONICAL_WORKSPACE_CONFIG_FILENAME
        });
        this.queue = queue ?? new WorkspaceJobQueue(
            new WorkspaceJobJournal({
                dataDir: path.resolve(options.dataDir),
                sourceRoots: [this.workspaceRoot]
            }),
            this
        );
        this.snapshot = freezeSnapshot({
            schemaVersion: WORKSPACE_PROTOCOL_SCHEMA_VERSION,
            identity: this.snapshotIdentity,
            config: Object.freeze({
                revision: 'missing',
                schemaVersion: WORKSPACE_PROTOCOL_SCHEMA_VERSION,
                rawTomlAvailable: false,
                resolveWorkdir: this.resolveProjection.workdir,
                resolveNamespace: this.resolveProjection.namespace,
                resolveRootUri: this.resolveProjection.rootUri
            }),
            state: 'idle',
            configuredSources: [],
            observedSources: [],
            suggestions: [],
            jobs: [],
            migration: freezeMigrationState('single-folder', 'not-needed'),
            diagnostics: []
        });
        this.snapshotShapeKey = this.computeSnapshotShapeKey(this.snapshot);
    }

    get currentSnapshot(): WorkspaceSnapshot {
        return this.snapshot;
    }

    async initialize(): Promise<void> {
        if (this.initialized) {
            return;
        }
        await this.queue.initialize();
        this.hydrateJobs(this.queue.getEventsAfter(0).events);
        this.queueSubscription = this.queue.subscribe(event => {
            this.updateJobFromEvent(event);
            void this.enqueueRefresh(this.shouldRefreshInspection(event.job) ? [event.job.sourceId] : undefined);
        });
        this.sourceSubscription = this.sourceRegistry.onDidChangeSnapshot(() => {
            void this.publishSnapshot();
        });
        await this.refresh({ includeGitInspection: false });
        this.initialized = true;
    }

    dispose(): void {
        if (this.disposed) {
            return;
        }
        this.disposed = true;
        this.queueSubscription?.();
        this.sourceSubscription?.dispose();
        this.onDidChangeSnapshotEmitter.dispose();
        this.onDidChangeActivityEmitter.dispose();
    }

    async getSnapshotResponse(knownRevision?: string): Promise<WorkspaceSnapshotResponse> {
        const snapshot = await this.refresh({ includeGitInspection: false });
        const notModified = knownRevision !== undefined && snapshot.config.revision === knownRevision;
        return {
            schemaVersion: WORKSPACE_PROTOCOL_SCHEMA_VERSION,
            snapshot,
            notModified
        };
    }

    async refresh(options: {
        readonly includeGitInspection?: boolean;
        readonly sourceIds?: readonly string[];
    } = {}): Promise<WorkspaceSnapshot> {
        await this.enqueueRefresh(options.includeGitInspection ? options.sourceIds : undefined, options.includeGitInspection === true);
        return this.snapshot;
    }

    async startSync(request: StartWorkspaceSyncRequest): Promise<WorkspaceSyncResponse> {
        const loadResult = await this.loadValidConfig(request.expectedRevision);
        const sourceIds = this.resolveRequestedSourceIds(loadResult, request.sourceIds);
        const batch = await this.queueBatch(sourceIds, loadResult.revision!, request.expectedRevision, request.trustConfirmed === true, request.forceSourceIds);
        if (!request.trustConfirmed) {
            await this.queue.whenIdle();
            await this.refresh({ includeGitInspection: false, sourceIds });
        }
        return this.buildSyncResponse(batch.jobs[0]!.jobId);
    }

    async confirmSync(request: ConfirmWorkspaceSyncRequest): Promise<WorkspaceSyncResponse> {
        const existing = this.requireJob(request.jobId);
        const loadResult = await this.loadValidConfig(request.expectedRevision);
        if (existing.state !== 'awaiting-confirmation' && existing.state !== 'failed') {
            throw new Error(`Workspace job cannot be confirmed from state: ${existing.state}`);
        }
        const batch = await this.queueBatch([existing.sourceId], loadResult.revision!, request.expectedRevision, request.trustConfirmed, request.forceSourceIds, existing.batchId);
        return this.buildSyncResponse(batch.jobs[0]!.jobId);
    }

    async cancelJob(request: CancelWorkspaceJobRequest): Promise<WorkspaceSyncResponse> {
        const job = await this.queue.cancel(request.jobId);
        this.jobGrants.delete(job.jobId);
        await this.refresh({ includeGitInspection: false, sourceIds: [job.sourceId] });
        return this.buildSyncResponse(job.jobId);
    }

    async retryJob(request: RetryWorkspaceJobRequest): Promise<WorkspaceSyncResponse> {
        const existing = this.requireJob(request.jobId);
        const requiresFreshConfirmation = existing.lastError?.code === 'auth-required'
            || existing.lastError?.code === 'confirmation-required'
            || existing.lastError?.code === 'force-required';
        if (requiresFreshConfirmation) {
            if (request.trustConfirmed !== true) {
                throw new Error(`Workspace job retry requires fresh explicit confirmation: ${existing.lastError?.code}`);
            }
            const loadResult = await this.loadValidConfig(request.expectedRevision);
            const batch = await this.queueBatch([existing.sourceId], loadResult.revision!, request.expectedRevision, true, request.forceSourceIds, existing.batchId);
            return this.buildSyncResponse(batch.jobs[0]!.jobId);
        }
        const retried = await this.queue.retry(request.jobId);
        return this.buildSyncResponse(retried.jobId);
    }

    async startSyncAfterMutation(
        mutationResult: WorkspaceConfigMutationResult,
        request: Omit<StartWorkspaceSyncRequest, 'expectedRevision'>
    ): Promise<WorkspaceSyncResponse | undefined> {
        if (mutationResult.status !== 'applied') {
            return undefined;
        }
        return this.startSync({
            ...request,
            expectedRevision: mutationResult.revision
        });
    }

    async execute(job: WorkspaceJobSnapshot, context: WorkspaceJobExecutionContext): Promise<WorkspaceJobExecutionResult> {
        const grant = this.jobGrants.get(job.jobId) ?? this.batchGrants.get(job.batchId);
        const loadResult = await this.loadValidConfig(grant?.configRevision);
        const source = this.requireConfiguredSource(loadResult, job.sourceId);
        const inspection = await this.gitService.inspectConfiguredSource(this.toGitTarget(source, loadResult));
        this.inspections.set(source.sourceId, inspection);
        return this.executePlannedAction(job, context, loadResult, source, inspection, grant);
    }

    protected async executePlannedAction(
        job: WorkspaceJobSnapshot,
        context: WorkspaceJobExecutionContext,
        loadResult: WorkspaceConfigLoadResult,
        source: WorkspaceSourceSnapshot['configuredSources'][number],
        inspection: WorkspaceGitInspection,
        grant: WorkspaceSyncJobGrant | undefined
    ): Promise<WorkspaceJobExecutionResult> {
        const preview = this.buildSourcePreview(source, inspection);
        if (preview.eligibility === 'blocked') {
            return {
                outcome: 'failed',
                error: failureForPreview(source.sourceId, preview, false)
            };
        }
        if (!grant?.trustConfirmed || (preview.forceRequired && !grant.forceSourceIds.has(source.sourceId))) {
            return {
                outcome: 'awaiting-confirmation',
                error: failureForPreview(source.sourceId, preview, false),
                preview: {
                    jobId: job.jobId,
                    requiresConfirmation: true,
                    saveConfig: job.kind === 'save-sync',
                    impactedSourceIds: [source.sourceId],
                    reasons: [preview.confirmationMessage ?? preview.blockedReason ?? 'Workspace sync requires confirmation.']
                },
                sourcePreviews: [preview]
            };
        }

        await context.report({
            phase: 'syncing-sources',
            progress: {
                completedSources: 0,
                totalSources: job.sourceIds.length,
                activeSourceId: source.sourceId
            }
        });

        const target = this.toGitTarget(source, loadResult);
        let result: WorkspaceGitMutationResult;
        if (inspection.state === 'missing') {
            result = await this.gitService.cloneMissingSource(target, context.signal);
        } else if (inspection.state === 'wrong-remote') {
            result = await this.gitService.reconcileExistingRemote(target);
            if (result.outcome === 'reconciled-remote') {
                result = await this.gitService.fastForwardUpdate(target, context.signal);
            }
        } else if (inspection.state === 'ahead' || inspection.state === 'diverged') {
            result = await this.gitService.forceUpdate({
                ...target,
                forceConfirmed: true,
                expectedRevision: preview.expectedRevision,
                expectedRemoteRevision: preview.expectedRemoteRevision
            }, context.signal);
        } else if (!source.remoteUrl) {
            result = {
                outcome: 'up-to-date',
                sourceId: source.sourceId,
                localPath: source.localPath,
                revision: inspection.currentRevision
            };
        } else {
            result = await this.gitService.fastForwardUpdate(target, context.signal);
        }

        this.jobGrants.delete(job.jobId);
        return this.toExecutionResult(source.sourceId, result, job.sourceIds.length);
    }

    protected toExecutionResult(sourceId: string, result: WorkspaceGitMutationResult, totalSources: number): WorkspaceJobExecutionResult {
        if (result.outcome === 'cancelled' || result.outcome === 'completed-needs-inspection') {
            return {
                outcome: 'cancelled',
                cleanupRequired: result.outcome === 'completed-needs-inspection',
                cleanupSafe: result.outcome !== 'completed-needs-inspection',
                cleanupReason: result.outcome === 'completed-needs-inspection' ? 'post-activation-inspection-required' : 'cancelled'
            };
        }
        if (result.outcome === 'auth-required') {
            return {
                outcome: 'failed',
                error: {
                    code: 'auth-required',
                    message: result.message,
                    sourceId,
                    retryable: false
                }
            };
        }
        if (result.outcome === 'conflict') {
            const preview = this.buildSourcePreviewFromConflict(result);
            if (result.code === 'confirmation-required') {
                return {
                    outcome: 'awaiting-confirmation',
                    error: failureForPreview(sourceId, preview, false),
                    preview: {
                        jobId: '',
                        requiresConfirmation: true,
                        saveConfig: false,
                        impactedSourceIds: [sourceId],
                        reasons: [preview.confirmationMessage ?? result.message]
                    },
                    sourcePreviews: [preview]
                };
            }
            return {
                outcome: 'failed',
                error: {
                    code: result.code === 'source-conflict' && preview.forceRequired ? 'force-required' : result.code,
                    message: result.message,
                    sourceId,
                    retryable: false
                }
            };
        }
        return {
            outcome: 'completed',
            progress: {
                completedSources: totalSources,
                totalSources
            }
        };
    }

    protected buildSourcePreviewFromConflict(result: WorkspaceGitConflictResult): WorkspaceSourceSyncPreview {
        const inspection = result.inspection;
        if (!inspection) {
            return Object.freeze({
                sourceId: result.sourceId,
                status: 'blocked',
                eligibility: result.code === 'confirmation-required' ? 'requires-force' : 'blocked',
                forceRequired: result.code === 'confirmation-required',
                blockedReason: result.message,
                confirmationMessage: result.message
            });
        }
        return this.buildSourcePreview({
            sourceId: result.sourceId,
            label: result.sourceId,
            localPath: inspection.localPath,
            configured: true,
            authoritative: true,
            include: 'member',
            ...(inspection.expectedRemoteUrl ? { remoteUrl: inspection.expectedRemoteUrl } : {}),
            ...(inspection.currentBranch ? { ref: inspection.currentBranch, defaultBranch: inspection.currentBranch } : {})
        }, inspection);
    }

    protected buildSourcePreview(
        source: WorkspaceSourceSnapshot['configuredSources'][number],
        inspection: WorkspaceGitInspection
    ): WorkspaceSourceSyncPreview {
        if (!source.remoteUrl && inspection.state === 'missing') {
            return Object.freeze({
                sourceId: source.sourceId,
                status: 'blocked',
                eligibility: 'blocked',
                forceRequired: false,
                blockedReason: 'Configured source is missing and does not declare a remote URL.',
                confirmationMessage: 'Configured source is missing and cannot be cloned without a remote URL.'
            });
        }
        if (inspection.state === 'missing') {
            return Object.freeze({
                sourceId: source.sourceId,
                status: 'missing',
                eligibility: 'requires-trust',
                forceRequired: false,
                confirmationMessage: 'Clone the missing configured source from its remote URL.'
            });
        }
        if (inspection.state === 'wrong-remote') {
            return Object.freeze({
                sourceId: source.sourceId,
                status: 'blocked',
                eligibility: source.remoteUrl ? 'requires-trust' : 'blocked',
                forceRequired: false,
                expectedRevision: inspection.currentRevision,
                blockedReason: inspection.message,
                confirmationMessage: source.remoteUrl ? 'Reconcile the configured remote URL before syncing.' : inspection.message
            });
        }
        if (inspection.state === 'dirty') {
            return Object.freeze({
                sourceId: source.sourceId,
                status: 'dirty',
                eligibility: 'blocked',
                forceRequired: false,
                expectedRevision: inspection.currentRevision,
                blockedReason: inspection.message
            });
        }
        if (inspection.state === 'diverged') {
            return Object.freeze({
                sourceId: source.sourceId,
                status: 'diverged',
                eligibility: 'requires-force',
                forceRequired: true,
                expectedRevision: inspection.currentRevision,
                expectedRemoteRevision: inspection.remoteRevision,
                aheadCount: inspection.aheadCount,
                behindCount: inspection.behindCount,
                blockedReason: inspection.message,
                confirmationMessage: 'Force update will replace the local branch with the remote tracking ref.'
            });
        }
        if (inspection.state === 'ahead') {
            return Object.freeze({
                sourceId: source.sourceId,
                status: 'ahead',
                eligibility: 'requires-force',
                forceRequired: true,
                expectedRevision: inspection.currentRevision,
                expectedRemoteRevision: inspection.remoteRevision,
                aheadCount: inspection.aheadCount,
                behindCount: inspection.behindCount,
                blockedReason: inspection.message,
                confirmationMessage: 'Force update will discard local commits that are ahead of the remote.'
            });
        }
        if (inspection.state === 'detached' || inspection.state === 'no-repo') {
            return Object.freeze({
                sourceId: source.sourceId,
                status: 'blocked',
                eligibility: 'blocked',
                forceRequired: false,
                expectedRevision: inspection.currentRevision,
                blockedReason: inspection.message
            });
        }
        if (!source.remoteUrl) {
            return Object.freeze({
                sourceId: source.sourceId,
                status: 'present',
                eligibility: 'not-configured',
                forceRequired: false,
                expectedRevision: inspection.currentRevision
            });
        }
        if (inspection.state === 'behind') {
            return Object.freeze({
                sourceId: source.sourceId,
                status: 'behind',
                eligibility: 'requires-trust',
                forceRequired: false,
                expectedRevision: inspection.currentRevision,
                aheadCount: inspection.aheadCount,
                behindCount: inspection.behindCount,
                confirmationMessage: 'Fetch and fast-forward the configured source from its remote.'
            });
        }
        return Object.freeze({
            sourceId: source.sourceId,
            status: 'present',
            eligibility: source.remoteUrl ? 'requires-trust' : 'not-configured',
            forceRequired: false,
            expectedRevision: inspection.currentRevision,
            confirmationMessage: source.remoteUrl ? 'Fetch and verify the configured remote before syncing.' : undefined
        });
    }

    protected async queueBatch(
        sourceIds: readonly string[],
        configRevision: string,
        expectedRevision: string | undefined,
        trustConfirmed: boolean,
        forceSourceIds: readonly string[] | undefined,
        batchId?: string
    ): Promise<EnqueueWorkspaceBatchResponse> {
        const resolvedBatchId = batchId ?? randomUUID();
        let grant: WorkspaceSyncJobGrant | undefined;
        if (trustConfirmed) {
            grant = Object.freeze({
                configRevision,
                trustConfirmed: true,
                forceSourceIds: new Set(forceSourceIds ?? []),
                confirmedAt: this.now()
            });
            this.batchGrants.set(resolvedBatchId, grant);
        }
        const idempotencyKey = createHash('sha256')
            .update(`${configRevision}\0${sourceIds.join(',')}\0${expectedRevision ?? ''}\0${trustConfirmed ? 'confirmed' : 'preview'}\0${[...(forceSourceIds ?? [])].sort().join(',')}\0${randomUUID()}`)
            .digest('hex');
        let response: EnqueueWorkspaceBatchResponse;
        try {
            response = await this.queue.enqueueBatch({
                kind: 'source-sync',
                sourceIds,
                batchId: resolvedBatchId,
                idempotencyKey
            });
        } catch (error) {
            if (grant) {
                this.batchGrants.delete(resolvedBatchId);
            }
            throw error;
        }
        if (grant) {
            for (const job of response.jobs) {
                this.jobGrants.set(job.jobId, grant);
            }
        }
        return response;
    }

    protected requireJob(jobId: string): WorkspaceJobSnapshot {
        const job = this.jobs.get(jobId) ?? this.queue.getJob(jobId);
        if (!job) {
            throw new Error(`Workspace job not found: ${jobId}`);
        }
        return job;
    }

    protected requireConfiguredSource(loadResult: WorkspaceConfigLoadResult, sourceId: string): WorkspaceSourceSnapshot['configuredSources'][number] {
        const source = this.sourceSnapshot.configuredSources.find(candidate => candidate.sourceId === sourceId);
        if (!source) {
            throw new Error(`Configured source not found: ${sourceId}`);
        }
        return source;
    }

    protected async loadValidConfig(expectedRevision?: string): Promise<WorkspaceConfigLoadResult> {
        const loadResult = await this.configService.load(this.workspaceRoot);
        if (loadResult.state !== 'valid' || !loadResult.parsedData || !loadResult.revision) {
            throw new Error('A valid canonical workspace config is required before syncing.');
        }
        if (expectedRevision !== undefined && loadResult.revision !== expectedRevision) {
            throw new Error(`Workspace config revision changed before sync: expected ${expectedRevision}, got ${loadResult.revision}`);
        }
        await this.reconcileSources(loadResult);
        return loadResult;
    }

    protected resolveRequestedSourceIds(loadResult: WorkspaceConfigLoadResult, requested: readonly string[] | undefined): readonly string[] {
        const configuredSourceIds = Object.keys(loadResult.parsedData!.sources).sort();
        if (!requested || requested.length === 0) {
            return configuredSourceIds;
        }
        const configured = new Set(configuredSourceIds);
        for (const sourceId of requested) {
            if (!configured.has(sourceId)) {
                throw new Error(`Requested source is not configured: ${sourceId}`);
            }
        }
        return [...requested];
    }

    protected toGitTarget(
        source: WorkspaceSourceSnapshot['configuredSources'][number],
        loadResult: WorkspaceConfigLoadResult
    ): WorkspaceGitSourceTarget {
        const resolveRoot = loadResult.parsedData?.resolve?.workdir
            ? path.resolve(this.workspaceRoot, loadResult.parsedData.resolve.workdir)
            : path.resolve(this.workspaceRoot, '.workspace-sources');
        return {
            sourceId: source.sourceId,
            localPath: source.localPath,
            remoteUrl: source.remoteUrl,
            ref: source.defaultBranch ?? source.ref,
            resolveRoot
        };
    }

    protected hydrateJobs(events: readonly WorkspaceJobJournalEvent[]): void {
        for (const event of events) {
            this.jobs.set(event.job.jobId, event.job);
        }
    }

    protected updateJobFromEvent(event: WorkspaceJobJournalEvent): void {
        this.jobs.set(event.job.jobId, event.job);
        if (isTerminal(event.job.state)) {
            this.jobGrants.delete(event.job.jobId);
            this.maybeDeleteBatchGrant(event.job.batchId);
        }
        this.onDidChangeActivityEmitter.fire({
            schemaVersion: WORKSPACE_PROTOCOL_SCHEMA_VERSION,
            eventId: event.eventId,
            job: toJobActivity(event.job),
            snapshotRevision: this.snapshot.config.revision
        });
    }

    protected shouldRefreshInspection(job: WorkspaceJobSnapshot): boolean {
        return job.state === 'completed' || job.state === 'failed' || job.state === 'cancelled';
    }

    protected async enqueueRefresh(sourceIds?: readonly string[], includeGitInspection = false): Promise<void> {
        const previous = this.refreshTail;
        let release: () => void = () => undefined;
        this.refreshTail = new Promise<void>(resolve => {
            release = resolve;
        });
        await previous;
        try {
            const loadResult = await this.configService.load(this.workspaceRoot);
            this.currentLoadResult = loadResult;
            if (loadResult.state === 'valid' && loadResult.parsedData) {
                await this.updateResolveProjection(loadResult);
                await this.reconcileSources(loadResult);
                if (includeGitInspection) {
                    await this.inspectSources(sourceIds);
                }
            } else {
                this.sourceSnapshot = Object.freeze({
                    observedAt: this.now(),
                    configPath: loadResult.configPath,
                    revision: loadResult.revision,
                    configuredSources: [],
                    observedSources: [],
                    diagnostics: []
                });
                this.inspections.clear();
            }
            await this.publishSnapshot();
        } finally {
            release();
        }
    }

    protected async reconcileSources(loadResult: WorkspaceConfigLoadResult): Promise<void> {
        this.sourceSnapshot = await this.sourceRegistry.reconcile(loadResult, this.now());
    }

    protected async updateResolveProjection(loadResult: WorkspaceConfigLoadResult): Promise<void> {
        const workdir = loadResult.parsedData?.resolve?.workdir?.trim() || '.workspace-sources';
        const resolveRoot = path.resolve(this.workspaceRoot, workdir);
        let canonicalRootUri: string | undefined;
        try {
            canonicalRootUri = pathToFileURL(await fs.realpath(resolveRoot)).toString();
        } catch (error) {
            if (!isMissingFileSystemEntry(error)) {
                throw error;
            }
        }
        this.resolveProjection = Object.freeze({
            workdir,
            namespace: Object.freeze({ ...(loadResult.parsedData?.resolve?.namespace ?? {}) }),
            rootUri: pathToFileURL(resolveRoot).toString(),
            ...(canonicalRootUri ? { canonicalRootUri } : {})
        });
    }

    protected async inspectSources(sourceIds?: readonly string[]): Promise<void> {
        if (!this.currentLoadResult || this.currentLoadResult.state !== 'valid') {
            return;
        }
        const allowed = sourceIds ? new Set(sourceIds) : undefined;
        const inspections = await Promise.all(this.sourceSnapshot.configuredSources
            .filter(source => !allowed || allowed.has(source.sourceId))
            .map(async source => [source.sourceId, await this.gitService.inspectConfiguredSource(this.toGitTarget(source, this.currentLoadResult!))] as const));
        for (const [sourceId, inspection] of inspections) {
            this.inspections.set(sourceId, inspection);
        }
    }

    protected async publishSnapshot(): Promise<void> {
        const nextSnapshot = this.buildSnapshot();
        const nextKey = this.computeSnapshotShapeKey(nextSnapshot);
        this.snapshot = nextSnapshot;
        if (nextKey !== this.snapshotShapeKey) {
            this.snapshotShapeKey = nextKey;
            this.onDidChangeSnapshotEmitter.fire(nextSnapshot);
        }
    }

    protected buildSnapshot(): WorkspaceSnapshot {
        const loadResult = this.currentLoadResult;
        const jobs = [...this.jobs.values()]
            .sort((left, right) => left.createdSequence - right.createdSequence)
            .map(toJobActivity);
        const diagnostics = freezeDiagnostics([
            ...(loadResult?.diagnostics ?? []),
            ...this.sourceSnapshot.diagnostics
        ]);
        const latestJobBySource = new Map<string, WorkspaceJobActivity>();
        for (const job of jobs) {
            const previous = latestJobBySource.get(job.jobId);
            if (!previous || previous.updatedAt <= job.updatedAt) {
                latestJobBySource.set(job.jobId, job);
            }
        }
        const observedSources = freezeObservedSources(this.sourceSnapshot.observedSources.map(source => {
            const { observedAt: _observedAt, ...baseSource } = source;
            const inspection = this.inspections.get(source.sourceId);
            const latestSourceJob = [...jobs]
                .filter(job => this.requireJob(job.jobId).sourceId === source.sourceId)
                .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt))
                .slice(-1)[0];
            return mergeObservedSource(baseSource, inspection, latestSourceJob);
        }));
        const state = computeOperationalState(loadResult, jobs);
        return freezeSnapshot({
            schemaVersion: WORKSPACE_PROTOCOL_SCHEMA_VERSION,
            identity: this.snapshotIdentity,
            config: Object.freeze({
                revision: loadResult?.revision ?? 'missing',
                schemaVersion: WORKSPACE_PROTOCOL_SCHEMA_VERSION,
                rawTomlAvailable: loadResult?.rawToml !== undefined,
                resolveWorkdir: this.resolveProjection.workdir,
                resolveNamespace: this.resolveProjection.namespace,
                resolveRootUri: this.resolveProjection.rootUri,
                ...(this.resolveProjection.canonicalRootUri
                    ? { canonicalResolveRootUri: this.resolveProjection.canonicalRootUri }
                    : {}),
                ...(loadResult ? { lastLoadedAt: this.sourceSnapshot.observedAt } : {})
            }),
            state,
            configuredSources: this.sourceSnapshot.configuredSources,
            observedSources,
            suggestions: [],
            jobs,
            migration: freezeMigrationState(toConfigMode(loadResult), 'not-needed'),
            diagnostics
        });
    }

    protected buildSyncResponse(jobId: string): WorkspaceSyncResponse {
        const job = this.requireJob(jobId);
        return {
            schemaVersion: WORKSPACE_PROTOCOL_SCHEMA_VERSION,
            job: toJobActivity(job),
            snapshot: this.snapshot
        };
    }

    protected computeSnapshotShapeKey(snapshot: WorkspaceSnapshot): string {
        return JSON.stringify({
            schemaVersion: snapshot.schemaVersion,
            identity: snapshot.identity,
            config: {
                revision: snapshot.config.revision,
                rawTomlAvailable: snapshot.config.rawTomlAvailable,
                resolveWorkdir: snapshot.config.resolveWorkdir,
                resolveNamespace: snapshot.config.resolveNamespace,
                resolveRootUri: snapshot.config.resolveRootUri,
                canonicalResolveRootUri: snapshot.config.canonicalResolveRootUri
            },
            state: snapshot.state,
            configuredSources: snapshot.configuredSources,
            observedSources: snapshot.observedSources,
            jobs: snapshot.jobs,
            diagnostics: snapshot.diagnostics,
            migration: snapshot.migration
        });
    }

    protected maybeDeleteBatchGrant(batchId: string): void {
        const batch = this.queue.getBatch(batchId);
        if (!batch) {
            this.batchGrants.delete(batchId);
            return;
        }
        const allTerminal = batch.jobs.every(job => isTerminal(job.state));
        if (allTerminal) {
            this.batchGrants.delete(batchId);
        }
    }

    protected now(): string {
        return this.options.now?.() ?? new Date().toISOString();
    }
}

function isMissingFileSystemEntry(error: unknown): error is NodeJS.ErrnoException {
    return typeof error === 'object'
        && error !== null
        && 'code' in error
        && ['ENOENT', 'ENOTDIR'].includes(String((error as NodeJS.ErrnoException).code));
}

function mergeObservedSource(
    source: WorkspaceObservedSourceState,
    inspection: WorkspaceGitInspection | undefined,
    job: WorkspaceJobActivity | undefined
): WorkspaceObservedSourceState {
    const preview = job?.sourcePreviews?.find(candidate => candidate.sourceId === source.sourceId);
    if (preview) {
        return freezeObservedSource({
            ...source,
            status: preview.status,
            syncEligibility: preview.eligibility,
            currentRevision: preview.expectedRevision ?? source.currentRevision,
            aheadCount: preview.aheadCount ?? inspection?.aheadCount ?? source.aheadCount,
            behindCount: preview.behindCount ?? inspection?.behindCount ?? source.behindCount,
            hasBlockingIssue: preview.eligibility === 'blocked' || preview.eligibility === 'requires-force' || preview.eligibility === 'requires-trust',
            blockedReason: preview.blockedReason ?? preview.confirmationMessage ?? source.blockedReason,
            isDirty: preview.status === 'dirty',
            isDiverged: preview.status === 'diverged',
            isPresent: preview.status !== 'missing',
            isNested: source.isNested
        });
    }
    if (job?.lastError?.code === 'auth-required') {
        return freezeObservedSource({
            ...source,
            status: 'auth-required',
            syncEligibility: 'blocked',
            hasBlockingIssue: true,
            blockedReason: job.lastError.message
        });
    }
    if (!inspection) {
        return freezeObservedSource(source);
    }
    const mapped = mapInspection(inspection, source);
    return freezeObservedSource({
        ...source,
        ...mapped
    });
}

function mapInspection(
    inspection: WorkspaceGitInspection,
    source: WorkspaceObservedSourceState
): Pick<WorkspaceObservedSourceState, 'status' | 'syncEligibility' | 'isPresent' | 'isDirty' | 'isDiverged' | 'hasBlockingIssue' | 'blockedReason' | 'currentRevision' | 'aheadCount' | 'behindCount'> {
    switch (inspection.state) {
        case 'missing':
            return {
                status: 'missing',
                syncEligibility: source.syncEligibility,
                isPresent: false,
                isDirty: false,
                isDiverged: false,
                hasBlockingIssue: false,
                blockedReason: inspection.message,
                currentRevision: undefined,
                aheadCount: 0,
                behindCount: 0
            };
        case 'dirty':
            return {
                status: 'dirty',
                syncEligibility: 'blocked',
                isPresent: true,
                isDirty: true,
                isDiverged: false,
                hasBlockingIssue: true,
                blockedReason: inspection.message,
                currentRevision: inspection.currentRevision,
                aheadCount: inspection.aheadCount,
                behindCount: inspection.behindCount
            };
        case 'diverged':
            return {
                status: 'diverged',
                syncEligibility: 'requires-force',
                isPresent: true,
                isDirty: false,
                isDiverged: true,
                hasBlockingIssue: true,
                blockedReason: inspection.message,
                currentRevision: inspection.currentRevision,
                aheadCount: inspection.aheadCount,
                behindCount: inspection.behindCount
            };
        case 'ahead':
            return {
                status: 'ahead',
                syncEligibility: 'requires-force',
                isPresent: true,
                isDirty: false,
                isDiverged: false,
                hasBlockingIssue: true,
                blockedReason: inspection.message,
                currentRevision: inspection.currentRevision,
                aheadCount: inspection.aheadCount,
                behindCount: inspection.behindCount
            };
        case 'behind':
            return {
                status: 'behind',
                syncEligibility: 'safe',
                isPresent: true,
                isDirty: false,
                isDiverged: false,
                hasBlockingIssue: false,
                blockedReason: undefined,
                currentRevision: inspection.currentRevision,
                aheadCount: inspection.aheadCount,
                behindCount: inspection.behindCount
            };
        case 'clean':
            return {
                status: 'present',
                syncEligibility: source.syncEligibility === 'not-configured' ? 'not-configured' : 'safe',
                isPresent: true,
                isDirty: false,
                isDiverged: false,
                hasBlockingIssue: false,
                blockedReason: undefined,
                currentRevision: inspection.currentRevision,
                aheadCount: inspection.aheadCount,
                behindCount: inspection.behindCount
            };
        default:
            return {
                status: 'blocked',
                syncEligibility: 'blocked',
                isPresent: inspection.state !== 'no-repo',
                isDirty: false,
                isDiverged: false,
                hasBlockingIssue: true,
                blockedReason: inspection.message,
                currentRevision: inspection.currentRevision,
                aheadCount: inspection.aheadCount,
                behindCount: inspection.behindCount
            };
    }
}

function computeOperationalState(loadResult: WorkspaceConfigLoadResult | undefined, jobs: readonly WorkspaceJobActivity[]): WorkspaceSnapshot['state'] {
    if (jobs.some(job => job.state === 'running' || job.state === 'queued' || job.state === 'awaiting-confirmation')) {
        return 'syncing';
    }
    if (!loadResult || loadResult.state === 'missing') {
        return 'idle';
    }
    if (loadResult.state === 'valid') {
        return 'ready';
    }
    return 'conflicted';
}

function freezeSnapshot(snapshot: WorkspaceSnapshot): WorkspaceSnapshot {
    return Object.freeze({
        ...snapshot,
        configuredSources: Object.freeze([...snapshot.configuredSources]),
        observedSources: Object.freeze([...snapshot.observedSources]),
        suggestions: Object.freeze([...snapshot.suggestions]),
        jobs: Object.freeze([...snapshot.jobs]),
        diagnostics: Object.freeze([...snapshot.diagnostics]),
        migration: Object.freeze(snapshot.migration)
    });
}

function freezeObservedSources(observedSources: readonly WorkspaceObservedSourceState[]): readonly WorkspaceObservedSourceState[] {
    return Object.freeze(observedSources.map(freezeObservedSource));
}

function freezeObservedSource(observedSource: WorkspaceObservedSourceState): WorkspaceObservedSourceState {
    return Object.freeze({ ...observedSource });
}

function freezeDiagnostics(diagnostics: readonly WorkspaceDiagnostic[]): readonly WorkspaceDiagnostic[] {
    return Object.freeze(diagnostics.map(diagnostic => Object.freeze({ ...diagnostic })));
}

function freezeMigrationState(mode: WorkspaceConfigMode, status: WorkspaceMigrationState['status']): WorkspaceMigrationState {
    return Object.freeze({
        mode,
        status,
        recoveryState: 'none',
        rollbackAvailable: false
    });
}

function toConfigMode(loadResult: WorkspaceConfigLoadResult | undefined): WorkspaceConfigMode {
    if (!loadResult) {
        return 'single-folder';
    }
    if (loadResult.detection === 'legacy') {
        return 'legacy';
    }
    if (loadResult.state === 'valid') {
        return 'canonical-active';
    }
    if (loadResult.detection === 'canonical') {
        return 'canonical-shadow';
    }
    return 'single-folder';
}

function toJobActivity(job: WorkspaceJobSnapshot): WorkspaceJobActivity {
    return Object.freeze({
        jobId: job.jobId,
        kind: job.kind,
        state: job.state,
        phase: job.phase,
        startedAt: job.startedAt,
        updatedAt: job.updatedAt,
        ...(job.progress ? { progress: Object.freeze({ ...job.progress }) } : {}),
        ...(job.preview ? { preview: Object.freeze({ ...job.preview, impactedSourceIds: Object.freeze([...job.preview.impactedSourceIds]), reasons: Object.freeze([...job.preview.reasons]) }) } : {}),
        ...(job.sourcePreviews ? { sourcePreviews: Object.freeze(job.sourcePreviews.map(preview => Object.freeze({ ...preview }))) } : {}),
        ...(job.lastError ? { lastError: Object.freeze({ ...job.lastError }) } : {})
    });
}

function failureForPreview(sourceId: string, preview: WorkspaceSourceSyncPreview, retryable: boolean): WorkspaceSyncError {
    return {
        code: preview.forceRequired ? 'force-required' : preview.eligibility === 'requires-trust' ? 'confirmation-required' : 'source-conflict',
        message: preview.blockedReason ?? preview.confirmationMessage ?? 'Workspace sync requires confirmation.',
        sourceId,
        retryable
    };
}

function isTerminal(state: WorkspaceJobSnapshot['state']): boolean {
    return state === 'completed' || state === 'failed' || state === 'cancelled';
}
