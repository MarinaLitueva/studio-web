import { createHash } from 'crypto';
import type { Dirent, Stats } from 'fs';
import * as fs from 'fs/promises';
import * as path from 'path';
import type { ILogger } from '@theia/core/lib/common';
import {
    type WorkspaceConfiguredSource,
    type WorkspaceDiagnostic,
    type WorkspaceRepositorySuggestion,
    type WorkspaceScanCandidate,
    type WorkspaceScanPreview,
    type WorkspaceScanRequest,
    type WorkspaceScanResponse,
    WORKSPACE_PROTOCOL_SCHEMA_VERSION
} from '../common/workspace-protocol';

const IGNORED_DIRECTORY_NAMES = new Set([
    '.git',
    'node_modules',
    '.cache',
    '.next',
    '.nuxt',
    '.turbo',
    'build',
    'coverage',
    'dist',
    'out',
    'target',
    'tmp'
]);
const SERVER_MAX_SCAN_DEPTH = 8;
const SERVER_MAX_SCAN_ENTRIES = 10_000;

interface WorkspaceDiscoveryOperationalState {
    readonly ignoredCandidateIds: readonly string[];
    readonly ignoredRoots: readonly string[];
}

interface MutableWorkspaceDiscoveryOperationalState {
    ignoredCandidateIds: Set<string>;
    ignoredRoots: Map<string, string>;
}

interface CandidateRecord {
    readonly candidate: WorkspaceScanCandidate;
}

export interface WorkspaceDiscoveryServiceOptions {
    readonly workspaceRoot: string;
    readonly operationalStatePath: string;
    readonly logger?: Pick<ILogger, 'warn'>;
}

export class WorkspaceDiscoveryService {
    protected readonly workspaceRoot: string;
    protected readonly operationalStatePath: string;
    protected readonly logger: Pick<ILogger, 'warn'>;
    protected operationalStatePromise: Promise<MutableWorkspaceDiscoveryOperationalState> | undefined;

    constructor(options: WorkspaceDiscoveryServiceOptions) {
        this.workspaceRoot = options.workspaceRoot;
        this.operationalStatePath = options.operationalStatePath;
        this.logger = options.logger ?? { warn: async () => undefined };
    }

    async scan(
        request: WorkspaceScanRequest,
        configuredSnapshot: { readonly configuredSources: readonly WorkspaceConfiguredSource[] }
    ): Promise<WorkspaceScanResponse> {
        const generatedAt = new Date().toISOString();
        const diagnostics: WorkspaceDiagnostic[] = [];
        const configuredSources = await this.indexConfiguredSources(configuredSnapshot.configuredSources);
        const ignoredState = await this.loadOperationalState();
        const canonicalWorkspaceRoot = await fs.realpath(this.workspaceRoot);
        const maxDepth = clampPositiveInteger(request.maxDepth, SERVER_MAX_SCAN_DEPTH);
        const maxEntries = clampPositiveInteger(request.maxEntries, SERVER_MAX_SCAN_ENTRIES);
        const requestedRoots = request.roots.length > 0 ? request.roots : ['.'];
        const resolvedRoots = await this.resolveScanRoots(requestedRoots, canonicalWorkspaceRoot, diagnostics);
        const candidates: CandidateRecord[] = [];
        const seenCandidates = new Map<string, string>();
        const limitState = { entriesVisited: 0, maxEntries, entryLimitHit: false };

        for (const root of resolvedRoots) {
            if (limitState.entryLimitHit) {
                break;
            }
            await this.scanRoot(root, canonicalWorkspaceRoot, maxDepth, limitState, diagnostics, async directory => {
                const candidate = await this.buildCandidate(
                    directory,
                    configuredSources,
                    ignoredState,
                    seenCandidates
                );
                candidates.push(candidate);
            });
        }

        if (limitState.entryLimitHit) {
            diagnostics.push(createDiagnostic(
                'workspace-discovery-max-entries-hit',
                'warning',
                `Workspace discovery stopped after scanning ${maxEntries} entries. Narrow the scan roots or increase the request cap.`,
                canonicalWorkspaceRoot
            ));
        }

        const preview: WorkspaceScanPreview = Object.freeze({
            requestId: hashValue([
                canonicalWorkspaceRoot,
                generatedAt,
                ...resolvedRoots,
                String(maxDepth),
                String(maxEntries)
            ].join('\0')),
            generatedAt,
            rootsScanned: Object.freeze([...resolvedRoots]),
            bounded: true,
            maxDepth,
            maxEntries,
            candidates: Object.freeze(candidates.map(item => item.candidate)),
            diagnostics: Object.freeze([...diagnostics])
        });

        return {
            schemaVersion: WORKSPACE_PROTOCOL_SCHEMA_VERSION,
            preview,
            suggestions: Object.freeze(candidates.map(item => toSuggestion(item.candidate)))
        };
    }

    async detectContainingRepository(
        openedFolder: string,
        workspaceRoot: string,
        configuredSnapshot: { readonly configuredSources: readonly WorkspaceConfiguredSource[] }
    ): Promise<WorkspaceRepositorySuggestion | undefined> {
        const canonicalWorkspaceRoot = await fs.realpath(workspaceRoot);
        const openedPath = await this.resolveOpenedPath(openedFolder, canonicalWorkspaceRoot);
        if (!openedPath) {
            return undefined;
        }
        const configuredSources = await this.indexConfiguredSources(configuredSnapshot.configuredSources);
        const ignoredState = await this.loadOperationalState();
        let current = openedPath;

        while (true) {
            if (await hasGitMarker(current)) {
                const candidateId = hashValue(current);
                const duplicateOfConfiguredSourceId = configuredSources.get(normalizeForComparison(current));
                const ignoredLocally = isIgnoredLocally(candidateId, current, ignoredState);
                if (duplicateOfConfiguredSourceId || ignoredLocally) {
                    return undefined;
                }
                return {
                    suggestionId: hashValue(`containing-repository\0${candidateId}`),
                    kind: 'containing-repository',
                    candidateId,
                    label: path.basename(current),
                    localPath: current,
                    rootPath: current,
                    disposition: 'new',
                    reason: 'Opened folder is inside a containing repository that is not configured yet.'
                };
            }
            const parent = path.dirname(current);
            if (samePath(parent, current)) {
                break;
            }
            current = parent;
        }
        return undefined;
    }

    async ignoreSuggestion(candidateId: string, rootPath: string): Promise<void> {
        const state = await this.loadOperationalState();
        const canonicalRoot = await canonicalizeForState(rootPath);
        state.ignoredCandidateIds.add(candidateId);
        state.ignoredRoots.set(normalizeForComparison(canonicalRoot), canonicalRoot);
        await this.persistOperationalState(state);
    }

    async unignoreSuggestion(candidateId: string, rootPath: string): Promise<void> {
        const state = await this.loadOperationalState();
        const canonicalRoot = await canonicalizeForState(rootPath);
        state.ignoredCandidateIds.delete(candidateId);
        state.ignoredRoots.delete(normalizeForComparison(canonicalRoot));
        await this.persistOperationalState(state);
    }

    protected async scanRoot(
        root: string,
        workspaceRoot: string,
        maxDepth: number,
        limitState: { entriesVisited: number; maxEntries: number; entryLimitHit: boolean },
        diagnostics: WorkspaceDiagnostic[],
        onCandidate: (directory: string) => Promise<void>
    ): Promise<void> {
        const queue: Array<{ readonly directory: string; readonly depth: number }> = [{ directory: root, depth: 0 }];
        const seenDirectories = new Set<string>();

        while (queue.length > 0) {
            const next = queue.pop()!;
            const comparisonKey = normalizeForComparison(next.directory);
            if (seenDirectories.has(comparisonKey)) {
                continue;
            }
            seenDirectories.add(comparisonKey);

            const entries = await safeReadDirectory(next.directory, diagnostics);
            if (!entries) {
                continue;
            }
            if (entries.some(entry => entry.name === '.git' && (entry.isDirectory() || entry.isFile()))) {
                await onCandidate(next.directory);
            }
            if (next.depth >= maxDepth) {
                if (entries.some(entry => shouldDescend(entry))) {
                    diagnostics.push(createDiagnostic(
                        'workspace-discovery-max-depth-hit',
                        'warning',
                        `Workspace discovery stopped descending below ${next.directory} after reaching the depth limit of ${maxDepth}.`,
                        next.directory
                    ));
                }
                continue;
            }

            for (const entry of sortDirectoryEntries(entries)) {
                if (limitState.entriesVisited >= limitState.maxEntries) {
                    limitState.entryLimitHit = true;
                    return;
                }
                limitState.entriesVisited += 1;
                if (!shouldDescend(entry)) {
                    continue;
                }
                const childPath = path.join(next.directory, entry.name);
                const resolvedChild = await safeRealpath(childPath, diagnostics);
                if (!resolvedChild) {
                    continue;
                }
                if (!isWithin(workspaceRoot, resolvedChild)) {
                    diagnostics.push(createDiagnostic(
                        'workspace-discovery-symlink-escape',
                        'warning',
                        `Workspace discovery skipped ${childPath} because it resolves outside the explicit workspace root.`,
                        childPath
                    ));
                    continue;
                }
                queue.push({ directory: resolvedChild, depth: next.depth + 1 });
            }
        }
    }

    protected async buildCandidate(
        canonicalRoot: string,
        configuredSources: ReadonlyMap<string, string>,
        ignoredState: MutableWorkspaceDiscoveryOperationalState,
        seenCandidates: Map<string, string>
    ): Promise<CandidateRecord> {
        const candidateId = hashValue(canonicalRoot);
        const duplicateOfConfiguredSourceId = configuredSources.get(normalizeForComparison(canonicalRoot));
        const firstCandidateId = seenCandidates.get(normalizeForComparison(canonicalRoot));
        if (!firstCandidateId) {
            seenCandidates.set(normalizeForComparison(canonicalRoot), candidateId);
        }
        const ignoredLocally = isIgnoredLocally(candidateId, canonicalRoot, ignoredState);
        const candidate: WorkspaceScanCandidate = {
            candidateId,
            label: path.basename(canonicalRoot),
            localPath: canonicalRoot,
            rootPath: canonicalRoot,
            ignoredLocally,
            deduplicatedByCandidateId: firstCandidateId && firstCandidateId !== candidateId ? firstCandidateId : undefined,
            duplicateOfConfiguredSourceId
        };
        return { candidate };
    }

    protected async resolveScanRoots(
        roots: readonly string[],
        workspaceRoot: string,
        diagnostics: WorkspaceDiagnostic[]
    ): Promise<readonly string[]> {
        const resolvedRoots: string[] = [];
        const seenRoots = new Set<string>();

        for (const root of roots) {
            const absoluteRoot = path.isAbsolute(root) ? root : path.resolve(workspaceRoot, root);
            if (!path.isAbsolute(root) && !isWithin(workspaceRoot, absoluteRoot)) {
                diagnostics.push(createDiagnostic(
                    'workspace-discovery-root-outside-workspace',
                    'error',
                    `Workspace discovery root ${root} is outside the explicit workspace root.`,
                    absoluteRoot
                ));
                continue;
            }
            const canonicalRoot = await safeRealpath(absoluteRoot, diagnostics);
            if (!canonicalRoot) {
                continue;
            }
            if (!isWithin(workspaceRoot, canonicalRoot)) {
                diagnostics.push(createDiagnostic(
                    'workspace-discovery-root-symlink-escape',
                    'error',
                    `Workspace discovery root ${root} resolves outside the explicit workspace root.`,
                    absoluteRoot
                ));
                continue;
            }
            const stat = await safeStat(canonicalRoot, diagnostics);
            if (!stat?.isDirectory()) {
                diagnostics.push(createDiagnostic(
                    'workspace-discovery-root-not-directory',
                    'warning',
                    `Workspace discovery root ${root} is not a directory.`,
                    canonicalRoot
                ));
                continue;
            }
            const comparisonKey = normalizeForComparison(canonicalRoot);
            if (seenRoots.has(comparisonKey)) {
                continue;
            }
            seenRoots.add(comparisonKey);
            resolvedRoots.push(canonicalRoot);
        }

        return Object.freeze(resolvedRoots.sort((left, right) => left.localeCompare(right)));
    }

    protected async resolveOpenedPath(openedFolder: string, workspaceRoot: string): Promise<string | undefined> {
        const candidate = path.isAbsolute(openedFolder) ? openedFolder : path.resolve(workspaceRoot, openedFolder);
        const stat = await safeStat(candidate, []);
        const directory = stat?.isDirectory() ? candidate : path.dirname(candidate);
        const canonical = await safeRealpath(directory, []);
        return canonical && isWithin(workspaceRoot, canonical) ? canonical : undefined;
    }

    protected async indexConfiguredSources(
        configuredSources: readonly WorkspaceConfiguredSource[]
    ): Promise<ReadonlyMap<string, string>> {
        const indexed = new Map<string, string>();
        const sortedSources = [...configuredSources].sort((left, right) => left.sourceId.localeCompare(right.sourceId));
        for (const source of sortedSources) {
            const canonicalRoot = await canonicalizeIfPresent(source.localPath);
            if (!canonicalRoot) {
                continue;
            }
            indexed.set(normalizeForComparison(canonicalRoot), source.sourceId);
        }
        return indexed;
    }

    protected async loadOperationalState(): Promise<MutableWorkspaceDiscoveryOperationalState> {
        if (!this.operationalStatePromise) {
            this.operationalStatePromise = this.readOperationalState();
        }
        return this.operationalStatePromise;
    }

    protected async readOperationalState(): Promise<MutableWorkspaceDiscoveryOperationalState> {
        try {
            const raw = await fs.readFile(this.operationalStatePath, 'utf8');
            const parsed = JSON.parse(raw) as Partial<WorkspaceDiscoveryOperationalState>;
            const ignoredRoots = new Map<string, string>();
            for (const root of parsed.ignoredRoots ?? []) {
                ignoredRoots.set(normalizeForComparison(root), root);
            }
            return {
                ignoredCandidateIds: new Set(parsed.ignoredCandidateIds ?? []),
                ignoredRoots
            };
        } catch (error) {
            if (isMissingFileError(error)) {
                return {
                    ignoredCandidateIds: new Set(),
                    ignoredRoots: new Map()
                };
            }
            this.logger.warn(`Failed to read workspace discovery state ${this.operationalStatePath}: ${error instanceof Error ? error.message : String(error)}`);
            return {
                ignoredCandidateIds: new Set(),
                ignoredRoots: new Map()
            };
        }
    }

    protected async persistOperationalState(state: MutableWorkspaceDiscoveryOperationalState): Promise<void> {
        const serializable: WorkspaceDiscoveryOperationalState = {
            ignoredCandidateIds: [...state.ignoredCandidateIds].sort((left, right) => left.localeCompare(right)),
            ignoredRoots: [...state.ignoredRoots.values()].sort((left, right) => left.localeCompare(right))
        };
        await fs.mkdir(path.dirname(this.operationalStatePath), { recursive: true });
        const tempPath = `${this.operationalStatePath}.${process.pid}.${Date.now()}.tmp`;
        await fs.writeFile(tempPath, `${JSON.stringify(serializable, null, 2)}\n`, 'utf8');
        await fs.rename(tempPath, this.operationalStatePath);
    }
}

function toSuggestion(candidate: WorkspaceScanCandidate): WorkspaceRepositorySuggestion {
    const disposition = candidate.duplicateOfConfiguredSourceId
        ? 'already-configured'
        : candidate.ignoredLocally
            ? 'ignored-locally'
            : candidate.deduplicatedByCandidateId
                ? 'deduplicated'
                : 'new';
    const kind = candidate.deduplicatedByCandidateId ? 'deduplicated-candidate' : 'scan-candidate';
    const reason = candidate.duplicateOfConfiguredSourceId
        ? `Repository is already configured as ${candidate.duplicateOfConfiguredSourceId}.`
        : candidate.ignoredLocally
            ? 'Repository was ignored locally.'
            : candidate.deduplicatedByCandidateId
                ? `Repository duplicates candidate ${candidate.deduplicatedByCandidateId}.`
                : 'Repository can be added explicitly after review.';
    return {
        suggestionId: hashValue(`${kind}\0${candidate.candidateId}\0${disposition}`),
        kind,
        candidateId: candidate.candidateId,
        sourceId: candidate.duplicateOfConfiguredSourceId,
        label: candidate.label,
        localPath: candidate.localPath,
        rootPath: candidate.rootPath,
        disposition,
        reason
    };
}

function shouldDescend(entry: Dirent): boolean {
    return entry.isDirectory()
        && !entry.isSymbolicLink()
        && !IGNORED_DIRECTORY_NAMES.has(entry.name);
}

function sortDirectoryEntries(entries: readonly Dirent[]): readonly Dirent[] {
    return [...entries].sort((left, right) => left.name.localeCompare(right.name));
}

async function hasGitMarker(directory: string): Promise<boolean> {
    const gitPath = path.join(directory, '.git');
    const stat = await safeStat(gitPath, []);
    return !!stat && (stat.isDirectory() || stat.isFile());
}

function isIgnoredLocally(
    candidateId: string,
    canonicalRoot: string,
    state: MutableWorkspaceDiscoveryOperationalState
): boolean {
    return state.ignoredCandidateIds.has(candidateId)
        || state.ignoredRoots.has(normalizeForComparison(canonicalRoot));
}

async function canonicalizeIfPresent(candidatePath: string): Promise<string | undefined> {
    try {
        return await fs.realpath(candidatePath);
    } catch (error) {
        return isMissingFileError(error) ? undefined : path.resolve(candidatePath);
    }
}

async function canonicalizeForState(candidatePath: string): Promise<string> {
    try {
        return await fs.realpath(candidatePath);
    } catch (_error) {
        return path.resolve(candidatePath);
    }
}

async function safeReadDirectory(
    directory: string,
    diagnostics: WorkspaceDiagnostic[]
): Promise<readonly Dirent[] | undefined> {
    try {
        return await fs.readdir(directory, { withFileTypes: true });
    } catch (error) {
        diagnostics.push(createDiagnostic(
            'workspace-discovery-read-failed',
            isPermissionError(error) ? 'warning' : 'error',
            `Workspace discovery could not read ${directory}: ${error instanceof Error ? error.message : String(error)}`,
            directory
        ));
        return undefined;
    }
}

async function safeRealpath(candidatePath: string, diagnostics: WorkspaceDiagnostic[]): Promise<string | undefined> {
    try {
        return await fs.realpath(candidatePath);
    } catch (error) {
        diagnostics.push(createDiagnostic(
            'workspace-discovery-realpath-failed',
            isPermissionError(error) ? 'warning' : 'error',
            `Workspace discovery could not resolve ${candidatePath}: ${error instanceof Error ? error.message : String(error)}`,
            candidatePath
        ));
        return undefined;
    }
}

async function safeStat(candidatePath: string, diagnostics: WorkspaceDiagnostic[]): Promise<Stats | undefined> {
    try {
        return await fs.stat(candidatePath);
    } catch (error) {
        if (!isMissingFileError(error)) {
            diagnostics.push(createDiagnostic(
                'workspace-discovery-stat-failed',
                isPermissionError(error) ? 'warning' : 'error',
                `Workspace discovery could not inspect ${candidatePath}: ${error instanceof Error ? error.message : String(error)}`,
                candidatePath
            ));
        }
        return undefined;
    }
}

function createDiagnostic(
    code: string,
    severity: WorkspaceDiagnostic['severity'],
    message: string,
    filePath?: string
): WorkspaceDiagnostic {
    return {
        code,
        severity,
        scope: 'scan',
        message,
        path: filePath
    };
}

function hashValue(value: string): string {
    return createHash('sha256').update(value).digest('hex');
}

function clampPositiveInteger(value: number, maximum: number): number {
    if (!Number.isFinite(value) || value < 0) {
        return maximum;
    }
    return Math.max(0, Math.min(Math.floor(value), maximum));
}

function normalizeForComparison(candidate: string): string {
    return process.platform === 'win32' || process.platform === 'darwin'
        ? candidate.toLocaleLowerCase()
        : candidate;
}

function samePath(left: string, right: string): boolean {
    return normalizeForComparison(left) === normalizeForComparison(right);
}

function isWithin(parent: string, candidate: string): boolean {
    const relativePath = path.relative(parent, candidate);
    return relativePath === '' || (!relativePath.startsWith('..') && !path.isAbsolute(relativePath));
}

function isMissingFileError(error: unknown): boolean {
    return !!error && typeof error === 'object' && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT';
}

function isPermissionError(error: unknown): boolean {
    return !!error && typeof error === 'object' && 'code' in error && (error as NodeJS.ErrnoException).code === 'EACCES';
}
