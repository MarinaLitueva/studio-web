import * as fs from 'fs/promises';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { execFile } from 'child_process';
import { injectable } from '@theia/core/shared/inversify';

const DEFAULT_TIMEOUT_MS = 300_000;
const MIN_CONFIGURED_TIMEOUT_MS = 1_000;
const MAX_CONFIGURED_TIMEOUT_MS = 1_800_000;
const CAPABILITY_TIMEOUT_MS = 10_000;
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
const MAX_MAP_FILE_BYTES = 32 * 1024 * 1024;

export const CfsMapRunner = Symbol('CfsMapRunner');

export interface CfsMapRunRequest {
    readonly workspaceRoot: string;
    readonly repositoryRoot: string;
    readonly dataDir: string;
    readonly timeoutMs?: number;
}

export interface CfsMapEngine {
    readonly command: string;
    readonly version: string;
}

export interface CfsMapRunResult {
    readonly payload: unknown;
    readonly engine: CfsMapEngine;
    readonly stderr: string;
}

interface CommandCandidate {
    readonly executable: string;
    readonly prefixArguments: readonly string[];
    readonly identity: string;
}

interface CommandResult {
    readonly stdout: string;
    readonly stderr: string;
}

class CommandExecutionError extends Error {
    constructor(
        message: string,
        readonly code: string | number | undefined,
        readonly stderr: string
    ) {
        super(message);
    }
}

@injectable()
export class CfsMapRunnerImpl {
    async run(request: CfsMapRunRequest): Promise<CfsMapRunResult> {
        const workspaceRoot = await fs.realpath(request.workspaceRoot);
        const repositoryRoot = await fs.realpath(request.repositoryRoot);
        const timeoutMs = request.timeoutMs ?? configuredMapTimeoutMs();
        const outputDirectory = path.join(request.dataDir, 'cfs-map-output');
        await fs.mkdir(outputDirectory, { recursive: true });
        const outputPath = path.join(outputDirectory, `${randomUUID()}.json`);
        const failures: string[] = [];

        try {
            for (const candidate of await this.commandCandidates(workspaceRoot)) {
                const capability = await this.probeCapability(candidate, repositoryRoot);
                if (!capability.available) {
                    failures.push(`${candidate.identity}: ${capability.reason}`);
                    continue;
                }
                try {
                    const result = await runCommand(
                        candidate,
                        ['map', '--format', 'json', '--local-only', '--out', outputPath],
                        repositoryRoot,
                        timeoutMs
                    );
                    const outputStat = await fs.stat(outputPath);
                    if (outputStat.size > MAX_MAP_FILE_BYTES) {
                        throw new Error(`cfs map output exceeds the ${MAX_MAP_FILE_BYTES} byte limit`);
                    }
                    const raw = await fs.readFile(outputPath, 'utf8');
                    let payload: unknown;
                    try {
                        payload = JSON.parse(raw);
                    } catch (error) {
                        throw new Error(`cfs map returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
                    }
                    return {
                        payload,
                        engine: {
                            command: candidate.identity,
                            version: capability.version
                        },
                        stderr: result.stderr.trim()
                    };
                } catch (error) {
                    if (isCommandMissing(error)) {
                        failures.push(`${candidate.identity}: command unavailable`);
                        continue;
                    }
                    throw error;
                }
            }
        } finally {
            await fs.rm(outputPath, { force: true });
        }
        throw new Error(`No cfs map capability is available (${failures.join('; ')})`);
    }

    protected async commandCandidates(workspaceRoot: string): Promise<readonly CommandCandidate[]> {
        const candidates: CommandCandidate[] = [];
        const configured = process.env.STUDIO_CFS_COMMAND?.trim();
        if (configured) {
            if (configured.includes('\0')) {
                throw new Error('STUDIO_CFS_COMMAND contains an invalid NUL byte');
            }
            candidates.push({
                executable: configured,
                prefixArguments: [],
                identity: configured
            });
        }
        if (configured !== 'cfs') {
            candidates.push({
                executable: 'cfs',
                prefixArguments: [],
                identity: 'cfs'
            });
        }

        const localScript = path.join(
            workspaceRoot,
            '.cf-studio',
            '.core',
            'skills',
            'studio',
            'scripts',
            'studio.py'
        );
        try {
            const canonicalScript = await fs.realpath(localScript);
            candidates.push({
                executable: 'python3',
                prefixArguments: [canonicalScript],
                identity: canonicalScript
            });
        } catch (error) {
            if (!isMissingFileError(error)) {
                throw error;
            }
        }
        return candidates;
    }

    protected async probeCapability(
        candidate: CommandCandidate,
        cwd: string
    ): Promise<{ readonly available: true; readonly version: string } | { readonly available: false; readonly reason: string }> {
        try {
            await runCommand(candidate, ['map', '--help'], cwd, CAPABILITY_TIMEOUT_MS);
        } catch (error) {
            return {
                available: false,
                reason: isCommandMissing(error)
                    ? 'command unavailable'
                    : error instanceof Error ? error.message : String(error)
            };
        }

        try {
            const version = await runCommand(candidate, ['--version'], cwd, CAPABILITY_TIMEOUT_MS);
            return {
                available: true,
                version: firstNonEmptyLine(version.stdout) ?? 'unknown'
            };
        } catch {
            return { available: true, version: 'unknown' };
        }
    }
}

function configuredMapTimeoutMs(): number {
    const configured = process.env.STUDIO_CFS_MAP_TIMEOUT_MS;
    if (configured === undefined) {
        return DEFAULT_TIMEOUT_MS;
    }
    if (!/^[1-9]\d*$/u.test(configured)) {
        throw new Error(
            `STUDIO_CFS_MAP_TIMEOUT_MS must be an integer between ${MIN_CONFIGURED_TIMEOUT_MS} and ${MAX_CONFIGURED_TIMEOUT_MS}`
        );
    }
    const timeoutMs = Number(configured);
    if (!Number.isSafeInteger(timeoutMs)
        || timeoutMs < MIN_CONFIGURED_TIMEOUT_MS
        || timeoutMs > MAX_CONFIGURED_TIMEOUT_MS) {
        throw new Error(
            `STUDIO_CFS_MAP_TIMEOUT_MS must be an integer between ${MIN_CONFIGURED_TIMEOUT_MS} and ${MAX_CONFIGURED_TIMEOUT_MS}`
        );
    }
    return timeoutMs;
}

function runCommand(
    candidate: CommandCandidate,
    arguments_: readonly string[],
    cwd: string,
    timeoutMs: number
): Promise<CommandResult> {
    return new Promise((resolve, reject) => {
        execFile(
            candidate.executable,
            [...candidate.prefixArguments, ...arguments_],
            {
                cwd,
                timeout: timeoutMs,
                maxBuffer: MAX_OUTPUT_BYTES,
                windowsHide: true,
                shell: false
            },
            (error, stdout, stderr) => {
                if (error) {
                    const code = (error as NodeJS.ErrnoException & { killed?: boolean }).code;
                    const timedOut = (error as NodeJS.ErrnoException & { killed?: boolean }).killed === true;
                    reject(new CommandExecutionError(
                        timedOut
                            ? `${candidate.identity} timed out after ${timeoutMs}ms`
                            : `${candidate.identity} exited unsuccessfully${code === undefined ? '' : ` (${String(code)})`}`,
                        code,
                        String(stderr)
                    ));
                    return;
                }
                resolve({ stdout: String(stdout), stderr: String(stderr) });
            }
        );
    });
}

function firstNonEmptyLine(value: string): string | undefined {
    return value.split(/\r?\n/u).map(line => line.trim()).find(Boolean);
}

function isCommandMissing(error: unknown): boolean {
    return error instanceof CommandExecutionError && error.code === 'ENOENT';
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
    return typeof error === 'object' && error !== null && 'code' in error
        && (error as NodeJS.ErrnoException).code === 'ENOENT';
}
