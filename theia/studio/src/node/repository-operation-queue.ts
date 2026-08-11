import { createHash, randomUUID } from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import {
    type EnqueueStudioOperationRequest,
    type EnqueueStudioOperationResponse,
    type StudioOperationDeltaResponse,
    type StudioOperationEvent,
    type StudioOperationScope,
    type StudioOperationSnapshot,
    type StudioOperationState
} from '../common/studio-protocol';
import { OperationJournal } from './operation-journal';
import { WorkspaceBoundary } from './workspace-boundary';
import { RepositoryRegistry } from './repository-registry';

export type FakeRepositoryExecutionResult =
    | { readonly outcome: 'no-changes' }
    | { readonly outcome: 'committed-local'; readonly commitSha: string }
    | { readonly outcome: 'pushed'; readonly commitSha: string }
    | { readonly outcome: 'failed'; readonly failureReason: string }
    | { readonly outcome: 'push-pending'; readonly failureReason: string; readonly commitSha: string }
    | { readonly outcome: 'blocked'; readonly failureReason: string };

export interface RepositoryOperationExecutionContext {
    readonly resumingPush: boolean;
}

export interface RepositoryOperationExecutor {
    execute(
        operation: StudioOperationSnapshot,
        context?: RepositoryOperationExecutionContext
    ): Promise<FakeRepositoryExecutionResult>;
}

type Subscriber = (event: StudioOperationEvent) => void;

export class RepositoryOperationQueue {
    protected readonly pendingByRepository = new Map<string, StudioOperationSnapshot[]>();
    protected readonly activeRepositories = new Set<string>();
    protected readonly subscribers = new Set<Subscriber>();
    protected idleResolvers: Array<() => void> = [];
    protected enqueueTail: Promise<void> = Promise.resolve();

    constructor(
        protected readonly journal: OperationJournal,
        protected readonly workspaceBoundary: WorkspaceBoundary,
        protected readonly executor: RepositoryOperationExecutor,
        protected readonly repositoryRegistry: RepositoryRegistry,
        protected readonly maxConcurrentRepositories = 3
    ) {}

    async initialize(): Promise<void> {
        await this.journal.initialize();
        const replayed = this.journal.getCurrentOperations()
            .filter(operation => operation.journalSchemaVersion === 2 && isNonTerminal(operation.state))
            .sort((left, right) => left.createdSequence - right.createdSequence);
        replayed.forEach(operation => this.queueOperation(operation));
        this.scheduleProcessing();
        await this.whenIdle();
    }

    subscribe(listener: Subscriber): () => void {
        this.subscribers.add(listener);
        return () => this.subscribers.delete(listener);
    }

    getEventsAfter(sequence: number): StudioOperationDeltaResponse {
        const events = this.journal.getEventsAfter(sequence);
        return {
            lastSequence: this.journal.getLastSequence(),
            events
        };
    }

    getAuditEntriesAfter(sequence: number) {
        return this.journal.getAuditEntriesAfter(sequence);
    }

    async whenIdle(): Promise<void> {
        if (this.activeRepositories.size === 0 && this.pendingByRepository.size === 0) {
            return;
        }
        await new Promise<void>(resolve => this.idleResolvers.push(resolve));
    }

    async enqueue(request: EnqueueStudioOperationRequest): Promise<EnqueueStudioOperationResponse> {
        this.workspaceBoundary.assertWorkspaceId(request.workspaceId);
        const resolved = await this.workspaceBoundary.resolveWorkspaceLocation({
            relativePath: request.relativePath,
            requireExists: true
        });
        const owner = this.repositoryRegistry.resolveOwnerForCanonicalPath(
            await fs.realpath(resolved.absolutePath)
        );
        if (owner.descriptor.repositoryId !== request.repositoryId) {
            throw new Error('Repository ownership mismatch for saved path');
        }
        const repositoryRelativePath = toRepositoryRelativePath(owner.canonicalRoot, resolved.absolutePath);
        const scope: StudioOperationScope = {
            journalSchemaVersion: 2,
            workspaceId: request.workspaceId,
            repositoryId: owner.descriptor.repositoryId,
            repositoryFingerprint: owner.descriptor.fingerprint,
            repositoryConfigRevision: owner.descriptor.git.configRevision,
            relativePath: resolved.location.relativePath,
            repositoryRelativePath,
            languageId: request.languageId,
            contentHash: request.contentHash,
            idempotencyKey: request.idempotencyKey,
            savedAt: request.savedAt
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
                return { operation: existing, reusedExisting: true };
            }

            const operationId = randomUUID();
            const queued = await this.persistTransition(scope, operationId, 'queued');
            this.queueOperation(queued);
            this.scheduleProcessing();
            return { operation: queued, reusedExisting: false };
        } finally {
            releaseEnqueue();
        }
    }

    async retry(operationId: string): Promise<StudioOperationSnapshot> {
        const operation = this.journal.getOperation(operationId);
        if (!operation) {
            throw new Error(`Operation not found: ${operationId}`);
        }
        if (operation.state !== 'push-pending' && operation.state !== 'blocked' && operation.state !== 'failed') {
            throw new Error(`Operation is not retryable from state: ${operation.state}`);
        }
        if (operation.journalSchemaVersion === 1) {
            return this.retryWithCurrentRepositoryIdentity(operation);
        }
        if (shouldRefreshRepositoryIdentity(operation)) {
            return this.retryWithCurrentRepositoryIdentity(operation);
        }
        const repositoryId = requireRepositoryId(operation);
        const pending = this.pendingByRepository.get(repositoryId)
            ?.find(candidate => candidate.operationId === operationId);
        if (pending) {
            return pending;
        }
        this.queueOperation(operation);
        this.scheduleProcessing();
        return operation;
    }

    protected scheduleProcessing(): void {
        while (this.activeRepositories.size < this.maxConcurrentRepositories) {
            const repositoryId = [...this.pendingByRepository.keys()]
                .find(candidate => !this.activeRepositories.has(candidate));
            if (!repositoryId) {
                break;
            }
            this.activeRepositories.add(repositoryId);
            void this.processRepository(repositoryId);
        }
    }

    protected async processRepository(repositoryId: string): Promise<void> {
        try {
            const pending = this.pendingByRepository.get(repositoryId);
            while (pending && pending.length > 0) {
                const next = pending[0];
                await this.runOperation(next);
                pending.shift();
            }
        } finally {
            this.activeRepositories.delete(repositoryId);
            const pending = this.pendingByRepository.get(repositoryId);
            if (!pending || pending.length === 0) {
                this.pendingByRepository.delete(repositoryId);
            }
            this.scheduleProcessing();
            this.resolveIdleWaiters();
        }
    }

    protected async runOperation(operation: StudioOperationSnapshot): Promise<void> {
        const scope = toScope(operation);
        const resumingPush = operation.state === 'committed' || operation.state === 'pushing' || operation.state === 'push-pending';
        await this.persistTransition(scope, operation.operationId, 'validating');
        let result: FakeRepositoryExecutionResult;
        try {
            await this.assertCurrentOwnership(operation);
            result = await this.executor.execute(
                this.requireCurrentSnapshot(operation.operationId),
                { resumingPush }
            );
        } catch (error) {
            await this.persistTransition(scope, operation.operationId, 'failed', errorMessage(error));
            return;
        }

        if (result.outcome === 'no-changes') {
            await this.persistTransition(scope, operation.operationId, 'no-changes');
            return;
        }
        if (result.outcome === 'failed') {
            await this.persistTransition(scope, operation.operationId, 'failed', result.failureReason);
            return;
        }
        if (result.outcome === 'committed-local') {
            if (!resumingPush) {
                await this.persistTransition(scope, operation.operationId, 'committing');
            }
            await this.persistTransition(scope, operation.operationId, 'committed-local', undefined, result.commitSha);
            return;
        }
        if (result.outcome === 'push-pending') {
            if (!resumingPush) {
                await this.persistTransition(scope, operation.operationId, 'committing');
                await this.persistTransition(scope, operation.operationId, 'committed', undefined, result.commitSha);
            }
            await this.persistTransition(scope, operation.operationId, 'push-pending', result.failureReason, result.commitSha);
            return;
        }
        if (result.outcome === 'blocked') {
            await this.persistTransition(scope, operation.operationId, 'blocked', result.failureReason);
            return;
        }

        if (!resumingPush) {
            await this.persistTransition(scope, operation.operationId, 'committing');
            await this.persistTransition(scope, operation.operationId, 'committed', undefined, result.commitSha);
        }
        await this.persistTransition(scope, operation.operationId, 'pushing', undefined, result.commitSha);
        await this.persistTransition(scope, operation.operationId, 'pushed', undefined, result.commitSha);
    }

    protected async persistTransition(
        scope: StudioOperationScope,
        operationId: string,
        state: StudioOperationState,
        failureReason?: string,
        commitSha?: string
    ): Promise<StudioOperationSnapshot> {
        const snapshot = await this.journal.appendTransition(
            scope,
            operationId,
            state,
            new Date().toISOString(),
            failureReason,
            commitSha
        );
        const event = this.journal.getEventsAfter(snapshot.lastSequence - 1)[0];
        for (const subscriber of this.subscribers) {
            try {
                subscriber(event);
            } catch {
                // A listener cannot roll back a transition that is already durable.
            }
        }
        return snapshot;
    }

    protected requireCurrentSnapshot(operationId: string): StudioOperationSnapshot {
        const snapshot = this.journal.getOperation(operationId);
        if (!snapshot) {
            throw new Error(`Operation not found: ${operationId}`);
        }
        return snapshot;
    }

    protected queueOperation(operation: StudioOperationSnapshot): void {
        const repositoryId = requireRepositoryId(operation);
        const pending = this.pendingByRepository.get(repositoryId) ?? [];
        pending.push(operation);
        this.pendingByRepository.set(repositoryId, pending);
    }

    protected async assertCurrentOwnership(operation: StudioOperationSnapshot): Promise<void> {
        const repository = this.repositoryRegistry.requireRepository(requireRepositoryId(operation));
        if (repository.descriptor.fingerprint !== operation.repositoryFingerprint) {
            throw new Error('Repository fingerprint changed since the operation was queued');
        }
        const resolved = await this.workspaceBoundary.resolveWorkspaceLocation({
            relativePath: operation.relativePath,
            requireExists: true
        });
        const owner = this.repositoryRegistry.resolveOwnerForCanonicalPath(await fs.realpath(resolved.absolutePath));
        if (owner.descriptor.repositoryId !== operation.repositoryId) {
            throw new Error('Repository ownership changed since the operation was queued');
        }
        const repositoryRelativePath = toRepositoryRelativePath(owner.canonicalRoot, resolved.absolutePath);
        if (repositoryRelativePath !== operation.repositoryRelativePath) {
            throw new Error('Repository-relative path changed since the operation was queued');
        }
    }

    protected async retryWithCurrentRepositoryIdentity(operation: StudioOperationSnapshot): Promise<StudioOperationSnapshot> {
        const resolved = await this.workspaceBoundary.resolveWorkspaceLocation({
            relativePath: operation.relativePath,
            requireExists: true
        });
        if (resolved.location.isDirectory) {
            throw new Error('Retry operation target must be a file');
        }
        const contentHash = createHash('sha256')
            .update(await fs.readFile(resolved.absolutePath))
            .digest('hex');
        if (contentHash !== operation.contentHash) {
            throw new Error('Retry operation saved content no longer matches the file');
        }
        const owner = this.repositoryRegistry.resolveOwnerForCanonicalPath(await fs.realpath(resolved.absolutePath));
        const response = await this.enqueue({
            workspaceId: operation.workspaceId,
            repositoryId: owner.descriptor.repositoryId,
            relativePath: operation.relativePath,
            languageId: operation.languageId,
            contentHash: operation.contentHash,
            idempotencyKey: createHash('sha256')
                .update([
                    operation.operationId,
                    'identity-retry',
                    owner.descriptor.repositoryId,
                    owner.descriptor.fingerprint,
                    owner.descriptor.git.configRevision,
                    operation.contentHash
                ].join('\0'))
                .digest('hex'),
            savedAt: new Date().toISOString()
        });
        return response.operation;
    }

    protected resolveIdleWaiters(): void {
        if (this.activeRepositories.size !== 0 || this.pendingByRepository.size !== 0) {
            return;
        }
        const resolvers = [...this.idleResolvers];
        this.idleResolvers = [];
        resolvers.forEach(resolve => resolve());
    }
}

function toScope(operation: StudioOperationSnapshot): StudioOperationScope {
    if (operation.journalSchemaVersion !== 2) {
        throw new Error('Legacy operation cannot be replayed without repository identity');
    }
    return {
        journalSchemaVersion: 2,
        workspaceId: operation.workspaceId,
        repositoryId: requireValue(operation.repositoryId, 'repository ID'),
        repositoryFingerprint: requireValue(operation.repositoryFingerprint, 'repository fingerprint'),
        repositoryConfigRevision: requireValue(operation.repositoryConfigRevision, 'repository config revision'),
        relativePath: operation.relativePath,
        repositoryRelativePath: operation.repositoryRelativePath,
        languageId: operation.languageId,
        contentHash: operation.contentHash,
        idempotencyKey: operation.idempotencyKey,
        savedAt: operation.savedAt
    };
}

function requireRepositoryId(operation: StudioOperationSnapshot): string {
    if (operation.journalSchemaVersion !== 2) {
        throw new Error('Legacy operation has no repository identity');
    }
    return requireValue(operation.repositoryId, 'repository ID');
}

function requireValue(value: string | undefined, label: string): string {
    if (!value) {
        throw new Error(`Operation ${label} is missing`);
    }
    return value;
}

function toRepositoryRelativePath(repositoryRoot: string, absolutePath: string): string {
    const relativePath = path.relative(repositoryRoot, absolutePath).replace(/\\/g, '/');
    if (!relativePath || relativePath === '.' || relativePath.startsWith('../') || path.isAbsolute(relativePath)) {
        throw new Error('Saved path cannot be mapped into its owning repository');
    }
    return relativePath;
}

function isNonTerminal(state: StudioOperationState): boolean {
    return state === 'queued' || state === 'validating' || state === 'committing' ||
        state === 'committed' || state === 'pushing' || state === 'push-pending';
}

function shouldRefreshRepositoryIdentity(operation: StudioOperationSnapshot): boolean {
    if (operation.state !== 'failed' && operation.state !== 'blocked') {
        return false;
    }
    const reason = operation.failureReason ?? '';
    return reason.startsWith('Unknown repository:')
        || reason === 'Operation repository is no longer registered'
        || reason === 'Repository fingerprint changed since the operation was queued'
        || reason === 'Repository ownership changed since the operation was queued'
        || reason === 'Repository-relative path changed since the operation was queued';
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
