import { inject, injectable } from '@theia/core/shared/inversify';
import {
    CommonCommands,
    ContextMenuRenderer,
    FrontendApplicationContribution,
    OpenWithService
} from '@theia/core/lib/browser';
import { CommandContribution, CommandRegistry, MenuContribution, MenuModelRegistry, MenuPath } from '@theia/core/lib/common';
import { EditorManager } from '@theia/editor/lib/browser';
import { MarkdownEditorOpenHandler } from './markdown-editor-open-handler';
import { MarkdownEditorWidget } from './markdown-editor-widget';
import { MarkdownEditorCommands } from './markdown-editor-commands';

export namespace MarkdownEditorMenus {
    export const CONTEXT_MENU: MenuPath = ['studio-markdown-editor-context-menu'];
}

@injectable()
export class MarkdownEditorContribution implements FrontendApplicationContribution, CommandContribution, MenuContribution {
    @inject(MarkdownEditorOpenHandler)
    protected readonly openHandler: MarkdownEditorOpenHandler;

    @inject(OpenWithService)
    protected readonly openWithService: OpenWithService;

    @inject(EditorManager)
    protected readonly editorManager: EditorManager;

    @inject(ContextMenuRenderer)
    protected readonly contextMenuRenderer: ContextMenuRenderer;

    onStart(): void {
        this.openHandler.registerOpenWith(this.openWithService);
    }

    registerCommands(commands: CommandRegistry): void {
        commands.registerCommand(MarkdownEditorCommands.OPEN_AS_TEXT, {
            isEnabled: widget => widget instanceof MarkdownEditorWidget,
            isVisible: widget => widget instanceof MarkdownEditorWidget,
            execute: async widget => {
                const editor = widget instanceof MarkdownEditorWidget ? widget : this.openHandler.currentWidget;
                const resource = editor?.getResourceUri();
                if (resource) {
                    await this.editorManager.open(resource);
                }
            }
        });

        const registerForwardedCommand = (
            command: typeof CommonCommands.UNDO | typeof CommonCommands.REDO | typeof CommonCommands.CUT | typeof CommonCommands.COPY | typeof CommonCommands.PASTE | typeof CommonCommands.SELECT_ALL,
            capability: keyof Pick<MarkdownEditorWidget, 'supportsClipboardActions' | 'supportsUndoRedo'>,
            runner: (widget: MarkdownEditorWidget) => void
        ): void => {
            commands.registerHandler(command.id, {
                isEnabled: () => {
                    const widget = this.openHandler.currentWidget;
                    if (!widget) {
                        return false;
                    }
                    return capability === 'supportsUndoRedo' ? widget.supportsUndoRedo() : widget.supportsClipboardActions();
                },
                isVisible: () => !!this.openHandler.currentWidget,
                execute: () => {
                    const widget = this.openHandler.currentWidget;
                    if (widget) {
                        runner(widget);
                    }
                }
            });
        };

        registerForwardedCommand(CommonCommands.UNDO, 'supportsUndoRedo', widget => widget.execNativeAction('undo'));
        registerForwardedCommand(CommonCommands.REDO, 'supportsUndoRedo', widget => widget.execNativeAction('redo'));
        registerForwardedCommand(CommonCommands.CUT, 'supportsClipboardActions', widget => widget.execNativeAction('cut'));
        registerForwardedCommand(CommonCommands.COPY, 'supportsClipboardActions', widget => widget.execNativeAction('copy'));
        registerForwardedCommand(CommonCommands.PASTE, 'supportsClipboardActions', widget => widget.execNativeAction('paste'));
        registerForwardedCommand(CommonCommands.SELECT_ALL, 'supportsClipboardActions', widget => widget.execNativeAction('selectAll'));

        const registerToolbarCommand = (command: typeof MarkdownEditorCommands[keyof typeof MarkdownEditorCommands], label: string): void => {
            commands.registerCommand(command, {
                isEnabled: widget => widget instanceof MarkdownEditorWidget && widget.hasToolbarAction(label),
                isVisible: widget => widget instanceof MarkdownEditorWidget,
                execute: widget => {
                    if (widget instanceof MarkdownEditorWidget) {
                        widget.activateToolbarAction(label);
                    }
                }
            });
        };

        registerToolbarCommand(MarkdownEditorCommands.BOLD, 'Bold');
        registerToolbarCommand(MarkdownEditorCommands.ITALIC, 'Italic');
        registerToolbarCommand(MarkdownEditorCommands.UNDERLINE, 'Underline');
        registerToolbarCommand(MarkdownEditorCommands.INLINE_CODE, 'Inline code format');
        registerToolbarCommand(MarkdownEditorCommands.BULLETED_LIST, 'Bulleted list');
        registerToolbarCommand(MarkdownEditorCommands.NUMBERED_LIST, 'Numbered list');
        registerToolbarCommand(MarkdownEditorCommands.CREATE_LINK, 'Create link');
        registerToolbarCommand(MarkdownEditorCommands.INSERT_IMAGE, 'Insert image');
        registerToolbarCommand(MarkdownEditorCommands.INSERT_TABLE, 'Insert Table');
    }

    registerMenus(menus: MenuModelRegistry): void {
        menus.registerMenuAction(MarkdownEditorMenus.CONTEXT_MENU, {
            commandId: CommonCommands.UNDO.id,
            order: '0'
        });
        menus.registerMenuAction(MarkdownEditorMenus.CONTEXT_MENU, {
            commandId: CommonCommands.REDO.id,
            order: '1'
        });
        menus.registerMenuAction(MarkdownEditorMenus.CONTEXT_MENU, {
            commandId: CommonCommands.CUT.id,
            order: '2'
        });
        menus.registerMenuAction(MarkdownEditorMenus.CONTEXT_MENU, {
            commandId: CommonCommands.COPY.id,
            order: '3'
        });
        menus.registerMenuAction(MarkdownEditorMenus.CONTEXT_MENU, {
            commandId: CommonCommands.PASTE.id,
            order: '4'
        });
        menus.registerMenuAction(MarkdownEditorMenus.CONTEXT_MENU, {
            commandId: CommonCommands.SELECT_ALL.id,
            order: '5'
        });
        menus.registerMenuAction(MarkdownEditorMenus.CONTEXT_MENU, {
            commandId: MarkdownEditorCommands.BOLD.id,
            order: '6'
        });
        menus.registerMenuAction(MarkdownEditorMenus.CONTEXT_MENU, {
            commandId: MarkdownEditorCommands.ITALIC.id,
            order: '7'
        });
        menus.registerMenuAction(MarkdownEditorMenus.CONTEXT_MENU, {
            commandId: MarkdownEditorCommands.UNDERLINE.id,
            order: '8'
        });
        menus.registerMenuAction(MarkdownEditorMenus.CONTEXT_MENU, {
            commandId: MarkdownEditorCommands.INLINE_CODE.id,
            order: '9'
        });
        menus.registerMenuAction(MarkdownEditorMenus.CONTEXT_MENU, {
            commandId: MarkdownEditorCommands.BULLETED_LIST.id,
            order: '10'
        });
        menus.registerMenuAction(MarkdownEditorMenus.CONTEXT_MENU, {
            commandId: MarkdownEditorCommands.NUMBERED_LIST.id,
            order: '11'
        });
        menus.registerMenuAction(MarkdownEditorMenus.CONTEXT_MENU, {
            commandId: MarkdownEditorCommands.CREATE_LINK.id,
            order: '12'
        });
        menus.registerMenuAction(MarkdownEditorMenus.CONTEXT_MENU, {
            commandId: MarkdownEditorCommands.INSERT_IMAGE.id,
            order: '13'
        });
        menus.registerMenuAction(MarkdownEditorMenus.CONTEXT_MENU, {
            commandId: MarkdownEditorCommands.INSERT_TABLE.id,
            order: '14'
        });
        menus.registerMenuAction(MarkdownEditorMenus.CONTEXT_MENU, {
            commandId: MarkdownEditorCommands.OPEN_AS_TEXT.id,
            order: '15'
        });
    }
}
