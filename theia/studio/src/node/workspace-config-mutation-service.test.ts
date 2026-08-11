import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import type { AST } from 'toml-eslint-parser';
import {
    WorkspaceConfigMutationService,
    type AddWorkspaceSourceMutationRequest,
    type WorkspaceConfigMutationResult,
    type UpdateWorkspaceSourceMutationRequest
} from './workspace-config-mutation-service';
import { WorkspaceConfigService } from './workspace-config-service';

describe('workspace config mutation service', () => {
    let tempDir: string;
    let workspaceRoot: string;
    let service: WorkspaceConfigMutationService;
    let reader: WorkspaceConfigService;

    beforeEach(async () => {
        tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'workspace-config-mutation-service-'));
        workspaceRoot = path.join(tempDir, 'workspace');
        await fs.mkdir(workspaceRoot);
        service = new WorkspaceConfigMutationService(async () => createParserStub());
        reader = new WorkspaceConfigService(async () => createParserStub());
    });

    afterEach(async () => {
        await fs.rm(tempDir, { recursive: true, force: true });
    });

    it('creates a canonical config with quoted source names when needed', async () => {
        const result = await service.create(workspaceRoot, {
            expectedRevision: 'missing',
            sources: {
                'docs repo': {
                    path: '../docs repo',
                    role: 'artifacts'
                }
            }
        });

        expect(result.status).toBe('applied');
        expect(await readConfig(workspaceRoot)).toBe([
            'version = "1.0"',
            '',
            '[sources."docs repo"]',
            'path = "../docs repo"',
            'role = "artifacts"',
            ''
        ].join('\n'));
    });

    it('returns a typed conflict for an invalid create request', async () => {
        const result = await service.create(workspaceRoot, {
            expectedRevision: 'missing',
            sources: {
                invalid: { path: '../local', url: 'https://example.com/repo.git' }
            }
        });

        expectConflict(result, 'invalid-request');
        await expect(fs.access(path.join(workspaceRoot, '.cf-workspace.toml'))).rejects.toMatchObject({ code: 'ENOENT' });
    });

    it('adds a source without disturbing comments, ordering, or unknown fields', async () => {
        await writeConfig(workspaceRoot, [
            '# workspace comment',
            'version = "1.0"',
            '',
            '[sources.docs]',
            'path = "../docs"',
            'role = "artifacts"',
            ''
        ].join('\n'));
        const revision = await currentRevision(workspaceRoot, reader);

        const result = await service.addSource(workspaceRoot, {
            expectedRevision: revision,
            sourceId: 'code repo',
            source: {
                url: 'https://example.com/code.git',
                branch: 'main',
                role: 'codebase'
            }
        });

        expect(result.status).toBe('applied');
        expect(await readConfig(workspaceRoot)).toBe([
            '# workspace comment',
            'version = "1.0"',
            '',
            '[sources.docs]',
            'path = "../docs"',
            'role = "artifacts"',
            '',
            '[sources."code repo"]',
            'role = "codebase"',
            'url = "https://example.com/code.git"',
            'branch = "main"',
            ''
        ].join('\n'));
    });

    it('updates only targeted values and removes only the target key line', async () => {
        await writeConfig(workspaceRoot, [
            'version = "1.0"',
            '',
            '[sources.docs]',
            'path = "../docs" # keep',
            'adapter = ".cf-studio"',
            'role = "artifacts"',
            ''
        ].join('\n'));
        const revision = await currentRevision(workspaceRoot, reader);

        const request: UpdateWorkspaceSourceMutationRequest = {
            expectedRevision: revision,
            sourceId: 'docs',
            path: '../guides',
            adapter: null
        };
        const result = await service.updateSource(workspaceRoot, request);

        expect(result.status).toBe('applied');
        expect(await readConfig(workspaceRoot)).toBe([
            'version = "1.0"',
            '',
            '[sources.docs]',
            'path = "../guides" # keep',
            'role = "artifacts"',
            ''
        ].join('\n'));
    });

    it('removes only the selected source table and preserves nearby comments', async () => {
        await writeConfig(workspaceRoot, [
            'version = "1.0"',
            '',
            '[sources.docs]',
            'path = "../docs"',
            '',
            '# keep this comment',
            '[sources.code]',
            'path = "../code"',
            ''
        ].join('\n'));
        const revision = await currentRevision(workspaceRoot, reader);

        const result = await service.removeSource(workspaceRoot, {
            expectedRevision: revision,
            sourceId: 'docs'
        });

        expect(result.status).toBe('applied');
        expect(await readConfig(workspaceRoot)).toBe([
            'version = "1.0"',
            '',
            '# keep this comment',
            '[sources.code]',
            'path = "../code"',
            ''
        ].join('\n'));
    });

    it('requires explicit confirmation for rename impacts and applies only confirmed replacements', async () => {
        await writeConfig(workspaceRoot, [
            'version = "1.0"',
            '',
            '[sources.other]',
            'path = "../other"',
            'adapter = "docs"',
            '',
            '[sources.docs]',
            'path = "../docs"',
            ''
        ].join('\n'));
        const revision = await currentRevision(workspaceRoot, reader);

        const preview = await service.renameSource(workspaceRoot, {
            expectedRevision: revision,
            sourceId: 'docs',
            nextSourceId: 'guides'
        });

        expectConflict(preview, 'confirmation-required');
        expect(preview.impacts).toHaveLength(1);

        const confirmed = await service.renameSource(workspaceRoot, {
            expectedRevision: revision,
            sourceId: 'docs',
            nextSourceId: 'guides',
            confirmedImpactIds: preview.impacts?.map(impact => impact.impactId)
        });

        expect(confirmed.status).toBe('applied');
        expect(await readConfig(workspaceRoot)).toBe([
            'version = "1.0"',
            '',
            '[sources.other]',
            'path = "../other"',
            'adapter = "docs"',
            '',
            '[sources.guides]',
            'path = "../docs"',
            ''
        ].join('\n'));
        if (confirmed.status === 'applied') {
            expect(confirmed.impacts).toHaveLength(1);
            expect(confirmed.impacts?.[0]).toMatchObject({
                path: 'sources.other.adapter',
                evidence: '"docs"',
                requiresExplicitEdit: true,
                confirmed: true
            });
        }
    });

    it('preserves CRLF line endings across additive edits', async () => {
        await writeConfig(workspaceRoot, 'version = "1.0"\r\n\r\n[sources.docs]\r\npath = "../docs"\r\n');
        const revision = await currentRevision(workspaceRoot, reader);

        const request: AddWorkspaceSourceMutationRequest = {
            expectedRevision: revision,
            sourceId: 'remote',
            source: {
                url: 'https://example.com/remote.git',
                branch: 'main'
            }
        };
        const result = await service.addSource(workspaceRoot, request);

        expect(result.status).toBe('applied');
        expect(await readConfig(workspaceRoot)).toContain('\r\n[sources.remote]\r\n');
    });

    it('saves raw TOML bytes exactly after validation', async () => {
        await writeConfig(workspaceRoot, 'version = "1.0"\n[sources.docs]\npath = "../docs"\n');
        const revision = await currentRevision(workspaceRoot, reader);
        const rawToml = 'version = "1.0"\r\n\r\n[sources.docs]\r\npath = "../docs"\r\nrole = "artifacts"\r\n';

        const result = await service.saveRawToml(workspaceRoot, {
            expectedRevision: revision,
            rawToml
        });

        expect(result.status).toBe('applied');
        expect(await readConfig(workspaceRoot)).toBe(rawToml);
    });

    it('fails closed on invalid mutations and stale revisions', async () => {
        await writeConfig(workspaceRoot, 'version = "1.0"\n[sources.docs]\npath = "../docs"\n');
        const revision = await currentRevision(workspaceRoot, reader);

        const invalid = await service.updateSource(workspaceRoot, {
            expectedRevision: revision,
            sourceId: 'docs',
            branch: 'main'
        });
        expectConflict(invalid, 'invalid-request');

        const stale = await service.addSource(workspaceRoot, {
            expectedRevision: 'stale',
            sourceId: 'code',
            source: { path: '../code' }
        });
        expectConflict(stale, 'revision-mismatch');
    });

    it('detects an external edit before replace and leaves the external bytes intact', async () => {
        await writeConfig(workspaceRoot, 'version = "1.0"\n[sources.docs]\npath = "../docs"\n');
        const revision = await currentRevision(workspaceRoot, reader);
        const guardedService = new WorkspaceConfigMutationService(async () => createParserStub(), undefined, {
            beforeReplace: async configPath => {
                await fs.writeFile(configPath, 'version = "1.0"\n[sources.docs]\npath = "../external"\n', 'utf8');
            }
        });

        const result = await guardedService.updateSource(workspaceRoot, {
            expectedRevision: revision,
            sourceId: 'docs',
            path: '../guides'
        });

        expectConflict(result, 'revision-mismatch');
        expect(await readConfig(workspaceRoot)).toBe('version = "1.0"\n[sources.docs]\npath = "../external"\n');
    });

    it('rolls back temp files when the atomic rename fails', async () => {
        await writeConfig(workspaceRoot, 'version = "1.0"\n[sources.docs]\npath = "../docs"\n');
        const revision = await currentRevision(workspaceRoot, reader);
        const failingFs = {
            ...fs,
            realpath: fs.realpath.bind(fs),
            readFile: fs.readFile.bind(fs),
            rename: jest.fn(async () => {
                throw Object.assign(new Error('rename failed'), { code: 'EIO' });
            }),
            unlink: fs.unlink.bind(fs),
            stat: fs.stat.bind(fs),
            open: fs.open.bind(fs)
        };
        const failingService = new WorkspaceConfigMutationService(async () => createParserStub(), failingFs as never);

        await expect(failingService.updateSource(workspaceRoot, {
            expectedRevision: revision,
            sourceId: 'docs',
            path: '../guides'
        })).rejects.toThrow('rename failed');

        const files = await fs.readdir(workspaceRoot);
        expect(files).toEqual(['.cf-workspace.toml']);
        expect(await readConfig(workspaceRoot)).toBe('version = "1.0"\n[sources.docs]\npath = "../docs"\n');
    });

    it('serializes concurrent mutations per config path', async () => {
        await writeConfig(workspaceRoot, 'version = "1.0"\n[sources.docs]\npath = "../docs"\n');
        const revision = await currentRevision(workspaceRoot, reader);
        const started: string[] = [];
        let releaseFirst: () => void = () => undefined;
        const firstGate = new Promise<void>(resolve => {
            releaseFirst = resolve;
        });
        const queuedService = new WorkspaceConfigMutationService(async () => createParserStub(), undefined, {
            beforeReplace: async () => {
                started.push('beforeReplace');
                if (started.length === 1) {
                    await firstGate;
                }
            }
        });

        const first = queuedService.updateSource(workspaceRoot, {
            expectedRevision: revision,
            sourceId: 'docs',
            path: '../guides'
        });
        const second = queuedService.addSource(workspaceRoot, {
            expectedRevision: revision,
            sourceId: 'code',
            source: { path: '../code' }
        });

        await new Promise(resolve => setTimeout(resolve, 50));
        expect(started).toEqual(['beforeReplace']);
        releaseFirst();

        const [firstResult, secondResult] = await Promise.all([first, second]);
        const results = [firstResult, secondResult];
        expect(results.filter(result => result.status === 'applied')).toHaveLength(1);
        const conflictResult = results.find(result => result.status === 'conflict');
        expect(conflictResult).toBeDefined();
        expectConflict(conflictResult!, 'revision-mismatch');
    });
});

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
                ast: buildAst(rawToml)
            };
        },
        getStaticTOMLValue(ast: AST.TOMLProgram): unknown {
            return parseRawToml((ast as FakeAst).__rawToml);
        }
    };
}

function parseRawToml(rawToml: string): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    let currentTable: Record<string, unknown> | undefined;
    for (const line of rawToml.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) {
            continue;
        }
        const tableMatch = /^\[sources\.(.+)\]$/u.exec(trimmed);
        if (tableMatch) {
            const sources = (result.sources ??= {}) as Record<string, Record<string, unknown>>;
            currentTable = {};
            sources[parseKeySegment(tableMatch[1])] = currentTable;
            continue;
        }
        const keyValueMatch = /^([A-Za-z0-9_-]+)\s*=\s*("([^"\\]|\\.)*"|'[^']*')(\s+#.*)?$/u.exec(trimmed);
        if (!keyValueMatch) {
            throw new FakeParseError('Unexpected token', 2, 1);
        }
        const target = currentTable ?? result;
        target[keyValueMatch[1]] = parseStringLiteral(keyValueMatch[2]);
    }
    return result;
}

function buildAst(rawToml: string): AST.TOMLProgram {
    const tokens: AST.Token[] = [];
    const topLevelBody: (AST.TOMLKeyValue | AST.TOMLTable)[] = [];
    const topLevel = {
        type: 'TOMLTopLevelTable',
        body: topLevelBody,
        range: [0, rawToml.length] as [number, number],
        loc: {
            start: { line: 1, column: 0 },
            end: indexToLoc(rawToml, rawToml.length)
        }
    } as AST.TOMLTopLevelTable;
    const program = {
        type: 'Program',
        body: [topLevel] as [AST.TOMLTopLevelTable],
        sourceType: 'module',
        comments: [],
        tokens,
        parent: null,
        range: [0, rawToml.length] as [number, number],
        loc: {
            start: { line: 1, column: 0 },
            end: indexToLoc(rawToml, rawToml.length)
        },
        __rawToml: rawToml
    } as FakeAst;
    topLevel.parent = program;

    let currentTable: AST.TOMLTable | undefined;
    const lineMatcher = /([^\r\n]*)(\r\n|\n|$)/g;
    for (const match of rawToml.matchAll(lineMatcher)) {
        const chunk = match[0];
        const offset = match.index ?? 0;
        if (!chunk && offset >= rawToml.length) {
            break;
        }
        const line = match[1] ?? '';
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) {
            continue;
        }

        const tableMatch = line.match(/^\[sources\.(.+)\]$/u);
        if (tableMatch) {
            const headerText = tableMatch[1];
            const sourceId = parseKeySegment(headerText);
            const keyNodes = [
                makeBareKey(offset + 1, offset + 8, 'sources', rawToml),
                makeKeySegment(offset + 9, offset + 9 + headerText.length, headerText, sourceId, rawToml)
            ];
            const key = {
                type: 'TOMLKey',
                keys: keyNodes,
                range: [offset + 1, offset + line.length - 1] as [number, number],
                loc: {
                    start: indexToLoc(rawToml, offset + 1),
                    end: indexToLoc(rawToml, offset + line.length - 1)
                }
            } as AST.TOMLKey;
            const table = {
                type: 'TOMLTable',
                kind: 'standard',
                key,
                resolvedKey: ['sources', sourceId],
                body: [],
                range: [offset, offset + line.length] as [number, number],
                loc: {
                    start: indexToLoc(rawToml, offset),
                    end: indexToLoc(rawToml, offset + line.length)
                },
                parent: topLevel
            } as AST.TOMLTable;
            key.parent = table;
            keyNodes[0].parent = key;
            keyNodes[1].parent = key;
            topLevelBody.push(table);
            currentTable = table;
            continue;
        }

        const kvMatch = line.match(/^([A-Za-z0-9_-]+)\s*=\s*(.+?)(\s+#.*)?$/u);
        if (!kvMatch) {
            continue;
        }
        const keyStart = offset + (kvMatch.index ?? 0);
        const keyEnd = keyStart + kvMatch[1].length;
        const valueStart = offset + line.indexOf(kvMatch[2]);
        const valueEnd = valueStart + kvMatch[2].length;
        const keyNode = makeBareKey(keyStart, keyEnd, kvMatch[1], rawToml);
        const key = {
            type: 'TOMLKey',
            keys: [keyNode],
            range: [keyStart, keyEnd] as [number, number],
            loc: {
                start: indexToLoc(rawToml, keyStart),
                end: indexToLoc(rawToml, keyEnd)
            }
        } as AST.TOMLKey;
        const valueNode = makeValueNode(valueStart, valueEnd, kvMatch[2], rawToml, tokens);
        const keyValue = {
            type: 'TOMLKeyValue',
            key,
            value: valueNode,
            range: [keyStart, valueEnd] as [number, number],
            loc: {
                start: indexToLoc(rawToml, keyStart),
                end: indexToLoc(rawToml, valueEnd)
            },
            parent: currentTable ?? topLevel
        } as AST.TOMLKeyValue;
        key.parent = keyValue;
        keyNode.parent = key;
        valueNode.parent = keyValue;

        if (currentTable) {
            currentTable.body.push(keyValue);
            currentTable.range = [currentTable.range[0], valueEnd];
            currentTable.loc = {
                start: currentTable.loc.start,
                end: indexToLoc(rawToml, valueEnd)
            };
        } else {
            topLevelBody.push(keyValue);
        }
    }

    return program;
}

function makeBareKey(start: number, end: number, name: string, rawToml: string): AST.TOMLBare {
    return {
        type: 'TOMLBare',
        name,
        range: [start, end],
        loc: {
            start: indexToLoc(rawToml, start),
            end: indexToLoc(rawToml, end)
        }
    } as AST.TOMLBare;
}

function makeKeySegment(start: number, end: number, rawSegment: string, value: string, rawToml: string): AST.TOMLBare | AST.TOMLQuoted {
    if (rawSegment.startsWith('"')) {
        return {
            type: 'TOMLQuoted',
            value,
            style: 'basic',
            kind: 'string',
            multiline: false,
            range: [start, end],
            loc: {
                start: indexToLoc(rawToml, start),
                end: indexToLoc(rawToml, end)
            }
        } as AST.TOMLQuoted;
    }
    return makeBareKey(start, end, value, rawToml);
}

function makeValueNode(
    start: number,
    end: number,
    rawValue: string,
    rawToml: string,
    tokens: AST.Token[]
): AST.TOMLValue {
    const loc = {
        start: indexToLoc(rawToml, start),
        end: indexToLoc(rawToml, end)
    };
    if (rawValue.startsWith('"')) {
        const parsed = JSON.parse(rawValue) as string;
        tokens.push({
            type: 'BasicString',
            value: rawValue,
            string: parsed,
            range: [start, end],
            loc
        } as AST.Token);
        return {
            type: 'TOMLValue',
            kind: 'string',
            value: parsed,
            style: 'basic',
            multiline: false,
            range: [start, end],
            loc
        } as AST.TOMLValue;
    }
    const parsed = rawValue.slice(1, -1);
    tokens.push({
        type: 'LiteralString',
        value: rawValue,
        string: parsed,
        range: [start, end],
        loc
    } as AST.Token);
    return {
        type: 'TOMLValue',
        kind: 'string',
        value: parsed,
        style: 'literal',
        multiline: false,
        range: [start, end],
        loc
    } as AST.TOMLValue;
}

function parseKeySegment(rawSegment: string): string {
    return rawSegment.startsWith('"') || rawSegment.startsWith("'") ? parseStringLiteral(rawSegment) : rawSegment;
}

function parseStringLiteral(rawValue: string): string {
    return rawValue.startsWith('"') ? JSON.parse(rawValue) as string : rawValue.slice(1, -1);
}

function indexToLoc(rawToml: string, index: number): { line: number; column: number } {
    let line = 1;
    let column = 0;
    for (let cursor = 0; cursor < index; cursor += 1) {
        if (rawToml[cursor] === '\n') {
            line += 1;
            column = 0;
        } else if (rawToml[cursor] !== '\r') {
            column += 1;
        }
    }
    return { line, column };
}

function expectConflict(
    result: WorkspaceConfigMutationResult,
    code: Extract<WorkspaceConfigMutationResult, { status: 'conflict' }>['code']
): asserts result is Extract<WorkspaceConfigMutationResult, { status: 'conflict' }> {
    expect(result.status).toBe('conflict');
    if (result.status !== 'conflict') {
        throw new Error('Expected conflict result');
    }
    expect(result.code).toBe(code);
}

async function writeConfig(workspaceRoot: string, rawToml: string): Promise<void> {
    await fs.writeFile(path.join(workspaceRoot, '.cf-workspace.toml'), rawToml, 'utf8');
}

async function readConfig(workspaceRoot: string): Promise<string> {
    return fs.readFile(path.join(workspaceRoot, '.cf-workspace.toml'), 'utf8');
}

async function currentRevision(workspaceRoot: string, reader: WorkspaceConfigService): Promise<string> {
    const loaded = await reader.load(workspaceRoot);
    expect(loaded.revision).toBeDefined();
    return loaded.revision!;
}
