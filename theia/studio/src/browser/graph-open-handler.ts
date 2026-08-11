import { injectable, inject } from '@theia/core/shared/inversify';
import { open, OpenerService, type WidgetOpenerOptions } from '@theia/core/lib/browser';
import type { EditorOpenerOptions } from '@theia/editor/lib/browser/editor-manager';
import URI from '@theia/core/lib/common/uri';
import { StudioRuntimeService, type StudioRepositoryDescriptor } from '../common/studio-protocol';
import type { WorkspaceGraphNode } from '../common/graph-model';
import { GitOperationsFrontendController } from './git-operations-contribution';

@injectable()
export class GraphOpenHandler {
    @inject(OpenerService)
    protected readonly openerService: OpenerService;

    @inject(StudioRuntimeService)
    protected readonly runtimeService: StudioRuntimeService;

    @inject(GitOperationsFrontendController)
    protected readonly gitOperationsController: GitOperationsFrontendController;

    async openNode(node: WorkspaceGraphNode): Promise<void> {
        if (node.kind === 'phantom-cpt' || !node.relPath) {
            throw new Error(`Graph node '${node.id}' does not represent an openable workspace file.`);
        }
        const repository = this.gitOperationsController.getRepositories().find(candidate => candidate.repositoryId === node.location.repositoryId);
        if (!repository) {
            throw new Error(`Unknown repository '${node.location.repositoryId}'.`);
        }
        const targetUri = await this.resolveNodeUri(repository, node.location.repositoryRelativePath);
        const firstReferenceLine = node.cptUses[0]?.line;
        const options = toEditorSelection(firstReferenceLine ? `${node.id}:${firstReferenceLine}` : undefined);
        await open(this.openerService, targetUri, options);
    }

    async resolveNodeUri(repository: StudioRepositoryDescriptor, repositoryRelativePath: string): Promise<URI> {
        const relativePath = validateRepositoryRelativePath(repositoryRelativePath);
        const workspaceRelativePath = repository.workspaceRelativeRoot
            ? `${repository.workspaceRelativeRoot}/${relativePath}`.replace(/^\/+/, '')
            : relativePath;
        const location = await this.runtimeService.resolveWorkspacePath({
            relativePath: workspaceRelativePath,
            requireExists: true
        });
        if (!location.exists || location.isDirectory) {
            throw new Error(`Verified file target does not exist: ${repositoryRelativePath}`);
        }
        if (!location.repositoryRootUri) {
            throw new Error(`Workspace path '${repositoryRelativePath}' did not resolve to a repository root URI.`);
        }
        if (location.repositoryId !== repository.repositoryId) {
            throw new Error(`Workspace path '${repositoryRelativePath}' resolved to repository '${location.repositoryId ?? 'unknown'}', expected '${repository.repositoryId}'.`);
        }
        if (validateRepositoryRelativePath(location.repositoryRelativePath) !== relativePath) {
            throw new Error(`Workspace path '${repositoryRelativePath}' resolved to mismatched repository path '${location.repositoryRelativePath}'.`);
        }
        const rootUri = new URI(location.repositoryRootUri).normalizePath();
        const expectedRootUri = new URI(repository.rootUri).normalizePath();
        if (rootUri.toString() !== expectedRootUri.toString()) {
            throw new Error(`Workspace path '${repositoryRelativePath}' resolved to mismatched repository root '${rootUri.toString()}'.`);
        }
        return rootUri.resolve(relativePath);
    }
}

export function validateRepositoryRelativePath(repositoryRelativePath: string): string {
    if (!repositoryRelativePath || repositoryRelativePath.startsWith('/') || repositoryRelativePath.includes('\\')) {
        throw new Error(`Invalid repository-relative file path: ${repositoryRelativePath}`);
    }
    const segments = repositoryRelativePath.split('/');
    if (segments.some(segment => segment === '' || segment === '.' || segment === '..')) {
        throw new Error(`Path traversal is not allowed: ${repositoryRelativePath}`);
    }
    return segments.join('/');
}

export function toEditorSelection(objectKey: string | undefined): WidgetOpenerOptions | EditorOpenerOptions | undefined {
    if (!objectKey) {
        return undefined;
    }
    const match = /:(\d+)(?::(\d+))?$/.exec(objectKey);
    if (!match) {
        return undefined;
    }
    const line = Number(match[1]);
    const column = match[2] ? Number(match[2]) : 1;
    if (!Number.isInteger(line) || !Number.isInteger(column) || line < 1 || column < 1) {
        return undefined;
    }
    return {
        selection: {
            start: { line: line - 1, character: column - 1 },
            end: { line: line - 1, character: column - 1 }
        }
    };
}
