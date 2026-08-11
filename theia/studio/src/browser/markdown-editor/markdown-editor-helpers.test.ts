import {
    canonicalizeMarkdown,
    chooseCollisionSafeAssetName,
    createAssetNaming,
    createAssetPlacement,
    prepareMarkdownForEditor,
    restoreMarkdownFromEditor
} from './markdown-editor-shared';
import { syncEditorMarkdown } from './markdown-editor-sync';

describe('Markdown editor helpers', () => {
    it('keeps collision-safe image names stable and increments suffixes', async () => {
        const naming = createAssetNaming('/docs/Guide.md', 'Screen Shot.png', 'image/png');
        expect(naming).toEqual({
            assetDirName: 'Guide.assets',
            baseName: 'screen-shot',
            extension: '.png'
        });

        await expect(chooseCollisionSafeAssetName(naming, candidate => candidate !== 'screen-shot-3.png')).resolves.toBe('screen-shot-3.png');
    });

    it('encodes asset links and infers missing image extensions from media type', () => {
        const naming = createAssetNaming('/docs/Guide.md', 'diagram', 'image/svg+xml');
        expect(naming.extension).toBe('.svg');

        expect(createAssetPlacement('/docs/Guide.md', 'My Diagram (v2).png', 'image/png', 'my diagram (v2).png')).toEqual({
            assetDirName: 'Guide.assets',
            fileName: 'my diagram (v2).png',
            markdownLink: '![My Diagram (v2)](Guide.assets/my%20diagram%20%28v2%29.png)'
        });
    });

    it('canonicalizes markdown and applies explicit external editor syncs', () => {
        expect(canonicalizeMarkdown('Line 1  \r\nLine 2')).toBe('Line 1\nLine 2\n');

        const editor = { setMarkdown: jest.fn() } as unknown as Parameters<typeof syncEditorMarkdown>[0];
        syncEditorMarkdown(editor, '# Updated\n');
        expect((editor as unknown as { setMarkdown: jest.Mock }).setMarkdown).toHaveBeenCalledWith('# Updated\n');
    });

    it('preserves inline and multiline HTML comments across the editor boundary', () => {
        const markdown = [
            '# Heading',
            '',
            '<!-- @cf:feature',
            'hidden metadata: Привет 👋',
            '-->',
            '',
            'Visible <!-- keep inline --> text.',
            ''
        ].join('\n');

        const prepared = prepareMarkdownForEditor(markdown);

        expect(prepared).not.toContain('<!--');
        expect(prepared).toContain('data-cf-studio-markdown-comment=');
        expect(restoreMarkdownFromEditor(prepared)).toBe(markdown);
    });

    it('restores comment markers serialized as self-closing MDX elements', () => {
        const prepared = prepareMarkdownForEditor('Before <!-- keep --> after');
        const selfClosing = prepared.replace('></span>', ' />');

        expect(restoreMarkdownFromEditor(selfClosing)).toBe('Before <!-- keep --> after');
    });

    it('restores standalone protected comments without serializer-added blank lines', () => {
        const markdown = 'Alpha\n\n<!-- @cf:feature -->\n\nOmega\n';
        const prepared = prepareMarkdownForEditor(markdown);
        const serialized = prepared.replace(
            /(<span\s+data-cf-studio-markdown-comment="[^"]+"\s*><\/span>)/u,
            '\n$1\n'
        );

        expect(restoreMarkdownFromEditor(serialized)).toBe(markdown);
    });

    it('leaves comment syntax in code spans and code blocks visible to the editor', () => {
        const markdown = [
            '`<!-- inline example -->`',
            '',
            '```html',
            '<!-- fenced example -->',
            '```',
            '',
            '    <!-- indented example -->',
            '',
            '<!-- actual comment -->'
        ].join('\n');

        const prepared = prepareMarkdownForEditor(markdown);

        expect(prepared).toContain('`<!-- inline example -->`');
        expect(prepared).toContain('<!-- fenced example -->');
        expect(prepared).toContain('<!-- indented example -->');
        expect(prepared).not.toContain('<!-- actual comment -->');
        expect(restoreMarkdownFromEditor(prepared)).toBe(markdown);
    });
});
