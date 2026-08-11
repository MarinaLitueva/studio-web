import { injectable } from '@theia/core/shared/inversify';
import { AbstractViewContribution } from '@theia/core/lib/browser/shell/view-contribution';
import { Command, CommandRegistry } from '@theia/core';
import { AUDIT_FILTERS, AuditWidget } from './audit-widget';

export const AuditCommand: Command = {
    id: 'studio:audit:toggle',
    label: 'Audit'
};

export const AuditFilterCommandPrefix = 'studio:audit:filter:';

@injectable()
export class AuditContribution extends AbstractViewContribution<AuditWidget> {
    constructor() {
        super({
            widgetId: AuditWidget.ID,
            widgetName: AuditWidget.LABEL,
            defaultWidgetOptions: { area: 'bottom' },
            toggleCommandId: AuditCommand.id
        });
    }

    override registerCommands(commands: CommandRegistry): void {
        super.registerCommands(commands);
        for (const filter of AUDIT_FILTERS) {
            commands.registerCommand(
                { id: `${AuditFilterCommandPrefix}${filter.id}`, label: `Audit: ${filter.label}` },
                {
                    execute: async () => {
                        const widget = await this.openView({ activate: false, reveal: true });
                        widget.setFilter(filter.id);
                        return widget;
                    }
                }
            );
        }
    }
}
