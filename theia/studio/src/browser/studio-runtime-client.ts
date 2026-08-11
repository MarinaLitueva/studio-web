import { inject, injectable } from '@theia/core/shared/inversify';
import {
    type StudioAuditEntry,
    type StudioOperationEvent,
    type StudioRepositoryDescriptor,
    type StudioRuntimeClient
} from '../common/studio-protocol';
import { AuditFrontendController } from './audit-controller';
import { GitOperationsFrontendController } from './git-operations-contribution';
import { WorkspaceSourcesFrontendController } from './workspace-sources-controller';

/**
 * The single JSON-RPC client for the Studio runtime connection.
 *
 * Theia's watcher pattern uses one client object per service proxy. This
 * dispatcher keeps the Git and Audit browser controllers independent while
 * ensuring that both receive notifications from the same backend connection.
 */
@injectable()
export class StudioRuntimeFrontendClient implements StudioRuntimeClient {
    constructor(
        @inject(GitOperationsFrontendController)
        protected readonly gitOperations: GitOperationsFrontendController,
        @inject(AuditFrontendController)
        protected readonly audit: AuditFrontendController,
        @inject(WorkspaceSourcesFrontendController)
        protected readonly workspaceSources: WorkspaceSourcesFrontendController
    ) {}

    onOperationEvent(event: StudioOperationEvent): void {
        this.gitOperations.onOperationEvent(event);
    }

    onAuditEvent(entry: StudioAuditEntry): void {
        this.audit.onAuditEvent(entry);
    }

    onRepositoriesChanged(repositories: readonly StudioRepositoryDescriptor[]): void {
        this.gitOperations.onRepositoriesChanged(repositories);
    }

    onWorkspaceSnapshotChanged(snapshot: Parameters<WorkspaceSourcesFrontendController['onWorkspaceSnapshotChanged']>[0]): void {
        this.workspaceSources.onWorkspaceSnapshotChanged(snapshot);
    }

    onWorkspaceActivityEvent(event: Parameters<WorkspaceSourcesFrontendController['onWorkspaceActivityEvent']>[0]): void {
        this.workspaceSources.onWorkspaceActivityEvent(event);
    }
}
