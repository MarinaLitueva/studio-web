import 'reflect-metadata';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import * as childProcess from 'child_process';
import { CfsMapRunnerImpl } from './cfs-map-runner';

type ExecFileCallback = (
    error: (Error & { readonly code?: string | number; readonly killed?: boolean }) | null,
    stdout: string,
    stderr: string
) => void;

describe('cfs map runner', () => {
    let tempDir: string;
    let previousCommand: string | undefined;
    let previousTimeout: string | undefined;

    beforeEach(async () => {
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-cfs-map-runner-'));
        previousCommand = process.env.STUDIO_CFS_COMMAND;
        previousTimeout = process.env.STUDIO_CFS_MAP_TIMEOUT_MS;
        delete process.env.STUDIO_CFS_MAP_TIMEOUT_MS;
    });

    afterEach(async () => {
        jest.restoreAllMocks();
        if (previousCommand === undefined) {
            delete process.env.STUDIO_CFS_COMMAND;
        } else {
            process.env.STUDIO_CFS_COMMAND = previousCommand;
        }
        if (previousTimeout === undefined) {
            delete process.env.STUDIO_CFS_MAP_TIMEOUT_MS;
        } else {
            process.env.STUDIO_CFS_MAP_TIMEOUT_MS = previousTimeout;
        }
        await fs.rm(tempDir, { recursive: true, force: true });
    });

    it('resolves the configured command first and passes fixed argv without a shell', async () => {
        const configuredCommand = path.join(tempDir, 'cfs command;not-a-shell-fragment');
        const repositoryRoot = path.join(tempDir, 'selected-repository');
        await fs.mkdir(repositoryRoot);
        process.env.STUDIO_CFS_COMMAND = configuredCommand;
        const calls: Array<{ executable: string; args: string[]; options: childProcess.ExecFileOptions }> = [];
        mockExecFile(async (executable, args, options, callback) => {
            calls.push({ executable, args, options });
            if (args.includes('--out')) {
                await fs.writeFile(args[args.indexOf('--out') + 1], JSON.stringify({ version: '1.0' }), 'utf8');
            }
            callback(null, args.includes('--version') ? 'cfs 1.7.0\n' : '', '');
        });

        const result = await new CfsMapRunnerImpl().run({
            workspaceRoot: tempDir,
            repositoryRoot,
            dataDir: path.join(tempDir, 'data')
        });

        expect(result).toMatchObject({
            payload: { version: '1.0' },
            engine: { command: configuredCommand, version: 'cfs 1.7.0' }
        });
        expect(calls.map(call => call.args)).toEqual([
            ['map', '--help'],
            ['--version'],
            ['map', '--format', 'json', '--local-only', '--out', expect.any(String)]
        ]);
        expect(calls.every(call => call.executable === configuredCommand)).toBe(true);
        expect(calls.every(call => call.options.shell === false)).toBe(true);
        const canonicalRepository = await fs.realpath(repositoryRoot);
        expect(calls.every(call => call.options.cwd === canonicalRepository)).toBe(true);
        expect(calls.map(call => call.options.timeout)).toEqual([
            10_000,
            10_000,
            300_000
        ]);
    });

    it('falls back to cfs when the configured command is unavailable', async () => {
        process.env.STUDIO_CFS_COMMAND = path.join(tempDir, 'missing-cfs');
        const executables: string[] = [];
        mockExecFile(async (executable, args, _options, callback) => {
            executables.push(executable);
            if (executable !== 'cfs') {
                const error = Object.assign(new Error('missing'), { code: 'ENOENT' });
                callback(error, '', '');
                return;
            }
            if (args.includes('--out')) {
                await fs.writeFile(args[args.indexOf('--out') + 1], JSON.stringify({ version: '1.0' }), 'utf8');
            }
            callback(null, args.includes('--version') ? '1.7.0' : '', '');
        });

        const result = await new CfsMapRunnerImpl().run({
            workspaceRoot: tempDir,
            repositoryRoot: tempDir,
            dataDir: path.join(tempDir, 'data')
        });

        expect(executables[0]).toBe(process.env.STUDIO_CFS_COMMAND);
        expect(executables).toContain('cfs');
        expect(result.engine).toEqual({ command: 'cfs', version: '1.7.0' });
    });

    it('enforces the requested map timeout and does not expose stderr in the error', async () => {
        process.env.STUDIO_CFS_COMMAND = 'cfs';
        process.env.STUDIO_CFS_MAP_TIMEOUT_MS = '420000';
        mockExecFile(async (_executable, args, options, callback) => {
            if (args[0] === 'map' && args[1] === '--help') {
                callback(null, '', '');
                return;
            }
            if (args[0] === '--version') {
                callback(null, '1.7.0', '');
                return;
            }
            expect(options.timeout).toBe(7);
            const error = Object.assign(new Error('timed out'), { code: 'ETIMEDOUT', killed: true });
            callback(error, '', 'token=super-secret');
        });

        const error = await expectFailure(new CfsMapRunnerImpl().run({
            workspaceRoot: tempDir,
            repositoryRoot: tempDir,
            dataDir: path.join(tempDir, 'data'),
            timeoutMs: 7
        }));

        expect(error.message).toBe('cfs timed out after 7ms');
        expect(error.message).not.toContain('super-secret');
        expect(error.message).not.toContain(tempDir);
    });

    it('uses a valid configured map timeout without changing capability probe bounds', async () => {
        process.env.STUDIO_CFS_COMMAND = 'cfs';
        process.env.STUDIO_CFS_MAP_TIMEOUT_MS = '420000';
        const timeouts: Array<number | undefined> = [];
        mockExecFile(async (_executable, args, options, callback) => {
            timeouts.push(options.timeout);
            if (args.includes('--out')) {
                await fs.writeFile(args[args.indexOf('--out') + 1], JSON.stringify({ version: '1.0' }), 'utf8');
            }
            callback(null, args.includes('--version') ? '1.7.0' : '', '');
        });

        await new CfsMapRunnerImpl().run({
            workspaceRoot: tempDir,
            repositoryRoot: tempDir,
            dataDir: path.join(tempDir, 'data')
        });

        expect(timeouts).toEqual([10_000, 10_000, 420_000]);
    });

    it.each([
        ['malformed', '300000ms'],
        ['below the safe minimum', '999'],
        ['above the safe maximum', '1800001']
    ])('rejects a %s configured map timeout', async (_case, configuredTimeout) => {
        process.env.STUDIO_CFS_MAP_TIMEOUT_MS = configuredTimeout;
        const execSpy = jest.spyOn(childProcess, 'execFile');

        const error = await expectFailure(new CfsMapRunnerImpl().run({
            workspaceRoot: tempDir,
            repositoryRoot: tempDir,
            dataDir: path.join(tempDir, 'data')
        }));

        expect(error.message).toBe(
            'STUDIO_CFS_MAP_TIMEOUT_MS must be an integer between 1000 and 1800000'
        );
        expect(execSpy).not.toHaveBeenCalled();
    });

    it('reports invalid JSON without including command stderr', async () => {
        process.env.STUDIO_CFS_COMMAND = 'cfs';
        mockExecFile(async (_executable, args, _options, callback) => {
            if (args.includes('--out')) {
                await fs.writeFile(args[args.indexOf('--out') + 1], '{invalid', 'utf8');
            }
            callback(null, args.includes('--version') ? '1.7.0' : '', 'credential=hidden');
        });

        const error = await expectFailure(new CfsMapRunnerImpl().run({
            workspaceRoot: tempDir,
            repositoryRoot: tempDir,
            dataDir: path.join(tempDir, 'data')
        }));

        expect(error.message).toContain('cfs map returned invalid JSON');
        expect(error.message).not.toContain('credential=hidden');
    });

    it('sanitizes stderr from an unsuccessful map process', async () => {
        process.env.STUDIO_CFS_COMMAND = 'cfs';
        mockExecFile(async (_executable, args, _options, callback) => {
            if (args[0] === 'map' && args[1] === '--help') {
                callback(null, '', '');
                return;
            }
            if (args[0] === '--version') {
                callback(null, '1.7.0', '');
                return;
            }
            const error = Object.assign(new Error('failed'), { code: 17 });
            callback(error, '', 'Authorization: Bearer super-secret');
        });

        const error = await expectFailure(new CfsMapRunnerImpl().run({
            workspaceRoot: tempDir,
            repositoryRoot: tempDir,
            dataDir: path.join(tempDir, 'data')
        }));

        expect(error.message).toBe('cfs exited unsuccessfully (17)');
        expect(error.message).not.toContain('Authorization');
        expect(error.message).not.toContain('super-secret');
    });
});

function mockExecFile(
    implementation: (
        executable: string,
        args: string[],
        options: childProcess.ExecFileOptions,
        callback: ExecFileCallback
    ) => Promise<void>
): void {
    jest.spyOn(childProcess, 'execFile').mockImplementation(((
        executable: string,
        args: string[],
        options: childProcess.ExecFileOptions,
        callback: ExecFileCallback
    ) => {
        void implementation(executable, args, options, callback);
        return {} as childProcess.ChildProcess;
    }) as typeof childProcess.execFile);
}

async function expectFailure(promise: Promise<unknown>): Promise<Error> {
    try {
        await promise;
    } catch (error) {
        return error instanceof Error ? error : new Error(String(error));
    }
    throw new Error('Expected promise to reject');
}
