import { execFile } from 'child_process';
import { injectable } from '@theia/core/shared/inversify';

import { RepositoryRegistry } from './repository-registry';
import type { StudioKitInstallRequest, StudioKitInstallResult } from '../common/studio-protocol';

const INSTALL_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
const OFFICIAL_KITS: Readonly<Record<string, string>> = Object.freeze({
    sdlc: 'constructorfabric/studio-kit-sdlc'
});
const SAFE_GIT_REF = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,119}$/u;

export const KitInstaller = Symbol('KitInstaller');

interface CommandResult {
    readonly stdout: string;
    readonly stderr: string;
}

@injectable()
export class KitInstallerImpl {
    protected readonly activeRepositories = new Set<string>();

    async install(
        request: StudioKitInstallRequest,
        repositories: RepositoryRegistry
    ): Promise<StudioKitInstallResult> {
        const source = OFFICIAL_KITS[request.kitSlug];
        if (!source) {
            throw new Error(`Kit is not allow-listed: ${request.kitSlug}`);
        }
        const version = request.version.trim();
        if (!isSafeGitRef(version)) {
            throw new Error('Kit version is not a safe Git ref');
        }
        const repository = request.repositoryId
            ? repositories.requireRepository(request.repositoryId)
            : requireSingleRepository(repositories);
        if (this.activeRepositories.has(repository.descriptor.repositoryId)) {
            throw new Error(`A kit operation is already running for ${repository.descriptor.label}`);
        }

        this.activeRepositories.add(repository.descriptor.repositoryId);
        try {
            const installed = await this.run(
                ['kit', 'install', source, '--version', version],
                repository.canonicalRoot
            );
            const generated = await this.run(['generate-agents'], repository.canonicalRoot);
            return {
                kitSlug: request.kitSlug,
                version,
                repositoryId: repository.descriptor.repositoryId,
                repositoryLabel: repository.descriptor.label,
                output: joinOutput(installed, generated)
            };
        } finally {
            this.activeRepositories.delete(repository.descriptor.repositoryId);
        }
    }

    protected run(arguments_: readonly string[], cwd: string): Promise<CommandResult> {
        return new Promise((resolve, reject) => {
            execFile('cfs', [...arguments_], {
                cwd,
                timeout: INSTALL_TIMEOUT_MS,
                maxBuffer: MAX_OUTPUT_BYTES,
                windowsHide: true,
                shell: false
            }, (error, stdout, stderr) => {
                if (error) {
                    const detail = String(stderr).trim() || String(stdout).trim() || error.message;
                    reject(new Error(`cfs ${arguments_[0]} failed: ${detail}`));
                    return;
                }
                resolve({ stdout: String(stdout), stderr: String(stderr) });
            });
        });
    }
}

function requireSingleRepository(repositories: RepositoryRegistry) {
    const available = repositories.repositories;
    if (available.length !== 1) {
        throw new Error('repositoryId is required when the workspace contains multiple repositories');
    }
    return available[0];
}

function isSafeGitRef(value: string): boolean {
    return SAFE_GIT_REF.test(value)
        && !value.includes('..')
        && !value.includes('@{')
        && !value.endsWith('/')
        && !value.endsWith('.lock');
}

function joinOutput(...results: readonly CommandResult[]): string {
    return results
        .flatMap(result => [result.stdout.trim(), result.stderr.trim()])
        .filter(Boolean)
        .join('\n')
        .slice(0, 16_384);
}
