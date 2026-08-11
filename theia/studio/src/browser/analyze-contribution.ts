import { injectable } from '@theia/core/shared/inversify';
import { AbstractViewContribution } from '@theia/core/lib/browser/shell/view-contribution';
import { Command, CommandRegistry } from '@theia/core/lib/common/command';
import { AnalyzeWidget } from './analyze-widget';

export const AnalyzeCommand: Command = {
    id: 'studio:analyze:open',
    label: 'Analyze'
};

const AnalyzeToggleCommandId = 'studio:analyze:toggle';

@injectable()
export class AnalyzeContribution extends AbstractViewContribution<AnalyzeWidget> {
    constructor() {
        super({
            widgetId: AnalyzeWidget.ID,
            widgetName: AnalyzeWidget.LABEL,
            defaultWidgetOptions: { area: 'bottom' },
            toggleCommandId: AnalyzeToggleCommandId
        });
    }

    override registerCommands(commands: CommandRegistry): void {
        super.registerCommands(commands);
        commands.registerCommand(AnalyzeCommand, {
            execute: () => this.openView({ activate: false, reveal: true })
        });
    }
}
