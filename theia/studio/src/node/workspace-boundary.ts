import * as fs from 'fs/promises';
import * as path from 'path';
import URI from '@theia/core/lib/common/uri';
import { injectable } from '@theia/core/shared/inversify';
import { StudioRuntimeConfig } from './studio-runtime-config';
import { StudioWorkspaceLocation, StudioWorkspaceRequest } from '../common/studio-protocol';

export interface ResolvedWorkspaceLocation {
    readonly location: StudioWorkspaceLocation;
    readonly absolutePath: string;
}

@injectable()
export class WorkspaceBoundary {
    protected config: StudioRuntimeConfig | undefined;
    protected rootUri: URI | undefined;
    protected canonicalWorkspaceRoot: string | undefined;
    protected canonicalRepositoryRoot: string | undefined;

    async initialize(config: StudioRuntimeConfig): Promise<void> {
        const [canonicalRepositoryRoot, canonicalWorkspaceRoot] = await Promise.all([
            fs.realpath(config.repositoryRoot),
            fs.realpath(config.workspaceRoot)
        ]);
        assertWithin(canonicalRepositoryRoot, canonicalWorkspaceRoot, 'Configured workspace root must be inside the configured repository root');
        this.config = config;
        this.canonicalRepositoryRoot = canonicalRepositoryRoot;
        this.canonicalWorkspaceRoot = canonicalWorkspaceRoot;
        this.rootUri = URI.fromFilePath(canonicalWorkspaceRoot).normalizePath();
    }

    getWorkspaceId(): string {
        return this.requireConfig().workspaceId;
    }

    assertWorkspaceId(workspaceId: string): void {
        if (workspaceId !== this.requireConfig().workspaceId) {
            throw new Error('Workspace mismatch is not allowed');
        }
    }

    async resolveWorkspacePath(request: StudioWorkspaceRequest): Promise<StudioWorkspaceLocation> {
        return (await this.resolveWorkspaceLocation(request)).location;
    }

    async resolveWorkspaceLocation(request: StudioWorkspaceRequest): Promise<ResolvedWorkspaceLocation> {
        const config = this.requireConfig();
        if ((request.relativePath === undefined) === (request.resourceUri === undefined)) {
            throw new Error('Exactly one workspace path or resource URI is required');
        }
        const resolvedRequest = request.resourceUri !== undefined
            ? await this.resolveResourceUri(request.resourceUri)
            : {
                relativePath: normalizeRelativePath(request.relativePath!),
                candidatePath: await this.resolveCandidatePath(normalizeRelativePath(request.relativePath!))
            };
        const { relativePath, candidatePath } = resolvedRequest;
        const exists = await pathExists(candidatePath);
        if (request.requireExists && !exists) {
            throw new Error(`Workspace path does not exist: ${relativePath}`);
        }

        const stats = exists ? await fs.stat(candidatePath) : undefined;
        return {
            absolutePath: candidatePath,
            location: {
                workspaceId: config.workspaceId,
                relativePath,
                repositoryRelativePath: this.toRepositoryRelativePath(candidatePath),
                exists,
                isDirectory: stats?.isDirectory() ?? false
            }
        };
    }

    protected async resolveResourceUri(resourceUri: string): Promise<{ relativePath: string; candidatePath: string }> {
        const uri = new URI(resourceUri);
        if (uri.scheme !== 'file') {
            throw new Error('Workspace resource URI must use the file scheme');
        }
        const requestedPath = uri.path.fsPath();
        const candidatePath = await fs.realpath(requestedPath);
        this.assertWithinRoot(candidatePath);
        const relativePath = path.relative(this.requireCanonicalWorkspaceRoot(), candidatePath).replace(/\\/g, '/') || '.';
        return {
            relativePath: normalizeRelativePath(relativePath),
            candidatePath
        };
    }

    protected async resolveCandidatePath(relativePath: string): Promise<string> {
        const rootPath = this.requireCanonicalWorkspaceRoot();
        const rootUri = this.requireRootUri();
        const candidateUri = rootUri.resolve(relativePath).normalizePath();
        const candidatePath = candidateUri.path.fsPath();
        this.assertWithinRoot(candidatePath);

        const segments = relativePath.split('/').filter(Boolean);
        let current = rootPath;
        for (let index = 0; index < segments.length; index += 1) {
            const nextPath = path.join(current, segments[index]);
            try {
                const stat = await fs.lstat(nextPath);
                if (stat.isSymbolicLink()) {
                    const resolved = await fs.realpath(nextPath);
                    this.assertWithinRoot(resolved);
                    current = resolved;
                } else {
                    current = nextPath;
                }
            } catch (error) {
                if (!isMissingFileError(error)) {
                    throw error;
                }
                current = path.resolve(current, ...segments.slice(index));
                this.assertWithinRoot(current);
                break;
            }
        }

        return current;
    }

    protected assertWithinRoot(candidatePath: string): void {
        assertWithin(this.requireCanonicalWorkspaceRoot(), candidatePath, 'Workspace path escapes the configured workspace root');
        assertWithin(this.requireCanonicalRepositoryRoot(), candidatePath, 'Workspace path escapes the configured repository root');
    }

    protected toRepositoryRelativePath(candidatePath: string): string {
        const repositoryRoot = this.requireCanonicalRepositoryRoot();
        assertWithin(repositoryRoot, candidatePath, 'Workspace path escapes the configured repository root');
        const relative = path.relative(repositoryRoot, candidatePath).replace(/\\/g, '/');
        if (relative === '' || relative === '.') {
            return '.';
        }
        if (relative.startsWith('../') || path.isAbsolute(relative)) {
            throw new Error('Workspace path cannot be converted to a repository-relative path');
        }
        return relative;
    }

    protected requireConfig(): StudioRuntimeConfig {
        if (!this.config) {
            throw new Error('Workspace boundary is not initialized');
        }
        return this.config;
    }

    protected requireCanonicalWorkspaceRoot(): string {
        if (!this.canonicalWorkspaceRoot) {
            throw new Error('Workspace boundary is not initialized');
        }
        return this.canonicalWorkspaceRoot;
    }

    protected requireCanonicalRepositoryRoot(): string {
        if (!this.canonicalRepositoryRoot) {
            throw new Error('Workspace boundary is not initialized');
        }
        return this.canonicalRepositoryRoot;
    }

    protected requireRootUri(): URI {
        if (!this.rootUri) {
            throw new Error('Workspace boundary is not initialized');
        }
        return this.rootUri;
    }
}

function assertWithin(parent: string, candidate: string, message: string): void {
    const relative = path.relative(parent, candidate);
    if (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))) {
        return;
    }
    throw new Error(message);
}

function normalizeRelativePath(input: string): string {
    const trimmed = input.trim();
    if (!trimmed) {
        throw new Error('Workspace relative path is required');
    }
    if (path.isAbsolute(trimmed)) {
        throw new Error('Absolute workspace paths are not allowed');
    }
    const normalized = path.posix.normalize(trimmed.replace(/\\/g, '/'));
    if (normalized === '..' || normalized.startsWith('../')) {
        throw new Error('Path traversal outside the workspace root is not allowed');
    }
    if (normalized === '.' || normalized === '') {
        return '.';
    }
    return normalized.replace(/^\.\/+/, '');
}

async function pathExists(candidatePath: string): Promise<boolean> {
    try {
        await fs.access(candidatePath);
        return true;
    } catch (error) {
        if (isMissingFileError(error)) {
            return false;
        }
        throw error;
    }
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
    return typeof error === 'object' && error !== null && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT';
}
