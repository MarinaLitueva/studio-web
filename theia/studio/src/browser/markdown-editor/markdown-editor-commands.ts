import { Command } from '@theia/core/lib/common';

export namespace MarkdownEditorCommands {
    export const OPEN_AS_TEXT: Command = Command.toDefaultLocalizedCommand({
        id: 'studio.markdownEditor.openAsText',
        label: 'Open as Text'
    });
    export const BOLD: Command = Command.toDefaultLocalizedCommand({
        id: 'studio.markdownEditor.bold',
        label: 'Bold'
    });
    export const ITALIC: Command = Command.toDefaultLocalizedCommand({
        id: 'studio.markdownEditor.italic',
        label: 'Italic'
    });
    export const UNDERLINE: Command = Command.toDefaultLocalizedCommand({
        id: 'studio.markdownEditor.underline',
        label: 'Underline'
    });
    export const INLINE_CODE: Command = Command.toDefaultLocalizedCommand({
        id: 'studio.markdownEditor.inlineCode',
        label: 'Inline Code'
    });
    export const BULLETED_LIST: Command = Command.toDefaultLocalizedCommand({
        id: 'studio.markdownEditor.bulletedList',
        label: 'Bulleted List'
    });
    export const NUMBERED_LIST: Command = Command.toDefaultLocalizedCommand({
        id: 'studio.markdownEditor.numberedList',
        label: 'Numbered List'
    });
    export const CREATE_LINK: Command = Command.toDefaultLocalizedCommand({
        id: 'studio.markdownEditor.createLink',
        label: 'Create Link'
    });
    export const INSERT_IMAGE: Command = Command.toDefaultLocalizedCommand({
        id: 'studio.markdownEditor.insertImage',
        label: 'Insert Image'
    });
    export const INSERT_TABLE: Command = Command.toDefaultLocalizedCommand({
        id: 'studio.markdownEditor.insertTable',
        label: 'Insert Table'
    });
}
