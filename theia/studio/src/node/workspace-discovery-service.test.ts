import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import type { ILogger } from '@theia/core/lib/common';
import type {
    WorkspaceConfiguredSource,
    WorkspaceScanRequest
} from '../common/workspace-protocol';
import { WorkspaceDiscoveryService } from './workspace-discovery-service';

describe('workspace discovery service', () => {
    let tempDir: string;
    let workspaceRoot: string;
    let statePath: string;

    beforeEach(async () => {
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'studio-workspace-discovery-'));
        workspaceRoot = path.join(tempDir, 'workspace');
        statePath = path.join(tempDir, 'state', 'workspace-discovery.json');
        await fs.mkdir(workspaceRoot);
    });

    afterEach(async () => {
        await fs.rm(tempDir, { recursive: true, force: true });
    });

    it('scans explicit roots only, skips ignored directories and symlinked directories, and marks configured candidates', async () => {
        const configuredRepository = path.join(workspaceRoot, 'packages', 'configured');
        const plainRepository = path.join(workspaceRoot, 'packages', 'plain');
        const ignoredNodeModulesRepository = path.join(workspaceRoot, 'node_modules', 'ignored');
        const ignoredBuildRepository = path.join(workspaceRoot, 'build', 'ignored');
        const outsideRepository = path.join(tempDir, 'outside');
        await fs.mkdir(path.join(workspaceRoot, '.git'));
        await fs.mkdir(path.join(configuredRepository, '.git'), { recursive: true });
        await fs.mkdir(path.join(plainRepository, '.git'), { recursive: true });
        await fs.mkdir(path.join(ignoredNodeModulesRepository, '.git'), { recursive: true });
        await fs.mkdir(path.join(ignoredBuildRepository, '.git'), { recursive: true });
        await fs.mkdir(path.join(outsideRepository, '.git'), { recursive: true });
        await fs.symlink(outsideRepository, path.join(workspaceRoot, 'linked-outside'));

        const service = createService(workspaceRoot, statePath);
        const response = await service.scan(scanRequest(['.', './.'], 4, 128), snapshot([
            configuredSource('configured', configuredRepository)
        ]));

        const candidatePaths = response.preview.candidates.map(candidate => candidate.localPath).sort();
        expect(candidatePaths).toEqual([
            await fs.realpath(configuredRepository),
            await fs.realpath(plainRepository),
            await fs.realpath(workspaceRoot)
        ].sort());
        expect(response.preview.rootsScanned).toEqual([await fs.realpath(workspaceRoot)]);
        expect(response.preview.candidates.find(candidate => candidate.localPath.endsWith('/packages/configured')))
            .toMatchObject({ duplicateOfConfiguredSourceId: 'configured' });
        expect(response.preview.candidates.some(candidate => candidate.localPath.includes('node_modules'))).toBe(false);
        expect(response.preview.candidates.some(candidate => candidate.localPath.includes('/build/'))).toBe(false);
        expect(response.preview.candidates.some(candidate => candidate.localPath.includes('outside'))).toBe(false);
        await expect(fs.stat(statePath)).rejects.toMatchObject({ code: 'ENOENT' });
    });

    it('returns preview diagnostics when depth or entry limits are hit', async () => {
        const deepRepository = path.join(workspaceRoot, 'a', 'b', 'c');
        await fs.mkdir(path.join(deepRepository, '.git'), { recursive: true });
        await fs.mkdir(path.join(workspaceRoot, 'entries', 'one'), { recursive: true });
        await fs.mkdir(path.join(workspaceRoot, 'entries', 'two'), { recursive: true });
        await fs.mkdir(path.join(workspaceRoot, 'entries', 'three'), { recursive: true });

        const service = createService(workspaceRoot, statePath);
        const depthLimited = await service.scan(scanRequest(['.'], 1, 128), snapshot());
        const entryLimited = await service.scan(scanRequest(['entries'], 4, 2), snapshot());

        expect(depthLimited.preview.candidates).toEqual([]);
        expect(depthLimited.preview.diagnostics.map(diagnostic => diagnostic.code))
            .toContain('workspace-discovery-max-depth-hit');
        expect(entryLimited.preview.diagnostics.map(diagnostic => diagnostic.code))
            .toContain('workspace-discovery-max-entries-hit');
    });

    it('persists ignored suggestions locally and reloads them across service instances', async () => {
        const repositoryRoot = path.join(workspaceRoot, 'packages', 'ignored-later');
        await fs.mkdir(path.join(repositoryRoot, '.git'), { recursive: true });

        const firstService = createService(workspaceRoot, statePath);
        const firstScan = await firstService.scan(scanRequest(['.'], 4, 128), snapshot());
        const candidate = firstScan.preview.candidates[0];
        expect(candidate.ignoredLocally).toBe(false);

        await firstService.ignoreSuggestion(candidate.candidateId, candidate.rootPath);

        const secondService = createService(workspaceRoot, statePath);
        const ignoredScan = await secondService.scan(scanRequest(['.'], 4, 128), snapshot());
        expect(ignoredScan.preview.candidates[0]).toMatchObject({ ignoredLocally: true });
        expect(ignoredScan.suggestions[0]?.disposition).toBe('ignored-locally');

        await secondService.unignoreSuggestion(candidate.candidateId, candidate.rootPath);

        const thirdService = createService(workspaceRoot, statePath);
        const unignoredScan = await thirdService.scan(scanRequest(['.'], 4, 128), snapshot());
        expect(unignoredScan.preview.candidates[0]).toMatchObject({ ignoredLocally: false });
    });

    it('suggests the nearest containing repository without crossing the workspace boundary', async () => {
        const containingRepository = path.join(tempDir, 'containing');
        const nestedWorkspace = path.join(containingRepository, 'workspace');
        const openedFolder = path.join(nestedWorkspace, 'docs', 'guide');
        await fs.mkdir(path.join(containingRepository, '.git'), { recursive: true });
        await fs.mkdir(openedFolder, { recursive: true });

        const service = createService(nestedWorkspace, statePath);
        const suggestion = await service.detectContainingRepository(openedFolder, nestedWorkspace, snapshot());

        expect(suggestion).toMatchObject({
            kind: 'containing-repository',
            localPath: await fs.realpath(containingRepository),
            disposition: 'new'
        });

        const outsideRepository = path.join(tempDir, 'outside-boundary');
        const containedWorkspace = path.join(tempDir, 'standalone-workspace');
        const outsideOpenedFolder = path.join(containedWorkspace, 'docs');
        await fs.mkdir(path.join(outsideRepository, '.git'), { recursive: true });
        await fs.mkdir(outsideOpenedFolder, { recursive: true });

        const boundaryService = createService(containedWorkspace, statePath);
        const outsideSuggestion = await boundaryService.detectContainingRepository(outsideOpenedFolder, containedWorkspace, snapshot());

        expect(outsideSuggestion).toBeUndefined();
    });

    it('does not expose the synthetic managed workspace root as a source', async () => {
        const sourceRoot = path.join(workspaceRoot, 'studio-web');
        await fs.mkdir(path.join(workspaceRoot, '.git'), { recursive: true });
        await fs.writeFile(path.join(workspaceRoot, '.git', 'cf-studio-managed-root'), '');
        await fs.mkdir(path.join(sourceRoot, '.git'), { recursive: true });

        const service = createService(workspaceRoot, statePath);
        const suggestion = await service.detectContainingRepository(workspaceRoot, workspaceRoot, snapshot());
        const scan = await service.scan(scanRequest(['.'], 3, 128), snapshot([
            configuredSource('studio-web', sourceRoot)
        ]));

        expect(suggestion).toBeUndefined();
        expect(scan.preview.candidates.map(candidate => candidate.localPath)).toEqual([
            await fs.realpath(sourceRoot)
        ]);
        expect(scan.preview.candidates[0]).toMatchObject({
            duplicateOfConfiguredSourceId: 'studio-web'
        });
    });
});

function createService(workspaceRoot: string, statePath: string): WorkspaceDiscoveryService {
    return new WorkspaceDiscoveryService({
        workspaceRoot,
        operationalStatePath: statePath,
        logger: createLoggerStub()
    });
}

function snapshot(configuredSources: readonly WorkspaceConfiguredSource[] = []): {
    readonly configuredSources: readonly WorkspaceConfiguredSource[];
} {
    return { configuredSources };
}

function configuredSource(sourceId: string, localPath: string): WorkspaceConfiguredSource {
    return {
        configured: true,
        authoritative: true,
        include: 'member',
        sourceId,
        label: sourceId,
        localPath
    };
}

function scanRequest(roots: readonly string[], maxDepth: number, maxEntries: number): WorkspaceScanRequest {
    return { roots, maxDepth, maxEntries };
}

function createLoggerStub(): ILogger {
    return {
        child: () => createLoggerStub(),
        debug: () => undefined,
        error: () => undefined,
        fatal: () => undefined,
        getLevel: () => 0,
        info: () => undefined,
        isEnabled: () => false,
        log: () => undefined,
        setLogLevel: async () => undefined,
        trace: () => undefined,
        warn: () => undefined
    } as unknown as ILogger;
}
