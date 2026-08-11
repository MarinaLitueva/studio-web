import 'reflect-metadata';
import * as childProcess from 'child_process';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { adaptCfsMap } from './cfs-map-adapter';
import { CfsMapRunnerImpl } from './cfs-map-runner';

describe('live repository-local cfs graph path', () => {
    jest.setTimeout(60_000);

    let tempDir: string;
    let dataDir: string;

    beforeEach(async () => {
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-cfs-live-'));
        dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-cfs-live-data-'));
        await fs.mkdir(path.join(tempDir, 'src'), { recursive: true });
        await Promise.all([
            fs.writeFile(
                path.join(tempDir, 'README.md'),
                '# Tiny graph fixture\n\nSee [implementation](src/example.ts).\n',
                'utf8'
            ),
            fs.writeFile(
                path.join(tempDir, 'src', 'example.ts'),
                'export const tinyGraphFixture = true;\n',
                'utf8'
            )
        ]);
    });

    afterEach(async () => {
        await Promise.all([
            fs.rm(tempDir, { recursive: true, force: true }),
            fs.rm(dataDir, { recursive: true, force: true })
        ]);
    });

    it('runs real cfs map --local-only and adapts only the selected repository when cfs is available', async () => {
        if (!await hasCfsMapCapability(tempDir)) {
            pending('cfs map is not available in this test environment');
        }

        const canonicalRoot = await fs.realpath(tempDir);
        const result = await new CfsMapRunnerImpl().run({
            workspaceRoot: canonicalRoot,
            repositoryRoot: canonicalRoot,
            dataDir,
            timeoutMs: 20_000
        });
        const snapshot = await adaptCfsMap(result.payload, {
            workspaceId: 'live-acceptance-workspace',
            revision: 'a'.repeat(64),
            repositories: [{
                canonicalRoot,
                descriptor: { repositoryId: 'selected-repository', label: 'Selected repository' }
            }],
            engine: result.engine
        });

        expect(snapshot.nodes.length).toBeGreaterThan(0);
        expect(snapshot.repositories).toEqual([{
            repositoryId: 'selected-repository',
            commitSha: ''
        }]);
        expect(snapshot.sources.filter(source => source.reachable)).not.toHaveLength(0);
        expect(snapshot.nodes.every(node =>
            node.location.repositoryId === 'selected-repository'
        )).toBe(true);
    });
});

function hasCfsMapCapability(cwd: string): Promise<boolean> {
    return new Promise(resolve => {
        childProcess.execFile(
            'cfs',
            ['map', '--help'],
            { cwd, timeout: 5_000, windowsHide: true, shell: false },
            error => resolve(error === null)
        );
    });
}
