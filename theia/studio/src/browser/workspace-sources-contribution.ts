import type { CommandRegistry } from '@theia/core/lib/common/command';
import { injectable, inject } from '@theia/core/shared/inversify';
import { AbstractViewContribution } from '@theia/core/lib/browser/shell/view-contribution';
import { FrontendApplicationContribution } from '@theia/core/lib/browser/frontend-application-contribution';
import { MenuModelRegistry } from '@theia/core';
import { CommonMenus } from '@theia/core/lib/browser/common-menus';
import {
    WorkspaceSourcesFrontendController,
    WorkspaceSourcesOpenRootCommand,
    WorkspaceSourcesToggleCommand
} from './workspace-sources-controller';
import { WorkspaceSourcesWidget } from './workspace-sources-widget';

const NAVIGATOR_WORKSPACE_CONTEXT_MENU = ['navigator-context-menu', '2_workspace'];

@injectable()
export class WorkspaceSourcesContribution extends AbstractViewContribution<WorkspaceSourcesWidget> implements FrontendApplicationContribution {
    constructor(
        @inject(WorkspaceSourcesFrontendController)
        protected readonly controller: WorkspaceSourcesFrontendController
    ) {
        super({
            widgetId: WorkspaceSourcesWidget.ID,
            widgetName: WorkspaceSourcesWidget.LABEL,
            defaultWidgetOptions: { area: 'right' },
            toggleCommandId: WorkspaceSourcesToggleCommand.id
        });
    }

    async onStart(): Promise<void> {
        this.controller.onDidRequestOpenView(() => {
            void this.openView({ activate: true, reveal: true });
        });
    }

    override registerCommands(_commands: CommandRegistry): void {
        // The controller owns the workspace sources commands.
    }

    override registerMenus(menus: MenuModelRegistry): void {
        menus.registerMenuAction(CommonMenus.VIEW_VIEWS, {
            commandId: WorkspaceSourcesToggleCommand.id,
            label: WorkspaceSourcesWidget.LABEL
        });
        menus.registerMenuAction(NAVIGATOR_WORKSPACE_CONTEXT_MENU, {
            commandId: WorkspaceSourcesOpenRootCommand.id,
            label: 'Open Workspace Sources'
        });
    }
}
