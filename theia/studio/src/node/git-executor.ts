import { execFile } from 'child_process';
import * as path from 'path';
import { promisify } from 'util';
import { injectable, unmanaged } from '@theia/core/shared/inversify';
import { assertSupportedRemoteUrl, isSupportedRemoteUrl } from './git-remote-policy';

const execFileAsync = promisify(execFile);
const GIT_TIMEOUT_MS = 5000;
const GIT_NETWORK_TIMEOUT_MS = 60000;
const OUTPUT_LIMIT = 8192;
const TREE_OUTPUT_LIMIT = 4 * 1024 * 1024;
const COMMIT_LIST_OUTPUT_LIMIT = 4 * 1024 * 1024;
const FILE_OUTPUT_LIMIT = 32 * 1024 * 1024;
const BASE_CONFIG_ARGS = [
    '--no-pager',
    '-c', 'core.hooksPath=/dev/null',
    '-c', 'commit.gpgSign=false',
    '-c', 'core.fsmonitor=false',
    '-c', 'advice.detachedHead=false'
] as const;

export interface GitCommandResult {
    readonly stdout: string;
    readonly stderr: string;
    readonly exitCode: number;
}

export interface GitTreeEntry {
    readonly mode: string;
    readonly type: 'blob';
    readonly objectId: string;
    readonly size: number;
    readonly relativePath: string;
}

export interface GitNumstatEntry {
    readonly added: number;
    readonly deleted: number;
    readonly relativePath: string;
}

export interface GitRevisionCount {
    readonly left: number;
    readonly right: number;
}

export class GitCommandError extends Error {
    constructor(
        message: string,
        readonly command: readonly string[],
        readonly exitCode: number,
        readonly stdout: string,
        readonly stderr: string
    ) {
        super(message);
    }
}

@injectable()
export class GitExecutor {
    constructor(@unmanaged() protected readonly options: { readonly allowLocalTransport?: boolean } = {}) {}

    isSupportedRemoteUrl(value: string): boolean {
        return isSupportedRemoteUrl(value, this.options);
    }

    async getVersion(cwd: string): Promise<string> {
        const result = await this.run(cwd, ['--version']);
        return result.stdout.trim();
    }

    async revParseTopLevel(cwd: string): Promise<string> {
        const result = await this.run(cwd, ['rev-parse', '--show-toplevel']);
        return result.stdout.trim();
    }

    async revParseHead(cwd: string): Promise<string> {
        const result = await this.run(cwd, ['rev-parse', 'HEAD']);
        return result.stdout.trim();
    }

    async revParseAbbrevHead(cwd: string): Promise<string> {
        const result = await this.run(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']);
        return result.stdout.trim();
    }

    async revParseAbsoluteGitDir(cwd: string): Promise<string> {
        const result = await this.run(cwd, ['rev-parse', '--absolute-git-dir']);
        return result.stdout.trim();
    }

    async revParseGitCommonDir(cwd: string): Promise<string> {
        const result = await this.run(cwd, ['rev-parse', '--git-common-dir']);
        const gitCommonDirectory = result.stdout.trim();
        return path.isAbsolute(gitCommonDirectory)
            ? gitCommonDirectory
            : path.resolve(cwd, gitCommonDirectory);
    }

    async statusPorcelain(cwd: string): Promise<string[]> {
        const result = await this.run(cwd, ['status', '--porcelain=v1', '-z', '--untracked-files=all'], { preserveNull: true });
        return result.stdout.split('\0').filter(Boolean);
    }

    async diffNameOnlyCached(cwd: string): Promise<string[]> {
        const result = await this.run(cwd, ['diff', '--cached', '--name-only', '--']);
        return result.stdout.split('\n').map(line => line.trim()).filter(Boolean);
    }

    async diffNameOnlyHead(cwd: string): Promise<string[]> {
        return this.diffNameOnlyCommit(cwd, 'HEAD');
    }

    async diffNameOnlyCommit(cwd: string, commitSha: string): Promise<string[]> {
        assertCommitish(commitSha);
        const result = await this.run(cwd, ['show', '--format=', '--name-only', commitSha]);
        return result.stdout.split('\n').map(line => line.trim()).filter(Boolean);
    }

    async diffCachedNumstat(cwd: string, relativePath: string): Promise<readonly GitNumstatEntry[]> {
        assertRepositoryRelativePath(relativePath);
        const result = await this.run(cwd, ['diff', '--cached', '--numstat', '--', relativePath]);
        return result.stdout
            .split('\n')
            .map(line => line.trim())
            .filter(Boolean)
            .map(line => {
                const [added, deleted, ...pathParts] = line.split('\t');
                if (!added || !deleted || pathParts.length === 0) {
                    throw new Error('Git numstat output was malformed');
                }
                return {
                    added: added === '-' ? 0 : Number(added),
                    deleted: deleted === '-' ? 0 : Number(deleted),
                    relativePath: pathParts.join('\t')
                };
            });
    }

    async diffQuiet(cwd: string, relativePath: string): Promise<boolean> {
        assertRepositoryRelativePath(relativePath);
        const result = await this.run(cwd, ['diff', '--quiet', '--', relativePath], { allowedExitCodes: [0, 1] });
        return result.exitCode === 0;
    }

    async addPath(cwd: string, relativePath: string): Promise<void> {
        assertRepositoryRelativePath(relativePath);
        await this.run(cwd, ['add', '--', relativePath]);
    }

    async commitPath(
        cwd: string,
        message: string,
        relativePath: string,
        authorName: string,
        authorEmail: string
    ): Promise<void> {
        assertRepositoryRelativePath(relativePath);
        await this.run(cwd, [
            '-c', `user.name=${authorName}`,
            '-c', `user.email=${authorEmail}`,
            'commit',
            '--no-verify',
            '--no-post-rewrite',
            '--no-gpg-sign',
            '--only',
            '--author', `${authorName} <${authorEmail}>`,
            '-m', message,
            '--',
            relativePath
        ]);
    }

    async pullRebaseAutostash(
        cwd: string,
        remote: string,
        fetchSourceUrl: string,
        fetchUrl: string,
        branch: string,
        authorName: string,
        authorEmail: string
    ): Promise<void> {
        const remoteConfig = remoteUrlRewriteArgs(remote, fetchSourceUrl, fetchUrl, this.options.allowLocalTransport === true);
        await this.run(
            cwd,
            [
                ...this.remoteProtocolPolicyArgs(),
                ...remoteConfig,
                '-c', `user.name=${authorName}`,
                '-c', `user.email=${authorEmail}`,
                'pull',
                '--rebase',
                '--autostash',
                remote,
                branch
            ],
            {
                timeoutMs: GIT_NETWORK_TIMEOUT_MS,
                env: {
                    GIT_AUTHOR_NAME: authorName,
                    GIT_AUTHOR_EMAIL: authorEmail,
                    GIT_COMMITTER_NAME: authorName,
                    GIT_COMMITTER_EMAIL: authorEmail
                }
            }
        );
    }

    async pushBranch(cwd: string, remote: string, pushSourceUrl: string, pushUrl: string, branch: string): Promise<void> {
        const remoteConfig = remoteUrlRewriteArgs(remote, pushSourceUrl, pushUrl, this.options.allowLocalTransport === true);
        await this.run(
            cwd,
            [...this.remoteProtocolPolicyArgs(), ...remoteConfig, 'push', '--porcelain', '--no-verify', remote, `HEAD:${branch}`],
            { timeoutMs: GIT_NETWORK_TIMEOUT_MS }
        );
    }

    async getConfigValue(cwd: string, key: string): Promise<string | undefined> {
        const result = await this.run(cwd, ['config', '--local', '--get', key], { allowedExitCodes: [0, 1] });
        const value = result.stdout.trim();
        return value ? value : undefined;
    }

    async getResolvedRemoteUrl(cwd: string, remote: string, push = false): Promise<string | undefined> {
        if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(remote)) {
            throw new Error('Git remote name is invalid');
        }
        // Resolution is read-only but must see the launcher's user-level
        // url.*.insteadOf rules. Mutation commands remain isolated and receive
        // only the exact resolved URL as a command-scoped rewrite.
        const result = await this.run(
            cwd,
            ['remote', 'get-url', ...(push ? ['--push'] : []), remote],
            { allowedExitCodes: [0, 2], inheritUserConfig: true }
        );
        const value = result.stdout.trim();
        return value ? value : undefined;
    }

    async readReference(cwd: string, reference: string): Promise<string | undefined> {
        assertGitRevision(reference);
        const result = await this.run(cwd, ['rev-parse', reference], { allowedExitCodes: [0, 128] });
        const value = result.stdout.trim();
        return result.exitCode === 0 && value ? value : undefined;
    }

    async countRevisionRange(cwd: string, left: string, right: string): Promise<GitRevisionCount> {
        assertGitRevision(left);
        assertGitRevision(right);
        const result = await this.run(cwd, ['rev-list', '--left-right', '--count', `${left}...${right}`]);
        const match = /^\s*(\d+)\s+(\d+)\s*$/.exec(result.stdout);
        if (!match) {
            throw new Error('Git revision count output was malformed');
        }
        return {
            left: Number(match[1]),
            right: Number(match[2])
        };
    }

    async addRemote(cwd: string, remote: string, remoteUrl: string): Promise<void> {
        assertRemoteName(remote);
        assertRemoteUrl(remoteUrl, this.options.allowLocalTransport === true);
        await this.run(cwd, ['remote', 'add', remote, remoteUrl]);
    }

    async setRemoteUrl(cwd: string, remote: string, remoteUrl: string): Promise<void> {
        assertRemoteName(remote);
        assertRemoteUrl(remoteUrl, this.options.allowLocalTransport === true);
        await this.run(cwd, ['remote', 'set-url', remote, remoteUrl]);
    }

    async cloneRepository(
        cwd: string,
        remoteUrl: string,
        destination: string,
        options: {
            branch?: string;
            signal?: AbortSignal;
        } = {}
    ): Promise<void> {
        assertRemoteUrl(remoteUrl, this.options.allowLocalTransport === true);
        assertFilesystemPath(destination);
        const branchArgs = options.branch ? ['--branch', assertAndReturnGitRef(options.branch)] : [];
        await this.run(
            cwd,
            [...this.remoteProtocolPolicyArgs(), 'clone', '--origin', 'origin', '--no-tags', '--single-branch', ...branchArgs, '--', remoteUrl, destination],
            { timeoutMs: GIT_NETWORK_TIMEOUT_MS, signal: options.signal }
        );
    }

    async fetchRemote(
        cwd: string,
        remote: string,
        ref?: string,
        options: {
            signal?: AbortSignal;
        } = {}
    ): Promise<void> {
        assertRemoteName(remote);
        const refspec = ref ? `${assertAndReturnGitRef(ref)}:refs/remotes/${remote}/${ref}` : undefined;
        await this.run(
            cwd,
            [...this.remoteProtocolPolicyArgs(), 'fetch', '--prune', '--no-tags', remote, ...(refspec ? [refspec] : [])],
            { timeoutMs: GIT_NETWORK_TIMEOUT_MS, signal: options.signal }
        );
    }

    async mergeFastForwardOnly(
        cwd: string,
        revision: string,
        options: {
            signal?: AbortSignal;
        } = {}
    ): Promise<void> {
        assertGitRevision(revision);
        await this.run(cwd, ['merge', '--ff-only', revision], { signal: options.signal });
    }

    async forceCheckoutBranch(
        cwd: string,
        branch: string,
        startPoint: string,
        options: {
            signal?: AbortSignal;
        } = {}
    ): Promise<void> {
        assertGitRefName(branch);
        assertGitRevision(startPoint);
        await this.run(cwd, ['checkout', '--force', '-B', branch, startPoint], { signal: options.signal });
    }

    async getUnsafeLocalConfigKeys(cwd: string): Promise<string[]> {
        const result = await this.run(cwd, [
            'config',
            '--local',
            '--name-only',
            '--get-regexp',
            '^(alias\\.|credential\\.|http\\.|url\\..*\\.(insteadof|pushinsteadof)$|remote\\..*\\.proxy$|core\\.sshcommand$)'
        ], { allowedExitCodes: [0, 1] });
        return result.stdout.split('\n').map(line => line.trim()).filter(Boolean);
    }

    protected remoteProtocolPolicyArgs(): readonly string[] {
        return [
            '-c', 'protocol.allow=never',
            '-c', 'protocol.https.allow=always',
            '-c', 'protocol.ssh.allow=always',
            ...(this.options.allowLocalTransport ? ['-c', 'protocol.file.allow=always'] : [])
        ];
    }

    async getHeadMessage(cwd: string): Promise<string> {
        return this.getCommitMessage(cwd, 'HEAD');
    }

    async getCommitMessage(cwd: string, commitSha: string): Promise<string> {
        assertCommitish(commitSha);
        const result = await this.run(cwd, ['log', '-1', '--format=%B', commitSha]);
        return result.stdout.replace(/\s+$/, '');
    }

    async findReachableCommitsByMessage(cwd: string, messageLine: string): Promise<readonly string[]> {
        if (!messageLine || messageLine.length > 512 || /[\x00-\x1f\x7f]/.test(messageLine)) {
            throw new Error('Git commit message search is invalid');
        }
        const stdout = await this.runBuffer(
            cwd,
            [
                'log',
                '--format=%H',
                '--fixed-strings',
                `--grep=${messageLine}`,
                'HEAD'
            ],
            COMMIT_LIST_OUTPUT_LIMIT
        );
        return stdout.toString('utf8')
            .split('\n')
            .map(line => line.trim())
            .filter(Boolean)
            .map(commitSha => {
                assertObjectId(commitSha);
                return commitSha;
            });
    }

    async readPathFromIndex(cwd: string, relativePath: string): Promise<Buffer> {
        return this.readPathAtRevision(cwd, ':', relativePath);
    }

    async readPathFromHead(cwd: string, relativePath: string): Promise<Buffer> {
        return this.readPathAtRevision(cwd, 'HEAD:', relativePath);
    }

    async gitPath(cwd: string, relativeGitPath: string): Promise<string> {
        const result = await this.run(cwd, ['rev-parse', '--git-path', relativeGitPath]);
        return result.stdout.trim();
    }

    async listTreeEntries(cwd: string, commitSha: string): Promise<readonly GitTreeEntry[]> {
        assertObjectId(commitSha);
        const stdout = await this.runBuffer(
            cwd,
            ['ls-tree', '-r', '-z', '-l', '--full-tree', commitSha, '--'],
            TREE_OUTPUT_LIMIT
        );
        const entries: GitTreeEntry[] = [];
        for (const record of stdout.toString('utf8').split('\0')) {
            if (!record) {
                continue;
            }
            const match = /^([0-7]{6}) (blob|tree) ([0-9a-f]{40,64})\s+([0-9-]+)\t([\s\S]+)$/.exec(record);
            if (!match) {
                throw new Error('Git tree contained a malformed entry');
            }
            if (match[2] === 'blob') {
                entries.push({
                    mode: match[1],
                    type: 'blob',
                    objectId: match[3],
                    size: Number(match[4]),
                    relativePath: match[5]
                });
            }
        }
        return entries;
    }

    async readBlob(cwd: string, objectId: string, maxBytes: number): Promise<Buffer> {
        assertObjectId(objectId);
        if (!Number.isSafeInteger(maxBytes) || maxBytes < 0 || maxBytes > TREE_OUTPUT_LIMIT) {
            throw new Error(`Invalid Git blob byte limit: ${maxBytes}`);
        }
        return this.runBuffer(cwd, ['cat-file', 'blob', objectId], maxBytes + 1);
    }

    protected async readPathAtRevision(cwd: string, revisionPrefix: ':' | 'HEAD:', relativePath: string): Promise<Buffer> {
        assertRepositoryRelativePath(relativePath);
        return this.runBuffer(
            cwd,
            ['show', '--no-ext-diff', '--no-textconv', `${revisionPrefix}${relativePath}`],
            FILE_OUTPUT_LIMIT
        );
    }

    protected async run(
        cwd: string,
        gitArgs: readonly string[],
        options: {
            allowedExitCodes?: readonly number[];
            preserveNull?: boolean;
            env?: NodeJS.ProcessEnv;
            timeoutMs?: number;
            inheritUserConfig?: boolean;
            signal?: AbortSignal;
        } = {}
    ): Promise<GitCommandResult> {
        const allowedExitCodes = options.allowedExitCodes ?? [0];
        const command = [...BASE_CONFIG_ARGS, ...gitArgs];
        try {
            const result = await execFileAsync('git', command, {
                cwd,
                timeout: options.timeoutMs ?? GIT_TIMEOUT_MS,
                maxBuffer: OUTPUT_LIMIT,
                env: gitEnvironment(options.env, options.inheritUserConfig),
                signal: options.signal
            });
            return {
                stdout: truncate(result.stdout ?? '', options.preserveNull),
                stderr: truncate(result.stderr ?? ''),
                exitCode: 0
            };
        } catch (error) {
            if (isAbortError(error)) {
                throw error;
            }
            const exitCode = typeof error === 'object' && error !== null && 'code' in error && typeof (error as { code?: unknown }).code === 'number'
                ? (error as { code: number }).code
                : -1;
            const stdout = truncate(typeof error === 'object' && error !== null && 'stdout' in error ? String((error as { stdout?: unknown }).stdout ?? '') : '');
            const stderr = truncate(typeof error === 'object' && error !== null && 'stderr' in error ? String((error as { stderr?: unknown }).stderr ?? '') : '');
            if (allowedExitCodes.includes(exitCode)) {
                return { stdout, stderr, exitCode };
            }
            throw new GitCommandError(
                `git ${gitArgs[0] ?? 'command'} failed with exit code ${exitCode}`,
                command.map(argument => sanitize(argument)),
                exitCode,
                stdout,
                stderr
            );
        }
    }

    private async runBuffer(cwd: string, gitArgs: readonly string[], maxBuffer: number): Promise<Buffer> {
        const command = [...BASE_CONFIG_ARGS, ...gitArgs];
        try {
            const result = await execFileAsync('git', command, {
                cwd,
                timeout: GIT_TIMEOUT_MS,
                maxBuffer,
                encoding: 'buffer',
                env: gitEnvironment()
            });
            return Buffer.isBuffer(result.stdout) ? result.stdout : Buffer.from(result.stdout ?? '');
        } catch (error) {
            const exitCode = typeof error === 'object' && error !== null && 'code' in error && typeof (error as { code?: unknown }).code === 'number'
                ? (error as { code: number }).code
                : -1;
            const stderrValue = typeof error === 'object' && error !== null && 'stderr' in error
                ? (error as { stderr?: unknown }).stderr
                : '';
            const stderr = truncate(Buffer.isBuffer(stderrValue) ? stderrValue.toString('utf8') : String(stderrValue ?? ''));
            throw new GitCommandError(
                `git ${gitArgs[0] ?? 'command'} failed with exit code ${exitCode}`,
                command.map(argument => sanitize(argument)),
                exitCode,
                '',
                stderr
            );
        }
    }
}

function assertObjectId(value: string): void {
    if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(value)) {
        throw new Error('Git object ID must be a full hexadecimal SHA');
    }
}

function assertCommitish(value: string): void {
    if (value === 'HEAD') {
        return;
    }
    assertObjectId(value);
}

function assertGitRevision(value: string): void {
    if (value === 'HEAD') {
        return;
    }
    if (/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(value)) {
        return;
    }
    assertGitRefName(value);
}

function assertGitRefName(value: string): void {
    if (
        !value
        || value.length > 255
        || value.startsWith('-')
        || value.startsWith('/')
        || value.endsWith('/')
        || value.includes('\\')
        || value.includes('..')
        || value.includes('//')
        || value.includes('@{')
        || /[\x00-\x1f\x7f\s:?*\[\]^~]/.test(value)
    ) {
        throw new Error('Git reference is invalid');
    }
}

function assertAndReturnGitRef(value: string): string {
    assertGitRefName(value);
    return value;
}

function assertRepositoryRelativePath(value: string): void {
    if (!value || value === '.' || value.includes('\0') || value.includes('\\') || value.startsWith('-')) {
        throw new Error('Git path must be a repository-relative path');
    }
    const normalized = path.posix.normalize(value);
    if (path.posix.isAbsolute(value) || normalized === '.' || normalized.startsWith('../') || normalized !== value) {
        throw new Error('Git path must stay inside the repository');
    }
}

function remoteUrlRewriteArgs(remote: string, sourceUrl: string, resolvedUrl: string, allowLocalTransport: boolean): readonly string[] {
    assertRemoteName(remote);
    assertRemoteUrl(sourceUrl, allowLocalTransport);
    assertRemoteRewriteBase(resolvedUrl, allowLocalTransport);
    return [
        '-c', `url.${resolvedUrl}.insteadOf=${sourceUrl}`
    ];
}

function assertRemoteName(remote: string): void {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(remote)) {
        throw new Error('Git remote name is invalid');
    }
}

function assertRemoteRewriteBase(value: string, allowLocalTransport = false): void {
    assertRemoteUrl(value, allowLocalTransport);
    if (value.includes('=')) {
        throw new Error('Resolved Git remote URL cannot be represented as a command-scoped rewrite');
    }
}

function assertRemoteUrl(value: string, allowLocalTransport = false): void {
    assertSupportedRemoteUrl(value, { allowLocalTransport });
}

function assertFilesystemPath(value: string): void {
    if (!value || value.includes('\0')) {
        throw new Error('Filesystem path is invalid');
    }
}

function truncate(value: string, preserveNull = false): string {
    const sanitized = sanitize(value, preserveNull);
    return sanitized.length > OUTPUT_LIMIT ? `${sanitized.slice(0, OUTPUT_LIMIT)}...[truncated]` : sanitized;
}

function sanitize(value: string, preserveNull = false): string {
    return value
        .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
        .replace(/(https?:\/\/)[^/@\s]+@/gi, '$1[redacted]@')
        .replace(preserveNull ? /[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]/g : /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '\uFFFD');
}

function gitEnvironment(additions?: NodeJS.ProcessEnv, inheritUserConfig = false): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = {};
    for (const [key, value] of Object.entries(process.env)) {
        if (!key.startsWith('GIT_')) {
            env[key] = value;
        }
    }
    const isolatedConfig = inheritUserConfig
        ? {}
        : {
            GIT_CONFIG_NOSYSTEM: '1',
            GIT_CONFIG_GLOBAL: '/dev/null'
        };
    return {
        ...env,
        ...isolatedConfig,
        GIT_TERMINAL_PROMPT: '0',
        GIT_ASKPASS: '/usr/bin/false',
        HUSKY: '0',
        ...additions
    };
}

function isAbortError(error: unknown): boolean {
    return typeof error === 'object'
        && error !== null
        && ('name' in error && (error as { name?: unknown }).name === 'AbortError');
}
