// View contribution for the Ask AI panel (right area; View menu + command).

import { injectable } from '@theia/core/shared/inversify';
import { AbstractViewContribution } from '@theia/core/lib/browser/shell/view-contribution';
import { AskAiWidget, ASK_AI_WIDGET_ID } from './ask-ai-widget';

@injectable()
export class AskAiViewContribution extends AbstractViewContribution<AskAiWidget> {
    constructor() {
        super({
            widgetId: ASK_AI_WIDGET_ID,
            widgetName: 'Ask AI',
            defaultWidgetOptions: { area: 'right', rank: 300 },
            toggleCommandId: 'studio.askAi.toggle',
        });
    }
}
