import fixture = require('./workspace-snapshot-fixture.json');
import type { WorkspaceSnapshotResponse } from './workspace-protocol';
import { WORKSPACE_PROTOCOL_SCHEMA_VERSION } from './workspace-protocol';

const FORBIDDEN_SECRET_KEYS = [
    'token',
    'tokens',
    'password',
    'passwords',
    'credential',
    'credentials',
    'secret',
    'secrets'
] as const;

const fixtureResponse = fixture as unknown as WorkspaceSnapshotResponse;

function collectForbiddenPaths(value: unknown, path = '$'): string[] {
    if (Array.isArray(value)) {
        return value.flatMap((entry, index) => collectForbiddenPaths(entry, `${path}[${index}]`));
    }
    if (!value || typeof value !== 'object') {
        return [];
    }

    return Object.entries(value).flatMap(([key, nestedValue]) => {
        const nestedPath = `${path}.${key}`;
        const hits = FORBIDDEN_SECRET_KEYS.includes(key.toLowerCase() as typeof FORBIDDEN_SECRET_KEYS[number])
            ? [nestedPath]
            : [];
        return hits.concat(collectForbiddenPaths(nestedValue, nestedPath));
    });
}

describe('workspace protocol contracts', () => {
    it('pins the representative fixture to the current schema version', () => {
        const response = fixtureResponse;

        expect(WORKSPACE_PROTOCOL_SCHEMA_VERSION).toBe(1);
        expect(response.schemaVersion).toBe(WORKSPACE_PROTOCOL_SCHEMA_VERSION);
        expect(response.snapshot.schemaVersion).toBe(WORKSPACE_PROTOCOL_SCHEMA_VERSION);
        expect(response.snapshot.identity.configFileName).toBe('.cf-workspace.toml');
        expect(response.snapshot.config.rawTomlAvailable).toBe(true);
        expect(response.snapshot.config.resolveWorkdir).toBe('workspace-sources');
        expect(response.snapshot.config.resolveNamespace).toEqual({
            'github.com': '{org}/{repo}'
        });
        expect(response.snapshot.config.resolveRootUri).toBe('file:///workspace/workspace-sources');
        expect(response.snapshot.config.canonicalResolveRootUri).toBe('file:///workspace/workspace-sources');
    });

    it('round-trips representative wire data without changing shape', () => {
        const response = fixtureResponse;
        const serialized = JSON.stringify(response);
        const reparsed = JSON.parse(serialized) as WorkspaceSnapshotResponse;

        expect(reparsed).toEqual(fixtureResponse);
        expect(reparsed.snapshot.configuredSources).toHaveLength(1);
        expect(reparsed.snapshot.observedSources).toHaveLength(1);
        expect(reparsed.snapshot.jobs[0]?.preview?.requiresConfirmation).toBe(true);
    });

    it('rejects any credential-shaped fields in the wire contract fixture', () => {
        const forbiddenPaths = collectForbiddenPaths(fixture);

        expect(forbiddenPaths).toEqual([]);
    });
});
