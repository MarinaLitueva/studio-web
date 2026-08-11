import * as fs from 'fs/promises';
import * as path from 'path';
import {
    type StudioAuditDeltaResponse,
    type StudioAuditEntry,
    type StudioOperationEvent,
    type StudioOperationScope,
    type StudioOperationSnapshot,
    type StudioOperationState
} from '../common/studio-protocol';

export interface OperationJournalOptions {
    readonly dataDir: string;
    readonly repositoryRoot: string;
}

interface PersistedJournalState {
    readonly events: StudioOperationEvent[];
    readonly operations: ReadonlyMap<string, StudioOperationSnapshot>;
    readonly idempotencyIndex: ReadonlyMap<string, StudioOperationSnapshot>;
    readonly lastSequence: number;
}

const LEGACY_IDENTITY_REASON = 'Legacy operation is blocked: repository identity is missing';

export class OperationJournal {
    protected readonly journalDir: string;
    protected readonly journalPath: string;
    protected initialized = false;
    protected initialization: Promise<void> | undefined;
    protected appendTail: Promise<void> = Promise.resolve();
    protected events: StudioOperationEvent[] = [];
    protected operations = new Map<string, StudioOperationSnapshot>();
    protected idempotencyIndex = new Map<string, StudioOperationSnapshot>();
    protected lastSequence = 0;

    constructor(protected readonly options: OperationJournalOptions) {
        const dataDir = path.resolve(options.dataDir);
        const repositoryRoot = path.resolve(options.repositoryRoot);
        if (isWithin(repositoryRoot, dataDir)) {
            throw new Error('STUDIO_DATA_DIR must be outside the configured repository root');
        }
        this.journalDir = path.join(dataDir, 'studio');
        this.journalPath = path.join(this.journalDir, 'operation-journal.jsonl');
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

    protected async doInitialize(): Promise<void> {
        await fs.mkdir(this.journalDir, { recursive: true });
        const [canonicalRepositoryRoot, canonicalDataDir] = await Promise.all([
            fs.realpath(this.options.repositoryRoot),
            fs.realpath(path.dirname(this.journalDir))
        ]);
        if (isWithin(canonicalRepositoryRoot, canonicalDataDir)) {
            throw new Error('STUDIO_DATA_DIR must resolve outside the configured repository root');
        }
        const state = await this.readPersistedState();
        this.events = [...state.events];
        this.operations = new Map(state.operations);
        this.idempotencyIndex = new Map(state.idempotencyIndex);
        this.lastSequence = state.lastSequence;
        await this.appendLegacyBlockedEvents();
        this.initialized = true;
    }

    getJournalPath(): string {
        return this.journalPath;
    }

    getLastSequence(): number {
        return this.lastSequence;
    }

    getOperation(operationId: string): StudioOperationSnapshot | undefined {
        return this.operations.get(operationId);
    }

    findExisting(scope: StudioOperationScope): StudioOperationSnapshot | undefined {
        const existing = this.idempotencyIndex.get(scope.idempotencyKey);
        if (!existing) {
            return undefined;
        }
        if (
            existing.journalSchemaVersion !== scope.journalSchemaVersion ||
            existing.workspaceId !== scope.workspaceId ||
            existing.repositoryId !== scope.repositoryId ||
            existing.repositoryFingerprint !== scope.repositoryFingerprint ||
            existing.repositoryConfigRevision !== scope.repositoryConfigRevision ||
            existing.relativePath !== scope.relativePath ||
            existing.repositoryRelativePath !== scope.repositoryRelativePath ||
            existing.languageId !== scope.languageId ||
            existing.contentHash !== scope.contentHash
        ) {
            throw new Error('Idempotency key conflict for a different workspace, path, language, or content hash');
        }
        return existing;
    }

    getEventsAfter(sequence: number): StudioOperationEvent[] {
        return this.events.filter(event => event.sequence > sequence);
    }

    getAuditEntriesAfter(sequence: number): StudioAuditDeltaResponse {
        return {
            lastSequence: this.lastSequence,
            entries: this.getEventsAfter(sequence)
                .map(toAuditEntry)
                .filter((entry): entry is StudioAuditEntry => Boolean(entry))
        };
    }

    getCurrentOperations(): StudioOperationSnapshot[] {
        return [...this.operations.values()].sort((left, right) => left.createdSequence - right.createdSequence);
    }

    protected async appendLegacyBlockedEvents(): Promise<void> {
        for (const operation of this.getCurrentOperations()) {
            if (
                operation.journalSchemaVersion !== 1 ||
                operation.state !== 'blocked' ||
                operation.failureReason !== LEGACY_IDENTITY_REASON
            ) {
                continue;
            }
            const latestEvent = [...this.events]
                .reverse()
                .find(event => event.operationId === operation.operationId);
            if (latestEvent?.state === 'blocked') {
                continue;
            }
            const timestamp = new Date().toISOString();
            const sequence = this.lastSequence + 1;
            const event: StudioOperationEvent = {
                journalSchemaVersion: 1,
                sequence,
                operationId: operation.operationId,
                state: 'blocked',
                timestamp,
                workspaceId: operation.workspaceId,
                relativePath: operation.relativePath,
                repositoryRelativePath: operation.repositoryRelativePath,
                languageId: operation.languageId,
                contentHash: operation.contentHash,
                idempotencyKey: operation.idempotencyKey,
                savedAt: operation.savedAt,
                failureReason: LEGACY_IDENTITY_REASON
            };
            await appendJsonLine(this.journalPath, event);
            const snapshot: StudioOperationSnapshot = {
                ...operation,
                state: 'blocked',
                updatedAt: timestamp,
                lastSequence: sequence,
                failureReason: LEGACY_IDENTITY_REASON
            };
            this.lastSequence = sequence;
            this.events.push(event);
            this.operations.set(operation.operationId, snapshot);
            this.idempotencyIndex.set(operation.idempotencyKey, snapshot);
        }
    }

    async appendTransition(
        scope: StudioOperationScope,
        operationId: string,
        state: StudioOperationState,
        timestamp: string,
        failureReason?: string,
        commitSha?: string
    ): Promise<StudioOperationSnapshot> {
        await this.initialize();
        const previousAppend = this.appendTail;
        let releaseAppend: () => void = () => undefined;
        this.appendTail = new Promise<void>(resolve => {
            releaseAppend = resolve;
        });
        await previousAppend;
        try {
            return await this.appendTransitionSerial(scope, operationId, state, timestamp, failureReason, commitSha);
        } finally {
            releaseAppend();
        }
    }

    protected async appendTransitionSerial(
        scope: StudioOperationScope,
        operationId: string,
        state: StudioOperationState,
        timestamp: string,
        failureReason?: string,
        commitSha?: string
    ): Promise<StudioOperationSnapshot> {
        const existingByKey = this.idempotencyIndex.get(scope.idempotencyKey);
        if (existingByKey && (
            existingByKey.operationId !== operationId ||
            existingByKey.journalSchemaVersion !== scope.journalSchemaVersion ||
            existingByKey.workspaceId !== scope.workspaceId ||
            existingByKey.repositoryId !== scope.repositoryId ||
            existingByKey.repositoryFingerprint !== scope.repositoryFingerprint ||
            existingByKey.repositoryConfigRevision !== scope.repositoryConfigRevision ||
            existingByKey.relativePath !== scope.relativePath ||
            existingByKey.repositoryRelativePath !== scope.repositoryRelativePath ||
            existingByKey.languageId !== scope.languageId ||
            existingByKey.contentHash !== scope.contentHash
        )) {
            throw new Error('Idempotency key conflict for a different operation, workspace, path, language, or content hash');
        }
        const previous = this.operations.get(operationId);
        if (previous && (
            previous.journalSchemaVersion !== scope.journalSchemaVersion ||
            previous.workspaceId !== scope.workspaceId ||
            previous.repositoryId !== scope.repositoryId ||
            previous.repositoryFingerprint !== scope.repositoryFingerprint ||
            previous.repositoryConfigRevision !== scope.repositoryConfigRevision ||
            previous.relativePath !== scope.relativePath ||
            previous.repositoryRelativePath !== scope.repositoryRelativePath ||
            previous.languageId !== scope.languageId ||
            previous.contentHash !== scope.contentHash ||
            previous.idempotencyKey !== scope.idempotencyKey ||
            previous.savedAt !== scope.savedAt
        )) {
            throw new Error('Operation scope cannot change between journal transitions');
        }
        const sequence = this.lastSequence + 1;
        const event: StudioOperationEvent = {
            journalSchemaVersion: 2,
            sequence,
            operationId,
            state,
            timestamp,
            workspaceId: scope.workspaceId,
            repositoryId: scope.repositoryId,
            repositoryFingerprint: scope.repositoryFingerprint,
            repositoryConfigRevision: scope.repositoryConfigRevision,
            relativePath: scope.relativePath,
            repositoryRelativePath: scope.repositoryRelativePath,
            languageId: scope.languageId,
            contentHash: scope.contentHash,
            idempotencyKey: scope.idempotencyKey,
            savedAt: scope.savedAt,
            ...(commitSha ? { commitSha } : {}),
            ...(failureReason ? { failureReason } : {})
        };

        await appendJsonLine(this.journalPath, event);

        const snapshot: StudioOperationSnapshot = {
            journalSchemaVersion: 2,
            operationId,
            workspaceId: scope.workspaceId,
            repositoryId: scope.repositoryId,
            repositoryFingerprint: scope.repositoryFingerprint,
            repositoryConfigRevision: scope.repositoryConfigRevision,
            relativePath: scope.relativePath,
            repositoryRelativePath: scope.repositoryRelativePath,
            languageId: scope.languageId,
            contentHash: scope.contentHash,
            idempotencyKey: scope.idempotencyKey,
            savedAt: scope.savedAt,
            state,
            createdAt: previous?.createdAt ?? timestamp,
            updatedAt: timestamp,
            createdSequence: previous?.createdSequence ?? sequence,
            lastSequence: sequence,
            ...(commitSha ? { commitSha } : previous?.commitSha ? { commitSha: previous.commitSha } : {}),
            ...(failureReason ? { failureReason } : {})
        };

        this.lastSequence = sequence;
        this.events.push(event);
        this.operations.set(operationId, snapshot);
        this.idempotencyIndex.set(scope.idempotencyKey, snapshot);
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
                    operations: new Map(),
                    idempotencyIndex: new Map(),
                    lastSequence: 0
                };
            }
            throw error;
        }

        const stateEvents: StudioOperationEvent[] = [];
        const operations = new Map<string, StudioOperationSnapshot>();
        const idempotencyIndex = new Map<string, StudioOperationSnapshot>();
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
            let parsed: StudioOperationEvent;
            try {
                parsed = JSON.parse(line) as StudioOperationEvent;
            } catch (error) {
                if (index === lastNonEmptyIndex) {
                    break;
                }
                throw new Error(`Operation journal is corrupted before the trailing record: ${String(error)}`);
            }
            if (parsed.sequence !== lastSequence + 1) {
                throw new Error(`Operation journal sequence gap at ${parsed.sequence}`);
            }
            lastSequence = parsed.sequence;
            stateEvents.push(parsed);
            const previous = operations.get(parsed.operationId);
            const existingByKey = idempotencyIndex.get(parsed.idempotencyKey);
            if (existingByKey && existingByKey.operationId !== parsed.operationId) {
                throw new Error(`Operation journal reuses idempotency key ${parsed.idempotencyKey}`);
            }
            const snapshot: StudioOperationSnapshot = {
                journalSchemaVersion: parsed.journalSchemaVersion === 2 ? 2 : 1,
                operationId: parsed.operationId,
                workspaceId: parsed.workspaceId,
                ...(parsed.journalSchemaVersion === 2 ? {
                    repositoryId: parsed.repositoryId,
                    repositoryFingerprint: parsed.repositoryFingerprint,
                    repositoryConfigRevision: parsed.repositoryConfigRevision
                } : {}),
                relativePath: parsed.relativePath,
                repositoryRelativePath: parsed.repositoryRelativePath,
                languageId: parsed.languageId,
                contentHash: parsed.contentHash,
                idempotencyKey: parsed.idempotencyKey,
                savedAt: parsed.savedAt,
                state: parsed.state,
                createdAt: previous?.createdAt ?? parsed.timestamp,
                updatedAt: parsed.timestamp,
                createdSequence: previous?.createdSequence ?? parsed.sequence,
                lastSequence: parsed.sequence,
                ...(parsed.commitSha ? { commitSha: parsed.commitSha } : previous?.commitSha ? { commitSha: previous.commitSha } : {}),
                ...(parsed.failureReason ? { failureReason: parsed.failureReason } : {})
            };
            operations.set(parsed.operationId, snapshot);
            idempotencyIndex.set(parsed.idempotencyKey, snapshot);
        }

        for (const [operationId, operation] of operations) {
            if (operation.journalSchemaVersion === 1 && isNonTerminal(operation.state)) {
                operations.set(operationId, {
                    ...operation,
                    state: 'blocked',
                    failureReason: LEGACY_IDENTITY_REASON
                });
            }
        }

        return {
            events: stateEvents,
            operations,
            idempotencyIndex,
            lastSequence
        };
    }
}

function isNonTerminal(state: StudioOperationState): boolean {
    return state === 'queued' || state === 'validating' || state === 'committing'
        || state === 'committed' || state === 'pushing' || state === 'push-pending';
}

async function appendJsonLine(filePath: string, event: StudioOperationEvent): Promise<void> {
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

function toAuditEntry(event: StudioOperationEvent): StudioAuditEntry | undefined {
    const relativePath = sanitizeRelativePath(event.repositoryRelativePath);
    if (!relativePath) {
        return undefined;
    }
    return {
        sequence: event.sequence,
        relativePath,
        contentHash: sanitizeContentHash(event.contentHash),
        sha: sanitizeCommitSha(event.commitSha),
        time: formatAuditTimestamp(event.timestamp),
        outcome: mapAuditOutcome(event.state)
    };
}

function sanitizeRelativePath(value: string): string | undefined {
    if (!value || value.startsWith('/') || value.includes('\\')) {
        return undefined;
    }
    const segments = value.split('/');
    if (segments.some(segment => segment === '' || segment === '.' || segment === '..')) {
        return undefined;
    }
    return value;
}

function sanitizeContentHash(value: string): string {
    return /^[0-9a-f]{16,128}$/i.test(value) ? value.toLowerCase() : 'invalid';
}

function sanitizeCommitSha(value: string | undefined): string {
    return /^[0-9a-f]{40}$/i.test(value ?? '') ? value!.toLowerCase() : '';
}

function formatAuditTimestamp(value: string): string {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? 'Invalid time' : date.toISOString();
}

function mapAuditOutcome(state: StudioOperationState): StudioAuditEntry['outcome'] {
    switch (state) {
        case 'queued':
        case 'validating':
        case 'no-changes':
            return 'modified';
        case 'committing':
        case 'committed':
        case 'committed-local':
            return 'committed';
        case 'pushing':
            return 'pushing';
        case 'pushed':
            return 'pushed';
        case 'push-pending':
            return 'pending';
        case 'failed':
            return 'failed';
        case 'blocked':
            return 'blocked';
        default:
            return 'modified';
    }
}

function isWithin(parent: string, candidate: string): boolean {
    const relative = path.relative(parent, candidate);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}
