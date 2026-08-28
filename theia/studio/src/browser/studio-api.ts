import { Endpoint } from '@theia/core/lib/browser/endpoint';

/**
 * Resolve the same-origin session-gate endpoint through Theia's public URL
 * helper. In Kubernetes the IDE is reverse-proxied below
 * `/studio/{sessionId}/`; an origin-rooted `/studio-api` request bypasses that
 * proxy and lands in the portal SPA instead. Endpoint preserves the active
 * Theia pathname, while still resolving to `/studio-api/...` for standalone
 * root deployments.
 */
export function studioApiUrl(path: string, location: Endpoint.Location = self.location): string {
    const queryIndex = path.indexOf('?');
    const pathname = queryIndex >= 0 ? path.slice(0, queryIndex) : path;
    const query = queryIndex >= 0 ? path.slice(queryIndex) : '';
    const gearPath = pathname.startsWith('/') ? pathname.slice(1) : pathname;
    const endpoint = new Endpoint(
        { path: `studio-api/${gearPath}` },
        location,
    ).getRestUrl().toString();
    return endpoint + query;
}

/** Latest portal-issued API context, kept in memory and shared by the Studio
 * browser widgets that call backend gears through the session gate. */
export const StudioApi = {
    token: '' as string,
    /** Tenant scope from the portal handshake (`studio.init` workspaceId). */
    scope: '' as string,
    scoped(path: string): string {
        if (!StudioApi.scope) {
            return path;
        }
        const sep = path.includes('?') ? '&' : '?';
        return `${path}${sep}scope=${encodeURIComponent(StudioApi.scope)}`;
    },
    async fetch(path: string, init: RequestInit = {}): Promise<Response> {
        return fetch(studioApiUrl(path), {
            ...init,
            headers: {
                ...(init.headers ?? {}),
                Authorization: `Bearer ${StudioApi.token}`,
                'Content-Type': 'application/json',
            },
        });
    },
};
