import * as fs from 'fs/promises';
import * as path from 'path';
import { createHash } from 'crypto';
import { inject, injectable, optional } from '@theia/core/shared/inversify';
import type {
    StudioOperationSnapshot,
    StudioRepositoryGitDescriptor
} from '../common/studio-protocol';
import { WorkspaceBoundary } from './workspace-boundary';
import { GitExecutor, GitCommandError, type GitNumstatEntry } from './git-executor';
import { StudioRuntimeConfigService } from './studio-runtime-config';
import { RepositoryRegistry } from './repository-registry';
import { RepositoryDiscoveryService } from './repository-discovery-service';
import type {
    FakeRepositoryExecutionResult,
    RepositoryOperationExecutionContext,
    RepositoryOperationExecutor
} from './repository-operation-queue';

const SAFE_GIT_CONFIG_KEYS = [
    'core.hooksPath',
    'core.fsmonitor',
    'commit.gpgSign',
    'gpg.program'
] as const;

type PublishGitConfig = Exclude<
    ReturnType<StudioRuntimeConfigService['getConfig']>['git'],
    { mode: 'disabled' }
>;

@injectable()
export class GitPublishService implements RepositoryOperationExecutor {
    constructor(
        @inject(GitExecutor) protected readonly git: GitExecutor,
        @inject(StudioRuntimeConfigService) protected readonly runtimeConfig: StudioRuntimeConfigService,
        @inject(WorkspaceBoundary) protected readonly workspaceBoundary: WorkspaceBoundary,
        @inject(RepositoryRegistry) @optional() protected readonly repositoryRegistry?: RepositoryRegistry,
        @inject(RepositoryDiscoveryService) @optional() protected readonly repositoryDiscovery?: RepositoryDiscoveryService
    ) {}

    async execute(
        operation: StudioOperationSnapshot,
        context: RepositoryOperationExecutionContext = { resumingPush: false }
    ): Promise<FakeRepositoryExecutionResult> {
        const executionConfig = await this.resolveExecutionConfig(operation);
        if ('failureReason' in executionConfig) {
            return blocked(executionConfig.failureReason);
        }
        const { gitConfig, repoRoot } = executionConfig;
        const configError = validateInputs(gitConfig, operation, value => this.git.isSupportedRemoteUrl(value));
        if (configError) {
            return blocked(configError);
        }

        this.workspaceBoundary.assertWorkspaceId(operation.workspaceId);
        const resolved = await this.workspaceBoundary.resolveWorkspaceLocation({
            relativePath: operation.relativePath
        });
        const location = resolved.location;
        if (location.isDirectory) {
            return blocked('Target path must be a file');
        }
        if (location.relativePath !== operation.relativePath) {
            return blocked('Workspace path normalization mismatch');
        }
        const gitPath = operation.journalSchemaVersion === 2
            ? toRepositoryRelativePath(repoRoot, resolved.absolutePath)
            : location.repositoryRelativePath;
        if (gitPath !== operation.repositoryRelativePath) {
            return blocked('Repository path normalization mismatch');
        }

        await this.assertRepositoryRoot(repoRoot);
        const branch = await this.git.revParseAbbrevHead(repoRoot);
        if (branch === 'HEAD') {
            return blocked('Detached HEAD is not allowed');
        }
        if (branch !== gitConfig.branch) {
            return blocked(`Configured branch mismatch: expected ${gitConfig.branch}, got ${branch}`);
        }

        const safeConfigError = await this.getUnsafeConfigError(repoRoot);
        if (safeConfigError) {
            return blocked(safeConfigError);
        }

        const headCommit = await this.getExistingOperationCommit(repoRoot, operation);
        if (headCommit) {
            const headContentError = await this.getHeadContentError(repoRoot, gitPath, operation);
            if (headContentError) {
                return blocked(headContentError);
            }
            return gitConfig.mode === 'push'
                ? await this.pushExistingCommit(
                    operation,
                    repoRoot,
                    gitConfig.remote,
                    gitConfig.fetchSourceUrl,
                    gitConfig.pushSourceUrl,
                    gitConfig.fetchUrl,
                    gitConfig.pushUrl,
                    gitConfig.branch,
                    gitConfig.authorName,
                    gitConfig.authorEmail
                )
                : { outcome: 'committed-local', commitSha: headCommit };
        }
        if (context.resumingPush && gitConfig.mode === 'push') {
            const headContentError = await this.getHeadContentError(repoRoot, gitPath, operation);
            if (!headContentError) {
                return await this.pushExistingCommit(
                    operation,
                    repoRoot,
                    gitConfig.remote,
                    gitConfig.fetchSourceUrl,
                    gitConfig.pushSourceUrl,
                    gitConfig.fetchUrl,
                    gitConfig.pushUrl,
                    gitConfig.branch,
                    gitConfig.authorName,
                    gitConfig.authorEmail
                );
            }
        }
        if (!location.exists) {
            return blocked('Target path does not exist');
        }

        const status = await this.git.statusPorcelain(repoRoot);
        const statusCheck = this.validateStatus(status, gitPath);
        if (statusCheck) {
            return blocked(statusCheck);
        }

        if (status.length === 0) {
            return { outcome: 'no-changes' };
        }

        try {
            if (gitConfig.mode === 'push') {
                const preCommitPullResult = await this.pullBeforeFreshCommit(
                    operation,
                    repoRoot,
                    gitConfig.remote,
                    gitConfig.fetchSourceUrl,
                    gitConfig.fetchUrl,
                    gitConfig.branch,
                    gitConfig.authorName,
                    gitConfig.authorEmail
                );
                if (preCommitPullResult) {
                    return preCommitPullResult;
                }
            }

            const currentFileHash = await sha256File(path.join(repoRoot, gitPath));
            if (currentFileHash !== operation.contentHash) {
                return blocked('Saved content hash mismatch');
            }

            await this.git.addPath(repoRoot, gitPath);
            const stagedContentHash = hashBuffer(await this.git.readPathFromIndex(repoRoot, gitPath));
            if (stagedContentHash !== operation.contentHash) {
                return blocked('Staged content hash mismatch');
            }
            const stagedPaths = await this.git.diffNameOnlyCached(repoRoot);
            if (stagedPaths.length !== 1 || stagedPaths[0] !== gitPath) {
                return blocked('Only the saved path may be staged for commit');
            }
            const commitMetadata = this.getCommitMetadata(
                await this.git.diffCachedNumstat(repoRoot, gitPath),
                operation
            );

            await this.git.commitPath(
                repoRoot,
                buildCommitMessage(operation, commitMetadata),
                gitPath,
                gitConfig.authorName,
                gitConfig.authorEmail
            );

            const headPaths = await this.git.diffNameOnlyHead(repoRoot);
            if (headPaths.length !== 1 || headPaths[0] !== gitPath) {
                return blocked('Created commit touched paths outside the saved file');
            }

            const committedHead = await this.git.revParseHead(repoRoot);
            if (gitConfig.mode === 'commit') {
                return { outcome: 'committed-local', commitSha: committedHead };
            }
            return await this.pushCommittedHead(
                operation,
                repoRoot,
                gitConfig.remote,
                gitConfig.pushSourceUrl,
                gitConfig.pushUrl,
                gitConfig.branch,
                committedHead
            );
        } catch (error) {
            if (error instanceof GitCommandError && error.command.includes('pull')) {
                return await this.classifyPullFailure(repoRoot, error);
            }
            if (error instanceof GitCommandError && error.command.includes('push')) {
                return pending(error.stderr || error.message, await this.git.revParseHead(repoRoot));
            }
            return {
                outcome: 'failed',
                failureReason: error instanceof Error ? error.message : String(error)
            };
        }
    }

    protected async pushExistingCommit(
        operation: StudioOperationSnapshot,
        repoRoot: string,
        remote: string,
        fetchSourceUrl: string,
        pushSourceUrl: string,
        fetchUrl: string,
        pushUrl: string,
        branch: string,
        authorName: string,
        authorEmail: string
    ): Promise<FakeRepositoryExecutionResult> {
        return this.pullRebaseAndPush(
            operation,
            repoRoot,
            remote,
            fetchSourceUrl,
            pushSourceUrl,
            fetchUrl,
            pushUrl,
            branch,
            authorName,
            authorEmail
        );
    }

    protected async pullBeforeFreshCommit(
        operation: StudioOperationSnapshot,
        repoRoot: string,
        remote: string,
        fetchSourceUrl: string,
        fetchUrl: string,
        branch: string,
        authorName: string,
        authorEmail: string
    ): Promise<FakeRepositoryExecutionResult | undefined> {
        const prePullConfigError = await this.getRepositoryConfigChangeReason(operation);
        if (prePullConfigError) {
            return blocked(prePullConfigError);
        }
        await this.git.pullRebaseAutostash(repoRoot, remote, fetchSourceUrl, fetchUrl, branch, authorName, authorEmail);
        const postPullConfigError = await this.getRepositoryConfigChangeReason(operation);
        if (postPullConfigError) {
            return blocked(postPullConfigError);
        }
        return undefined;
    }

    protected async pushCommittedHead(
        operation: StudioOperationSnapshot,
        repoRoot: string,
        remote: string,
        pushSourceUrl: string,
        pushUrl: string,
        branch: string,
        commitSha: string
    ): Promise<FakeRepositoryExecutionResult> {
        const prePushConfigError = await this.getRepositoryConfigChangeReason(operation);
        if (prePushConfigError) {
            return blocked(prePushConfigError);
        }
        const headContentError = await this.getHeadContentError(
            repoRoot,
            operation.repositoryRelativePath,
            operation
        );
        if (headContentError) {
            return blocked(headContentError);
        }
        await this.git.pushBranch(repoRoot, remote, pushSourceUrl, pushUrl, branch);
        return { outcome: 'pushed', commitSha };
    }

    protected async pullRebaseAndPush(
        operation: StudioOperationSnapshot,
        repoRoot: string,
        remote: string,
        fetchSourceUrl: string,
        pushSourceUrl: string,
        fetchUrl: string,
        pushUrl: string,
        branch: string,
        authorName: string,
        authorEmail: string
    ): Promise<FakeRepositoryExecutionResult> {
        try {
            const pullResult = await this.pullBeforeFreshCommit(
                operation,
                repoRoot,
                remote,
                fetchSourceUrl,
                fetchUrl,
                branch,
                authorName,
                authorEmail
            );
            if (pullResult) {
                return pullResult;
            }
            return await this.pushCommittedHead(
                operation,
                repoRoot,
                remote,
                pushSourceUrl,
                pushUrl,
                branch,
                await this.git.revParseHead(repoRoot)
            );
        } catch (error) {
            if (error instanceof GitCommandError) {
                if (error.command.includes('pull')) {
                    return await this.classifyPullFailure(repoRoot, error);
                }
                return pending(error.stderr || error.message, await this.git.revParseHead(repoRoot));
            }
            return {
                outcome: 'failed',
                failureReason: error instanceof Error ? error.message : String(error)
            };
        }
    }

    protected async resolveExecutionConfig(operation: StudioOperationSnapshot): Promise<
        | { readonly repoRoot: string; readonly gitConfig: PublishGitConfig }
        | { readonly failureReason: string }
    > {
        const runtimeConfig = this.runtimeConfig.getConfig();
        if (operation.journalSchemaVersion !== 2) {
            return runtimeConfig.git.mode === 'disabled'
                ? { failureReason: 'Git publish is disabled' }
                : { repoRoot: runtimeConfig.repositoryRoot, gitConfig: runtimeConfig.git };
        }
        if (!this.repositoryRegistry || !this.repositoryDiscovery || !operation.repositoryId) {
            return { failureReason: 'Repository-aware Git services are unavailable' };
        }
        const repository = this.repositoryRegistry.getRepository(operation.repositoryId);
        if (!repository) {
            return { failureReason: 'Operation repository is no longer registered' };
        }
        if (repository.descriptor.fingerprint !== operation.repositoryFingerprint) {
            return { failureReason: 'Repository fingerprint changed since the operation was queued' };
        }
        const git = await this.repositoryDiscovery.refreshRepository(operation.repositoryId);
        if (git.configRevision !== operation.repositoryConfigRevision) {
            return { failureReason: 'Repository Git configuration changed since the operation was queued' };
        }
        const gitConfig = toPublishGitConfig(git);
        return 'failureReason' in gitConfig
            ? gitConfig
            : { repoRoot: repository.canonicalRoot, gitConfig };
    }

    protected async getRepositoryConfigChangeReason(operation: StudioOperationSnapshot): Promise<string | undefined> {
        if (operation.journalSchemaVersion !== 2) {
            return undefined;
        }
        if (!this.repositoryDiscovery || !operation.repositoryId || !operation.repositoryConfigRevision) {
            return 'Repository-aware Git services are unavailable';
        }
        const refreshed = await this.repositoryDiscovery.refreshRepository(operation.repositoryId);
        return refreshed.configRevision === operation.repositoryConfigRevision
            ? undefined
            : 'Repository Git configuration changed before push';
    }

    protected async assertRepositoryRoot(configuredRoot: string): Promise<string> {
        const [actualRoot, configuredRealPath] = await Promise.all([
            this.git.revParseTopLevel(configuredRoot),
            fs.realpath(configuredRoot)
        ]);
        const actualRealPath = await fs.realpath(actualRoot);
        if (actualRealPath !== configuredRealPath) {
            throw new Error('Repository path mismatch');
        }
        return actualRealPath;
    }

    protected validateStatus(lines: readonly string[], targetPath: string): string | undefined {
        for (const line of lines) {
            const x = line[0] ?? ' ';
            const y = line[1] ?? ' ';
            const filePath = normalizeStatusPath(line.slice(3));
            if (x === '?' && y === '?') {
                continue;
            }
            if (x !== ' ') {
                return 'Pre-staged content is not allowed';
            }
            if (filePath !== targetPath) {
                continue;
            }
            if (y !== 'M' && y !== ' ') {
                return 'Unsupported working tree state for the saved path';
            }
        }
        return undefined;
    }

    protected async getUnsafeConfigError(repoRoot: string): Promise<string | undefined> {
        const unsafeKeys = await this.git.getUnsafeLocalConfigKeys(repoRoot);
        if (unsafeKeys.length > 0) {
            return `Unsafe repository Git configuration is not allowed: ${unsafeKeys[0]}`;
        }
        const values = await Promise.all(SAFE_GIT_CONFIG_KEYS.map(async key => [key, await this.git.getConfigValue(repoRoot, key)] as const));
        for (const [key, value] of values) {
            if (!value) {
                continue;
            }
            if (key === 'core.hooksPath' && value !== '/dev/null') {
                return 'Unsafe Git hooks configuration is not allowed';
            }
            if (key === 'core.fsmonitor' && value !== 'false') {
                return 'Unsafe Git fsmonitor configuration is not allowed';
            }
            if (key === 'commit.gpgSign' && value !== 'false') {
                return 'Git signing must be disabled for Studio publish';
            }
            if (key === 'gpg.program') {
                return 'Custom gpg.program is not allowed for Studio publish';
            }
        }
        return undefined;
    }

    protected getCommitMetadata(entries: readonly GitNumstatEntry[], operation: StudioOperationSnapshot): CommitMetadata {
        if (entries.length !== 1 || normalizeStatusPath(entries[0].relativePath) !== operation.repositoryRelativePath) {
            throw new Error('Only the saved path may be present in staged numstat output');
        }
        const [entry] = entries;
        return {
            basename: path.posix.basename(operation.repositoryRelativePath),
            workspaceRelativePath: operation.relativePath,
            repositoryRelativePath: operation.repositoryRelativePath,
            timestamp: operation.savedAt,
            added: entry.added,
            deleted: entry.deleted
        };
    }

    protected async getExistingOperationCommit(repoRoot: string, operation: StudioOperationSnapshot): Promise<string | undefined> {
        const idempotencyTrailer = `Studio-Idempotency-Key: ${operation.idempotencyKey}`;
        for (const commitSha of await this.git.findReachableCommitsByMessage(repoRoot, idempotencyTrailer)) {
            const lines = (await this.git.getCommitMessage(repoRoot, commitSha)).split('\n');
            if (!lines.includes(`Studio-Idempotency-Key: ${operation.idempotencyKey}`)) {
                continue;
            }
            if (!lines.includes(`Studio-Content-Hash: ${operation.contentHash}`)) {
                continue;
            }
            if (!lines.includes(`Studio-Workspace-Id: ${operation.workspaceId}`)) {
                continue;
            }
            if (!lines.includes(`Studio-Workspace-Path: ${operation.relativePath}`)) {
                continue;
            }
            if (!lines.includes(`Studio-Repository-Path: ${operation.repositoryRelativePath}`)) {
                continue;
            }
            const paths = await this.git.diffNameOnlyCommit(repoRoot, commitSha);
            if (paths.length === 1 && paths[0] === operation.repositoryRelativePath) {
                return commitSha;
            }
        }
        return undefined;
    }

    protected async classifyPullFailure(repoRoot: string, error: GitCommandError): Promise<FakeRepositoryExecutionResult> {
        const message = error.stderr || error.message;
        if (hasConflictEvidence(message) || await this.hasRebaseState(repoRoot)) {
            return blocked(message);
        }
        return pending(message, await this.git.revParseHead(repoRoot));
    }

    protected async hasRebaseState(repoRoot: string): Promise<boolean> {
        const rebasePaths = await Promise.all([
            this.git.gitPath(repoRoot, 'rebase-merge'),
            this.git.gitPath(repoRoot, 'rebase-apply')
        ]);
        for (const rebasePath of rebasePaths) {
            try {
                await fs.access(path.isAbsolute(rebasePath) ? rebasePath : path.join(repoRoot, rebasePath));
                return true;
            } catch (error) {
                if (!isMissingFileError(error)) {
                    throw error;
                }
            }
        }
        return false;
    }

    protected async getHeadContentError(
        repoRoot: string,
        repositoryRelativePath: string,
        operation: StudioOperationSnapshot
    ): Promise<string | undefined> {
        try {
            const headContentHash = hashBuffer(
                await this.git.readPathFromHead(repoRoot, repositoryRelativePath)
            );
            return headContentHash === operation.contentHash
                ? undefined
                : 'Previously committed saved content no longer matches HEAD';
        } catch (error) {
            if (error instanceof GitCommandError) {
                return 'Previously committed saved content is no longer present at HEAD';
            }
            throw error;
        }
    }
}

type CommitMetadata = {
    readonly basename: string;
    readonly workspaceRelativePath: string;
    readonly repositoryRelativePath: string;
    readonly timestamp: string;
    readonly added: number;
    readonly deleted: number;
};

function buildCommitMessage(operation: StudioOperationSnapshot, metadata: CommitMetadata): string {
    return [
        `chore(studio): save ${metadata.basename} (+${metadata.added} -${metadata.deleted})`,
        '',
        `Saved-At: ${metadata.timestamp}`,
        `Saved-File: ${metadata.basename}`,
        `Saved-Path: ${metadata.repositoryRelativePath}`,
        `Staged-Lines-Added: ${metadata.added}`,
        `Staged-Lines-Deleted: ${metadata.deleted}`,
        '',
        `Studio-Idempotency-Key: ${operation.idempotencyKey}`,
        `Studio-Content-Hash: ${operation.contentHash}`,
        `Studio-Workspace-Id: ${operation.workspaceId}`,
        `Studio-Workspace-Path: ${metadata.workspaceRelativePath}`,
        `Studio-Repository-Path: ${metadata.repositoryRelativePath}`,
        `Studio-Language-Id: ${operation.languageId}`
    ].join('\n');
}

function normalizeStatusPath(filePath: string): string {
    return filePath.replace(/\\/g, '/');
}

async function sha256File(filePath: string): Promise<string> {
    const contents = await fs.readFile(filePath);
    return hashBuffer(contents);
}

function hashBuffer(contents: Buffer): string {
    return createHash('sha256').update(contents).digest('hex');
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
    return typeof error === 'object' && error !== null && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT';
}

function hasConflictEvidence(stderr: string): boolean {
    return /(?:^|\n)CONFLICT \([^)]+\):/.test(stderr) ||
        /could not apply [0-9a-f]+/i.test(stderr) ||
        /Resolve all conflicts manually/i.test(stderr) ||
        /After resolving the conflicts/i.test(stderr);
}

function blocked(failureReason: string): FakeRepositoryExecutionResult {
    return { outcome: 'blocked', failureReason };
}

function pending(failureReason: string, commitSha: string): FakeRepositoryExecutionResult {
    return { outcome: 'push-pending', failureReason, commitSha };
}

function toPublishGitConfig(
    git: StudioRepositoryGitDescriptor
): PublishGitConfig | { readonly failureReason: string } {
    if (!git.publishEnabled || git.mode === 'disabled') {
        return { failureReason: git.disabledReason ?? 'Repository Git publish is disabled' };
    }
    if (!git.branch || !git.remote || !git.fetchSourceUrl || !git.pushSourceUrl ||
        !git.fetchUrl || !git.pushUrl || !git.authorName || !git.authorEmail) {
        return { failureReason: 'Repository Git configuration is incomplete' };
    }
    return {
        mode: git.mode,
        branch: git.branch,
        remote: git.remote,
        fetchSourceUrl: git.fetchSourceUrl,
        pushSourceUrl: git.pushSourceUrl,
        fetchUrl: git.fetchUrl,
        pushUrl: git.pushUrl,
        authorName: git.authorName,
        authorEmail: git.authorEmail
    };
}

function toRepositoryRelativePath(repositoryRoot: string, absolutePath: string): string {
    const relativePath = path.relative(repositoryRoot, absolutePath).replace(/\\/g, '/');
    if (!relativePath || relativePath === '.' || relativePath.startsWith('../') || path.isAbsolute(relativePath)) {
        throw new Error('Saved path cannot be mapped into its owning repository');
    }
    return relativePath;
}

function validateInputs(
    git: PublishGitConfig,
    operation: StudioOperationSnapshot,
    supportsRemote: (value: string) => boolean
): string | undefined {
    if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/.test(git.branch) ||
        git.branch.includes('..') || git.branch.includes('//') || git.branch.endsWith('/') ||
        git.branch.endsWith('.') || git.branch.endsWith('.lock')) {
        return 'Configured Git branch is invalid';
    }
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(git.remote)) {
        return 'Configured Git remote is invalid';
    }
    if (!supportsRemote(git.fetchSourceUrl) || !supportsRemote(git.pushSourceUrl) ||
        !isValidRemoteRewriteBase(git.fetchUrl, supportsRemote) || !isValidRemoteRewriteBase(git.pushUrl, supportsRemote)) {
        return 'Resolved Git remote URL is invalid';
    }
    if (!isBoundedText(git.authorName, 128) || !isBoundedText(git.authorEmail, 254)) {
        return 'Configured Git author is invalid';
    }
    if (!/^[0-9a-f]{64}$/.test(operation.contentHash)) {
        return 'Operation content hash must be lowercase SHA-256';
    }
    if (!/^[A-Za-z0-9._:-]{1,128}$/.test(operation.idempotencyKey)) {
        return 'Operation idempotency key is invalid';
    }
    if (!isBoundedText(operation.relativePath, 1024)) {
        return 'Operation path contains unsupported characters';
    }
    if (!isBoundedText(operation.repositoryRelativePath, 1024)) {
        return 'Operation repository path contains unsupported characters';
    }
    if (operation.languageId !== 'markdown') {
        return 'Only Theia-detected Markdown saves can be published';
    }
    if (!isValidIsoTimestamp(operation.savedAt)) {
        return 'Operation saved timestamp is invalid';
    }
    return undefined;
}

function isValidRemoteRewriteBase(value: string, supportsRemote: (value: string) => boolean): boolean {
    return !value.includes('=') && supportsRemote(value);
}

function isBoundedText(value: string, maxLength: number): boolean {
    return value.length > 0 && value.length <= maxLength && !/[\x00-\x1f\x7f]/.test(value);
}

function isValidIsoTimestamp(value: string): boolean {
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value;
}
