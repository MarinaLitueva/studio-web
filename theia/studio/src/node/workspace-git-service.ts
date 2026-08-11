import * as fs from 'fs/promises';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { injectable } from '@theia/core/shared/inversify';
import { GitCommandError, GitExecutor, type GitRevisionCount } from './git-executor';
import { assertSupportedRemoteUrl } from './git-remote-policy';
import type { WorkspaceConflictCode } from '../common/workspace-protocol';

const ORIGIN_REMOTE = 'origin';

export interface WorkspaceGitSourceTarget {
    readonly sourceId: string;
    readonly localPath: string;
    readonly remoteUrl?: string;
    readonly ref?: string;
    readonly resolveRoot?: string;
}

export type WorkspaceGitInspectionState =
    | 'missing'
    | 'no-repo'
    | 'wrong-remote'
    | 'detached'
    | 'dirty'
    | 'diverged'
    | 'ahead'
    | 'behind'
    | 'clean';

export interface WorkspaceGitInspection {
    readonly sourceId: string;
    readonly state: WorkspaceGitInspectionState;
    readonly localPath: string;
    readonly expectedRemoteUrl?: string;
    readonly actualRemoteUrl?: string;
    readonly currentRevision?: string;
    readonly currentBranch?: string;
    readonly trackingRef?: string;
    readonly remoteRevision?: string;
    readonly aheadCount: number;
    readonly behindCount: number;
    readonly hasTrackedChanges: boolean;
    readonly hasUntrackedChanges: boolean;
    readonly message?: string;
}

export interface WorkspaceGitConflictResult {
    readonly outcome: 'conflict';
    readonly code: WorkspaceConflictCode;
    readonly sourceId: string;
    readonly message: string;
    readonly inspection?: WorkspaceGitInspection;
}

export interface WorkspaceGitAuthRequiredResult {
    readonly outcome: 'auth-required';
    readonly sourceId: string;
    readonly message: string;
}

export interface WorkspaceGitCancelledResult {
    readonly outcome: 'cancelled';
    readonly sourceId: string;
    readonly phase: 'pre-activation' | 'sync';
}

export interface WorkspaceGitCompletedNeedsInspectionResult {
    readonly outcome: 'completed-needs-inspection';
    readonly sourceId: string;
    readonly phase: 'post-activation';
    readonly localPath: string;
}

export interface WorkspaceGitMutationSuccessResult {
    readonly outcome: 'cloned' | 'up-to-date' | 'updated' | 'reconciled-remote' | 'force-updated';
    readonly sourceId: string;
    readonly localPath: string;
    readonly revision?: string;
}

export type WorkspaceGitMutationResult =
    | WorkspaceGitMutationSuccessResult
    | WorkspaceGitConflictResult
    | WorkspaceGitAuthRequiredResult
    | WorkspaceGitCancelledResult
    | WorkspaceGitCompletedNeedsInspectionResult;

export interface WorkspaceGitForceUpdateRequest extends WorkspaceGitSourceTarget {
    readonly forceConfirmed: boolean;
    readonly expectedRevision?: string;
    readonly expectedRemoteRevision?: string;
}

interface WorkspaceGitFileSystem {
    access(candidatePath: string): Promise<void>;
    lstat(candidatePath: string): Promise<Awaited<ReturnType<typeof fs.lstat>>>;
    mkdir(candidatePath: string, options?: { recursive?: boolean }): Promise<string | undefined>;
    realpath(candidatePath: string): Promise<string>;
    rename(oldPath: string, newPath: string): Promise<void>;
    rm(candidatePath: string, options: { recursive?: boolean; force?: boolean; maxRetries?: number }): Promise<void>;
}

export interface WorkspaceGitClient {
    revParseTopLevel(cwd: string): Promise<string>;
    getConfigValue(cwd: string, key: string): Promise<string | undefined>;
    revParseAbbrevHead(cwd: string): Promise<string>;
    revParseHead(cwd: string): Promise<string>;
    statusPorcelain(cwd: string): Promise<string[]>;
    readReference(cwd: string, reference: string): Promise<string | undefined>;
    countRevisionRange(cwd: string, left: string, right: string): Promise<GitRevisionCount>;
    cloneRepository(cwd: string, remoteUrl: string, destination: string, options?: { branch?: string; signal?: AbortSignal }): Promise<void>;
    addRemote(cwd: string, remote: string, remoteUrl: string): Promise<void>;
    setRemoteUrl(cwd: string, remote: string, remoteUrl: string): Promise<void>;
    fetchRemote(cwd: string, remote: string, ref?: string, options?: { signal?: AbortSignal }): Promise<void>;
    mergeFastForwardOnly(cwd: string, revision: string, options?: { signal?: AbortSignal }): Promise<void>;
    forceCheckoutBranch(cwd: string, branch: string, startPoint: string, options?: { signal?: AbortSignal }): Promise<void>;
    getUnsafeLocalConfigKeys?(cwd: string): Promise<string[]>;
}

const DEFAULT_FILE_SYSTEM: WorkspaceGitFileSystem = {
    access: fs.access.bind(fs),
    lstat: fs.lstat.bind(fs),
    mkdir: fs.mkdir.bind(fs),
    realpath: fs.realpath.bind(fs),
    rename: fs.rename.bind(fs),
    rm: fs.rm.bind(fs)
};

@injectable()
export class WorkspaceGitService {
    constructor(
        protected readonly git: WorkspaceGitClient = new GitExecutor(),
        protected readonly fileSystem: WorkspaceGitFileSystem = DEFAULT_FILE_SYSTEM
    ) {}

    async inspectConfiguredSource(target: WorkspaceGitSourceTarget): Promise<WorkspaceGitInspection> {
        const currentPath = path.resolve(target.localPath);
        try {
            if (target.remoteUrl) {
                assertSupportedRemoteUrl(target.remoteUrl);
            }
        } catch {
            return this.conflictInspection(target, 'wrong-remote', 'Configured source uses an unsupported or unsafe Git remote transport.');
        }
        if (!await this.pathExists(currentPath)) {
            return {
                sourceId: target.sourceId,
                state: 'missing',
                localPath: currentPath,
                expectedRemoteUrl: target.remoteUrl,
                aheadCount: 0,
                behindCount: 0,
                hasTrackedChanges: false,
                hasUntrackedChanges: false,
                message: `Configured source "${target.sourceId}" is missing.`
            };
        }

        try {
            const repositoryTopLevel = path.resolve(await this.git.revParseTopLevel(currentPath));
            const canonicalRepositoryTopLevel = await this.fileSystem.realpath(repositoryTopLevel);
            const canonicalLocalPath = await this.fileSystem.realpath(currentPath);
            if (!samePath(canonicalRepositoryTopLevel, canonicalLocalPath)) {
                return this.conflictInspection(target, 'no-repo', 'Configured source root does not match the repository top-level.');
            }

            const actualRemoteUrl = normalizeOptionalString(await this.git.getConfigValue(currentPath, `remote.${ORIGIN_REMOTE}.url`));
            try {
                if (actualRemoteUrl) {
                    assertSupportedRemoteUrl(actualRemoteUrl);
                }
            } catch {
                return this.conflictInspection(target, 'wrong-remote', 'Configured source uses an unsupported or unsafe Git remote transport.', {
                    actualRemoteUrl
                });
            }
            const unsafeConfigKeys = await this.git.getUnsafeLocalConfigKeys?.(currentPath) ?? [];
            if (unsafeConfigKeys.length > 0) {
                return this.conflictInspection(target, 'wrong-remote', 'Configured source has unsafe repository-local Git configuration.', {
                    actualRemoteUrl
                });
            }
            if (target.remoteUrl && actualRemoteUrl !== normalizeOptionalString(target.remoteUrl)) {
                return this.conflictInspection(target, 'wrong-remote', 'Configured source remote does not match the expected URL.', {
                    actualRemoteUrl
                });
            }

            const currentBranch = (await this.git.revParseAbbrevHead(currentPath)).trim();
            const currentRevision = (await this.git.revParseHead(currentPath)).trim();
            const statusEntries = await this.git.statusPorcelain(currentPath);
            const hasUntrackedChanges = statusEntries.some(entry => entry.startsWith('??'));
            const hasTrackedChanges = statusEntries.some(entry => !entry.startsWith('??'));
            if (currentBranch === 'HEAD') {
                return this.conflictInspection(target, 'detached', 'Configured source is on a detached HEAD.', {
                    actualRemoteUrl,
                    currentRevision
                });
            }
            if (hasTrackedChanges || hasUntrackedChanges) {
                return this.conflictInspection(
                    target,
                    'dirty',
                    hasTrackedChanges
                        ? 'Configured source has local modifications.'
                        : 'Configured source has untracked files.',
                    {
                        actualRemoteUrl,
                        currentBranch,
                        currentRevision,
                        hasTrackedChanges,
                        hasUntrackedChanges
                    }
                );
            }

            const trackingBranch = normalizeOptionalString(target.ref) ?? currentBranch;
            const trackingRef = trackingBranch ? `refs/remotes/${ORIGIN_REMOTE}/${trackingBranch}` : undefined;
            const remoteRevision = trackingRef ? await this.git.readReference(currentPath, trackingRef) : undefined;
            const counts = remoteRevision
                ? await this.git.countRevisionRange(currentPath, 'HEAD', trackingRef!)
                : { left: 0, right: 0 };

            if (counts.left > 0 && counts.right > 0) {
                return this.conflictInspection(target, 'diverged', 'Configured source has diverged from its remote tracking ref.', {
                    actualRemoteUrl,
                    currentBranch,
                    currentRevision,
                    trackingRef,
                    remoteRevision,
                    counts
                });
            }
            if (counts.left > 0) {
                return this.conflictInspection(target, 'ahead', 'Configured source is ahead of its remote tracking ref.', {
                    actualRemoteUrl,
                    currentBranch,
                    currentRevision,
                    trackingRef,
                    remoteRevision,
                    counts
                });
            }
            if (counts.right > 0) {
                return this.conflictInspection(target, 'behind', 'Configured source is behind its remote tracking ref.', {
                    actualRemoteUrl,
                    currentBranch,
                    currentRevision,
                    trackingRef,
                    remoteRevision,
                    counts
                });
            }

            return {
                sourceId: target.sourceId,
                state: 'clean',
                localPath: currentPath,
                expectedRemoteUrl: target.remoteUrl,
                actualRemoteUrl,
                currentRevision,
                currentBranch,
                trackingRef,
                remoteRevision,
                aheadCount: 0,
                behindCount: 0,
                hasTrackedChanges: false,
                hasUntrackedChanges: false
            };
        } catch (error) {
            if (isGitRepositoryMissingError(error)) {
                return this.conflictInspection(target, 'no-repo', 'Configured source is not a Git working tree.');
            }
            if (isAuthError(error)) {
                return this.conflictInspection(target, 'wrong-remote', redactErrorMessage(error));
            }
            throw error;
        }
    }

    async cloneMissingSource(target: WorkspaceGitSourceTarget, signal?: AbortSignal): Promise<WorkspaceGitMutationResult> {
        if (!target.remoteUrl) {
            return this.conflictResult(target.sourceId, 'invalid-request', 'Configured source does not declare a remote URL.');
        }
        if (!target.resolveRoot) {
            return this.conflictResult(target.sourceId, 'invalid-request', 'Configured URL source is missing its resolve.workdir root.');
        }
        const inspection = await this.inspectConfiguredSource(target);
        if (inspection.state !== 'missing') {
            return this.conflictResult(target.sourceId, 'source-conflict', 'Configured source already exists and cannot be cloned in place.', inspection);
        }

        const activation = await this.prepareCloneActivation(target);
        const tempDirectory = path.join(activation.parentPath, `${path.basename(activation.destinationPath)}.tmp-${randomUUID()}`);
        let activated = false;
        try {
            throwIfAborted(signal);
            await this.git.cloneRepository(activation.parentPath, target.remoteUrl, tempDirectory, {
                branch: normalizeOptionalString(target.ref),
                signal
            });
            await this.verifyClonedRepository(target, tempDirectory);
            throwIfAborted(signal);
            if (await this.pathExists(activation.destinationPath)) {
                await this.cleanupPath(tempDirectory);
                return this.conflictResult(target.sourceId, 'source-conflict', 'Configured source appeared concurrently during clone activation.');
            }
            await this.fileSystem.rename(tempDirectory, activation.destinationPath);
            activated = true;
            if (signal?.aborted) {
                return {
                    outcome: 'completed-needs-inspection',
                    sourceId: target.sourceId,
                    phase: 'post-activation',
                    localPath: activation.destinationPath
                };
            }
            const revision = await this.git.revParseHead(activation.destinationPath);
            return {
                outcome: 'cloned',
                sourceId: target.sourceId,
                localPath: activation.destinationPath,
                revision: revision.trim()
            };
        } catch (error) {
            if (!activated) {
                await this.cleanupPath(tempDirectory);
            }
            if (signal?.aborted || isAbortError(error)) {
                return {
                    outcome: 'cancelled',
                    sourceId: target.sourceId,
                    phase: 'pre-activation'
                };
            }
            if (isAuthError(error)) {
                return {
                    outcome: 'auth-required',
                    sourceId: target.sourceId,
                    message: redactErrorMessage(error)
                };
            }
            throw error;
        }
    }

    async reconcileExistingRemote(target: WorkspaceGitSourceTarget): Promise<WorkspaceGitMutationResult> {
        if (!target.remoteUrl) {
            return this.conflictResult(target.sourceId, 'invalid-request', 'Configured source does not declare a remote URL.');
        }
        const inspection = await this.inspectConfiguredSource({ ...target, remoteUrl: undefined });
        if (inspection.state === 'missing' || inspection.state === 'no-repo') {
            return this.conflictResult(target.sourceId, 'source-conflict', 'Configured source must already be a Git working tree to reconcile its remote.', inspection);
        }

        try {
            if (!inspection.actualRemoteUrl) {
                await this.git.addRemote(target.localPath, ORIGIN_REMOTE, target.remoteUrl);
            } else if (inspection.actualRemoteUrl !== target.remoteUrl) {
                await this.git.setRemoteUrl(target.localPath, ORIGIN_REMOTE, target.remoteUrl);
            } else {
                return {
                    outcome: 'reconciled-remote',
                    sourceId: target.sourceId,
                    localPath: path.resolve(target.localPath),
                    revision: inspection.currentRevision
                };
            }
            const nextInspection = await this.inspectConfiguredSource(target);
            if (nextInspection.state === 'wrong-remote') {
                return this.conflictResult(target.sourceId, 'source-conflict', 'Configured source remote could not be reconciled safely.', nextInspection);
            }
            return {
                outcome: 'reconciled-remote',
                sourceId: target.sourceId,
                localPath: path.resolve(target.localPath),
                revision: nextInspection.currentRevision
            };
        } catch (error) {
            if (isAuthError(error)) {
                return {
                    outcome: 'auth-required',
                    sourceId: target.sourceId,
                    message: redactErrorMessage(error)
                };
            }
            throw error;
        }
    }

    async fastForwardUpdate(target: WorkspaceGitSourceTarget, signal?: AbortSignal): Promise<WorkspaceGitMutationResult> {
        const inspection = await this.inspectConfiguredSource(target);
        if (inspection.state === 'missing') {
            return this.conflictResult(target.sourceId, 'source-conflict', 'Configured source is missing and must be cloned explicitly.', inspection);
        }
        if (inspection.state === 'wrong-remote') {
            return this.conflictResult(target.sourceId, 'source-conflict', 'Configured source remote must be reconciled before syncing.', inspection);
        }
        if (inspection.state === 'dirty' || inspection.state === 'diverged' || inspection.state === 'ahead' || inspection.state === 'detached' || inspection.state === 'no-repo') {
            return this.conflictResult(target.sourceId, 'source-conflict', inspection.message ?? 'Configured source cannot be synced safely.', inspection);
        }

        const trackingBranch = inspection.currentBranch && normalizeOptionalString(target.ref) ? normalizeOptionalString(target.ref)! : inspection.currentBranch;
        if (!trackingBranch) {
            return this.conflictResult(target.sourceId, 'source-conflict', 'Configured source does not have a syncable branch.', inspection);
        }
        const trackingRef = `refs/remotes/${ORIGIN_REMOTE}/${trackingBranch}`;

        try {
            throwIfAborted(signal);
            await this.git.fetchRemote(target.localPath, ORIGIN_REMOTE, trackingBranch, { signal });
            const nextInspection = await this.inspectConfiguredSource(target);
            if (nextInspection.state === 'wrong-remote' || nextInspection.state === 'dirty' || nextInspection.state === 'diverged' || nextInspection.state === 'ahead' || nextInspection.state === 'detached' || nextInspection.state === 'no-repo') {
                return this.conflictResult(target.sourceId, 'source-conflict', nextInspection.message ?? 'Configured source cannot be synced safely.', nextInspection);
            }
            if (nextInspection.state === 'clean') {
                return {
                    outcome: 'up-to-date',
                    sourceId: target.sourceId,
                    localPath: path.resolve(target.localPath),
                    revision: nextInspection.currentRevision
                };
            }
            await this.git.mergeFastForwardOnly(target.localPath, trackingRef, { signal });
            const revision = await this.git.revParseHead(target.localPath);
            return {
                outcome: 'updated',
                sourceId: target.sourceId,
                localPath: path.resolve(target.localPath),
                revision: revision.trim()
            };
        } catch (error) {
            if (signal?.aborted || isAbortError(error)) {
                return {
                    outcome: 'cancelled',
                    sourceId: target.sourceId,
                    phase: 'sync'
                };
            }
            if (isAuthError(error)) {
                return {
                    outcome: 'auth-required',
                    sourceId: target.sourceId,
                    message: redactErrorMessage(error)
                };
            }
            throw error;
        }
    }

    async forceUpdate(target: WorkspaceGitForceUpdateRequest, signal?: AbortSignal): Promise<WorkspaceGitMutationResult> {
        const inspection = await this.inspectConfiguredSource(target);
        if (!target.forceConfirmed) {
            return this.conflictResult(target.sourceId, 'confirmation-required', 'Force update requires explicit per-source confirmation.', inspection);
        }
        if (!target.expectedRevision || target.expectedRevision !== inspection.currentRevision) {
            return this.conflictResult(target.sourceId, 'source-conflict', 'Configured source revision changed since preflight and must be inspected again.', inspection);
        }
        if (!target.expectedRemoteRevision || target.expectedRemoteRevision !== inspection.remoteRevision) {
            return this.conflictResult(target.sourceId, 'source-conflict', 'Configured source remote revision changed since preflight and must be inspected again.', inspection);
        }
        if (inspection.state === 'missing' || inspection.state === 'no-repo' || inspection.state === 'wrong-remote') {
            return this.conflictResult(target.sourceId, 'source-conflict', inspection.message ?? 'Configured source cannot be force updated.', inspection);
        }

        const branch = normalizeOptionalString(target.ref) ?? inspection.currentBranch;
        if (!branch) {
            return this.conflictResult(target.sourceId, 'source-conflict', 'Force update requires a concrete branch ref.', inspection);
        }
        const trackingRef = `refs/remotes/${ORIGIN_REMOTE}/${branch}`;

        try {
            throwIfAborted(signal);
            await this.git.fetchRemote(target.localPath, ORIGIN_REMOTE, branch, { signal });
            const fetchedRemoteRevision = await this.git.readReference(target.localPath, trackingRef);
            if (fetchedRemoteRevision !== target.expectedRemoteRevision) {
                return this.conflictResult(target.sourceId, 'source-conflict', 'Configured source remote revision changed after confirmation; inspect and confirm again.', {
                    ...inspection,
                    remoteRevision: fetchedRemoteRevision
                });
            }
            await this.git.forceCheckoutBranch(target.localPath, branch, target.expectedRemoteRevision, { signal });
            const revision = await this.git.revParseHead(target.localPath);
            return {
                outcome: 'force-updated',
                sourceId: target.sourceId,
                localPath: path.resolve(target.localPath),
                revision: revision.trim()
            };
        } catch (error) {
            if (signal?.aborted || isAbortError(error)) {
                return {
                    outcome: 'cancelled',
                    sourceId: target.sourceId,
                    phase: 'sync'
                };
            }
            if (isAuthError(error)) {
                return {
                    outcome: 'auth-required',
                    sourceId: target.sourceId,
                    message: redactErrorMessage(error)
                };
            }
            throw error;
        }
    }

    protected async prepareCloneActivation(target: WorkspaceGitSourceTarget): Promise<{
        destinationPath: string;
        parentPath: string;
    }> {
        const resolveRoot = path.resolve(target.resolveRoot!);
        const destinationPath = path.resolve(target.localPath);
        if (!isWithin(resolveRoot, destinationPath)) {
            throw new Error(`Configured source "${target.sourceId}" escapes the configured resolve.workdir root.`);
        }

        await this.ensureDirectoryChain(resolveRoot);
        const parentPath = path.dirname(destinationPath);
        await this.ensureDirectoryChain(parentPath, resolveRoot);
        const canonicalResolveRoot = await this.fileSystem.realpath(resolveRoot);
        const canonicalParent = await this.fileSystem.realpath(parentPath);
        if (!isWithin(canonicalResolveRoot, canonicalParent)) {
            throw new Error(`Configured source "${target.sourceId}" escapes the canonical resolve.workdir root.`);
        }
        if (await this.pathExists(destinationPath)) {
            throw new Error(`Configured source "${target.sourceId}" already exists at its destination.`);
        }
        return { destinationPath, parentPath };
    }

    protected async verifyClonedRepository(target: WorkspaceGitSourceTarget, repositoryPath: string): Promise<void> {
        const canonicalRepositoryPath = await this.fileSystem.realpath(repositoryPath);
        const topLevel = await this.git.revParseTopLevel(repositoryPath);
        const canonicalTopLevel = await this.fileSystem.realpath(path.resolve(topLevel));
        if (!samePath(canonicalRepositoryPath, canonicalTopLevel)) {
            throw new Error(`Cloned source "${target.sourceId}" did not produce a repository at the expected root.`);
        }
        const actualRemoteUrl = normalizeOptionalString(await this.git.getConfigValue(repositoryPath, `remote.${ORIGIN_REMOTE}.url`));
        if (normalizeOptionalString(target.remoteUrl) !== actualRemoteUrl) {
            throw new Error(`Cloned source "${target.sourceId}" remote did not match the expected URL.`);
        }
        const expectedBranch = normalizeOptionalString(target.ref);
        if (expectedBranch) {
            const branch = (await this.git.revParseAbbrevHead(repositoryPath)).trim();
            if (branch !== expectedBranch) {
                throw new Error(`Cloned source "${target.sourceId}" did not check out the expected ref.`);
            }
        }
    }

    protected async ensureDirectoryChain(candidatePath: string, requiredRoot = candidatePath): Promise<void> {
        const absoluteCandidate = path.resolve(candidatePath);
        const absoluteRoot = path.resolve(requiredRoot);
        if (!isWithin(absoluteRoot, absoluteCandidate)) {
            throw new Error('Directory chain escapes the required root.');
        }
        const relativeSegments = path.relative(absoluteRoot, absoluteCandidate).split(path.sep).filter(Boolean);
        await this.fileSystem.mkdir(absoluteRoot, { recursive: true });
        let current = absoluteRoot;
        const rootStat = await this.fileSystem.lstat(absoluteRoot);
        if (rootStat.isSymbolicLink()) {
            throw new Error('Configured resolve.workdir root cannot be a symbolic link.');
        }
        for (const segment of relativeSegments) {
            current = path.join(current, segment);
            if (!await this.pathExists(current)) {
                await this.fileSystem.mkdir(current, { recursive: false });
            }
            const stat = await this.fileSystem.lstat(current);
            if (stat.isSymbolicLink()) {
                throw new Error(`Configured source path crosses a symbolic link: ${current}`);
            }
        }
    }

    protected conflictInspection(
        target: WorkspaceGitSourceTarget,
        state: WorkspaceGitInspectionState,
        message: string,
        details: {
            actualRemoteUrl?: string;
            currentRevision?: string;
            currentBranch?: string;
            trackingRef?: string;
            remoteRevision?: string;
            counts?: GitRevisionCount;
            hasTrackedChanges?: boolean;
            hasUntrackedChanges?: boolean;
        } = {}
    ): WorkspaceGitInspection {
        return {
            sourceId: target.sourceId,
            state,
            localPath: path.resolve(target.localPath),
            expectedRemoteUrl: target.remoteUrl,
            actualRemoteUrl: details.actualRemoteUrl,
            currentRevision: details.currentRevision,
            currentBranch: details.currentBranch,
            trackingRef: details.trackingRef,
            remoteRevision: details.remoteRevision,
            aheadCount: details.counts?.left ?? 0,
            behindCount: details.counts?.right ?? 0,
            hasTrackedChanges: details.hasTrackedChanges ?? false,
            hasUntrackedChanges: details.hasUntrackedChanges ?? false,
            message
        };
    }

    protected conflictResult(
        sourceId: string,
        code: WorkspaceConflictCode,
        message: string,
        inspection?: WorkspaceGitInspection
    ): WorkspaceGitConflictResult {
        return { outcome: 'conflict', sourceId, code, message, inspection };
    }

    protected async cleanupPath(candidatePath: string): Promise<void> {
        await this.fileSystem.rm(candidatePath, { recursive: true, force: true, maxRetries: 2 });
    }

    protected async pathExists(candidatePath: string): Promise<boolean> {
        try {
            await this.fileSystem.access(candidatePath);
            return true;
        } catch (error) {
            if (isMissingFileError(error)) {
                return false;
            }
            throw error;
        }
    }
}

function throwIfAborted(signal?: AbortSignal): void {
    if (signal?.aborted) {
        throw new DOMException('The operation was aborted.', 'AbortError');
    }
}

function normalizeOptionalString(value: string | undefined): string | undefined {
    const normalized = value?.trim();
    return normalized ? normalized : undefined;
}

function samePath(left: string, right: string): boolean {
    return normalizePath(left) === normalizePath(right);
}

function normalizePath(candidatePath: string): string {
    return process.platform === 'win32' || process.platform === 'darwin'
        ? candidatePath.toLocaleLowerCase()
        : candidatePath;
}

function isWithin(parent: string, candidate: string): boolean {
    const relativePath = path.relative(parent, candidate);
    return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath));
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
    return typeof error === 'object'
        && error !== null
        && 'code' in error
        && (error as NodeJS.ErrnoException).code === 'ENOENT';
}

function isAbortError(error: unknown): boolean {
    return typeof error === 'object'
        && error !== null
        && 'name' in error
        && (error as { name?: unknown }).name === 'AbortError';
}

function isGitRepositoryMissingError(error: unknown): boolean {
    return error instanceof GitCommandError
        && error.exitCode === 128
        && /not a git repository/i.test(`${error.stderr}\n${error.stdout}`);
}

function isAuthError(error: unknown): boolean {
    const message = redactErrorMessage(error);
    return /authentication failed|could not read username|terminal prompts disabled|access denied|repository not found/i.test(message);
}

function redactErrorMessage(error: unknown): string {
    if (error instanceof GitCommandError) {
        return sanitizeSecretText([error.stderr, error.stdout, error.message].filter(Boolean).join('\n').trim() || 'Git authentication is required.');
    }
    if (error instanceof Error) {
        return sanitizeSecretText(error.message);
    }
    return 'Git authentication is required.';
}

export function sanitizeSecretText(value: string): string {
    return value
        .replace(/\b((?:https?|ssh|git):\/\/)([^/\s?#]*@)?([^/\s?#]+)([^\s]*)/gi, (_match, scheme: string, userinfo: string | undefined, host: string, suffix: string) => {
            let safeSuffix = suffix
                .replace(/([?&](?:access_?token|auth|credential|key|password|secret|token)=)[^&#\s]*/gi, '$1[redacted]')
                .replace(/\/(?:oauth2?|token|password|secret|credentials?)\/[^/?#\s]+/gi, matched => `${matched.slice(0, matched.lastIndexOf('/') + 1)}[redacted]`);
            if (safeSuffix.includes('?')) {
                safeSuffix = safeSuffix.replace(/([?&][^=&#\s]+)=([^&#\s]*)/g, '$1=[redacted]');
            }
            return `${scheme}${userinfo ? '[redacted]@' : ''}${host}${safeSuffix}`;
        })
        .replace(/\b[^@\s/:]+:[^@\s/]+@(?=[^:\s/]+:)/g, '[redacted]@')
        .replace(/((?:access_?token|auth|credential|key|password|secret|token)[=:/])[^&\s/?#]+/gi, '$1[redacted]');
}
