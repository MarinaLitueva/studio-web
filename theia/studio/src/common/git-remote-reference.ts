export interface GitRemoteCoordinates {
    readonly host: string;
    readonly org: string;
    readonly repo: string;
}

const DEFAULT_NAMESPACE_TEMPLATE = '{org}/{repo}';

export function parseGitRemoteCoordinates(remoteUrl: string): GitRemoteCoordinates | undefined {
    const trimmed = remoteUrl.trim();
    let host: string;
    let remotePath: string;
    try {
        const parsed = new URL(trimmed);
        if (parsed.protocol !== 'https:' && parsed.protocol !== 'ssh:') {
            return undefined;
        }
        host = parsed.hostname.toLowerCase();
        remotePath = parsed.pathname;
    } catch {
        if (trimmed.includes('::')) {
            return undefined;
        }
        const scpLike = /^(?:[A-Za-z0-9._-]+@)?([A-Za-z0-9.-]+):(.+)$/u.exec(trimmed);
        if (!scpLike) {
            return undefined;
        }
        host = scpLike[1].toLowerCase();
        remotePath = scpLike[2];
    }

    const segments = remotePath
        .replace(/^\/+|\/+$/gu, '')
        .split('/')
        .filter(Boolean)
        .map(segment => normalizeRemotePathSegment(segment));
    if (segments.length === 0) {
        return undefined;
    }
    const repo = segments.pop()!.replace(/\.git$/iu, '') || 'source';
    return {
        host,
        org: segments.join('/'),
        repo
    };
}

export function resolveRemoteCheckoutRelativePath(
    remoteUrl: string,
    sourceId: string,
    namespace: Readonly<Record<string, string>> = {}
): string {
    const coordinates = parseGitRemoteCoordinates(remoteUrl);
    if (!coordinates) {
        return normalizeRemotePathSegment(sourceId);
    }
    const template = namespace[coordinates.host] ?? DEFAULT_NAMESPACE_TEMPLATE;
    const rendered = template
        .replace(/\{org\}/gu, coordinates.org)
        .replace(/\{repo\}/gu, coordinates.repo);
    const segments = rendered
        .split(/[\\/]+/u)
        .filter(Boolean);
    if (segments.length === 0 || segments.some(segment => segment === '.' || segment === '..')) {
        throw new Error(`Resolved namespace template is invalid for ${coordinates.host}`);
    }
    return segments.map(segment => normalizeRemotePathSegment(segment)).join('/');
}

function normalizeRemotePathSegment(value: string): string {
    const safe = value
        .trim()
        .replace(/[^a-z0-9._-]+/giu, '-')
        .replace(/^-+|-+$/gu, '');
    return safe || 'source';
}
