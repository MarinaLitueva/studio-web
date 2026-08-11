export function canonicalizeMarkdown(markdown: string): string {
    const normalized = markdown.replace(/\r\n?/g, '\n');
    const withoutTrailingWhitespace = normalized
        .split('\n')
        .map(line => line.replace(/[ \t]+$/g, ''))
        .join('\n');
    if (withoutTrailingWhitespace.length === 0) {
        return '';
    }
    return `${withoutTrailingWhitespace.replace(/\n*$/g, '')}\n`;
}

const MARKDOWN_COMMENT_MARKER_PATTERN =
    /<span\s+data-cf-studio-markdown-comment="([a-z0-9-]+):([a-z0-9-]+)"\s*(?:\/>|>\s*<\/span>)/giu;

export interface MarkdownCommentToken {
    readonly comment: string;
    readonly standalone: boolean;
    readonly leadingNewlines: number;
    readonly trailingNewlines: number;
}

const commentTokenTables = new Map<string, MarkdownCommentTokenTable>();

export class MarkdownCommentTokenTable {
    protected nextId = 1;
    protected readonly tokens = new Map<string, MarkdownCommentToken>();
    protected readonly registered: boolean;
    readonly nonce = createCommentTokenNonce();

    constructor(registered = false) {
        this.registered = registered;
        if (registered) {
            commentTokenTables.set(this.nonce, this);
        }
    }

    clear(): void {
        this.tokens.clear();
        this.nextId = 1;
    }

    dispose(): void {
        this.clear();
        if (this.registered) {
            commentTokenTables.delete(this.nonce);
        }
    }

    issue(comment: string, standalone: boolean, leadingNewlines = 0, trailingNewlines = 0): string {
        const id = `comment-${this.nextId++}`;
        this.tokens.set(id, { comment, standalone, leadingNewlines, trailingNewlines });
        return `${this.nonce}:${id}`;
    }

    resolve(id: string): MarkdownCommentToken | undefined {
        return this.tokens.get(id);
    }
}

/**
 * MDXEditor 3.55 parses HTML comments but does not create an exportable
 * Lexical node for them. Represent comments as hidden generic HTML nodes while
 * the document is inside MDXEditor, then restore them at the editor boundary.
 */
export function prepareMarkdownForEditor(markdown: string): string {
    return prepareMarkdownForEditorWithTokens(markdown, new MarkdownCommentTokenTable(true));
}

export function prepareMarkdownForEditorWithTokens(markdown: string, tokenTable: MarkdownCommentTokenTable): string {
    tokenTable.clear();
    let result = '';
    let offset = 0;
    let lineStart = true;
    let inlineCodeDelimiterLength = 0;
    let fence: { readonly marker: '`' | '~'; readonly length: number } | undefined;

    while (offset < markdown.length) {
        if (lineStart && inlineCodeDelimiterLength === 0) {
            const lineEnd = markdown.indexOf('\n', offset);
            const end = lineEnd === -1 ? markdown.length : lineEnd;
            const line = markdown.slice(offset, end);
            const fenceMatch = /^ {0,3}(`{3,}|~{3,})/u.exec(line);

            if (fence) {
                const closingFence = new RegExp(`^ {0,3}${fence.marker}{${fence.length},}[ \\t]*$`, 'u');
                if (closingFence.test(line)) {
                    fence = undefined;
                }
                const nextOffset = lineEnd === -1 ? end : end + 1;
                result += markdown.slice(offset, nextOffset);
                offset = nextOffset;
                lineStart = true;
                continue;
            }

            if (fenceMatch) {
                const marker = fenceMatch[1][0] as '`' | '~';
                fence = { marker, length: fenceMatch[1].length };
                const nextOffset = lineEnd === -1 ? end : end + 1;
                result += markdown.slice(offset, nextOffset);
                offset = nextOffset;
                lineStart = true;
                continue;
            }

            if (/^(?: {4}|\t)/u.test(line)) {
                const nextOffset = lineEnd === -1 ? end : end + 1;
                result += markdown.slice(offset, nextOffset);
                offset = nextOffset;
                lineStart = true;
                continue;
            }
        }

        if (markdown[offset] === '`') {
            let runEnd = offset + 1;
            while (markdown[runEnd] === '`') {
                runEnd += 1;
            }
            const runLength = runEnd - offset;
            if (inlineCodeDelimiterLength === 0) {
                inlineCodeDelimiterLength = runLength;
            } else if (inlineCodeDelimiterLength === runLength) {
                inlineCodeDelimiterLength = 0;
            }
            result += markdown.slice(offset, runEnd);
            offset = runEnd;
            lineStart = false;
            continue;
        }

        if (inlineCodeDelimiterLength === 0 && markdown.startsWith('<!--', offset)) {
            const commentEnd = markdown.indexOf('-->', offset + 4);
            if (commentEnd !== -1) {
                const end = commentEnd + 3;
                const comment = markdown.slice(offset, end);
                const standalone = isStandaloneComment(markdown, offset, end);
                const token = tokenTable.issue(
                    comment,
                    standalone,
                    standalone ? countAdjacentNewlinesBefore(markdown, offset) : 0,
                    standalone ? countAdjacentNewlinesAfter(markdown, end) : 0
                );
                result += `<span data-cf-studio-markdown-comment="${token}"></span>`;
                offset = end;
                lineStart = false;
                continue;
            }
        }

        const character = markdown[offset];
        result += character;
        offset += 1;
        lineStart = character === '\n';
    }

    return result;
}

export function restoreMarkdownFromEditor(markdown: string): string {
    const tokenTables = new Set<MarkdownCommentTokenTable>();
    for (const match of markdown.matchAll(MARKDOWN_COMMENT_MARKER_PATTERN)) {
        const tokenTable = commentTokenTables.get(match[1]);
        if (tokenTable) {
            tokenTables.add(tokenTable);
        }
    }
    const restored = restoreMarkdownFromEditorWithTokens(markdown);
    tokenTables.forEach(tokenTable => tokenTable.dispose());
    return restored;
}

export function restoreMarkdownFromEditorWithTokens(markdown: string, tokenTable?: MarkdownCommentTokenTable): string {
    let result = '';
    let cursor = 0;

    for (const match of markdown.matchAll(MARKDOWN_COMMENT_MARKER_PATTERN)) {
        const marker = match[0];
        const nonce = match[1];
        const tokenId = match[2];
        const start = match.index ?? 0;
        const end = start + marker.length;
        const token = resolveCommentToken(nonce, tokenId, tokenTable);
        if (!token) {
            result += markdown.slice(cursor, end);
            cursor = end;
            continue;
        }

        const leadingNewlineCount = countAdjacentNewlinesBefore(markdown, start);
        const trailingNewlineCount = countAdjacentNewlinesAfter(markdown, end);
        const addedLeadingNewlines = token.standalone
            ? Math.max(0, leadingNewlineCount - token.leadingNewlines)
            : 0;
        const addedTrailingNewlines = token.standalone
            ? Math.max(0, trailingNewlineCount - token.trailingNewlines)
            : 0;
        const copyEnd = start - addedLeadingNewlines;
        result += markdown.slice(cursor, copyEnd);
        result += token.comment;
        cursor = end + addedTrailingNewlines;
    }

    result += markdown.slice(cursor);
    return result;
}

function resolveCommentToken(
    nonce: string,
    tokenId: string,
    tokenTable?: MarkdownCommentTokenTable
): MarkdownCommentToken | undefined {
    if (tokenTable?.nonce === nonce) {
        return tokenTable.resolve(tokenId);
    }
    return commentTokenTables.get(nonce)?.resolve(tokenId);
}

function isStandaloneComment(markdown: string, offset: number, end: number): boolean {
    const lineStart = markdown.lastIndexOf('\n', offset - 1) + 1;
    const lineEndIndex = markdown.indexOf('\n', end);
    const lineEnd = lineEndIndex === -1 ? markdown.length : lineEndIndex;
    return /^[ \t]*$/u.test(markdown.slice(lineStart, offset))
        && /^[ \t]*$/u.test(markdown.slice(end, lineEnd));
}

function createCommentTokenNonce(): string {
    return `comments-${Math.random().toString(36).slice(2, 10)}`;
}

function countAdjacentNewlinesBefore(markdown: string, offset: number): number {
    let count = 0;
    let cursor = offset - 1;
    while (cursor >= 0 && markdown[cursor] === '\n') {
        count += 1;
        cursor -= 1;
    }
    return count;
}

function countAdjacentNewlinesAfter(markdown: string, offset: number): number {
    let count = 0;
    let cursor = offset;
    while (cursor < markdown.length && markdown[cursor] === '\n') {
        count += 1;
        cursor += 1;
    }
    return count;
}

export interface RoundTripFixture {
    readonly name: string;
    readonly markdown: string;
}

export const representativeRoundTripFixtures: readonly RoundTripFixture[] = [
    {
        name: 'headings and lists',
        markdown: '# Heading\n\n- One\n- Two\n\n1. First\n2. Second\n'
    },
    {
        name: 'table and link',
        markdown: '| Name | Link |\n| --- | --- |\n| Studio | [Docs](docs/index.md) |\n'
    },
    {
        name: 'fenced code and frontmatter',
        markdown: '---\ntitle: Example\n---\n\n```ts\nconst value = 1;\n```\n'
    }
];

export interface AssetNaming {
    readonly assetDirName: string;
    readonly baseName: string;
    readonly extension: string;
}

export interface AssetPlacement {
    readonly assetDirName: string;
    readonly fileName: string;
    readonly markdownLink: string;
}

const mimeExtensions: Record<string, string> = {
    'image/gif': '.gif',
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/svg+xml': '.svg',
    'image/webp': '.webp'
};

export function createAssetNaming(documentPath: string, originalFileName: string, mediaType: string): AssetNaming {
    const documentBase = stripMarkdownExtension(lastPathSegment(documentPath) || 'document');
    const assetDirName = `${documentBase}.assets`;
    const originalBase = stripExtension(lastPathSegment(originalFileName) || 'image');
    return {
        assetDirName,
        baseName: sanitizePathSegment(originalBase) || 'image',
        extension: resolveImageExtension(originalFileName, mediaType)
    };
}

export async function chooseCollisionSafeAssetName(
    naming: AssetNaming,
    exists: (fileName: string) => boolean | Promise<boolean>
): Promise<string> {
    let index = 1;
    for (;;) {
        const suffix = index === 1 ? '' : `-${index}`;
        const candidate = `${naming.baseName}${suffix}${naming.extension}`;
        if (!await exists(candidate)) {
            return candidate;
        }
        index += 1;
    }
}

export function createAssetPlacement(documentPath: string, fileName: string, mediaType: string, assetFileName: string): AssetPlacement {
    const naming = createAssetNaming(documentPath, fileName, mediaType);
    return {
        assetDirName: naming.assetDirName,
        fileName: assetFileName,
        markdownLink: `![${escapeMarkdownAlt(stripExtension(fileName) || 'Image')}](${encodeMarkdownDestination(`${naming.assetDirName}/${assetFileName}`)})`
    };
}

function encodeMarkdownDestination(destination: string): string {
    return destination
        .split('/')
        .map(segment => encodeURIComponent(segment).replace(/[()]/g, character => `%${character.charCodeAt(0).toString(16).toUpperCase()}`))
        .join('/');
}

function sanitizePathSegment(value: string): string {
    return value
        .normalize('NFKD')
        .replace(/[^\w.-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .replace(/-{2,}/g, '-')
        .toLowerCase();
}

function resolveImageExtension(fileName: string, mediaType: string): string {
    const extension = extensionOf(fileName);
    if (extension) {
        return extension.toLowerCase();
    }
    return mimeExtensions[mediaType.toLowerCase()] ?? '.png';
}

function lastPathSegment(path: string): string {
    return path.split(/[\\/]/g).filter(Boolean).pop() ?? '';
}

function stripMarkdownExtension(fileName: string): string {
    return fileName.replace(/\.md$/i, '');
}

function stripExtension(fileName: string): string {
    return fileName.replace(/\.[^.]+$/u, '');
}

function extensionOf(fileName: string): string {
    const match = /\.[A-Za-z0-9]+$/u.exec(fileName);
    return match?.[0] ?? '';
}

function escapeMarkdownAlt(value: string): string {
    return value.replace(/[[\]\\]/g, '\\$&');
}
