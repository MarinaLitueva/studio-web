import 'reflect-metadata';
import * as childProcess from 'child_process';
import { KitInstallerImpl } from './kit-installer';
import type { RepositoryRegistry } from './repository-registry';

type ExecFileCallback = (error: Error | null, stdout: string, stderr: string) => void;

describe('kit installer', () => {
    afterEach(() => jest.restoreAllMocks());

    it('runs only the allow-listed kit and regenerates agent integrations', async () => {
        const calls: Array<{ executable: string; args: string[]; cwd: string | undefined }> = [];
        jest.spyOn(childProcess, 'execFile').mockImplementation(((executable, args, options, callback) => {
            calls.push({
                executable: String(executable),
                args: [...(args ?? [])].map(String),
                cwd: options && typeof options === 'object' ? options.cwd?.toString() : undefined
            });
            (callback as ExecFileCallback)(null, 'ok', '');
            return {} as childProcess.ChildProcess;
        }) as typeof childProcess.execFile);

        const result = await new KitInstallerImpl().install(
            { kitSlug: 'sdlc', version: 'v1.2.3' },
            registry([{ id: 'repo-1', label: 'app', root: '/workspace/app' }])
        );

        expect(result).toMatchObject({
            kitSlug: 'sdlc',
            version: 'v1.2.3',
            repositoryId: 'repo-1',
            repositoryLabel: 'app'
        });
        expect(calls).toEqual([
            {
                executable: 'cfs',
                args: ['kit', 'install', 'constructorfabric/studio-kit-sdlc', '--version', 'v1.2.3'],
                cwd: '/workspace/app'
            },
            {
                executable: 'cfs',
                args: ['generate-agents'],
                cwd: '/workspace/app'
            }
        ]);
    });

    it('rejects unknown kits and option-like refs before executing a process', async () => {
        const run = jest.spyOn(childProcess, 'execFile');
        const repositories = registry([{ id: 'repo-1', label: 'app', root: '/workspace/app' }]);
        await expect(new KitInstallerImpl().install(
            { kitSlug: 'custom', version: 'main' }, repositories
        )).rejects.toThrow('not allow-listed');
        await expect(new KitInstallerImpl().install(
            { kitSlug: 'sdlc', version: '--help' }, repositories
        )).rejects.toThrow('safe Git ref');
        expect(run).not.toHaveBeenCalled();
    });

    it('defaults to the project repository in a multi-repository workspace', async () => {
        const directories: string[] = [];
        jest.spyOn(childProcess, 'execFile').mockImplementation(((executable, args, options, callback) => {
            directories.push(options && typeof options === 'object' ? String(options.cwd) : '');
            (callback as ExecFileCallback)(null, 'ok', '');
            return {} as childProcess.ChildProcess;
        }) as typeof childProcess.execFile);

        const result = await new KitInstallerImpl().install(
            { kitSlug: 'sdlc', version: 'main' },
            registry([
                { id: 'repo-app', label: 'app', root: '/workspace/app' },
                { id: 'repo-docs', label: 'docs', root: '/workspace/docs' },
                { id: 'repo-project', label: 'project', root: '/workspace' }
            ], '/workspace')
        );

        // Deliberately not the first entry: the registry is ordered
        // deepest-first, so a positional default would have installed the kit
        // into a source clone instead of the project root.
        expect(result).toMatchObject({ repositoryId: 'repo-project', repositoryLabel: 'project' });
        expect(directories).toEqual(['/workspace', '/workspace']);
    });

    it('requires an explicit repository when the project repository is not registered', async () => {
        const run = jest.spyOn(childProcess, 'execFile');
        await expect(new KitInstallerImpl().install(
            { kitSlug: 'sdlc', version: 'main' },
            registry([
                { id: 'repo-1', label: 'app', root: '/workspace/app' },
                { id: 'repo-2', label: 'docs', root: '/workspace/docs' }
            ])
        )).rejects.toThrow('repositoryId is required');
        expect(run).not.toHaveBeenCalled();
    });
});

function registry(
    entries: Array<{ id: string; label: string; root: string }>,
    configuredRoot?: string
): RepositoryRegistry {
    const repositories = entries.map(entry => ({
        canonicalRoot: entry.root,
        descriptor: { repositoryId: entry.id, label: entry.label }
    }));
    return {
        repositories,
        configuredRepository: repositories.find(candidate => candidate.canonicalRoot === configuredRoot),
        requireRepository: (id: string) => {
            const repository = repositories.find(candidate => candidate.descriptor.repositoryId === id);
            if (!repository) throw new Error(`Unknown repository: ${id}`);
            return repository;
        }
    } as unknown as RepositoryRegistry;
}
