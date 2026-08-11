import * as crypto from 'node:crypto';
import fs = require('node:fs');
import * as path from 'node:path';

import {
    assertDistinctDrawioOrigins,
    normalizeDrawioRuntimeOrigin
} from '../common/drawio-runtime-origin-policy';

export const DRAWIO_RUNTIME_ACTIVATION_VERSION = '30.0.4';

const CONTROL_METADATA_PATHS = new Set([
    'bundle-manifest.json',
    'asset-integrity.json',
    'packaging-report.json'
]);
const EXACT_SANDBOX_TOKENS = new Set(['allow-scripts', 'allow-same-origin']);

interface SourceArchiveRecord {
    path: string;
    bytes: number;
    sha256: string;
}

interface PolicyRecord {
    runtimeVersion: string;
    maxEntries: number;
    maxEntryUncompressedBytes: number;
    maxTotalUncompressedBytes: number;
    maxCompressionRatio: number;
}

interface InventoryEntry {
    path: string;
    sha256: string;
    bytes: number;
}

interface ExcludedEntry {
    path: string;
    reason: string;
}

interface CandidateSummary {
    runtimeVersion: string;
    sourceArchive: SourceArchiveRecord;
    bundleSha256: string;
    policy: PolicyRecord;
    includedEntries: InventoryEntry[];
    excludedEntries: ExcludedEntry[];
    verdict: 'candidate';
}

interface LoadCandidateInput {
    bundleRoot: string;
    bundleManifestPath: string;
    assetIntegrityPath: string;
    packagingReportPath: string;
}

interface CompatibilityAuditInput {
    candidate?: {
        runtimeVersion?: unknown;
        bundleSha256?: unknown;
        verdict?: unknown;
        includedEntries?: unknown;
    };
    entrypoint?: unknown;
    sandbox?: unknown;
    csp?: unknown;
    messagingTargets?: unknown;
    messagingOrigins?: unknown;
    networkOrigins?: unknown;
    networkUrls?: unknown;
    requiresInlineStyle?: unknown;
    requiresInlineScript?: unknown;
    requiresEval?: unknown;
    requiresFunctionConstructor?: unknown;
}

interface ActivationAuthorizationInput {
    candidate?: { runtimeVersion?: unknown; bundleSha256?: unknown; verdict?: unknown };
    compatibility?: { verdict?: unknown; reasons?: unknown };
    runtimeOrigin?: unknown;
    studioOrigin?: unknown;
    sandbox?: unknown;
    networkOrigins?: unknown;
    unsafeExceptions?: unknown;
    activationAudit?: {
        verdict?: unknown;
        runtimeVersion?: unknown;
        bundleSha256?: unknown;
    };
}

interface BlockedVerdict {
    verdict: 'blocked';
    reasons: string[];
}

interface PassedVerdict {
    verdict: 'pass';
    reasons: [];
}

interface PinnedRegularFile {
    fd: number;
    absolutePath: string;
    realPath: string;
    identity: FileIdentity;
}

interface PinnedRootDirectory {
    fd: number;
    absoluteRoot: string;
    realRoot: string;
    dev: number;
    ino: number;
}

interface FileIdentity {
    dev: number;
    ino: number;
    size: number;
    mtimeMs: number;
    ctimeMs: number;
}

function compareStrings(left: string, right: string): number {
    if (left === right) {
        return 0;
    }
    return left < right ? -1 : 1;
}

function failClosed(message: string): never {
    throw new Error(message);
}

function getReadOnlyNoFollowFlags(): number {
    const noFollowFlag = typeof fs.constants.O_NOFOLLOW === 'number' ? fs.constants.O_NOFOLLOW : 0;
    return fs.constants.O_RDONLY | noFollowFlag;
}

function getReadOnlyDirectoryFlags(): number {
    const noFollowFlag = typeof fs.constants.O_NOFOLLOW === 'number' ? fs.constants.O_NOFOLLOW : 0;
    const directoryFlag = typeof fs.constants.O_DIRECTORY === 'number' ? fs.constants.O_DIRECTORY : 0;
    return fs.constants.O_RDONLY | noFollowFlag | directoryFlag;
}

function ensureObject(value: unknown, label: string): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        failClosed(`${label} must be an object`);
    }
    return value as Record<string, unknown>;
}

function ensureString(value: unknown, label: string): string {
    if (typeof value !== 'string') {
        failClosed(`${label} must be a string`);
    }
    return value;
}

function ensureExactNonEmptyString(value: unknown, label: string): string {
    const exact = ensureString(value, label);
    if (!exact) {
        failClosed(`${label} must not be empty`);
    }
    if (exact.trim() !== exact) {
        failClosed(`${label} must not include surrounding whitespace`);
    }
    return exact;
}

function ensureNonEmptyString(value: unknown, label: string): string {
    const normalized = ensureString(value, label).trim();
    if (!normalized) {
        failClosed(`${label} must not be empty`);
    }
    return normalized;
}

function ensureSafeInteger(value: unknown, label: string): number {
    if (!Number.isSafeInteger(value)) {
        failClosed(`${label} must be a safe integer`);
    }
    return value as number;
}

function ensureSha256(value: unknown, label: string): string {
    const exact = ensureExactNonEmptyString(value, label);
    if (!/^[0-9a-f]{64}$/.test(exact)) {
        failClosed(`${label} must be a lowercase sha256 hex string`);
    }
    return exact;
}

function normalizeCandidateRuntimeVersion(value: unknown): string | undefined {
    if (typeof value !== 'string') {
        return undefined;
    }
    if (!value || value.trim() !== value) {
        return undefined;
    }
    return value;
}

function tryNormalizeSha256(value: unknown): string | undefined {
    if (typeof value !== 'string') {
        return undefined;
    }
    if (!/^[0-9a-f]{64}$/.test(value)) {
        return undefined;
    }
    return value;
}

function normalizePortableRelativePath(value: unknown, label: string): string {
    const exact = ensureExactNonEmptyString(value, label);
    if (path.isAbsolute(exact)) {
        failClosed(`${label} must be relative`);
    }
    if (exact.includes('\\')) {
        failClosed(`${label} must use forward slashes`);
    }
    const portable = path.posix.normalize(exact);
    if (portable !== exact) {
        failClosed(`${label} must already be normalized`);
    }
    if (portable === '.' || portable.startsWith('../') || portable.includes('/../')) {
        failClosed(`${label} must not traverse outside the bundle root`);
    }
    const segments = portable.split('/');
    for (const segment of segments) {
        if (!segment || segment === '.' || segment === '..') {
            failClosed(`${label} contains invalid path segments`);
        }
    }
    return portable;
}

function normalizeSourceArchive(value: unknown, label: string): SourceArchiveRecord {
    const record = ensureObject(value, label);
    return {
        path: normalizePortableRelativePath(record.path, `${label}.path`),
        bytes: ensureSafeInteger(record.bytes, `${label}.bytes`),
        sha256: ensureSha256(record.sha256, `${label}.sha256`)
    };
}

function normalizePolicy(value: unknown, label: string): PolicyRecord {
    const record = ensureObject(value, label);
    return {
        runtimeVersion: ensureExactNonEmptyString(record.runtimeVersion, `${label}.runtimeVersion`),
        maxEntries: ensureSafeInteger(record.maxEntries, `${label}.maxEntries`),
        maxEntryUncompressedBytes: ensureSafeInteger(
            record.maxEntryUncompressedBytes,
            `${label}.maxEntryUncompressedBytes`
        ),
        maxTotalUncompressedBytes: ensureSafeInteger(
            record.maxTotalUncompressedBytes,
            `${label}.maxTotalUncompressedBytes`
        ),
        maxCompressionRatio: ensureSafeInteger(
            record.maxCompressionRatio,
            `${label}.maxCompressionRatio`
        )
    };
}

function normalizeInventoryEntries(value: unknown, label: string): InventoryEntry[] {
    if (!Array.isArray(value)) {
        failClosed(`${label} must be an array`);
    }

    const entries: InventoryEntry[] = [];
    const normalizedPaths = new Set<string>();
    const loweredPaths = new Set<string>();
    for (let index = 0; index < value.length; index += 1) {
        const entry = ensureObject(value[index], `${label}[${index}]`);
        const normalizedPath = normalizePortableRelativePath(entry.path, `${label}[${index}].path`);
        if (CONTROL_METADATA_PATHS.has(normalizedPath)) {
            failClosed(`${label}[${index}].path must not treat control metadata as runtime inventory`);
        }
        if (normalizedPaths.has(normalizedPath)) {
            failClosed(`${label}[${index}].path must not duplicate another inventory path`);
        }
        const loweredPath = normalizedPath.toLowerCase();
        if (loweredPaths.has(loweredPath)) {
            failClosed(`${label}[${index}].path must not collide case-insensitively`);
        }
        normalizedPaths.add(normalizedPath);
        loweredPaths.add(loweredPath);
        entries.push({
            path: normalizedPath,
            sha256: ensureSha256(entry.sha256, `${label}[${index}].sha256`),
            bytes: ensureSafeInteger(entry.bytes, `${label}[${index}].bytes`)
        });
    }

    entries.sort((left, right) => compareStrings(left.path, right.path));
    return entries;
}

function normalizeExcludedEntries(value: unknown, label: string): ExcludedEntry[] {
    if (!Array.isArray(value)) {
        failClosed(`${label} must be an array`);
    }

    const entries: ExcludedEntry[] = [];
    const normalizedPaths = new Set<string>();
    const loweredPaths = new Set<string>();
    for (let index = 0; index < value.length; index += 1) {
        const entry = ensureObject(value[index], `${label}[${index}]`);
        const normalizedPath = normalizePortableRelativePath(entry.path, `${label}[${index}].path`);
        if (normalizedPaths.has(normalizedPath)) {
            failClosed(`${label}[${index}].path must not duplicate another excluded path`);
        }
        const loweredPath = normalizedPath.toLowerCase();
        if (loweredPaths.has(loweredPath)) {
            failClosed(`${label}[${index}].path must not collide case-insensitively`);
        }
        normalizedPaths.add(normalizedPath);
        loweredPaths.add(loweredPath);
        entries.push({
            path: normalizedPath,
            reason: ensureNonEmptyString(entry.reason, `${label}[${index}].reason`)
        });
    }

    entries.sort((left, right) => compareStrings(left.path, right.path));
    return entries;
}

function normalizeCandidateDocument(value: unknown, label: string): CandidateSummary {
    const document = ensureObject(value, label);
    const includedEntries = Array.isArray(document.includedEntries)
        ? document.includedEntries
        : document.files;
    return {
        runtimeVersion: ensureExactNonEmptyString(document.runtimeVersion, `${label}.runtimeVersion`),
        sourceArchive: normalizeSourceArchive(document.sourceArchive, `${label}.sourceArchive`),
        bundleSha256: ensureSha256(document.bundleSha256, `${label}.bundleSha256`),
        policy: normalizePolicy(document.policy, `${label}.policy`),
        includedEntries: normalizeInventoryEntries(includedEntries, `${label}.includedEntries`),
        excludedEntries: normalizeExcludedEntries(document.excludedEntries, `${label}.excludedEntries`),
        verdict: normalizeCandidateVerdict(document.verdict, `${label}.verdict`)
    };
}

function normalizeCandidateVerdict(value: unknown, label: string): 'candidate' {
    if (value !== 'candidate') {
        failClosed(`${label} must remain "candidate"`);
    }
    return 'candidate';
}

function assertMetadataAgreement(reference: CandidateSummary, candidate: CandidateSummary, label: string): void {
    if (reference.runtimeVersion !== candidate.runtimeVersion) {
        failClosed(`${label} runtimeVersion drifted`);
    }
    if (JSON.stringify(reference.sourceArchive) !== JSON.stringify(candidate.sourceArchive)) {
        failClosed(`${label} sourceArchive drifted`);
    }
    if (reference.bundleSha256 !== candidate.bundleSha256) {
        failClosed(`${label} bundleSha256 drifted`);
    }
    if (JSON.stringify(reference.policy) !== JSON.stringify(candidate.policy)) {
        failClosed(`${label} policy drifted`);
    }
    if (JSON.stringify(reference.includedEntries) !== JSON.stringify(candidate.includedEntries)) {
        failClosed(`${label} includedEntries drifted`);
    }
    if (JSON.stringify(reference.excludedEntries) !== JSON.stringify(candidate.excludedEntries)) {
        failClosed(`${label} excludedEntries drifted`);
    }
    if (reference.verdict !== candidate.verdict) {
        failClosed(`${label} verdict drifted`);
    }
}

function ensurePinnedRoot(bundleRoot: string): { absoluteRoot: string; realRoot: string } {
    const absoluteRoot = path.resolve(bundleRoot);
    const rootStats = fs.lstatSync(absoluteRoot);
    if (!rootStats.isDirectory()) {
        failClosed('bundleRoot must be a directory');
    }
    if (rootStats.isSymbolicLink()) {
        failClosed('bundleRoot must not be a symbolic link');
    }
    return {
        absoluteRoot,
        realRoot: fs.realpathSync.native(absoluteRoot)
    };
}

function openPinnedRootDirectory(bundleRoot: string): PinnedRootDirectory {
    const requestedRoot = ensurePinnedRoot(bundleRoot);
    const initialStats = fs.lstatSync(requestedRoot.absoluteRoot);
    const fd = fs.openSync(requestedRoot.absoluteRoot, getReadOnlyDirectoryFlags());
    try {
        const openedStats = fs.fstatSync(fd);
        if (!openedStats.isDirectory()) {
            failClosed('bundleRoot must remain a directory');
        }
        if (openedStats.dev !== initialStats.dev || openedStats.ino !== initialStats.ino) {
            failClosed('bundleRoot changed identity during open');
        }
        return {
            fd,
            absoluteRoot: requestedRoot.absoluteRoot,
            realRoot: requestedRoot.realRoot,
            dev: openedStats.dev,
            ino: openedStats.ino
        };
    } catch (error) {
        fs.closeSync(fd);
        throw error;
    }
}

function closePinnedRootDirectory(pinnedRoot: PinnedRootDirectory): void {
    fs.closeSync(pinnedRoot.fd);
}

function assertCurrentRootPathMatchesPinnedRoot(pinnedRoot: PinnedRootDirectory): void {
    const currentStats = fs.lstatSync(pinnedRoot.absoluteRoot);
    if (!currentStats.isDirectory() || currentStats.isSymbolicLink()) {
        failClosed('bundleRoot path identity changed during validation');
    }
    if (currentStats.dev !== pinnedRoot.dev || currentStats.ino !== pinnedRoot.ino) {
        failClosed('bundleRoot path identity changed during validation');
    }
    const descriptorStats = fs.fstatSync(pinnedRoot.fd);
    if (!descriptorStats.isDirectory()) {
        failClosed('bundleRoot descriptor identity changed during validation');
    }
    if (descriptorStats.dev !== pinnedRoot.dev || descriptorStats.ino !== pinnedRoot.ino) {
        failClosed('bundleRoot descriptor identity changed during validation');
    }
}

function getFileIdentity(stats: fs.Stats): FileIdentity {
    return {
        dev: stats.dev,
        ino: stats.ino,
        size: stats.size,
        mtimeMs: stats.mtimeMs,
        ctimeMs: stats.ctimeMs
    };
}

function fileIdentityMatches(left: FileIdentity, right: FileIdentity): boolean {
    return left.dev === right.dev
        && left.ino === right.ino
        && left.size === right.size
        && left.mtimeMs === right.mtimeMs
        && left.ctimeMs === right.ctimeMs;
}

function openPinnedRegularFile(
    filePath: string,
    label: string,
    expectedIdentity?: FileIdentity,
    pinnedRoot?: PinnedRootDirectory
): PinnedRegularFile {
    if (pinnedRoot) {
        assertCurrentRootPathMatchesPinnedRoot(pinnedRoot);
    }
    const absolutePath = path.resolve(filePath);
    const initialStats = fs.lstatSync(absolutePath);
    if (initialStats.isSymbolicLink()) {
        failClosed(`${label} must not be a symbolic link`);
    }
    if (!initialStats.isFile()) {
        failClosed(`${label} must be a regular file`);
    }

    const fd = fs.openSync(absolutePath, getReadOnlyNoFollowFlags());
    try {
        const openedStats = fs.fstatSync(fd);
        if (!openedStats.isFile()) {
            failClosed(`${label} must remain a regular file`);
        }
        const openedIdentity = getFileIdentity(openedStats);
        const initialIdentity = getFileIdentity(initialStats);
        if (!fileIdentityMatches(openedIdentity, initialIdentity)) {
            failClosed(`${label} changed identity during open`);
        }
        if (expectedIdentity && !fileIdentityMatches(openedIdentity, expectedIdentity)) {
            failClosed(`${label} changed identity before read`);
        }
        const realPath = fs.realpathSync.native(absolutePath);
        if (pinnedRoot) {
            const relativeToRoot = path.relative(pinnedRoot.realRoot, realPath);
            if (!relativeToRoot || relativeToRoot.startsWith('..') || path.isAbsolute(relativeToRoot)) {
                failClosed(`${label} must stay inside the bundle root`);
            }
        }
        const currentPathStats = fs.lstatSync(absolutePath);
        if (currentPathStats.isSymbolicLink() || !currentPathStats.isFile()) {
            failClosed(`${label} path identity changed during open`);
        }
        if (!fileIdentityMatches(getFileIdentity(currentPathStats), openedIdentity)) {
            failClosed(`${label} path identity changed during open`);
        }
        return {
            fd,
            absolutePath,
            realPath,
            identity: openedIdentity
        };
    } catch (error) {
        fs.closeSync(fd);
        throw error;
    }
}

function closePinnedRegularFile(pinnedFile: PinnedRegularFile): void {
    fs.closeSync(pinnedFile.fd);
}

function readPinnedFileBytes(pinnedFile: PinnedRegularFile, label: string): Buffer {
    const bytes = fs.readFileSync(pinnedFile.fd) as Buffer;
    const currentIdentity = getFileIdentity(fs.fstatSync(pinnedFile.fd));
    if (!fileIdentityMatches(currentIdentity, pinnedFile.identity)) {
        failClosed(`${label} changed during read`);
    }
    const currentPathStats = fs.lstatSync(pinnedFile.absolutePath);
    if (currentPathStats.isSymbolicLink() || !currentPathStats.isFile()) {
        failClosed(`${label} path identity changed during read`);
    }
    if (!fileIdentityMatches(getFileIdentity(currentPathStats), pinnedFile.identity)) {
        failClosed(`${label} path identity changed during read`);
    }
    return bytes;
}

function readPinnedBundleRootJsonDocument(
    expectedRelativePath: string,
    filePath: string,
    pinnedRoot: PinnedRootDirectory,
    label: string
): { document: unknown; bytes: Buffer; sha256: string; relativePath: string } {
    assertCurrentRootPathMatchesPinnedRoot(pinnedRoot);
    const absolutePath = path.resolve(filePath);
    const expectedAbsolutePath = path.join(pinnedRoot.absoluteRoot, expectedRelativePath);
    if (absolutePath !== expectedAbsolutePath) {
        failClosed(`${expectedRelativePath} must live at the bundle root`);
    }
    const pinnedFile = openPinnedRegularFile(absolutePath, label, undefined, pinnedRoot);
    try {
        const bytes = readPinnedFileBytes(pinnedFile, label);
        return {
            document: JSON.parse(bytes.toString('utf8')),
            bytes,
            sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
            relativePath: expectedRelativePath
        };
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        failClosed(`${label} is not valid JSON: ${reason}`);
    } finally {
        closePinnedRegularFile(pinnedFile);
    }
}

function collectRealizedTree(
    root: PinnedRootDirectory
): Map<string, { bytes: number; absolutePath: string; identity: FileIdentity; discoverySha256: string }> {
    assertCurrentRootPathMatchesPinnedRoot(root);
    const entries = new Map<string, { bytes: number; absolutePath: string; identity: FileIdentity; discoverySha256: string }>();
    const loweredPaths = new Set<string>();

    const visit = (currentPath: string): void => {
        const directoryEntries = fs.readdirSync(currentPath, { withFileTypes: true })
            .sort((left, right) => compareStrings(left.name, right.name));
        for (const entry of directoryEntries) {
            const absolutePath = path.join(currentPath, entry.name);
            const stats = fs.lstatSync(absolutePath);
            const relativePath = path.relative(root.absoluteRoot, absolutePath).split(path.sep).join('/');
            if (stats.isSymbolicLink()) {
                failClosed(`bundle must not contain symbolic links: ${relativePath}`);
            }
            if (stats.isDirectory()) {
                visit(absolutePath);
                continue;
            }
            if (!stats.isFile()) {
                failClosed(`bundle must contain only regular files: ${relativePath}`);
            }
            const normalizedPath = normalizePortableRelativePath(relativePath, 'realized bundle path');
            const loweredPath = normalizedPath.toLowerCase();
            if (loweredPaths.has(loweredPath)) {
                failClosed(`bundle must not contain case-fold path collisions: ${normalizedPath}`);
            }
            loweredPaths.add(loweredPath);
            const realPath = fs.realpathSync.native(absolutePath);
            const relativeToRoot = path.relative(root.realRoot, realPath);
            if (relativeToRoot === '' || relativeToRoot.startsWith('..') || path.isAbsolute(relativeToRoot)) {
                failClosed(`bundle entry escaped the pinned root: ${normalizedPath}`);
            }
            const pinnedFile = openPinnedRegularFile(
                absolutePath,
                `runtime file ${normalizedPath}`,
                getFileIdentity(stats),
                root
            );
            let discoverySha256: string;
            try {
                discoverySha256 = crypto.createHash('sha256')
                    .update(readPinnedFileBytes(pinnedFile, `runtime file ${normalizedPath}`))
                    .digest('hex');
            } finally {
                closePinnedRegularFile(pinnedFile);
            }
            entries.set(normalizedPath, {
                bytes: stats.size,
                absolutePath: realPath,
                identity: getFileIdentity(stats),
                discoverySha256
            });
        }
    };

    visit(root.absoluteRoot);
    return entries;
}

function sha256HexOfPinnedFile(
    filePath: string,
    label: string,
    expectedIdentity: FileIdentity,
    pinnedRoot: PinnedRootDirectory
): string {
    const pinnedFile = openPinnedRegularFile(filePath, label, expectedIdentity, pinnedRoot);
    try {
        return crypto.createHash('sha256').update(readPinnedFileBytes(pinnedFile, label)).digest('hex');
    } finally {
        closePinnedRegularFile(pinnedFile);
    }
}

function assertRealizedTreeMatchesInventory(
    root: PinnedRootDirectory,
    includedEntries: InventoryEntry[]
): void {
    assertCurrentRootPathMatchesPinnedRoot(root);
    const realizedEntries = collectRealizedTree(root);
    for (const controlPath of CONTROL_METADATA_PATHS) {
        if (!realizedEntries.has(controlPath)) {
            failClosed(`required control metadata file is missing: ${controlPath}`);
        }
    }

    const runtimeEntries = new Map<string, { bytes: number; absolutePath: string; identity: FileIdentity; discoverySha256: string }>();
    for (const [relativePath, record] of realizedEntries.entries()) {
        if (!CONTROL_METADATA_PATHS.has(relativePath)) {
            runtimeEntries.set(relativePath, record);
        }
    }

    if (runtimeEntries.size !== includedEntries.length) {
        failClosed('realized runtime inventory does not match metadata path count');
    }

    for (const expectedEntry of includedEntries) {
        const realized = runtimeEntries.get(expectedEntry.path);
        if (!realized) {
            failClosed(`realized runtime file is missing: ${expectedEntry.path}`);
        }
        if (realized.bytes !== expectedEntry.bytes) {
            failClosed(`realized runtime file has unexpected size: ${expectedEntry.path}`);
        }
        const stableSha256 = sha256HexOfPinnedFile(
            realized.absolutePath,
            `runtime file ${expectedEntry.path}`,
            realized.identity,
            root
        );
        if (stableSha256 !== realized.discoverySha256) {
            failClosed(`runtime file content changed during validation: ${expectedEntry.path}`);
        }
        if (stableSha256 !== expectedEntry.sha256) {
            failClosed(`realized runtime file has unexpected sha256: ${expectedEntry.path}`);
        }
        const actualSha256 = sha256HexOfPinnedFile(
            realized.absolutePath,
            `runtime file ${expectedEntry.path}`,
            realized.identity,
            root
        );
        if (actualSha256 !== expectedEntry.sha256) {
            failClosed(`realized runtime file has unexpected sha256: ${expectedEntry.path}`);
        }
        runtimeEntries.delete(expectedEntry.path);
    }

    if (runtimeEntries.size > 0) {
        const [unexpectedPath] = runtimeEntries.keys();
        failClosed(`realized runtime inventory contains extra files: ${String(unexpectedPath)}`);
    }
}

function exactSandboxMatch(value: unknown): boolean {
    if (!Array.isArray(value) || value.length !== EXACT_SANDBOX_TOKENS.size) {
        return false;
    }
    const tokens = new Set<string>();
    for (let index = 0; index < value.length; index += 1) {
        if (typeof value[index] !== 'string') {
            return false;
        }
        tokens.add(value[index]);
    }
    if (tokens.size !== EXACT_SANDBOX_TOKENS.size) {
        return false;
    }
    for (const token of EXACT_SANDBOX_TOKENS) {
        if (!tokens.has(token)) {
            return false;
        }
    }
    return true;
}

function isStringArray(value: unknown): value is string[] {
    return Array.isArray(value) && value.every(entry => typeof entry === 'string');
}

function isEmptyStringArray(value: unknown): boolean {
    return isStringArray(value) && value.length === 0;
}

function hasNonEmptyOrMalformedStringArray(value: unknown): boolean {
    if (!isStringArray(value)) {
        return true;
    }
    return value.length > 0;
}

function candidateIncludesEntrypoint(candidate: CompatibilityAuditInput['candidate'], entrypoint: string): boolean {
    if (!candidate || !Array.isArray(candidate.includedEntries)) {
        return false;
    }
    for (let index = 0; index < candidate.includedEntries.length; index += 1) {
        const entry = candidate.includedEntries[index];
        if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
            return false;
        }
        if (typeof (entry as { path?: unknown }).path !== 'string') {
            return false;
        }
        if ((entry as { path: string }).path === entrypoint) {
            return true;
        }
    }
    return false;
}

function hasCanonicalMessagingOrigins(value: unknown): boolean {
    if (!Array.isArray(value) || value.length === 0) {
        return false;
    }
    for (let index = 0; index < value.length; index += 1) {
        if (!tryNormalizeOrigin(value[index])) {
            return false;
        }
    }
    return true;
}

function hasUnsafeCspException(value: unknown): boolean {
    if (typeof value !== 'string') {
        return true;
    }
    return /'unsafe-inline'|'unsafe-eval'/i.test(value);
}

function isValidEntrypoint(value: unknown): value is string {
    if (typeof value !== 'string' || !value) {
        return false;
    }
    try {
        normalizePortableRelativePath(value, 'entrypoint');
    } catch {
        return false;
    }
    return true;
}

function blockedVerdict(reasons: string[]): BlockedVerdict {
    return {
        verdict: 'blocked',
        reasons
    };
}

function passedVerdict(): PassedVerdict {
    return {
        verdict: 'pass',
        reasons: []
    };
}

function tryNormalizeOrigin(value: unknown): string | undefined {
    if (typeof value !== 'string') {
        return undefined;
    }
    if (!value || value.trim() !== value) {
        return undefined;
    }
    try {
        const normalizedOrigin = normalizeDrawioRuntimeOrigin(value);
        return normalizedOrigin === value ? normalizedOrigin : undefined;
    } catch {
        return undefined;
    }
}

export function loadDrawioRuntimeCandidate(input: LoadCandidateInput): CandidateSummary {
    const pinnedRoot = openPinnedRootDirectory(ensureNonEmptyString(input.bundleRoot, 'bundleRoot'));
    try {
        const bundleManifestDocument = readPinnedBundleRootJsonDocument(
            'bundle-manifest.json',
            input.bundleManifestPath,
            pinnedRoot,
            'bundle-manifest.json'
        );
        const assetIntegrityDocument = readPinnedBundleRootJsonDocument(
            'asset-integrity.json',
            input.assetIntegrityPath,
            pinnedRoot,
            'asset-integrity.json'
        );
        const packagingReportDocument = readPinnedBundleRootJsonDocument(
            'packaging-report.json',
            input.packagingReportPath,
            pinnedRoot,
            'packaging-report.json'
        );

        const bundleManifest = normalizeCandidateDocument(
            bundleManifestDocument.document,
            'bundle-manifest.json'
        );
        const assetIntegrity = normalizeCandidateDocument(
            assetIntegrityDocument.document,
            'asset-integrity.json'
        );
        const packagingReport = normalizeCandidateDocument(
            packagingReportDocument.document,
            'packaging-report.json'
        );

        if (bundleManifest.runtimeVersion !== DRAWIO_RUNTIME_ACTIVATION_VERSION) {
            failClosed('bundle-manifest.json runtimeVersion must stay pinned to the activation contract');
        }
        if (bundleManifest.policy.runtimeVersion !== DRAWIO_RUNTIME_ACTIVATION_VERSION) {
            failClosed('bundle-manifest.json policy.runtimeVersion must stay pinned to the activation contract');
        }

        assertMetadataAgreement(bundleManifest, assetIntegrity, 'asset-integrity.json');
        assertMetadataAgreement(bundleManifest, packagingReport, 'packaging-report.json');
        assertRealizedTreeMatchesInventory(pinnedRoot, bundleManifest.includedEntries);

        for (const metadataDocument of [
            bundleManifestDocument,
            assetIntegrityDocument,
            packagingReportDocument
        ]) {
            const stableDocument = readPinnedBundleRootJsonDocument(
                metadataDocument.relativePath,
                path.join(pinnedRoot.absoluteRoot, metadataDocument.relativePath),
                pinnedRoot,
                metadataDocument.relativePath
            );
            if (stableDocument.sha256 !== metadataDocument.sha256) {
                failClosed(`${metadataDocument.relativePath} content changed during validation`);
            }
            if (!stableDocument.bytes.equals(metadataDocument.bytes)) {
                failClosed(`${metadataDocument.relativePath} content changed during validation`);
            }
        }

        return bundleManifest;
    } finally {
        closePinnedRootDirectory(pinnedRoot);
    }
}

export function auditDrawioRuntimeCompatibility(input: CompatibilityAuditInput): BlockedVerdict | PassedVerdict {
    const reasons: string[] = [];
    const entrypoint = typeof input.entrypoint === 'string' ? input.entrypoint : undefined;

    if (input.requiresInlineStyle === true) {
        reasons.push('inline-style-required');
    }
    if (input.requiresInlineScript === true) {
        reasons.push('inline-script-required');
    }
    if (input.requiresEval === true) {
        reasons.push('eval-required');
    }
    if (input.requiresFunctionConstructor === true) {
        reasons.push('function-constructor-required');
    }

    if (hasNonEmptyOrMalformedStringArray(input.networkOrigins)) {
        reasons.push('network-origin-required');
    }
    if (hasNonEmptyOrMalformedStringArray(input.networkUrls)) {
        reasons.push('network-url-required');
    }

    if (!hasCanonicalMessagingOrigins(input.messagingTargets)) {
        reasons.push('wildcard-message-target');
    }
    if (!hasCanonicalMessagingOrigins(input.messagingOrigins)) {
        reasons.push('wildcard-message-origin');
    }

    if (!exactSandboxMatch(input.sandbox)) {
        reasons.push('disallowed-sandbox-token');
    }
    if (hasUnsafeCspException(input.csp)) {
        reasons.push('unsafe-csp-exception');
    }
    if (!isValidEntrypoint(entrypoint)) {
        reasons.push('invalid-entrypoint');
    } else {
        if (!candidateIncludesEntrypoint(input.candidate, entrypoint)) {
            reasons.push('invalid-entrypoint');
        }
    }

    return reasons.length > 0 ? blockedVerdict(reasons) : passedVerdict();
}

export function authorizeDrawioRuntimeActivation(
    input: ActivationAuthorizationInput
): BlockedVerdict | PassedVerdict {
    const reasons: string[] = [];
    const candidate = input.candidate;
    const compatibility = input.compatibility;

    if (!candidate || candidate.verdict !== 'candidate') {
        reasons.push('candidate-verdict-not-candidate');
    }
    if (!compatibility || compatibility.verdict !== 'pass') {
        reasons.push('compatibility-not-pass');
    }

    const runtimeOrigin = tryNormalizeOrigin(input.runtimeOrigin);
    if (!runtimeOrigin) {
        reasons.push('invalid-runtime-origin');
    }

    const studioOrigin = tryNormalizeOrigin(input.studioOrigin);
    if (!studioOrigin) {
        reasons.push('invalid-studio-origin');
    }

    if (runtimeOrigin && studioOrigin) {
        try {
            assertDistinctDrawioOrigins(runtimeOrigin, studioOrigin);
        } catch {
            reasons.push('origins-not-distinct');
        }
    }

    if (!exactSandboxMatch(input.sandbox)) {
        reasons.push('sandbox-mismatch');
    }

    if (!isEmptyStringArray(input.networkOrigins)) {
        reasons.push('network-origins-not-empty');
    }

    if (!isEmptyStringArray(input.unsafeExceptions)) {
        reasons.push('unsafe-exceptions-not-empty');
    }

    const activationAudit = input.activationAudit;
    const candidateRuntimeVersion = normalizeCandidateRuntimeVersion(candidate?.runtimeVersion);
    const candidateBundleSha = tryNormalizeSha256(candidate?.bundleSha256);

    if (!activationAudit) {
        reasons.push('activation-audit-missing');
    } else {
        if (activationAudit.verdict !== 'approved') {
            reasons.push('activation-audit-not-approved');
        }

        if (candidateRuntimeVersion !== DRAWIO_RUNTIME_ACTIVATION_VERSION) {
            reasons.push('activation-audit-runtime-version-mismatch');
        } else if (activationAudit.runtimeVersion !== candidateRuntimeVersion) {
            reasons.push('activation-audit-runtime-version-mismatch');
        }

        if (!candidateBundleSha) {
            reasons.push('activation-audit-bundle-sha-mismatch');
        } else if (tryNormalizeSha256(activationAudit.bundleSha256) !== candidateBundleSha) {
            reasons.push('activation-audit-bundle-sha-mismatch');
        }
    }

    return reasons.length > 0 ? blockedVerdict(reasons) : passedVerdict();
}
