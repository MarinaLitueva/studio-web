import 'reflect-metadata';
jest.mock('@theia/core/lib/browser', () => ({
    FrontendApplicationContribution: class {},
    StatefulWidget: class {},
    WebSocketConnectionProvider: class {}
}));
jest.mock('./git-operations-contribution', () => ({
    GitOperationsFrontendController: class {}
}));
jest.mock('./graph-open-handler', () => ({
    GraphOpenHandler: class {}
}));
import * as React from '@theia/core/shared/react';
import { Emitter } from '@theia/core/lib/common';
import { MessageLoop } from '@theia/core/shared/@lumino/messaging';
import { Container } from '@theia/core/shared/inversify';
import {
    WorkspaceGraphWidget,
    WorkspaceGraphFrontendController,
    filterGraphSnapshot,
    getRevisionVectorFingerprint,
    layoutGraph,
    sanitizeGraphLabel
} from './workspace-graph-widget';
import type { WorkspaceGraphNode, WorkspaceGraphSnapshot } from '../common/graph-model';

jest.mock('@xyflow/react', () => ({
    ReactFlow: ({
        children,
        nodes = [],
        nodeTypes = {},
        onlyRenderVisibleElements = false,
        fitView = false,
        defaultViewport
    }: {
        children?: React.ReactNode;
        nodes?: Array<{ id: string; type?: string; data: Record<string, unknown> }>;
        nodeTypes?: Record<string, React.ComponentType<Record<string, unknown>>>;
        onlyRenderVisibleElements?: boolean;
        fitView?: boolean;
        defaultViewport?: { x: number; y: number; zoom: number };
    }) => (
        <div
            data-testid='react-flow'
            data-only-render-visible={String(onlyRenderVisibleElements)}
            data-fit-view={String(fitView)}
            data-default-viewport={defaultViewport ? JSON.stringify(defaultViewport) : ''}
        >
            {nodes.map(node => {
                const Component = nodeTypes[node.type ?? 'default'];
                return Component ? <Component key={node.id} {...node} /> : undefined;
            })}
            {children}
        </div>
    ),
    Background: () => null,
    Controls: () => null,
    ControlButton: ({ children }: { children?: React.ReactNode }) => <button>{children}</button>,
    Handle: () => null,
    MiniMap: () => null,
    BackgroundVariant: { Dots: 'dots' },
    ConnectionLineType: { SmoothStep: 'smoothstep' },
    Position: { Left: 'left', Right: 'right' }
}));

function makeSnapshot(overrides: Partial<WorkspaceGraphSnapshot> = {}): WorkspaceGraphSnapshot {
    return {
        schemaVersion: 2,
        mapVersion: '1.0',
        workspaceId: 'ws',
        revision: 'rev',
        repositories: [],
        primarySource: 'repo',
        sources: [],
        nodes: [],
        edges: [],
        danglingCptUses: [],
        categories: {},
        bucketRects: {},
        categoryBands: {},
        diagnostics: [],
        indexedAt: '2026-07-30T00:00:00.000Z',
        stale: false,
        ...overrides
    };
}

describe('workspace graph widget helpers', () => {
    it('renders malicious labels as text without creating html elements', () => {
        const reactActEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
        const previous = reactActEnvironment.IS_REACT_ACT_ENVIRONMENT;
        reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
        const container = document.createElement('div');
        const root = require('react-dom/client').createRoot(container);
        React.act(() => {
            root.render(React.createElement('div', {}, sanitizeGraphLabel('<img src=x onerror=alert(1)><script>alert(1)</script>')));
        });
        expect(container.textContent).toContain('<img src=x onerror=alert(1)><script>alert(1)</script>');
        expect(container.querySelector('img')).toBeNull();
        expect(container.querySelector('script')).toBeNull();
        React.act(() => {
            root.unmount();
        });
        reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = previous;
    });

    it('restores only versioned graph ui state', () => {
        const controller = Object.create(WorkspaceGraphFrontendController.prototype) as WorkspaceGraphFrontendController;
        Object.defineProperty(controller, 'onDidChangeEmitter', { value: new Emitter<void>() });
        Object.defineProperty(controller, 'selectionService', { value: { selection: undefined } });
        Object.defineProperty(controller, 'activeRepository', { value: { repositoryId: 'repo-a' }, writable: true });
        controller.restoreState({
            version: 2,
            repositoryId: 'repo-a',
            selectedNodeId: 'node-1',
            mode: 'source',
            search: 'abc',
            category: 'code',
            source: 'primary',
            showDiagnosticsOnly: true,
            neighborhoodOnly: false,
            viewport: { x: 10, y: 20, zoom: 0.5 },
            lastSha: 'deadbeef'
        });
        expect(controller.getState()).toMatchObject({
            selectedNodeId: 'node-1',
            mode: 'source',
            search: 'abc',
            category: 'code',
            source: 'primary',
            showDiagnosticsOnly: false,
            neighborhoodOnly: false,
            viewport: { x: 10, y: 20, zoom: 0.5 },
            lastSha: 'deadbeef'
        });
        expect(Object.keys(controller.getState()).sort()).toEqual([
            'category',
            'lastSha',
            'mode',
            'neighborhoodOnly',
            'repositoryId',
            'search',
            'selectedNodeId',
            'showDiagnosticsOnly',
            'source',
            'version',
            'viewport'
        ]);
        controller.restoreState({ version: 99 } as never);
        expect(controller.getState().mode).toBe('source');
    });

    it('does not restore repository-local UI state into a different repository', () => {
        const controller = new WorkspaceGraphFrontendController();
        Object.defineProperty(controller, 'selectionService', { value: { selection: undefined } });
        Object.defineProperty(controller, 'activeRepository', { value: { repositoryId: 'repo-b' }, writable: true });
        controller.restoreState({
            version: 2,
            repositoryId: 'repo-a',
            selectedNodeId: 'local:README.md',
            mode: 'source',
            search: 'repo-a-only',
            category: 'missing-in-b',
            source: 'repo-a',
            showDiagnosticsOnly: false,
            neighborhoodOnly: false,
            viewport: { x: 10, y: 20, zoom: 0.5 }
        });
        expect(controller.getState()).toMatchObject({
            repositoryId: 'repo-b',
            selectedNodeId: undefined,
            mode: 'all',
            search: '',
            category: '',
            source: '',
            viewport: undefined
        });
    });

    it('defers restored state until its repository becomes active', async () => {
        const repository = { repositoryId: 'repo-a', label: 'Repository A' };
        const controller = new WorkspaceGraphFrontendController();
        Object.defineProperty(controller, 'selectionService', { value: { selection: undefined } });
        Object.defineProperty(controller, 'gitOperationsController', { value: { getSelectedRepository: () => repository } });
        controller.bindGraphService({
            getDirtyOverlay: jest.fn(async () => ({ workspaceId: 'ws', revision: 'dirty', files: [] })),
            getStatus: jest.fn(async () => ({ schemaVersion: 2, serviceInstanceId: 'instance-a', workspaceId: 'ws', repositoryId: 'repo-a', state: 'ready', sequence: 1 })),
            getRepositoryRevisions: jest.fn(async () => [{ repositoryId: 'repo-a', commitSha: 'a'.repeat(40) }]),
            getSnapshot: jest.fn(async () => ({
                status: { schemaVersion: 2, serviceInstanceId: 'instance-a', workspaceId: 'ws', repositoryId: 'repo-a', state: 'ready', sequence: 1 },
                snapshot: makeSnapshot({ repositories: [{ repositoryId: 'repo-a', commitSha: 'a'.repeat(40) }] }),
                notModified: false
            }))
        } as unknown as import('../common/graph-model').WorkspaceGraphService);
        controller.restoreState({
            version: 2,
            repositoryId: 'repo-a',
            mode: 'source',
            search: 'needle',
            category: 'code',
            source: 'local',
            showDiagnosticsOnly: false,
            neighborhoodOnly: false,
            viewport: { x: 10, y: 20, zoom: 0.5 }
        });
        expect(controller.getState().repositoryId).toBeUndefined();
        await controller.refreshGraph('activate-restored-repository');
        expect(controller.getState()).toMatchObject({
            repositoryId: 'repo-a',
            mode: 'source',
            search: 'needle',
            category: 'code',
            source: 'local',
            neighborhoodOnly: false,
            viewport: { x: 10, y: 20, zoom: 0.5 }
        });
    });

    it('binds the single graph service proxy onto the controller', () => {
        const controller = Object.create(WorkspaceGraphFrontendController.prototype) as WorkspaceGraphFrontendController;
        const graphService = { getStatus: jest.fn() } as unknown as import('../common/graph-model').WorkspaceGraphService;
        controller.bindGraphService(graphService);
        expect((controller as unknown as { graphService: unknown }).graphService).toBe(graphService);
    });

    it('does not call the backend and explains repository selection when Source Control has no selection', async () => {
        const controller = new WorkspaceGraphFrontendController();
        const graphService = {
            getStatus: jest.fn(),
            getRepositoryRevisions: jest.fn(),
            getSnapshot: jest.fn(),
            getDirtyOverlay: jest.fn()
        } as unknown as import('../common/graph-model').WorkspaceGraphService;
        Object.defineProperty(controller, 'gitOperationsController', {
            value: { getSelectedRepository: () => undefined }
        });
        Object.defineProperty(controller, 'selectionService', { value: { selection: undefined } });
        controller.bindGraphService(graphService);

        await controller.refreshGraph('test-no-selection');

        expect(graphService.getStatus).not.toHaveBeenCalled();
        expect(graphService.getRepositoryRevisions).not.toHaveBeenCalled();
        expect(graphService.getSnapshot).not.toHaveBeenCalled();
        expect(graphService.getDirtyOverlay).not.toHaveBeenCalled();
        expect(controller.getSnapshot()).toBeUndefined();
        expect(controller.getActiveRepository()).toBeUndefined();
        expect(controller.getErrorMessage()).toContain('Select a repository in Source Control');
        expect(controller.getErrorMessage()).toContain('all-workspace graph is unavailable because it is too large');
    });

    it('clears repository-local UI state and ignores late responses and status pushes from the previous scope', async () => {
        const repoA = { repositoryId: 'repo-a', label: 'Repository A' };
        const repoB = { repositoryId: 'repo-b', label: 'Repository B' };
        let selectedRepository = repoA;
        let resolveRepoASnapshot!: (response: import('../common/graph-model').WorkspaceGraphSnapshotResponse) => void;
        let signalRepoAStarted!: () => void;
        const repoAStarted = new Promise<void>(resolve => { signalRepoAStarted = resolve; });
        const repoASnapshot = new Promise<import('../common/graph-model').WorkspaceGraphSnapshotResponse>(resolve => {
            resolveRepoASnapshot = resolve;
        });
        const statusFor = (repositoryId: string) => ({
            schemaVersion: 2,
            serviceInstanceId: 'instance-a',
            workspaceId: 'ws',
            repositoryId,
            state: 'ready' as const,
            sequence: 1
        });
        const graphService = {
            getStatus: jest.fn(async ({ repositoryId }: { repositoryId: string }) => statusFor(repositoryId)),
            getRepositoryRevisions: jest.fn(async ({ repositoryId }: { repositoryId: string }) => [{
                repositoryId,
                commitSha: repositoryId === 'repo-a' ? 'a'.repeat(40) : 'b'.repeat(40)
            }]),
            getDirtyOverlay: jest.fn(async ({ repositoryId }: { repositoryId: string }) => ({
                workspaceId: 'ws',
                revision: repositoryId,
                files: []
            })),
            getSnapshot: jest.fn(({ repositoryId }: { repositoryId: string }) => {
                if (repositoryId === 'repo-a') {
                    signalRepoAStarted();
                    return repoASnapshot;
                }
                return Promise.resolve({
                    status: statusFor(repositoryId),
                    snapshot: makeSnapshot({ revision: 'repo-b-revision', primarySource: repositoryId }),
                    notModified: false
                });
            })
        } as unknown as import('../common/graph-model').WorkspaceGraphService;
        const controller = new WorkspaceGraphFrontendController();
        Object.defineProperty(controller, 'gitOperationsController', {
            value: { getSelectedRepository: () => selectedRepository }
        });
        Object.defineProperty(controller, 'selectionService', { value: { selection: undefined } });
        controller.bindGraphService(graphService);

        const firstRefresh = controller.refreshGraph('repo-a');
        await repoAStarted;
        controller.setMode('source');
        controller.setSearch('old scope');
        controller.setCategory('code');
        controller.setSource('repo-a');
        controller.setDiagnosticsOnly(true);
        controller.setNeighborhoodOnly(false);
        controller.setViewport({ x: 20, y: 30, zoom: 0.5 });

        selectedRepository = repoB;
        await controller.refreshGraph('repo-b');
        expect(controller.getActiveRepository()?.label).toBe('Repository B');
        expect(controller.getSnapshot()?.revision).toBe('repo-b-revision');
        expect(controller.getState()).toMatchObject({
            mode: 'all',
            search: '',
            category: '',
            source: '',
            showDiagnosticsOnly: false,
            neighborhoodOnly: true,
            viewport: undefined,
            selectedNodeId: undefined,
            lastSha: `repo-b:${'b'.repeat(40)}`
        });

        controller.onWorkspaceGraphStatusChanged({ ...statusFor('repo-a'), state: 'failed', sequence: 99 });
        expect(controller.getStatus()?.repositoryId).toBe('repo-b');
        expect(controller.getStatus()?.state).toBe('ready');

        resolveRepoASnapshot({
            status: statusFor('repo-a'),
            snapshot: makeSnapshot({ revision: 'late-repo-a', primarySource: 'repo-a' }),
            notModified: false
        });
        await firstRefresh;
        expect(controller.getActiveRepository()?.repositoryId).toBe('repo-b');
        expect(controller.getSnapshot()?.revision).toBe('repo-b-revision');
        expect(graphService.getSnapshot).toHaveBeenCalledWith({ repositoryId: 'repo-a', knownRevision: undefined });
        expect(graphService.getSnapshot).toHaveBeenCalledWith({ repositoryId: 'repo-b', knownRevision: undefined });
    });

    it('limits large graphs to the selected neighborhood when enabled', () => {
        const snapshot: WorkspaceGraphSnapshot = {
            schemaVersion: 2,
            mapVersion: '1.0',
            workspaceId: 'ws',
            revision: 'rev',
            repositories: [],
            primarySource: 'repo',
            sources: [],
            diagnostics: [],
            indexedAt: '2026-07-28T00:00:00.000Z',
            stale: false,
            danglingCptUses: [],
            categories: {},
            bucketRects: {},
            categoryBands: {},
            nodes: Array.from({ length: 501 }, (_, index) => ({
                id: `node-${index}`,
                relPath: `path-${index}.md`,
                source: 'repo',
                kind: 'source' as const,
                language: 'typescript',
                category: 'code',
                categoryOrigin: 'parent-dir' as const,
                content: null,
                loc: 1,
                cptDefs: [],
                cptUses: [],
                label: `Node ${index}`,
                position: { x: index * 10, y: 20 },
                location: {
                    workspaceId: 'ws',
                    repositoryId: 'repo',
                    repositoryRelativePath: `path-${index}.md`
                }
            })),
            edges: [
                { id: 'e-1', type: 'cpt-impl' as const, from: 'node-0', to: 'node-1', refs: [], crossRepo: false, dangling: false },
                { id: 'e-2', type: 'cpt-impl' as const, from: 'node-0', to: 'node-2', refs: [], crossRepo: false, dangling: false }
            ]
        };
        const filtered = filterGraphSnapshot(snapshot, {
            version: 2,
            selectedNodeId: 'node-0',
            mode: 'all',
            search: '',
            category: '',
            source: '',
            showDiagnosticsOnly: false,
            neighborhoodOnly: true
        });
        expect(filtered.nodes.map(node => node.id)).toEqual(['node-0', 'node-1', 'node-2']);
        expect(filtered.edges).toHaveLength(2);
    });

    it('caps the initial large-graph overview while keeping filtered nodes reachable', () => {
        const nodes = Array.from({ length: 700 }, (_, index) => ({
            id: `node-${index}`,
            relPath: `path-${index}.md`,
            source: 'local',
            kind: 'source' as const,
            language: 'typescript',
            category: 'code',
            categoryOrigin: 'parent-dir' as const,
            content: null,
            loc: 1,
            cptDefs: [],
            cptUses: [],
            label: `Node ${index}`,
            position: { x: index * 10, y: 20 },
            location: { workspaceId: 'ws', repositoryId: 'repo', repositoryRelativePath: `path-${index}.md` }
        }));
        const snapshot = makeSnapshot({ nodes });
        const baseState = {
            version: 2 as const,
            repositoryId: 'repo',
            mode: 'all' as const,
            search: '',
            category: '',
            source: '',
            showDiagnosticsOnly: false,
            neighborhoodOnly: true
        };
        const overview = filterGraphSnapshot(snapshot, baseState);
        expect(overview.nodes).toHaveLength(500);
        expect(overview.limitedByOverview).toBe(true);
        const searched = filterGraphSnapshot(snapshot, { ...baseState, search: 'Node 699' });
        expect(searched.nodes.map(node => node.id)).toEqual(['node-699']);
        expect(searched.limitedByOverview).toBe(false);
    });

    it('bounds a selected high-degree neighborhood deterministically', () => {
        const nodes = Array.from({ length: 701 }, (_, index) => ({
            id: `node-${index}`,
            relPath: `path-${index}.md`,
            source: 'local',
            kind: 'source' as const,
            language: 'typescript',
            category: 'code',
            categoryOrigin: 'parent-dir' as const,
            content: null,
            loc: 1,
            cptDefs: [],
            cptUses: [],
            label: `Node ${index}`,
            position: { x: index * 10, y: 20 },
            location: { workspaceId: 'ws', repositoryId: 'repo', repositoryRelativePath: `path-${index}.md` }
        }));
        const edges = nodes.slice(1).map((node, index) => ({
            id: `edge-${index}`,
            type: 'cpt-impl' as const,
            from: 'node-0',
            to: node.id,
            refs: [],
            crossRepo: false,
            dangling: false
        }));
        const filtered = filterGraphSnapshot(makeSnapshot({ nodes, edges }), {
            version: 2,
            repositoryId: 'repo',
            selectedNodeId: 'node-0',
            mode: 'all',
            search: '',
            category: '',
            source: '',
            showDiagnosticsOnly: false,
            neighborhoodOnly: true
        });

        expect(filtered.nodes).toHaveLength(500);
        expect(filtered.edges).toHaveLength(499);
        expect(filtered.nodes[0].id).toBe('node-0');
        expect(filtered.nodes.slice(1).map(node => node.id)).toEqual(
            nodes.slice(1).map(node => node.id).sort().slice(0, 499)
        );
        expect(filtered.limitedByNeighborhood).toBe(true);
        expect(filtered.highlightedNodeIds.size).toBe(500);
    });

    it('caps dense edges independently of neighborhood mode and renders an accurate limit banner', () => {
        const nodes = Array.from({ length: 500 }, (_, index) => ({
            id: `node-${index}`,
            relPath: `path-${index}.md`,
            source: 'local',
            kind: 'source' as const,
            language: 'typescript',
            category: 'code',
            categoryOrigin: 'parent-dir' as const,
            content: null,
            loc: 1,
            cptDefs: [],
            cptUses: [],
            label: `Node ${index}`,
            location: { workspaceId: 'ws', repositoryId: 'repo', repositoryRelativePath: `path-${index}.md` }
        }));
        const nonIncidentEdges = Array.from({ length: 2_500 }, (_, index) => ({
            id: `a-non-incident-${String(index).padStart(4, '0')}`,
            type: 'file-link' as const,
            from: `node-${1 + (index % 498)}`,
            to: `node-${1 + ((index + 1) % 498)}`,
            refs: [],
            crossRepo: false,
            dangling: false
        }));
        const incidentEdges = Array.from({ length: 100 }, (_, index) => ({
            id: `z-selected-${String(index).padStart(3, '0')}`,
            type: 'cpt-impl' as const,
            from: 'node-0',
            to: `node-${1 + index}`,
            refs: [],
            crossRepo: false,
            dangling: false
        }));
        const snapshot = makeSnapshot({ nodes, edges: [...nonIncidentEdges, ...incidentEdges] });
        const state = {
            version: 2 as const,
            repositoryId: 'repo',
            mode: 'all' as const,
            search: '',
            category: '',
            source: '',
            showDiagnosticsOnly: false,
            neighborhoodOnly: true
        };

        const selected = filterGraphSnapshot(snapshot, { ...state, selectedNodeId: 'node-0' });
        expect(selected.nodes).toHaveLength(500);
        expect(selected.edges).toHaveLength(2_000);
        expect(selected.omittedEdgeCount).toBe(600);
        expect(selected.edges.slice(0, incidentEdges.length).map(edge => edge.id)).toEqual(
            incidentEdges.map(edge => edge.id).sort()
        );

        const overview = filterGraphSnapshot(snapshot, state);
        expect(overview.edges).toHaveLength(2_000);
        expect(overview.omittedEdgeCount).toBe(600);
        expect(overview.edges.map(edge => edge.id)).toEqual(
            [...nonIncidentEdges, ...incidentEdges].map(edge => edge.id).sort().slice(0, 2_000)
        );

        const fullViewState = { ...state, selectedNodeId: 'node-0', neighborhoodOnly: false };
        const fullView = filterGraphSnapshot(snapshot, fullViewState);
        expect(fullView.nodes).toHaveLength(500);
        expect(fullView.edges).toHaveLength(2_000);
        expect(fullView.omittedEdgeCount).toBe(600);
        expect(fullView.edges.slice(0, incidentEdges.length).map(edge => edge.id)).toEqual(
            incidentEdges.map(edge => edge.id).sort()
        );

        class FakeController {
            readonly onDidChange = () => ({ dispose() {} });
            getViewModel = () => fullView;
            getDirtyFiles = () => [];
            getVisibleDiagnostics = () => [];
            getState = () => fullViewState;
            getSelectedNode = () => nodes[0];
            getActiveRepository = () => ({ repositoryId: 'repo', label: 'Repository' });
            getStatus = () => ({ state: 'ready' as const });
            getSnapshot = () => snapshot;
            getErrorMessage = () => undefined;
            getOpenErrorMessage = () => undefined;
            isLoading = () => false;
        }
        const container = new Container();
        container.bind(WorkspaceGraphWidget).toSelf();
        container.bind(WorkspaceGraphFrontendController).toConstantValue(new FakeController() as never);
        container.bind(require('./graph-open-handler').GraphOpenHandler).toConstantValue({ openNode: jest.fn() } as never);
        const reactActEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
        const previousActEnvironment = reactActEnvironment.IS_REACT_ACT_ENVIRONMENT;
        reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
        let widget: WorkspaceGraphWidget;
        React.act(() => {
            widget = container.resolve(WorkspaceGraphWidget);
            MessageLoop.flush();
        });
        const banner = widget!.node.querySelector('[data-testid="workspace-graph-edge-limit"]');
        expect(banner?.textContent).toContain('Showing 2000 visible edges and omitting 600');
        expect(banner?.textContent).toContain('Edges connected to the selected node are prioritized');
        React.act(() => {
            widget!.dispose();
            MessageLoop.flush();
        });
        reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
    });

    it('does not let an older snapshot RPC response regress a newer status push', async () => {
        const repository = { repositoryId: 'repo-a', label: 'Repository A' };
        let resolveSnapshot!: (response: import('../common/graph-model').WorkspaceGraphSnapshotResponse) => void;
        let signalSnapshotStarted!: () => void;
        const snapshotStarted = new Promise<void>(resolve => { signalSnapshotStarted = resolve; });
        const snapshotResponse = new Promise<import('../common/graph-model').WorkspaceGraphSnapshotResponse>(resolve => {
            resolveSnapshot = resolve;
        });
        const status = (sequence: number, state: 'ready' | 'indexing' = 'ready') => ({
            schemaVersion: 2,
            serviceInstanceId: 'instance-a',
            workspaceId: 'ws',
            repositoryId: 'repo-a',
            state,
            sequence
        });
        const controller = new WorkspaceGraphFrontendController();
        Object.defineProperty(controller, 'gitOperationsController', { value: { getSelectedRepository: () => repository } });
        Object.defineProperty(controller, 'selectionService', { value: { selection: undefined } });
        controller.bindGraphService({
            getDirtyOverlay: jest.fn(async () => ({ workspaceId: 'ws', revision: 'dirty', files: [] })),
            getStatus: jest.fn(async () => status(1)),
            getRepositoryRevisions: jest.fn(async () => [{ repositoryId: 'repo-a', commitSha: 'a'.repeat(40) }]),
            getSnapshot: jest.fn(() => {
                signalSnapshotStarted();
                return snapshotResponse;
            })
        } as unknown as import('../common/graph-model').WorkspaceGraphService);

        const refresh = controller.refreshGraph('test-newer-push');
        await snapshotStarted;
        controller.onWorkspaceGraphStatusChanged(status(3));
        resolveSnapshot({
            status: status(2, 'indexing'),
            snapshot: makeSnapshot({ repositories: [{ repositoryId: 'repo-a', commitSha: 'a'.repeat(40) }] }),
            notModified: false
        });
        await refresh;

        expect(controller.getStatus()).toMatchObject({ serviceInstanceId: 'instance-a', sequence: 3, state: 'ready' });
    });

    it('accepts a restarted backend epoch and rejects delayed pushes from the superseded instance', async () => {
        const repository = { repositoryId: 'repo-a', label: 'Repository A' };
        let serviceInstanceId = 'instance-old';
        let baseSequence = 10;
        const status = (instance: string, sequence: number) => ({
            schemaVersion: 2,
            serviceInstanceId: instance,
            workspaceId: 'ws',
            repositoryId: 'repo-a',
            state: 'ready' as const,
            sequence
        });
        const controller = new WorkspaceGraphFrontendController();
        Object.defineProperty(controller, 'gitOperationsController', { value: { getSelectedRepository: () => repository } });
        Object.defineProperty(controller, 'selectionService', { value: { selection: undefined } });
        controller.bindGraphService({
            getDirtyOverlay: jest.fn(async () => ({ workspaceId: 'ws', revision: 'dirty', files: [] })),
            getStatus: jest.fn(async () => status(serviceInstanceId, baseSequence)),
            getRepositoryRevisions: jest.fn(async () => [{ repositoryId: 'repo-a', commitSha: 'a'.repeat(40) }]),
            getSnapshot: jest.fn(async () => ({
                status: status(serviceInstanceId, baseSequence + 1),
                snapshot: makeSnapshot({ repositories: [{ repositoryId: 'repo-a', commitSha: 'a'.repeat(40) }] }),
                notModified: false
            }))
        } as unknown as import('../common/graph-model').WorkspaceGraphService);

        await controller.refreshGraph('old-instance');
        expect(controller.getStatus()).toMatchObject({ serviceInstanceId: 'instance-old', sequence: 11 });

        serviceInstanceId = 'instance-new';
        baseSequence = 1;
        await controller.refreshGraph('backend-restarted');
        expect(controller.getStatus()).toMatchObject({ serviceInstanceId: 'instance-new', sequence: 2 });

        controller.onWorkspaceGraphStatusChanged(status('instance-old', 99));
        expect(controller.getStatus()).toMatchObject({ serviceInstanceId: 'instance-new', sequence: 2 });
        controller.onWorkspaceGraphStatusChanged(status('instance-new', 3));
        expect(controller.getStatus()).toMatchObject({ serviceInstanceId: 'instance-new', sequence: 3 });
    });

    it('surfaces graph file open failures without replacing the graph snapshot', async () => {
        const node = {
            id: 'node-1', relPath: 'src/a.ts', source: 'local', kind: 'source' as const,
            language: 'typescript', category: 'code', categoryOrigin: 'parent-dir' as const,
            content: null, loc: 1, cptDefs: [], cptUses: [], label: 'a.ts',
            location: { workspaceId: 'ws', repositoryId: 'repo', repositoryRelativePath: 'src/a.ts' }
        };
        const controller = new WorkspaceGraphFrontendController();
        const widget = Object.create(WorkspaceGraphWidget.prototype) as WorkspaceGraphWidget;
        Object.defineProperty(widget, 'controller', { value: controller });
        Object.defineProperty(widget, 'openHandler', { value: { openNode: jest.fn(async () => { throw new Error('file disappeared'); }) } });
        await (widget as unknown as { openNodeSafely(value: WorkspaceGraphNode): Promise<void> }).openNodeSafely(node);
        expect(controller.getOpenErrorMessage()).toContain('file disappeared');
        expect(controller.getSnapshot()).toBeUndefined();
    });

    it('uses backend supplied node positions without client-side layout', () => {
        const node = {
            id: 'node-1',
            relPath: 'src/a.ts',
            source: 'repo',
            kind: 'source' as const,
            language: 'typescript',
            category: 'code',
            categoryOrigin: 'parent-dir' as const,
            content: null,
            loc: 12,
            cptDefs: [],
            cptUses: [],
            label: 'a.ts',
            position: { x: 321, y: 654 },
            location: { workspaceId: 'ws', repositoryId: 'repo', repositoryRelativePath: 'src/a.ts' }
        };
        const layout = layoutGraph([node], [], undefined, [], [], new Set());
        expect(layout.nodes[0].position).toEqual({ x: 321, y: 654 });
    });

    it('uses deterministic fallback positions only when canonical positions are absent', () => {
        const baseNode = {
            relPath: 'src/a.ts',
            source: 'repo',
            kind: 'source' as const,
            language: 'typescript',
            category: 'code',
            categoryOrigin: 'parent-dir' as const,
            content: null,
            loc: 12,
            cptDefs: [],
            cptUses: [],
            label: 'a.ts',
            location: { workspaceId: 'ws', repositoryId: 'repo', repositoryRelativePath: 'src/a.ts' }
        };
        const nodes = [
            { ...baseNode, id: 'canonical-zero', position: { x: 0, y: 0 } },
            { ...baseNode, id: 'missing-b', position: undefined },
            { ...baseNode, id: 'missing-a', position: undefined }
        ] as unknown as WorkspaceGraphNode[];
        const layout = layoutGraph(nodes, [], undefined, [], [], new Set());
        expect(layout.nodes.find(node => node.id === 'canonical-zero')?.position).toEqual({ x: 0, y: 0 });
        expect(layout.nodes.find(node => node.id === 'missing-a')?.position).toEqual({ x: 80, y: 80 });
        expect(layout.nodes.find(node => node.id === 'missing-b')?.position).toEqual({ x: 360, y: 80 });
    });

    it('uses a restored viewport instead of running initial fit-view', () => {
        const viewport = { x: 10, y: 20, zoom: 0.5 };
        const snapshot = makeSnapshot();
        class FakeController {
            readonly onDidChange = () => ({ dispose() {} });
            getViewModel = () => ({
                nodes: [],
                edges: [],
                highlightedNodeIds: new Set<string>(),
                limitedByOverview: false,
                limitedByNeighborhood: false
            });
            getDirtyFiles = () => [];
            getVisibleDiagnostics = () => [];
            getState = () => ({
                version: 2 as const,
                mode: 'all' as const,
                search: '',
                category: '',
                source: '',
                showDiagnosticsOnly: false,
                neighborhoodOnly: true,
                viewport
            });
            getSelectedNode = () => undefined;
            getActiveRepository = () => ({ repositoryId: 'repo', label: 'Repository' });
            getStatus = () => ({ state: 'ready' as const });
            getSnapshot = () => snapshot;
            getErrorMessage = () => undefined;
            getOpenErrorMessage = () => undefined;
            isLoading = () => false;
        }
        const container = new Container();
        container.bind(WorkspaceGraphWidget).toSelf();
        container.bind(WorkspaceGraphFrontendController).toConstantValue(new FakeController() as never);
        container.bind(require('./graph-open-handler').GraphOpenHandler).toConstantValue({ openNode: jest.fn() } as never);
        const reactActEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
        const previousActEnvironment = reactActEnvironment.IS_REACT_ACT_ENVIRONMENT;
        reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
        let widget: WorkspaceGraphWidget;
        React.act(() => {
            widget = container.resolve(WorkspaceGraphWidget);
            MessageLoop.flush();
        });

        const flow = widget!.node.querySelector('[data-testid="react-flow"]');
        expect(flow?.getAttribute('data-fit-view')).toBe('false');
        expect(flow?.getAttribute('data-default-viewport')).toBe(JSON.stringify(viewport));
        React.act(() => {
            widget!.dispose();
            MessageLoop.flush();
        });
        reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
    });

    it('builds deterministic revision fingerprints from backend revisions', () => {
        const revisions = [
            { repositoryId: 'repo-b', commitSha: 'b'.repeat(40) },
            { repositoryId: 'repo-a', commitSha: 'a'.repeat(40) }
        ];
        expect(getRevisionVectorFingerprint(revisions)).toBe(`repo-a:${'a'.repeat(40)}|repo-b:${'b'.repeat(40)}`);
    });

    it('resets every graph filter to the all-nodes defaults', () => {
        const controller = Object.create(WorkspaceGraphFrontendController.prototype) as WorkspaceGraphFrontendController;
        Object.defineProperty(controller, 'onDidChangeEmitter', { value: new Emitter<void>() });
        Object.defineProperty(controller, 'selectionService', { value: { selection: undefined } });
        controller.restoreState({
            version: 2,
            mode: 'source',
            search: 'needle',
            category: 'code',
            source: 'repo',
            showDiagnosticsOnly: true,
            neighborhoodOnly: false
        });
        controller.setDiagnosticsOnly(true);
        controller.resetFilters();
        expect(controller.getState()).toMatchObject({
            mode: 'all',
            search: '',
            category: '',
            source: '',
            showDiagnosticsOnly: false,
            neighborhoodOnly: true
        });
    });

    it('renders an error overlay when graph data is unavailable', () => {
        class FakeController {
            readonly onDidChange = () => ({ dispose() {} });
            getViewModel = () => ({ nodes: [], edges: [], highlightedNodeIds: new Set<string>() });
            getDirtyFiles = () => [];
            getVisibleDiagnostics = () => [];
            getState = () => ({
                version: 2 as const,
                mode: 'all' as const,
                search: '',
                category: '',
                source: '',
                showDiagnosticsOnly: false,
                neighborhoodOnly: true
            });
            getSelectedNode = () => undefined;
            getActiveRepository = () => undefined;
            getStatus = () => undefined;
            getSnapshot = () => undefined;
            getErrorMessage = () => 'No revision available';
            getOpenErrorMessage = () => undefined;
            isLoading = () => false;
        }
        class FakeOpenHandler {
            openNode = jest.fn();
        }
        const container = new Container();
        container.bind(WorkspaceGraphWidget).toSelf();
        container.bind(WorkspaceGraphFrontendController).toConstantValue(new FakeController() as never);
        container.bind(require('./graph-open-handler').GraphOpenHandler).toConstantValue(new FakeOpenHandler() as never);
        const reactActEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
        reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
        let widget: WorkspaceGraphWidget;
        React.act(() => {
            widget = container.resolve(WorkspaceGraphWidget);
            MessageLoop.flush();
        });
        expect(widget!.node.textContent).toContain('Graph unavailable');
        React.act(() => {
            widget!.dispose();
            MessageLoop.flush();
        });
    });

    it('renders a failed stale service snapshot as degraded with a graph-level diagnostic', () => {
        const node = {
            id: 'node-1',
            relPath: 'src/a.ts',
            source: 'repo',
            kind: 'source' as const,
            language: 'typescript',
            category: 'code',
            categoryOrigin: 'parent-dir' as const,
            content: null,
            loc: 12,
            cptDefs: [],
            cptUses: [],
            label: 'a.ts',
            position: { x: 10, y: 20 },
            location: { workspaceId: 'ws', repositoryId: 'repo', repositoryRelativePath: 'src/a.ts' }
        };
        const response = {
            status: {
                schemaVersion: 2,
                serviceInstanceId: 'instance-a',
                workspaceId: 'ws',
                repositoryId: 'repo',
                state: 'failed' as const,
                revision: 'rev',
                lastIndexedAt: '2026-07-30T00:00:00.000Z',
                sequence: 2,
                stale: true,
                errorMessage: 'cfs map timed out after 60000ms'
            },
            snapshot: makeSnapshot({ nodes: [node], stale: true }),
            notModified: false
        };
        class FakeController {
            readonly onDidChange = () => ({ dispose() {} });
            getViewModel = () => ({ nodes: response.snapshot.nodes, edges: [], highlightedNodeIds: new Set<string>() });
            getDirtyFiles = () => [];
            getVisibleDiagnostics = () => response.snapshot.diagnostics;
            getState = () => ({
                version: 2 as const,
                mode: 'all' as const,
                search: '',
                category: '',
                source: '',
                showDiagnosticsOnly: false,
                neighborhoodOnly: true
            });
            getSelectedNode = () => undefined;
            getActiveRepository = () => ({ label: 'fabric-poc' });
            getStatus = () => response.status;
            getSnapshot = () => response.snapshot;
            getErrorMessage = () => response.status.errorMessage;
            getOpenErrorMessage = () => undefined;
            isLoading = () => false;
        }
        const container = new Container();
        container.bind(WorkspaceGraphWidget).toSelf();
        container.bind(WorkspaceGraphFrontendController).toConstantValue(new FakeController() as never);
        container.bind(require('./graph-open-handler').GraphOpenHandler).toConstantValue({ openNode: jest.fn() } as never);
        let widget: WorkspaceGraphWidget;
        React.act(() => {
            widget = container.resolve(WorkspaceGraphWidget);
            MessageLoop.flush();
        });
        expect(widget!.node.querySelector('[data-testid="react-flow"]')).not.toBeNull();
        expect(widget!.node.querySelector('[data-testid="graph-flow-node"]')?.textContent).toContain('a.ts');
        expect(widget!.node.querySelector('[data-testid="workspace-graph-error"]')).toBeNull();
        const diagnosticsRegion = widget!.node.querySelector('[data-testid="workspace-graph-global-diagnostics"]');
        expect(diagnosticsRegion?.textContent).toContain('map-failed');
        expect(diagnosticsRegion?.textContent).toContain('Showing the last successful graph snapshot');
        expect(diagnosticsRegion?.textContent).toContain('cfs map timed out after 60000ms');
        React.act(() => {
            widget!.dispose();
            MessageLoop.flush();
        });
    });

    it('renders accessible category bucket rectangles from the snapshot contract', () => {
        const snapshot = makeSnapshot({
            bucketRects: {
                code: { id: 'code', x: 20, y: 30, w: 480, h: 260, label: 'Code' }
            }
        });
        class FakeController {
            readonly onDidChange = () => ({ dispose() {} });
            getViewModel = () => ({ nodes: [], edges: [], highlightedNodeIds: new Set<string>() });
            getDirtyFiles = () => [];
            getVisibleDiagnostics = () => [];
            getState = () => ({
                version: 2 as const,
                mode: 'all' as const,
                search: '',
                category: '',
                source: '',
                showDiagnosticsOnly: false,
                neighborhoodOnly: true
            });
            getSelectedNode = () => undefined;
            getActiveRepository = () => ({ label: 'fabric-poc' });
            getStatus = () => ({ state: 'ready' as const });
            getSnapshot = () => snapshot;
            getErrorMessage = () => undefined;
            getOpenErrorMessage = () => undefined;
            isLoading = () => false;
        }
        const container = new Container();
        container.bind(WorkspaceGraphWidget).toSelf();
        container.bind(WorkspaceGraphFrontendController).toConstantValue(new FakeController() as never);
        container.bind(require('./graph-open-handler').GraphOpenHandler).toConstantValue({ openNode: jest.fn() } as never);
        let widget: WorkspaceGraphWidget;
        React.act(() => {
            widget = container.resolve(WorkspaceGraphWidget);
            MessageLoop.flush();
        });
        const bucket = widget!.node.querySelector('[data-testid="graph-category-bucket"]');
        expect(bucket?.getAttribute('role')).toBe('group');
        expect(bucket?.getAttribute('aria-label')).toBe('Category bucket Code');
        expect(bucket?.textContent).toBe('Code');
        React.act(() => {
            widget!.dispose();
            MessageLoop.flush();
        });
    });

    it('renders a valid-snapshot empty state instead of a blank canvas', () => {
        const snapshot: WorkspaceGraphSnapshot = {
            schemaVersion: 2,
            mapVersion: '1.0',
            workspaceId: 'ws',
            revision: 'rev',
            repositories: [],
            primarySource: 'repo',
            sources: [],
            nodes: [],
            edges: [],
            danglingCptUses: [],
            categories: {},
            bucketRects: {},
            categoryBands: {},
            diagnostics: [],
            indexedAt: '2026-07-30T00:00:00.000Z',
            stale: false
        };
        class FakeController {
            readonly onDidChange = () => ({ dispose() {} });
            getViewModel = () => ({ nodes: [], edges: [], highlightedNodeIds: new Set<string>() });
            getDirtyFiles = () => [];
            getVisibleDiagnostics = () => [];
            getState = () => ({
                version: 2 as const,
                mode: 'all' as const,
                search: '',
                category: '',
                source: '',
                showDiagnosticsOnly: false,
                neighborhoodOnly: true
            });
            getSelectedNode = () => undefined;
            getActiveRepository = () => ({ label: 'fabric-poc' });
            getStatus = () => ({ state: 'ready' });
            getSnapshot = () => snapshot;
            getErrorMessage = () => undefined;
            getOpenErrorMessage = () => undefined;
            isLoading = () => false;
        }
        const container = new Container();
        container.bind(WorkspaceGraphWidget).toSelf();
        container.bind(WorkspaceGraphFrontendController).toConstantValue(new FakeController() as never);
        container.bind(require('./graph-open-handler').GraphOpenHandler).toConstantValue({ openNode: jest.fn() } as never);
        let widget: WorkspaceGraphWidget;
        React.act(() => {
            widget = container.resolve(WorkspaceGraphWidget);
            MessageLoop.flush();
        });
        expect(widget!.node.querySelector('[data-testid="workspace-graph-filtered-empty"]')?.textContent)
            .toContain('workspace graph is empty');
        React.act(() => {
            widget!.dispose();
            MessageLoop.flush();
        });
    });

    it('keeps location-only graph diagnostics visible and actionable in diagnostics-only mode', () => {
        const snapshot: WorkspaceGraphSnapshot = {
            schemaVersion: 2,
            mapVersion: '1.0',
            workspaceId: 'ws',
            revision: 'rev',
            repositories: [],
            primarySource: 'repo',
            sources: [],
            nodes: [{
                id: 'node-1',
                relPath: 'src/a.ts',
                source: 'repo',
                kind: 'source',
                language: 'typescript',
                category: 'code',
                categoryOrigin: 'parent-dir',
                content: null,
                loc: 12,
                cptDefs: [],
                cptUses: [],
                label: 'a.ts',
                position: { x: 10, y: 20 },
                location: {
                    workspaceId: 'ws',
                    repositoryId: 'repo',
                    repositoryRelativePath: 'src/a.ts'
                }
            }],
            edges: [],
            danglingCptUses: [],
            categories: {},
            bucketRects: {},
            categoryBands: {},
            diagnostics: [{
                id: 'global-1',
                code: 'unknown-source',
                severity: 'warning',
                message: 'Configured source could not be resolved.',
                location: {
                    workspaceId: 'ws',
                    repositoryId: 'repo',
                    repositoryRelativePath: 'config/sources.toml'
                }
            }],
            indexedAt: '2026-07-30T00:00:00.000Z',
            stale: false
        };
        const resetFilters = jest.fn();
        class FakeController {
            readonly onDidChange = () => ({ dispose() {} });
            getViewModel = () => ({ nodes: [], edges: [], highlightedNodeIds: new Set<string>() });
            getDirtyFiles = () => [];
            getVisibleDiagnostics = () => snapshot.diagnostics;
            getState = () => ({
                version: 2 as const,
                mode: 'all' as const,
                search: '',
                category: '',
                source: '',
                showDiagnosticsOnly: true,
                neighborhoodOnly: true
            });
            getSelectedNode = () => undefined;
            getActiveRepository = () => ({ label: 'fabric-poc' });
            getStatus = () => ({ state: 'ready' });
            getSnapshot = () => snapshot;
            getErrorMessage = () => undefined;
            getOpenErrorMessage = () => undefined;
            isLoading = () => false;
            resetFilters = resetFilters;
        }
        const container = new Container();
        container.bind(WorkspaceGraphWidget).toSelf();
        container.bind(WorkspaceGraphFrontendController).toConstantValue(new FakeController() as never);
        container.bind(require('./graph-open-handler').GraphOpenHandler).toConstantValue({ openNode: jest.fn() } as never);
        let widget: WorkspaceGraphWidget;
        React.act(() => {
            widget = container.resolve(WorkspaceGraphWidget);
            MessageLoop.flush();
        });
        const diagnosticsRegion = widget!.node.querySelector('[data-testid="workspace-graph-global-diagnostics"]');
        expect(diagnosticsRegion?.getAttribute('aria-labelledby')).toBe('workspace-graph-global-diagnostics-title');
        expect(diagnosticsRegion?.textContent).toContain('unknown-source');
        expect(diagnosticsRegion?.textContent).toContain('Configured source could not be resolved.');
        expect(diagnosticsRegion?.textContent).toContain('repo:config/sources.toml');
        expect(widget!.node.querySelector('[data-testid="workspace-graph-filtered-empty"]')?.textContent)
            .toContain('No node-linked diagnostics');
        expect(widget!.node.querySelector('[data-testid="workspace-graph-filtered-empty"]')?.textContent)
            .toContain('Graph-level diagnostics are listed above');
        const showAll = widget!.node.querySelector('[data-testid="workspace-graph-global-diagnostics-show-all"]') as HTMLButtonElement;
        expect(showAll).not.toBeNull();
        React.act(() => {
            showAll.click();
        });
        expect(resetFilters).toHaveBeenCalledTimes(1);
        React.act(() => {
            widget!.dispose();
            MessageLoop.flush();
        });
    });
});
