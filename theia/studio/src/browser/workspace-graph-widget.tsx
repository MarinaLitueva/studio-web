import * as React from '@theia/core/shared/react';
import { injectable, inject, postConstruct, LazyServiceIdentifier } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { Message } from '@theia/core/lib/browser/widgets/widget';
import { FrontendApplicationContribution, StatefulWidget } from '@theia/core/lib/browser';
import { Emitter, Event, DisposableCollection, Disposable } from '@theia/core/lib/common';
import { SelectionService } from '@theia/core/lib/common/selection-service';
import { ScmService } from '@theia/scm/lib/browser/scm-service';
import {
    Background,
    BackgroundVariant,
    ConnectionLineType,
    ControlButton,
    Controls,
    Handle,
    MiniMap,
    Position,
    ReactFlow,
    type Edge,
    type Node,
    type NodeMouseHandler,
    type NodeProps,
    type NodeTypes,
    type ReactFlowInstance,
    type Viewport
} from '@xyflow/react';
import {
    WorkspaceGraphService,
    type WorkspaceGraphClient,
    type WorkspaceGraphDiagnostic,
    type WorkspaceGraphDirtyFile,
    type WorkspaceGraphEdge,
    type WorkspaceGraphNode,
    type WorkspaceGraphRepositoryRevision,
    type WorkspaceGraphSnapshot,
    type WorkspaceGraphStatus
} from '../common/graph-model';
import type { StudioRepositoryDescriptor } from '../common/studio-protocol';
import { GitOperationsFrontendController } from './git-operations-contribution';
import { GraphOpenHandler } from './graph-open-handler';

const LARGE_GRAPH_THRESHOLD = 500;
const LARGE_GRAPH_OVERVIEW_LIMIT = 500;
const LARGE_GRAPH_EDGE_LIMIT = 2_000;
const REFRESH_DEBOUNCE_MS = 150;
const FALLBACK_LAYOUT_COLUMNS = 4;
const FALLBACK_LAYOUT_COLUMN_GAP = 280;
const FALLBACK_LAYOUT_ROW_GAP = 180;
const FALLBACK_LAYOUT_ORIGIN_X = 80;
const FALLBACK_LAYOUT_ORIGIN_Y = 80;

export const GRAPH_SELECTION_TYPE = 'studio-workspace-graph-selection';

export interface WorkspaceGraphSelection {
    readonly type: typeof GRAPH_SELECTION_TYPE;
    readonly nodeId: string;
    readonly node: WorkspaceGraphNode;
    readonly diagnostics: readonly WorkspaceGraphDiagnostic[];
    readonly dirtyFiles: readonly WorkspaceGraphDirtyFile[];
}

export interface WorkspaceGraphPersistedState {
    readonly version: 2;
    readonly repositoryId?: string;
    readonly selectedNodeId?: string;
    readonly mode: GraphMode;
    readonly search: string;
    readonly category: string;
    readonly source: string;
    readonly showDiagnosticsOnly: boolean;
    readonly neighborhoodOnly: boolean;
    readonly viewport?: Viewport;
    readonly lastSha?: string;
}

export type GraphMode = 'markdown' | 'source' | 'phantom-cpt' | 'all';

type FilteredGraph = {
    readonly nodes: readonly WorkspaceGraphNode[];
    readonly edges: readonly WorkspaceGraphEdge[];
    readonly selectedNode?: WorkspaceGraphNode;
    readonly highlightedNodeIds: ReadonlySet<string>;
    readonly limitedByOverview: boolean;
    readonly limitedByNeighborhood: boolean;
    readonly omittedEdgeCount: number;
};

interface GraphNodeData extends Record<string, unknown> {
    readonly label: string;
    readonly kind: string;
    readonly type: string;
    readonly category: string;
    readonly source: string;
    readonly loc: number;
    readonly cptCount: number;
    readonly selected: boolean;
    readonly dimmed: boolean;
    readonly dirty: boolean;
    readonly diagnosticSeverity?: 'warning' | 'error';
}

function GraphFlowNode({ data }: NodeProps): React.ReactElement {
    const graphData = data as GraphNodeData;
    const classes = [
        'studio-workspace-graph__node',
        graphData.selected ? 'studio-workspace-graph__node--selected' : '',
        graphData.dimmed ? 'studio-workspace-graph__node--dimmed' : '',
        graphData.dirty ? 'studio-workspace-graph__node--dirty' : '',
        graphData.diagnosticSeverity ? `studio-workspace-graph__node--${graphData.diagnosticSeverity}` : ''
    ].filter(Boolean).join(' ');
    return (
        <div className={classes} data-testid='graph-flow-node'>
            <div className='studio-workspace-graph__node-header'>
                <span className='studio-workspace-graph__node-kind'>{graphData.kind}</span>
                <span className='studio-workspace-graph__node-type'>{graphData.category}</span>
            </div>
            <div className='studio-workspace-graph__node-label'>{graphData.label}</div>
            <div className='studio-workspace-graph__node-meta'>
                <span>{graphData.source}</span>
                <span>{graphData.loc} LOC</span>
                <span>{graphData.cptCount} CPT</span>
            </div>
            <div className='studio-workspace-graph__node-flags'>
                {graphData.dirty ? <span className='studio-workspace-graph__node-pill'>Dirty</span> : undefined}
                {graphData.diagnosticSeverity ? <span className='studio-workspace-graph__node-pill'>{graphData.diagnosticSeverity}</span> : undefined}
            </div>
            <Handle type='target' position={Position.Left} style={{ opacity: 0 }} />
            <Handle type='source' position={Position.Right} style={{ opacity: 0 }} />
        </div>
    );
}

interface GraphBandData extends Record<string, unknown> {
    readonly label: string;
    readonly fill?: string;
    readonly stroke?: string;
    readonly titleColor?: string;
}

interface GraphBucketData extends Record<string, unknown> {
    readonly label: string;
}

function GraphCategoryBucket({ data }: NodeProps): React.ReactElement {
    const bucket = data as GraphBucketData;
    return (
        <div
            className='studio-workspace-graph__category-bucket'
            role='group'
            aria-label={`Category bucket ${bucket.label}`}
            data-testid='graph-category-bucket'
        >
            <span>{bucket.label}</span>
        </div>
    );
}

function GraphCategoryBand({ data }: NodeProps): React.ReactElement {
    const band = data as GraphBandData;
    return (
        <div
            className='studio-workspace-graph__category-band'
            style={{
                background: band.fill,
                borderColor: band.stroke,
                color: band.titleColor
            }}
            data-testid='graph-category-band'
        >
            {band.label}
        </div>
    );
}

const graphNodeTypes: NodeTypes = {
    default: GraphFlowNode,
    categoryBucket: GraphCategoryBucket,
    categoryBand: GraphCategoryBand
};

export function sanitizeGraphLabel(label: string): string {
    return label.replace(/[\u0000-\u001f\u007f]/g, '').trim() || 'Untitled';
}

export function getRevisionVectorFingerprint(revisions: readonly WorkspaceGraphRepositoryRevision[]): string {
    return revisions
        .map(revision => `${revision.repositoryId}:${revision.commitSha.toLowerCase()}`)
        .sort()
        .join('|');
}

export function filterGraphSnapshot(
    snapshot: WorkspaceGraphSnapshot | undefined,
    state: WorkspaceGraphPersistedState
): FilteredGraph {
    if (!snapshot) {
        return {
            nodes: [],
            edges: [],
            highlightedNodeIds: new Set<string>(),
            limitedByOverview: false,
            limitedByNeighborhood: false,
            omittedEdgeCount: 0
        };
    }
    const selectedNode = snapshot.nodes.find(node => node.id === state.selectedNodeId);
    const searchNeedle = state.search.trim().toLowerCase();
    let nodes = snapshot.nodes.filter(node => {
        if (state.mode !== 'all' && node.kind !== state.mode) {
            return false;
        }
        if (state.category && node.category !== state.category) {
            return false;
        }
        if (state.source && node.source !== state.source) {
            return false;
        }
        if (!searchNeedle) {
            return true;
        }
        return sanitizeGraphLabel(node.label).toLowerCase().includes(searchNeedle)
            || node.location.repositoryRelativePath.toLowerCase().includes(searchNeedle)
            || node.kind.toLowerCase().includes(searchNeedle)
            || node.category.toLowerCase().includes(searchNeedle)
            || (node.source ?? '').toLowerCase().includes(searchNeedle)
            || node.cptDefs.some(cptId => cptId.toLowerCase().includes(searchNeedle));
    });
    const visibleIds = new Set(nodes.map(node => node.id));
    let edges = snapshot.edges.filter(edge => visibleIds.has(edge.from) && visibleIds.has(edge.to));
    const shouldLimitToNeighborhood = state.neighborhoodOnly && snapshot.nodes.length > LARGE_GRAPH_THRESHOLD && selectedNode;
    const highlightedNodeIds = new Set<string>();
    let limitedByOverview = false;
    let limitedByNeighborhood = false;
    if (shouldLimitToNeighborhood && selectedNode) {
        const neighborIds = new Set<string>();
        for (const edge of snapshot.edges) {
            if (edge.from === selectedNode.id) {
                neighborIds.add(edge.to);
            }
            if (edge.to === selectedNode.id) {
                neighborIds.add(edge.from);
            }
        }
        const neighborhood = nodes
            .filter(node => node.id === selectedNode.id || neighborIds.has(node.id))
            .sort((left, right) => {
                if (left.id === selectedNode.id) {
                    return -1;
                }
                if (right.id === selectedNode.id) {
                    return 1;
                }
                return left.id.localeCompare(right.id);
            });
        limitedByNeighborhood = neighborhood.length > LARGE_GRAPH_OVERVIEW_LIMIT;
        nodes = neighborhood.slice(0, LARGE_GRAPH_OVERVIEW_LIMIT);
        visibleIds.clear();
        for (const node of nodes) {
            visibleIds.add(node.id);
            highlightedNodeIds.add(node.id);
        }
        edges = snapshot.edges.filter(edge => visibleIds.has(edge.from) && visibleIds.has(edge.to));
    } else if (selectedNode) {
        highlightedNodeIds.add(selectedNode.id);
        for (const edge of edges) {
            if (edge.from === selectedNode.id) {
                highlightedNodeIds.add(edge.to);
            }
            if (edge.to === selectedNode.id) {
                highlightedNodeIds.add(edge.from);
            }
        }
    } else if (state.neighborhoodOnly && nodes.length > LARGE_GRAPH_OVERVIEW_LIMIT) {
        // Keep the initial canvas interactive even for very large repositories.
        // Search and category/source filters run before this cap, so every node
        // remains reachable without materializing the complete graph at once.
        nodes = nodes.slice(0, LARGE_GRAPH_OVERVIEW_LIMIT);
        visibleIds.clear();
        for (const node of nodes) {
            visibleIds.add(node.id);
        }
        edges = edges.filter(edge => visibleIds.has(edge.from) && visibleIds.has(edge.to));
        limitedByOverview = true;
    }
    let omittedEdgeCount = 0;
    if (edges.length > LARGE_GRAPH_EDGE_LIMIT) {
        const sortedEdges = [...edges].sort((left, right) => {
            const leftIncident = selectedNode
                && (left.from === selectedNode.id || left.to === selectedNode.id) ? 0 : 1;
            const rightIncident = selectedNode
                && (right.from === selectedNode.id || right.to === selectedNode.id) ? 0 : 1;
            return leftIncident - rightIncident || left.id.localeCompare(right.id);
        });
        omittedEdgeCount = sortedEdges.length - LARGE_GRAPH_EDGE_LIMIT;
        edges = sortedEdges.slice(0, LARGE_GRAPH_EDGE_LIMIT);
    }
    return {
        nodes,
        edges,
        selectedNode,
        highlightedNodeIds,
        limitedByOverview,
        limitedByNeighborhood,
        omittedEdgeCount
    };
}

export function layoutGraph(
    nodes: readonly WorkspaceGraphNode[],
    edges: readonly WorkspaceGraphEdge[],
    selectedNodeId: string | undefined,
    diagnostics: readonly WorkspaceGraphDiagnostic[],
    dirtyFiles: readonly WorkspaceGraphDirtyFile[],
    highlightedNodeIds: ReadonlySet<string>
): { nodes: Node<GraphNodeData>[]; edges: Edge[] } {
    const diagnosticByNodeId = new Map<string, 'warning' | 'error'>();
    for (const diagnostic of diagnostics) {
        if (!diagnostic.relatedNodeId) {
            continue;
        }
        const existing = diagnosticByNodeId.get(diagnostic.relatedNodeId);
        if (existing !== 'error') {
            diagnosticByNodeId.set(diagnostic.relatedNodeId, diagnostic.severity);
        }
    }
    const dirtyKeySet = new Set(dirtyFiles.map(file => `${file.repositoryId}:${file.repositoryRelativePath}`));
    const fallbackPositionByNodeId = new Map(
        nodes
            .filter(node => node.position === undefined)
            .map(node => node.id)
            .sort()
            .map((nodeId, index) => [
                nodeId,
                {
                    x: FALLBACK_LAYOUT_ORIGIN_X + (index % FALLBACK_LAYOUT_COLUMNS) * FALLBACK_LAYOUT_COLUMN_GAP,
                    y: FALLBACK_LAYOUT_ORIGIN_Y + Math.floor(index / FALLBACK_LAYOUT_COLUMNS) * FALLBACK_LAYOUT_ROW_GAP
                }
            ])
    );
    return {
        nodes: nodes.map(node => {
            return {
                id: node.id,
                type: 'default',
                position: node.position ?? fallbackPositionByNodeId.get(node.id) ?? { x: 0, y: 0 },
                data: {
                    label: sanitizeGraphLabel(node.label),
                    kind: node.kind,
                    type: node.kind,
                    category: node.category,
                    source: node.source ?? 'primary',
                    loc: node.loc,
                    cptCount: node.cptDefs.length + node.cptUses.length,
                    selected: node.id === selectedNodeId,
                    dimmed: highlightedNodeIds.size > 0 && !highlightedNodeIds.has(node.id),
                    dirty: dirtyKeySet.has(`${node.location.repositoryId}:${node.location.repositoryRelativePath}`),
                    diagnosticSeverity: diagnosticByNodeId.get(node.id)
                },
                draggable: false,
                selectable: true
            };
        }),
        edges: edges.map(edge => ({
            id: edge.id,
            source: edge.from,
            target: edge.to,
            label: edge.refs[0]?.cptId ?? edge.type,
            animated: false,
            type: 'smoothstep',
            selectable: false,
            markerEnd: { type: 'arrowclosed' as const },
            style: {
                opacity: selectedNodeId
                    ? (edge.from === selectedNodeId || edge.to === selectedNodeId ? 1 : 0.1)
                    : 0.7,
                strokeWidth: selectedNodeId && (edge.from === selectedNodeId || edge.to === selectedNodeId) ? 2 : 1
            },
            className: [
                'studio-workspace-graph__edge',
                `studio-workspace-graph__edge--${edge.type}`,
                selectedNodeId && (edge.from === selectedNodeId || edge.to === selectedNodeId)
                    ? 'studio-workspace-graph__edge--connected'
                    : ''
            ].filter(Boolean).join(' ')
        }))
    };
}

@injectable()
export class WorkspaceGraphFrontendController implements FrontendApplicationContribution, WorkspaceGraphClient {
    @inject(GitOperationsFrontendController)
    protected readonly gitOperationsController: GitOperationsFrontendController;

    @inject(ScmService)
    protected readonly scmService: ScmService;

    @inject(SelectionService)
    protected readonly selectionService: SelectionService;

    protected readonly onDidChangeEmitter = new Emitter<void>();
    protected readonly toDispose = new DisposableCollection(this.onDidChangeEmitter);
    protected graphService: WorkspaceGraphService | undefined;
    protected activeRepository: StudioRepositoryDescriptor | undefined;
    protected snapshot: WorkspaceGraphSnapshot | undefined;
    protected status: WorkspaceGraphStatus | undefined;
    protected dirtyFiles: readonly WorkspaceGraphDirtyFile[] = [];
    protected selectedNodeId: string | undefined;
    protected errorMessage: string | undefined;
    protected openErrorMessage: string | undefined;
    protected diagnosticsOnly = false;
    protected search = '';
    protected mode: GraphMode = 'all';
    protected category = '';
    protected source = '';
    protected neighborhoodOnly = true;
    protected viewport: Viewport | undefined;
    protected lastSha: string | undefined;
    protected initialized = false;
    protected loading = false;
    protected refreshTimer: ReturnType<typeof setTimeout> | undefined;
    protected refreshGeneration = 0;
    protected pendingRestoredState: Partial<WorkspaceGraphPersistedState> | undefined;
    protected readonly activeServiceInstanceByRepository = new Map<string, string>();
    protected readonly maxStatusSequenceByServiceScope = new Map<string, number>();

    bindGraphService(graphService: WorkspaceGraphService): void {
        this.graphService = graphService;
    }

    get onDidChange(): Event<void> {
        return this.onDidChangeEmitter.event;
    }

    onStart(): void {
        this.toDispose.push(this.gitOperationsController.onDidChange(() => this.scheduleRefresh('git-operations-changed')));
        this.toDispose.push(this.scmService.onDidAddRepository(() => this.scheduleRefresh('scm-added')));
        this.toDispose.push(this.scmService.onDidRemoveRepository(() => this.scheduleRefresh('scm-removed')));
        this.toDispose.push(Disposable.create(() => {
            if (this.refreshTimer) {
                clearTimeout(this.refreshTimer);
                this.refreshTimer = undefined;
            }
        }));
        void this.refreshGraph('startup');
    }

    onStop(): void {
        this.toDispose.dispose();
    }

    onWorkspaceGraphStatusChanged(status: WorkspaceGraphStatus): void {
        // Pushes are only meaningful after an authoritative RPC established the
        // backend instance for this repository. Notifications from a superseded
        // backend connection are ignored even when their old sequence is high.
        if (this.activeServiceInstanceByRepository.get(status.repositoryId) !== status.serviceInstanceId) {
            return;
        }
        const scopeKey = serviceStatusScopeKey(status);
        const maxSequence = this.maxStatusSequenceByServiceScope.get(scopeKey) ?? -1;
        if (status.sequence <= maxSequence) {
            return;
        }
        this.maxStatusSequenceByServiceScope.set(scopeKey, status.sequence);
        if (status.repositoryId !== this.activeRepository?.repositoryId) {
            return;
        }
        this.status = status;
        this.onDidChangeEmitter.fire();
    }

    getState(): WorkspaceGraphPersistedState {
        return {
            version: 2,
            repositoryId: this.activeRepository?.repositoryId,
            selectedNodeId: this.selectedNodeId,
            mode: this.mode,
            search: this.search,
            category: this.category,
            source: this.source,
            showDiagnosticsOnly: this.diagnosticsOnly,
            neighborhoodOnly: this.neighborhoodOnly,
            viewport: this.viewport,
            lastSha: this.lastSha
        };
    }

    restoreState(state: Partial<WorkspaceGraphPersistedState> | undefined): void {
        if (state?.version !== 2 || typeof state.repositoryId !== 'string') {
            return;
        }
        if (!this.activeRepository) {
            this.pendingRestoredState = state;
            return;
        }
        if (state.repositoryId !== this.activeRepository.repositoryId) {
            return;
        }
        this.applyRestoredState(state);
    }

    protected applyRestoredState(state: Partial<WorkspaceGraphPersistedState>): void {
        this.selectedNodeId = typeof state.selectedNodeId === 'string' ? state.selectedNodeId : undefined;
        this.mode = state.mode === 'markdown' || state.mode === 'source' || state.mode === 'phantom-cpt' || state.mode === 'all'
            ? state.mode
            : 'all';
        this.search = typeof state.search === 'string' ? state.search : '';
        this.category = typeof state.category === 'string' ? state.category : '';
        this.source = typeof state.source === 'string' ? state.source : '';
        // A persisted diagnostics-only view can otherwise reopen as a blank
        // canvas after diagnostics are fixed by a later backend refresh.
        this.diagnosticsOnly = false;
        this.neighborhoodOnly = typeof state.neighborhoodOnly === 'boolean' ? state.neighborhoodOnly : true;
        this.viewport = isViewportLike(state.viewport) ? state.viewport : undefined;
        this.lastSha = typeof state.lastSha === 'string' ? state.lastSha : undefined;
        this.publishSelection();
        this.onDidChangeEmitter.fire();
    }

    setMode(mode: GraphMode): void {
        this.mode = mode;
        this.onDidChangeEmitter.fire();
    }

    setSearch(search: string): void {
        this.search = search;
        this.onDidChangeEmitter.fire();
    }

    setCategory(category: string): void {
        this.category = category;
        this.onDidChangeEmitter.fire();
    }

    setSource(source: string): void {
        this.source = source;
        this.onDidChangeEmitter.fire();
    }

    resetFilters(): void {
        this.mode = 'all';
        this.search = '';
        this.category = '';
        this.source = '';
        this.diagnosticsOnly = false;
        this.neighborhoodOnly = true;
        this.onDidChangeEmitter.fire();
    }

    setDiagnosticsOnly(showDiagnosticsOnly: boolean): void {
        this.diagnosticsOnly = showDiagnosticsOnly;
        this.onDidChangeEmitter.fire();
    }

    setNeighborhoodOnly(enabled: boolean): void {
        this.neighborhoodOnly = enabled;
        this.onDidChangeEmitter.fire();
    }

    setViewport(viewport: Viewport): void {
        this.viewport = viewport;
    }

    selectNode(nodeId: string | undefined): void {
        this.selectedNodeId = nodeId;
        this.publishSelection();
        this.onDidChangeEmitter.fire();
    }

    async refreshGraph(_reason: string): Promise<void> {
        const refreshGeneration = ++this.refreshGeneration;
        const selectedRepository = this.gitOperationsController.getSelectedRepository();
        if (!selectedRepository) {
            this.activeRepository = undefined;
            this.clearRepositoryState();
            this.errorMessage = 'Select a repository in Source Control to load its graph. The all-workspace graph is unavailable because it is too large.';
            this.initialized = true;
            this.onDidChangeEmitter.fire();
            return;
        }
        if (selectedRepository.repositoryId !== this.activeRepository?.repositoryId) {
            this.activeRepository = selectedRepository;
            this.clearRepositoryState();
            const pendingState = this.pendingRestoredState;
            this.pendingRestoredState = undefined;
            if (pendingState?.repositoryId === selectedRepository.repositoryId) {
                this.applyRestoredState(pendingState);
            }
        } else {
            this.activeRepository = selectedRepository;
        }
        const scope = { repositoryId: selectedRepository.repositoryId };
        this.loading = true;
        this.errorMessage = undefined;
        this.onDidChangeEmitter.fire();
        try {
            if (!this.graphService) {
                this.errorMessage = 'Workspace graph connection is unavailable.';
                this.snapshot = undefined;
                return;
            }
            const [dirtyOverlay, status] = await Promise.all([
                this.graphService.getDirtyOverlay(scope),
                this.graphService.getStatus(scope)
            ]);
            if (!this.isCurrentScope(refreshGeneration, selectedRepository.repositoryId)) {
                return;
            }
            if (status.repositoryId !== selectedRepository.repositoryId) {
                throw new Error(`Workspace graph returned status for unexpected repository ${status.repositoryId}.`);
            }
            this.dirtyFiles = dirtyOverlay.files;
            this.acceptRpcStatus(status);
            const revisions = await this.graphService.getRepositoryRevisions(scope);
            const revisionVector = getRevisionVectorFingerprint(revisions);
            const newestSha = revisions.map(revision => revision.commitSha.toLowerCase()).sort().join(',');
            const knownRevision = this.snapshot && this.lastSha === revisionVector ? this.snapshot.revision : undefined;
            const response = await this.graphService.getSnapshot({
                repositoryId: selectedRepository.repositoryId,
                knownRevision
            });
            if (!this.isCurrentScope(refreshGeneration, selectedRepository.repositoryId)) {
                return;
            }
            if (response.status.repositoryId !== selectedRepository.repositoryId) {
                throw new Error(`Workspace graph returned a snapshot for unexpected repository ${response.status.repositoryId}.`);
            }
            this.acceptRpcStatus(response.status);
            if (response.snapshot) {
                this.snapshot = response.snapshot;
            } else if (!response.notModified) {
                this.snapshot = undefined;
            }
            this.lastSha = revisionVector || newestSha;
            if (this.status?.state === 'failed') {
                this.errorMessage = this.status.errorMessage ?? 'Workspace graph indexing failed.';
            }
            this.initialized = true;
            this.publishSelection();
        } catch (error) {
            if (this.isCurrentScope(refreshGeneration, selectedRepository.repositoryId)) {
                this.errorMessage = error instanceof Error ? error.message : String(error);
            }
        } finally {
            if (this.isCurrentScope(refreshGeneration, selectedRepository.repositoryId)) {
                this.loading = false;
                this.onDidChangeEmitter.fire();
            }
        }
    }

    protected isCurrentScope(refreshGeneration: number, repositoryId: string): boolean {
        return refreshGeneration === this.refreshGeneration
            && this.activeRepository?.repositoryId === repositoryId;
    }

    protected acceptRpcStatus(status: WorkspaceGraphStatus): void {
        const currentServiceInstance = this.activeServiceInstanceByRepository.get(status.repositoryId);
        const scopeKey = serviceStatusScopeKey(status);
        const maxSequence = this.maxStatusSequenceByServiceScope.get(scopeKey) ?? -1;
        if (currentServiceInstance === status.serviceInstanceId && status.sequence < maxSequence) {
            return;
        }
        this.activeServiceInstanceByRepository.set(status.repositoryId, status.serviceInstanceId);
        this.maxStatusSequenceByServiceScope.set(scopeKey, Math.max(maxSequence, status.sequence));
        this.status = status;
    }

    protected clearRepositoryState(): void {
        this.snapshot = undefined;
        this.status = undefined;
        this.dirtyFiles = [];
        this.selectedNodeId = undefined;
        this.mode = 'all';
        this.search = '';
        this.category = '';
        this.source = '';
        this.diagnosticsOnly = false;
        this.neighborhoodOnly = true;
        this.viewport = undefined;
        this.lastSha = undefined;
        this.errorMessage = undefined;
        this.openErrorMessage = undefined;
        this.loading = false;
        this.publishSelection();
    }

    protected scheduleRefresh(reason: string): void {
        if (this.refreshTimer) {
            clearTimeout(this.refreshTimer);
        }
        this.refreshTimer = setTimeout(() => {
            this.refreshTimer = undefined;
            void this.refreshGraph(reason);
        }, REFRESH_DEBOUNCE_MS);
    }

    getSnapshot(): WorkspaceGraphSnapshot | undefined {
        return this.snapshot;
    }

    getActiveRepository(): StudioRepositoryDescriptor | undefined {
        return this.activeRepository;
    }

    getStatus(): WorkspaceGraphStatus | undefined {
        return this.status;
    }

    getDirtyFiles(): readonly WorkspaceGraphDirtyFile[] {
        return this.dirtyFiles;
    }

    getErrorMessage(): string | undefined {
        return this.errorMessage;
    }

    getOpenErrorMessage(): string | undefined {
        return this.openErrorMessage;
    }

    reportOpenError(error: unknown): void {
        const message = error instanceof Error ? error.message : String(error);
        this.openErrorMessage = `Unable to open graph file: ${message}`;
        this.onDidChangeEmitter.fire();
    }

    clearOpenError(): void {
        if (this.openErrorMessage) {
            this.openErrorMessage = undefined;
            this.onDidChangeEmitter.fire();
        }
    }

    isLoading(): boolean {
        return this.loading;
    }

    isInitialized(): boolean {
        return this.initialized;
    }

    getSelectedNode(): WorkspaceGraphNode | undefined {
        return this.snapshot?.nodes.find(node => node.id === this.selectedNodeId);
    }

    getSelectedNodeDiagnostics(): readonly WorkspaceGraphDiagnostic[] {
        if (!this.selectedNodeId || !this.snapshot) {
            return [];
        }
        return this.snapshot.diagnostics.filter(diagnostic => diagnostic.relatedNodeId === this.selectedNodeId);
    }

    getVisibleDiagnostics(): readonly WorkspaceGraphDiagnostic[] {
        return this.snapshot?.diagnostics ?? [];
    }

    getViewModel(): FilteredGraph {
        const filtered = filterGraphSnapshot(this.snapshot, this.getState());
        if (!this.diagnosticsOnly) {
            return filtered;
        }
        const diagnosticNodeIds = new Set((this.snapshot?.diagnostics ?? []).flatMap(diagnostic => diagnostic.relatedNodeId ? [diagnostic.relatedNodeId] : []));
        const nodes = filtered.nodes.filter(node => diagnosticNodeIds.has(node.id));
        const visibleIds = new Set(nodes.map(node => node.id));
        const edges = filtered.edges.filter(edge => visibleIds.has(edge.from) && visibleIds.has(edge.to));
        return { ...filtered, nodes, edges };
    }

    protected publishSelection(): void {
        const node = this.getSelectedNode();
        if (!node) {
            this.selectionService.selection = undefined;
            return;
        }
        this.selectionService.selection = {
            type: GRAPH_SELECTION_TYPE,
            nodeId: node.id,
            node,
            diagnostics: this.getSelectedNodeDiagnostics(),
            dirtyFiles: this.dirtyFiles.filter(file =>
                file.repositoryId === node.location.repositoryId
                && file.repositoryRelativePath === node.location.repositoryRelativePath
            )
        } satisfies WorkspaceGraphSelection;
    }
}

function isViewportLike(viewport: unknown): viewport is Viewport {
    return Boolean(
        viewport
        && typeof viewport === 'object'
        && typeof (viewport as Viewport).x === 'number'
        && typeof (viewport as Viewport).y === 'number'
        && typeof (viewport as Viewport).zoom === 'number'
    );
}

function serviceStatusScopeKey(status: WorkspaceGraphStatus): string {
    return `${status.repositoryId}\0${status.serviceInstanceId}`;
}

@injectable()
export class WorkspaceGraphWidget extends ReactWidget implements StatefulWidget {
    static readonly ID = 'studio:workspace-graph';
    static readonly LABEL = 'Workspace Graph';

    @inject(new LazyServiceIdentifier(() => WorkspaceGraphFrontendController))
    protected readonly controller: WorkspaceGraphFrontendController;

    @inject(new LazyServiceIdentifier(() => GraphOpenHandler))
    protected readonly openHandler: GraphOpenHandler;

    protected flowInstance: ReactFlowInstance | undefined;

    @postConstruct()
    protected init(): void {
        this.id = WorkspaceGraphWidget.ID;
        this.title.label = WorkspaceGraphWidget.LABEL;
        this.title.caption = WorkspaceGraphWidget.LABEL;
        this.title.closable = true;
        this.title.iconClass = 'codicon codicon-graph';
        this.toDispose.push(this.controller.onDidChange(() => this.update()));
        this.node.tabIndex = 0;
        this.update();
    }

    storeState(): WorkspaceGraphPersistedState {
        return this.controller.getState();
    }

    restoreState(oldState: WorkspaceGraphPersistedState): void {
        this.controller.restoreState(oldState);
    }

    protected override onActivateRequest(msg: Message): void {
        super.onActivateRequest(msg);
        this.node.focus();
    }

    protected render(): React.ReactNode {
        const viewModel = this.controller.getViewModel();
        const dirtyFiles = this.controller.getDirtyFiles();
        const diagnostics = this.controller.getVisibleDiagnostics();
        const layout = layoutGraph(
            viewModel.nodes,
            viewModel.edges,
            this.controller.getState().selectedNodeId,
            diagnostics,
            dirtyFiles,
            viewModel.highlightedNodeIds
        );
        const selectedNode = this.controller.getSelectedNode();
        const status = this.controller.getStatus();
        const snapshot = this.controller.getSnapshot();
        const isLargeGraph = Boolean(snapshot && snapshot.nodes.length > LARGE_GRAPH_THRESHOLD);
        const hasSnapshot = Boolean(snapshot);
        const hasUsableStaleSnapshot = Boolean(
            snapshot
            && status?.state === 'failed'
            && status.stale
            && snapshot.stale
        );
        const staleStatusDiagnostic: WorkspaceGraphDiagnostic | undefined = hasUsableStaleSnapshot ? {
            id: 'workspace-graph-stale-status',
            code: 'map-failed',
            severity: 'warning',
            message: status?.errorMessage
                ? `Showing the last successful graph snapshot because refresh failed: ${status.errorMessage}`
                : 'Showing the last successful graph snapshot because the latest refresh failed.'
        } : undefined;
        const visibleDiagnostics = staleStatusDiagnostic ? [...diagnostics, staleStatusDiagnostic] : diagnostics;
        const globalDiagnostics = visibleDiagnostics.filter(diagnostic => !diagnostic.relatedNodeId);
        const nodeLinkedDiagnostics = diagnostics.filter(diagnostic => diagnostic.relatedNodeId);
        const diagnosticsOnlyWithoutVisibleNodes = this.controller.getState().showDiagnosticsOnly && viewModel.nodes.length === 0;
        const categories = Object.keys(snapshot?.categories ?? {}).sort();
        const sources = (snapshot?.sources ?? []).map(source => source.name).sort();
        const bandNodes: Node<GraphBandData>[] = (isLargeGraph ? [] : Object.entries(snapshot?.categoryBands ?? {})).map(([id, band]) => ({
            id: `category-band:${id}`,
            type: 'categoryBand',
            position: { x: band.x, y: band.y },
            data: {
                label: band.label,
                fill: band.fill,
                stroke: band.stroke,
                titleColor: band.titleColor
            },
            width: band.w,
            height: band.h,
            style: { width: band.w, height: band.h },
            selectable: false,
            draggable: false,
            connectable: false,
            focusable: false,
            zIndex: -1
        }));
        const bucketNodes: Node<GraphBucketData>[] = (isLargeGraph ? [] : Object.entries(snapshot?.bucketRects ?? {})).map(([id, bucket]) => ({
            id: `category-bucket:${id}`,
            type: 'categoryBucket',
            position: { x: bucket.x, y: bucket.y },
            data: { label: sanitizeGraphLabel(bucket.label) },
            width: bucket.w,
            height: bucket.h,
            style: { width: bucket.w, height: bucket.h },
            selectable: false,
            draggable: false,
            connectable: false,
            focusable: false,
            zIndex: -2
        }));
        const blockingErrorMessage = this.controller.getErrorMessage() && !hasUsableStaleSnapshot
            ? this.controller.getErrorMessage()
            : undefined;
        const onNodeClick: NodeMouseHandler = (_event, node) => {
            if (snapshot?.nodes.some(item => item.id === node.id)) {
                this.controller.selectNode(this.controller.getState().selectedNodeId === node.id ? undefined : node.id);
            }
        };
        const onNodeDoubleClick: NodeMouseHandler = async (_event, node) => {
            const graphNode = this.controller.getSnapshot()?.nodes.find(item => item.id === node.id);
            if (graphNode && graphNode.kind !== 'phantom-cpt' && graphNode.relPath) {
                await this.openNodeSafely(graphNode);
            }
        };
        return (
            <div className='studio-workspace-graph' data-testid='workspace-graph-widget'>
                <div className='studio-workspace-graph__toolbar'>
                    <div className='studio-workspace-graph__modes' role='tablist' aria-label='Graph mode'>
                        {(['all', 'markdown', 'source', 'phantom-cpt'] as GraphMode[]).map(mode => (
                            <button
                                key={mode}
                                type='button'
                                role='tab'
                                aria-selected={this.controller.getState().mode === mode}
                                className={`theia-button secondary ${this.controller.getState().mode === mode ? 'studio-workspace-graph__toggle--active' : ''}`}
                                onClick={() => this.controller.setMode(mode)}
                            >
                                {mode === 'all' ? 'All types' : mode}
                            </button>
                        ))}
                    </div>
                    <input
                        className='theia-input'
                        placeholder='Search nodes or paths'
                        value={this.controller.getState().search}
                        onChange={event => this.controller.setSearch(event.target.value)}
                        aria-label='Search graph'
                    />
                    <select
                        className='theia-select'
                        value={this.controller.getState().category}
                        onChange={event => this.controller.setCategory(event.target.value)}
                        aria-label='Filter graph by category'
                    >
                        <option value=''>All categories</option>
                        {categories.map(category => <option key={category} value={category}>{category}</option>)}
                    </select>
                    <select
                        className='theia-select'
                        value={this.controller.getState().source}
                        onChange={event => this.controller.setSource(event.target.value)}
                        aria-label='Filter graph by source'
                    >
                        <option value=''>All sources</option>
                        {sources.map(source => <option key={source} value={source}>{source}</option>)}
                    </select>
                    <label className='studio-workspace-graph__checkbox'>
                        <input
                            type='checkbox'
                            checked={this.controller.getState().showDiagnosticsOnly}
                            onChange={event => this.controller.setDiagnosticsOnly(event.target.checked)}
                        />
                        Diagnostics
                    </label>
                    <label className='studio-workspace-graph__checkbox'>
                        <input
                            type='checkbox'
                            checked={this.controller.getState().neighborhoodOnly}
                            onChange={event => this.controller.setNeighborhoodOnly(event.target.checked)}
                        />
                        Neighborhood
                    </label>
                    <button
                        type='button'
                        className='theia-button secondary'
                        onClick={() => this.controller.resetFilters()}
                        data-testid='workspace-graph-reset-filters'
                    >
                        Reset filters
                    </button>
                </div>
                <div className='studio-workspace-graph__status' data-testid='workspace-graph-status'>
                    <span>{this.controller.getActiveRepository()?.label ?? 'no repository selected'}</span>
                    <span>{status?.state ?? 'idle'}</span>
                    <span>{hasSnapshot ? `${viewModel.nodes.length} visible nodes` : 'no snapshot'}</span>
                    <span>{visibleDiagnostics.length} diagnostics</span>
                    <span>{dirtyFiles.length} dirty files</span>
                    {snapshot?.stale || status?.stale ? <span className='studio-status-badge studio-status-badge--pending'>Stale</span> : undefined}
                    <span>{selectedNode ? sanitizeGraphLabel(selectedNode.label) : 'no selection'}</span>
                </div>
                {viewModel.limitedByOverview ? (
                    <div className='studio-workspace-graph__global-diagnostics' data-testid='workspace-graph-large-overview'>
                        <strong>Large graph overview</strong>
                        <p>
                            Showing the first {LARGE_GRAPH_OVERVIEW_LIMIT} matching nodes. Use search or filters to reach other nodes;
                            selecting a node switches to its neighborhood.
                        </p>
                    </div>
                ) : undefined}
                {viewModel.limitedByNeighborhood ? (
                    <div className='studio-workspace-graph__global-diagnostics' data-testid='workspace-graph-large-neighborhood'>
                        <strong>High-degree neighborhood</strong>
                        <p>
                            Showing the first {LARGE_GRAPH_OVERVIEW_LIMIT} matching nodes from the selected node&apos;s neighborhood,
                            ordered with the selection first and then by graph node ID. Use search or category/source filters to reach omitted neighbors.
                        </p>
                    </div>
                ) : undefined}
                {viewModel.omittedEdgeCount > 0 ? (
                    <div className='studio-workspace-graph__global-diagnostics' data-testid='workspace-graph-edge-limit'>
                        <strong>Edge rendering limited</strong>
                        <p>
                            Showing {viewModel.edges.length} visible edges and omitting {viewModel.omittedEdgeCount}.
                            {selectedNode
                                ? ' Edges connected to the selected node are prioritized, followed by graph edge ID.'
                                : ' Edges are selected deterministically by graph edge ID.'}
                        </p>
                    </div>
                ) : undefined}
                {this.controller.getOpenErrorMessage() ? (
                    <div className='studio-workspace-graph__global-diagnostics' role='alert' data-testid='workspace-graph-open-error'>
                        {this.controller.getOpenErrorMessage()}
                    </div>
                ) : undefined}
                {globalDiagnostics.length > 0 ? (
                    <section
                        className='studio-workspace-graph__global-diagnostics'
                        aria-labelledby='workspace-graph-global-diagnostics-title'
                        aria-live='polite'
                        data-testid='workspace-graph-global-diagnostics'
                    >
                        <div className='studio-workspace-graph__global-diagnostics-header'>
                            <div>
                                <strong id='workspace-graph-global-diagnostics-title'>Graph-level diagnostics</strong>
                                <p>These issues apply to the graph or workspace and are not linked to a specific node.</p>
                            </div>
                            <span className='studio-status-badge studio-status-badge--pending'>
                                {globalDiagnostics.length}
                            </span>
                        </div>
                        <ul className='studio-workspace-graph__global-diagnostics-list'>
                            {globalDiagnostics.map(diagnostic => (
                                <li
                                    className={`studio-workspace-graph__global-diagnostic studio-workspace-graph__global-diagnostic--${diagnostic.severity}`}
                                    key={diagnostic.id}
                                >
                                    <div className='studio-workspace-graph__global-diagnostic-heading'>
                                        <strong>{diagnostic.code}</strong>
                                        <span>{diagnostic.severity}</span>
                                    </div>
                                    <div>{diagnostic.message}</div>
                                    {diagnostic.location ? (
                                        <div className='studio-workspace-graph__global-diagnostic-location'>
                                            {diagnostic.location.repositoryId}:{diagnostic.location.repositoryRelativePath}
                                        </div>
                                    ) : undefined}
                                </li>
                            ))}
                        </ul>
                        {diagnosticsOnlyWithoutVisibleNodes && snapshot?.nodes.length ? (
                            <button
                                type='button'
                                className='theia-button secondary'
                                onClick={() => this.controller.resetFilters()}
                                data-testid='workspace-graph-global-diagnostics-show-all'
                            >
                                Show all graph nodes
                            </button>
                        ) : undefined}
                    </section>
                ) : undefined}
                {blockingErrorMessage ? (
                    <div className='studio-workspace-graph__overlay' data-testid='workspace-graph-error'>
                        <strong>Graph unavailable</strong>
                        <p>{blockingErrorMessage}</p>
                    </div>
                ) : undefined}
                {!blockingErrorMessage && !hasSnapshot && !this.controller.isLoading() ? (
                    <div className='studio-workspace-graph__overlay' data-testid='workspace-graph-empty'>
                        <strong>Waiting for graph snapshot</strong>
                        <p>The backend has not returned a snapshot for the current repository revisions yet.</p>
                    </div>
                ) : undefined}
                {!blockingErrorMessage && hasSnapshot && viewModel.nodes.length === 0 && !this.controller.isLoading() ? (
                    <div className='studio-workspace-graph__overlay' data-testid='workspace-graph-filtered-empty'>
                        <strong>
                            {diagnosticsOnlyWithoutVisibleNodes
                                ? (nodeLinkedDiagnostics.length
                                    ? 'No node-linked diagnostics match the current filters'
                                    : 'No node-linked diagnostics')
                                : (snapshot?.nodes.length ? 'No nodes match the current filters' : 'The workspace graph is empty')}
                        </strong>
                        <p>
                            {diagnosticsOnlyWithoutVisibleNodes
                                ? (globalDiagnostics.length
                                    ? 'Graph-level diagnostics are listed above because they do not map to canvas nodes.'
                                    : 'Turn off the Diagnostics filter to return to the complete workspace graph.')
                                : (snapshot?.nodes.length
                                    ? 'Reset filters to return to the complete workspace graph.'
                                    : 'The cfs map completed successfully but did not produce any graph nodes.')}
                        </p>
                        {snapshot?.nodes.length && !diagnosticsOnlyWithoutVisibleNodes ? (
                            <button
                                type='button'
                                className='theia-button'
                                onClick={() => this.controller.resetFilters()}
                            >
                                Reset filters
                            </button>
                        ) : undefined}
                    </div>
                ) : undefined}
                <div className='studio-workspace-graph__canvas' onKeyDown={event => void this.handleKeyDown(event)}>
                    <ReactFlow
                        key={this.controller.getActiveRepository()?.repositoryId ?? 'no-repository'}
                        nodes={[...bucketNodes, ...bandNodes, ...layout.nodes]}
                        edges={layout.edges}
                        nodeTypes={graphNodeTypes}
                        fitView={!this.controller.getState().viewport}
                        minZoom={0.2}
                        maxZoom={1.6}
                        connectionLineType={ConnectionLineType.SmoothStep}
                        nodesDraggable={false}
                        nodesConnectable={false}
                        elementsSelectable
                        onlyRenderVisibleElements={isLargeGraph}
                        onNodeClick={onNodeClick}
                        onNodeDoubleClick={onNodeDoubleClick}
                        onPaneClick={() => this.controller.selectNode(undefined)}
                        onMoveEnd={(_event, viewport) => this.controller.setViewport(viewport)}
                        defaultViewport={this.controller.getState().viewport}
                        colorMode='system'
                        onInit={instance => {
                            this.flowInstance = instance;
                        }}
                    >
                        <Background variant={BackgroundVariant.Dots} gap={16} size={1} />
                        <Controls showFitView={false} showInteractive={false}>
                            <ControlButton
                                title='Fit selection'
                                aria-label='Fit selection'
                                onClick={() => this.fitSelection()}
                            >
                                <span className='codicon codicon-focus-center' />
                            </ControlButton>
                            <ControlButton
                                title='Full view'
                                aria-label='Full view'
                                onClick={() => this.fitFullView()}
                            >
                                <span className='codicon codicon-screen-full' />
                            </ControlButton>
                        </Controls>
                        {!isLargeGraph ? <MiniMap pannable zoomable /> : undefined}
                    </ReactFlow>
                </div>
            </div>
        );
    }

    protected fitSelection(): void {
        const selectedNodeId = this.controller.getState().selectedNodeId;
        const viewModel = this.controller.getViewModel();
        const ids = selectedNodeId && viewModel.highlightedNodeIds.size > 0
            ? [...viewModel.highlightedNodeIds]
            : viewModel.nodes.map(node => node.id);
        void this.flowInstance?.fitView({
            nodes: ids.map(id => ({ id })),
            padding: selectedNodeId ? 0.35 : 0.15,
            duration: 300
        });
    }

    protected fitFullView(): void {
        void this.flowInstance?.fitView({ padding: 0.15, duration: 300 });
    }

    protected async handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>): Promise<void> {
        if (event.key !== 'Enter') {
            return;
        }
        const node = this.controller.getSelectedNode();
        if (node && node.kind !== 'phantom-cpt' && node.relPath) {
            await this.openNodeSafely(node);
        }
    }

    protected async openNodeSafely(node: WorkspaceGraphNode): Promise<void> {
        try {
            await this.openHandler.openNode(node);
            this.controller.clearOpenError();
        } catch (error) {
            this.controller.reportOpenError(error);
        }
    }
}
