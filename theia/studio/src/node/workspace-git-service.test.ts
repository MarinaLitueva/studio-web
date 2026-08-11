import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { GitCommandError, type GitRevisionCount } from './git-executor';
import { assertSupportedRemoteUrl } from './git-remote-policy';
import {
    sanitizeSecretText,
    WorkspaceGitService,
    type WorkspaceGitClient,
    type WorkspaceGitSourceTarget
} from './workspace-git-service';

describe('workspace git service', () => {
    let tempDir: string;

    beforeEach(async () => {
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'workspace-git-service-'));
    });

    afterEach(async () => {
        await fs.rm(tempDir, { recursive: true, force: true });
    });

    it('inspects without network commands and reports a clean repository', async () => {
        const localPath = path.join(tempDir, 'source');
        await fs.mkdir(localPath, { recursive: true });
        const git = new FakeGitClient();
        git.setRepository(localPath, {
            remoteUrl: 'https://github.com/example/repo.git',
            branch: 'main',
            head: '1111111111111111111111111111111111111111'
        });
        const service = new WorkspaceGitService(git);

        const inspection = await service.inspectConfiguredSource(target(localPath));

        expect(inspection.state).toBe('clean');
        expect(inspection.currentRevision).toBe('1111111111111111111111111111111111111111');
        expect(git.calls).toEqual([
            `revParseTopLevel:${localPath}`,
            `getConfigValue:${localPath}:remote.origin.url`,
            `revParseAbbrevHead:${localPath}`,
            `revParseHead:${localPath}`,
            `statusPorcelain:${localPath}`,
            `readReference:${localPath}:refs/remotes/origin/main`,
            `countRevisionRange:${localPath}:HEAD...refs/remotes/origin/main`
        ]);
    });

    it('blocks inspect on wrong remote without fetching', async () => {
        const localPath = path.join(tempDir, 'source');
        await fs.mkdir(localPath, { recursive: true });
        const git = new FakeGitClient();
        git.setRepository(localPath, {
            remoteUrl: 'https://github.com/example/other.git',
            branch: 'main',
            head: '1111111111111111111111111111111111111111'
        });
        const service = new WorkspaceGitService(git);

        const inspection = await service.inspectConfiguredSource(target(localPath));

        expect(inspection.state).toBe('wrong-remote');
        expect(inspection.actualRemoteUrl).toBe('https://github.com/example/other.git');
        expect(git.calls.some(call => call.startsWith('fetchRemote:'))).toBe(false);
    });

    it('blocks normal update on dirty and diverged repositories before fetch', async () => {
        const dirtyPath = path.join(tempDir, 'dirty');
        const divergedPath = path.join(tempDir, 'diverged');
        await fs.mkdir(dirtyPath, { recursive: true });
        await fs.mkdir(divergedPath, { recursive: true });
        const dirtyGit = new FakeGitClient();
        dirtyGit.setRepository(dirtyPath, {
            remoteUrl: 'https://github.com/example/repo.git',
            branch: 'main',
            head: '1111111111111111111111111111111111111111',
            statusEntries: ['?? scratch.txt']
        });
        const divergedGit = new FakeGitClient();
        divergedGit.setRepository(divergedPath, {
            remoteUrl: 'https://github.com/example/repo.git',
            branch: 'main',
            head: '1111111111111111111111111111111111111111',
            counts: { left: 1, right: 2 }
        });

        const dirtyResult = await new WorkspaceGitService(dirtyGit).fastForwardUpdate(target(dirtyPath));
        const divergedResult = await new WorkspaceGitService(divergedGit).fastForwardUpdate(target(divergedPath));

        expect(dirtyResult).toMatchObject({ outcome: 'conflict', code: 'source-conflict' });
        expect(divergedResult).toMatchObject({ outcome: 'conflict', code: 'source-conflict' });
        expect(dirtyGit.calls.some(call => call.startsWith('fetchRemote:'))).toBe(false);
        expect(divergedGit.calls.some(call => call.startsWith('fetchRemote:'))).toBe(false);
    });

    it('clones into a temp sibling and cleans it up on auth failure with redacted output', async () => {
        const resolveRoot = path.join(tempDir, '.workspace-sources');
        const localPath = path.join(resolveRoot, 'repo');
        await fs.mkdir(resolveRoot, { recursive: true });
        const git = new FakeGitClient();
        git.cloneError = new GitCommandError(
            'clone failed',
            ['clone'],
            128,
            '',
            'fatal: could not read Username for https://user:secret@example.com/repo.git: terminal prompts disabled'
        );
        const service = new WorkspaceGitService(git);

        const result = await service.cloneMissingSource(target(localPath, { resolveRoot }));

        expect(result).toEqual({
            outcome: 'auth-required',
            sourceId: 'repo',
            message: 'fatal: could not read Username for https://[redacted]@example.com/repo.git: terminal prompts disabled\nclone failed'
        });
        expect(git.cloneDestinations).toHaveLength(1);
        expect(git.cloneDestinations[0]).not.toBe(localPath);
        expect(path.dirname(git.cloneDestinations[0]!)).toBe(resolveRoot);
        expect(path.basename(git.cloneDestinations[0]!)).toMatch(/^repo\.tmp-/);
        expect(await fs.readdir(resolveRoot)).toEqual([]);
    });

    it('stops clone activation when the final destination appears concurrently', async () => {
        const resolveRoot = path.join(tempDir, '.workspace-sources');
        const localPath = path.join(resolveRoot, 'repo');
        await fs.mkdir(resolveRoot, { recursive: true });
        const git = new FakeGitClient();
        git.onClone = async destination => {
            git.setRepository(destination, {
                remoteUrl: 'https://github.com/example/repo.git',
                branch: 'main',
                head: '2222222222222222222222222222222222222222'
            });
            await fs.mkdir(localPath, { recursive: true });
        };
        const service = new WorkspaceGitService(git);

        const result = await service.cloneMissingSource(target(localPath, { resolveRoot }));

        expect(result).toMatchObject({
            outcome: 'conflict',
            code: 'source-conflict',
            message: 'Configured source appeared concurrently during clone activation.'
        });
        expect(await fs.readdir(resolveRoot)).toEqual(['repo']);
    });

    it('cleans temp clones when cancelled before activation', async () => {
        const resolveRoot = path.join(tempDir, '.workspace-sources');
        const localPath = path.join(resolveRoot, 'repo');
        await fs.mkdir(resolveRoot, { recursive: true });
        const controller = new AbortController();
        const git = new FakeGitClient();
        git.onClone = async destination => {
            git.setRepository(destination, {
                remoteUrl: 'https://github.com/example/repo.git',
                branch: 'main',
                head: '3333333333333333333333333333333333333333'
            });
            controller.abort();
        };
        const service = new WorkspaceGitService(git);

        const result = await service.cloneMissingSource(target(localPath, { resolveRoot }), controller.signal);

        expect(result).toEqual({
            outcome: 'cancelled',
            sourceId: 'repo',
            phase: 'pre-activation'
        });
        expect(await fs.readdir(resolveRoot)).toEqual([]);
    });

    it('reports completed-needs-inspection when cancellation happens after activation', async () => {
        const resolveRoot = path.join(tempDir, '.workspace-sources');
        const localPath = path.join(resolveRoot, 'repo');
        await fs.mkdir(resolveRoot, { recursive: true });
        const controller = new AbortController();
        const git = new FakeGitClient();
        git.onClone = async destination => {
            git.setRepository(destination, {
                remoteUrl: 'https://github.com/example/repo.git',
                branch: 'main',
                head: '4444444444444444444444444444444444444444'
            });
        };
        const service = new WorkspaceGitService(git, {
            access: fs.access.bind(fs),
            lstat: fs.lstat.bind(fs),
            mkdir: fs.mkdir.bind(fs),
            realpath: fs.realpath.bind(fs),
            rm: fs.rm.bind(fs),
            rename: async (from, to) => {
                await fs.rename(from, to);
                controller.abort();
            }
        });

        const result = await service.cloneMissingSource(target(localPath, { resolveRoot }), controller.signal);

        expect(result).toEqual({
            outcome: 'completed-needs-inspection',
            sourceId: 'repo',
            phase: 'post-activation',
            localPath
        });
        expect(await fs.readdir(resolveRoot)).toEqual(['repo']);
    });

    it('performs fast-forward updates with fetch then ff-only merge', async () => {
        const localPath = path.join(tempDir, 'source');
        await fs.mkdir(localPath, { recursive: true });
        const git = new FakeGitClient();
        git.setRepository(localPath, {
            remoteUrl: 'https://github.com/example/repo.git',
            branch: 'main',
            head: '1111111111111111111111111111111111111111',
            counts: { left: 0, right: 1 },
            trackingRevision: '5555555555555555555555555555555555555555'
        });
        const service = new WorkspaceGitService(git);

        const result = await service.fastForwardUpdate(target(localPath));

        expect(result).toEqual({
            outcome: 'updated',
            sourceId: 'repo',
            localPath,
            revision: '5555555555555555555555555555555555555555'
        });
        expect(git.mutationCalls).toEqual([
            `fetchRemote:${localPath}:origin:main`,
            `mergeFastForwardOnly:${localPath}:refs/remotes/origin/main`
        ]);
    });

    it('reconciles an existing remote with an explicit set-url operation', async () => {
        const localPath = path.join(tempDir, 'source');
        await fs.mkdir(localPath, { recursive: true });
        const git = new FakeGitClient();
        git.setRepository(localPath, {
            remoteUrl: 'https://github.com/example/other.git',
            branch: 'main',
            head: '1111111111111111111111111111111111111111'
        });
        const service = new WorkspaceGitService(git);

        const result = await service.reconcileExistingRemote(target(localPath));

        expect(result).toEqual({
            outcome: 'reconciled-remote',
            sourceId: 'repo',
            localPath,
            revision: '1111111111111111111111111111111111111111'
        });
        expect(git.mutationCalls).toEqual([
            `setRemoteUrl:${localPath}:origin:https://github.com/example/repo.git`
        ]);
    });

    it('requires explicit confirmation and revision matching for force updates', async () => {
        const localPath = path.join(tempDir, 'source');
        await fs.mkdir(localPath, { recursive: true });
        const git = new FakeGitClient();
        git.setRepository(localPath, {
            remoteUrl: 'https://github.com/example/repo.git',
            branch: 'main',
            head: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
            counts: { left: 1, right: 0 },
            trackingRevision: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
        });
        const service = new WorkspaceGitService(git);

        const confirmResult = await service.forceUpdate({ ...target(localPath), forceConfirmed: false, expectedRevision: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' });
        const revisionResult = await service.forceUpdate({ ...target(localPath), forceConfirmed: true, expectedRevision: 'cccccccccccccccccccccccccccccccccccccccc' });
        const forceResult = await service.forceUpdate({
            ...target(localPath),
            forceConfirmed: true,
            expectedRevision: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
            expectedRemoteRevision: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
        });

        expect(confirmResult).toMatchObject({ outcome: 'conflict', code: 'confirmation-required' });
        expect(revisionResult).toMatchObject({ outcome: 'conflict', code: 'source-conflict' });
        expect(forceResult).toEqual({
            outcome: 'force-updated',
            sourceId: 'repo',
            localPath,
            revision: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'
        });
        expect(git.mutationCalls).toEqual([
            `fetchRemote:${localPath}:origin:main`,
            `forceCheckoutBranch:${localPath}:main:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb`
        ]);
    });

    it('rejects force update when the confirmed remote revision drifts after fetch', async () => {
        const localPath = path.join(tempDir, 'source');
        await fs.mkdir(localPath, { recursive: true });
        const git = new FakeGitClient();
        git.setRepository(localPath, {
            head: 'a'.repeat(40),
            trackingRevision: 'b'.repeat(40),
            counts: { left: 1, right: 1 }
        });
        git.onFetch = cwd => {
            git.repositories.get(path.resolve(cwd))!.trackingRevision = 'c'.repeat(40);
        };

        const result = await new WorkspaceGitService(git).forceUpdate({
            ...target(localPath),
            forceConfirmed: true,
            expectedRevision: 'a'.repeat(40),
            expectedRemoteRevision: 'b'.repeat(40)
        });

        expect(result).toMatchObject({ outcome: 'conflict', code: 'source-conflict' });
        expect(git.mutationCalls).toEqual([`fetchRemote:${localPath}:origin:main`]);
    });

    it('rejects helper and local transports while allowing supported network remotes', () => {
        expect(() => assertSupportedRemoteUrl('https://github.com/example/repo.git')).not.toThrow();
        expect(() => assertSupportedRemoteUrl('git@github.com:example/repo.git')).not.toThrow();
        expect(() => assertSupportedRemoteUrl('git://github.com/example/repo.git')).toThrow();
        expect(() => assertSupportedRemoteUrl('ext::sh -c exploit')).toThrow();
        expect(() => assertSupportedRemoteUrl('file:///tmp/repo')).toThrow();
    });

    it('blocks an unsupported configured remote before a missing source can be previewed for clone', async () => {
        const localPath = path.join(tempDir, 'missing-source');
        const git = new FakeGitClient();

        const result = await new WorkspaceGitService(git).inspectConfiguredSource(target(localPath, {
            remoteUrl: 'ext::sh -c exploit'
        }));

        expect(result).toMatchObject({
            state: 'wrong-remote',
            message: 'Configured source uses an unsupported or unsafe Git remote transport.'
        });
        expect(git.calls).toEqual([]);
        expect(git.mutationCalls).toEqual([]);
    });

    it('blocks sync inspection when repository-local Git config can alter transport execution', async () => {
        const localPath = path.join(tempDir, 'source');
        await fs.mkdir(localPath, { recursive: true });
        const git = new FakeGitClient();
        git.setRepository(localPath);
        git.unsafeLocalConfigKeys = ['url.ssh://attacker.invalid/.pushinsteadof'];

        await expect(new WorkspaceGitService(git).inspectConfiguredSource(target(localPath))).resolves.toMatchObject({
            state: 'wrong-remote',
            message: 'Configured source has unsafe repository-local Git configuration.'
        });
    });

    it('redacts credentials in userinfo, query, path, scp syntax, and malformed error text', () => {
        const sanitized = sanitizeSecretText([
            'https://user:pass@example.com/repo?token=secret&plain=value',
            'https://example.com/token/secret-value/repo',
            'user:pass@example.com:repo.git',
            'password=hunter2'
        ].join('\n'));
        expect(sanitized).not.toMatch(/user:pass|secret-value|token=secret(?:&|$)|hunter2|plain=value/);
        expect(sanitized).toContain('[redacted]');
    });

    it('rejects clone destinations that cross a symlinked resolve root', async () => {
        const realRoot = path.join(tempDir, 'real-root');
        const linkRoot = path.join(tempDir, 'linked-root');
        await fs.mkdir(realRoot, { recursive: true });
        await fs.symlink(realRoot, linkRoot);
        const service = new WorkspaceGitService(new FakeGitClient());

        await expect(service.cloneMissingSource(target(path.join(linkRoot, 'repo'), { resolveRoot: linkRoot })))
            .rejects
            .toThrow('Configured resolve.workdir root cannot be a symbolic link.');
    });
});

function target(localPath: string, overrides: Partial<WorkspaceGitSourceTarget> = {}): WorkspaceGitSourceTarget {
    return {
        sourceId: 'repo',
        localPath,
        remoteUrl: 'https://github.com/example/repo.git',
        ref: 'main',
        ...overrides
    };
}

interface RepoState {
    remoteUrl?: string;
    branch: string;
    head: string;
    statusEntries: string[];
    trackingRevision?: string;
    counts: GitRevisionCount;
}

class FakeGitClient implements WorkspaceGitClient {
    readonly calls: string[] = [];
    readonly mutationCalls: string[] = [];
    readonly cloneDestinations: string[] = [];
    readonly repositories = new Map<string, RepoState>();
    cloneError: Error | undefined;
    onClone: ((destination: string) => Promise<void> | void) | undefined;
    onFetch: ((cwd: string) => Promise<void> | void) | undefined;
    unsafeLocalConfigKeys: string[] = [];

    setRepository(repositoryPath: string, state: Partial<RepoState> = {}): void {
        this.repositories.set(path.resolve(repositoryPath), {
            branch: state.branch ?? 'main',
            head: state.head ?? '1111111111111111111111111111111111111111',
            remoteUrl: state.remoteUrl ?? 'https://github.com/example/repo.git',
            statusEntries: [...(state.statusEntries ?? [])],
            trackingRevision: state.trackingRevision ?? state.head ?? '1111111111111111111111111111111111111111',
            counts: state.counts ?? { left: 0, right: 0 }
        });
    }

    async revParseTopLevel(cwd: string): Promise<string> {
        this.calls.push(`revParseTopLevel:${cwd}`);
        this.requireRepository(cwd);
        return path.resolve(cwd);
    }

    async getConfigValue(cwd: string, key: string): Promise<string | undefined> {
        this.calls.push(`getConfigValue:${cwd}:${key}`);
        return this.requireRepository(cwd).remoteUrl;
    }

    async revParseAbbrevHead(cwd: string): Promise<string> {
        this.calls.push(`revParseAbbrevHead:${cwd}`);
        return this.requireRepository(cwd).branch;
    }

    async revParseHead(cwd: string): Promise<string> {
        this.calls.push(`revParseHead:${cwd}`);
        return this.requireRepository(cwd).head;
    }

    async statusPorcelain(cwd: string): Promise<string[]> {
        this.calls.push(`statusPorcelain:${cwd}`);
        return [...this.requireRepository(cwd).statusEntries];
    }

    async readReference(cwd: string, reference: string): Promise<string | undefined> {
        this.calls.push(`readReference:${cwd}:${reference}`);
        return this.requireRepository(cwd).trackingRevision;
    }

    async countRevisionRange(cwd: string, left: string, right: string): Promise<GitRevisionCount> {
        this.calls.push(`countRevisionRange:${cwd}:${left}...${right}`);
        return this.requireRepository(cwd).counts;
    }

    async cloneRepository(cwd: string, remoteUrl: string, destination: string): Promise<void> {
        this.calls.push(`cloneRepository:${cwd}:${remoteUrl}:${destination}`);
        this.mutationCalls.push(`cloneRepository:${cwd}:${remoteUrl}:${destination}`);
        this.cloneDestinations.push(destination);
        if (this.cloneError) {
            throw this.cloneError;
        }
        await fs.mkdir(destination, { recursive: true });
        this.setRepository(destination, {
            remoteUrl,
            branch: 'main',
            head: '9999999999999999999999999999999999999999'
        });
        await this.onClone?.(destination);
    }

    async addRemote(cwd: string, remote: string, remoteUrl: string): Promise<void> {
        this.calls.push(`addRemote:${cwd}:${remote}:${remoteUrl}`);
        this.mutationCalls.push(`addRemote:${cwd}:${remote}:${remoteUrl}`);
        this.requireRepository(cwd).remoteUrl = remoteUrl;
    }

    async setRemoteUrl(cwd: string, remote: string, remoteUrl: string): Promise<void> {
        this.calls.push(`setRemoteUrl:${cwd}:${remote}:${remoteUrl}`);
        this.mutationCalls.push(`setRemoteUrl:${cwd}:${remote}:${remoteUrl}`);
        this.requireRepository(cwd).remoteUrl = remoteUrl;
    }

    async fetchRemote(cwd: string, remote: string, ref?: string): Promise<void> {
        this.calls.push(`fetchRemote:${cwd}:${remote}:${ref ?? ''}`);
        this.mutationCalls.push(`fetchRemote:${cwd}:${remote}:${ref ?? ''}`);
        await this.onFetch?.(cwd);
    }

    async mergeFastForwardOnly(cwd: string, revision: string): Promise<void> {
        this.calls.push(`mergeFastForwardOnly:${cwd}:${revision}`);
        this.mutationCalls.push(`mergeFastForwardOnly:${cwd}:${revision}`);
        const repository = this.requireRepository(cwd);
        repository.head = repository.trackingRevision ?? repository.head;
        repository.counts = { left: 0, right: 0 };
    }

    async forceCheckoutBranch(cwd: string, branch: string, startPoint: string): Promise<void> {
        this.calls.push(`forceCheckoutBranch:${cwd}:${branch}:${startPoint}`);
        this.mutationCalls.push(`forceCheckoutBranch:${cwd}:${branch}:${startPoint}`);
        const repository = this.requireRepository(cwd);
        repository.branch = branch;
        repository.head = repository.trackingRevision ?? repository.head;
        repository.counts = { left: 0, right: 0 };
        repository.statusEntries = [];
    }

    async getUnsafeLocalConfigKeys(): Promise<string[]> {
        return [...this.unsafeLocalConfigKeys];
    }

    protected requireRepository(cwd: string): RepoState {
        const repository = this.repositories.get(path.resolve(cwd));
        if (!repository) {
            throw new GitCommandError(
                'not a repo',
                ['rev-parse'],
                128,
                '',
                'fatal: not a git repository'
            );
        }
        return repository;
    }
}
