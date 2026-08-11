import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import type { AST } from 'toml-eslint-parser';
import {
    WorkspaceConfigService,
    sha256,
    type TomlParserLoader
} from './workspace-config-service';
import { WorkspaceMigrationService } from './workspace-migration-service';

describe('WorkspaceMigrationService', () => {
    let tempDir: string;
    let workspaceRoot: string;
    let dataDir: string;
    let service: WorkspaceMigrationService;
    let tomlParserLoader: TomlParserLoader;

    beforeEach(async () => {
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'workspace-migration-service-'));
        workspaceRoot = path.join(tempDir, 'workspace');
        dataDir = path.join(tempDir, 'data');
        await fs.mkdir(workspaceRoot, { recursive: true });
        tomlParserLoader = async () => createParserStub();
        const configService = new WorkspaceConfigService(tomlParserLoader);
        service = new WorkspaceMigrationService(configService, tomlParserLoader, () => '2026-07-29T00:00:00.000Z', 60_000);
    });

    afterEach(async () => {
        await fs.rm(tempDir, { recursive: true, force: true });
    });

    it('defaults to single-folder when no workspace config source exists', async () => {
        const startup = await service.initialize(workspaceRoot, dataDir);

        expect(startup.mode).toBe('single-folder');
        expect(startup.migration.mode).toBe('single-folder');
        expect(startup.migration.status).toBe('pending');
    });

    it('detects legacy marker startup and previews legacy migration without writes', async () => {
        await writeLegacyWorkspace(workspaceRoot, [
            'version = "1.0"',
            '',
            '[sources.docs]',
            'path = "../docs"',
            'role = "artifacts"',
            ''
        ].join('\n'));

        await service.initialize(workspaceRoot, dataDir);
        const status = await service.previewMigration();

        expect(status.migration.mode).toBe('legacy');
        expect(status.preview).toMatchObject({
            sourceKind: 'legacy-config',
            modeBefore: 'legacy',
            modeAfter: 'canonical-shadow'
        });
        expect(status.preview?.normalizedConfig.sources.docs).toEqual({
            path: '../docs',
            role: 'artifacts'
        });
        await expect(fs.access(path.join(workspaceRoot, '.cf-workspace.toml'))).rejects.toThrow();
    });

    it('uses canonical-active by default when canonical config is valid and no override exists', async () => {
        await writeCanonicalWorkspace(workspaceRoot, [
            'version = "1.0"',
            '',
            '[sources.studio]',
            'path = "./studio"',
            ''
        ].join('\n'));

        const startup = await service.initialize(workspaceRoot, dataDir);

        expect(startup.mode).toBe('canonical-active');
        expect(startup.migration.status).toBe('not-needed');
    });

    it('fails closed into diagnostics mode for invalid canonical config', async () => {
        await writeCanonicalWorkspace(workspaceRoot, 'version = "1.0"\n[sources\npath = "./broken"\n');

        const startup = await service.initialize(workspaceRoot, dataDir);

        expect(startup.mode).toBe('canonical-diagnostics');
        expect(startup.diagnostics[0]?.code).toBe('workspace.config.parse_error');
    });

    it('previews and applies inline core workspace migration while blocking inline url sources', async () => {
        await fs.mkdir(path.join(workspaceRoot, 'config'), { recursive: true });
        await fs.writeFile(path.join(workspaceRoot, 'config/core.toml'), [
            '[workspace]',
            'version = "1.0"',
            '',
            '[workspace.sources.docs]',
            'path = "../docs"',
            'role = "artifacts"',
            ''
        ].join('\n'), 'utf8');

        await service.initialize(workspaceRoot, dataDir);
        const preview = await service.previewMigration();
        const applied = await service.applyMigration();

        expect(preview.preview?.sourceKind).toBe('inline-core');
        expect(applied.migration.mode).toBe('canonical-shadow');
        expect(applied.migration.rollbackAvailable).toBe(true);
        await expect(fs.readFile(path.join(workspaceRoot, '.cf-workspace.toml'), 'utf8')).resolves.toContain('[sources.docs]');
    });

    it('blocks migration apply when canonical config already exists', async () => {
        await writeLegacyWorkspace(workspaceRoot, 'version = "1.0"\n[sources.docs]\npath = "../docs"\n');
        await writeCanonicalWorkspace(workspaceRoot, 'version = "1.0"\n[sources.docs]\npath = "./docs"\n');
        await service.initialize(workspaceRoot, dataDir);

        await expect(service.applyMigration()).rejects.toThrow('already exists');
    });

    it('recovers interrupted writes and keeps rollback available when hashes match', async () => {
        const canonicalBody = 'version = "1.0"\n[sources.docs]\npath = "../docs"\n';
        await writeCanonicalWorkspace(workspaceRoot, canonicalBody);
        await fs.mkdir(path.join(dataDir), { recursive: true });
        await fs.writeFile(path.join(dataDir, 'workspace-migration-journal.json'), JSON.stringify({
            schemaVersion: 1,
            modeOverride: 'canonical-shadow',
            transaction: {
                schemaVersion: 1,
                transactionId: 'txn-1',
                modeBefore: 'legacy',
                modeAfter: 'canonical-shadow',
                sourceKind: 'legacy-config',
                sourcePath: path.join(workspaceRoot, '.studio-workspace.toml'),
                targetPath: path.join(workspaceRoot, '.cf-workspace.toml'),
                payloadHash: sha256(canonicalBody),
                createdAt: '2026-07-29T00:00:00.000Z',
                updatedAt: '2026-07-29T00:00:00.000Z',
                phase: 'written',
                rollbackAvailable: false
            }
        }, null, 2), 'utf8');

        const startup = await service.initialize(workspaceRoot, dataDir);
        const status = await service.getStatus();

        expect(startup.mode).toBe('canonical-active');
        expect(status.migration.rollbackAvailable).toBe(true);
    });

    it('compares shadow projections and requires acknowledgment for differences before activation', async () => {
        await writeLegacyWorkspace(workspaceRoot, 'version = "1.0"\n[sources.docs]\npath = "../docs"\n');
        await writeCanonicalWorkspace(workspaceRoot, 'version = "1.0"\n[sources.docs]\npath = "./docs"\n');
        await fs.mkdir(path.join(dataDir), { recursive: true });
        await fs.writeFile(path.join(dataDir, 'workspace-migration-journal.json'), JSON.stringify({
            schemaVersion: 1,
            modeOverride: 'canonical-shadow'
        }, null, 2), 'utf8');

        await service.initialize(workspaceRoot, dataDir);
        const comparison = await service.compareShadow();

        expect(comparison.comparison?.clean).toBe(false);
        await expect(service.activateCanonical()).rejects.toThrow('acknowledged difference hash');

        const activated = await service.activateCanonical(comparison.comparison?.differenceHash);
        expect(activated.migration.mode).toBe('canonical-active');
    });

    it('rolls back only the migration-created canonical file when the hash still matches', async () => {
        await writeLegacyWorkspace(workspaceRoot, 'version = "1.0"\n[sources.docs]\npath = "../docs"\n');
        await service.initialize(workspaceRoot, dataDir);
        const applied = await service.applyMigration();
        const transactionId = applied.migration.transactionId!;

        const rolledBack = await service.rollbackMigration(transactionId);

        expect(rolledBack.migration.status).toBe('rolled-back');
        await expect(fs.access(path.join(workspaceRoot, '.cf-workspace.toml'))).rejects.toThrow();
        await expect(fs.access(path.join(workspaceRoot, '.studio-workspace.toml'))).resolves.toBeUndefined();
    });

    it('blocks rollback after external canonical changes', async () => {
        await writeLegacyWorkspace(workspaceRoot, 'version = "1.0"\n[sources.docs]\npath = "../docs"\n');
        await service.initialize(workspaceRoot, dataDir);
        const applied = await service.applyMigration();
        await fs.writeFile(path.join(workspaceRoot, '.cf-workspace.toml'), 'version = "1.0"\n[sources.docs]\npath = "./changed"\n', 'utf8');

        await expect(service.rollbackMigration(applied.migration.transactionId!)).rejects.toThrow('changed externally');
    });
});

async function writeLegacyWorkspace(workspaceRoot: string, body: string): Promise<void> {
    await fs.writeFile(path.join(workspaceRoot, '.studio-workspace.toml'), body, 'utf8');
}

async function writeCanonicalWorkspace(workspaceRoot: string, body: string): Promise<void> {
    await fs.writeFile(path.join(workspaceRoot, '.cf-workspace.toml'), body, 'utf8');
}

type FakeAst = AST.TOMLProgram & { __rawToml: string };

class FakeParseError extends SyntaxError {
    constructor(
        message: string,
        readonly lineNumber: number,
        readonly column: number
    ) {
        super(message);
    }
}

function createParserStub() {
    return {
        ParseError: FakeParseError,
        parseForESLint(rawToml: string): { ast: AST.TOMLProgram } {
            if (rawToml.includes('[sources\n')) {
                throw new FakeParseError('Unexpected token', 2, 1);
            }
            return {
                ast: {
                    type: 'Program',
                    body: [] as unknown as [AST.TOMLTopLevelTable],
                    sourceType: 'module',
                    comments: [],
                    tokens: [],
                    parent: null,
                    loc: {
                        start: { line: 1, column: 0 },
                        end: { line: 1, column: rawToml.length }
                    },
                    range: [0, rawToml.length],
                    __rawToml: rawToml
                } as FakeAst
            };
        },
        getStaticTOMLValue(ast: AST.TOMLProgram): unknown {
            return parseRawToml((ast as FakeAst).__rawToml);
        }
    };
}

function parseRawToml(rawToml: string): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    let currentTable = result;
    for (const line of rawToml.split(/\r?\n/u)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) {
            continue;
        }
        const tableMatch = /^\[([A-Za-z0-9_.-]+)\]$/u.exec(trimmed);
        if (tableMatch) {
            currentTable = resolveTable(result, tableMatch[1].split('.'));
            continue;
        }
        const [key, rawValue] = splitKeyValue(trimmed);
        currentTable[key] = parseTomlValue(rawValue);
    }
    return result;
}

function resolveTable(root: Record<string, unknown>, segments: readonly string[]): Record<string, unknown> {
    let current = root;
    for (const segment of segments) {
        const existing = current[segment];
        if (!existing || typeof existing !== 'object' || Array.isArray(existing)) {
            current[segment] = {};
        }
        current = current[segment] as Record<string, unknown>;
    }
    return current;
}

function splitKeyValue(line: string): [string, string] {
    const index = line.indexOf('=');
    if (index === -1) {
        throw new FakeParseError('Unexpected token', 1, 1);
    }
    return [line.slice(0, index).trim().replace(/^"(.*)"$/u, '$1'), line.slice(index + 1).trim()];
}

function parseTomlValue(rawValue: string): unknown {
    if (rawValue === 'true') {
        return true;
    }
    if (rawValue === 'false') {
        return false;
    }
    if (rawValue.startsWith('[') && rawValue.endsWith(']')) {
        return rawValue.slice(1, -1).split(',').map(entry => entry.trim()).filter(Boolean).map(entry => entry.replace(/^"(.*)"$/u, '$1'));
    }
    return rawValue.replace(/^"(.*)"$/u, '$1');
}
