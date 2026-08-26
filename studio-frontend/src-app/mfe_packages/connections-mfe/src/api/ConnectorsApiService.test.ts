import { describe, expect, it } from 'vitest';
import {
  CONNECTORS_API_BASE_URL,
  connectionTestPath,
  connectionsPath,
} from './ConnectorsApiService';

/**
 * The paths, and nothing else. Every one of them carries a tenant in the query
 * string, and a missing or unencoded one is a request that silently reads the
 * caller's own tenant instead of the organization on screen — a wrong answer
 * rather than an error, which is exactly what a unit test is for.
 */
describe('studio-connector paths', () => {
  it('is mounted under the gateway prefix', () => {
    expect(CONNECTORS_API_BASE_URL).toBe('/cf/studio-connector/v1');
  });

  it('scopes the listing to the tenant being viewed', () => {
    expect(connectionsPath({ tenantId: 'org-1' })).toBe('/connections?tenant=org-1');
  });

  it('encodes a tenant id that would otherwise break the query string', () => {
    expect(connectionsPath({ tenantId: 'a b&c' })).toBe('/connections?tenant=a%20b%26c');
  });

  it('scopes the health check to the same tenant', () => {
    expect(connectionTestPath({ connectionId: 'c-1', tenantId: 'org-1' })).toBe(
      '/connections/c-1/test?tenant=org-1'
    );
  });
});
