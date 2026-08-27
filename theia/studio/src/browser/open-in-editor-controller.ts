import { inject, injectable } from '@theia/core/shared/inversify';
import { ILogger, MessageService } from '@theia/core';
import URI from '@theia/core/lib/common/uri';
import { EditorManager } from '@theia/editor/lib/browser/editor-manager';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import type { StudioOpenInEditorRequest } from '../common/studio-protocol';

/**
 * Opens/reveals a workspace file in the running IDE on behalf of studio-backend
 * and the portal (ADR-0010 openInEditor).
 *
 * The paths come from the artifact graph and are repo-relative (e.g.
 * `.github/workflows/ci.yml`). But the session entrypoint clones each workspace
 * source into `/workspace/<name>`, so a repo-relative path usually lives one
 * level below the workspace root — not at it. We therefore look for the file
 * under every workspace root AND under each root's immediate subdirectories,
 * open the first that exists, and surface a visible message when nothing
 * matches (instead of failing silently) so a missing checkout is diagnosable.
 */
@injectable()
export class OpenInEditorFrontendController {
    @inject(EditorManager)
    protected readonly editorManager!: EditorManager;

    @inject(WorkspaceService)
    protected readonly workspaceService!: WorkspaceService;

    @inject(FileService)
    protected readonly fileService!: FileService;

    @inject(MessageService)
    protected readonly messageService!: MessageService;

    @inject(ILogger)
    protected readonly logger!: ILogger;

    async onOpenInEditor(request: StudioOpenInEditorRequest): Promise<void> {
        const relativePath = (request.relativePath ?? '').replace(/^\/+/, '');
        if (!relativePath) {
            return;
        }

        const roots = await this.workspaceService.roots;
        if (roots.length === 0) {
            this.messageService.warn('Studio: no workspace is open to resolve the file against.');
            return;
        }

        // Candidate 1: directly under each root (the repo IS the root).
        const candidates: URI[] = roots.map(r => r.resource.resolve(relativePath));

        // Candidate 2: under each root's immediate subdirectories (sources are
        // cloned to /workspace/<name>, so the file is at <name>/<relativePath>).
        for (const root of roots) {
            try {
                const stat = await this.fileService.resolve(root.resource);
                for (const child of stat.children ?? []) {
                    if (child.isDirectory && !child.resource.path.base.startsWith('.')) {
                        candidates.push(child.resource.resolve(relativePath));
                    }
                }
            } catch {
                /* unreadable root — skip */
            }
        }

        let target: URI | undefined;
        for (const uri of candidates) {
            try {
                if (await this.fileService.exists(uri)) {
                    target = uri;
                    break;
                }
            } catch {
                /* not reachable — try the next candidate */
            }
        }

        if (!target) {
            this.messageService.warn(
                `Studio: “${relativePath}” was not found in the workspace — the repository holding it may not be checked out in this session.`,
            );
            this.logger.warn(`[studio] openInEditor: ${relativePath} not found under ${roots.map(r => r.resource.toString()).join(', ')}`);
            return;
        }

        try {
            await this.editorManager.open(target, {
                mode: 'activate',
                preview: request.preview ?? false,
            });
        } catch (error) {
            this.messageService.error(`Studio: could not open ${relativePath}: ${error}`);
            this.logger.warn(`[studio] openInEditor failed for ${target.toString()}: ${error}`);
        }
    }
}
