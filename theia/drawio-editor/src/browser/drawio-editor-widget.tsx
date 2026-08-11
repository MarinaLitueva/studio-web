import * as React from '@theia/core/shared/react';
import { injectable, postConstruct } from '@theia/core/shared/inversify';
import {
    Message,
    Navigatable,
    ReactWidget,
    Saveable,
    SaveableSource,
    StatefulWidget
} from '@theia/core/lib/browser';
import { DisposableCollection, Emitter } from '@theia/core';
import URI from '@theia/core/lib/common/uri';

export interface DrawioEditorWidgetOptions {
    readonly uri: string;
}

export interface DrawioEditorWidgetState {
    readonly uri?: string;
}

class DrawioEditorSaveable implements Saveable {
    readonly dirty = false;
    readonly autosaveable = false;

    protected readonly onDirtyChangedEmitter = new Emitter<void>();
    protected readonly onContentChangedEmitter = new Emitter<void>();

    get onDirtyChanged() {
        return this.onDirtyChangedEmitter.event;
    }

    get onContentChanged() {
        return this.onContentChangedEmitter.event;
    }

    async save(): Promise<void> {
        return undefined;
    }

    dispose(): void {
        this.onDirtyChangedEmitter.dispose();
        this.onContentChangedEmitter.dispose();
    }
}

@injectable()
export class DrawioEditorWidget extends ReactWidget implements Navigatable, SaveableSource, StatefulWidget {
    static readonly FACTORY_ID = 'drawio.editor';

    readonly saveable = new DrawioEditorSaveable();

    protected readonly toDisposeOnConfigure = new DisposableCollection();
    protected resourceUri: URI | undefined;

    @postConstruct()
    protected init(): void {
        this.id = `${DrawioEditorWidget.FACTORY_ID}:pending`;
        this.title.label = 'Draw.io Editor';
        this.title.caption = 'Draw.io Editor';
        this.title.closable = true;
        this.title.iconClass = 'file-icon';
        this.addClass('drawio-editor-widget');
        this.node.tabIndex = 0;
    }

    async configure(options: DrawioEditorWidgetOptions): Promise<void> {
        this.toDisposeOnConfigure.dispose();
        this.resourceUri = new URI(options.uri);
        const uriString = this.resourceUri.toString();
        const fileName = this.resourceUri.path.base;
        this.id = `${DrawioEditorWidget.FACTORY_ID}:${uriString}`;
        this.title.label = fileName;
        this.title.caption = `${fileName} (native shell)`;
        this.title.dataset = { uri: uriString };
        this.update();
    }

    getResourceUri(): URI | undefined {
        return this.resourceUri;
    }

    createMoveToUri(resourceUri: URI): URI | undefined {
        return resourceUri;
    }

    storeState(): DrawioEditorWidgetState {
        return {
            uri: this.resourceUri?.toString()
        };
    }

    restoreState(oldState: DrawioEditorWidgetState): void {
        if (oldState.uri) {
            void this.configure({ uri: oldState.uri });
        }
    }

    protected override onActivateRequest(msg: Message): void {
        super.onActivateRequest(msg);
        this.node.focus();
    }

    override dispose(): void {
        if (this.isDisposed) {
            return;
        }
        this.toDisposeOnConfigure.dispose();
        this.saveable.dispose();
        super.dispose();
    }

    protected render(): React.ReactNode {
        const fileName = this.resourceUri?.path.base ?? 'Draw.io diagram';
        return (
            <div className='drawio-editor-shell'>
                <div className='drawio-editor-placeholder'>
                    <h2>Draw.io native shell</h2>
                    <p>{fileName}</p>
                    <p>The editor runtime is unavailable in Phase 3.</p>
                    <p>This native Theia shell is registered and fail-closed until the runtime canvas is implemented.</p>
                </div>
            </div>
        );
    }
}
