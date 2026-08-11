import * as React from '@theia/core/shared/react';
import { injectable, inject, postConstruct, LazyServiceIdentifier } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { Message } from '@theia/core/lib/browser/widgets/widget';
import { SelectionService } from '@theia/core/lib/common/selection-service';
import { WorkspaceGraphFrontendController, type WorkspaceGraphSelection, GRAPH_SELECTION_TYPE, sanitizeGraphLabel } from './workspace-graph-widget';
import { GraphOpenHandler } from './graph-open-handler';

@injectable()
export class ObjectDetailsWidget extends ReactWidget {
    static readonly ID = 'studio:object-details';
    static readonly LABEL = 'Object Details';

    @inject(SelectionService)
    protected readonly selectionService: SelectionService;

    @inject(new LazyServiceIdentifier(() => WorkspaceGraphFrontendController))
    protected readonly controller: WorkspaceGraphFrontendController;

    @inject(new LazyServiceIdentifier(() => GraphOpenHandler))
    protected readonly openHandler: GraphOpenHandler;

    @postConstruct()
    protected init(): void {
        this.id = ObjectDetailsWidget.ID;
        this.title.label = ObjectDetailsWidget.LABEL;
        this.title.caption = ObjectDetailsWidget.LABEL;
        this.title.closable = true;
        this.title.iconClass = 'codicon codicon-symbol-field';
        this.toDispose.push(this.controller.onDidChange(() => this.update()));
        this.toDispose.push(this.selectionService.onSelectionChanged(() => this.update()));
        this.update();
    }

    protected override onActivateRequest(msg: Message): void {
        super.onActivateRequest(msg);
        this.node.focus();
    }

    protected render(): React.ReactNode {
        const selection = this.selectionService.selection;
        const graphSelection = isGraphSelection(selection) ? selection : undefined;
        if (!graphSelection) {
            return (
                <div className='studio-object-details' data-testid='object-details-widget'>
                    <h2>Object Details</h2>
                    <p>Select a node in the Workspace Graph to inspect its metadata.</p>
                </div>
            );
        }
        const node = graphSelection.node;
        const openable = node.kind !== 'phantom-cpt' && Boolean(node.relPath);
        return (
            <div className='studio-object-details' data-testid='object-details-widget'>
                <div className='studio-object-details__header'>
                    <h2>{sanitizeGraphLabel(node.label)}</h2>
                    <button
                        className='theia-button secondary'
                        disabled={!openable}
                        title={openable ? 'Open the source file' : 'Phantom CPT nodes do not have a source file'}
                        onClick={() => void this.openHandler.openNode(node)}
                    >
                        Open In Editor
                    </button>
                </div>
                <div className='studio-object-details__meta'>
                    <span>{node.kind}</span>
                    <span>{node.category}</span>
                    <span>{node.source ?? 'primary'}</span>
                    <span>{node.location.repositoryId}</span>
                </div>
                <div className='studio-object-details__path'>{node.location.repositoryRelativePath}</div>
                <div className='studio-object-details__meta'>
                    <span>{node.language ?? 'no language'}</span>
                    <span>{node.loc} LOC</span>
                    <span>{node.cptDefs.length} definitions</span>
                    <span>{node.cptUses.length} references</span>
                </div>
                <section>
                    <h3>Diagnostics</h3>
                    {graphSelection.diagnostics.length === 0 ? <p>None.</p> : graphSelection.diagnostics.map(diagnostic => (
                        <div className={`studio-object-details__badge studio-object-details__badge--${diagnostic.severity}`} key={diagnostic.id}>
                            {diagnostic.code}: {diagnostic.message}
                        </div>
                    ))}
                </section>
                <section>
                    <h3>Dirty Overlay</h3>
                    {graphSelection.dirtyFiles.length === 0 ? <p>Clean in dirty overlay.</p> : graphSelection.dirtyFiles.map(file => (
                        <div className='studio-object-details__detail-row' key={`${file.repositoryId}:${file.repositoryRelativePath}`}>
                            <strong>{file.state}</strong>
                            <span>{file.repositoryRelativePath}</span>
                        </div>
                    ))}
                </section>
            </div>
        );
    }
}

function isGraphSelection(selection: unknown): selection is WorkspaceGraphSelection {
    return Boolean(selection && typeof selection === 'object' && (selection as WorkspaceGraphSelection).type === GRAPH_SELECTION_TYPE);
}
