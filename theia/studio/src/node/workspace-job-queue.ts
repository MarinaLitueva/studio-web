import { createHash, randomUUID } from 'crypto';
import type {
    WorkspaceJobKind,
    WorkspaceJobState,
    WorkspaceSyncError,
    WorkspaceSyncPhase,
    WorkspaceSyncProgress,
    WorkspaceSyncTrustPreview,
    WorkspaceSourceSyncPreview
} from '../common/workspace-protocol';
import {
    WorkspaceJobJournal,
    type WorkspaceJobBatchSnapshot,
    type WorkspaceJobCleanupMarker,
    type WorkspaceJobDeltaResponse,
    type WorkspaceJobJournalEvent,
    type WorkspaceJobRetryLineage,
    type WorkspaceJobScope,
    type WorkspaceJobSnapshot
} from './workspace-job-journal';

export interface EnqueueWorkspaceJobRequest {
    readonly kind: WorkspaceJobKind;
    readonly sourceId: string;
    readonly idempotencyKey: string;
    readonly batchId?: string;
    readonly sourceIds?: readonly string[];
}

export interface EnqueueWorkspaceJobResponse {
    readonly job: WorkspaceJobSnapshot;
    readonly reusedExisting: boolean;
}

export interface EnqueueWorkspaceBatchRequest {
    readonly kind: WorkspaceJobKind;
    readonly batchId?: string;
    readonly sourceIds: readonly string[];
    readonly idempotencyKey: string;
}

export interface EnqueueWorkspaceBatchResponse {
    readonly batch: WorkspaceJobBatchSnapshot;
    readonly jobs: readonly WorkspaceJobSnapshot[];
    readonly reusedExisting: boolean;
}

export interface WorkspaceJobRuntimeUpdate {
    readonly phase: WorkspaceSyncPhase;
    readonly progress?: WorkspaceSyncProgress;
    readonly cleanupSafe?: boolean;
    readonly cleanupRequired?: boolean;
    readonly cleanupReason?: string;
}

export interface WorkspaceJobExecutionContext {
    readonly signal: AbortSignal;
    readonly recoveryState: WorkspaceJobRetryLineage['recoveryState'];
    report(update: WorkspaceJobRuntimeUpdate): Promise<WorkspaceJobSnapshot>;
}

export type WorkspaceJobExecutionResult =
    | {
        readonly outcome: 'completed';
        readonly progress?: WorkspaceSyncProgress;
        readonly cleanupSafe?: boolean;
        readonly cleanupRequired?: boolean;
        readonly cleanupReason?: string;
    }
    | {
        readonly outcome: 'failed';
        readonly error: WorkspaceSyncError;
        readonly cleanupSafe?: boolean;
        readonly cleanupRequired?: boolean;
        readonly cleanupReason?: string;
    }
    | {
        readonly outcome: 'awaiting-confirmation';
        readonly error: WorkspaceSyncError;
        readonly preview?: WorkspaceSyncTrustPreview;
        readonly sourcePreviews?: readonly WorkspaceSourceSyncPreview[];
        readonly cleanupSafe?: boolean;
        readonly cleanupRequired?: boolean;
        readonly cleanupReason?: string;
    }
    | {
        readonly outcome: 'cancelled';
        readonly cleanupSafe?: boolean;
        readonly cleanupRequired?: boolean;
        readonly cleanupReason?: string;
    };

export interface WorkspaceJobExecutor {
    execute(job: WorkspaceJobSnapshot, context: WorkspaceJobExecutionContext): Promise<WorkspaceJobExecutionResult>;
}

type Subscriber = (event: WorkspaceJobJournalEvent) => void;

export class WorkspaceJobQueue {
    protected readonly pendingBySource = new Map<string, string[]>();
    protected readonly activeBySource = new Map<string, AbortController>();
    protected readonly subscribers = new Set<Subscriber>();
    protected idleResolvers: Array<() => void> = [];
    protected enqueueTail: Promise<void> = Promise.resolve();

    constructor(
        protected readonly journal: WorkspaceJobJournal,
        protected readonly executor: WorkspaceJobExecutor,
        protected readonly maxConcurrentSources = 3
    ) {}

    async initialize(): Promise<void> {
        await this.journal.initialize();
        await this.journal.markInterruptedOnRecovery();
        for (const job of this.journal.getCurrentJobs()) {
            if (job.state === 'queued') {
                this.queueJob(job);
            }
        }
        this.scheduleProcessing();
        await this.whenIdle();
    }

    subscribe(listener: Subscriber): () => void {
        this.subscribers.add(listener);
        return () => this.subscribers.delete(listener);
    }

    getEventsAfter(sequence: number): WorkspaceJobDeltaResponse {
        return this.journal.getDeltaAfter(sequence);
    }

    getJob(jobId: string): WorkspaceJobSnapshot | undefined {
        return this.journal.getJob(jobId);
    }

    getBatch(batchId: string): WorkspaceJobBatchSnapshot | undefined {
        return this.journal.getBatch(batchId);
    }

    async whenIdle(): Promise<void> {
        if (this.activeBySource.size === 0 && this.pendingBySource.size === 0) {
            return;
        }
        await new Promise<void>(resolve => this.idleResolvers.push(resolve));
    }

    async enqueue(request: EnqueueWorkspaceJobRequest): Promise<EnqueueWorkspaceJobResponse> {
        const batchId = request.batchId ?? request.idempotencyKey;
        const sourceIds = request.sourceIds ?? [request.sourceId];
        if (!sourceIds.includes(request.sourceId)) {
            throw new Error('Workspace job source scope must include the primary sourceId');
        }
        const scope: WorkspaceJobScope = {
            kind: request.kind,
            batchId,
            sourceId: request.sourceId,
            sourceIds: [...sourceIds],
            idempotencyKey: request.idempotencyKey
        };
        const previousEnqueue = this.enqueueTail;
        let releaseEnqueue: () => void = () => undefined;
        this.enqueueTail = new Promise<void>(resolve => {
            releaseEnqueue = resolve;
        });
        await previousEnqueue;
        try {
            const existing = this.journal.findExisting(scope);
            if (existing) {
                return { job: existing, reusedExisting: true };
            }
            const timestamp = new Date().toISOString();
            const snapshot = await this.persist({
                jobId: randomUUID(),
                kind: request.kind,
                batchId,
                sourceId: request.sourceId,
                sourceIds: [...sourceIds],
                idempotencyKey: request.idempotencyKey,
                state: 'queued',
                phase: 'queued',
                startedAt: timestamp,
                updatedAt: timestamp,
                progress: {
                    completedSources: 0,
                    totalSources: sourceIds.length,
                    activeSourceId: request.sourceId
                },
                retry: {
                    rootJobId: '',
                    attempt: 0,
                    recoveryState: 'none'
                }
            }, {
                rootJobIdFactory: jobId => jobId
            });
            this.queueJob(snapshot);
            this.scheduleProcessing();
            return { job: snapshot, reusedExisting: false };
        } finally {
            releaseEnqueue();
        }
    }

    async enqueueBatch(request: EnqueueWorkspaceBatchRequest): Promise<EnqueueWorkspaceBatchResponse> {
        const batchId = request.batchId ?? randomUUID();
        const jobs: WorkspaceJobSnapshot[] = [];
        let reusedExisting = true;
        for (const sourceId of request.sourceIds) {
            const response = await this.enqueue({
                kind: request.kind,
                sourceId,
                batchId,
                sourceIds: request.sourceIds,
                idempotencyKey: createHash('sha256')
                    .update(`${request.idempotencyKey}\0${sourceId}`)
                    .digest('hex')
            });
            jobs.push(response.job);
            reusedExisting = reusedExisting && response.reusedExisting;
        }
        const batch = this.requireBatch(batchId);
        return { batch, jobs, reusedExisting };
    }

    async cancel(jobId: string): Promise<WorkspaceJobSnapshot> {
        const job = this.requireJob(jobId);
        if (isTerminal(job.state)) {
            return job;
        }
        if (job.state === 'queued') {
            this.dropPending(job.sourceId, job.jobId);
            return this.persist({
                ...job,
                state: 'cancelled',
                phase: 'cancelled',
                updatedAt: new Date().toISOString(),
                cleanupMarker: {
                    required: false,
                    safe: true,
                    reason: 'queued-cancelled',
                    updatedAt: new Date().toISOString()
                }
            });
        }
        const controller = this.activeBySource.get(job.sourceId);
        controller?.abort();
        return this.requireJob(jobId);
    }

    async retry(jobId: string): Promise<WorkspaceJobSnapshot> {
        const job = this.requireJob(jobId);
        if (job.state !== 'failed' && job.state !== 'cancelled') {
            throw new Error(`Workspace job is not retryable from state: ${job.state}`);
        }
        if (job.lastError && (job.lastError.code === 'auth-required' || job.lastError.code === 'force-required' || job.lastError.code === 'confirmation-required')) {
            throw new Error(`Workspace job retry requires manual intervention: ${job.lastError.code}`);
        }
        if (job.lastError && !job.lastError.retryable) {
            throw new Error(`Workspace job is not retryable: ${job.lastError.code}`);
        }
        const timestamp = new Date().toISOString();
        const nextIdempotencyKey = createHash('sha256')
            .update(`${job.idempotencyKey}\0retry\0${randomUUID()}`)
            .digest('hex');
        const retried = await this.persist({
            jobId: randomUUID(),
            kind: job.kind,
            batchId: job.batchId,
            sourceId: job.sourceId,
            sourceIds: job.sourceIds,
            idempotencyKey: nextIdempotencyKey,
            state: 'queued',
            phase: 'queued',
            startedAt: timestamp,
            updatedAt: timestamp,
            progress: {
                completedSources: 0,
                totalSources: job.sourceIds.length,
                activeSourceId: job.sourceId
            },
            cleanupMarker: {
                required: job.cleanupMarker?.required ?? false,
                safe: false,
                reason: 'retry-pending-cleanup-review',
                updatedAt: timestamp
            },
            retry: {
                rootJobId: job.retry.rootJobId,
                retryOfJobId: job.jobId,
                attempt: job.retry.attempt + 1,
                recoveryState: job.retry.recoveryState === 'interrupted' ? 'recovered' : 'none'
            }
        });
        this.queueJob(retried);
        this.scheduleProcessing();
        return retried;
    }

    protected scheduleProcessing(): void {
        while (this.activeBySource.size < this.maxConcurrentSources) {
            const sourceId = [...this.pendingBySource.keys()].find(candidate => !this.activeBySource.has(candidate));
            if (!sourceId) {
                break;
            }
            const controller = new AbortController();
            this.activeBySource.set(sourceId, controller);
            void this.processSource(sourceId, controller);
        }
    }

    protected async processSource(sourceId: string, controller: AbortController): Promise<void> {
        try {
            const pending = this.pendingBySource.get(sourceId);
            while (pending && pending.length > 0) {
                const jobId = pending[0];
                await this.runJob(jobId, controller);
                pending.shift();
            }
        } finally {
            this.activeBySource.delete(sourceId);
            const pending = this.pendingBySource.get(sourceId);
            if (!pending || pending.length === 0) {
                this.pendingBySource.delete(sourceId);
            }
            this.scheduleProcessing();
            this.resolveIdleWaiters();
        }
    }

    protected async runJob(jobId: string, controller: AbortController): Promise<void> {
        const current = this.requireJob(jobId);
        if (current.state !== 'queued') {
            return;
        }
        await this.persist({
            ...current,
            state: 'running',
            phase: 'preflight',
            updatedAt: new Date().toISOString(),
            progress: {
                completedSources: 0,
                totalSources: current.sourceIds.length,
                activeSourceId: current.sourceId
            }
        });
        try {
            const result = await this.executor.execute(this.requireJob(jobId), {
                signal: controller.signal,
                recoveryState: this.requireJob(jobId).retry.recoveryState,
                report: update => this.reportRuntimeUpdate(jobId, update)
            });
            const latest = this.requireJob(jobId);
            if (latest.state === 'completed') {
                return;
            }
            if (result.outcome === 'completed') {
                await this.persist({
                    ...latest,
                    state: 'completed',
                    phase: 'completed',
                    updatedAt: new Date().toISOString(),
                    progress: result.progress ?? {
                        completedSources: latest.sourceIds.length,
                        totalSources: latest.sourceIds.length
                    },
                    cleanupMarker: toCleanupMarker(result, true)
                });
                return;
            }
            if (result.outcome === 'awaiting-confirmation') {
                await this.persist({
                    ...latest,
                    state: 'awaiting-confirmation',
                    phase: 'awaiting-confirmation',
                    updatedAt: new Date().toISOString(),
                    lastError: result.error,
                    ...(result.preview ? { preview: result.preview } : {}),
                    ...(result.sourcePreviews ? { sourcePreviews: result.sourcePreviews } : {}),
                    cleanupMarker: toCleanupMarker(result, false)
                });
                return;
            }
            if (result.outcome === 'cancelled') {
                const newest = this.requireJob(jobId);
                if (newest.state === 'completed') {
                    return;
                }
                await this.persist({
                    ...newest,
                    state: 'cancelled',
                    phase: 'cancelled',
                    updatedAt: new Date().toISOString(),
                    cleanupMarker: toCleanupMarker(result, false)
                });
                return;
            }
            await this.persist({
                ...latest,
                state: 'failed',
                phase: 'failed',
                updatedAt: new Date().toISOString(),
                lastError: result.error,
                cleanupMarker: toCleanupMarker(result, false)
            });
        } catch (error) {
            const latest = this.requireJob(jobId);
            if (controller.signal.aborted && latest.state !== 'completed') {
                await this.persist({
                    ...latest,
                    state: 'cancelled',
                    phase: 'cancelled',
                    updatedAt: new Date().toISOString(),
                    cleanupMarker: latest.cleanupMarker ?? {
                        required: true,
                        safe: false,
                        reason: 'abort-during-active-sync',
                        updatedAt: new Date().toISOString()
                    }
                });
                return;
            }
            await this.persist({
                ...latest,
                state: 'failed',
                phase: 'failed',
                updatedAt: new Date().toISOString(),
                lastError: {
                    code: 'execution-error',
                    message: errorMessage(error),
                    sourceId: latest.sourceId,
                    retryable: true
                },
                cleanupMarker: latest.cleanupMarker ?? {
                    required: true,
                    safe: false,
                    reason: 'execution-failed',
                    updatedAt: new Date().toISOString()
                }
            });
        }
    }

    protected async reportRuntimeUpdate(jobId: string, update: WorkspaceJobRuntimeUpdate): Promise<WorkspaceJobSnapshot> {
        const current = this.requireJob(jobId);
        if (isTerminal(current.state)) {
            return current;
        }
        return this.persist({
            ...current,
            state: 'running',
            phase: update.phase,
            updatedAt: new Date().toISOString(),
            ...(update.progress ? { progress: update.progress } : {}),
            cleanupMarker: {
                required: update.cleanupRequired ?? current.cleanupMarker?.required ?? false,
                safe: update.cleanupSafe ?? current.cleanupMarker?.safe ?? true,
                ...(update.cleanupReason || current.cleanupMarker?.reason
                    ? { reason: update.cleanupReason ?? current.cleanupMarker?.reason }
                    : {}),
                updatedAt: new Date().toISOString()
            }
        });
    }

    protected async persist(
        snapshot: Omit<WorkspaceJobSnapshot, 'schemaVersion' | 'createdAt' | 'createdSequence' | 'lastSequence'>,
        options?: {
            readonly rootJobIdFactory?: (jobId: string) => string;
        }
    ): Promise<WorkspaceJobSnapshot> {
        const preparedRetry: WorkspaceJobRetryLineage = snapshot.retry.rootJobId
            ? snapshot.retry
            : {
                ...snapshot.retry,
                rootJobId: options?.rootJobIdFactory?.(snapshot.jobId) ?? snapshot.jobId
            };
        const persisted = await this.journal.appendSnapshot({
            ...snapshot,
            retry: preparedRetry
        });
        const event = this.journal.getEventsAfter(persisted.lastSequence - 1)[0];
        for (const subscriber of this.subscribers) {
            try {
                subscriber(event);
            } catch {
                // Durable transitions are not rolled back by listeners.
            }
        }
        return persisted;
    }

    protected queueJob(job: WorkspaceJobSnapshot): void {
        const pending = this.pendingBySource.get(job.sourceId) ?? [];
        if (!pending.includes(job.jobId)) {
            pending.push(job.jobId);
            this.pendingBySource.set(job.sourceId, pending);
        }
    }

    protected dropPending(sourceId: string, jobId: string): void {
        const pending = this.pendingBySource.get(sourceId);
        if (!pending) {
            return;
        }
        const nextPending = pending.filter(candidate => candidate !== jobId);
        if (nextPending.length === 0) {
            this.pendingBySource.delete(sourceId);
            this.resolveIdleWaiters();
            return;
        }
        this.pendingBySource.set(sourceId, nextPending);
    }

    protected requireJob(jobId: string): WorkspaceJobSnapshot {
        const job = this.journal.getJob(jobId);
        if (!job) {
            throw new Error(`Workspace job not found: ${jobId}`);
        }
        return job;
    }

    protected requireBatch(batchId: string): WorkspaceJobBatchSnapshot {
        const batch = this.journal.getBatch(batchId);
        if (!batch) {
            throw new Error(`Workspace job batch not found: ${batchId}`);
        }
        return batch;
    }

    protected resolveIdleWaiters(): void {
        if (this.activeBySource.size !== 0 || this.pendingBySource.size !== 0) {
            return;
        }
        const waiters = this.idleResolvers;
        this.idleResolvers = [];
        waiters.forEach(resolve => resolve());
    }
}

function toCleanupMarker(
    result: {
        readonly cleanupRequired?: boolean;
        readonly cleanupSafe?: boolean;
        readonly cleanupReason?: string;
    },
    defaultSafe: boolean
): WorkspaceJobCleanupMarker {
    return {
        required: result.cleanupRequired ?? false,
        safe: result.cleanupSafe ?? defaultSafe,
        ...(result.cleanupReason ? { reason: result.cleanupReason } : {}),
        updatedAt: new Date().toISOString()
    };
}

function isTerminal(state: WorkspaceJobState): boolean {
    return state === 'completed' || state === 'cancelled' || state === 'failed';
}

function errorMessage(error: unknown): string {
    if (error instanceof Error) {
        return error.message;
    }
    return String(error);
}
