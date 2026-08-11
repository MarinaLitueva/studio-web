import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import Ajv2020, { type ErrorObject } from 'ajv/dist/2020';
import type { AST } from 'toml-eslint-parser';
import type { WorkspaceDiagnostic } from '../common/workspace-protocol';
import workspaceConfigSchema = require('../common/workspace-config-schema.json');

export const CANONICAL_WORKSPACE_CONFIG_FILENAME = '.cf-workspace.toml';
export const LEGACY_WORKSPACE_CONFIG_FILENAME = '.studio-workspace.toml';
export const SUPPORTED_WORKSPACE_CONFIG_VERSION = '1.0';

export type WorkspaceConfigDetection = 'canonical' | 'legacy' | 'missing';
export type WorkspaceConfigState = 'valid' | 'invalid' | 'unsupported' | 'missing' | 'legacy';

export interface WorkspaceSourceEntry {
    readonly path?: string;
    readonly adapter?: string;
    readonly role?: 'artifacts' | 'codebase' | 'kits' | 'full';
    readonly url?: string;
    readonly branch?: string;
}

export interface WorkspaceTraceabilityConfig {
    readonly cross_repo?: boolean;
    readonly resolve_remote_ids?: boolean;
}

export interface WorkspaceResolveConfig {
    readonly workdir?: string;
    readonly namespace?: Readonly<Record<string, string>>;
}

export interface WorkspaceValidationConfig {
    readonly allowed_content_languages?: readonly string[];
}

export interface NativeWorkspaceConfigData {
    readonly version: string;
    readonly sources: Readonly<Record<string, WorkspaceSourceEntry>>;
    readonly traceability?: WorkspaceTraceabilityConfig;
    readonly resolve?: WorkspaceResolveConfig;
    readonly validation?: WorkspaceValidationConfig;
}

export interface WorkspaceConfigLoadResult {
    readonly detection: WorkspaceConfigDetection;
    readonly state: WorkspaceConfigState;
    readonly configPath: string;
    readonly parsedData?: NativeWorkspaceConfigData;
    readonly rawToml?: string;
    readonly ast?: AST.TOMLProgram;
    readonly revision?: string;
    readonly diagnostics: readonly WorkspaceDiagnostic[];
}

const ajv = new Ajv2020({
    allErrors: true,
    strict: false
});
const validateWorkspaceConfig = ajv.compile<NativeWorkspaceConfigData>(workspaceConfigSchema);
export interface TomlParserError extends Error {
    readonly lineNumber: number;
    readonly column: number;
}

export interface TomlParserModule {
    readonly ParseError: new (...args: readonly unknown[]) => TomlParserError;
    parseForESLint(code: string, options?: {
        readonly filePath?: string;
        readonly tomlVersion?: '1.0';
    }): { ast: AST.TOMLProgram };
    getStaticTOMLValue(ast: AST.TOMLProgram): unknown;
}
export type TomlParserLoader = () => Promise<TomlParserModule>;
let tomlParserModulePromise: Promise<TomlParserModule> | undefined;

export class WorkspaceConfigService {
    constructor(
        protected readonly tomlParserLoader: TomlParserLoader = loadTomlParserModule
    ) {}

    async load(workspaceRoot: string): Promise<WorkspaceConfigLoadResult> {
        const canonicalRoot = await fs.realpath(workspaceRoot);
        const configPath = path.join(canonicalRoot, CANONICAL_WORKSPACE_CONFIG_FILENAME);
        const legacyPath = path.join(canonicalRoot, LEGACY_WORKSPACE_CONFIG_FILENAME);

        const [canonicalStat, legacyStat] = await Promise.all([
            statIfExists(configPath),
            statIfExists(legacyPath)
        ]);

        if (!canonicalStat && !legacyStat) {
            return {
                detection: 'missing',
                state: 'missing',
                configPath,
                diagnostics: [diagnostic('workspace.config.missing', 'warning', 'Workspace config file was not found.', configPath)]
            };
        }

        if (!canonicalStat && legacyStat) {
            return {
                detection: 'legacy',
                state: 'legacy',
                configPath,
                diagnostics: [diagnostic(
                    'workspace.config.legacy_detected',
                    'warning',
                    `Legacy workspace config detected at ${legacyPath}. Native loading only activates ${CANONICAL_WORKSPACE_CONFIG_FILENAME}.`,
                    legacyPath
                )]
            };
        }

        if (canonicalStat?.isSymbolicLink()) {
            const realPath = await fs.realpath(configPath);
            if (!isWithinRoot(canonicalRoot, realPath)) {
                return {
                    detection: 'canonical',
                    state: 'invalid',
                    configPath,
                    diagnostics: [diagnostic(
                        'workspace.config.symlink_escape',
                        'error',
                        'Workspace config symlink resolves outside the explicit workspace root.',
                        configPath
                    )]
                };
            }
        }

        const rawToml = await fs.readFile(configPath, 'utf8');
        return this.inspectRawToml(configPath, rawToml);
    }

    async inspectRawToml(configPath: string, rawToml: string): Promise<WorkspaceConfigLoadResult> {
        const revision = sha256(rawToml);
        let ast: AST.TOMLProgram | undefined;
        let parsedData: NativeWorkspaceConfigData | undefined;
        const tomlParser = await this.tomlParserLoader();

        try {
            ast = tomlParser.parseForESLint(rawToml, {
                filePath: configPath,
                tomlVersion: SUPPORTED_WORKSPACE_CONFIG_VERSION
            }).ast;
            parsedData = tomlParser.getStaticTOMLValue(ast) as unknown as NativeWorkspaceConfigData;
        } catch (error) {
            if (error instanceof tomlParser.ParseError) {
                return {
                    detection: 'canonical',
                    state: 'invalid',
                    configPath,
                    rawToml,
                    revision,
                    diagnostics: [diagnostic(
                        'workspace.config.parse_error',
                        'error',
                        `Invalid TOML at line ${error.lineNumber}, column ${error.column}: ${error.message}`,
                        configPath
                    )]
                };
            }
            throw error;
        }

        if (!isWorkspaceConfigObject(parsedData)) {
            return {
                detection: 'canonical',
                state: 'invalid',
                configPath,
                rawToml,
                ast,
                revision,
                diagnostics: [diagnostic(
                    'workspace.config.invalid_root',
                    'error',
                    'Workspace config must parse to a TOML table object.',
                    configPath
                )]
            };
        }

        if (parsedData.version !== SUPPORTED_WORKSPACE_CONFIG_VERSION) {
            return {
                detection: 'canonical',
                state: 'unsupported',
                configPath,
                parsedData,
                rawToml,
                ast,
                revision,
                diagnostics: [diagnostic(
                    'workspace.config.unsupported_version',
                    'warning',
                    `Unsupported workspace config version "${parsedData.version}". Supported version is ${SUPPORTED_WORKSPACE_CONFIG_VERSION}.`,
                    configPath
                )]
            };
        }

        if (!validateWorkspaceConfig(parsedData)) {
            return {
                detection: 'canonical',
                state: 'invalid',
                configPath,
                parsedData,
                rawToml,
                ast,
                revision,
                diagnostics: buildSchemaDiagnostics(configPath, validateWorkspaceConfig.errors ?? [])
            };
        }

        const semanticDiagnostics = validateSemanticWorkspaceConfig(configPath, parsedData);
        if (semanticDiagnostics.length > 0) {
            return {
                detection: 'canonical',
                state: 'invalid',
                configPath,
                parsedData,
                rawToml,
                ast,
                revision,
                diagnostics: semanticDiagnostics
            };
        }

        return {
            detection: 'canonical',
            state: 'valid',
            configPath,
            parsedData,
            rawToml,
            ast,
            revision,
            diagnostics: []
        };
    }
}

function buildSchemaDiagnostics(configPath: string, errors: readonly ErrorObject[]): readonly WorkspaceDiagnostic[] {
    return [...errors]
        .sort((left, right) => {
            const leftKey = `${left.instancePath}|${left.schemaPath}|${left.keyword}`;
            const rightKey = `${right.instancePath}|${right.schemaPath}|${right.keyword}`;
            return leftKey.localeCompare(rightKey);
        })
        .map(error => diagnostic(
            `workspace.config.schema.${error.keyword}`,
            'error',
            formatSchemaError(error),
            toDiagnosticPath(configPath, error.instancePath)
        ));
}

function formatSchemaError(error: ErrorObject): string {
    const location = error.instancePath || '/';
    const suffix = error.message ? `: ${error.message}` : '';
    return `Workspace config schema validation failed at ${location}${suffix}`;
}

function toDiagnosticPath(configPath: string, instancePath: string): string {
    if (!instancePath) {
        return configPath;
    }
    return `${configPath}#${instancePath}`;
}

function validateSemanticWorkspaceConfig(
    configPath: string,
    parsedData: NativeWorkspaceConfigData
): readonly WorkspaceDiagnostic[] {
    const workdir = parsedData.resolve?.workdir?.trim();
    if (!workdir) {
        return [];
    }

    if (path.isAbsolute(workdir)) {
        return [diagnostic(
            'workspace.config.resolve.workdir_absolute',
            'error',
            'Workspace resolve.workdir must be relative to the workspace root.',
            `${configPath}#/resolve/workdir`
        )];
    }

    const workspaceRoot = path.dirname(configPath);
    const resolvedWorkdir = path.resolve(workspaceRoot, workdir);
    if (!isWithinRoot(workspaceRoot, resolvedWorkdir)) {
        return [diagnostic(
            'workspace.config.resolve.workdir_escape',
            'error',
            'Workspace resolve.workdir must stay within the workspace root.',
            `${configPath}#/resolve/workdir`
        )];
    }

    return [];
}

function diagnostic(
    code: string,
    severity: WorkspaceDiagnostic['severity'],
    message: string,
    diagnosticPath: string
): WorkspaceDiagnostic {
    return {
        code,
        severity,
        scope: 'config',
        message,
        path: diagnosticPath
    };
}

function isWorkspaceConfigObject(value: unknown): value is NativeWorkspaceConfigData {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function loadTomlParserModule(): Promise<TomlParserModule> {
    if (!tomlParserModulePromise) {
        // Keep the specifier constant inside a Function body so CommonJS emit does not
        // rewrite this native ESM import into require(). No user input reaches this bridge.
        const importTomlParser = new Function(
            'return import("toml-eslint-parser");'
        ) as () => Promise<TomlParserModule>;
        tomlParserModulePromise = importTomlParser();
    }
    return tomlParserModulePromise;
}

export function sha256(rawToml: string): string {
    return crypto.createHash('sha256').update(rawToml, 'utf8').digest('hex');
}

function isWithinRoot(rootPath: string, candidatePath: string): boolean {
    const relative = path.relative(rootPath, candidatePath);
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

async function statIfExists(candidatePath: string): Promise<import('fs').Stats | undefined> {
    try {
        return await fs.lstat(candidatePath);
    } catch (error) {
        if (isMissingFileError(error)) {
            return undefined;
        }
        throw error;
    }
}

export function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
    return typeof error === 'object' && error !== null && 'code' in error && (error as NodeJS.ErrnoException).code === 'ENOENT';
}
