import * as fs from 'fs/promises';
import * as path from 'path';
import { createHash, randomUUID } from 'crypto';
import { inject, injectable } from '@theia/core/shared/inversify';
import { BackendApplicationContribution } from '@theia/core/lib/node';
import {
    CFS_MAP_SCHEMA_VERSION,
    GRAPH_SCHEMA_VERSION,
    type WorkspaceGraphDiagnostic,
    type WorkspaceGraphClient,
    type WorkspaceGraphDirtyFile,
    type WorkspaceGraphDirtyOverlay,
    type WorkspaceGraphRefreshRequest,
    type WorkspaceGraphRepositoryRevision,
    type WorkspaceGraphScopeRequest,
    type WorkspaceGraphSnapshot,
    type WorkspaceGraphSnapshotRequest,
    type WorkspaceGraphSnapshotResponse,
    type WorkspaceGraphStatus
} from '../common/graph-model';
import { adaptCfsMap } from './cfs-map-adapter';
import { CfsMapRunner, CfsMapRunnerImpl, type CfsMapEngine } from './cfs-map-runner';
import { GitExecutor } from './git-executor';
import { RepositoryRegistry } from './repository-registry';
import { StudioRuntimeConfigService } from './studio-runtime-config';

const CACHE_DIR_NAME = 'workspace-graph-cache';
const CACHE_FORMAT_VERSION = 3;
const CACHE_ENGINE_ID = 'cfs-map-v1-adapter-v2-repository-local-only';
const COMMIT_SHA_PATTERN = /^[0-9a-f]{40}$/iu;
const CACHE_REVISION_PATTERN = /^[0-9a-f]{64}$/u;
const CACHE_SNAPSHOT_FILE_PATTERN = /^([0-9a-f]{64})\.json$/u;
const MAX_CACHE_DIRECTORY_ENTRIES = 1024;
const MAX_CACHE_RECOVERY_CANDIDATES = 256;
const MAX_CACHE_FILE_BYTES = 64 * 1024 * 1024;
const MAX_CACHE_INDEX_FILE_BYTES = 64 * 1024;

const GRAPH_NODE_KINDS = new Set(['markdown', 'source', 'phantom-cpt']);
const GRAPH_CATEGORY_ORIGINS = new Set(['override', 'registry', 'parent-dir', 'phantom']);
const GRAPH_EDGE_KINDS = new Set(['file-link', 'cpt-doc', 'cpt-impl']);
const GRAPH_SOURCE_ROLES = new Set(['artifacts', 'codebase', 'kits', 'full']);
const GRAPH_MARKER_KINDS = new Set(['scope', 'block-begin', 'block-end', 'md-ref', 'md-def']);
const GRAPH_DIAGNOSTIC_CODES = new Set([
    'binary',
    'ignored',
    'malformed',
    'oversized',
    'traversal',
    'unknown-file-type',
    'unresolved-link',
    'unknown-source',
    'invalid-output',
    'command-unavailable',
    'timeout',
    'map-failed',
    'cache-invalid'
]);

interface CacheEnvelope {
    readonly cacheVersion: number;
    readonly cacheEngineId: string;
    readonly scopeFingerprint: string;
    readonly engine: CfsMapEngine;
    readonly snapshot: WorkspaceGraphSnapshot;
}

interface CacheIndex {
    readonly cacheVersion: number;
    readonly cacheEngineId: string;
    readonly scopeFingerprint: string;
    readonly revision: string;
    readonly engine: CfsMapEngine;
}

interface RepositoryGraphState {
    status: WorkspaceGraphStatus;
    lastGoodSnapshot?: WorkspaceGraphSnapshot;
    refreshTail: Promise<void>;
    readonly refreshesByFingerprint: Map<string, Promise<WorkspaceGraphStatus>>;
}

class RepositoryHeadDriftError extends Error {
    constructor(
        readonly repositoryId: string,
        readonly currentRevisions: readonly WorkspaceGraphRepositoryRevision[]
    ) {
        super(`Repository ${repositoryId} HEAD changed while the workspace graph was being indexed; retry the refresh`);
    }
}

@injectable()
export class WorkspaceGraphServiceImpl implements BackendApplicationContribution {
    protected readonly clients = new Set<WorkspaceGraphClient>();
    protected readonly states = new Map<string, RepositoryGraphState>();
    protected readonly serviceInstanceId = randomUUID();

    constructor(
        @inject(StudioRuntimeConfigService) protected readonly runtimeConfig: StudioRuntimeConfigService,
        @inject(RepositoryRegistry) protected readonly repositoryRegistry: RepositoryRegistry,
        @inject(GitExecutor) protected readonly git: GitExecutor,
        @inject(CfsMapRunner) protected readonly mapRunner: CfsMapRunnerImpl
    ) {}

    async onStart(): Promise<void> {
        // Repository graph state is created lazily after a server-validated
        // repository scope is supplied. There is deliberately no all-workspace
        // graph state: federated workspaces can be too large to materialize.
    }

    addClient(client: WorkspaceGraphClient): void {
        this.clients.add(client);
    }

    removeClient(client: WorkspaceGraphClient): void {
        this.clients.delete(client);
    }

    setClient(client: WorkspaceGraphClient | undefined): void {
        if (client) {
            this.addClient(client);
        }
    }

    async getStatus(request: WorkspaceGraphScopeRequest): Promise<WorkspaceGraphStatus> {
        const repository = this.repositoryRegistry.requireRepository(request.repositoryId);
        return this.stateFor(repository.descriptor.repositoryId).status;
    }

    async getRepositoryRevisions(request: WorkspaceGraphScopeRequest): Promise<readonly WorkspaceGraphRepositoryRevision[]> {
        const repository = this.repositoryRegistry.requireRepository(request.repositoryId);
        const commitSha = await this.git.revParseHead(repository.canonicalRoot);
        if (!COMMIT_SHA_PATTERN.test(commitSha)) {
            throw new Error(`Repository ${repository.descriptor.repositoryId} returned an invalid HEAD revision`);
        }
        return [{
            repositoryId: repository.descriptor.repositoryId,
            commitSha: commitSha.toLowerCase()
        }];
    }

    async refresh(request: WorkspaceGraphRefreshRequest): Promise<WorkspaceGraphStatus> {
        const repository = this.repositoryRegistry.requireRepository(request.repositoryId);
        const repositoryCommits = await this.getRepositoryRevisions(request);
        return this.enqueueRefresh(repository.descriptor.repositoryId, repositoryCommits);
    }

    protected enqueueRefresh(
        repositoryId: string,
        repositoryCommits: readonly WorkspaceGraphRepositoryRevision[]
    ): Promise<WorkspaceGraphStatus> {
        const state = this.stateFor(repositoryId);
        const fingerprint = computeScopeFingerprint(repositoryCommits);
        const existing = state.refreshesByFingerprint.get(fingerprint);
        if (existing) {
            return existing;
        }

        const run = state.refreshTail
            .then(() => this.runRefresh(repositoryId, repositoryCommits))
            .finally(() => state.refreshesByFingerprint.delete(fingerprint));
        state.refreshesByFingerprint.set(fingerprint, run);
        state.refreshTail = run.then(() => undefined, () => undefined);
        return run;
    }

    async getSnapshot(request: WorkspaceGraphSnapshotRequest): Promise<WorkspaceGraphSnapshotResponse> {
        const repository = this.repositoryRegistry.requireRepository(request.repositoryId);
        const repositoryId = repository.descriptor.repositoryId;
        const state = this.stateFor(repositoryId);
        const repositoryCommits = await this.getRepositoryRevisions(request);
        if (state.status.state !== 'failed'
            && state.lastGoodSnapshot
            && sameRevisions(state.lastGoodSnapshot.repositories, repositoryCommits)) {
            if (request.knownRevision === state.lastGoodSnapshot.revision) {
                return { status: state.status, notModified: true };
            }
            return {
                status: state.status,
                snapshot: this.snapshotForCurrentStatus(state, state.lastGoodSnapshot),
                notModified: false
            };
        }

        const refreshed = await this.enqueueRefresh(repositoryId, repositoryCommits);
        const snapshot = state.lastGoodSnapshot
            && refreshed.state === 'ready'
            && refreshed.revision === state.lastGoodSnapshot.revision
            ? this.snapshotForCurrentStatus(state, state.lastGoodSnapshot)
            : state.lastGoodSnapshot && sameRevisions(state.lastGoodSnapshot.repositories, repositoryCommits)
                ? this.snapshotForCurrentStatus(state, state.lastGoodSnapshot)
            : state.lastGoodSnapshot && refreshed.stale
                ? snapshotWithStaleDiagnostic(state.lastGoodSnapshot)
                : undefined;
        // A stale diagnostic changes the response semantics without changing
        // the deterministic graph revision, so it must not be hidden behind a
        // revision-only not-modified response.
        if (snapshot && !snapshot.stale && request.knownRevision === snapshot.revision) {
            return { status: refreshed, notModified: true };
        }
        return { status: refreshed, snapshot, notModified: false };
    }

    async getDirtyOverlay(request: WorkspaceGraphScopeRequest): Promise<WorkspaceGraphDirtyOverlay> {
        const config = this.runtimeConfig.getConfig();
        const repository = this.repositoryRegistry.requireRepository(request.repositoryId);
        const files: WorkspaceGraphDirtyFile[] = [];
        const lines = await this.git.statusPorcelain(repository.canonicalRoot);
        for (let index = 0; index < lines.length; index += 1) {
            const line = lines[index];
            const statusCode = line.slice(0, 2);
            const rawPath = line.slice(3);
            if (!rawPath) {
                continue;
            }
            // `git status --porcelain=v1 -z` emits rename/copy records as
            // `XY <destination>\0<source>\0` (no textual ` -> ` delimiter).
            // The destination is the path represented by the dirty overlay;
            // consume the following source-path record so it is not parsed as
            // a second status record.
            if ((statusCode.includes('R') || statusCode.includes('C'))
                && index + 1 < lines.length) {
                index += 1;
            }
            files.push({
                repositoryId: repository.descriptor.repositoryId,
                repositoryRelativePath: rawPath,
                state: classifyDirtyState(statusCode)
            });
        }
        files.sort(compareDirtyFiles);
        return {
            workspaceId: config.workspaceId,
            revision: this.stateFor(repository.descriptor.repositoryId).status.revision ?? 'unindexed',
            files
        };
    }

    dispose(): void {
        this.clients.clear();
        this.states.clear();
    }

    protected async runRefresh(
        repositoryId: string,
        repositoryCommits: readonly WorkspaceGraphRepositoryRevision[],
        remainingHeadDriftRetries = 1
    ): Promise<WorkspaceGraphStatus> {
        const config = this.runtimeConfig.getConfig();
        const repository = this.repositoryRegistry.requireRepository(repositoryId);
        const state = this.stateFor(repositoryId);
        const scopeFingerprint = computeScopeFingerprint(repositoryCommits);
        const cachedLastGood = await this.readSnapshotForScope(scopeFingerprint, repositoryCommits);
        if (cachedLastGood) {
            state.lastGoodSnapshot = cachedLastGood;
        }
        this.updateStatus(state, {
            schemaVersion: GRAPH_SCHEMA_VERSION,
            serviceInstanceId: this.serviceInstanceId,
            workspaceId: config.workspaceId,
            repositoryId,
            state: 'indexing',
            revision: scopeFingerprint,
            sequence: state.status.sequence,
            stale: Boolean(state.lastGoodSnapshot)
        });

        try {
            await this.assertRepositoryRevisionsCurrent(repositoryId, repositoryCommits);
            const result = await this.mapRunner.run({
                workspaceRoot: config.workspaceRoot,
                repositoryRoot: repository.canonicalRoot,
                dataDir: config.dataDir
            });
            await this.assertRepositoryRevisionsCurrent(repositoryId, repositoryCommits);
            const revision = computeRevision(repositoryCommits, result.engine, result.payload);
            const adapted = await adaptCfsMap(result.payload, {
                workspaceId: config.workspaceId,
                revision,
                repositories: [repository],
                indexedAt: new Date().toISOString(),
                engine: result.engine
            });
            // A successful run is a fresh indexing event even when its graph
            // content hashes to an existing revision. Persist the newly adapted
            // snapshot so indexedAt/lastIndexedAt advance without changing the
            // deterministic graph revision.
            const snapshot = {
                ...adapted,
                repositories: sortRevisions(repositoryCommits)
            };
            await this.assertRepositoryRevisionsCurrent(repositoryId, repositoryCommits);
            await this.writeSnapshotToCache(
                snapshot,
                result.engine,
                scopeFingerprint,
                () => this.assertRepositoryRevisionsCurrent(repositoryId, repositoryCommits)
            );
            state.lastGoodSnapshot = snapshot;
            return this.updateStatus(state, {
                schemaVersion: GRAPH_SCHEMA_VERSION,
                serviceInstanceId: this.serviceInstanceId,
                workspaceId: config.workspaceId,
                repositoryId,
                state: 'ready',
                revision: snapshot.revision,
                lastIndexedAt: snapshot.indexedAt,
                sequence: state.status.sequence,
                stale: false
            });
        } catch (error) {
            if (error instanceof RepositoryHeadDriftError) {
                const currentFingerprint = computeScopeFingerprint(error.currentRevisions);
                if (state.lastGoodSnapshot
                    && sameRevisions(state.lastGoodSnapshot.repositories, error.currentRevisions)) {
                    return this.updateStatus(state, {
                        schemaVersion: GRAPH_SCHEMA_VERSION,
                        serviceInstanceId: this.serviceInstanceId,
                        workspaceId: config.workspaceId,
                        repositoryId,
                        state: 'ready',
                        revision: state.lastGoodSnapshot.revision,
                        lastIndexedAt: state.lastGoodSnapshot.indexedAt,
                        sequence: state.status.sequence,
                        stale: false
                    });
                }
                // If another caller already queued the actual current HEAD, let
                // that serialized refresh own recovery. Otherwise retry once in
                // this queue slot so A -> B -> A cannot finish on obsolete B.
                if (remainingHeadDriftRetries > 0
                    && !state.refreshesByFingerprint.has(currentFingerprint)) {
                    return this.runRefresh(repositoryId, error.currentRevisions, remainingHeadDriftRetries - 1);
                }
            }
            return this.updateStatus(state, {
                schemaVersion: GRAPH_SCHEMA_VERSION,
                serviceInstanceId: this.serviceInstanceId,
                workspaceId: config.workspaceId,
                repositoryId,
                state: 'failed',
                revision: state.lastGoodSnapshot?.revision ?? scopeFingerprint,
                lastIndexedAt: state.lastGoodSnapshot?.indexedAt,
                sequence: state.status.sequence,
                stale: Boolean(state.lastGoodSnapshot),
                errorMessage: error instanceof Error ? error.message : String(error)
            });
        }
    }

    protected async assertRepositoryRevisionsCurrent(
        repositoryId: string,
        expected: readonly WorkspaceGraphRepositoryRevision[]
    ): Promise<void> {
        const current = await this.getRepositoryRevisions({ repositoryId });
        if (!sameRevisions(current, expected)) {
            throw new RepositoryHeadDriftError(repositoryId, current);
        }
    }

    protected async cacheDirectory(): Promise<string> {
        const cacheDirectory = path.join(this.runtimeConfig.getConfig().dataDir, CACHE_DIR_NAME);
        await fs.mkdir(cacheDirectory, { recursive: true });
        return cacheDirectory;
    }

    protected async writeSnapshotToCache(
        snapshot: WorkspaceGraphSnapshot,
        engine: CfsMapEngine,
        scopeFingerprint: string,
        assertCurrent: () => Promise<void>
    ): Promise<void> {
        const cacheDirectory = await this.cacheDirectory();
        const target = path.join(cacheDirectory, `${snapshot.revision}.json`);
        const temporary = path.join(cacheDirectory, `${snapshot.revision}.${randomUUID()}.tmp`);
        const indexTarget = path.join(cacheDirectory, `${scopeFingerprint}.index.json`);
        const indexTemporary = path.join(cacheDirectory, `${scopeFingerprint}.${randomUUID()}.index.tmp`);
        const envelope: CacheEnvelope = {
            cacheVersion: CACHE_FORMAT_VERSION,
            cacheEngineId: CACHE_ENGINE_ID,
            scopeFingerprint,
            engine,
            snapshot
        };
        const index: CacheIndex = {
            cacheVersion: CACHE_FORMAT_VERSION,
            cacheEngineId: CACHE_ENGINE_ID,
            scopeFingerprint,
            revision: snapshot.revision,
            engine
        };
        const snapshotExisted = await isRegularFile(target);
        const previousIndex = await readBoundedRegularFile(indexTarget, MAX_CACHE_INDEX_FILE_BYTES);
        let snapshotPublished = false;
        let indexPublished = false;
        try {
            await fs.writeFile(temporary, JSON.stringify(envelope, null, 2), 'utf8');
            await fs.writeFile(indexTemporary, JSON.stringify(index, null, 2), 'utf8');
            await assertCurrent();
            await fs.rename(temporary, target);
            snapshotPublished = true;
            await assertCurrent();
            await fs.rename(indexTemporary, indexTarget);
            indexPublished = true;
            await assertCurrent();
        } catch (error) {
            if (indexPublished) {
                if (previousIndex === undefined) {
                    await removeBestEffort(indexTarget);
                } else {
                    const restoreTemporary = `${indexTarget}.${randomUUID()}.restore.tmp`;
                    try {
                        await fs.writeFile(restoreTemporary, previousIndex);
                        await fs.rename(restoreTemporary, indexTarget);
                    } catch {
                        // Never leave the just-published index in place when the
                        // previous valid index cannot be restored. Rollback is
                        // deliberately best-effort so its failures cannot mask
                        // the original HEAD-drift error and suppress retry.
                        await removeBestEffort(indexTarget);
                    } finally {
                        await removeBestEffort(restoreTemporary);
                    }
                }
            }
            if (snapshotPublished && !snapshotExisted) {
                await removeBestEffort(target);
            }
            throw error;
        } finally {
            // Cleanup failures are secondary to a publication/drift failure and
            // must not replace the error that drives current-HEAD retry.
            await removeBestEffort(temporary);
            await removeBestEffort(indexTemporary);
        }
    }

    protected async writeCacheIndex(
        scopeFingerprint: string,
        revision: string,
        engine: CfsMapEngine
    ): Promise<void> {
        const cacheDirectory = await this.cacheDirectory();
        const target = path.join(cacheDirectory, `${scopeFingerprint}.index.json`);
        const temporary = path.join(cacheDirectory, `${scopeFingerprint}.${randomUUID()}.index.tmp`);
        const index: CacheIndex = {
            cacheVersion: CACHE_FORMAT_VERSION,
            cacheEngineId: CACHE_ENGINE_ID,
            scopeFingerprint,
            revision,
            engine
        };
        try {
            await fs.writeFile(temporary, JSON.stringify(index, null, 2), 'utf8');
            await fs.rename(temporary, target);
        } finally {
            await fs.rm(temporary, { force: true });
        }
    }

    protected async readSnapshotFromCache(
        revision: string,
        engine: CfsMapEngine,
        expectedScopeFingerprint: string
    ): Promise<WorkspaceGraphSnapshot | undefined> {
        try {
            const cacheDirectory = await this.cacheDirectory();
            const envelope = await this.readCacheEnvelope(
                cacheDirectory,
                revision,
                expectedScopeFingerprint,
                engine
            );
            return envelope?.snapshot;
        } catch {
            // Cache is only a recovery optimization; unreadable or corrupt entries
            // must never prevent a fresh runner attempt.
            return undefined;
        }
    }

    protected async readSnapshotForScope(
        scopeFingerprint: string,
        repositoryCommits: readonly WorkspaceGraphRepositoryRevision[]
    ): Promise<WorkspaceGraphSnapshot | undefined> {
        try {
            const cacheDirectory = await this.cacheDirectory();
            const indexPath = path.join(cacheDirectory, `${scopeFingerprint}.index.json`);
            const indexStat = await fs.lstat(indexPath);
            if (!indexStat.isFile() || indexStat.size > MAX_CACHE_INDEX_FILE_BYTES) {
                return this.recoverSnapshotForScope(cacheDirectory, scopeFingerprint, repositoryCommits);
            }
            const raw = await fs.readFile(indexPath, 'utf8');
            const parsed = JSON.parse(raw) as Partial<CacheIndex>;
            if (parsed.cacheVersion !== CACHE_FORMAT_VERSION
                || parsed.cacheEngineId !== CACHE_ENGINE_ID
                || parsed.scopeFingerprint !== scopeFingerprint
                || !CACHE_REVISION_PATTERN.test(parsed.revision ?? '')
                || typeof parsed.engine?.command !== 'string'
                || typeof parsed.engine.version !== 'string') {
                return this.recoverSnapshotForScope(cacheDirectory, scopeFingerprint, repositoryCommits);
            }
            const snapshot = await this.readSnapshotFromCache(parsed.revision!, parsed.engine, scopeFingerprint);
            if (!snapshot
                || snapshot.workspaceId !== this.runtimeConfig.getConfig().workspaceId
                || !sameRevisions(snapshot.repositories, repositoryCommits)) {
                return this.recoverSnapshotForScope(cacheDirectory, scopeFingerprint, repositoryCommits);
            }
            return snapshot;
        } catch {
            const cacheDirectory = await this.cacheDirectory();
            return this.recoverSnapshotForScope(cacheDirectory, scopeFingerprint, repositoryCommits);
        }
    }

    protected async readCacheEnvelope(
        cacheDirectory: string,
        revision: string,
        expectedScopeFingerprint: string,
        expectedEngine?: CfsMapEngine
    ): Promise<CacheEnvelope | undefined> {
        if (!CACHE_REVISION_PATTERN.test(revision)) {
            return undefined;
        }
        const candidatePath = path.join(cacheDirectory, `${revision}.json`);
        const candidateStat = await fs.lstat(candidatePath);
        if (!candidateStat.isFile() || candidateStat.size > MAX_CACHE_FILE_BYTES) {
            return undefined;
        }
        const parsed = JSON.parse(await fs.readFile(candidatePath, 'utf8')) as unknown;
        if (!isCacheEnvelope(parsed, revision, expectedScopeFingerprint, expectedEngine)) {
            return undefined;
        }
        return parsed;
    }

    protected async recoverSnapshotForScope(
        cacheDirectory: string,
        scopeFingerprint: string,
        repositoryCommits: readonly WorkspaceGraphRepositoryRevision[]
    ): Promise<WorkspaceGraphSnapshot | undefined> {
        let directory;
        try {
            directory = await fs.opendir(cacheDirectory);
        } catch {
            return undefined;
        }

        let visitedEntries = 0;
        let candidateCount = 0;
        let newest: CacheEnvelope | undefined;
        try {
            while (visitedEntries < MAX_CACHE_DIRECTORY_ENTRIES
                && candidateCount < MAX_CACHE_RECOVERY_CANDIDATES) {
                const entry = await directory.read();
                if (!entry) {
                    break;
                }
                visitedEntries += 1;
                const match = entry.isFile() && CACHE_SNAPSHOT_FILE_PATTERN.exec(entry.name);
                if (!match) {
                    continue;
                }
                candidateCount += 1;
                try {
                    const candidate = await this.readCacheEnvelope(
                        cacheDirectory,
                        match[1],
                        scopeFingerprint
                    );
                    if (!candidate
                        || candidate.snapshot.workspaceId !== this.runtimeConfig.getConfig().workspaceId
                        || !sameRevisions(candidate.snapshot.repositories, repositoryCommits)) {
                        continue;
                    }
                    if (!newest || compareSnapshotFreshness(candidate.snapshot, newest.snapshot) > 0) {
                        newest = candidate;
                    }
                } catch {
                    // A malformed entry does not invalidate other recovery
                    // candidates in the bounded cache-directory scan.
                }
            }
        } finally {
            await directory.close().catch(() => undefined);
        }

        if (!newest) {
            return undefined;
        }
        try {
            await this.writeCacheIndex(scopeFingerprint, newest.snapshot.revision, newest.engine);
        } catch {
            // A cache-index repair failure must not discard an otherwise valid
            // last-good snapshot or prevent the fresh runner attempt.
        }
        return newest.snapshot;
    }

    protected snapshotForCurrentStatus(
        state: RepositoryGraphState,
        snapshot: WorkspaceGraphSnapshot
    ): WorkspaceGraphSnapshot {
        const stale = Boolean(state.status.stale);
        return stale
            ? snapshotWithStaleDiagnostic(snapshot)
            : snapshot.stale
                ? { ...snapshot, stale: false }
                : snapshot;
    }

    protected updateStatus(
        state: RepositoryGraphState,
        next: WorkspaceGraphStatus
    ): WorkspaceGraphStatus {
        const status = { ...next, sequence: state.status.sequence + 1 };
        state.status = status;
        for (const client of this.clients) {
            try {
                client.onWorkspaceGraphStatusChanged(status);
            } catch {
                // Ignore disconnected clients.
            }
        }
        return status;
    }

    protected stateFor(repositoryId: string): RepositoryGraphState {
        let state = this.states.get(repositoryId);
        if (!state) {
            state = {
                status: {
                    schemaVersion: GRAPH_SCHEMA_VERSION,
                    serviceInstanceId: this.serviceInstanceId,
                    workspaceId: this.runtimeConfig.getConfig().workspaceId,
                    repositoryId,
                    state: 'idle',
                    sequence: 0,
                    stale: false
                },
                refreshTail: Promise.resolve(),
                refreshesByFingerprint: new Map()
            };
            this.states.set(repositoryId, state);
        }
        return state;
    }
}

function computeScopeFingerprint(repositoryCommits: readonly WorkspaceGraphRepositoryRevision[]): string {
    const hash = createHash('sha256');
    hash.update(CACHE_ENGINE_ID);
    for (const entry of sortRevisions(repositoryCommits)) {
        hash.update('\0');
        hash.update(entry.repositoryId);
        hash.update('\0');
        hash.update(entry.commitSha);
    }
    return hash.digest('hex');
}

function computeRevision(
    repositoryCommits: readonly WorkspaceGraphRepositoryRevision[],
    engine: CfsMapEngine,
    payload: unknown
): string {
    const hash = createHash('sha256');
    hash.update(String(GRAPH_SCHEMA_VERSION));
    hash.update('\0');
    hash.update(CACHE_ENGINE_ID);
    hash.update('\0');
    hash.update(engine.command);
    hash.update('\0');
    hash.update(engine.version);
    hash.update('\0');
    hash.update(computePayloadFingerprint(payload));
    for (const entry of sortRevisions(repositoryCommits)) {
        hash.update('\0');
        hash.update(entry.repositoryId);
        hash.update('\0');
        hash.update(entry.commitSha);
    }
    return hash.digest('hex');
}

function computePayloadFingerprint(payload: unknown): string {
    if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) {
        return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
    }
    const stablePayload = { ...(payload as Record<string, unknown>) };
    delete stablePayload.generated_at;
    return createHash('sha256').update(JSON.stringify(stablePayload)).digest('hex');
}

function sortRevisions(
    revisions: readonly WorkspaceGraphRepositoryRevision[]
): WorkspaceGraphRepositoryRevision[] {
    return [...revisions].sort((left, right) =>
        left.repositoryId.localeCompare(right.repositoryId)
            || left.commitSha.localeCompare(right.commitSha)
    );
}

function sameRevisions(
    left: readonly WorkspaceGraphRepositoryRevision[],
    right: readonly WorkspaceGraphRepositoryRevision[]
): boolean {
    const sortedLeft = sortRevisions(left);
    const sortedRight = sortRevisions(right);
    return sortedLeft.length === sortedRight.length
        && sortedLeft.every((entry, index) =>
            entry.repositoryId === sortedRight[index].repositoryId
                && entry.commitSha === sortedRight[index].commitSha
        );
}

function isRepositoryRevisionList(value: unknown): value is readonly WorkspaceGraphRepositoryRevision[] {
    return Array.isArray(value) && value.every(entry =>
        isRecord(entry)
            && isNonEmptyString(entry.repositoryId)
            && COMMIT_SHA_PATTERN.test((entry as Partial<WorkspaceGraphRepositoryRevision>).commitSha ?? '')
    );
}

function isCacheEnvelope(
    value: unknown,
    expectedRevision: string,
    expectedScopeFingerprint: string,
    expectedEngine?: CfsMapEngine
): value is CacheEnvelope {
    if (!isRecord(value)
        || value.cacheVersion !== CACHE_FORMAT_VERSION
        || value.cacheEngineId !== CACHE_ENGINE_ID
        || value.scopeFingerprint !== expectedScopeFingerprint
        || !isCfsMapEngine(value.engine)
        || (expectedEngine !== undefined
            && (value.engine.command !== expectedEngine.command || value.engine.version !== expectedEngine.version))
        || !isWorkspaceGraphSnapshot(value.snapshot, expectedRevision)) {
        return false;
    }
    return computeScopeFingerprint(value.snapshot.repositories) === expectedScopeFingerprint;
}

function isWorkspaceGraphSnapshot(value: unknown, expectedRevision: string): value is WorkspaceGraphSnapshot {
    if (!isRecord(value)
        || value.schemaVersion !== GRAPH_SCHEMA_VERSION
        || value.mapVersion !== CFS_MAP_SCHEMA_VERSION
        || !isNonEmptyString(value.workspaceId)
        || value.revision !== expectedRevision
        || !CACHE_REVISION_PATTERN.test(value.revision)
        || !isRepositoryRevisionList(value.repositories)
        || !isNonEmptyString(value.primarySource)
        || !Array.isArray(value.sources)
        || !Array.isArray(value.nodes)
        || !Array.isArray(value.edges)
        || !Array.isArray(value.danglingCptUses)
        || !isRecord(value.categories)
        || !isRecord(value.bucketRects)
        || !isRecord(value.categoryBands)
        || !Array.isArray(value.diagnostics)
        || !isIsoTimestamp(value.indexedAt)
        || typeof value.stale !== 'boolean') {
        return false;
    }

    const repositoryIds = new Set<string>();
    for (const repository of value.repositories) {
        if (repositoryIds.has(repository.repositoryId)) {
            return false;
        }
        repositoryIds.add(repository.repositoryId);
    }

    const sourceNames = new Set<string>();
    for (const source of value.sources) {
        if (!isWorkspaceGraphSource(source) || sourceNames.has(source.name)) {
            return false;
        }
        sourceNames.add(source.name);
    }
    if (!sourceNames.has(value.primarySource)) {
        return false;
    }

    const nodeIds = new Set<string>();
    const categoryCounts = new Map<string, number>();
    const categoryOriginCounts = new Map<string, Map<string, number>>();
    const snapshotWorkspaceId = value.workspaceId;
    for (const node of value.nodes) {
        if (!isWorkspaceGraphNode(node, snapshotWorkspaceId, repositoryIds, sourceNames)
            || nodeIds.has(node.id)) {
            return false;
        }
        nodeIds.add(node.id);
        categoryCounts.set(node.category, (categoryCounts.get(node.category) ?? 0) + 1);
        let origins = categoryOriginCounts.get(node.category);
        if (!origins) {
            origins = new Map<string, number>();
            categoryOriginCounts.set(node.category, origins);
        }
        origins.set(node.categoryOrigin, (origins.get(node.categoryOrigin) ?? 0) + 1);
    }

    const edgeIds = new Set<string>();
    for (const edge of value.edges) {
        if (!isWorkspaceGraphEdge(edge)
            || edgeIds.has(edge.id)
            || !nodeIds.has(edge.from)
            || !nodeIds.has(edge.to)) {
            return false;
        }
        edgeIds.add(edge.id);
    }

    if (!value.danglingCptUses.every(use =>
        isWorkspaceGraphDanglingCptUse(use) && nodeIds.has(use.nodeId)
    )) {
        return false;
    }

    if (!Object.values(value.categories).every(isWorkspaceGraphCategory)
        || !Object.entries(value.bucketRects as Record<string, unknown>).every(([key, rect]) =>
            isWorkspaceGraphBucketRect(rect) && rect.id === key
        )
        || !Object.values(value.categoryBands).every(isWorkspaceGraphCategoryBand)) {
        return false;
    }
    const categoryNames = new Set(Object.keys(value.categories));
    if ([...categoryCounts.keys()].some(category => !categoryNames.has(category))) {
        return false;
    }
    for (const [categoryName, categoryValue] of Object.entries(value.categories as Record<string, unknown>)) {
        const category = categoryValue as WorkspaceGraphSnapshot['categories'][string];
        if (category.nodeCount !== (categoryCounts.get(categoryName) ?? 0)) {
            return false;
        }
        const actualOrigins = categoryOriginCounts.get(categoryName) ?? new Map<string, number>();
        for (const origin of GRAPH_CATEGORY_ORIGINS) {
            if ((category.originCounts[origin as keyof typeof category.originCounts] ?? 0)
                !== (actualOrigins.get(origin) ?? 0)) {
                return false;
            }
        }
    }

    const diagnosticIds = new Set<string>();
    for (const diagnostic of value.diagnostics) {
        if (!isWorkspaceGraphDiagnostic(diagnostic, snapshotWorkspaceId, repositoryIds)
            || diagnosticIds.has(diagnostic.id)
            || (diagnostic.relatedNodeId !== undefined && !nodeIds.has(diagnostic.relatedNodeId))) {
            return false;
        }
        diagnosticIds.add(diagnostic.id);
    }
    return true;
}

function isWorkspaceGraphSource(value: unknown): value is WorkspaceGraphSnapshot['sources'][number] {
    return isRecord(value)
        && isNonEmptyString(value.name)
        && typeof value.path === 'string'
        && typeof value.reachable === 'boolean'
        && typeof value.role === 'string'
        && GRAPH_SOURCE_ROLES.has(value.role);
}

function isWorkspaceGraphNode(
    value: unknown,
    workspaceId: string,
    repositoryIds: ReadonlySet<string>,
    sourceNames: ReadonlySet<string>
): value is WorkspaceGraphSnapshot['nodes'][number] {
    return isRecord(value)
        && isNonEmptyString(value.id)
        && isNullableString(value.relPath)
        && isNullableString(value.source)
        && (value.source === null || sourceNames.has(value.source))
        && typeof value.kind === 'string'
        && GRAPH_NODE_KINDS.has(value.kind)
        && isNullableString(value.language)
        && typeof value.category === 'string'
        && typeof value.categoryOrigin === 'string'
        && GRAPH_CATEGORY_ORIGINS.has(value.categoryOrigin)
        && isNullableString(value.content)
        && isNonNegativeInteger(value.loc)
        && isStringArray(value.cptDefs)
        && Array.isArray(value.cptUses)
        && value.cptUses.every(isWorkspaceGraphCptUse)
        && typeof value.label === 'string'
        && isWorkspaceGraphLocation(value.location, workspaceId, repositoryIds)
        // `position` is optional in the coordinated model update. When older
        // or current snapshots include it, validate the complete nested shape.
        && (value.position === undefined || isWorkspaceGraphPosition(value.position));
}

function isWorkspaceGraphCptUse(value: unknown): boolean {
    return isRecord(value)
        && isNonEmptyString(value.cptId)
        && isNonNegativeInteger(value.line)
        && typeof value.snippet === 'string'
        && typeof value.markerKind === 'string'
        && GRAPH_MARKER_KINDS.has(value.markerKind);
}

function isWorkspaceGraphPosition(value: unknown): boolean {
    return isRecord(value) && isFiniteNumber(value.x) && isFiniteNumber(value.y);
}

function isWorkspaceGraphLocation(
    value: unknown,
    workspaceId: string,
    repositoryIds: ReadonlySet<string>
): boolean {
    return isRecord(value)
        && value.workspaceId === workspaceId
        && isNonEmptyString(value.repositoryId)
        && repositoryIds.has(value.repositoryId)
        && typeof value.repositoryRelativePath === 'string';
}

function isWorkspaceGraphEdge(value: unknown): boolean {
    return isRecord(value)
        && isNonEmptyString(value.id)
        && isNonEmptyString(value.from)
        && isNonEmptyString(value.to)
        && typeof value.type === 'string'
        && GRAPH_EDGE_KINDS.has(value.type)
        && Array.isArray(value.refs)
        && value.refs.every(isWorkspaceGraphEdgeRef)
        && typeof value.crossRepo === 'boolean'
        && typeof value.dangling === 'boolean';
}

function isWorkspaceGraphEdgeRef(value: unknown): boolean {
    return isRecord(value)
        && isNullableString(value.cptId)
        && isNonNegativeInteger(value.line)
        && typeof value.snippet === 'string'
        && (value.defLine === null || isNonNegativeInteger(value.defLine))
        && isNullableString(value.defSnippet);
}

function isWorkspaceGraphDanglingCptUse(value: unknown): boolean {
    return isRecord(value)
        && isNonEmptyString(value.cptId)
        && isNonEmptyString(value.nodeId)
        && isNonNegativeInteger(value.line)
        && typeof value.snippet === 'string';
}

function isWorkspaceGraphCategory(value: unknown): boolean {
    return isRecord(value)
        && isNonNegativeInteger(value.nodeCount)
        && isRecord(value.originCounts)
        && Object.entries(value.originCounts).every(([key, count]) =>
            GRAPH_CATEGORY_ORIGINS.has(key) && isNonNegativeInteger(count)
        )
        && isRecord(value.style)
        && typeof value.style.color === 'string'
        && typeof value.style.background === 'string';
}

function isWorkspaceGraphBucketRect(value: unknown): value is WorkspaceGraphSnapshot['bucketRects'][string] {
    return isRecord(value)
        && isNonEmptyString(value.id)
        && isFiniteNumber(value.x)
        && isFiniteNumber(value.y)
        && isFiniteNumber(value.w)
        && isFiniteNumber(value.h)
        && typeof value.label === 'string';
}

function isWorkspaceGraphCategoryBand(value: unknown): boolean {
    return isRecord(value)
        && isFiniteNumber(value.x)
        && isFiniteNumber(value.y)
        && isFiniteNumber(value.w)
        && isFiniteNumber(value.h)
        && typeof value.label === 'string'
        && isOptionalString(value.fill)
        && isOptionalString(value.stroke)
        && isOptionalString(value.titleColor);
}

function isWorkspaceGraphDiagnostic(
    value: unknown,
    workspaceId: string,
    repositoryIds: ReadonlySet<string>
): boolean {
    return isRecord(value)
        && isNonEmptyString(value.id)
        && typeof value.code === 'string'
        && GRAPH_DIAGNOSTIC_CODES.has(value.code)
        && (value.severity === 'warning' || value.severity === 'error')
        && typeof value.message === 'string'
        && (value.location === undefined
            || isWorkspaceGraphLocation(value.location, workspaceId, repositoryIds))
        && isOptionalString(value.relatedNodeId);
}

function isCfsMapEngine(value: unknown): value is CfsMapEngine {
    return isRecord(value)
        && isNonEmptyString(value.command)
        && isNonEmptyString(value.version);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0;
}

function isNullableString(value: unknown): value is string | null {
    return value === null || typeof value === 'string';
}

function isOptionalString(value: unknown): value is string | undefined {
    return value === undefined || typeof value === 'string';
}

function isStringArray(value: unknown): value is readonly string[] {
    return Array.isArray(value) && value.every(entry => typeof entry === 'string');
}

function isFiniteNumber(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}

function isNonNegativeInteger(value: unknown): value is number {
    return Number.isInteger(value) && (value as number) >= 0;
}

function isIsoTimestamp(value: unknown): value is string {
    return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

async function isRegularFile(filePath: string): Promise<boolean> {
    try {
        return (await fs.lstat(filePath)).isFile();
    } catch {
        return false;
    }
}

async function readBoundedRegularFile(filePath: string, maxBytes: number): Promise<Buffer | undefined> {
    try {
        const stat = await fs.lstat(filePath);
        if (!stat.isFile() || stat.size > maxBytes) {
            return undefined;
        }
        return fs.readFile(filePath);
    } catch {
        return undefined;
    }
}

async function removeBestEffort(filePath: string): Promise<void> {
    try {
        await fs.rm(filePath, { force: true });
    } catch {
        // Cache rollback/temporary cleanup is compensating work. The caller's
        // original error remains authoritative even if the filesystem refuses
        // an individual cleanup step.
    }
}

function compareSnapshotFreshness(left: WorkspaceGraphSnapshot, right: WorkspaceGraphSnapshot): number {
    return Date.parse(left.indexedAt) - Date.parse(right.indexedAt)
        || left.revision.localeCompare(right.revision);
}

const STALE_REFRESH_DIAGNOSTIC: WorkspaceGraphDiagnostic = {
    id: 'workspace-graph-refresh-failed',
    code: 'map-failed',
    severity: 'warning',
    message: 'Workspace graph refresh failed; showing the last successfully indexed graph.'
};

function snapshotWithStaleDiagnostic(snapshot: WorkspaceGraphSnapshot): WorkspaceGraphSnapshot {
    return {
        ...snapshot,
        stale: true,
        diagnostics: [
            ...snapshot.diagnostics.filter(diagnostic => diagnostic.id !== STALE_REFRESH_DIAGNOSTIC.id),
            STALE_REFRESH_DIAGNOSTIC
        ]
    };
}

function classifyDirtyState(statusCode: string): WorkspaceGraphDirtyFile['state'] {
    if (statusCode.includes('?')) {
        return 'untracked';
    }
    if (statusCode.includes('A')) {
        return 'added';
    }
    if (statusCode.includes('D')) {
        return 'deleted';
    }
    if (statusCode.includes('R')) {
        return 'renamed';
    }
    if (statusCode.includes('C')) {
        return 'copied';
    }
    if (statusCode.includes('M')) {
        return 'modified';
    }
    return 'unknown';
}

function compareDirtyFiles(left: WorkspaceGraphDirtyFile, right: WorkspaceGraphDirtyFile): number {
    return left.repositoryId.localeCompare(right.repositoryId)
        || left.repositoryRelativePath.localeCompare(right.repositoryRelativePath)
        || left.state.localeCompare(right.state);
}
