// @cpt-dod:cpt-studiofrontend-dod-connection-list-health:p1
// @cpt-algo:cpt-studiofrontend-algo-connection-list-health:p2
import { useQuery } from '@tanstack/react-query';
import { apiRegistry } from '@gears-frontx/react';
import { ConnectorsApiService } from '../api/ConnectorsApiService';
import type { ConnectionHealth } from '../model/connection';

/** Long enough that a re-render is free; short enough that a fix shows up. */
const HEALTH_STALE_TIME = 5 * 60 * 1000;

const CREDENTIAL_UNUSABLE = 'CONNECTOR_CREDENTIAL_UNUSABLE';

export interface ConnectionHealthView {
  health: ConnectionHealth | null;
  reason: string | null;
  loading: boolean;
  failed: boolean;
}

interface Violation {
  type?: unknown;
  description?: unknown;
}

/**
 * The gears answer errors as RFC 7807, carrying their own vocabulary in
 * `context.violations[]` — each entry a `{ type, subject, description }`.
 */
function violations(error: unknown): readonly Violation[] {
  if (typeof error !== 'object' || error === null) return [];
  const data = (error as { response?: { data?: unknown } }).response?.data;
  if (typeof data !== 'object' || data === null) return [];
  const context = (data as { context?: unknown }).context;
  if (typeof context !== 'object' || context === null) return [];
  const list = (context as { violations?: unknown }).violations;
  return Array.isArray(list) ? (list as Violation[]) : [];
}

function credentialRefusal(error: unknown): Violation | null {
  return violations(error).find((entry) => entry.type === CREDENTIAL_UNUSABLE) ?? null;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function refusalText(error: unknown, refusal: Violation): string | null {
  const described = text(refusal.description);
  if (described) return described;
  if (typeof error !== 'object' || error === null) return null;
  const data = (error as { response?: { data?: unknown } }).response?.data;
  if (typeof data === 'string') return text(data);
  if (typeof data === 'object' && data !== null) {
    const record = data as { detail?: unknown; message?: unknown };
    const message = text(record.detail) ?? text(record.message);
    if (message) return message;
  }
  return text((error as { message?: unknown }).message);
}

export function useConnectionHealth(
  connectionId: string,
  tenantId: string
): ConnectionHealthView {
  const connectors = apiRegistry.getService(ConnectorsApiService);

  // @cpt-begin:cpt-studiofrontend-algo-connection-list-health:p2:inst-1
  // @cpt-begin:cpt-studiofrontend-algo-connection-list-health:p2:inst-2
  const { isPending, isError, error } = useQuery({
    queryKey: ['studio-connector', 'connection-health', tenantId, connectionId],
    queryFn: ({ signal }) =>
      connectors.connectionTest({ connectionId, tenantId }).fetch(undefined, { signal }),
    enabled: Boolean(tenantId && connectionId),
    retry: false,
    staleTime: HEALTH_STALE_TIME,
    gcTime: HEALTH_STALE_TIME,
  });
  // @cpt-end:cpt-studiofrontend-algo-connection-list-health:p2:inst-1
  // @cpt-end:cpt-studiofrontend-algo-connection-list-health:p2:inst-2

  // @cpt-begin:cpt-studiofrontend-algo-connection-list-health:p2:inst-3
  // @cpt-begin:cpt-studiofrontend-algo-connection-list-health:p2:inst-4
  if (isPending) return { health: null, reason: null, loading: true, failed: false };
  // @cpt-end:cpt-studiofrontend-algo-connection-list-health:p2:inst-3
  // @cpt-end:cpt-studiofrontend-algo-connection-list-health:p2:inst-4

  if (isError) {
    const refusal = credentialRefusal(error);

    // @cpt-begin:cpt-studiofrontend-algo-connection-list-health:p2:inst-5
    // @cpt-begin:cpt-studiofrontend-algo-connection-list-health:p2:inst-6
    if (!refusal) return { health: null, reason: null, loading: false, failed: true };
    // @cpt-end:cpt-studiofrontend-algo-connection-list-health:p2:inst-5
    // @cpt-end:cpt-studiofrontend-algo-connection-list-health:p2:inst-6

    // @cpt-begin:cpt-studiofrontend-algo-connection-list-health:p2:inst-7
    // @cpt-begin:cpt-studiofrontend-algo-connection-list-health:p2:inst-8
    return {
      health: 'unusable',
      reason: refusalText(error, refusal),
      loading: false,
      failed: false,
    };
    // @cpt-end:cpt-studiofrontend-algo-connection-list-health:p2:inst-7
    // @cpt-end:cpt-studiofrontend-algo-connection-list-health:p2:inst-8
  }

  // @cpt-begin:cpt-studiofrontend-algo-connection-list-health:p2:inst-9
  return { health: 'healthy', reason: null, loading: false, failed: false };
  // @cpt-end:cpt-studiofrontend-algo-connection-list-health:p2:inst-9
}
