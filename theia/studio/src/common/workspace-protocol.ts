export const WORKSPACE_PROTOCOL_SCHEMA_VERSION = 1;

export type WorkspaceConfigMode = 'legacy' | 'single-folder' | 'canonical-shadow' | 'canonical-active';
export type WorkspaceOperationalState = 'idle' | 'loading' | 'ready' | 'saving' | 'syncing' | 'scan-preview' | 'conflicted' | 'failed';
export type WorkspaceDiagnosticSeverity = 'info' | 'warning' | 'error';
export type WorkspaceDiagnosticScope = 'config' | 'source' | 'sync' | 'scan' | 'migration' | 'runtime';
export type WorkspaceSourceProvider = 'github' | 'gitlab' | 'bitbucket' | 'azure-devops' | 'generic-git' | 'local';
export type WorkspaceSourceStatus =
    | 'present'
    | 'missing'
    | 'duplicate'
    | 'nested'
    | 'dirty'
    | 'diverged'
    | 'ahead'
    | 'behind'
    | 'blocked'
    | 'auth-required';
export type WorkspaceSourceSyncEligibility =
    | 'safe'
    | 'requires-trust'
    | 'requires-force'
    | 'blocked'
    | 'not-configured';
export type WorkspaceSyncPhase =
    | 'queued'
    | 'preflight'
    | 'trust-preview'
    | 'awaiting-confirmation'
    | 'saving-config'
    | 'syncing-sources'
    | 'completed'
    | 'cancelled'
    | 'failed';
export type WorkspaceSyncState =
    | 'queued'
    | 'preview'
    | 'awaiting-confirmation'
    | 'running'
    | 'completed'
    | 'cancelled'
    | 'failed';
export type WorkspaceJobKind = 'save-sync' | 'source-sync' | 'scan-preview' | 'migration';
export type WorkspaceJobState = 'queued' | 'running' | 'awaiting-confirmation' | 'completed' | 'cancelled' | 'failed';
export type WorkspaceMigrationStatus = 'not-needed' | 'pending' | 'in-progress' | 'recovering' | 'rolled-back' | 'completed' | 'failed';
export type WorkspaceMigrationSourceKind = 'legacy-config' | 'inline-core';
export type WorkspaceSuggestionKind = 'containing-repository' | 'scan-candidate' | 'deduplicated-candidate';
export type WorkspaceSuggestionDisposition = 'new' | 'ignored-locally' | 'deduplicated' | 'already-configured';
export type WorkspaceConflictCode = 'revision-mismatch' | 'invalid-request' | 'source-conflict' | 'confirmation-required';

export interface WorkspaceConfigIdentity {
    readonly workspaceId: string;
    readonly configPath: string;
    readonly configFileName: '.cf-workspace.toml';
}

export interface WorkspaceConfigState {
    readonly revision: string;
    readonly schemaVersion: typeof WORKSPACE_PROTOCOL_SCHEMA_VERSION;
    readonly rawTomlAvailable: boolean;
    readonly resolveWorkdir?: string;
    readonly resolveNamespace?: Readonly<Record<string, string>>;
    readonly resolveRootUri?: string;
    readonly canonicalResolveRootUri?: string;
    readonly lastLoadedAt?: string;
    readonly lastSavedAt?: string;
}

export interface WorkspaceDiagnostic {
    readonly code: string;
    readonly severity: WorkspaceDiagnosticSeverity;
    readonly scope: WorkspaceDiagnosticScope;
    readonly message: string;
    readonly sourceId?: string;
    readonly path?: string;
}

export interface WorkspaceSourceReference {
    readonly sourceId: string;
    readonly label: string;
    readonly localPath: string;
    readonly ref?: string;
    readonly remoteUrl?: string;
    readonly provider?: WorkspaceSourceProvider;
    readonly defaultBranch?: string;
}

export interface WorkspaceConfiguredSource extends WorkspaceSourceReference {
    readonly configured: true;
    readonly authoritative: true;
    readonly include: 'member';
}

export interface WorkspaceObservedSourceState {
    readonly sourceId: string;
    readonly status: WorkspaceSourceStatus;
    readonly syncEligibility: WorkspaceSourceSyncEligibility;
    readonly isPresent: boolean;
    readonly isDirty: boolean;
    readonly isDiverged: boolean;
    readonly isNested: boolean;
    readonly hasBlockingIssue: boolean;
    readonly blockedReason?: string;
    readonly currentRevision?: string;
    readonly aheadCount?: number;
    readonly behindCount?: number;
}

export interface WorkspaceScanCandidate {
    readonly candidateId: string;
    readonly label: string;
    readonly localPath: string;
    readonly rootPath: string;
    readonly provider?: WorkspaceSourceProvider;
    readonly remoteUrl?: string;
    readonly ref?: string;
    readonly containingRepositoryId?: string;
    readonly ignoredLocally: boolean;
    readonly deduplicatedByCandidateId?: string;
    readonly duplicateOfConfiguredSourceId?: string;
}

export interface WorkspaceScanPreview {
    readonly requestId: string;
    readonly generatedAt: string;
    readonly rootsScanned: readonly string[];
    readonly bounded: true;
    readonly maxDepth: number;
    readonly maxEntries: number;
    readonly candidates: readonly WorkspaceScanCandidate[];
    readonly diagnostics: readonly WorkspaceDiagnostic[];
}

export interface WorkspaceRepositorySuggestion {
    readonly suggestionId: string;
    readonly kind: WorkspaceSuggestionKind;
    readonly candidateId: string;
    readonly sourceId?: string;
    readonly label: string;
    readonly localPath: string;
    readonly rootPath: string;
    readonly disposition: WorkspaceSuggestionDisposition;
    readonly reason: string;
}

export interface WorkspaceSyncTrustPreview {
    readonly jobId: string;
    readonly requiresConfirmation: boolean;
    readonly saveConfig: boolean;
    readonly impactedSourceIds: readonly string[];
    readonly reasons: readonly string[];
}

export interface WorkspaceSourceSyncPreview {
    readonly sourceId: string;
    readonly status: WorkspaceSourceStatus;
    readonly eligibility: WorkspaceSourceSyncEligibility;
    readonly forceRequired: boolean;
    readonly expectedRevision?: string;
    readonly expectedRemoteRevision?: string;
    readonly aheadCount?: number;
    readonly behindCount?: number;
    readonly blockedReason?: string;
    readonly confirmationMessage?: string;
}

export interface WorkspaceSyncProgress {
    readonly completedSources: number;
    readonly totalSources: number;
    readonly activeSourceId?: string;
}

export interface WorkspaceSyncError {
    readonly code: string;
    readonly message: string;
    readonly sourceId?: string;
    readonly retryable: boolean;
}

export interface WorkspaceJobActivity {
    readonly jobId: string;
    readonly kind: WorkspaceJobKind;
    readonly state: WorkspaceJobState;
    readonly phase: WorkspaceSyncPhase;
    readonly startedAt: string;
    readonly updatedAt: string;
    readonly progress?: WorkspaceSyncProgress;
    readonly preview?: WorkspaceSyncTrustPreview;
    readonly sourcePreviews?: readonly WorkspaceSourceSyncPreview[];
    readonly lastError?: WorkspaceSyncError;
}

export interface WorkspaceMigrationState {
    readonly mode: WorkspaceConfigMode;
    readonly status: WorkspaceMigrationStatus;
    readonly transactionId?: string;
    readonly recoveryState?: 'none' | 'available' | 'active';
    readonly rollbackAvailable: boolean;
    readonly rollbackReason?: string;
}

export interface WorkspaceSnapshot {
    readonly schemaVersion: typeof WORKSPACE_PROTOCOL_SCHEMA_VERSION;
    readonly identity: WorkspaceConfigIdentity;
    readonly config: WorkspaceConfigState;
    readonly state: WorkspaceOperationalState;
    readonly configuredSources: readonly WorkspaceConfiguredSource[];
    readonly observedSources: readonly WorkspaceObservedSourceState[];
    readonly suggestions: readonly WorkspaceRepositorySuggestion[];
    readonly latestScan?: WorkspaceScanPreview;
    readonly jobs: readonly WorkspaceJobActivity[];
    readonly migration: WorkspaceMigrationState;
    readonly diagnostics: readonly WorkspaceDiagnostic[];
}

export interface WorkspaceSnapshotRequest {
    readonly workspaceId?: string;
    readonly configPath?: string;
    readonly knownRevision?: string;
}

export interface WorkspaceSnapshotResponse {
    readonly schemaVersion: typeof WORKSPACE_PROTOCOL_SCHEMA_VERSION;
    readonly snapshot: WorkspaceSnapshot;
    readonly notModified: boolean;
}

export interface CreateWorkspaceConfigRequest {
    readonly workspaceId: string;
    readonly configPath: string;
    readonly revisionToken?: string;
    readonly sources: readonly WorkspaceConfiguredSource[];
    readonly sync?: WorkspacePostMutationSyncRequest;
}

export interface UpdateWorkspaceConfigRequest {
    readonly workspaceId?: string;
    readonly configPath?: string;
    readonly expectedRevision: string;
    readonly source: WorkspaceConfiguredSource;
    readonly sync?: WorkspacePostMutationSyncRequest;
}

export interface RemoveWorkspaceSourceRequest {
    readonly workspaceId?: string;
    readonly configPath?: string;
    readonly expectedRevision: string;
    readonly sourceId: string;
    readonly sync?: WorkspacePostMutationSyncRequest;
}

export interface RenameWorkspaceSourceRequest {
    readonly workspaceId?: string;
    readonly configPath?: string;
    readonly expectedRevision: string;
    readonly sourceId: string;
    readonly nextSourceId: string;
    readonly confirmedImpactIds?: readonly string[];
    readonly sync?: WorkspacePostMutationSyncRequest;
}

export type RenameWorkspaceRequest = RenameWorkspaceSourceRequest;

export interface SaveWorkspaceRawTomlRequest {
    readonly workspaceId?: string;
    readonly configPath?: string;
    readonly expectedRevision: string;
    readonly rawToml: string;
    readonly sync?: WorkspacePostMutationSyncRequest;
}

export interface ReadWorkspaceRawTomlRequest {
    readonly workspaceId?: string;
    readonly configPath?: string;
}

export interface ReadWorkspaceRawTomlResponse {
    readonly schemaVersion: typeof WORKSPACE_PROTOCOL_SCHEMA_VERSION;
    readonly configPath: string;
    readonly revision: string;
    readonly rawToml?: string;
    readonly diagnostics: readonly WorkspaceDiagnostic[];
}

export interface WorkspaceConfigConflict {
    readonly code: WorkspaceConflictCode;
    readonly message: string;
    readonly currentRevision?: string;
    readonly diagnostics: readonly WorkspaceDiagnostic[];
    readonly impacts?: readonly WorkspaceSourceRenameImpactPreview[];
}

export interface WorkspaceSourceRenameImpact {
    readonly impactId: string;
    readonly sourceId: string;
    readonly nextSourceId: string;
    readonly line: number;
    readonly column: number;
    readonly excerpt: string;
    readonly reason: string;
    readonly confirmed: boolean;
}

export interface WorkspaceSourceRenameImpactRange {
    readonly start: number;
    readonly end: number;
    readonly line: number;
    readonly column: number;
}

export interface WorkspaceSourceRenameImpactPreview {
    readonly impactId: string;
    readonly sourceId: string;
    readonly nextSourceId: string;
    readonly path: string;
    readonly evidence: string;
    readonly range: WorkspaceSourceRenameImpactRange;
    readonly confirmed: boolean;
    readonly requiresExplicitEdit: boolean;
}

export interface WorkspaceConfigMutationResponse {
    readonly schemaVersion: typeof WORKSPACE_PROTOCOL_SCHEMA_VERSION;
    readonly snapshot: WorkspaceSnapshot;
    readonly conflict?: WorkspaceConfigConflict;
    readonly sync?: WorkspaceSyncResponse;
}

export interface WorkspaceMigrationSourceEntry {
    readonly path?: string;
    readonly adapter?: string;
    readonly role?: 'artifacts' | 'codebase' | 'kits' | 'full';
    readonly url?: string;
    readonly branch?: string;
}

export interface WorkspaceMigrationNormalizedConfig {
    readonly version: string;
    readonly sources: Readonly<Record<string, WorkspaceMigrationSourceEntry>>;
    readonly traceability?: Readonly<Record<string, boolean>>;
    readonly resolve?: {
        readonly workdir?: string;
        readonly namespace?: Readonly<Record<string, string>>;
    };
    readonly validation?: {
        readonly allowed_content_languages?: readonly string[];
    };
}

export interface WorkspaceMigrationPreview {
    readonly sourceKind: WorkspaceMigrationSourceKind;
    readonly sourcePath: string;
    readonly targetPath: string;
    readonly modeBefore: WorkspaceConfigMode;
    readonly modeAfter: WorkspaceConfigMode;
    readonly payloadHash: string;
    readonly normalizedConfig: WorkspaceMigrationNormalizedConfig;
    readonly rawCanonicalToml: string;
    readonly diagnostics: readonly WorkspaceDiagnostic[];
}

export interface WorkspaceMigrationDifference {
    readonly kind: 'missing-in-source' | 'missing-in-canonical' | 'field-mismatch' | 'diagnostic-mismatch';
    readonly sourceId?: string;
    readonly field?: 'path' | 'url' | 'branch' | 'role' | 'adapter';
    readonly legacyValue?: string;
    readonly canonicalValue?: string;
    readonly message: string;
}

export interface WorkspaceMigrationComparison {
    readonly clean: boolean;
    readonly differenceHash: string;
    readonly acknowledgedDifferenceHash?: string;
    readonly sourceKind: WorkspaceMigrationSourceKind;
    readonly sourcePath: string;
    readonly targetPath: string;
    readonly differences: readonly WorkspaceMigrationDifference[];
    readonly diagnostics: readonly WorkspaceDiagnostic[];
}

export interface WorkspaceMigrationStatusResponse {
    readonly schemaVersion: typeof WORKSPACE_PROTOCOL_SCHEMA_VERSION;
    readonly migration: WorkspaceMigrationState;
    readonly diagnostics: readonly WorkspaceDiagnostic[];
    readonly preview?: WorkspaceMigrationPreview;
    readonly comparison?: WorkspaceMigrationComparison;
}

export interface WorkspaceMigrationRequest {
    readonly workspaceId?: string;
    readonly configPath?: string;
}

export interface WorkspaceMigrationRollbackRequest extends WorkspaceMigrationRequest {
    readonly transactionId: string;
}

export interface WorkspaceMigrationActivateRequest extends WorkspaceMigrationRequest {
    readonly acknowledgedDifferenceHash?: string;
}

export interface WorkspaceScanRequest {
    readonly workspaceId?: string;
    readonly configPath?: string;
    readonly roots: readonly string[];
    readonly maxDepth: number;
    readonly maxEntries: number;
}

export interface WorkspaceScanResponse {
    readonly schemaVersion: typeof WORKSPACE_PROTOCOL_SCHEMA_VERSION;
    readonly preview: WorkspaceScanPreview;
    readonly suggestions: readonly WorkspaceRepositorySuggestion[];
}

export interface StartWorkspaceSyncRequest {
    readonly workspaceId?: string;
    readonly configPath?: string;
    readonly expectedRevision: string;
    readonly sourceIds?: readonly string[];
    readonly trustConfirmed?: boolean;
    readonly forceSourceIds?: readonly string[];
}

export interface ConfirmWorkspaceSyncRequest {
    readonly workspaceId?: string;
    readonly configPath?: string;
    readonly jobId: string;
    readonly trustConfirmed: boolean;
    readonly expectedRevision?: string;
    readonly forceSourceIds?: readonly string[];
}

export interface CancelWorkspaceJobRequest {
    readonly workspaceId?: string;
    readonly configPath?: string;
    readonly jobId: string;
}

export interface RetryWorkspaceJobRequest {
    readonly workspaceId?: string;
    readonly configPath?: string;
    readonly jobId: string;
    readonly trustConfirmed?: boolean;
    readonly expectedRevision?: string;
    readonly forceSourceIds?: readonly string[];
}

export interface WorkspacePostMutationSyncRequest {
    readonly sourceIds?: readonly string[];
    readonly trustConfirmed?: boolean;
    readonly forceSourceIds?: readonly string[];
}

export interface WorkspaceSyncResponse {
    readonly schemaVersion: typeof WORKSPACE_PROTOCOL_SCHEMA_VERSION;
    readonly job: WorkspaceJobActivity;
    readonly snapshot: WorkspaceSnapshot;
}

export interface WorkspaceActivityEvent {
    readonly schemaVersion: typeof WORKSPACE_PROTOCOL_SCHEMA_VERSION;
    readonly eventId: string;
    readonly job: WorkspaceJobActivity;
    readonly snapshotRevision: string;
}

export interface DetectContainingWorkspaceRepositoryRequest {
    readonly workspaceId?: string;
    readonly configPath?: string;
    readonly openedPath: string;
}

export interface UpdateWorkspaceSuggestionRequest {
    readonly workspaceId?: string;
    readonly configPath?: string;
    readonly candidateId: string;
    readonly rootPath: string;
}
