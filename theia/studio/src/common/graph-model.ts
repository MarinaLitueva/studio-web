import type { RpcServer } from '@theia/core/lib/common/messaging/proxy-factory';

export const workspaceGraphServicePath = '/services/workspace-graph';
export const WorkspaceGraphService = Symbol('WorkspaceGraphService');
export const GRAPH_SCHEMA_VERSION = 2;
export const CFS_MAP_SCHEMA_VERSION = '1.0';

export type GraphNodeKind = 'markdown' | 'source' | 'phantom-cpt';
export type GraphCategoryOrigin = 'override' | 'registry' | 'parent-dir' | 'phantom';
export type GraphEdgeKind = 'file-link' | 'cpt-doc' | 'cpt-impl';
export type GraphSourceRole = 'artifacts' | 'codebase' | 'kits' | 'full';
export type GraphMarkerKind = 'scope' | 'block-begin' | 'block-end' | 'md-ref' | 'md-def';
export type GraphDiagnosticCode =
    | 'binary'
    | 'ignored'
    | 'malformed'
    | 'oversized'
    | 'traversal'
    | 'unknown-file-type'
    | 'unresolved-link'
    | 'unknown-source'
    | 'invalid-output'
    | 'command-unavailable'
    | 'timeout'
    | 'map-failed'
    | 'cache-invalid';
export type GraphRefreshState = 'idle' | 'indexing' | 'ready' | 'failed';

export interface WorkspaceGraphLocation {
    readonly workspaceId: string;
    readonly repositoryId: string;
    readonly repositoryRelativePath: string;
}

export interface WorkspaceGraphPosition {
    readonly x: number;
    readonly y: number;
}

export interface WorkspaceGraphCptUse {
    readonly cptId: string;
    readonly line: number;
    readonly snippet: string;
    readonly markerKind: GraphMarkerKind;
}

/**
 * A lossless browser DTO for a cfs map v1 node. `label`, `location`, and the
 * optional `position` are backend-derived presentation/navigation data; the
 * remaining fields preserve the canonical map contract.
 */
export interface WorkspaceGraphNode {
    readonly id: string;
    readonly relPath: string | null;
    readonly source: string | null;
    readonly kind: GraphNodeKind;
    readonly language: string | null;
    readonly category: string;
    readonly categoryOrigin: GraphCategoryOrigin;
    readonly content: string | null;
    readonly loc: number;
    readonly cptDefs: readonly string[];
    readonly cptUses: readonly WorkspaceGraphCptUse[];
    readonly label: string;
    readonly location: WorkspaceGraphLocation;
    readonly position?: WorkspaceGraphPosition;
}

export interface WorkspaceGraphEdgeRef {
    readonly cptId: string | null;
    readonly line: number;
    readonly snippet: string;
    readonly defLine: number | null;
    readonly defSnippet: string | null;
}

export interface WorkspaceGraphEdge {
    readonly id: string;
    readonly from: string;
    readonly to: string;
    readonly type: GraphEdgeKind;
    readonly refs: readonly WorkspaceGraphEdgeRef[];
    readonly crossRepo: boolean;
    readonly dangling: boolean;
}

export interface WorkspaceGraphDanglingCptUse {
    readonly cptId: string;
    readonly nodeId: string;
    readonly line: number;
    readonly snippet: string;
}

export interface WorkspaceGraphSource {
    readonly name: string;
    readonly path: string;
    readonly reachable: boolean;
    readonly role: GraphSourceRole;
}

export interface WorkspaceGraphCategoryStyle {
    readonly color: string;
    readonly background: string;
}

export interface WorkspaceGraphCategory {
    readonly nodeCount: number;
    readonly originCounts: Readonly<Partial<Record<GraphCategoryOrigin, number>>>;
    readonly style: WorkspaceGraphCategoryStyle;
}

export interface WorkspaceGraphCategoryBand {
    readonly x: number;
    readonly y: number;
    readonly w: number;
    readonly h: number;
    readonly label: string;
    readonly fill?: string;
    readonly stroke?: string;
    readonly titleColor?: string;
}

export interface WorkspaceGraphBucketRect {
    readonly id: string;
    readonly x: number;
    readonly y: number;
    readonly w: number;
    readonly h: number;
    readonly label: string;
}

export interface WorkspaceGraphDiagnostic {
    readonly id: string;
    readonly code: GraphDiagnosticCode;
    readonly severity: 'warning' | 'error';
    readonly message: string;
    readonly location?: WorkspaceGraphLocation;
    readonly relatedNodeId?: string;
}

export interface WorkspaceGraphRepositoryRevision {
    readonly repositoryId: string;
    readonly commitSha: string;
}

/**
 * Version 2 is deliberately narrow: it carries canonical cfs map v1 graph
 * semantics and only the Theia metadata needed for freshness and navigation.
 */
export interface WorkspaceGraphSnapshotV2 {
    readonly schemaVersion: 2;
    readonly mapVersion: typeof CFS_MAP_SCHEMA_VERSION;
    readonly workspaceId: string;
    readonly revision: string;
    readonly repositories: readonly WorkspaceGraphRepositoryRevision[];
    readonly primarySource: string;
    readonly sources: readonly WorkspaceGraphSource[];
    readonly nodes: readonly WorkspaceGraphNode[];
    readonly edges: readonly WorkspaceGraphEdge[];
    readonly danglingCptUses: readonly WorkspaceGraphDanglingCptUse[];
    readonly categories: Readonly<Record<string, WorkspaceGraphCategory>>;
    readonly bucketRects: Readonly<Record<string, WorkspaceGraphBucketRect>>;
    readonly categoryBands: Readonly<Record<string, WorkspaceGraphCategoryBand>>;
    readonly diagnostics: readonly WorkspaceGraphDiagnostic[];
    readonly indexedAt: string;
    readonly stale: boolean;
}

export type WorkspaceGraphSnapshot = WorkspaceGraphSnapshotV2;

export interface WorkspaceGraphDirtyFile {
    readonly repositoryId: string;
    readonly repositoryRelativePath: string;
    readonly state: 'added' | 'modified' | 'deleted' | 'untracked' | 'renamed' | 'copied' | 'unknown';
}

export interface WorkspaceGraphDirtyOverlay {
    readonly workspaceId: string;
    readonly revision: string;
    readonly files: readonly WorkspaceGraphDirtyFile[];
}

export interface WorkspaceGraphStatus {
    readonly schemaVersion: number;
    readonly serviceInstanceId: string;
    readonly workspaceId: string;
    readonly repositoryId: string;
    readonly state: GraphRefreshState;
    readonly revision?: string;
    readonly lastIndexedAt?: string;
    readonly sequence: number;
    readonly stale?: boolean;
    readonly errorMessage?: string;
}

export interface WorkspaceGraphScopeRequest {
    readonly repositoryId: string;
}

export type WorkspaceGraphRefreshRequest = WorkspaceGraphScopeRequest;

export interface WorkspaceGraphSnapshotRequest extends WorkspaceGraphScopeRequest {
    readonly knownRevision?: string;
}

export interface WorkspaceGraphSnapshotResponse {
    readonly status: WorkspaceGraphStatus;
    readonly snapshot?: WorkspaceGraphSnapshotV2;
    readonly notModified: boolean;
}

export interface WorkspaceGraphClient {
    onWorkspaceGraphStatusChanged(status: WorkspaceGraphStatus): void;
}

export interface WorkspaceGraphService extends RpcServer<WorkspaceGraphClient> {
    getStatus(request: WorkspaceGraphScopeRequest): Promise<WorkspaceGraphStatus>;
    getRepositoryRevisions(request: WorkspaceGraphScopeRequest): Promise<readonly WorkspaceGraphRepositoryRevision[]>;
    refresh(request: WorkspaceGraphRefreshRequest): Promise<WorkspaceGraphStatus>;
    getSnapshot(request: WorkspaceGraphSnapshotRequest): Promise<WorkspaceGraphSnapshotResponse>;
    getDirtyOverlay(request: WorkspaceGraphScopeRequest): Promise<WorkspaceGraphDirtyOverlay>;
}
