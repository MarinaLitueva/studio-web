import { createHash } from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import URI from '@theia/core/lib/common/uri';
import { Disposable, Emitter, Event } from '@theia/core/lib/common';
import { injectable } from '@theia/core/shared/inversify';
import {
    StudioRepositoryDescriptor,
    StudioRepositoryGitDescriptor
} from '../common/studio-protocol';

export interface RepositoryRegistration {
    readonly repositoryRoot: string;
    readonly gitDirectory?: string;
    readonly commonDirectory?: string;
    readonly git?: StudioRepositoryGitDescriptor;
    readonly sourceId?: string;
}

export interface RepositoryRegistryReplaceOptions {
    readonly allowConfiguredExternalRoots?: readonly string[];
}

export interface RegisteredRepository {
    readonly descriptor: StudioRepositoryDescriptor;
    readonly canonicalRoot: string;
    readonly canonicalGitDirectory: string;
    readonly canonicalCommonDirectory: string;
}

const UNCONFIGURED_GIT: StudioRepositoryGitDescriptor = {
    configRevision: 'unconfigured',
    mode: 'disabled',
    publishEnabled: false,
    disabledReason: 'Repository Git configuration has not been discovered'
};

@injectable()
export class RepositoryRegistry implements Disposable {
    protected canonicalWorkspaceRoot: string | undefined;
    protected canonicalConfiguredRepositoryRoot: string | undefined;
    protected readonly repositoriesById = new Map<string, RegisteredRepository>();
    protected repositoriesByDepth: RegisteredRepository[] = [];
    protected readonly onDidChangeRepositoriesEmitter = new Emitter<readonly StudioRepositoryDescriptor[]>();

    readonly onDidChangeRepositories: Event<readonly StudioRepositoryDescriptor[]> =
        this.onDidChangeRepositoriesEmitter.event;

    async initialize(workspaceRoot: string, configuredRepositoryRoot = workspaceRoot): Promise<void> {
        const [canonicalWorkspaceRoot, canonicalConfiguredRepositoryRoot] = await Promise.all([
            fs.realpath(workspaceRoot),
            fs.realpath(configuredRepositoryRoot)
        ]);
        assertWithin(
            canonicalConfiguredRepositoryRoot,
            canonicalWorkspaceRoot,
            'Configured workspace root must be inside the configured repository root'
        );
        this.canonicalWorkspaceRoot = canonicalWorkspaceRoot;
        this.canonicalConfiguredRepositoryRoot = canonicalConfiguredRepositoryRoot;
    }

    get descriptors(): readonly StudioRepositoryDescriptor[] {
        return this.repositoriesByDepth.map(repository => repository.descriptor);
    }

    get repositories(): readonly RegisteredRepository[] {
        return [...this.repositoriesByDepth];
    }

    getRepository(repositoryId: string): RegisteredRepository | undefined {
        return this.repositoriesById.get(repositoryId);
    }

    requireRepository(repositoryId: string): RegisteredRepository {
        const repository = this.getRepository(repositoryId);
        if (!repository) {
            throw new Error(`Unknown repository: ${repositoryId}`);
        }
        return repository;
    }

    updateGitDescriptor(repositoryId: string, git: StudioRepositoryGitDescriptor): StudioRepositoryDescriptor {
        const repository = this.requireRepository(repositoryId);
        const updated: RegisteredRepository = {
            ...repository,
            descriptor: {
                ...repository.descriptor,
                git
            }
        };
        this.repositoriesById.set(repositoryId, updated);
        this.repositoriesByDepth = this.repositoriesByDepth.map(candidate =>
            candidate.descriptor.repositoryId === repositoryId ? updated : candidate
        );
        this.onDidChangeRepositoriesEmitter.fire(this.descriptors);
        return updated.descriptor;
    }

    async replace(
        registrations: readonly RepositoryRegistration[],
        options?: RepositoryRegistryReplaceOptions
    ): Promise<readonly StudioRepositoryDescriptor[]> {
        const allowedExternalRoots = await this.canonicalizeAllowedExternalRoots(
            options?.allowConfiguredExternalRoots ?? []
        );
        const canonicalRepositories = new Map<string, RegisteredRepository>();
        for (const registration of registrations) {
            const repository = await this.canonicalizeRegistration(registration, allowedExternalRoots);
            canonicalRepositories.set(normalizeForComparison(repository.canonicalRoot), repository);
        }

        const nextRepositoriesById = new Map<string, RegisteredRepository>();
        for (const repository of canonicalRepositories.values()) {
            const existing = nextRepositoriesById.get(repository.descriptor.repositoryId);
            if (existing && !samePath(existing.canonicalRoot, repository.canonicalRoot)) {
                throw new Error(`Repository identity collision: ${repository.descriptor.repositoryId}`);
            }
            nextRepositoriesById.set(repository.descriptor.repositoryId, repository);
        }
        const nextRepositoriesByDepth = [...nextRepositoriesById.values()]
            .sort(compareRepositoriesForDepth);
        const nextDescriptors = nextRepositoriesByDepth.map(repository => repository.descriptor);
        if (sameDescriptorList(this.descriptors, nextDescriptors)) {
            return this.descriptors;
        }
        this.repositoriesById.clear();
        for (const repository of nextRepositoriesById.values()) {
            this.repositoriesById.set(repository.descriptor.repositoryId, repository);
        }
        this.repositoriesByDepth = nextRepositoriesByDepth;
        this.onDidChangeRepositoriesEmitter.fire(this.descriptors);
        return this.descriptors;
    }

    async resolveOwner(filePath: string): Promise<RegisteredRepository> {
        const canonicalFilePath = await fs.realpath(filePath);
        return this.resolveOwnerForCanonicalPath(canonicalFilePath);
    }

    resolveOwnerForCanonicalPath(canonicalFilePath: string): RegisteredRepository {
        const workspaceRoot = this.requireCanonicalWorkspaceRoot();
        const repository = this.repositoriesByDepth.find(candidate =>
            isWithin(candidate.canonicalRoot, canonicalFilePath)
        );
        if (!repository) {
            assertWithin(workspaceRoot, canonicalFilePath, 'File path escapes the configured workspace root');
            throw new Error('No registered repository owns the file path');
        }
        return repository;
    }

    dispose(): void {
        this.repositoriesById.clear();
        this.repositoriesByDepth = [];
        this.onDidChangeRepositoriesEmitter.dispose();
    }

    protected async canonicalizeRegistration(
        registration: RepositoryRegistration,
        allowedExternalRoots: ReadonlySet<string>
    ): Promise<RegisteredRepository> {
        const workspaceRoot = this.requireCanonicalWorkspaceRoot();
        const canonicalRoot = await fs.realpath(registration.repositoryRoot);
        const configuredRepositoryRoot = this.requireCanonicalConfiguredRepositoryRoot();
        const isAllowedExternalRoot = allowedExternalRoots.has(normalizeForComparison(canonicalRoot));
        if (!isWithin(workspaceRoot, canonicalRoot)
            && !samePath(configuredRepositoryRoot, canonicalRoot)
            && !isAllowedExternalRoot) {
            throw new Error('Repository working tree must be inside the configured workspace or be its configured containing repository');
        }

        const canonicalGitDirectory = await canonicalizeOptionalPath(
            registration.gitDirectory,
            canonicalRoot
        );
        const canonicalCommonDirectory = await canonicalizeOptionalPath(
            registration.commonDirectory,
            canonicalGitDirectory
        );
        const repositoryId = hashIdentity(`${canonicalRoot}\0${canonicalCommonDirectory}`);
        const fingerprint = hashIdentity(canonicalCommonDirectory);
        const workspaceRelativeRoot = toWorkspaceRelativePath(workspaceRoot, canonicalRoot);

        return {
            canonicalRoot,
            canonicalGitDirectory,
            canonicalCommonDirectory,
            descriptor: {
                schemaVersion: 1,
                repositoryId,
                fingerprint,
                rootUri: URI.fromFilePath(canonicalRoot).normalizePath().toString(),
                workspaceRelativeRoot,
                label: path.basename(canonicalRoot),
                git: registration.git ?? UNCONFIGURED_GIT
            }
        };
    }

    protected requireCanonicalWorkspaceRoot(): string {
        if (!this.canonicalWorkspaceRoot) {
            throw new Error('Repository registry is not initialized');
        }
        return this.canonicalWorkspaceRoot;
    }

    protected requireCanonicalConfiguredRepositoryRoot(): string {
        if (!this.canonicalConfiguredRepositoryRoot) {
            throw new Error('Repository registry is not initialized');
        }
        return this.canonicalConfiguredRepositoryRoot;
    }

    protected async canonicalizeAllowedExternalRoots(candidateRoots: readonly string[]): Promise<ReadonlySet<string>> {
        const canonicalRoots = new Set<string>();
        for (const candidateRoot of candidateRoots) {
            canonicalRoots.add(normalizeForComparison(await fs.realpath(candidateRoot)));
        }
        return canonicalRoots;
    }
}

async function canonicalizeOptionalPath(candidate: string | undefined, fallback: string): Promise<string> {
    return candidate ? fs.realpath(candidate) : fallback;
}

function hashIdentity(value: string): string {
    return createHash('sha256').update(value).digest('hex');
}

function toWorkspaceRelativePath(workspaceRoot: string, repositoryRoot: string): string {
    const relativePath = path.relative(workspaceRoot, repositoryRoot).replace(/\\/g, '/');
    return !relativePath || relativePath === '.' || relativePath === '..' || relativePath.startsWith('../')
        ? '.'
        : relativePath;
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

function assertWithin(parent: string, candidate: string, message: string): void {
    if (!isWithin(parent, candidate)) {
        throw new Error(message);
    }
}

function compareRepositoriesForDepth(left: RegisteredRepository, right: RegisteredRepository): number {
    return right.canonicalRoot.length - left.canonicalRoot.length
        || left.canonicalRoot.localeCompare(right.canonicalRoot);
}

function sameDescriptorList(
    left: readonly StudioRepositoryDescriptor[],
    right: readonly StudioRepositoryDescriptor[]
): boolean {
    if (left.length !== right.length) {
        return false;
    }
    return left.every((descriptor, index) => sameDescriptor(descriptor, right[index]));
}

function sameDescriptor(left: StudioRepositoryDescriptor, right: StudioRepositoryDescriptor): boolean {
    return left.schemaVersion === right.schemaVersion
        && left.repositoryId === right.repositoryId
        && left.fingerprint === right.fingerprint
        && left.rootUri === right.rootUri
        && left.workspaceRelativeRoot === right.workspaceRelativeRoot
        && left.label === right.label
        && sameGitDescriptor(left.git, right.git);
}

function sameGitDescriptor(left: StudioRepositoryGitDescriptor, right: StudioRepositoryGitDescriptor): boolean {
    return left.configRevision === right.configRevision
        && left.mode === right.mode
        && left.branch === right.branch
        && left.remote === right.remote
        && left.fetchSourceUrl === right.fetchSourceUrl
        && left.pushSourceUrl === right.pushSourceUrl
        && left.fetchUrl === right.fetchUrl
        && left.pushUrl === right.pushUrl
        && left.authorName === right.authorName
        && left.authorEmail === right.authorEmail
        && left.publishEnabled === right.publishEnabled
        && left.disabledReason === right.disabledReason;
}
