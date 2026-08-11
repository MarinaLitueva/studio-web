import * as fs from 'fs/promises';
import * as path from 'path';
import type {
    WorkspaceConflictCode,
    WorkspaceDiagnostic,
    WorkspaceSourceRenameImpactPreview
} from '../common/workspace-protocol';
import {
    CANONICAL_WORKSPACE_CONFIG_FILENAME,
    WorkspaceConfigService,
    type TomlParserLoader,
    type WorkspaceSourceEntry,
    type WorkspaceConfigLoadResult,
    isMissingFileError,
    sha256
} from './workspace-config-service';
import {
    WorkspaceTomlEditor,
    type UpdateWorkspaceSourcePatch,
    type WorkspaceTomlSourceEntry
} from './workspace-toml-editor';

export interface CreateWorkspaceConfigMutationRequest {
    readonly expectedRevision?: string;
    readonly sources?: Readonly<Record<string, WorkspaceSourceEntry>>;
}

export interface AddWorkspaceSourceMutationRequest {
    readonly expectedRevision: string;
    readonly sourceId: string;
    readonly source: WorkspaceSourceEntry;
}

export interface UpdateWorkspaceSourceMutationRequest extends UpdateWorkspaceSourcePatch {
    readonly expectedRevision: string;
    readonly sourceId: string;
}

export interface RemoveWorkspaceSourceMutationRequest {
    readonly expectedRevision: string;
    readonly sourceId: string;
}

export interface RenameWorkspaceSourceMutationRequest {
    readonly expectedRevision: string;
    readonly sourceId: string;
    readonly nextSourceId: string;
    readonly confirmedImpactIds?: readonly string[];
}

export interface SaveWorkspaceRawTomlMutationRequest {
    readonly expectedRevision: string;
    readonly rawToml: string;
}

export interface WorkspaceConfigMutationApplied {
    readonly status: 'applied';
    readonly configPath: string;
    readonly revision: string;
    readonly loadResult: WorkspaceConfigLoadResult;
    readonly impacts?: readonly WorkspaceSourceRenameImpactPreview[];
}

export interface WorkspaceConfigMutationConflict {
    readonly status: 'conflict';
    readonly code: WorkspaceConflictCode;
    readonly message: string;
    readonly configPath: string;
    readonly currentRevision?: string;
    readonly diagnostics: readonly WorkspaceDiagnostic[];
    readonly loadResult?: WorkspaceConfigLoadResult;
    readonly impacts?: readonly WorkspaceSourceRenameImpactPreview[];
}

export type WorkspaceConfigMutationResult = WorkspaceConfigMutationApplied | WorkspaceConfigMutationConflict;

interface WorkspaceConfigMutationHooks {
    readonly beforeReplace?: (configPath: string, tempPath: string) => Promise<void>;
}

interface WorkspaceMutationFileHandle {
    writeFile(data: string, options?: { readonly encoding?: BufferEncoding } | BufferEncoding): Promise<void>;
    sync(): Promise<void>;
    close(): Promise<void>;
}

interface WorkspaceMutationFileSystem {
    realpath(candidatePath: string): Promise<string>;
    mkdir(candidatePath: string, options?: { readonly recursive?: boolean }): Promise<string | undefined>;
    readFile(candidatePath: string, encoding: BufferEncoding): Promise<string>;
    rename(sourcePath: string, targetPath: string): Promise<void>;
    unlink(candidatePath: string): Promise<void>;
    stat(candidatePath: string): Promise<import('fs').Stats>;
    open(candidatePath: string, flags: string, mode?: number): Promise<WorkspaceMutationFileHandle>;
}

const DEFAULT_FILE_SYSTEM: WorkspaceMutationFileSystem = {
    realpath: fs.realpath,
    mkdir: fs.mkdir,
    readFile: fs.readFile as unknown as WorkspaceMutationFileSystem['readFile'],
    rename: fs.rename,
    unlink: fs.unlink,
    stat: fs.stat,
    open: fs.open as unknown as WorkspaceMutationFileSystem['open']
};

const MISSING_REVISION = 'missing';

export class WorkspaceConfigMutationService extends WorkspaceConfigService {
    protected static readonly writeQueues = new Map<string, Promise<void>>();
    protected readonly tomlEditor = new WorkspaceTomlEditor();

    constructor(
        tomlParserLoader?: TomlParserLoader,
        protected readonly mutationFileSystem: WorkspaceMutationFileSystem = DEFAULT_FILE_SYSTEM,
        protected readonly hooks: WorkspaceConfigMutationHooks = {}
    ) {
        super(tomlParserLoader);
    }

    async create(workspaceRoot: string, request: CreateWorkspaceConfigMutationRequest): Promise<WorkspaceConfigMutationResult> {
        return this.withSerializedPath(workspaceRoot, async configPath => {
            const current = await this.load(workspaceRoot);
            if (current.detection !== 'missing') {
                return conflict('invalid-request', 'Workspace config already exists.', configPath, current.revision, current.diagnostics, current);
            }
            if (request.expectedRevision !== undefined && request.expectedRevision !== MISSING_REVISION) {
                return conflict('revision-mismatch', 'Workspace config is missing, but the caller expected an existing revision.', configPath, undefined, current.diagnostics, current);
            }

            let rawToml: string;
            try {
                rawToml = renderNewWorkspaceConfig(request.sources ?? {});
            } catch (error) {
                return conflict(
                    'invalid-request',
                    error instanceof Error ? error.message : 'Workspace config create request is invalid.',
                    configPath,
                    undefined,
                    current.diagnostics,
                    current
                );
            }
            const validated = await this.inspectRawToml(configPath, rawToml);
            if (validated.state !== 'valid') {
                return conflict('invalid-request', 'Rendered workspace config did not validate.', configPath, undefined, validated.diagnostics, validated);
            }

            try {
                const handle = await this.mutationFileSystem.open(configPath, 'wx', 0o600);
                try {
                    await handle.writeFile(rawToml, 'utf8');
                    await handle.sync();
                } finally {
                    await handle.close();
                }
                await this.fsyncDirectory(path.dirname(configPath));
            } catch (error) {
                if (isAlreadyExistsError(error)) {
                    const latest = await this.load(workspaceRoot);
                    return conflict('revision-mismatch', 'Workspace config was created by another writer.', configPath, latest.revision, latest.diagnostics, latest);
                }
                throw error;
            }

            const applied = await this.load(workspaceRoot);
            return success(configPath, applied);
        });
    }

    async addSource(workspaceRoot: string, request: AddWorkspaceSourceMutationRequest): Promise<WorkspaceConfigMutationResult> {
        return this.mutateExisting(workspaceRoot, request.expectedRevision, async current => {
            const editResult = this.tomlEditor.addSource(current.rawToml!, current.ast!, request.sourceId, request.source);
            return this.applyEditorResult(current, editResult);
        });
    }

    async updateSource(workspaceRoot: string, request: UpdateWorkspaceSourceMutationRequest): Promise<WorkspaceConfigMutationResult> {
        return this.mutateExisting(workspaceRoot, request.expectedRevision, async current => {
            const editResult = this.tomlEditor.updateSource(current.rawToml!, current.ast!, request.sourceId, request);
            return this.applyEditorResult(current, editResult);
        });
    }

    async removeSource(workspaceRoot: string, request: RemoveWorkspaceSourceMutationRequest): Promise<WorkspaceConfigMutationResult> {
        return this.mutateExisting(workspaceRoot, request.expectedRevision, async current => {
            const editResult = this.tomlEditor.removeSource(current.rawToml!, current.ast!, request.sourceId);
            return this.applyEditorResult(current, editResult);
        });
    }

    async renameSource(workspaceRoot: string, request: RenameWorkspaceSourceMutationRequest): Promise<WorkspaceConfigMutationResult> {
        return this.mutateExisting(workspaceRoot, request.expectedRevision, async current => {
            const editResult = this.tomlEditor.renameSource(current.rawToml!, current.ast!, request);
            return this.applyEditorResult(current, editResult);
        });
    }

    async saveRawToml(workspaceRoot: string, request: SaveWorkspaceRawTomlMutationRequest): Promise<WorkspaceConfigMutationResult> {
        return this.mutateExisting(workspaceRoot, request.expectedRevision, async current => {
            const validated = await this.inspectRawToml(current.configPath, request.rawToml);
            if (validated.state !== 'valid') {
                return conflict('invalid-request', 'Provided TOML did not validate.', current.configPath, current.revision, validated.diagnostics, validated);
            }
            return this.commit(current, request.rawToml, validated);
        });
    }

    protected async mutateExisting(
        workspaceRoot: string,
        expectedRevision: string,
        mutator: (current: WorkspaceConfigLoadResult) => Promise<WorkspaceConfigMutationResult>
    ): Promise<WorkspaceConfigMutationResult> {
        return this.withSerializedPath(workspaceRoot, async configPath => {
            const current = await this.load(workspaceRoot);
            if (current.detection !== 'canonical' || current.state !== 'valid' || !current.rawToml || !current.ast || !current.revision) {
                return conflict('invalid-request', 'A valid canonical workspace config is required before mutation.', configPath, current.revision, current.diagnostics, current);
            }
            if (current.revision !== expectedRevision) {
                return conflict('revision-mismatch', 'Workspace config revision changed before mutation.', configPath, current.revision, current.diagnostics, current);
            }
            return mutator(current);
        });
    }

    protected async applyEditorResult(
        current: WorkspaceConfigLoadResult,
        editResult: ReturnType<WorkspaceTomlEditor['addSource']>
    ): Promise<WorkspaceConfigMutationResult> {
        if (editResult.status === 'conflict') {
            return {
                ...conflict(editResult.code, editResult.message, current.configPath, current.revision, current.diagnostics, current),
                impacts: editResult.impacts
            };
        }

        const validated = await this.inspectRawToml(current.configPath, editResult.rawToml);
        if (validated.state !== 'valid') {
            return conflict('invalid-request', 'Workspace config mutation produced an invalid document.', current.configPath, current.revision, validated.diagnostics, validated);
        }

        const result = await this.commit(current, editResult.rawToml, validated);
        if (result.status === 'applied' && editResult.impacts) {
            return {
                ...result,
                impacts: editResult.impacts
            };
        }
        return result;
    }

    protected async commit(
        current: WorkspaceConfigLoadResult,
        nextRawToml: string,
        validated: WorkspaceConfigLoadResult
    ): Promise<WorkspaceConfigMutationResult> {
        const tempPath = path.join(
            path.dirname(current.configPath),
            `.${path.basename(current.configPath)}.${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}.tmp`
        );
        let tempCreated = false;
        const mode = await this.loadFileMode(current.configPath);
        try {
            const handle = await this.mutationFileSystem.open(tempPath, 'wx', mode);
            tempCreated = true;
            try {
                await handle.writeFile(nextRawToml, 'utf8');
                await handle.sync();
            } finally {
                await handle.close();
            }

            await this.hooks.beforeReplace?.(current.configPath, tempPath);
            const latestRawToml = await this.mutationFileSystem.readFile(current.configPath, 'utf8');
            if (sha256(latestRawToml) !== current.revision || latestRawToml !== current.rawToml) {
                const latest = await this.inspectRawToml(current.configPath, latestRawToml);
                return conflict('revision-mismatch', 'Workspace config changed while the mutation was in flight.', current.configPath, latest.revision, latest.diagnostics, latest);
            }

            await this.mutationFileSystem.rename(tempPath, current.configPath);
            tempCreated = false;
            await this.fsyncDirectory(path.dirname(current.configPath));
            return success(current.configPath, validated);
        } finally {
            if (tempCreated) {
                await this.unlinkIfExists(tempPath);
            }
        }
    }

    protected async withSerializedPath<T>(workspaceRoot: string, worker: (configPath: string) => Promise<T>): Promise<T> {
        const canonicalRoot = await this.mutationFileSystem.realpath(workspaceRoot);
        const configPath = path.join(canonicalRoot, CANONICAL_WORKSPACE_CONFIG_FILENAME);
        const previous = WorkspaceConfigMutationService.writeQueues.get(configPath) ?? Promise.resolve();
        let release: () => void = () => undefined;
        const next = new Promise<void>(resolve => {
            release = resolve;
        });
        const queued = previous.then(() => next);
        WorkspaceConfigMutationService.writeQueues.set(configPath, queued);
        await previous;
        try {
            return await worker(configPath);
        } finally {
            release();
            if (WorkspaceConfigMutationService.writeQueues.get(configPath) === queued) {
                WorkspaceConfigMutationService.writeQueues.delete(configPath);
            }
        }
    }

    protected async loadFileMode(configPath: string): Promise<number> {
        try {
            return ((await this.mutationFileSystem.stat(configPath)).mode & 0o777) || 0o600;
        } catch (error) {
            if (isMissingFileError(error)) {
                return 0o600;
            }
            throw error;
        }
    }

    protected async fsyncDirectory(directoryPath: string): Promise<void> {
        try {
            const handle = await this.mutationFileSystem.open(directoryPath, 'r');
            try {
                await handle.sync();
            } finally {
                await handle.close();
            }
        } catch (error) {
            if (typeof error === 'object' && error !== null && 'code' in error) {
                const code = String((error as NodeJS.ErrnoException).code);
                if (code === 'EINVAL' || code === 'ENOTSUP' || code === 'EBADF') {
                    return;
                }
            }
            throw error;
        }
    }

    protected async unlinkIfExists(candidatePath: string): Promise<void> {
        try {
            await this.mutationFileSystem.unlink(candidatePath);
        } catch (error) {
            if (!isMissingFileError(error)) {
                throw error;
            }
        }
    }
}

function success(configPath: string, loadResult: WorkspaceConfigLoadResult): WorkspaceConfigMutationApplied {
    return {
        status: 'applied',
        configPath,
        revision: loadResult.revision ?? '',
        loadResult
    };
}

function conflict(
    code: WorkspaceConflictCode,
    message: string,
    configPath: string,
    currentRevision: string | undefined,
    diagnostics: readonly WorkspaceDiagnostic[],
    loadResult?: WorkspaceConfigLoadResult
): WorkspaceConfigMutationConflict {
    return {
        status: 'conflict',
        code,
        message,
        configPath,
        currentRevision,
        diagnostics,
        loadResult
    };
}

function renderNewWorkspaceConfig(sources: Readonly<Record<string, WorkspaceSourceEntry>>): string {
    const sourceEntries = Object.entries(sources);
    for (const [, source] of sourceEntries) {
        const validation = validateSourceEntry(source);
        if (validation) {
            throw new Error(validation);
        }
    }
    const sections = ['version = "1.0"'];
    if (sourceEntries.length === 0) {
        sections.push('', '[sources]');
        return `${sections.join('\n')}\n`;
    }
    for (const [sourceId, source] of sourceEntries) {
        sections.push('', renderSourceTable(sourceId, source).trimEnd());
    }
    return `${sections.join('\n')}\n`;
}

function renderSourceTable(sourceId: string, source: WorkspaceTomlSourceEntry, newline = '\n'): string {
    const lines = [`[sources.${formatTomlKeySegment(sourceId)}]`];
    for (const field of ['path', 'adapter', 'role', 'url', 'branch'] as const) {
        const value = source[field];
        if (value !== undefined) {
            lines.push(`${field} = ${JSON.stringify(String(value))}`);
        }
    }
    return `${lines.join(newline)}${newline}`;
}

function formatTomlKeySegment(value: string): string {
    return /^[A-Za-z0-9_-]+$/u.test(value) ? value : JSON.stringify(value);
}

function validateSourceEntry(source: WorkspaceSourceEntry): string | undefined {
    const hasPath = typeof source.path === 'string' && source.path.length > 0;
    const hasUrl = typeof source.url === 'string' && source.url.length > 0;
    if (hasPath === hasUrl) {
        return 'Workspace source entries must define exactly one of "path" or "url".';
    }
    if (source.branch !== undefined && !hasUrl) {
        return 'Workspace source entries may set "branch" only when "url" is present.';
    }
    if (source.role !== undefined && !new Set(['artifacts', 'codebase', 'kits', 'full']).has(source.role)) {
        return `Unsupported workspace source role "${String(source.role)}".`;
    }
    return undefined;
}

function isAlreadyExistsError(error: unknown): error is NodeJS.ErrnoException {
    return typeof error === 'object' && error !== null && 'code' in error && (error as NodeJS.ErrnoException).code === 'EEXIST';
}
