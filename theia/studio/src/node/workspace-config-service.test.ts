import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import type { AST } from 'toml-eslint-parser';
import { WorkspaceConfigService } from './workspace-config-service';

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

function parseRawToml(rawToml: string): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    let currentTable: Record<string, unknown> | undefined;
    for (const line of rawToml.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) {
            continue;
        }
        const tableMatch = /^\[([A-Za-z0-9_.-]+)\]$/u.exec(trimmed);
        if (tableMatch) {
            currentTable = ensureTable(result, tableMatch[1].split('.'));
            continue;
        }
        const keyValueMatch = /^([A-Za-z0-9_-]+)\s*=\s*"([^"]*)"$/u.exec(trimmed);
        if (!keyValueMatch) {
            throw new FakeParseError('Unexpected token', 2, 1);
        }
        const target = currentTable ?? result;
        target[keyValueMatch[1]] = keyValueMatch[2];
    }
    return result;
}

function ensureTable(root: Record<string, unknown>, pathSegments: readonly string[]): Record<string, unknown> {
    let current = root;
    for (const segment of pathSegments) {
        const next = current[segment];
        if (!next || typeof next !== 'object' || Array.isArray(next)) {
            current[segment] = {};
        }
        current = current[segment] as Record<string, unknown>;
    }
    return current;
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

describe('workspace config service', () => {
    let tempDir: string;
    let workspaceRoot: string;
    let canonicalWorkspaceRoot: string;
    let service: WorkspaceConfigService;

    beforeEach(async () => {
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'workspace-config-service-'));
        workspaceRoot = path.join(tempDir, 'workspace');
        await fs.mkdir(workspaceRoot);
        canonicalWorkspaceRoot = await fs.realpath(workspaceRoot);
        service = new WorkspaceConfigService(async () => createParserStub());
    });

    afterEach(async () => {
        await fs.rm(tempDir, { recursive: true, force: true });
    });

    it('loads a valid canonical config with raw text, AST, and stable revision', async () => {
        const configPath = path.join(canonicalWorkspaceRoot, '.cf-workspace.toml');
        const rawToml = [
            'version = "1.0"',
            '',
            '[sources.docs]',
            'path = "../docs"',
            'role = "artifacts"',
            ''
        ].join('\n');
        await fs.writeFile(configPath, rawToml, 'utf8');

        const first = await service.load(workspaceRoot);
        const second = await service.load(workspaceRoot);

        expect(first).toMatchObject({
            detection: 'canonical',
            state: 'valid',
            configPath,
            rawToml,
            parsedData: {
                version: '1.0',
                sources: {
                    docs: {
                        path: '../docs',
                        role: 'artifacts'
                    }
                }
            },
            diagnostics: []
        });
        expect(first.ast?.type).toBe('Program');
        expect(first.revision).toBe(second.revision);

        await fs.writeFile(configPath, `${rawToml}# changed\n`, 'utf8');
        const changed = await service.load(workspaceRoot);
        expect(changed.revision).not.toBe(first.revision);
    });

    it('returns missing when no workspace config exists', async () => {
        await expect(service.load(workspaceRoot)).resolves.toMatchObject({
            detection: 'missing',
            state: 'missing',
            configPath: path.join(canonicalWorkspaceRoot, '.cf-workspace.toml'),
            diagnostics: [{
                code: 'workspace.config.missing',
                severity: 'warning',
                scope: 'config'
            }]
        });
    });

    it('prefers canonical config when both canonical and legacy markers exist', async () => {
        await fs.writeFile(path.join(workspaceRoot, '.cf-workspace.toml'), 'version = "1.0"\n[sources.app]\npath = "../app"\n', 'utf8');
        await fs.writeFile(path.join(workspaceRoot, '.studio-workspace.toml'), 'version = "1.0"\n[sources.legacy]\npath = "../legacy"\n', 'utf8');

        const result = await service.load(workspaceRoot);

        expect(result.detection).toBe('canonical');
        expect(result.state).toBe('valid');
        expect(result.parsedData?.sources).toEqual({
            app: { path: '../app' }
        });
    });

    it('detects a legacy-only config without activating it', async () => {
        const legacyPath = path.join(canonicalWorkspaceRoot, '.studio-workspace.toml');
        await fs.writeFile(legacyPath, 'version = "1.0"\n[sources.legacy]\npath = "../legacy"\n', 'utf8');

        const result = await service.load(workspaceRoot);

        expect(result).toMatchObject({
            detection: 'legacy',
            state: 'legacy',
            configPath: path.join(canonicalWorkspaceRoot, '.cf-workspace.toml')
        });
        expect(result.rawToml).toBeUndefined();
        expect(result.parsedData).toBeUndefined();
        expect(result.diagnostics[0]).toMatchObject({
            code: 'workspace.config.legacy_detected',
            severity: 'warning',
            scope: 'config',
            path: legacyPath
        });
    });

    it('returns parse diagnostics for malformed TOML', async () => {
        await fs.writeFile(path.join(workspaceRoot, '.cf-workspace.toml'), 'version = "1.0"\n[sources\npath = "../docs"\n', 'utf8');

        const result = await service.load(workspaceRoot);

        expect(result.detection).toBe('canonical');
        expect(result.state).toBe('invalid');
        expect(result.rawToml).toContain('[sources');
        expect(result.revision).toBeDefined();
        expect(result.diagnostics[0]?.code).toBe('workspace.config.parse_error');
        expect(result.ast).toBeUndefined();
    });

    it('returns schema diagnostics for invalid data', async () => {
        await fs.writeFile(
            path.join(workspaceRoot, '.cf-workspace.toml'),
            'version = "1.0"\n[sources.docs]\npath = "../docs"\nbranch = "main"\n',
            'utf8'
        );

        const result = await service.load(workspaceRoot);

        expect(result.detection).toBe('canonical');
        expect(result.state).toBe('invalid');
        expect(result.parsedData?.sources.docs).toEqual({
            path: '../docs',
            branch: 'main'
        });
        expect(result.diagnostics.map(diagnostic => diagnostic.code)).toContain('workspace.config.schema.dependentRequired');
    });

    it('accepts a managed git checkout with both remote identity and local path', async () => {
        await fs.mkdir(path.join(workspaceRoot, 'studio-web'));
        await fs.writeFile(
            path.join(workspaceRoot, '.cf-workspace.toml'),
            'version = "1.0"\n[sources.studio-web]\nurl = "https://github.com/constructorfabric/studio-web.git"\nbranch = "main"\npath = "studio-web"\n',
            'utf8'
        );

        const result = await service.load(workspaceRoot);

        expect(result.state).toBe('valid');
        expect(result.parsedData?.sources['studio-web']).toMatchObject({
            url: 'https://github.com/constructorfabric/studio-web.git',
            branch: 'main',
            path: 'studio-web'
        });
    });

    it('returns unsupported for an unknown version', async () => {
        await fs.writeFile(path.join(workspaceRoot, '.cf-workspace.toml'), 'version = "2.0"\n[sources.docs]\npath = "../docs"\n', 'utf8');

        const result = await service.load(workspaceRoot);

        expect(result).toMatchObject({
            detection: 'canonical',
            state: 'unsupported'
        });
        expect(result.parsedData?.version).toBe('2.0');
        expect(result.diagnostics[0]?.code).toBe('workspace.config.unsupported_version');
    });

    it('rejects a canonical config symlink that escapes the workspace root', async () => {
        const outsideDir = path.join(tempDir, 'outside');
        await fs.mkdir(outsideDir);
        const outsideConfigPath = path.join(outsideDir, '.cf-workspace.toml');
        await fs.writeFile(outsideConfigPath, 'version = "1.0"\n[sources.docs]\npath = "../docs"\n', 'utf8');
        await fs.symlink(outsideConfigPath, path.join(workspaceRoot, '.cf-workspace.toml'));

        const result = await service.load(workspaceRoot);

        expect(result).toMatchObject({
            detection: 'canonical',
            state: 'invalid'
        });
        expect(result.diagnostics[0]?.code).toBe('workspace.config.symlink_escape');
        expect(result.rawToml).toBeUndefined();
    });

    it('rejects resolve.workdir values that escape the workspace root', async () => {
        await fs.writeFile(
            path.join(workspaceRoot, '.cf-workspace.toml'),
            'version = "1.0"\n[resolve]\nworkdir = "../outside"\n[sources.docs]\nurl = "https://github.com/example/docs.git"\n',
            'utf8'
        );

        const result = await service.load(workspaceRoot);

        expect(result).toMatchObject({
            detection: 'canonical',
            state: 'invalid'
        });
        expect(result.diagnostics[0]).toMatchObject({
            code: 'workspace.config.resolve.workdir_escape',
            severity: 'error',
            scope: 'config',
            path: `${path.join(canonicalWorkspaceRoot, '.cf-workspace.toml')}#/resolve/workdir`
        });
    });

    it('rejects an absolute resolve.workdir', async () => {
        await fs.writeFile(
            path.join(workspaceRoot, '.cf-workspace.toml'),
            `version = "1.0"\n[resolve]\nworkdir = ${JSON.stringify(path.join(tempDir, 'outside'))}\n[sources.docs]\nurl = "https://github.com/example/docs.git"\n`,
            'utf8'
        );

        const result = await service.load(workspaceRoot);

        expect(result).toMatchObject({
            detection: 'canonical',
            state: 'invalid'
        });
        expect(result.diagnostics[0]).toMatchObject({
            code: 'workspace.config.resolve.workdir_absolute',
            severity: 'error',
            scope: 'config',
            path: `${path.join(canonicalWorkspaceRoot, '.cf-workspace.toml')}#/resolve/workdir`
        });
    });
});
