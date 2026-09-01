import * as fs from 'fs/promises';
import * as path from 'path';
import { Disposable, Emitter, Event } from '@theia/core/lib/common';
import {
    type WorkspaceConfiguredSource,
    type WorkspaceDiagnostic,
    type WorkspaceObservedSourceState,
    type WorkspaceSourceProvider,
    type WorkspaceSourceStatus,
    type WorkspaceSourceSyncEligibility
} from '../common/workspace-protocol';
import {
    type NativeWorkspaceConfigData,
    type WorkspaceConfigLoadResult
} from './workspace-config-service';
import { type RepositoryRegistration } from './repository-registry';
import { resolveRemoteCheckoutRelativePath } from '../common/git-remote-reference';

export interface WorkspaceSourceObservation extends WorkspaceObservedSourceState {
    readonly observedAt: string;
}

export interface WorkspaceSourceSnapshot {
    readonly observedAt: string;
    readonly configPath: string;
    readonly revision?: string;
    readonly configuredSources: readonly WorkspaceConfiguredSource[];
    readonly observedSources: readonly WorkspaceSourceObservation[];
    readonly diagnostics: readonly WorkspaceDiagnostic[];
}

export interface WorkspaceSourceRepositoryRegistration extends RepositoryRegistration {
    readonly sourceId: string;
}

interface ResolvedWorkspaceSource {
    readonly sourceId: string;
    readonly configuredSource: WorkspaceConfiguredSource;
    readonly intendedLocalPath: string;
    readonly canonicalRoot?: string;
    readonly lexicallyWithinWorkspaceRoot: boolean;
    readonly status: WorkspaceSourceStatus;
    readonly syncEligibility: WorkspaceSourceSyncEligibility;
    readonly diagnostics: readonly WorkspaceDiagnostic[];
}

interface ReconcileContext {
    readonly workspaceRoot: string;
    readonly configPath: string;
    readonly revision?: string;
    readonly observedAt: string;
    readonly config: NativeWorkspaceConfigData;
}

interface PathObservation {
    readonly intendedLocalPath: string;
    readonly canonicalRoot?: string;
    readonly exists: boolean;
    readonly lexicallyWithinWorkspaceRoot: boolean;
    readonly diagnostics: readonly WorkspaceDiagnostic[];
    readonly blockedReason?: string;
}

export class WorkspaceSourceRegistry implements Disposable {
    protected readonly onDidChangeSnapshotEmitter = new Emitter<WorkspaceSourceSnapshot>();
    protected snapshot: WorkspaceSourceSnapshot = freezeSnapshot({
        observedAt: new Date(0).toISOString(),
        configPath: '',
        configuredSources: [],
        observedSources: [],
        diagnostics: []
    });
    protected snapshotShapeKey = JSON.stringify({
        configPath: '',
        revision: undefined,
        configuredSources: [],
        observedSources: [],
        diagnostics: []
    });
    protected resolvedSources: readonly ResolvedWorkspaceSource[] = [];

    readonly onDidChangeSnapshot: Event<WorkspaceSourceSnapshot> = this.onDidChangeSnapshotEmitter.event;

    get currentSnapshot(): WorkspaceSourceSnapshot {
        return this.snapshot;
    }

    async reconcile(loadResult: WorkspaceConfigLoadResult, observedAt: string): Promise<WorkspaceSourceSnapshot> {
        if (loadResult.state !== 'valid' || !loadResult.parsedData) {
            throw new Error('Workspace source registry requires a valid canonical workspace config');
        }

        const workspaceRoot = await fs.realpath(path.dirname(loadResult.configPath));
        const context: ReconcileContext = {
            workspaceRoot,
            configPath: loadResult.configPath,
            revision: loadResult.revision,
            observedAt,
            config: loadResult.parsedData
        };

        const normalized = await Promise.all(
            Object.entries(loadResult.parsedData.sources)
                .sort(([left], [right]) => left.localeCompare(right))
                .map(([sourceId, source]) => this.normalizeConfiguredSource(context, sourceId, source))
        );
        const duplicateSourceIds = collectDuplicateSourceIds(normalized);
        const nestedSourceIds = collectNestedSourceIds(normalized);
        this.resolvedSources = normalized.map(source => finalizeResolvedSource(source, duplicateSourceIds, nestedSourceIds));

        const configuredSources = this.resolvedSources.map(source => source.configuredSource);
        const observedSources = this.resolvedSources.map(source =>
            freezeObservation({
                sourceId: source.sourceId,
                observedAt,
                status: source.status,
                syncEligibility: source.syncEligibility,
                isPresent: source.status !== 'missing' && source.status !== 'blocked',
                isDirty: false,
                isDiverged: false,
                isNested: source.status === 'nested',
                hasBlockingIssue: source.status === 'blocked' || source.status === 'duplicate',
                blockedReason: source.status === 'blocked'
                    ? source.diagnostics.find(diagnostic => diagnostic.severity === 'error')?.message
                    : undefined
            })
        );
        const diagnostics = freezeDiagnostics(
            this.resolvedSources.flatMap(source => source.diagnostics)
        );
        const nextSnapshot = freezeSnapshot({
            observedAt,
            configPath: loadResult.configPath,
            revision: loadResult.revision,
            configuredSources,
            observedSources,
            diagnostics
        });

        const nextShapeKey = JSON.stringify({
            configPath: nextSnapshot.configPath,
            revision: nextSnapshot.revision,
            configuredSources: nextSnapshot.configuredSources,
            observedSources: nextSnapshot.observedSources.map(({ observedAt: ignored, ...state }) => state),
            diagnostics: nextSnapshot.diagnostics
        });
        this.snapshot = nextSnapshot;
        if (nextShapeKey !== this.snapshotShapeKey) {
            this.snapshotShapeKey = nextShapeKey;
            this.onDidChangeSnapshotEmitter.fire(this.snapshot);
        }
        return this.snapshot;
    }

    async projectRepositories(): Promise<readonly WorkspaceSourceRepositoryRegistration[]> {
        const seenRoots = new Set<string>();
        const registrations: WorkspaceSourceRepositoryRegistration[] = [];

        for (const source of this.resolvedSources) {
            if (!source.canonicalRoot) {
                continue;
            }
            if (source.status === 'missing' || source.status === 'blocked' || source.status === 'duplicate') {
                continue;
            }
            const comparisonKey = normalizeForComparison(source.canonicalRoot);
            if (seenRoots.has(comparisonKey)) {
                continue;
            }
            const gitMetadata = await discoverGitMetadata(source.canonicalRoot);
            if (!gitMetadata) {
                continue;
            }
            seenRoots.add(comparisonKey);
            registrations.push(Object.freeze({
                sourceId: source.sourceId,
                repositoryRoot: source.canonicalRoot,
                gitDirectory: gitMetadata.gitDirectory,
                commonDirectory: gitMetadata.commonDirectory
            }));
        }

        return Object.freeze(registrations);
    }

    dispose(): void {
        this.resolvedSources = [];
        this.onDidChangeSnapshotEmitter.dispose();
    }

    protected async normalizeConfiguredSource(
        context: ReconcileContext,
        sourceId: string,
        source: NativeWorkspaceConfigData['sources'][string]
    ): Promise<ResolvedWorkspaceSource> {
        const { localPath, remoteUrl, provider, defaultBranch } = resolveSourceReference(
            context.workspaceRoot,
            context.config,
            sourceId,
            source
        );
        const observation = await observeSourcePath(context, sourceId, localPath, source.path !== undefined);
        const configuredSource: WorkspaceConfiguredSource = freezeConfiguredSource({
            configured: true,
            authoritative: true,
            include: 'member',
            sourceId,
            label: sourceId,
            localPath,
            remoteUrl,
            provider,
            ref: defaultBranch,
            defaultBranch
        });

        return {
            sourceId,
            configuredSource,
            intendedLocalPath: observation.intendedLocalPath,
            canonicalRoot: observation.canonicalRoot,
            lexicallyWithinWorkspaceRoot: observation.lexicallyWithinWorkspaceRoot,
            status: observation.blockedReason
                ? 'blocked'
                : observation.exists
                    ? 'present'
                    : 'missing',
            syncEligibility: observation.blockedReason
                ? 'blocked'
                : observation.exists
                    ? remoteUrl ? 'safe' : 'not-configured'
                    : remoteUrl ? 'requires-trust' : 'not-configured',
            diagnostics: observation.diagnostics
        };
    }
}

function resolveSourceReference(
    workspaceRoot: string,
    config: NativeWorkspaceConfigData,
    sourceId: string,
    source: NativeWorkspaceConfigData['sources'][string]
): {
    localPath: string;
    remoteUrl?: string;
    provider: WorkspaceSourceProvider;
    defaultBranch?: string;
} {
    if (source.path) {
        return {
            localPath: normalizeAbsolutePath(path.resolve(workspaceRoot, source.path)),
            remoteUrl: source.url,
            provider: source.url ? detectProvider(source.url) : 'local',
            defaultBranch: source.branch
        };
    }

    const resolveWorkdir = config.resolve?.workdir?.trim() || '.workspace-sources';
    const resolveRoot = normalizeAbsolutePath(path.resolve(workspaceRoot, resolveWorkdir));
    if (path.isAbsolute(resolveWorkdir) || !isWithin(workspaceRoot, resolveRoot)) {
        throw new Error('Workspace resolve.workdir must be relative and stay within the workspace root');
    }
    const relativeCheckoutPath = resolveRemoteCheckoutRelativePath(
        source.url!,
        sourceId,
        config.resolve?.namespace
    );
    const localPath = normalizeAbsolutePath(path.resolve(resolveRoot, relativeCheckoutPath));
    if (!isWithin(resolveRoot, localPath)) {
        throw new Error(`Resolved source destination escapes the configured resolve.workdir for ${sourceId}`);
    }
    return {
        localPath,
        remoteUrl: source.url,
        provider: detectProvider(source.url),
        defaultBranch: source.branch
    };
}

async function observeSourcePath(
    context: ReconcileContext,
    sourceId: string,
    intendedLocalPath: string,
    isExplicitPathSource: boolean
): Promise<PathObservation> {
    const lexicallyWithinWorkspaceRoot = isWithin(context.workspaceRoot, intendedLocalPath);
    const diagnostics: WorkspaceDiagnostic[] = [];
    if (isExplicitPathSource && !lexicallyWithinWorkspaceRoot) {
        diagnostics.push(createSourceDiagnostic(
            'workspace.source.external_path',
            'warning',
            `Configured source "${sourceId}" resolves outside the workspace root.`,
            sourceId,
            intendedLocalPath
        ));
    }

    const stat = await statIfExists(intendedLocalPath);
    if (!stat) {
        diagnostics.push(createSourceDiagnostic(
            'workspace.source.missing',
            'warning',
            `Configured source "${sourceId}" is missing at ${intendedLocalPath}.`,
            sourceId,
            intendedLocalPath
        ));
        return {
            intendedLocalPath,
            exists: false,
            lexicallyWithinWorkspaceRoot,
            diagnostics
        };
    }
    if (!stat.isDirectory()) {
        diagnostics.push(createSourceDiagnostic(
            'workspace.source.invalid_root',
            'error',
            `Configured source "${sourceId}" must resolve to a directory.`,
            sourceId,
            intendedLocalPath
        ));
        return {
            intendedLocalPath,
            exists: true,
            lexicallyWithinWorkspaceRoot,
            diagnostics,
            blockedReason: 'invalid-root'
        };
    }

    const canonicalRoot = normalizeAbsolutePath(await fs.realpath(intendedLocalPath));
    if (lexicallyWithinWorkspaceRoot && !isWithin(context.workspaceRoot, canonicalRoot)) {
        diagnostics.push(createSourceDiagnostic(
            'workspace.source.symlink_escape',
            'error',
            `Configured source "${sourceId}" escapes the workspace root through a symlinked path.`,
            sourceId,
            intendedLocalPath
        ));
        return {
            intendedLocalPath,
            canonicalRoot,
            exists: true,
            lexicallyWithinWorkspaceRoot,
            diagnostics,
            blockedReason: 'symlink-escape'
        };
    }

    return {
        intendedLocalPath,
        canonicalRoot,
        exists: true,
        lexicallyWithinWorkspaceRoot,
        diagnostics
    };
}

function finalizeResolvedSource(
    source: ResolvedWorkspaceSource,
    duplicateSourceIds: ReadonlySet<string>,
    nestedSourceIds: ReadonlySet<string>
): ResolvedWorkspaceSource {
    const diagnostics = [...source.diagnostics];
    let status = source.status;
    let syncEligibility = source.syncEligibility;

    if (status !== 'blocked' && duplicateSourceIds.has(source.sourceId)) {
        status = 'duplicate';
        syncEligibility = 'blocked';
        diagnostics.push(createSourceDiagnostic(
            'workspace.source.duplicate_root',
            'error',
            `Configured source "${source.sourceId}" shares a root with another configured source.`,
            source.sourceId,
            source.configuredSource.localPath
        ));
    } else if (status !== 'blocked' && nestedSourceIds.has(source.sourceId) && status !== 'missing') {
        status = 'nested';
        diagnostics.push(createSourceDiagnostic(
            'workspace.source.nested_root',
            'warning',
            `Configured source "${source.sourceId}" is nested inside another configured source.`,
            source.sourceId,
            source.configuredSource.localPath
        ));
    }

    return {
        ...source,
        status,
        syncEligibility,
        diagnostics: freezeDiagnostics(diagnostics)
    };
}

function collectDuplicateSourceIds(sources: readonly ResolvedWorkspaceSource[]): ReadonlySet<string> {
    const duplicateIds = new Set<string>();
    const intendedOwners = new Map<string, string>();
    const canonicalOwners = new Map<string, string>();

    for (const source of sources) {
        const intendedKey = normalizeForComparison(source.intendedLocalPath);
        const existingIntendedOwner = intendedOwners.get(intendedKey);
        if (existingIntendedOwner) {
            duplicateIds.add(existingIntendedOwner);
            duplicateIds.add(source.sourceId);
        } else {
            intendedOwners.set(intendedKey, source.sourceId);
        }

        if (!source.canonicalRoot) {
            continue;
        }
        const canonicalKey = normalizeForComparison(source.canonicalRoot);
        const existingCanonicalOwner = canonicalOwners.get(canonicalKey);
        if (existingCanonicalOwner) {
            duplicateIds.add(existingCanonicalOwner);
            duplicateIds.add(source.sourceId);
        } else {
            canonicalOwners.set(canonicalKey, source.sourceId);
        }
    }

    return duplicateIds;
}

function collectNestedSourceIds(sources: readonly ResolvedWorkspaceSource[]): ReadonlySet<string> {
    const nested = new Set<string>();
    for (let index = 0; index < sources.length; index += 1) {
        const left = sources[index];
        const leftRoot = left.canonicalRoot ?? left.intendedLocalPath;
        for (let otherIndex = index + 1; otherIndex < sources.length; otherIndex += 1) {
            const right = sources[otherIndex];
            const rightRoot = right.canonicalRoot ?? right.intendedLocalPath;
            if (samePath(leftRoot, rightRoot)) {
                continue;
            }
            if (isWithin(leftRoot, rightRoot) || isWithin(rightRoot, leftRoot)) {
                nested.add(left.sourceId);
                nested.add(right.sourceId);
            }
        }
    }
    return nested;
}

async function discoverGitMetadata(repositoryRoot: string): Promise<Pick<RepositoryRegistration, 'gitDirectory' | 'commonDirectory'> | undefined> {
    const gitMarker = path.join(repositoryRoot, '.git');
    const stat = await statIfExists(gitMarker);
    if (!stat) {
        return undefined;
    }
    if (stat.isDirectory()) {
        const gitDirectory = normalizeAbsolutePath(await fs.realpath(gitMarker));
        return {
            gitDirectory,
            commonDirectory: await resolveCommonDirectory(gitDirectory)
        };
    }
    if (!stat.isFile()) {
        return undefined;
    }

    const rawMarker = await fs.readFile(gitMarker, 'utf8');
    const gitdirLine = rawMarker.split(/\r?\n/u).find(line => line.startsWith('gitdir:'));
    if (!gitdirLine) {
        return undefined;
    }
    const rawGitDirectory = gitdirLine.slice('gitdir:'.length).trim();
    if (!rawGitDirectory) {
        return undefined;
    }
    const resolvedGitDirectory = normalizeAbsolutePath(path.resolve(repositoryRoot, rawGitDirectory));
    const gitDirectoryStat = await statIfExists(resolvedGitDirectory);
    if (!gitDirectoryStat?.isDirectory()) {
        return undefined;
    }
    const gitDirectory = normalizeAbsolutePath(await fs.realpath(resolvedGitDirectory));
    return {
        gitDirectory,
        commonDirectory: await resolveCommonDirectory(gitDirectory)
    };
}

async function resolveCommonDirectory(gitDirectory: string): Promise<string> {
    const commondirPath = path.join(gitDirectory, 'commondir');
    const stat = await statIfExists(commondirPath);
    if (!stat?.isFile()) {
        return gitDirectory;
    }
    const rawCommonDir = (await fs.readFile(commondirPath, 'utf8')).trim();
    if (!rawCommonDir) {
        return gitDirectory;
    }
    return normalizeAbsolutePath(await fs.realpath(path.resolve(gitDirectory, rawCommonDir)));
}

async function statIfExists(candidate: string): Promise<Awaited<ReturnType<typeof fs.stat>> | undefined> {
    try {
        return await fs.stat(candidate);
    } catch (error) {
        if (isMissingFileError(error)) {
            return undefined;
        }
        throw error;
    }
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
    return typeof error === 'object'
        && error !== null
        && 'code' in error
        && (error as NodeJS.ErrnoException).code === 'ENOENT';
}

function detectProvider(remoteUrl: string | undefined): WorkspaceSourceProvider {
    if (!remoteUrl) {
        return 'generic-git';
    }
    const normalized = remoteUrl.trim().toLowerCase();
    const host = extractRemoteHost(normalized);
    if (!host) {
        return 'generic-git';
    }
    if (host.includes('github')) {
        return 'github';
    }
    if (host.includes('gitlab')) {
        return 'gitlab';
    }
    if (host.includes('bitbucket')) {
        return 'bitbucket';
    }
    if (host.includes('azure') || host.includes('visualstudio')) {
        return 'azure-devops';
    }
    return 'generic-git';
}

function extractRemoteHost(remoteUrl: string): string | undefined {
    try {
        return new URL(remoteUrl).hostname.toLowerCase();
    } catch {
        const scpLike = /^[^@]+@([^:]+):.+$/u.exec(remoteUrl);
        return scpLike?.[1]?.toLowerCase();
    }
}

function createSourceDiagnostic(
    code: string,
    severity: WorkspaceDiagnostic['severity'],
    message: string,
    sourceId: string,
    sourcePath: string
): WorkspaceDiagnostic {
    return Object.freeze({
        code,
        severity,
        scope: 'source',
        message,
        sourceId,
        path: sourcePath
    });
}

function normalizeAbsolutePath(candidate: string): string {
    return path.resolve(candidate);
}

function freezeSnapshot(snapshot: WorkspaceSourceSnapshot): WorkspaceSourceSnapshot {
    return Object.freeze({
        ...snapshot,
        configuredSources: Object.freeze([...snapshot.configuredSources]),
        observedSources: Object.freeze([...snapshot.observedSources]),
        diagnostics: Object.freeze([...snapshot.diagnostics])
    });
}

function freezeConfiguredSource(source: WorkspaceConfiguredSource): WorkspaceConfiguredSource {
    return Object.freeze({ ...source });
}

function freezeObservation(observation: WorkspaceSourceObservation): WorkspaceSourceObservation {
    return Object.freeze({ ...observation });
}

function freezeDiagnostics(diagnostics: readonly WorkspaceDiagnostic[]): readonly WorkspaceDiagnostic[] {
    return Object.freeze([...diagnostics].map(diagnostic => Object.freeze({ ...diagnostic })));
}

function normalizeForComparison(candidate: string): string {
    return process.platform === 'win32' || process.platform === 'darwin'
        ? candidate.toLocaleLowerCase()
        : candidate;
}

function samePath(left: string, right: string): boolean {
    return normalizeForComparison(left) === normalizeForComparison(right);
}

function isWithin(parent: string, candidate: string): boolean {
    const relativePath = path.relative(parent, candidate);
    return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath));
}
