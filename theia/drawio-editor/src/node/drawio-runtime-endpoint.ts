import * as fs from 'fs';
import * as path from 'path';
import { createHash, timingSafeEqual } from 'crypto';
import { injectable } from '@theia/core/shared/inversify';
import { Application, Router } from '@theia/core/shared/express';
import { BackendApplicationContribution } from '@theia/core/lib/node/backend-application';
import { assertDistinctDrawioOrigins, normalizeDrawioRuntimeOrigin } from '../common/drawio-runtime-origin-policy';

export const DRAWIO_RUNTIME_ROUTE_PATH = '/drawio-runtime';
export const DRAWIO_RUNTIME_ORIGIN_ENV = 'DRAWIO_RUNTIME_ORIGIN';
export const DRAWIO_STUDIO_ORIGIN_ENV = 'DRAWIO_STUDIO_ORIGIN';
export const DRAWIO_RUNTIME_TRUST_PROXY_ENV = 'DRAWIO_RUNTIME_TRUST_PROXY';
export const DRAWIO_RUNTIME_TRUSTED_PROXY_TOKEN_ENV = 'DRAWIO_RUNTIME_TRUSTED_PROXY_TOKEN';
export const DRAWIO_RUNTIME_TRUSTED_PROXY_TOKEN_HEADER = 'x-drawio-runtime-proxy-token';

const IMMUTABLE_ASSET_HASH_PATTERN = /^[0-9a-f]{64}$/;
const MINIMUM_TRUSTED_PROXY_TOKEN_BYTES = 32;
const BLOCKED_RUNTIME_FILE_PATH = path.resolve(__dirname, '../../runtime/blocked.html');

export interface DrawioRuntimeHeaderInput {
    readonly runtimeOriginInput: string;
    readonly studioOriginInput: string;
    readonly assetHash?: string;
}

export interface DrawioRuntimeConfig {
    readonly runtimeOriginInput?: string;
    readonly studioOriginInput?: string;
    readonly assetHash?: string;
    readonly trustProxy?: boolean;
    readonly trustedProxyToken?: string;
}

export interface DrawioRuntimeRequestLike {
    readonly socket?: unknown;
    get(name: string): string | undefined;
}

interface DrawioRuntimeResponseLike {
    status(code: number): DrawioRuntimeResponseLike;
    set(headers: Record<string, string>): DrawioRuntimeResponseLike;
    type(contentType: string): DrawioRuntimeResponseLike;
    send(body: string): DrawioRuntimeResponseLike;
}

export interface DrawioRuntimeRequestOriginInput {
    readonly request: DrawioRuntimeRequestLike;
    readonly runtimeOriginInput: string;
    readonly studioOriginInput: string;
    readonly trustProxy?: boolean;
    readonly trustedProxyToken?: string;
}

export function buildDrawioRuntimeHeaders({
    runtimeOriginInput,
    studioOriginInput,
    assetHash
}: DrawioRuntimeHeaderInput): Record<string, string> {
    const runtimeOrigin = normalizeDrawioRuntimeOrigin(runtimeOriginInput, 'runtime origin');
    const { studioOrigin } = assertDistinctDrawioOrigins(runtimeOrigin, studioOriginInput);

    if (assetHash !== undefined && !IMMUTABLE_ASSET_HASH_PATTERN.test(assetHash)) {
        throw new Error('assetHash must be a 64-character lowercase hexadecimal content hash.');
    }

    const cacheControl = assetHash
        ? 'public, max-age=31536000, immutable'
        : 'no-store';

    return {
        'Content-Security-Policy': `default-src 'none'; connect-src 'none'; frame-ancestors ${studioOrigin}`,
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': cacheControl
    };
}

function buildUnavailableHeaders(): Record<string, string> {
    return {
        'Content-Security-Policy': "default-src 'none'; connect-src 'none'; frame-ancestors 'none'",
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'no-store'
    };
}

function buildUnavailableResponse(response: DrawioRuntimeResponseLike): void {
    response.status(503);
    response.set(buildUnavailableHeaders());
    response.type('text/plain').send('Draw.io runtime endpoint is unavailable.');
}

function usesEncryptedSocket(socket: unknown): boolean {
    if (!socket || typeof socket !== 'object') {
        return false;
    }
    return (socket as { encrypted?: unknown }).encrypted === true;
}

function readRequiredHeaderValue(request: DrawioRuntimeRequestLike, headerName: string): string | undefined {
    const value = request.get(headerName);
    if (value === undefined) {
        return undefined;
    }
    if (value.trim().length === 0) {
        throw new Error(`${headerName} header must not be empty.`);
    }
    if (value !== value.trim()) {
        throw new Error(`${headerName} header must not include surrounding whitespace.`);
    }
    if (value.includes(',')) {
        throw new Error(`${headerName} header must contain exactly one value.`);
    }
    return value;
}

function buildRequestOrigin(protocol: string, host: string): string {
    if (protocol !== 'http' && protocol !== 'https') {
        throw new Error('request protocol must be http or https.');
    }
    return normalizeDrawioRuntimeOrigin(`${protocol}://${host}`, 'request origin');
}

function getTrustedProxyConfigurationError(): Error {
    return new Error(
        `${DRAWIO_RUNTIME_TRUSTED_PROXY_TOKEN_ENV} must be configured with at least ${MINIMUM_TRUSTED_PROXY_TOKEN_BYTES} UTF-8 bytes when trusted proxy mode is enabled.`
    );
}

function requireTrustedProxyTokenConfig(trustedProxyToken: string | undefined): string {
    if (trustedProxyToken === undefined) {
        throw getTrustedProxyConfigurationError();
    }
    if (Buffer.byteLength(trustedProxyToken, 'utf8') < MINIMUM_TRUSTED_PROXY_TOKEN_BYTES) {
        throw getTrustedProxyConfigurationError();
    }
    return trustedProxyToken;
}

function hashTrustedProxyToken(value: string): Buffer {
    return createHash('sha256').update(value, 'utf8').digest();
}

function assertTrustedProxyToken(request: DrawioRuntimeRequestLike, trustedProxyToken: string | undefined): void {
    const configuredToken = requireTrustedProxyTokenConfig(trustedProxyToken);
    const presentedToken = readRequiredHeaderValue(request, DRAWIO_RUNTIME_TRUSTED_PROXY_TOKEN_HEADER);
    if (!presentedToken) {
        throw new Error(
            `${DRAWIO_RUNTIME_TRUSTED_PROXY_TOKEN_HEADER} header is required when trusted proxy mode is enabled.`
        );
    }

    const configuredHash = hashTrustedProxyToken(configuredToken);
    const presentedHash = hashTrustedProxyToken(presentedToken);
    if (!timingSafeEqual(configuredHash, presentedHash)) {
        throw new Error(
            `${DRAWIO_RUNTIME_TRUSTED_PROXY_TOKEN_HEADER} header did not authenticate the trusted proxy request.`
        );
    }
}

export function resolveDrawioRuntimeRequestOrigin(
    request: DrawioRuntimeRequestLike,
    trustProxy = false,
    trustedProxyToken?: string
): string {
    const host = readRequiredHeaderValue(request, 'host');
    if (!host) {
        throw new Error('host header is required.');
    }

    if (trustProxy) {
        assertTrustedProxyToken(request, trustedProxyToken);
        const forwardedProto = readRequiredHeaderValue(request, 'x-forwarded-proto');
        const forwardedHost = readRequiredHeaderValue(request, 'x-forwarded-host');
        if (!forwardedProto || !forwardedHost) {
            throw new Error('trusted proxy mode requires both x-forwarded-proto and x-forwarded-host.');
        }
        return buildRequestOrigin(forwardedProto, forwardedHost);
    }

    const directProtocol = usesEncryptedSocket(request.socket) ? 'https' : 'http';
    return buildRequestOrigin(directProtocol, host);
}

export function assertDrawioRuntimeRequestOrigin({
    request,
    runtimeOriginInput,
    studioOriginInput,
    trustProxy = false,
    trustedProxyToken
}: DrawioRuntimeRequestOriginInput): {
    runtimeOrigin: string;
    studioOrigin: string;
    requestOrigin: string;
} {
    const { runtimeOrigin, studioOrigin } = assertDistinctDrawioOrigins(runtimeOriginInput, studioOriginInput);
    const requestOrigin = resolveDrawioRuntimeRequestOrigin(request, trustProxy, trustedProxyToken);

    if (requestOrigin === studioOrigin) {
        throw new Error('request origin must not match the configured Studio origin.');
    }
    if (requestOrigin !== runtimeOrigin) {
        throw new Error('request origin must match the configured Draw.io runtime origin.');
    }

    return { runtimeOrigin, studioOrigin, requestOrigin };
}

@injectable()
export class DrawioRuntimeEndpoint implements BackendApplicationContribution {
    protected readonly runtimeConfig: DrawioRuntimeConfig = {
        runtimeOriginInput: process.env[DRAWIO_RUNTIME_ORIGIN_ENV],
        studioOriginInput: process.env[DRAWIO_STUDIO_ORIGIN_ENV],
        trustProxy: process.env[DRAWIO_RUNTIME_TRUST_PROXY_ENV] === 'true',
        trustedProxyToken: process.env[DRAWIO_RUNTIME_TRUSTED_PROXY_TOKEN_ENV]
    };

    configure(app: Application): void {
        const router = Router();
        router.get('/', (request, response) => {
            try {
                assertDrawioRuntimeRequestOrigin({
                    request,
                    runtimeOriginInput: this.runtimeConfig.runtimeOriginInput ?? '',
                    studioOriginInput: this.runtimeConfig.studioOriginInput ?? '',
                    trustProxy: this.runtimeConfig.trustProxy,
                    trustedProxyToken: this.runtimeConfig.trustedProxyToken
                });
                const headers = buildDrawioRuntimeHeaders({
                    runtimeOriginInput: this.runtimeConfig.runtimeOriginInput ?? '',
                    studioOriginInput: this.runtimeConfig.studioOriginInput ?? '',
                    assetHash: this.runtimeConfig.assetHash
                });
                response.set(headers);
                fs.readFile(BLOCKED_RUNTIME_FILE_PATH, 'utf8', (error, content) => {
                    if (error) {
                        buildUnavailableResponse(response);
                        return;
                    }
                    response.type('html').send(content);
                });
            } catch {
                buildUnavailableResponse(response);
            }
        });
        app.use(DRAWIO_RUNTIME_ROUTE_PATH, router);
    }
}
