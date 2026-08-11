function assertOriginString(value: unknown, label: string): string {
    if (typeof value !== 'string') {
        throw new Error(`${label} must be a string.`);
    }
    const trimmed = value.trim();
    if (!trimmed) {
        throw new Error(`${label} must not be empty.`);
    }
    return trimmed;
}

export function normalizeDrawioRuntimeOrigin(value: string, label = 'runtime origin'): string {
    const normalizedValue = assertOriginString(value, label);

    let parsed: URL;
    try {
        parsed = new URL(normalizedValue);
    } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        throw new Error(`${label} must be a valid absolute URL: ${reason}`);
    }

    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new Error(`${label} must use http or https.`);
    }
    if (parsed.username || parsed.password) {
        throw new Error(`${label} must not include credentials.`);
    }
    if (parsed.pathname !== '/' && parsed.pathname !== '') {
        throw new Error(`${label} must not include a path.`);
    }
    if (parsed.search) {
        throw new Error(`${label} must not include a query string.`);
    }
    if (parsed.hash) {
        throw new Error(`${label} must not include a fragment.`);
    }
    if (parsed.hostname.includes('*')) {
        throw new Error(`${label} must not include wildcard host patterns.`);
    }
    if (/[{}]/.test(parsed.hostname)) {
        throw new Error(`${label} must not include template host markers.`);
    }

    return parsed.origin;
}

export function assertDistinctDrawioOrigins(runtimeOriginInput: string, studioOriginInput: string): {
    runtimeOrigin: string;
    studioOrigin: string;
} {
    const runtimeOrigin = normalizeDrawioRuntimeOrigin(runtimeOriginInput, 'runtime origin');
    const studioOrigin = normalizeDrawioRuntimeOrigin(studioOriginInput, 'studio origin');
    if (runtimeOrigin === studioOrigin) {
        throw new Error('runtime origin must differ from studio origin.');
    }
    return { runtimeOrigin, studioOrigin };
}
