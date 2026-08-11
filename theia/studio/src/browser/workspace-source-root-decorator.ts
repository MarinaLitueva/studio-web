import { Disposable, DisposableCollection, Emitter, Event } from '@theia/core/lib/common';
import URI from '@theia/core/lib/common/uri';
import type { Tree } from '@theia/core/lib/browser/tree/tree';
import { DepthFirstTreeIterator } from '@theia/core/lib/browser/tree/tree-iterator';
import { TreeDecoration, TreeDecorator } from '@theia/core/lib/browser/tree/tree-decorator';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { inject, injectable } from '@theia/core/shared/inversify';
import type { WorkspaceSnapshot } from '../common/workspace-protocol';

@injectable()
export class WorkspaceSourceRootService implements Disposable {
    protected readonly onDidChangeEmitter = new Emitter<void>();
    protected readonly toDispose = new DisposableCollection(this.onDidChangeEmitter);
    protected rootWatch = new DisposableCollection();
    protected plannedRoot: URI | undefined;
    protected canonicalRoot: URI | undefined;

    readonly onDidChange: Event<void> = this.onDidChangeEmitter.event;

    constructor(
        @inject(FileService) protected readonly fileService: FileService
    ) {
        this.toDispose.push(this.rootWatch);
        this.toDispose.push(this.fileService.onDidFilesChange(event => {
            if (this.plannedRoot && event.contains(this.plannedRoot)) {
                this.onDidChangeEmitter.fire();
            }
        }));
    }

    updateSnapshot(snapshot: WorkspaceSnapshot): void {
        const nextPlannedRoot = toUri(snapshot.config.resolveRootUri);
        const nextCanonicalRoot = toUri(snapshot.config.canonicalResolveRootUri);
        if (equalUri(this.plannedRoot, nextPlannedRoot) && equalUri(this.canonicalRoot, nextCanonicalRoot)) {
            return;
        }
        this.plannedRoot = nextPlannedRoot;
        this.canonicalRoot = nextCanonicalRoot;
        this.refreshWatch();
        this.onDidChangeEmitter.fire();
    }

    isRootUri(candidate: URI): boolean {
        return Boolean(
            this.canonicalRoot?.isEqual(candidate)
            || this.plannedRoot?.isEqual(candidate)
        );
    }

    isRootElement(candidate: unknown): boolean {
        const uri = getFileStatNodeUri(candidate);
        return Boolean(uri && this.isRootUri(uri));
    }

    get displayPath(): string | undefined {
        return this.canonicalRoot?.path.toString() ?? this.plannedRoot?.path.toString();
    }

    dispose(): void {
        this.toDispose.dispose();
    }

    protected refreshWatch(): void {
        this.rootWatch.dispose();
        this.rootWatch = new DisposableCollection();
        this.toDispose.push(this.rootWatch);
        if (this.plannedRoot) {
            this.rootWatch.push(this.fileService.watch(this.plannedRoot.parent, {
                recursive: false,
                excludes: []
            }));
        }
    }
}

@injectable()
export class WorkspaceSourceRootDecorator implements TreeDecorator, Disposable {
    readonly id = 'studio-workspace-source-root-decorator';
    protected readonly onDidChangeDecorationsEmitter =
        new Emitter<(tree: Tree) => Map<string, TreeDecoration.Data>>();
    protected readonly toDispose = new DisposableCollection(this.onDidChangeDecorationsEmitter);

    readonly onDidChangeDecorations: Event<(tree: Tree) => Map<string, TreeDecoration.Data>> =
        this.onDidChangeDecorationsEmitter.event;

    constructor(
        @inject(WorkspaceSourceRootService)
        protected readonly rootService: WorkspaceSourceRootService
    ) {
        this.toDispose.push(this.rootService.onDidChange(() => {
            this.onDidChangeDecorationsEmitter.fire(tree => this.collectDecorations(tree));
        }));
    }

    decorations(tree: Tree): Map<string, TreeDecoration.Data> {
        return this.collectDecorations(tree);
    }

    dispose(): void {
        this.toDispose.dispose();
    }

    protected collectDecorations(tree: Tree): Map<string, TreeDecoration.Data> {
        const result = new Map<string, TreeDecoration.Data>();
        if (!tree.root) {
            return result;
        }
        for (const node of new DepthFirstTreeIterator(tree.root)) {
            const uri = getFileStatNodeUri(node);
            if (uri && this.rootService.isRootUri(uri)) {
                const tooltip = `Workspace Sources root — ${this.rootService.displayPath ?? uri.path.toString()}`;
                result.set(node.id, {
                    priority: -100,
                    backgroundColor: 'color-mix(in srgb, var(--theia-focusBorder) 10%, transparent)',
                    tailDecorations: [{
                        data: 'Sources',
                        tooltip,
                        fontData: { color: 'var(--theia-descriptionForeground)' }
                    }],
                    tooltip
                });
            }
        }
        return result;
    }
}

function toUri(value: string | undefined): URI | undefined {
    return value ? new URI(value) : undefined;
}

function equalUri(left: URI | undefined, right: URI | undefined): boolean {
    return left === right || Boolean(left && right && left.isEqual(right));
}

function getFileStatNodeUri(candidate: unknown): URI | undefined {
    if (
        typeof candidate !== 'object'
        || candidate === null
        || !('fileStat' in candidate)
        || !('uri' in candidate)
    ) {
        return undefined;
    }
    const uri = (candidate as { uri?: unknown }).uri;
    return uri instanceof URI ? uri : undefined;
}
