import { injectable } from '@theia/core/shared/inversify';
import {
    NavigatableWidgetOpenHandler,
    NavigatableWidgetOptions,
    WidgetOpenerOptions
} from '@theia/core/lib/browser';
import URI from '@theia/core/lib/common/uri';
import { DrawioEditorWidget } from './drawio-editor-widget';

@injectable()
export class DrawioEditorOpenHandler extends NavigatableWidgetOpenHandler<DrawioEditorWidget> {
    static readonly ID = 'drawio.editor';
    static readonly LABEL = 'Draw.io Editor';

    readonly id = DrawioEditorOpenHandler.ID;

    get currentWidget(): DrawioEditorWidget | undefined {
        const current = this.shell.currentWidget;
        return current instanceof DrawioEditorWidget ? current : undefined;
    }

    canHandle(uri: URI): number {
        if (uri.scheme !== 'file') {
            return 0;
        }
        const name = uri.path.base.toLowerCase();
        return this.isDrawioResourceName(name) ? 600 : 0;
    }

    protected override createWidgetOptions(uri: URI, options?: WidgetOpenerOptions): NavigatableWidgetOptions {
        return super.createWidgetOptions(uri, options);
    }

    protected isDrawioResourceName(name: string): boolean {
        return name.endsWith('.drawio')
            || name.endsWith('.dio')
            || name.endsWith('.drawio.svg')
            || name.endsWith('.drawio.png');
    }
}
