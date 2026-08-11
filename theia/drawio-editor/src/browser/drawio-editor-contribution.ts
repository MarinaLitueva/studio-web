import { inject, injectable } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { CommandContribution, CommandRegistry, MenuContribution, MenuModelRegistry } from '@theia/core/lib/common';
import { DrawioEditorOpenHandler } from './drawio-editor-open-handler';

@injectable()
export class DrawioEditorContribution implements FrontendApplicationContribution, CommandContribution, MenuContribution {
    @inject(DrawioEditorOpenHandler)
    protected readonly openHandler: DrawioEditorOpenHandler;

    onStart(): void {
        void this.openHandler;
    }

    registerCommands(_commands: CommandRegistry): void {
    }

    registerMenus(_menus: MenuModelRegistry): void {
    }
}
