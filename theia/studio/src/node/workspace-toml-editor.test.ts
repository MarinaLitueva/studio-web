import type { AST } from 'toml-eslint-parser';
import { WorkspaceTomlEditor } from './workspace-toml-editor';

describe('workspace toml editor', () => {
    let editor: WorkspaceTomlEditor;

    beforeEach(() => {
        editor = new WorkspaceTomlEditor();
    });

    it('adds a source without disturbing comments, order, unknown bytes, or final newline style', () => {
        const rawToml = [
            '# workspace comment',
            'version = "1.0"',
            'title = "keep-me"',
            '',
            '[sources.docs]',
            'path = "../docs"',
            'role = "artifacts"'
        ].join('\n');

        const result = editor.addSource(rawToml, buildAst(rawToml), 'code repo', {
            url: 'https://example.com/code.git',
            branch: 'main',
            role: 'codebase'
        });

        expect(result.status).toBe('applied');
        if (result.status !== 'applied') {
            return;
        }
        expect(result.rawToml).toBe([
            '# workspace comment',
            'version = "1.0"',
            'title = "keep-me"',
            '',
            '[sources.docs]',
            'path = "../docs"',
            'role = "artifacts"',
            '',
            '[sources."code repo"]',
            'role = "codebase"',
            'url = "https://example.com/code.git"',
            'branch = "main"'
        ].join('\n'));
    });

    it('updates only targeted values, preserves inline comments, and removes only the requested key line', () => {
        const rawToml = [
            'version = "1.0"',
            '',
            '[sources.docs]',
            'path = "../docs" # keep',
            "adapter = '.cf-studio'",
            'role = "artifacts"',
            ''
        ].join('\n');

        const result = editor.updateSource(rawToml, buildAst(rawToml), 'docs', {
            path: '../guides',
            adapter: null
        });

        expect(result.status).toBe('applied');
        if (result.status !== 'applied') {
            return;
        }
        expect(result.rawToml).toBe([
            'version = "1.0"',
            '',
            '[sources.docs]',
            'path = "../guides" # keep',
            'role = "artifacts"',
            ''
        ].join('\n'));
    });

    it('removes only the selected table and preserves nearby comments', () => {
        const rawToml = [
            'version = "1.0"',
            '',
            '[sources.docs]',
            'path = "../docs"',
            '',
            '# keep this comment',
            '[sources.code]',
            'path = "../code"',
            ''
        ].join('\n');

        const result = editor.removeSource(rawToml, buildAst(rawToml), 'docs');

        expect(result.status).toBe('applied');
        if (result.status !== 'applied') {
            return;
        }
        expect(result.rawToml).toBe([
            'version = "1.0"',
            '',
            '# keep this comment',
            '[sources.code]',
            'path = "../code"',
            ''
        ].join('\n'));
    });

    it('renames only the table key and requires confirmation for exact external references', () => {
        const rawToml = [
            'version = "1.0"',
            'note = "docs"',
            '',
            '[sources.docs]',
            'path = "../docs"',
            ''
        ].join('\n');
        const ast = buildAst(rawToml);

        const preview = editor.renameSource(rawToml, ast, {
            expectedRevision: 'rev',
            sourceId: 'docs',
            nextSourceId: 'guides'
        });

        expect(preview.status).toBe('conflict');
        if (preview.status !== 'conflict') {
            return;
        }
        expect(preview.code).toBe('confirmation-required');
        expect(preview.impacts).toEqual([
            expect.objectContaining({
                path: 'note',
                evidence: '"docs"',
                confirmed: false,
                requiresExplicitEdit: true,
                range: { start: rawToml.indexOf('"docs"'), end: rawToml.indexOf('"docs"') + 6, line: 2, column: 7 }
            })
        ]);

        const confirmed = editor.renameSource(rawToml, ast, {
            expectedRevision: 'rev',
            sourceId: 'docs',
            nextSourceId: 'guides',
            confirmedImpactIds: preview.impacts?.map(impact => impact.impactId)
        });

        expect(confirmed.status).toBe('applied');
        if (confirmed.status !== 'applied') {
            return;
        }
        expect(confirmed.rawToml).toBe([
            'version = "1.0"',
            'note = "docs"',
            '',
            '[sources.guides]',
            'path = "../docs"',
            ''
        ].join('\n'));
    });

    it('preserves CRLF and trailing newline style across additive edits', () => {
        const rawToml = 'version = "1.0"\r\n\r\n[sources.docs]\r\npath = "../docs"\r\n';

        const result = editor.addSource(rawToml, buildAst(rawToml), 'remote', {
            url: 'https://example.com/remote.git',
            branch: 'main'
        });

        expect(result.status).toBe('applied');
        if (result.status !== 'applied') {
            return;
        }
        expect(result.rawToml).toBe(
            'version = "1.0"\r\n\r\n[sources.docs]\r\npath = "../docs"\r\n\r\n[sources.remote]\r\nurl = "https://example.com/remote.git"\r\nbranch = "main"\r\n'
        );
    });

    it('quotes and escapes unsafe key segments and string values safely', () => {
        const rawToml = 'version = "1.0"\n';

        const result = editor.addSource(rawToml, buildAst(rawToml), 'docs "team"', {
            path: '../docs "team"'
        });

        expect(result.status).toBe('applied');
        if (result.status !== 'applied') {
            return;
        }
        expect(result.rawToml).toContain('[sources."docs \\"team\\""]');
        expect(result.rawToml).toContain('path = "../docs \\"team\\""');
    });

    it('rejects invalid source shapes, duplicates, and missing tables', () => {
        const rawToml = [
            'version = "1.0"',
            '',
            '[sources.docs]',
            'path = "../docs"',
            ''
        ].join('\n');
        const ast = buildAst(rawToml);

        expect(editor.addSource(rawToml, ast, 'invalid', { path: '../x', url: 'https://example.com/x.git' })).toMatchObject({
            status: 'conflict',
            code: 'invalid-request'
        });
        expect(editor.addSource(rawToml, ast, 'docs', { path: '../x' })).toMatchObject({
            status: 'conflict',
            code: 'source-conflict'
        });
        expect(editor.updateSource(rawToml, ast, 'missing', { path: '../x' })).toMatchObject({
            status: 'conflict',
            code: 'invalid-request'
        });
        expect(editor.renameSource(rawToml, ast, {
            expectedRevision: 'rev',
            sourceId: 'docs',
            nextSourceId: 'docs'
        })).toMatchObject({
            status: 'conflict',
            code: 'source-conflict'
        });
    });
});

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
        }
    } as AST.TOMLProgram;
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
                range: [offset + 1, offset + line.length - 1],
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
        const keyStart = offset + kvMatch.index!;
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
    if (rawValue.startsWith("'")) {
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
    tokens.push({
        type: 'Bare',
        value: rawValue,
        range: [start, end],
        loc
    } as AST.Token);
    return {
        type: 'TOMLValue',
        kind: 'string',
        value: rawValue,
        style: 'basic',
        multiline: false,
        range: [start, end],
        loc
    } as AST.TOMLValue;
}

function parseKeySegment(rawSegment: string): string {
    return rawSegment.startsWith('"') ? JSON.parse(rawSegment) as string : rawSegment;
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
