import { randomUUID } from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import type {
    WorkspaceJobKind,
    WorkspaceJobState,
    WorkspaceSyncError,
    WorkspaceSyncPhase,
    WorkspaceSyncProgress,
    WorkspaceSyncTrustPreview,
    WorkspaceSourceSyncPreview
} from '../common/workspace-protocol';

export interface WorkspaceJobJournalOptions {
    readonly dataDir: string;
    readonly sourceRoots: readonly string[];
}

export interface WorkspaceJobScope {
    readonly kind: WorkspaceJobKind;
    readonly batchId: string;
    readonly sourceId: string;
    readonly sourceIds: readonly string[];
    readonly idempotencyKey: string;
}

export interface WorkspaceJobCleanupMarker {
    readonly required: boolean;
    readonly safe: boolean;
    readonly reason?: string;
    readonly updatedAt: string;
}

export interface WorkspaceJobRetryLineage {
    readonly rootJobId: string;
    readonly retryOfJobId?: string;
    readonly attempt: number;
    readonly recoveryState: 'none' | 'interrupted' | 'recovered';
}

export interface WorkspaceJobSnapshot {
    readonly schemaVersion: 1;
    readonly jobId: string;
    readonly kind: WorkspaceJobKind;
    readonly batchId: string;
    readonly sourceId: string;
    readonly sourceIds: readonly string[];
    readonly idempotencyKey: string;
    readonly state: WorkspaceJobState;
    readonly phase: WorkspaceSyncPhase;
    readonly startedAt: string;
    readonly updatedAt: string;
    readonly progress?: WorkspaceSyncProgress;
    readonly preview?: WorkspaceSyncTrustPreview;
    readonly sourcePreviews?: readonly WorkspaceSourceSyncPreview[];
    readonly lastError?: WorkspaceSyncError;
    readonly cleanupMarker?: WorkspaceJobCleanupMarker;
    readonly retry: WorkspaceJobRetryLineage;
    readonly createdAt: string;
    readonly createdSequence: number;
    readonly lastSequence: number;
}

export interface WorkspaceJobBatchSnapshot {
    readonly batchId: string;
    readonly sourceIds: readonly string[];
    readonly totalSources: number;
    readonly completedSources: number;
    readonly failedSources: number;
    readonly cancelledSources: number;
    readonly awaitingConfirmationSources: number;
    readonly runningSources: number;
    readonly queuedSources: number;
    readonly state: WorkspaceJobState;
    readonly jobs: readonly WorkspaceJobSnapshot[];
}

export interface WorkspaceJobJournalEvent {
    readonly journalSchemaVersion: 1;
    readonly sequence: number;
    readonly eventId: string;
    readonly timestamp: string;
    readonly job: WorkspaceJobSnapshot;
}

export interface WorkspaceJobDeltaResponse {
    readonly lastSequence: number;
    readonly events: readonly WorkspaceJobJournalEvent[];
}

interface PersistedJournalState {
    readonly events: readonly WorkspaceJobJournalEvent[];
    readonly jobs: ReadonlyMap<string, WorkspaceJobSnapshot>;
    readonly idempotencyIndex: ReadonlyMap<string, WorkspaceJobSnapshot>;
    readonly lastSequence: number;
}

const JOURNAL_SCHEMA_VERSION = 1 as const;

export class WorkspaceJobJournal {
    protected readonly journalDir: string;
    protected readonly journalPath: string;
    protected initialized = false;
    protected initialization: Promise<void> | undefined;
    protected appendTail: Promise<void> = Promise.resolve();
    protected events: WorkspaceJobJournalEvent[] = [];
    protected jobs = new Map<string, WorkspaceJobSnapshot>();
    protected idempotencyIndex = new Map<string, WorkspaceJobSnapshot>();
    protected lastSequence = 0;

    constructor(protected readonly options: WorkspaceJobJournalOptions) {
        if (options.sourceRoots.length === 0) {
            throw new Error('WorkspaceJobJournal requires at least one configured source root');
        }
        const dataDir = path.resolve(options.dataDir);
        for (const sourceRoot of options.sourceRoots) {
            if (isWithin(path.resolve(sourceRoot), dataDir)) {
                throw new Error('Workspace job dataDir must be outside configured source roots');
            }
        }
        this.journalDir = path.join(dataDir, 'studio');
        this.journalPath = path.join(this.journalDir, 'workspace-job-journal.v1.jsonl');
    }

    async initialize(): Promise<void> {
        if (this.initialized) {
            return;
        }
        if (!this.initialization) {
            this.initialization = this.doInitialize();
        }
        await this.initialization;
    }

    getJournalPath(): string {
        return this.journalPath;
    }

    getLastSequence(): number {
        return this.lastSequence;
    }

    getEventsAfter(sequence: number): WorkspaceJobJournalEvent[] {
        return this.events.filter(event => event.sequence > sequence);
    }

    getDeltaAfter(sequence: number): WorkspaceJobDeltaResponse {
        return {
            lastSequence: this.lastSequence,
            events: this.getEventsAfter(sequence)
        };
    }

    getJob(jobId: string): WorkspaceJobSnapshot | undefined {
        return this.jobs.get(jobId);
    }

    getCurrentJobs(): WorkspaceJobSnapshot[] {
        return [...this.jobs.values()].sort((left, right) => left.createdSequence - right.createdSequence);
    }

    getBatch(batchId: string): WorkspaceJobBatchSnapshot | undefined {
        const jobs = this.getCurrentJobs().filter(job => job.batchId === batchId);
        if (jobs.length === 0) {
            return undefined;
        }
        const sourceIds = [...new Set(jobs.flatMap(job => job.sourceIds))];
        const terminalBySource = new Map<string, WorkspaceJobSnapshot>();
        for (const job of jobs) {
            const current = terminalBySource.get(job.sourceId);
            if (!current || current.createdSequence < job.createdSequence) {
                terminalBySource.set(job.sourceId, job);
            }
        }
        let completedSources = 0;
        let failedSources = 0;
        let cancelledSources = 0;
        let awaitingConfirmationSources = 0;
        let runningSources = 0;
        let queuedSources = 0;
        for (const job of terminalBySource.values()) {
            if (job.state === 'completed') {
                completedSources += 1;
            } else if (job.state === 'failed') {
                failedSources += 1;
            } else if (job.state === 'cancelled') {
                cancelledSources += 1;
            } else if (job.state === 'awaiting-confirmation') {
                awaitingConfirmationSources += 1;
            } else if (job.state === 'running') {
                runningSources += 1;
            } else {
                queuedSources += 1;
            }
        }
        return {
            batchId,
            sourceIds,
            totalSources: sourceIds.length,
            completedSources,
            failedSources,
            cancelledSources,
            awaitingConfirmationSources,
            runningSources,
            queuedSources,
            state: summarizeBatchState({
                completedSources,
                failedSources,
                cancelledSources,
                awaitingConfirmationSources,
                runningSources,
                queuedSources
            }),
            jobs
        };
    }

    findExisting(scope: WorkspaceJobScope): WorkspaceJobSnapshot | undefined {
        const existing = this.idempotencyIndex.get(scope.idempotencyKey);
        if (!existing) {
            return undefined;
        }
        assertScopeMatch(existing, scope);
        return existing;
    }

    async appendSnapshot(
        snapshotInput: Omit<WorkspaceJobSnapshot, 'schemaVersion' | 'createdAt' | 'createdSequence' | 'lastSequence'>,
        createdAt?: string,
        createdSequence?: number
    ): Promise<WorkspaceJobSnapshot> {
        await this.initialize();
        const previousAppend = this.appendTail;
        let releaseAppend: () => void = () => undefined;
        this.appendTail = new Promise<void>(resolve => {
            releaseAppend = resolve;
        });
        await previousAppend;
        try {
            return await this.appendSnapshotSerial(snapshotInput, createdAt, createdSequence);
        } finally {
            releaseAppend();
        }
    }

    async markInterruptedOnRecovery(): Promise<WorkspaceJobSnapshot[]> {
        await this.initialize();
        const interrupted: WorkspaceJobSnapshot[] = [];
        for (const job of this.getCurrentJobs()) {
            if (job.state !== 'running') {
                continue;
            }
            interrupted.push(await this.appendSnapshot({
                ...job,
                state: 'failed',
                phase: 'failed',
                updatedAt: new Date().toISOString(),
                lastError: {
                    code: 'interrupted',
                    message: 'Workspace sync was interrupted before completion',
                    sourceId: job.sourceId,
                    retryable: true
                },
                cleanupMarker: {
                    required: true,
                    safe: false,
                    reason: 'recovery-required',
                    updatedAt: new Date().toISOString()
                },
                retry: {
                    ...job.retry,
                    recoveryState: 'interrupted'
                }
            }, job.createdAt, job.createdSequence));
        }
        return interrupted;
    }

    protected async doInitialize(): Promise<void> {
        await fs.mkdir(this.journalDir, { recursive: true });
        const canonicalDataDir = await fs.realpath(path.dirname(this.journalDir));
        for (const sourceRoot of this.options.sourceRoots) {
            const canonicalSourceRoot = await fs.realpath(sourceRoot);
            if (isWithin(canonicalSourceRoot, canonicalDataDir)) {
                throw new Error('Workspace job dataDir must resolve outside configured source roots');
            }
        }
        const state = await this.readPersistedState();
        this.events = [...state.events];
        this.jobs = new Map(state.jobs);
        this.idempotencyIndex = new Map(state.idempotencyIndex);
        this.lastSequence = state.lastSequence;
        this.initialized = true;
    }

    protected async appendSnapshotSerial(
        snapshotInput: Omit<WorkspaceJobSnapshot, 'schemaVersion' | 'createdAt' | 'createdSequence' | 'lastSequence'>,
        createdAt?: string,
        createdSequence?: number
    ): Promise<WorkspaceJobSnapshot> {
        const previous = this.jobs.get(snapshotInput.jobId);
        const existingByKey = this.idempotencyIndex.get(snapshotInput.idempotencyKey);
        if (existingByKey && existingByKey.jobId !== snapshotInput.jobId) {
            assertScopeMatch(existingByKey, snapshotInput);
        }
        if (previous) {
            assertScopeMatch(previous, snapshotInput);
        }
        const sequence = this.lastSequence + 1;
        const persistedTimestamp = sanitizeString(snapshotInput.updatedAt);
        const snapshot: WorkspaceJobSnapshot = {
            schemaVersion: 1,
            jobId: snapshotInput.jobId,
            kind: snapshotInput.kind,
            batchId: sanitizeString(snapshotInput.batchId),
            sourceId: sanitizeString(snapshotInput.sourceId),
            sourceIds: snapshotInput.sourceIds.map(sourceId => sanitizeString(sourceId)),
            idempotencyKey: sanitizeString(snapshotInput.idempotencyKey),
            state: snapshotInput.state,
            phase: snapshotInput.phase,
            startedAt: sanitizeString(snapshotInput.startedAt),
            updatedAt: persistedTimestamp,
            ...(snapshotInput.progress ? { progress: sanitizeProgress(snapshotInput.progress) } : {}),
            ...(snapshotInput.preview ? { preview: sanitizePreview(snapshotInput.preview) } : {}),
            ...(snapshotInput.sourcePreviews ? { sourcePreviews: snapshotInput.sourcePreviews.map(sanitizeSourcePreview) } : {}),
            ...(snapshotInput.lastError ? { lastError: sanitizeError(snapshotInput.lastError) } : {}),
            ...(snapshotInput.cleanupMarker ? { cleanupMarker: sanitizeCleanupMarker(snapshotInput.cleanupMarker) } : {}),
            retry: {
                rootJobId: sanitizeString(snapshotInput.retry.rootJobId),
                ...(snapshotInput.retry.retryOfJobId ? { retryOfJobId: sanitizeString(snapshotInput.retry.retryOfJobId) } : {}),
                attempt: snapshotInput.retry.attempt,
                recoveryState: snapshotInput.retry.recoveryState
            },
            createdAt: previous?.createdAt ?? sanitizeString(createdAt ?? snapshotInput.startedAt),
            createdSequence: previous?.createdSequence ?? createdSequence ?? sequence,
            lastSequence: sequence
        };
        const event: WorkspaceJobJournalEvent = {
            journalSchemaVersion: JOURNAL_SCHEMA_VERSION,
            sequence,
            eventId: randomUUID(),
            timestamp: persistedTimestamp,
            job: snapshot
        };
        await appendJsonLine(this.journalPath, event);
        this.lastSequence = sequence;
        this.events.push(event);
        this.jobs.set(snapshot.jobId, snapshot);
        this.idempotencyIndex.set(snapshot.idempotencyKey, snapshot);
        return snapshot;
    }

    protected async readPersistedState(): Promise<PersistedJournalState> {
        let contents = '';
        try {
            contents = await fs.readFile(this.journalPath, 'utf8');
        } catch (error) {
            if (isMissingFileError(error)) {
                return {
                    events: [],
                    jobs: new Map(),
                    idempotencyIndex: new Map(),
                    lastSequence: 0
                };
            }
            throw error;
        }
        const events: WorkspaceJobJournalEvent[] = [];
        const jobs = new Map<string, WorkspaceJobSnapshot>();
        const idempotencyIndex = new Map<string, WorkspaceJobSnapshot>();
        const lines = contents.split('\n');
        let lastNonEmptyIndex = lines.length - 1;
        while (lastNonEmptyIndex >= 0 && lines[lastNonEmptyIndex] === '') {
            lastNonEmptyIndex -= 1;
        }
        let lastSequence = 0;
        for (let index = 0; index < lines.length; index += 1) {
            const line = lines[index];
            if (!line) {
                continue;
            }
            let parsed: WorkspaceJobJournalEvent;
            try {
                parsed = JSON.parse(line) as WorkspaceJobJournalEvent;
            } catch (error) {
                if (index === lastNonEmptyIndex) {
                    break;
                }
                throw new Error(`Workspace job journal is corrupted before the trailing record: ${String(error)}`);
            }
            validateEvent(parsed);
            if (parsed.sequence !== lastSequence + 1) {
                throw new Error(`Workspace job journal sequence gap at ${parsed.sequence}`);
            }
            lastSequence = parsed.sequence;
            const previous = jobs.get(parsed.job.jobId);
            if (previous) {
                assertScopeMatch(previous, parsed.job);
            }
            const existingByKey = idempotencyIndex.get(parsed.job.idempotencyKey);
            if (existingByKey && existingByKey.jobId !== parsed.job.jobId) {
                assertScopeMatch(existingByKey, parsed.job);
            }
            events.push(parsed);
            jobs.set(parsed.job.jobId, parsed.job);
            idempotencyIndex.set(parsed.job.idempotencyKey, parsed.job);
        }
        return {
            events,
            jobs,
            idempotencyIndex,
            lastSequence
        };
    }
}

function validateEvent(event: WorkspaceJobJournalEvent): void {
    if (event.journalSchemaVersion !== JOURNAL_SCHEMA_VERSION) {
        throw new Error(`Unsupported workspace job journal schema version: ${String(event.journalSchemaVersion)}`);
    }
    if (!Number.isInteger(event.sequence) || event.sequence <= 0) {
        throw new Error(`Invalid workspace job journal sequence: ${String(event.sequence)}`);
    }
    if (!event.job?.jobId || !event.job?.idempotencyKey || !event.job?.batchId || !event.job?.sourceId) {
        throw new Error('Workspace job journal record is missing required identifiers');
    }
}

function summarizeBatchState(counts: {
    readonly completedSources: number;
    readonly failedSources: number;
    readonly cancelledSources: number;
    readonly awaitingConfirmationSources: number;
    readonly runningSources: number;
    readonly queuedSources: number;
}): WorkspaceJobState {
    if (counts.runningSources > 0) {
        return 'running';
    }
    if (counts.awaitingConfirmationSources > 0) {
        return 'awaiting-confirmation';
    }
    if (counts.queuedSources > 0) {
        return 'queued';
    }
    if (counts.failedSources > 0) {
        return 'failed';
    }
    if (counts.completedSources > 0 && counts.cancelledSources === 0) {
        return 'completed';
    }
    return 'cancelled';
}

function assertScopeMatch(
    existing: Pick<WorkspaceJobSnapshot, 'kind' | 'batchId' | 'sourceId' | 'sourceIds' | 'idempotencyKey'>,
    next: Pick<WorkspaceJobScope, 'kind' | 'batchId' | 'sourceId' | 'sourceIds' | 'idempotencyKey'>
): void {
    if (
        existing.kind !== next.kind
        || existing.batchId !== next.batchId
        || existing.sourceId !== next.sourceId
        || existing.idempotencyKey !== next.idempotencyKey
        || existing.sourceIds.length !== next.sourceIds.length
        || existing.sourceIds.some((sourceId, index) => sourceId !== next.sourceIds[index])
    ) {
        throw new Error(`Workspace job idempotency key conflict for ${next.idempotencyKey}`);
    }
}

async function appendJsonLine(filePath: string, event: WorkspaceJobJournalEvent): Promise<void> {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    const handle = await fs.open(filePath, 'a');
    try {
        await handle.writeFile(`${JSON.stringify(event)}\n`, 'utf8');
        await handle.sync();
    } finally {
        await handle.close();
    }
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
    return typeof error === 'object' && error !== null && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT';
}

function sanitizeProgress(progress: WorkspaceSyncProgress): WorkspaceSyncProgress {
    return {
        completedSources: Math.max(0, progress.completedSources),
        totalSources: Math.max(progress.completedSources, progress.totalSources),
        ...(progress.activeSourceId ? { activeSourceId: sanitizeString(progress.activeSourceId) } : {})
    };
}

function sanitizePreview(preview: WorkspaceSyncTrustPreview): WorkspaceSyncTrustPreview {
    return {
        jobId: sanitizeString(preview.jobId),
        requiresConfirmation: preview.requiresConfirmation,
        saveConfig: preview.saveConfig,
        impactedSourceIds: preview.impactedSourceIds.map(sourceId => sanitizeString(sourceId)),
        reasons: preview.reasons.map(reason => sanitizeString(reason))
    };
}

function sanitizeSourcePreview(preview: WorkspaceSourceSyncPreview): WorkspaceSourceSyncPreview {
    return {
        sourceId: sanitizeString(preview.sourceId),
        status: preview.status,
        eligibility: preview.eligibility,
        forceRequired: preview.forceRequired,
        ...(preview.expectedRevision ? { expectedRevision: sanitizeString(preview.expectedRevision) } : {}),
        ...(preview.expectedRemoteRevision ? { expectedRemoteRevision: sanitizeString(preview.expectedRemoteRevision) } : {}),
        ...(preview.aheadCount !== undefined ? { aheadCount: preview.aheadCount } : {}),
        ...(preview.behindCount !== undefined ? { behindCount: preview.behindCount } : {}),
        ...(preview.blockedReason ? { blockedReason: sanitizeString(preview.blockedReason) } : {}),
        ...(preview.confirmationMessage ? { confirmationMessage: sanitizeString(preview.confirmationMessage) } : {})
    };
}

function sanitizeError(error: WorkspaceSyncError): WorkspaceSyncError {
    return {
        code: sanitizeString(error.code),
        message: sanitizeString(error.message),
        ...(error.sourceId ? { sourceId: sanitizeString(error.sourceId) } : {}),
        retryable: error.retryable
    };
}

function sanitizeCleanupMarker(marker: WorkspaceJobCleanupMarker): WorkspaceJobCleanupMarker {
    return {
        required: marker.required,
        safe: marker.safe,
        ...(marker.reason ? { reason: sanitizeString(marker.reason) } : {}),
        updatedAt: sanitizeString(marker.updatedAt)
    };
}

function sanitizeString(value: string): string {
    return value
        .replace(/\b(gh[pousr]_[A-Za-z0-9]+)\b/g, '[redacted-token]')
        .replace(/\b(Bearer)\s+[A-Za-z0-9._-]+\b/gi, '$1 [redacted-token]')
        .replace(/\b(password|token|secret|authorization)\b\s*[:=]\s*([^\s,;]+)/gi, '$1=[redacted]')
        .replace(/\bhttps?:\/\/[^/\s]+:[^@\s]+@/gi, 'https://[redacted]@');
}

function isWithin(rootPath: string, candidatePath: string): boolean {
    const relative = path.relative(rootPath, candidatePath);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}
