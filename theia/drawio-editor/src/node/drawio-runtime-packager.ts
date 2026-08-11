import * as crypto from 'node:crypto';
import * as fs from 'node:fs';
import { promises as fsp } from 'node:fs';
import * as path from 'node:path';
import { Readable, Writable } from 'node:stream';
import yauzl = require('yauzl');

export const DRAWIO_RUNTIME_PACKAGER_VERSION = '30.0.4';

const EXPECTED_WAR_BYTES = 52723743;
const EXPECTED_WAR_SHA256 = 'cb40abb5f750f549444c94c00de086218b47e30b33fbc4dd0476118afd8ec19d';
const DEFAULT_MAX_ENTRIES = 4096;
const DEFAULT_MAX_ENTRY_UNCOMPRESSED_BYTES = 32 * 1024 * 1024;
const DEFAULT_MAX_TOTAL_UNCOMPRESSED_BYTES = 192 * 1024 * 1024;
const DEFAULT_MAX_COMPRESSION_RATIO = 64;
const DIRECTORY_UNIX_MODE = 0o040000;
const FILE_UNIX_MODE = 0o100000;
const SYMLINK_UNIX_MODE = 0o120000;
const UNIX_FILE_TYPE_MASK = 0o170000;
const JSON_INDENT = 2;
const JSON_TRAILING_NEWLINE = '\n';

type UnixFileType = 'file' | 'directory' | 'symlink' | 'other';
type InventoryVerdict = 'candidate';
type JsonBytes = Buffer | Uint8Array | string;

export interface DrawioRuntimePolicyInput {
    runtimeVersion: string;
    maxEntries: number;
    maxEntryUncompressedBytes: number;
    maxTotalUncompressedBytes: number;
    maxCompressionRatio: number;
}

export interface DrawioRuntimePolicy {
    runtimeVersion: string;
    maxEntries: number;
    maxEntryUncompressedBytes: number;
    maxTotalUncompressedBytes: number;
    maxCompressionRatio: number;
}

export interface ArchiveValidationState {
    policy: DrawioRuntimePolicy;
    entryCount: number;
    totalUncompressedBytes: number;
    normalizedPaths: Set<string>;
    lowercasePaths: Set<string>;
    pathKinds: Map<string, 'file' | 'directory'>;
}

export interface ArchiveValidationInput {
    rawPath: string;
    unixFileType: UnixFileType;
    uncompressedBytes: number;
    compressedBytes: number;
}

export interface IncludedEntry {
    path: string;
    sha256: string;
    bytes: number;
}

export interface ExcludedEntry {
    path: string;
    reason: string;
}

export interface SourceArchiveRecord {
    path: string;
    bytes: number;
    sha256: string;
}

export interface MetadataBuilderInput {
    runtimeVersion: string;
    sourceArchive: SourceArchiveRecord;
    bundleSha256: string;
    policy: DrawioRuntimePolicy;
    includedEntries: IncludedEntry[];
    excludedEntries: ExcludedEntry[];
    verdict: InventoryVerdict;
}

export interface PublishRuntimeFile {
    relativePath: string;
    bytes: Uint8Array | Buffer | string;
}

export interface PublishPackagedRuntimeOptions {
    outputRoot: string;
    bundleSha256: string;
    files: PublishRuntimeFile[];
    bundleManifestBytes: JsonBytes;
    assetIntegrityBytes: JsonBytes;
    packagingReportBytes: JsonBytes;
}

export interface PublishPackagedRuntimeResult {
    bundleSha256: string;
    finalDirectory: string;
}

export interface PackageDrawioRuntimeOptions {
    inputWarPath: string;
    expectedWarBytes: number;
    expectedWarSha256: string;
    outputRoot: string;
    policy: DrawioRuntimePolicy;
}

export interface PackageDrawioRuntimeResult extends PublishPackagedRuntimeResult {
    sourceArchive: SourceArchiveRecord;
    includedEntries: IncludedEntry[];
    excludedEntries: ExcludedEntry[];
}

export type ArchiveEntryValidationResult =
    | { action: 'include'; normalizedPath: string }
    | { action: 'exclude'; normalizedPath: string; reason: string }
    | { action: 'directory'; normalizedPath: string };

interface NormalizedArchivePath {
    normalizedPath: string;
    isDirectoryPath: boolean;
}

interface BundleFileRecord {
    relativePath: string;
    bytes: Buffer;
}

interface FileDigestRecord {
    bytes: number;
    sha256: string;
}

interface ExtractedEntryRecord extends IncludedEntry {
    absolutePath: string;
}

interface StagedPublicationOptions {
    outputRoot: PinnedOutputRoot;
    bundleSha256: string;
    stageDirectory: PinnedStageDirectory;
}

interface ParsedMetadata {
    bundleManifest: Record<string, unknown>;
    assetIntegrity: Record<string, unknown>;
    packagingReport: Record<string, unknown>;
}

interface PinnedDirectoryIdentity {
    canonicalPath: string;
    dev: number;
    ino: number;
}

interface PinnedOutputRoot {
    requestedPath: string;
    identity: PinnedDirectoryIdentity;
}

interface PinnedStageDirectory {
    requestedPath: string;
    rootCanonicalPath: string;
    identity: PinnedDirectoryIdentity;
}

interface NormalizedSharedMetadata {
    runtimeVersion: string;
    sourceArchive: SourceArchiveRecord;
    bundleSha256: string;
    policy: DrawioRuntimePolicy;
    excludedEntries: ExcludedEntry[];
    verdict: InventoryVerdict;
}

function pipelineAsync(source: Readable, destination: Writable): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        let settled = false;

        const cleanup = (): void => {
            source.off('error', onSourceError);
            destination.off('error', onDestinationError);
            destination.off('finish', onFinish);
        };

        const settleFailure = (error: Error): void => {
            if (settled) {
                return;
            }
            settled = true;
            cleanup();
            source.destroy();
            destination.destroy();
            reject(error);
        };

        const onSourceError = (error: Error): void => {
            settleFailure(error);
        };

        const onDestinationError = (error: Error): void => {
            settleFailure(error);
        };

        const onFinish = (): void => {
            if (settled) {
                return;
            }
            settled = true;
            cleanup();
            resolve();
        };

        source.once('error', onSourceError);
        destination.once('error', onDestinationError);
        destination.once('finish', onFinish);
        source.pipe(destination);
    });
}

export function buildDrawioRuntimePolicy(input: DrawioRuntimePolicyInput): DrawioRuntimePolicy {
    const runtimeVersion = String(input.runtimeVersion);
    if (runtimeVersion !== DRAWIO_RUNTIME_PACKAGER_VERSION) {
        throw new Error(`runtimeVersion must equal ${DRAWIO_RUNTIME_PACKAGER_VERSION}`);
    }
    return {
        runtimeVersion,
        maxEntries: validatePositiveInteger(input.maxEntries, 'maxEntries'),
        maxEntryUncompressedBytes: validatePositiveInteger(
            input.maxEntryUncompressedBytes,
            'maxEntryUncompressedBytes'
        ),
        maxTotalUncompressedBytes: validatePositiveInteger(
            input.maxTotalUncompressedBytes,
            'maxTotalUncompressedBytes'
        ),
        maxCompressionRatio: validatePositiveInteger(input.maxCompressionRatio, 'maxCompressionRatio')
    };
}

export function createArchiveValidationState(policy: DrawioRuntimePolicy): ArchiveValidationState {
    const normalizedPolicy = buildDrawioRuntimePolicy(policy);
    return {
        policy: normalizedPolicy,
        entryCount: 0,
        totalUncompressedBytes: 0,
        normalizedPaths: new Set<string>(),
        lowercasePaths: new Set<string>(),
        pathKinds: new Map<string, 'file' | 'directory'>()
    };
}

export function validateArchiveEntry(
    entry: ArchiveValidationInput,
    state: ArchiveValidationState
): ArchiveEntryValidationResult {
    assertArchiveValidationState(state);
    const uncompressedBytes = validateNonNegativeInteger(entry.uncompressedBytes, 'uncompressedBytes');
    const compressedBytes = validateNonNegativeInteger(entry.compressedBytes, 'compressedBytes');
    const pathInfo = normalizeArchiveEntryPath(entry.rawPath, entry.unixFileType === 'directory');
    const normalizedPath = pathInfo.normalizedPath;
    const kind: 'file' | 'directory' = entry.unixFileType === 'directory' ? 'directory' : 'file';

    if (entry.unixFileType === 'symlink') {
        throw new Error(`symlink archive entries are not allowed: ${normalizedPath}`);
    }
    if (entry.unixFileType !== 'file' && entry.unixFileType !== 'directory') {
        throw new Error(`non-regular archive entry type is not allowed: ${normalizedPath}`);
    }

    state.entryCount += 1;
    if (state.entryCount > state.policy.maxEntries) {
        throw new Error(`archive entry count exceeds maxEntries: ${state.entryCount}`);
    }
    if (uncompressedBytes > state.policy.maxEntryUncompressedBytes) {
        throw new Error(`archive entry exceeds per-entry uncompressed size limit: ${normalizedPath}`);
    }
    state.totalUncompressedBytes += uncompressedBytes;
    if (state.totalUncompressedBytes > state.policy.maxTotalUncompressedBytes) {
        throw new Error(`archive total uncompressed size exceeds policy limit: ${normalizedPath}`);
    }
    validateCompressionRatio(uncompressedBytes, compressedBytes, state.policy.maxCompressionRatio, normalizedPath);
    registerArchivePath(normalizedPath, kind, state);

    const exclusionReason = classifyExcludedArchivePath(normalizedPath);
    if (exclusionReason) {
        return { action: 'exclude', normalizedPath, reason: exclusionReason };
    }
    if (kind === 'directory' || pathInfo.isDirectoryPath) {
        return { action: 'directory', normalizedPath };
    }
    return { action: 'include', normalizedPath };
}

export function createBundleManifestBytes(input: MetadataBuilderInput): JsonBytes {
    const metadata = normalizeMetadataBuilderInput(input);
    return stableJsonBytes({
        runtimeVersion: metadata.runtimeVersion,
        sourceArchive: metadata.sourceArchive,
        bundleSha256: metadata.bundleSha256,
        policy: metadata.policy,
        includedEntries: metadata.includedEntries,
        excludedEntries: metadata.excludedEntries,
        verdict: metadata.verdict
    });
}

export function createAssetIntegrityBytes(input: MetadataBuilderInput): JsonBytes {
    const metadata = normalizeMetadataBuilderInput(input);
    return stableJsonBytes({
        runtimeVersion: metadata.runtimeVersion,
        sourceArchive: metadata.sourceArchive,
        bundleSha256: metadata.bundleSha256,
        policy: metadata.policy,
        files: metadata.includedEntries,
        excludedEntries: metadata.excludedEntries,
        verdict: metadata.verdict
    });
}

export function createPackagingReportBytes(input: MetadataBuilderInput): JsonBytes {
    const metadata = normalizeMetadataBuilderInput(input);
    return stableJsonBytes({
        runtimeVersion: metadata.runtimeVersion,
        sourceArchive: metadata.sourceArchive,
        bundleSha256: metadata.bundleSha256,
        policy: metadata.policy,
        includedEntries: metadata.includedEntries,
        excludedEntries: metadata.excludedEntries,
        verdict: metadata.verdict
    });
}

export async function publishPackagedRuntime(
    options: PublishPackagedRuntimeOptions
): Promise<PublishPackagedRuntimeResult> {
    const outputRoot = await ensureSafeOutputRoot(path.resolve(String(options.outputRoot)));
    const bundleSha256 = validateSha256(options.bundleSha256, 'bundleSha256');
    const files = normalizePublicationFiles(options.files);
    const computedBundleSha256 = computeBundleSha256(
        files.map((file): IncludedEntry => ({
            path: file.relativePath,
            sha256: sha256Hex(file.bytes),
            bytes: file.bytes.length
        }))
    );
    if (computedBundleSha256 !== bundleSha256) {
        throw new Error('bundle identity conflict: bundleSha256 does not match the provided file inventory');
    }

    const bundleManifestBytes = toBuffer(options.bundleManifestBytes, 'bundleManifestBytes');
    const assetIntegrityBytes = toBuffer(options.assetIntegrityBytes, 'assetIntegrityBytes');
    const packagingReportBytes = toBuffer(options.packagingReportBytes, 'packagingReportBytes');
    const parsedMetadata = parseAndValidatePublicationMetadata({
        bundleSha256,
        files,
        bundleManifestBytes,
        assetIntegrityBytes,
        packagingReportBytes
    });

    await assertPinnedOutputRoot(outputRoot, 'outputRoot changed before staging temp publication');
    const tempPrefix = path.join(outputRoot.identity.canonicalPath, `.tmp-${bundleSha256}-`);
    const tempDirectory = await fsp.mkdtemp(tempPrefix);
    let pinnedStageDirectory: PinnedStageDirectory | undefined;
    let moved = false;
    try {
        pinnedStageDirectory = await pinStageDirectory(
            outputRoot,
            tempDirectory,
            'temp publication directory changed after creation'
        );
        for (const file of files) {
            await writeBufferToRelativePath(pinnedStageDirectory, file.relativePath, file.bytes);
        }
        await assertPinnedStageDirectory(pinnedStageDirectory, 'temp publication directory changed before metadata writes');
        await writeBufferToRelativePath(pinnedStageDirectory, 'bundle-manifest.json', bundleManifestBytes);
        await writeBufferToRelativePath(pinnedStageDirectory, 'asset-integrity.json', assetIntegrityBytes);
        await writeBufferToRelativePath(pinnedStageDirectory, 'packaging-report.json', packagingReportBytes);

        const expectedFiles = buildExpectedPublicationInventory(files, {
            'bundle-manifest.json': bundleManifestBytes,
            'asset-integrity.json': assetIntegrityBytes,
            'packaging-report.json': packagingReportBytes
        });
        verifyMetadataConsistency(parsedMetadata, expectedFiles);

        const publicationResult = await finalizePublicationFromStage({
            outputRoot,
            bundleSha256,
            stageDirectory: pinnedStageDirectory
        });
        moved = true;
        return publicationResult;
    } finally {
        if (!moved) {
            await removePinnedStageDirectoryQuietly(pinnedStageDirectory);
        }
    }
}

export async function packageDrawioRuntime(
    options: PackageDrawioRuntimeOptions
): Promise<PackageDrawioRuntimeResult> {
    const policy = buildDrawioRuntimePolicy(options.policy);
    const inputWarPath = path.resolve(String(options.inputWarPath));
    const outputRoot = await ensureSafeOutputRoot(path.resolve(String(options.outputRoot)));
    const expectedWarBytes = validatePositiveInteger(options.expectedWarBytes, 'expectedWarBytes');
    const expectedWarSha256 = validateSha256(options.expectedWarSha256, 'expectedWarSha256');

    const inputStats = await fsp.stat(inputWarPath);
    if (!inputStats.isFile()) {
        throw new Error(`expected WAR path must be a regular file: ${inputWarPath}`);
    }
    if (inputStats.size !== expectedWarBytes) {
        throw new Error(`expected WAR bytes mismatch: expected ${expectedWarBytes}, got ${inputStats.size}`);
    }

    const observedWarSha256 = await hashFileSha256(inputWarPath);
    if (observedWarSha256 !== expectedWarSha256) {
        throw new Error('expected WAR SHA-256 digest mismatch');
    }

    await assertPinnedOutputRoot(outputRoot, 'outputRoot changed before staging extracted package');
    const stageDirectory = await fsp.mkdtemp(path.join(outputRoot.identity.canonicalPath, '.tmp-package-'));
    let pinnedStageDirectory: PinnedStageDirectory | undefined;
    let moved = false;
    try {
        pinnedStageDirectory = await pinStageDirectory(
            outputRoot,
            stageDirectory,
            'package stage directory changed after creation'
        );
        const extractedEntries: ExtractedEntryRecord[] = [];
        const excludedEntries: ExcludedEntry[] = [];
        const validationState = createArchiveValidationState(policy);

        await extractWarEntries({
            inputWarPath,
            stageDirectory: pinnedStageDirectory,
            validationState,
            extractedEntries,
            excludedEntries
        });

        const includedEntries = extractedEntries
            .map((entry): IncludedEntry => ({
                path: entry.path,
                sha256: entry.sha256,
                bytes: entry.bytes
            }))
            .sort(comparePathRecords);
        const sortedExcludedEntries = [...excludedEntries].sort(comparePathRecords);
        const bundleSha256 = computeBundleSha256(includedEntries);
        const sourceArchive: SourceArchiveRecord = {
            path: inferSourceArchivePath(inputWarPath),
            bytes: expectedWarBytes,
            sha256: expectedWarSha256
        };
        const metadataInput: MetadataBuilderInput = {
            runtimeVersion: policy.runtimeVersion,
            sourceArchive,
            bundleSha256,
            policy,
            includedEntries,
            excludedEntries: sortedExcludedEntries,
            verdict: 'candidate'
        };

        await assertPinnedStageDirectory(pinnedStageDirectory, 'package stage directory changed before metadata writes');
        await writeBufferToRelativePath(
            pinnedStageDirectory,
            'bundle-manifest.json',
            toBuffer(createBundleManifestBytes(metadataInput), 'bundle-manifest.json')
        );
        await writeBufferToRelativePath(
            pinnedStageDirectory,
            'asset-integrity.json',
            toBuffer(createAssetIntegrityBytes(metadataInput), 'asset-integrity.json')
        );
        await writeBufferToRelativePath(
            pinnedStageDirectory,
            'packaging-report.json',
            toBuffer(createPackagingReportBytes(metadataInput), 'packaging-report.json')
        );
        await assertPinnedStageDirectory(pinnedStageDirectory, 'package stage directory changed before publication');

        const publicationResult = await finalizePublicationFromStage({
            outputRoot,
            bundleSha256,
            stageDirectory: pinnedStageDirectory
        });
        moved = true;
        return {
            ...publicationResult,
            sourceArchive,
            includedEntries,
            excludedEntries: sortedExcludedEntries
        };
    } finally {
        if (!moved) {
            await removePinnedStageDirectoryQuietly(pinnedStageDirectory);
        }
    }
}

async function extractWarEntries(input: {
    inputWarPath: string;
    stageDirectory: PinnedStageDirectory;
    validationState: ArchiveValidationState;
    extractedEntries: ExtractedEntryRecord[];
    excludedEntries: ExcludedEntry[];
}): Promise<void> {
    const zipFile = await openZipFile(input.inputWarPath);
    let settled = false;

    await new Promise<void>((resolve, reject) => {
        const cleanup = (): void => {
            zipFile.off('error', onError);
            zipFile.off('end', onEnd);
            zipFile.off('entry', onEntry);
        };

        const finish = (callback: () => void): void => {
            if (settled) {
                return;
            }
            settled = true;
            cleanup();
            callback();
        };

        const onError = (error: Error): void => {
            finish(() => {
                zipFile.close();
                reject(error);
            });
        };

        const onEnd = (): void => {
            finish(() => {
                zipFile.close();
                resolve();
            });
        };

        const onEntry = (entry: yauzl.Entry): void => {
            void (async () => {
                try {
                    await processZipEntry(entry, zipFile, input);
                    if (!settled) {
                        zipFile.readEntry();
                    }
                } catch (error) {
                    finish(() => {
                        zipFile.close();
                        reject(error);
                    });
                }
            })();
        };

        zipFile.on('error', onError);
        zipFile.on('end', onEnd);
        zipFile.on('entry', onEntry);
        zipFile.readEntry();
    });
}

async function processZipEntry(
    entry: yauzl.Entry,
    zipFile: yauzl.ZipFile,
    input: {
        stageDirectory: PinnedStageDirectory;
        validationState: ArchiveValidationState;
        extractedEntries: ExtractedEntryRecord[];
        excludedEntries: ExcludedEntry[];
    }
): Promise<void> {
    if (entry.isEncrypted()) {
        throw new Error(`encrypted archive entries are not allowed: ${entry.fileName}`);
    }
    const unixFileType = deriveUnixFileType(entry);
    const validationResult = validateArchiveEntry(
        {
            rawPath: entry.fileName,
            unixFileType,
            uncompressedBytes: entry.uncompressedSize,
            compressedBytes: entry.compressedSize
        },
        input.validationState
    );

    if (validationResult.action === 'exclude') {
        input.excludedEntries.push({
            path: validationResult.normalizedPath,
            reason: validationResult.reason
        });
        return;
    }
    if (validationResult.action === 'directory') {
        await ensureContainedDirectory(input.stageDirectory, validationResult.normalizedPath);
        return;
    }

    const absoluteTargetPath = resolveContainedPath(input.stageDirectory.requestedPath, validationResult.normalizedPath);
    await ensureParentDirectory(absoluteTargetPath, input.stageDirectory);
    await assertPinnedStageDirectory(input.stageDirectory, 'package stage directory changed before extraction write');
    const readStream = await openZipEntryReadStream(zipFile, entry);
    const writeStream = fs.createWriteStream(absoluteTargetPath, { flags: 'wx', mode: 0o644 });
    const hash = crypto.createHash('sha256');
    let observedBytes = 0;

    readStream.on('data', (chunk: Buffer | string) => {
        const bufferChunk = typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : chunk;
        observedBytes += bufferChunk.length;
        hash.update(bufferChunk);
    });

    try {
        await pipelineAsync(readStream, writeStream);
    } catch (error) {
        await removePathQuietly(absoluteTargetPath);
        throw error;
    }

    if (observedBytes !== entry.uncompressedSize) {
        await removePathQuietly(absoluteTargetPath);
        throw new Error(`extracted byte count mismatch for ${validationResult.normalizedPath}`);
    }
    await assertPinnedStageDirectory(input.stageDirectory, 'package stage directory changed after extraction write');

    input.extractedEntries.push({
        path: validationResult.normalizedPath,
        sha256: hash.digest('hex'),
        bytes: observedBytes,
        absolutePath: absoluteTargetPath
    });
}

async function finalizePublicationFromStage(
    options: StagedPublicationOptions
): Promise<PublishPackagedRuntimeResult> {
    await assertPinnedOutputRoot(options.outputRoot, 'outputRoot changed before final publication');
    await assertPinnedStageDirectory(options.stageDirectory, 'stage directory changed before final publication');
    const outputRoot = options.outputRoot.identity.canonicalPath;
    const bundleSha256 = validateSha256(options.bundleSha256, 'bundleSha256');
    const stageDirectory = options.stageDirectory.requestedPath;
    const finalDirectory = path.join(outputRoot, bundleSha256);

    try {
        await fsp.rename(stageDirectory, finalDirectory);
        await assertPinnedOutputRoot(options.outputRoot, 'outputRoot changed after final publication');
        await assertPinnedDirectoryIdentity(
            finalDirectory,
            await readPinnedDirectoryIdentity(finalDirectory, 'published bundle directory changed after final publication'),
            'published bundle directory changed after final publication'
        );
        return { bundleSha256, finalDirectory };
    } catch (error) {
        if (!isAlreadyExistsError(error)) {
            throw error;
        }
        await assertPinnedOutputRoot(options.outputRoot, 'outputRoot changed while reconciling existing publication');
        await assertPinnedStageDirectory(options.stageDirectory, 'stage directory changed while reconciling existing publication');
        await verifyExistingBundleMatches(finalDirectory, stageDirectory);
        await removePinnedStageDirectoryQuietly(options.stageDirectory);
        return { bundleSha256, finalDirectory };
    }
}

async function verifyExistingBundleMatches(finalDirectory: string, expectedDirectory: string): Promise<void> {
    const expectedFiles = await readRegularFileTree(expectedDirectory);
    const actualFiles = await readRegularFileTree(finalDirectory);
    const expectedKeys = [...expectedFiles.keys()].sort();
    const actualKeys = [...actualFiles.keys()].sort();
    if (expectedKeys.length !== actualKeys.length) {
        throw new Error(`existing output conflict at ${finalDirectory}`);
    }
    for (let index = 0; index < expectedKeys.length; index += 1) {
        if (expectedKeys[index] !== actualKeys[index]) {
            throw new Error(`existing output conflict at ${finalDirectory}`);
        }
        const expectedEntry = expectedFiles.get(expectedKeys[index]);
        const actualEntry = actualFiles.get(actualKeys[index]);
        if (
            !expectedEntry
            || !actualEntry
            || expectedEntry.bytes !== actualEntry.bytes
            || expectedEntry.sha256 !== actualEntry.sha256
        ) {
            throw new Error(`existing output conflict at ${finalDirectory}`);
        }
    }
}

async function readRegularFileTree(rootDirectory: string): Promise<Map<string, FileDigestRecord>> {
    const fileMap = new Map<string, FileDigestRecord>();
    const rootStats = await fsp.lstat(rootDirectory);
    if (rootStats.isSymbolicLink() || !rootStats.isDirectory()) {
        throw new Error(`existing output is not a regular bundle directory: ${rootDirectory}`);
    }

    const walk = async (currentDirectory: string): Promise<void> => {
        const entries = await fsp.readdir(currentDirectory, { withFileTypes: true });
        entries.sort((left, right) => compareDeterministicStrings(left.name, right.name));
        for (const entry of entries) {
            const absolutePath = path.join(currentDirectory, entry.name);
            const relativePath = toPortablePath(path.relative(rootDirectory, absolutePath));
            if (entry.isSymbolicLink()) {
                throw new Error(`existing output contains symlink: ${relativePath}`);
            }
            if (entry.isDirectory()) {
                await walk(absolutePath);
                continue;
            }
            if (!entry.isFile()) {
                throw new Error(`existing output contains unsupported entry type: ${relativePath}`);
            }
            const fileStats = await fsp.lstat(absolutePath);
            if (!fileStats.isFile() || fileStats.isSymbolicLink()) {
                throw new Error(`existing output contains unsupported entry type: ${relativePath}`);
            }
            fileMap.set(relativePath, {
                bytes: fileStats.size,
                sha256: await hashFileSha256(absolutePath)
            });
        }
    };

    await walk(rootDirectory);
    return fileMap;
}

function normalizeMetadataBuilderInput(input: MetadataBuilderInput): MetadataBuilderInput {
    const policy = buildDrawioRuntimePolicy(input.policy);
    const runtimeVersion = String(input.runtimeVersion);
    if (runtimeVersion !== DRAWIO_RUNTIME_PACKAGER_VERSION) {
        throw new Error(`runtimeVersion must equal ${DRAWIO_RUNTIME_PACKAGER_VERSION}`);
    }
    const bundleSha256 = validateSha256(input.bundleSha256, 'bundleSha256');
    const sourceArchive = normalizeSourceArchiveRecord(input.sourceArchive);
    const verdict: InventoryVerdict = input.verdict;
    if (verdict !== 'candidate') {
        throw new Error('verdict must be candidate');
    }
    const includedEntries = input.includedEntries
        .map(normalizeIncludedEntry)
        .sort(comparePathRecords);
    const excludedEntries = input.excludedEntries
        .map(normalizeExcludedEntry)
        .sort(comparePathRecords);
    const computedBundleSha256 = computeBundleSha256(includedEntries);
    if (computedBundleSha256 !== bundleSha256) {
        throw new Error('bundleSha256 must match the includedEntries inventory');
    }
    return {
        runtimeVersion,
        sourceArchive,
        bundleSha256,
        policy,
        includedEntries,
        excludedEntries,
        verdict
    };
}

function normalizeSourceArchiveRecord(sourceArchive: SourceArchiveRecord): SourceArchiveRecord {
    return {
        path: normalizePortableRelativePath(sourceArchive.path, 'sourceArchive.path'),
        bytes: validatePositiveInteger(sourceArchive.bytes, 'sourceArchive.bytes'),
        sha256: validateSha256(sourceArchive.sha256, 'sourceArchive.sha256')
    };
}

function normalizeIncludedEntry(entry: IncludedEntry): IncludedEntry {
    return {
        path: normalizePortableRelativePath(entry.path, 'includedEntries.path'),
        sha256: validateSha256(entry.sha256, 'includedEntries.sha256'),
        bytes: validateNonNegativeInteger(entry.bytes, 'includedEntries.bytes')
    };
}

function normalizeExcludedEntry(entry: ExcludedEntry): ExcludedEntry {
    const reason = String(entry.reason);
    if (reason.length === 0) {
        throw new Error('excludedEntries.reason must not be empty');
    }
    return {
        path: normalizePortableRelativePath(entry.path, 'excludedEntries.path'),
        reason
    };
}

function normalizePublicationFiles(files: PublishRuntimeFile[]): BundleFileRecord[] {
    if (!Array.isArray(files) || files.length === 0) {
        throw new Error('files must contain at least one regular file');
    }
    const seen = new Set<string>();
    return files
        .map((file): BundleFileRecord => {
            const relativePath = normalizePortableRelativePath(file.relativePath, 'files.relativePath');
            if (seen.has(relativePath)) {
                throw new Error(`duplicate publication file path: ${relativePath}`);
            }
            seen.add(relativePath);
            return {
                relativePath,
                bytes: toBuffer(file.bytes, `files[${relativePath}].bytes`)
            };
        })
        .sort(compareRelativePathRecords);
}

function parseAndValidatePublicationMetadata(input: {
    bundleSha256: string;
    files: BundleFileRecord[];
    bundleManifestBytes: Buffer;
    assetIntegrityBytes: Buffer;
    packagingReportBytes: Buffer;
}): ParsedMetadata {
    const bundleManifest = parseStableJson(input.bundleManifestBytes, 'bundle-manifest.json');
    const assetIntegrity = parseStableJson(input.assetIntegrityBytes, 'asset-integrity.json');
    const packagingReport = parseStableJson(input.packagingReportBytes, 'packaging-report.json');

    const normalizedBundleManifest = readSharedMetadata(bundleManifest, input.bundleSha256, 'bundle-manifest.json');
    const normalizedAssetIntegrity = readSharedMetadata(assetIntegrity, input.bundleSha256, 'asset-integrity.json');
    const normalizedPackagingReport = readSharedMetadata(packagingReport, input.bundleSha256, 'packaging-report.json');
    assertSharedMetadataMatches(normalizedBundleManifest, normalizedAssetIntegrity, 'bundle-manifest.json', 'asset-integrity.json');
    assertSharedMetadataMatches(normalizedBundleManifest, normalizedPackagingReport, 'bundle-manifest.json', 'packaging-report.json');

    const expectedFiles = input.files.map((file): IncludedEntry => ({
        path: file.relativePath,
        sha256: sha256Hex(file.bytes),
        bytes: file.bytes.length
    }));

    const bundleManifestEntries = readIncludedEntries(bundleManifest, 'includedEntries', 'bundle-manifest.json');
    if (!inventoriesEqual(bundleManifestEntries, expectedFiles)) {
        throw new Error('bundle-manifest.json includedEntries do not match files');
    }

    const assetIntegrityFiles = readIncludedEntries(assetIntegrity, 'files', 'asset-integrity.json');
    if (!inventoriesEqual(assetIntegrityFiles, expectedFiles)) {
        throw new Error('asset-integrity.json files do not match files');
    }

    const packagingReportEntries = readIncludedEntries(packagingReport, 'includedEntries', 'packaging-report.json');
    if (!inventoriesEqual(packagingReportEntries, expectedFiles)) {
        throw new Error('packaging-report.json includedEntries do not match files');
    }

    return { bundleManifest, assetIntegrity, packagingReport };
}

function verifyMetadataConsistency(
    metadata: ParsedMetadata,
    expectedFiles: Map<string, FileDigestRecord>
): void {
    const manifest = metadata.bundleManifest;
    const assetIntegrity = metadata.assetIntegrity;
    const report = metadata.packagingReport;
    const metadataFiles = [
        manifest,
        assetIntegrity,
        report
    ];
    for (const metadataFile of metadataFiles) {
        if (metadataFile.activation !== undefined) {
            throw new Error('metadata must not claim activation');
        }
    }
    const bundleSha256 = String(manifest.bundleSha256);
    const listedFiles = readIncludedEntries(assetIntegrity, 'files', 'asset-integrity.json');
    for (const file of listedFiles) {
        const expectedFile = expectedFiles.get(file.path);
        if (!expectedFile) {
            throw new Error(`metadata references missing file: ${file.path}`);
        }
        if (expectedFile.sha256 !== file.sha256 || expectedFile.bytes !== file.bytes) {
            throw new Error(`metadata integrity mismatch for ${file.path}`);
        }
    }
    if (computeBundleSha256(listedFiles) !== bundleSha256) {
        throw new Error('metadata bundle identity mismatch');
    }
}

function readSharedMetadata(
    value: Record<string, unknown>,
    bundleSha256: string,
    label: string
): NormalizedSharedMetadata {
    const runtimeVersion = String(value.runtimeVersion);
    if (runtimeVersion !== DRAWIO_RUNTIME_PACKAGER_VERSION) {
        throw new Error(`${label} runtimeVersion must stay pinned`);
    }
    if (validateSha256(String(value.bundleSha256), `${label} bundleSha256`) !== bundleSha256) {
        throw new Error(`${label} bundleSha256 mismatch`);
    }
    const verdict = value.verdict;
    if (verdict !== 'candidate') {
        throw new Error(`${label} verdict must be candidate`);
    }
    if (value.policy === undefined || typeof value.policy !== 'object' || value.policy === null) {
        throw new Error(`${label} must include policy`);
    }
    if (value.sourceArchive === undefined || typeof value.sourceArchive !== 'object' || value.sourceArchive === null) {
        throw new Error(`${label} must include sourceArchive`);
    }
    return {
        runtimeVersion,
        sourceArchive: normalizeSourceArchiveRecord(value.sourceArchive as SourceArchiveRecord),
        bundleSha256,
        policy: buildDrawioRuntimePolicy(value.policy as DrawioRuntimePolicy),
        excludedEntries: readExcludedEntries(value, 'excludedEntries', label),
        verdict
    };
}

function assertSharedMetadataMatches(
    expected: NormalizedSharedMetadata,
    actual: NormalizedSharedMetadata,
    expectedLabel: string,
    actualLabel: string
): void {
    if (expected.runtimeVersion !== actual.runtimeVersion) {
        throw new Error(`${actualLabel} runtimeVersion does not match ${expectedLabel}`);
    }
    if (
        expected.sourceArchive.path !== actual.sourceArchive.path
        || expected.sourceArchive.bytes !== actual.sourceArchive.bytes
        || expected.sourceArchive.sha256 !== actual.sourceArchive.sha256
    ) {
        throw new Error(`${actualLabel} sourceArchive does not match ${expectedLabel}`);
    }
    if (
        expected.policy.runtimeVersion !== actual.policy.runtimeVersion
        || expected.policy.maxEntries !== actual.policy.maxEntries
        || expected.policy.maxEntryUncompressedBytes !== actual.policy.maxEntryUncompressedBytes
        || expected.policy.maxTotalUncompressedBytes !== actual.policy.maxTotalUncompressedBytes
        || expected.policy.maxCompressionRatio !== actual.policy.maxCompressionRatio
    ) {
        throw new Error(`${actualLabel} policy does not match ${expectedLabel}`);
    }
    if (!excludedEntriesEqual(expected.excludedEntries, actual.excludedEntries)) {
        throw new Error(`${actualLabel} excludedEntries do not match ${expectedLabel}`);
    }
    if (expected.verdict !== actual.verdict) {
        throw new Error(`${actualLabel} verdict does not match ${expectedLabel}`);
    }
}

function buildExpectedPublicationInventory(
    files: BundleFileRecord[],
    metadataFiles: Record<string, Buffer>
): Map<string, FileDigestRecord> {
    const fileMap = new Map<string, FileDigestRecord>();
    for (const file of files) {
        fileMap.set(file.relativePath, {
            bytes: file.bytes.length,
            sha256: sha256Hex(file.bytes)
        });
    }
    for (const [relativePath, bytes] of Object.entries(metadataFiles)) {
        fileMap.set(relativePath, {
            bytes: bytes.length,
            sha256: sha256Hex(bytes)
        });
    }
    return fileMap;
}

function readIncludedEntries(
    value: Record<string, unknown>,
    key: string,
    label: string
): IncludedEntry[] {
    const rawEntries = value[key];
    if (!Array.isArray(rawEntries)) {
        throw new Error(`${label} must include ${key}`);
    }
    return rawEntries.map((entry) => {
        if (typeof entry !== 'object' || entry === null) {
            throw new Error(`${label} contains invalid inventory`);
        }
        const typedEntry = entry as Record<string, unknown>;
        return normalizeIncludedEntry({
            path: String(typedEntry.path),
            sha256: String(typedEntry.sha256),
            bytes: Number(typedEntry.bytes)
        });
    }).sort(comparePathRecords);
}

function readExcludedEntries(
    value: Record<string, unknown>,
    key: string,
    label: string
): ExcludedEntry[] {
    const rawEntries = value[key];
    if (!Array.isArray(rawEntries)) {
        throw new Error(`${label} must include ${key}`);
    }
    return rawEntries.map((entry) => {
        if (typeof entry !== 'object' || entry === null) {
            throw new Error(`${label} contains invalid excluded inventory`);
        }
        const typedEntry = entry as Record<string, unknown>;
        return normalizeExcludedEntry({
            path: String(typedEntry.path),
            reason: String(typedEntry.reason)
        });
    }).sort(comparePathRecords);
}

function inventoriesEqual(left: IncludedEntry[], right: IncludedEntry[]): boolean {
    if (left.length !== right.length) {
        return false;
    }
    for (let index = 0; index < left.length; index += 1) {
        if (
            left[index].path !== right[index].path
            || left[index].sha256 !== right[index].sha256
            || left[index].bytes !== right[index].bytes
        ) {
            return false;
        }
    }
    return true;
}

function excludedEntriesEqual(left: ExcludedEntry[], right: ExcludedEntry[]): boolean {
    if (left.length !== right.length) {
        return false;
    }
    for (let index = 0; index < left.length; index += 1) {
        if (left[index].path !== right[index].path || left[index].reason !== right[index].reason) {
            return false;
        }
    }
    return true;
}

function parseStableJson(bytes: Buffer, label: string): Record<string, unknown> {
    const source = bytes.toString('utf8');
    if (!source.endsWith(JSON_TRAILING_NEWLINE)) {
        throw new Error(`${label} must end with a trailing newline`);
    }
    const parsed = JSON.parse(source) as Record<string, unknown>;
    const reparsed = `${JSON.stringify(parsed, null, JSON_INDENT)}${JSON_TRAILING_NEWLINE}`;
    if (source !== reparsed) {
        throw new Error(`${label} must be stable pretty JSON`);
    }
    return parsed;
}

function stableJsonBytes(value: unknown): Buffer {
    return Buffer.from(`${JSON.stringify(value, null, JSON_INDENT)}${JSON_TRAILING_NEWLINE}`, 'utf8');
}

function registerArchivePath(
    normalizedPath: string,
    kind: 'file' | 'directory',
    state: ArchiveValidationState
): void {
    if (state.normalizedPaths.has(normalizedPath)) {
        throw new Error(`duplicate normalized archive path detected: ${normalizedPath}`);
    }
    state.normalizedPaths.add(normalizedPath);

    const loweredPath = normalizedPath.toLowerCase();
    if (state.lowercasePaths.has(loweredPath)) {
        throw new Error(`case-fold archive path collision detected: ${normalizedPath}`);
    }
    state.lowercasePaths.add(loweredPath);

    const segments = normalizedPath.split('/');
    for (let index = 0; index < segments.length; index += 1) {
        const partialPath = segments.slice(0, index + 1).join('/');
        const inferredKind: 'file' | 'directory' = index === segments.length - 1 ? kind : 'directory';
        const previousKind = state.pathKinds.get(partialPath);
        if (previousKind && previousKind !== inferredKind) {
            throw new Error(`file-vs-directory collision detected for archive path prefix: ${partialPath}`);
        }
        if (!previousKind) {
            state.pathKinds.set(partialPath, inferredKind);
        }
    }
}

function normalizeArchiveEntryPath(rawPath: string, treatTrailingSlashAsDirectory: boolean): NormalizedArchivePath {
    const originalPath = String(rawPath);
    if (originalPath.length === 0) {
        throw new Error('archive entry path must not be empty');
    }
    if (originalPath.includes('\0')) {
        throw new Error('archive entry path must not contain NUL');
    }
    if (/^[A-Za-z]:/.test(originalPath)) {
        throw new Error('archive entry path must not start with a drive prefix');
    }
    if (originalPath.startsWith('\\\\')) {
        throw new Error('archive entry path must not start with a UNC prefix');
    }
    if (originalPath.startsWith('/')) {
        throw new Error('archive entry path must not be absolute');
    }
    if (originalPath.includes('\\')) {
        throw new Error('archive entry path must not contain backslash ambiguity');
    }

    let normalized = originalPath;
    let isDirectoryPath = false;
    if (treatTrailingSlashAsDirectory && normalized.endsWith('/')) {
        normalized = normalized.replace(/\/+$/u, '');
        isDirectoryPath = true;
    }

    const segments = normalized.split('/');
    const keptSegments: string[] = [];
    for (const segment of segments) {
        if (segment.length === 0) {
            throw new Error('archive entry path must not contain empty slash segments');
        }
        if (segment === '.') {
            throw new Error('archive entry path must not contain current-directory segments');
        }
        if (segment === '..') {
            throw new Error('archive entry path must not contain parent-directory traversal');
        }
        keptSegments.push(segment);
    }

    return {
        normalizedPath: keptSegments.join('/'),
        isDirectoryPath
    };
}

function classifyExcludedArchivePath(normalizedPath: string): string | undefined {
    const loweredPath = normalizedPath.toLowerCase();
    if (loweredPath === 'meta-inf' || loweredPath.startsWith('meta-inf/')) {
        return 'excluded:meta-inf';
    }
    if (loweredPath === 'web-inf' || loweredPath.startsWith('web-inf/')) {
        return 'excluded:web-inf';
    }
    if (loweredPath.endsWith('.class')) {
        return 'excluded:class';
    }
    if (loweredPath.endsWith('.jar')) {
        return 'excluded:jar';
    }
    return undefined;
}

function assertArchiveValidationState(state: ArchiveValidationState): void {
    if (!state || typeof state !== 'object') {
        throw new Error('archive validation state must be provided');
    }
    buildDrawioRuntimePolicy(state.policy);
}

function validateCompressionRatio(
    uncompressedBytes: number,
    compressedBytes: number,
    maxCompressionRatio: number,
    normalizedPath: string
): void {
    if (uncompressedBytes === 0) {
        return;
    }
    const ratio = compressedBytes === 0 ? Number.POSITIVE_INFINITY : uncompressedBytes / compressedBytes;
    if (!Number.isFinite(ratio) || ratio > maxCompressionRatio) {
        throw new Error(`archive compression ratio exceeds policy for ${normalizedPath}`);
    }
}

function deriveUnixFileType(entry: yauzl.Entry): UnixFileType {
    if (entry.fileName.endsWith('/')) {
        return 'directory';
    }

    const hostSystem = entry.versionMadeBy >>> 8;
    const unixMode = (entry.externalFileAttributes >>> 16) & 0xffff;
    if (hostSystem === 3 || unixMode !== 0) {
        const unixFileType = unixMode & UNIX_FILE_TYPE_MASK;
        if (unixFileType === DIRECTORY_UNIX_MODE) {
            return 'directory';
        }
        if (unixFileType === FILE_UNIX_MODE || unixFileType === 0) {
            return 'file';
        }
        if (unixFileType === SYMLINK_UNIX_MODE) {
            return 'symlink';
        }
        return 'other';
    }

    return 'file';
}

async function openZipFile(inputWarPath: string): Promise<yauzl.ZipFile> {
    return await new Promise<yauzl.ZipFile>((resolve, reject) => {
        yauzl.open(
            inputWarPath,
            {
                lazyEntries: true,
                decodeStrings: true,
                validateEntrySizes: true,
                strictFileNames: true
            },
            (error, zipFile) => {
                if (error) {
                    reject(error);
                    return;
                }
                if (!zipFile) {
                    reject(new Error('failed to open zip file'));
                    return;
                }
                resolve(zipFile);
            }
        );
    });
}

async function openZipEntryReadStream(zipFile: yauzl.ZipFile, entry: yauzl.Entry): Promise<Readable> {
    return await new Promise<Readable>((resolve, reject) => {
        zipFile.openReadStream(entry, (error, stream) => {
            if (error) {
                reject(error);
                return;
            }
            if (!stream) {
                reject(new Error(`failed to open zip entry stream: ${entry.fileName}`));
                return;
            }
            resolve(stream);
        });
    });
}

async function hashFileSha256(filePath: string): Promise<string> {
    const hash = crypto.createHash('sha256');
    await pipelineAsync(
        fs.createReadStream(filePath),
        new HashSink(hash)
    );
    return hash.digest('hex');
}

class HashSink extends Writable {
    private readonly hash: crypto.Hash;

    constructor(hash: crypto.Hash) {
        super();
        this.hash = hash;
    }

    override _write(
        chunk: Buffer,
        encoding: BufferEncoding,
        callback: (error?: Error | null) => void
    ): void {
        const bufferChunk = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding);
        this.hash.update(bufferChunk);
        callback();
    }
}

function inferSourceArchivePath(inputWarPath: string): string {
    const portablePath = toPortablePath(path.resolve(inputWarPath));
    const marker = '/drawio-editor/';
    const markerIndex = portablePath.lastIndexOf(marker);
    if (markerIndex >= 0) {
        const relativeFromEditor = portablePath.slice(markerIndex + marker.length);
        if (relativeFromEditor.startsWith('runtime/')) {
            return relativeFromEditor;
        }
    }
    return normalizePortableRelativePath(path.posix.basename(portablePath), 'sourceArchive.path');
}

async function ensureContainedDirectory(stageDirectory: PinnedStageDirectory, relativeDirectory: string): Promise<void> {
    await assertPinnedStageDirectory(stageDirectory, 'package stage directory changed before directory creation');
    const absoluteDirectory = resolveContainedPath(stageDirectory.requestedPath, relativeDirectory);
    await ensureParentDirectory(absoluteDirectory, stageDirectory);
    await assertPinnedStageDirectory(stageDirectory, 'package stage directory changed before directory creation');
    await fsp.mkdir(absoluteDirectory, { recursive: false }).catch(async (error: unknown) => {
        if (!isAlreadyExistsError(error)) {
            throw error;
        }
        const stats = await fsp.lstat(absoluteDirectory);
        if (!stats.isDirectory()) {
            throw new Error(`existing path is not a directory: ${relativeDirectory}`);
        }
    });
    await assertPinnedStageDirectory(stageDirectory, 'package stage directory changed after directory creation');
}

async function ensureSafeOutputRoot(outputRoot: string): Promise<PinnedOutputRoot> {
    const resolvedOutputRoot = path.resolve(outputRoot);
    const existingAncestor = await findExistingDirectoryAncestor(resolvedOutputRoot);
    const ancestorRealPath = await fsp.realpath(existingAncestor.path);
    const canonicalOutputRoot = path.join(ancestorRealPath, ...existingAncestor.missingSegments);

    let currentPath = ancestorRealPath;
    for (const segment of existingAncestor.missingSegments) {
        currentPath = path.join(currentPath, segment);
        await fsp.mkdir(currentPath).catch(async (error: unknown) => {
            if (!isAlreadyExistsError(error)) {
                throw error;
            }
        });
        const stats = await fsp.lstat(currentPath);
        if (stats.isSymbolicLink() || !stats.isDirectory()) {
            throw new Error(`outputRoot must be a real directory: ${resolvedOutputRoot}`);
        }
    }

    const finalCanonicalRoot = await fsp.realpath(canonicalOutputRoot);
    if (path.relative(ancestorRealPath, finalCanonicalRoot).startsWith('..')) {
        throw new Error(`outputRoot must stay within its canonical ancestor: ${resolvedOutputRoot}`);
    }
    return {
        requestedPath: resolvedOutputRoot,
        identity: await readPinnedDirectoryIdentity(
            finalCanonicalRoot,
            `outputRoot must be a real directory: ${resolvedOutputRoot}`
        )
    };
}

async function ensureParentDirectory(targetPath: string, stageDirectory: PinnedStageDirectory): Promise<void> {
    const relativeParent = path.relative(stageDirectory.requestedPath, path.dirname(targetPath));
    if (relativeParent === '') {
        return;
    }
    const segments = toPortablePath(relativeParent).split('/');
    let currentPath = stageDirectory.requestedPath;
    for (const segment of segments) {
        currentPath = path.join(currentPath, segment);
        await assertPinnedStageDirectory(stageDirectory, 'package stage directory changed before parent-directory creation');
        try {
            await fsp.mkdir(currentPath);
        } catch (error) {
            if (!isAlreadyExistsError(error)) {
                throw error;
            }
            const stats = await fsp.lstat(currentPath);
            if (!stats.isDirectory()) {
                throw new Error(`existing path is not a directory: ${toPortablePath(path.relative(stageDirectory.requestedPath, currentPath))}`);
            }
        }
        await assertPinnedStageDirectory(stageDirectory, 'package stage directory changed after parent-directory creation');
    }
}

async function writeBufferToRelativePath(stageDirectory: PinnedStageDirectory, relativePath: string, bytes: Buffer): Promise<void> {
    const absolutePath = resolveContainedPath(stageDirectory.requestedPath, relativePath);
    await ensureParentDirectory(absolutePath, stageDirectory);
    await assertPinnedStageDirectory(stageDirectory, 'package stage directory changed before file write');
    await fsp.writeFile(absolutePath, bytes, { flag: 'wx', mode: 0o644 });
    await assertPinnedStageDirectory(stageDirectory, 'package stage directory changed after file write');
}

function resolveContainedPath(rootDirectory: string, relativePath: string): string {
    const normalizedRelativePath = normalizePortableRelativePath(relativePath, 'relativePath');
    const resolvedRoot = path.resolve(rootDirectory);
    const resolvedPath = path.resolve(resolvedRoot, ...normalizedRelativePath.split('/'));
    const relative = path.relative(resolvedRoot, resolvedPath);
    if (relative === '' || relative.startsWith('..') || path.isAbsolute(relative)) {
        throw new Error(`path escapes output root: ${normalizedRelativePath}`);
    }
    return resolvedPath;
}

function normalizePortableRelativePath(rawPath: string, label: string): string {
    const normalized = normalizeArchiveEntryPath(rawPath, rawPath.endsWith('/')).normalizedPath;
    if (normalized.startsWith('.')) {
        throw new Error(`${label} must remain relative and non-hidden-dot traversing`);
    }
    return normalized;
}

function toPortablePath(filePath: string): string {
    return filePath.split(path.sep).join('/');
}

async function findExistingDirectoryAncestor(outputRoot: string): Promise<{
    path: string;
    missingSegments: string[];
}> {
    const parsedPath = path.parse(outputRoot);
    const relativeSegments = outputRoot
        .slice(parsedPath.root.length)
        .split(path.sep)
        .filter((segment) => segment.length > 0);
    let currentPath = parsedPath.root;

    for (let index = 0; index < relativeSegments.length; index += 1) {
        const nextPath = path.join(currentPath, relativeSegments[index]);
        try {
            const stats = await fsp.lstat(nextPath);
            if (stats.isSymbolicLink() || !stats.isDirectory()) {
                throw new Error(`outputRoot must be a real directory: ${outputRoot}`);
            }
            currentPath = nextPath;
        } catch (error) {
            if (!isMissingPathError(error)) {
                throw error;
            }
            return {
                path: currentPath,
                missingSegments: relativeSegments.slice(index)
            };
        }
    }

    return {
        path: currentPath,
        missingSegments: []
    };
}

async function pinStageDirectory(
    outputRoot: PinnedOutputRoot,
    stageDirectory: string,
    errorPrefix: string
): Promise<PinnedStageDirectory> {
    await assertPinnedOutputRoot(outputRoot, errorPrefix);
    const resolvedStageDirectory = path.resolve(stageDirectory);
    const stageIdentity = await readPinnedDirectoryIdentity(resolvedStageDirectory, errorPrefix);
    const relativeStagePath = path.relative(outputRoot.identity.canonicalPath, stageIdentity.canonicalPath);
    if (
        relativeStagePath === ''
        || relativeStagePath.startsWith('..')
        || path.isAbsolute(relativeStagePath)
    ) {
        throw new Error(`${errorPrefix}: ${resolvedStageDirectory}`);
    }
    return {
        requestedPath: resolvedStageDirectory,
        rootCanonicalPath: outputRoot.identity.canonicalPath,
        identity: stageIdentity
    };
}

async function assertPinnedOutputRoot(outputRoot: PinnedOutputRoot, errorPrefix: string): Promise<void> {
    await assertPinnedDirectoryIdentity(outputRoot.requestedPath, outputRoot.identity, errorPrefix);
}

async function assertPinnedStageDirectory(stageDirectory: PinnedStageDirectory, errorPrefix: string): Promise<void> {
    await assertPinnedDirectoryIdentity(stageDirectory.requestedPath, stageDirectory.identity, errorPrefix);
    const relativeStagePath = path.relative(stageDirectory.rootCanonicalPath, stageDirectory.identity.canonicalPath);
    if (
        relativeStagePath === ''
        || relativeStagePath.startsWith('..')
        || path.isAbsolute(relativeStagePath)
    ) {
        throw new Error(`${errorPrefix}: ${stageDirectory.requestedPath}`);
    }
}

async function assertPinnedDirectoryIdentity(
    currentPath: string,
    expectedIdentity: PinnedDirectoryIdentity,
    errorPrefix: string
): Promise<void> {
    const currentIdentity = await readPinnedDirectoryIdentity(currentPath, errorPrefix);
    if (
        currentIdentity.canonicalPath !== expectedIdentity.canonicalPath
        || currentIdentity.dev !== expectedIdentity.dev
        || currentIdentity.ino !== expectedIdentity.ino
    ) {
        throw new Error(`${errorPrefix}: ${currentPath}`);
    }
}

async function readPinnedDirectoryIdentity(
    directoryPath: string,
    errorPrefix: string
): Promise<PinnedDirectoryIdentity> {
    const directoryStats = await fsp.lstat(directoryPath).catch(() => {
        throw new Error(`${errorPrefix}: ${directoryPath}`);
    });
    if (directoryStats.isSymbolicLink() || !directoryStats.isDirectory()) {
        throw new Error(`${errorPrefix}: ${directoryPath}`);
    }
    const canonicalPath = await fsp.realpath(directoryPath).catch(() => {
        throw new Error(`${errorPrefix}: ${directoryPath}`);
    });
    const canonicalStats = await fsp.stat(canonicalPath).catch(() => {
        throw new Error(`${errorPrefix}: ${directoryPath}`);
    });
    if (!canonicalStats.isDirectory()) {
        throw new Error(`${errorPrefix}: ${directoryPath}`);
    }
    return {
        canonicalPath,
        dev: canonicalStats.dev,
        ino: canonicalStats.ino
    };
}

function toBuffer(value: Uint8Array | Buffer | string, label: string): Buffer {
    if (typeof value === 'string') {
        return Buffer.from(value, 'utf8');
    }
    if (Buffer.isBuffer(value)) {
        return value;
    }
    if (value instanceof Uint8Array) {
        return Buffer.from(value);
    }
    throw new Error(`${label} must be Buffer, Uint8Array, or string`);
}

function validatePositiveInteger(value: number, label: string): number {
    if (!Number.isFinite(value) || !Number.isInteger(value) || value <= 0) {
        throw new Error(`${label} must be a positive finite integer`);
    }
    return value;
}

function validateNonNegativeInteger(value: number, label: string): number {
    if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0) {
        throw new Error(`${label} must be a non-negative finite integer`);
    }
    return value;
}

function validateSha256(value: string, label: string): string {
    const normalized = String(value);
    if (!/^[0-9a-f]{64}$/u.test(normalized)) {
        throw new Error(`${label} must be a lowercase SHA-256 hex digest`);
    }
    return normalized;
}

function computeBundleSha256(entries: IncludedEntry[]): string {
    const canonicalRecords = [...entries]
        .map((entry) => ({
            path: normalizePortableRelativePath(entry.path, 'bundle identity path'),
            sha256: validateSha256(entry.sha256, 'bundle identity sha256'),
            bytes: validateNonNegativeInteger(entry.bytes, 'bundle identity bytes')
        }))
        .sort(comparePathRecords)
        .map((entry) => ({
            path: entry.path,
            sha256: entry.sha256,
            bytes: entry.bytes
        }));
    return sha256Hex(stableJsonBytes(canonicalRecords));
}

function sha256Hex(bytes: Buffer | string): string {
    return crypto.createHash('sha256').update(bytes).digest('hex');
}

function compareDeterministicStrings(left: string, right: string): number {
    if (left === right) {
        return 0;
    }
    return left < right ? -1 : 1;
}

function comparePathRecords(left: { path: string }, right: { path: string }): number {
    return compareDeterministicStrings(left.path, right.path);
}

function compareRelativePathRecords(left: { relativePath: string }, right: { relativePath: string }): number {
    return compareDeterministicStrings(left.relativePath, right.relativePath);
}

function isAlreadyExistsError(error: unknown): boolean {
    if (!error || typeof error !== 'object') {
        return false;
    }
    const code = Reflect.get(error, 'code');
    return code === 'EEXIST' || code === 'ENOTEMPTY' || code === 'EPERM';
}

function isMissingPathError(error: unknown): boolean {
    if (!error || typeof error !== 'object') {
        return false;
    }
    return Reflect.get(error, 'code') === 'ENOENT';
}

async function removePathQuietly(targetPath: string): Promise<void> {
    await fsp.rm(targetPath, { recursive: true, force: true });
}

async function removePinnedStageDirectoryQuietly(stageDirectory: PinnedStageDirectory | undefined): Promise<void> {
    if (!stageDirectory) {
        return;
    }
    try {
        await assertPinnedStageDirectory(stageDirectory, 'staged directory changed before cleanup');
    } catch {
        return;
    }
    await removePathQuietly(stageDirectory.requestedPath);
}

async function runCli(): Promise<void> {
    const drawioEditorRoot = path.resolve(__dirname, '..', '..');
    const runtimeRoot = path.join(drawioEditorRoot, 'runtime');
    const outputRoot = path.join(drawioEditorRoot, 'lib', 'runtime', 'drawio', DRAWIO_RUNTIME_PACKAGER_VERSION);
    const result = await packageDrawioRuntime({
        inputWarPath: path.join(runtimeRoot, 'artifacts', `draw-${DRAWIO_RUNTIME_PACKAGER_VERSION}.war`),
        expectedWarBytes: EXPECTED_WAR_BYTES,
        expectedWarSha256: EXPECTED_WAR_SHA256,
        outputRoot,
        policy: buildDrawioRuntimePolicy({
            runtimeVersion: DRAWIO_RUNTIME_PACKAGER_VERSION,
            maxEntries: DEFAULT_MAX_ENTRIES,
            maxEntryUncompressedBytes: DEFAULT_MAX_ENTRY_UNCOMPRESSED_BYTES,
            maxTotalUncompressedBytes: DEFAULT_MAX_TOTAL_UNCOMPRESSED_BYTES,
            maxCompressionRatio: DEFAULT_MAX_COMPRESSION_RATIO
        })
    });
    process.stdout.write(
        `${JSON.stringify(
            {
                bundleSha256: result.bundleSha256,
                finalDirectory: result.finalDirectory
            },
            null,
            JSON_INDENT
        )}${JSON_TRAILING_NEWLINE}`
    );
}

if (require.main === module) {
    void runCli().catch((error: unknown) => {
        const message = error instanceof Error ? error.message : 'unknown packager failure';
        process.stderr.write(`drawio-runtime-packager failed: ${message}${JSON_TRAILING_NEWLINE}`);
        process.exitCode = 1;
    });
}
