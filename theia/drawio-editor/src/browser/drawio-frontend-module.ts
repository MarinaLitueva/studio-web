import { ContainerModule } from '@theia/core/shared/inversify';
import {
    FrontendApplicationContribution,
    OpenHandler,
    WidgetFactory
} from '@theia/core/lib/browser';
import { CommandContribution, MenuContribution } from '@theia/core/lib/common';
import {
    DrawioProtocolService,
    DrawioProtocolService as DrawioProtocolServiceIdentifier
} from '../common/drawio-protocol';
import { createDrawioProtocolService } from '../common/drawio-protocol-service';
import { DrawioEditorContribution } from './drawio-editor-contribution';
import { DrawioEditorOpenHandler } from './drawio-editor-open-handler';
import { DrawioEditorWidget } from './drawio-editor-widget';

export { createDrawioProtocolService } from '../common/drawio-protocol-service';

const drawioProtocolService: DrawioProtocolService = createDrawioProtocolService();

export default new ContainerModule(bind => {
    bind(DrawioProtocolServiceIdentifier).toConstantValue(drawioProtocolService);
    bind(DrawioEditorWidget).toSelf();
    bind(DrawioEditorOpenHandler).toSelf().inSingletonScope();
    bind(DrawioEditorContribution).toSelf().inSingletonScope();
    bind(WidgetFactory).toDynamicValue(ctx => ({
        id: DrawioEditorOpenHandler.ID,
        createWidget: async (options: { uri: string }) => {
            const widget = ctx.container.get<DrawioEditorWidget>(DrawioEditorWidget);
            await widget.configure(options);
            return widget;
        }
    })).inSingletonScope();
    bind(OpenHandler).toService(DrawioEditorOpenHandler);
    bind(FrontendApplicationContribution).toService(DrawioEditorContribution);
    bind(CommandContribution).toService(DrawioEditorContribution);
    bind(MenuContribution).toService(DrawioEditorContribution);
});
