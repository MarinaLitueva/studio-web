import type { MDXEditorMethods } from '@mdxeditor/editor';

export function syncEditorMarkdown(editor: MDXEditorMethods | null | undefined, markdown: string): void {
    editor?.setMarkdown(markdown);
}
