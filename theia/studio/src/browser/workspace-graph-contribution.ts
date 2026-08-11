import { injectable, inject } from '@theia/core/shared/inversify';
import { AbstractViewContribution, FrontendApplicationContribution, type OpenViewArguments } from '@theia/core/lib/browser';
import { Command, CommandRegistry, MenuModelRegistry } from '@theia/core';
import { CommonMenus } from '@theia/core/lib/browser/common-menus';
import { WorkspaceGraphWidget } from './workspace-graph-widget';
import { ObjectDetailsWidget } from './object-details-widget';
import { WorkspaceGraphFrontendController } from './workspace-graph-widget';
import { WorkspaceGraphService } from '../common/graph-model';

export const WorkspaceGraphCommand: Command = { id: 'studio.workspace-graph:toggle' };
export const ObjectDetailsCommand: Command = { id: 'studio.object-details:toggle' };

@injectable()
export class WorkspaceGraphContribution extends AbstractViewContribution<WorkspaceGraphWidget> implements FrontendApplicationContribution {
    constructor(
        @inject(WorkspaceGraphFrontendController) controller: WorkspaceGraphFrontendController,
        @inject(WorkspaceGraphService) graphService: WorkspaceGraphService
    ) {
        super({
            widgetId: WorkspaceGraphWidget.ID,
            widgetName: WorkspaceGraphWidget.LABEL,
            defaultWidgetOptions: { area: 'main' },
            toggleCommandId: WorkspaceGraphCommand.id
        });
        controller.bindGraphService(graphService);
    }

    async onStart(): Promise<void> {
        await this.openView({ activate: false, reveal: true });
    }

    registerCommands(commands: CommandRegistry): void {
        super.registerCommands(commands);
        commands.registerCommand(ObjectDetailsCommand, {
            execute: async () => {
                await this.shell.addWidget(await this.widgetManager.getOrCreateWidget(ObjectDetailsWidget.ID), { area: 'right' });
                await this.shell.activateWidget(ObjectDetailsWidget.ID);
            }
        });
    }

    registerMenus(menus: MenuModelRegistry): void {
        super.registerMenus(menus);
        menus.registerMenuAction(CommonMenus.VIEW_VIEWS, {
            commandId: ObjectDetailsCommand.id,
            label: ObjectDetailsWidget.LABEL
        });
    }

    override async openView(args: Partial<OpenViewArguments> = {}): Promise<WorkspaceGraphWidget> {
        const widget = await super.openView({ ...args, activate: true, reveal: true });
        const detailsWidget = await this.widgetManager.getOrCreateWidget(ObjectDetailsWidget.ID);
        if (!detailsWidget.isAttached) {
            await this.shell.addWidget(detailsWidget, { area: 'right' });
        }
        return widget;
    }
}
