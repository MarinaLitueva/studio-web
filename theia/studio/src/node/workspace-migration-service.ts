import * as fs from 'fs/promises';
import * as path from 'path';
import type {
    WorkspaceConfigMode,
    WorkspaceDiagnostic,
    WorkspaceMigrationComparison,
    WorkspaceMigrationDifference,
    WorkspaceMigrationPreview,
    WorkspaceMigrationSourceEntry,
    WorkspaceMigrationSourceKind,
    WorkspaceMigrationState,
    WorkspaceMigrationStatusResponse
} from '../common/workspace-protocol';
import {
    WORKSPACE_PROTOCOL_SCHEMA_VERSION
} from '../common/workspace-protocol';
import {
    CANONICAL_WORKSPACE_CONFIG_FILENAME,
    LEGACY_WORKSPACE_CONFIG_FILENAME,
    SUPPORTED_WORKSPACE_CONFIG_VERSION,
    WorkspaceConfigService,
    type NativeWorkspaceConfigData,
    type WorkspaceConfigLoadResult,
    type TomlParserLoader,
    isMissingFileError,
    sha256
} from './workspace-config-service';

const INLINE_WORKSPACE_CONFIG_PATH = path.join('config', 'core.toml');
const JOURNAL_SCHEMA_VERSION = 1;
const DEFAULT_ROLLBACK_WINDOW_MS = 60 * 60 * 1000;

export type WorkspaceStartupMode =
    | 'legacy'
    | 'single-folder'
    | 'canonical-shadow'
    | 'canonical-active'
    | 'canonical-diagnostics';

export interface WorkspaceMigrationStartupState {
    readonly mode: WorkspaceStartupMode;
    readonly migration: WorkspaceMigrationState;
    readonly diagnostics: readonly WorkspaceDiagnostic[];
}

interface WorkspaceMigrationPersistedState {
    readonly schemaVersion: 1;
    readonly modeOverride?: WorkspaceConfigMode;
    readonly preview?: WorkspaceMigrationPreview;
    readonly comparison?: WorkspaceMigrationComparison;
    readonly transaction?: WorkspaceMigrationTransaction;
}

interface WorkspaceMigrationTransaction {
    readonly schemaVersion: 1;
    readonly transactionId: string;
    readonly modeBefore: WorkspaceConfigMode;
    readonly modeAfter: WorkspaceConfigMode;
    readonly sourceKind: WorkspaceMigrationSourceKind;
    readonly sourcePath: string;
    readonly targetPath: string;
    readonly payloadHash: string;
    readonly createdAt: string;
    readonly updatedAt: string;
    readonly phase: 'pending-write' | 'written' | 'rollback-available' | 'rolled-back' | 'failed';
    readonly rollbackDeadline?: string;
    readonly rollbackAvailable: boolean;
    readonly error?: string;
}

interface SourceCandidate {
    readonly kind: WorkspaceMigrationSourceKind;
    readonly path: string;
    readonly config: NativeWorkspaceConfigData;
    readonly diagnostics: readonly WorkspaceDiagnostic[];
}

interface InlineWorkspaceContainer {
    readonly workspace?: Record<string, unknown>;
}

export class WorkspaceMigrationService {
    protected workspaceRoot = '';
    protected dataDir = '';
    protected journalPath = '';
    protected loadResult: WorkspaceConfigLoadResult | undefined;
    protected startupState: WorkspaceMigrationStartupState = {
        mode: 'single-folder',
        migration: freezeMigrationState({
            mode: 'single-folder',
            status: 'not-needed',
            rollbackAvailable: false
        }),
        diagnostics: []
    };
    protected persistedState: WorkspaceMigrationPersistedState = { schemaVersion: JOURNAL_SCHEMA_VERSION };

    constructor(
        protected readonly configService: WorkspaceConfigService = new WorkspaceConfigService(),
        protected readonly tomlParserLoader?: TomlParserLoader,
        protected readonly now: () => string = () => new Date().toISOString(),
        protected readonly rollbackWindowMs = DEFAULT_ROLLBACK_WINDOW_MS
    ) {}

    async initialize(workspaceRoot: string, dataDir: string): Promise<WorkspaceMigrationStartupState> {
        this.workspaceRoot = path.resolve(workspaceRoot);
        this.dataDir = path.resolve(dataDir);
        this.journalPath = path.join(this.dataDir, 'workspace-migration-journal.json');
        this.persistedState = await this.loadPersistedState();
        this.loadResult = await this.configService.load(this.workspaceRoot);
        await this.recoverInterruptedTransaction();
        this.startupState = await this.computeStartupState();
        return this.startupState;
    }

    getSnapshotState(): WorkspaceMigrationState {
        return this.startupState.migration;
    }

    getStartupMode(): WorkspaceStartupMode {
        return this.startupState.mode;
    }

    async getStatus(): Promise<WorkspaceMigrationStatusResponse> {
        await this.refresh();
        return {
            schemaVersion: WORKSPACE_PROTOCOL_SCHEMA_VERSION,
            migration: this.startupState.migration,
            diagnostics: freezeDiagnostics(this.startupState.diagnostics),
            preview: this.persistedState.preview,
            comparison: this.persistedState.comparison
        };
    }

    async previewMigration(): Promise<WorkspaceMigrationStatusResponse> {
        await this.refresh();
        const candidate = await this.requireMigrationSource();
        if (this.loadResult?.detection === 'canonical') {
            throw new Error('Canonical workspace config already exists and blocks migration preview');
        }

        const preview = await this.buildPreview(candidate);
        this.persistedState = {
            ...this.persistedState,
            preview,
            comparison: undefined
        };
        await this.persistState();
        this.startupState = await this.computeStartupState();
        return this.getStatus();
    }

    async compareShadow(): Promise<WorkspaceMigrationStatusResponse> {
        await this.refresh();
        const candidate = await this.requireMigrationSource();
        if (this.loadResult?.state !== 'valid') {
            throw new Error('Canonical shadow compare requires a valid canonical workspace config');
        }
        const comparison = this.buildComparison(candidate, this.loadResult);
        this.persistedState = {
            ...this.persistedState,
            comparison
        };
        await this.persistState();
        this.startupState = await this.computeStartupState();
        return this.getStatus();
    }

    async applyMigration(): Promise<WorkspaceMigrationStatusResponse> {
        await this.refresh();
        const candidate = await this.requireMigrationSource();
        if (this.loadResult?.detection === 'canonical') {
            throw new Error('Canonical workspace config already exists and blocks migration apply');
        }

        const preview = await this.buildPreview(candidate);
        const transactionId = createTransactionId();
        const createdAt = this.now();
        const targetPath = path.join(this.workspaceRoot, CANONICAL_WORKSPACE_CONFIG_FILENAME);
        await this.writeTransaction({
            schemaVersion: JOURNAL_SCHEMA_VERSION,
            transactionId,
            modeBefore: preview.modeBefore,
            modeAfter: 'canonical-shadow',
            sourceKind: preview.sourceKind,
            sourcePath: preview.sourcePath,
            targetPath,
            payloadHash: preview.payloadHash,
            createdAt,
            updatedAt: createdAt,
            phase: 'pending-write',
            rollbackAvailable: false
        });

        await writeCanonicalFileAtomically(targetPath, preview.rawCanonicalToml);

        await this.writeTransaction({
            ...(this.persistedState.transaction as WorkspaceMigrationTransaction),
            updatedAt: this.now(),
            phase: 'written',
            rollbackAvailable: false
        });

        const validated = await this.configService.load(this.workspaceRoot);
        if (validated.state !== 'valid' || validated.revision !== preview.payloadHash) {
            await this.writeTransaction({
                ...(this.persistedState.transaction as WorkspaceMigrationTransaction),
                updatedAt: this.now(),
                phase: 'failed',
                rollbackAvailable: true,
                rollbackDeadline: new Date(Date.now() + this.rollbackWindowMs).toISOString(),
                error: 'Canonical workspace config did not validate after migration write'
            });
            this.loadResult = validated;
            this.startupState = await this.computeStartupState();
            return this.getStatus();
        }

        const rollbackDeadline = new Date(Date.now() + this.rollbackWindowMs).toISOString();
        await this.writeTransaction({
            ...(this.persistedState.transaction as WorkspaceMigrationTransaction),
            updatedAt: this.now(),
            phase: 'rollback-available',
            rollbackAvailable: true,
            rollbackDeadline
        });

        this.persistedState = {
            ...this.persistedState,
            modeOverride: 'canonical-shadow',
            preview,
            comparison: undefined,
            transaction: this.persistedState.transaction
        };
        await this.persistState();
        this.loadResult = validated;
        this.startupState = await this.computeStartupState();
        return this.getStatus();
    }

    async activateCanonical(acknowledgedDifferenceHash?: string): Promise<WorkspaceMigrationStatusResponse> {
        await this.refresh();
        if (this.loadResult?.state !== 'valid') {
            throw new Error('Canonical activation requires a valid canonical workspace config');
        }
        const comparison = this.persistedState.comparison;
        if (!comparison) {
            throw new Error('Canonical activation requires an explicit shadow comparison');
        }
        if (!comparison.clean && comparison.differenceHash !== acknowledgedDifferenceHash) {
            throw new Error('Canonical activation requires a clean compare or an acknowledged difference hash');
        }

        this.persistedState = {
            ...this.persistedState,
            modeOverride: 'canonical-active',
            comparison: {
                ...comparison,
                acknowledgedDifferenceHash: comparison.clean ? undefined : acknowledgedDifferenceHash
            }
        };
        await this.persistState();
        this.startupState = await this.computeStartupState();
        return this.getStatus();
    }

    async rollbackMigration(transactionId: string): Promise<WorkspaceMigrationStatusResponse> {
        await this.refresh();
        const transaction = this.persistedState.transaction;
        if (!transaction || transaction.transactionId !== transactionId) {
            throw new Error('Workspace migration rollback is blocked because the transaction was not found');
        }
        if (!transaction.rollbackAvailable || !transaction.rollbackDeadline) {
            throw new Error('Workspace migration rollback is blocked because rollback is unavailable');
        }
        if (Date.parse(transaction.rollbackDeadline) < Date.now()) {
            throw new Error('Workspace migration rollback is blocked because the rollback window expired');
        }

        const canonicalPath = path.join(this.workspaceRoot, CANONICAL_WORKSPACE_CONFIG_FILENAME);
        const current = await this.configService.load(this.workspaceRoot);
        if (current.detection !== 'canonical' || current.revision !== transaction.payloadHash) {
            throw new Error('Workspace migration rollback is blocked because the canonical config changed externally');
        }

        await fs.unlink(canonicalPath);
        await fsyncDirectory(path.dirname(canonicalPath));
        await this.writeTransaction({
            ...transaction,
            updatedAt: this.now(),
            phase: 'rolled-back',
            rollbackAvailable: false
        });
        this.persistedState = {
            ...this.persistedState,
            modeOverride: transaction.modeBefore,
            comparison: undefined,
            transaction: this.persistedState.transaction
        };
        await this.persistState();
        this.loadResult = await this.configService.load(this.workspaceRoot);
        this.startupState = await this.computeStartupState();
        return this.getStatus();
    }

    protected async refresh(): Promise<void> {
        if (!this.workspaceRoot || !this.dataDir) {
            throw new Error('Workspace migration service is not initialized');
        }
        this.loadResult = await this.configService.load(this.workspaceRoot);
        this.persistedState = await this.loadPersistedState();
        this.startupState = await this.computeStartupState();
    }

    protected async requireMigrationSource(): Promise<SourceCandidate> {
        const source = await this.detectMigrationSource();
        if (!source) {
            throw new Error('No legacy workspace migration source is available');
        }
        return source;
    }

    protected async detectMigrationSource(): Promise<SourceCandidate | undefined> {
        const legacyPath = path.join(this.workspaceRoot, LEGACY_WORKSPACE_CONFIG_FILENAME);
        try {
            const legacyRaw = await fs.readFile(legacyPath, 'utf8');
            const inspected = await this.configService.inspectRawToml(legacyPath, legacyRaw);
            if (inspected.state === 'valid' && inspected.parsedData) {
                return {
                    kind: 'legacy-config',
                    path: legacyPath,
                    config: inspected.parsedData,
                    diagnostics: []
                };
            }
            return {
                kind: 'legacy-config',
                path: legacyPath,
                config: emptyConfig(),
                diagnostics: freezeDiagnostics(inspected.diagnostics)
            };
        } catch (error) {
            if (!isMissingFileError(error)) {
                throw error;
            }
        }

        const inlinePath = path.join(this.workspaceRoot, INLINE_WORKSPACE_CONFIG_PATH);
        try {
            const raw = await fs.readFile(inlinePath, 'utf8');
            const parser = this.tomlParserLoader ? await this.tomlParserLoader() : await loadTomlParserModuleBridge();
            const ast = parser.parseForESLint(raw, {
                filePath: inlinePath,
                tomlVersion: SUPPORTED_WORKSPACE_CONFIG_VERSION
            }).ast;
            const value = parser.getStaticTOMLValue(ast) as InlineWorkspaceContainer;
            if (!value.workspace || typeof value.workspace !== 'object' || Array.isArray(value.workspace)) {
                return undefined;
            }
            const config = normalizeInlineWorkspaceConfig(value.workspace);
            const diagnostics: WorkspaceDiagnostic[] = [];
            for (const [sourceId, source] of Object.entries(config.sources)) {
                if (source.url) {
                    diagnostics.push(createDiagnostic(
                        'workspace.migration.inline_url_unsupported',
                        'error',
                        `Inline workspace source "${sourceId}" cannot use url; move it into ${CANONICAL_WORKSPACE_CONFIG_FILENAME}.`,
                        `${inlinePath}#workspace.sources.${sourceId}.url`
                    ));
                }
            }
            return {
                kind: 'inline-core',
                path: inlinePath,
                config,
                diagnostics: freezeDiagnostics(diagnostics)
            };
        } catch (error) {
            if (isMissingFileError(error)) {
                return undefined;
            }
            throw error;
        }
    }

    protected async buildPreview(candidate: SourceCandidate): Promise<WorkspaceMigrationPreview> {
        const normalizedConfig = candidate.config;
        const rawCanonicalToml = renderCanonicalToml(normalizedConfig);
        const targetPath = path.join(this.workspaceRoot, CANONICAL_WORKSPACE_CONFIG_FILENAME);
        const inspected = await this.configService.inspectRawToml(targetPath, rawCanonicalToml);
        const diagnostics = freezeDiagnostics([
            ...candidate.diagnostics,
            ...inspected.diagnostics.map(diagnostic => ({
                ...diagnostic,
                scope: diagnostic.scope === 'config' ? 'migration' : diagnostic.scope
            }))
        ]);
        return {
            sourceKind: candidate.kind,
            sourcePath: candidate.path,
            targetPath,
            modeBefore: this.deriveDefaultMode(candidate),
            modeAfter: 'canonical-shadow',
            payloadHash: sha256(rawCanonicalToml),
            normalizedConfig: normalizedConfigToPublic(normalizedConfig),
            rawCanonicalToml,
            diagnostics
        };
    }

    protected buildComparison(
        candidate: SourceCandidate,
        canonical: WorkspaceConfigLoadResult
    ): WorkspaceMigrationComparison {
        const differences: WorkspaceMigrationDifference[] = [];
        const legacySources = new Map(Object.entries(candidate.config.sources).sort(([left], [right]) => left.localeCompare(right)));
        const canonicalSources = new Map(Object.entries(canonical.parsedData?.sources ?? {}).sort(([left], [right]) => left.localeCompare(right)));
        const allSourceIds = [...new Set([...legacySources.keys(), ...canonicalSources.keys()])].sort((left, right) => left.localeCompare(right));

        for (const sourceId of allSourceIds) {
            const legacy = legacySources.get(sourceId);
            const active = canonicalSources.get(sourceId);
            if (!legacy) {
                differences.push({
                    kind: 'missing-in-source',
                    sourceId,
                    message: `Source "${sourceId}" exists only in canonical config.`
                });
                continue;
            }
            if (!active) {
                differences.push({
                    kind: 'missing-in-canonical',
                    sourceId,
                    message: `Source "${sourceId}" exists only in the legacy projection.`
                });
                continue;
            }
            for (const field of ['path', 'url', 'branch', 'role', 'adapter'] as const) {
                const leftValue = valueOrEmpty(legacy[field]);
                const rightValue = valueOrEmpty(active[field]);
                if (leftValue !== rightValue) {
                    differences.push({
                        kind: 'field-mismatch',
                        sourceId,
                        field,
                        legacyValue: leftValue,
                        canonicalValue: rightValue,
                        message: `Source "${sourceId}" differs on ${field}.`
                    });
                }
            }
        }

        const diagnosticKeys = [
            ...candidate.diagnostics.map(diagnostic => `legacy:${diagnostic.code}:${diagnostic.message}`),
            ...(canonical.diagnostics ?? []).map(diagnostic => `canonical:${diagnostic.code}:${diagnostic.message}`)
        ].sort();
        if (candidate.diagnostics.length > 0 || (canonical.diagnostics?.length ?? 0) > 0) {
            differences.push(...diagnosticKeys.map(key => ({
                kind: 'diagnostic-mismatch' as const,
                message: key
            })));
        }

        const differenceHash = sha256(JSON.stringify(differences));
        return {
            clean: differences.length === 0,
            differenceHash,
            acknowledgedDifferenceHash: this.persistedState.comparison?.acknowledgedDifferenceHash,
            sourceKind: candidate.kind,
            sourcePath: candidate.path,
            targetPath: canonical.configPath,
            differences: Object.freeze(differences),
            diagnostics: freezeDiagnostics([
                ...candidate.diagnostics,
                ...canonical.diagnostics
            ])
        };
    }

    protected deriveDefaultMode(candidate?: SourceCandidate): WorkspaceConfigMode {
        if (this.loadResult?.detection === 'canonical' && this.loadResult.state === 'valid') {
            return 'canonical-active';
        }
        if (candidate?.kind === 'legacy-config') {
            return 'legacy';
        }
        if (candidate?.kind === 'inline-core') {
            return 'legacy';
        }
        return 'single-folder';
    }

    protected async computeStartupState(): Promise<WorkspaceMigrationStartupState> {
        const source = await this.detectMigrationSource();
        const diagnostics = [...(this.loadResult?.diagnostics ?? [])];
        let mode: WorkspaceStartupMode;

        if (this.loadResult?.detection === 'canonical') {
            if (this.loadResult.state === 'valid') {
                mode = this.persistedState.modeOverride === 'canonical-shadow' && source
                    ? 'canonical-shadow'
                    : 'canonical-active';
            } else {
                mode = 'canonical-diagnostics';
            }
        } else if (source?.kind === 'legacy-config' || source?.kind === 'inline-core') {
            mode = 'legacy';
            diagnostics.push(...source.diagnostics);
        } else {
            mode = 'single-folder';
        }

        const transaction = this.persistedState.transaction;
        const migration = freezeMigrationState({
            mode: mode === 'canonical-diagnostics' ? 'canonical-active' : mode,
            status: resolveMigrationStatus(mode, transaction),
            transactionId: transaction?.transactionId,
            recoveryState: transaction?.rollbackAvailable ? 'available' : 'none',
            rollbackAvailable: transaction?.rollbackAvailable === true,
            rollbackReason: transaction?.rollbackAvailable ? undefined : transaction?.error
        });
        return {
            mode,
            migration,
            diagnostics: freezeDiagnostics(diagnostics)
        };
    }

    protected async recoverInterruptedTransaction(): Promise<void> {
        const transaction = this.persistedState.transaction;
        if (!transaction || transaction.phase !== 'written') {
            return;
        }
        const current = await this.configService.load(this.workspaceRoot);
        if (current.detection === 'canonical' && current.revision === transaction.payloadHash) {
            await this.writeTransaction({
                ...transaction,
                updatedAt: this.now(),
                phase: 'rollback-available',
                rollbackAvailable: true,
                rollbackDeadline: transaction.rollbackDeadline ?? new Date(Date.now() + this.rollbackWindowMs).toISOString()
            });
            this.loadResult = current;
            return;
        }
        await this.writeTransaction({
            ...transaction,
            updatedAt: this.now(),
            phase: 'failed',
            rollbackAvailable: current.detection === 'canonical' && current.revision === transaction.payloadHash,
            rollbackDeadline: new Date(Date.now() + this.rollbackWindowMs).toISOString(),
            error: 'Interrupted migration could not be validated during startup recovery'
        });
        this.loadResult = current;
    }

    protected async writeTransaction(transaction: WorkspaceMigrationTransaction): Promise<void> {
        this.persistedState = {
            ...this.persistedState,
            transaction
        };
        await this.persistState();
    }

    protected async loadPersistedState(): Promise<WorkspaceMigrationPersistedState> {
        try {
            const raw = await fs.readFile(this.journalPath, 'utf8');
            const parsed = JSON.parse(raw) as WorkspaceMigrationPersistedState;
            if (parsed.schemaVersion !== JOURNAL_SCHEMA_VERSION) {
                return { schemaVersion: JOURNAL_SCHEMA_VERSION };
            }
            return parsed;
        } catch (error) {
            if (isMissingFileError(error)) {
                return { schemaVersion: JOURNAL_SCHEMA_VERSION };
            }
            throw error;
        }
    }

    protected async persistState(): Promise<void> {
        await fs.mkdir(this.dataDir, { recursive: true });
        const tempPath = `${this.journalPath}.${process.pid}.${Date.now()}.tmp`;
        const body = JSON.stringify(this.persistedState, null, 2);
        await fs.writeFile(tempPath, body, 'utf8');
        await fsyncPath(tempPath);
        await fs.rename(tempPath, this.journalPath);
        await fsyncDirectory(path.dirname(this.journalPath));
    }
}

function normalizedConfigToPublic(config: NativeWorkspaceConfigData): WorkspaceMigrationPreview['normalizedConfig'] {
    return {
        version: config.version,
        sources: Object.freeze(Object.fromEntries(Object.entries(config.sources).sort(([left], [right]) => left.localeCompare(right)).map(([sourceId, source]) => [
            sourceId,
            Object.freeze({
                ...(source.path ? { path: source.path } : {}),
                ...(source.adapter ? { adapter: source.adapter } : {}),
                ...(source.role ? { role: source.role } : {}),
                ...(source.url ? { url: source.url } : {}),
                ...(source.branch ? { branch: source.branch } : {})
            })
        ]))),
        ...(config.traceability ? { traceability: Object.freeze({ ...config.traceability }) } : {}),
        ...(config.resolve ? {
            resolve: Object.freeze({
                ...(config.resolve.workdir ? { workdir: config.resolve.workdir } : {}),
                ...(config.resolve.namespace ? { namespace: Object.freeze({ ...config.resolve.namespace }) } : {})
            })
        } : {}),
        ...(config.validation ? {
            validation: Object.freeze({
                ...(config.validation.allowed_content_languages
                    ? { allowed_content_languages: Object.freeze([...config.validation.allowed_content_languages]) }
                    : {})
            })
        } : {})
    };
}

function normalizeInlineWorkspaceConfig(workspace: Record<string, unknown>): NativeWorkspaceConfigData {
    const version = typeof workspace.version === 'string' && workspace.version.trim() ? workspace.version : SUPPORTED_WORKSPACE_CONFIG_VERSION;
    const sourcesValue = workspace.sources;
    const sources = typeof sourcesValue === 'object' && sourcesValue !== null && !Array.isArray(sourcesValue)
        ? sourcesValue as Record<string, WorkspaceMigrationSourceEntry>
        : {};
    return {
        version,
        sources: Object.freeze(Object.fromEntries(Object.entries(sources).sort(([left], [right]) => left.localeCompare(right)).map(([sourceId, source]) => [
            sourceId,
            Object.freeze({
                ...(typeof source.path === 'string' ? { path: source.path } : {}),
                ...(typeof source.adapter === 'string' ? { adapter: source.adapter } : {}),
                ...(typeof source.role === 'string' ? { role: source.role as WorkspaceMigrationSourceEntry['role'] } : {}),
                ...(typeof source.url === 'string' ? { url: source.url } : {}),
                ...(typeof source.branch === 'string' ? { branch: source.branch } : {})
            })
        ]))),
        ...(workspace.traceability && typeof workspace.traceability === 'object' && !Array.isArray(workspace.traceability)
            ? { traceability: workspace.traceability as NativeWorkspaceConfigData['traceability'] }
            : {}),
        ...(workspace.resolve && typeof workspace.resolve === 'object' && !Array.isArray(workspace.resolve)
            ? { resolve: workspace.resolve as NativeWorkspaceConfigData['resolve'] }
            : {}),
        ...(workspace.validation && typeof workspace.validation === 'object' && !Array.isArray(workspace.validation)
            ? { validation: workspace.validation as NativeWorkspaceConfigData['validation'] }
            : {})
    };
}

function renderCanonicalToml(config: NativeWorkspaceConfigData): string {
    const lines = [`version = ${quote(config.version)}`, ''];
    for (const [sourceId, source] of Object.entries(config.sources).sort(([left], [right]) => left.localeCompare(right))) {
        lines.push(`[sources.${sourceId}]`);
        if (source.path) {
            lines.push(`path = ${quote(source.path)}`);
        }
        if (source.adapter) {
            lines.push(`adapter = ${quote(source.adapter)}`);
        }
        if (source.role) {
            lines.push(`role = ${quote(source.role)}`);
        }
        if (source.url) {
            lines.push(`url = ${quote(source.url)}`);
        }
        if (source.branch) {
            lines.push(`branch = ${quote(source.branch)}`);
        }
        lines.push('');
    }
    if (config.traceability) {
        lines.push('[traceability]');
        if (typeof config.traceability.cross_repo === 'boolean') {
            lines.push(`cross_repo = ${config.traceability.cross_repo}`);
        }
        if (typeof config.traceability.resolve_remote_ids === 'boolean') {
            lines.push(`resolve_remote_ids = ${config.traceability.resolve_remote_ids}`);
        }
        lines.push('');
    }
    if (config.resolve) {
        lines.push('[resolve]');
        if (config.resolve.workdir) {
            lines.push(`workdir = ${quote(config.resolve.workdir)}`);
        }
        if (config.resolve.namespace && Object.keys(config.resolve.namespace).length > 0) {
            lines.push('');
            lines.push('[resolve.namespace]');
            for (const [host, value] of Object.entries(config.resolve.namespace).sort(([left], [right]) => left.localeCompare(right))) {
                lines.push(`${quoteKey(host)} = ${quote(value)}`);
            }
            lines.push('');
        } else {
            lines.push('');
        }
    }
    if (config.validation?.allowed_content_languages && config.validation.allowed_content_languages.length > 0) {
        lines.push('[validation]');
        lines.push(`allowed_content_languages = [${config.validation.allowed_content_languages.map(language => quote(language)).join(', ')}]`);
        lines.push('');
    }
    return `${lines.join('\n').replace(/\n{3,}/gu, '\n\n').trimEnd()}\n`;
}

function quote(value: string): string {
    return JSON.stringify(value);
}

function quoteKey(value: string): string {
    return /[A-Za-z0-9_-]+/u.test(value) ? value : quote(value);
}

function valueOrEmpty(value: unknown): string {
    return typeof value === 'string' ? value : '';
}

function resolveMigrationStatus(
    mode: WorkspaceStartupMode,
    transaction?: WorkspaceMigrationTransaction
): WorkspaceMigrationState['status'] {
    if (transaction?.phase === 'rolled-back') {
        return 'rolled-back';
    }
    if (transaction?.phase === 'failed') {
        return 'failed';
    }
    if (transaction?.phase === 'pending-write' || transaction?.phase === 'written') {
        return 'recovering';
    }
    if (transaction?.phase === 'rollback-available') {
        return 'completed';
    }
    if (mode === 'canonical-active') {
        return 'not-needed';
    }
    return 'pending';
}

function freezeMigrationState(state: WorkspaceMigrationState): WorkspaceMigrationState {
    return Object.freeze({ ...state });
}

function freezeDiagnostics(diagnostics: readonly WorkspaceDiagnostic[]): readonly WorkspaceDiagnostic[] {
    return Object.freeze(diagnostics.map(diagnostic => Object.freeze({ ...diagnostic })));
}

function createDiagnostic(
    code: string,
    severity: WorkspaceDiagnostic['severity'],
    message: string,
    diagnosticPath: string
): WorkspaceDiagnostic {
    return {
        code,
        severity,
        scope: 'migration',
        message,
        path: diagnosticPath
    };
}

function emptyConfig(): NativeWorkspaceConfigData {
    return {
        version: SUPPORTED_WORKSPACE_CONFIG_VERSION,
        sources: {}
    };
}

async function writeCanonicalFileAtomically(targetPath: string, body: string): Promise<void> {
    const tempPath = `${targetPath}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tempPath, body, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
    await fsyncPath(tempPath);
    await fs.rename(tempPath, targetPath);
    await fsyncDirectory(path.dirname(targetPath));
}

async function fsyncPath(candidatePath: string): Promise<void> {
    const handle = await fs.open(candidatePath, 'r');
    try {
        await handle.sync();
    } finally {
        await handle.close();
    }
}

async function fsyncDirectory(directoryPath: string): Promise<void> {
    const handle = await fs.open(directoryPath, 'r');
    try {
        await handle.sync();
    } finally {
        await handle.close();
    }
}

function createTransactionId(): string {
    return `txn-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 10)}`;
}

async function loadTomlParserModuleBridge() {
    const importTomlParser = new Function(
        'return import("toml-eslint-parser");'
    ) as () => Promise<any>;
    return importTomlParser();
}
