// @cpt-dod:cpt-studiofrontend-dod-connection-list-health:p1
// @cpt-algo:cpt-studiofrontend-algo-connection-list-health:p2
import { useQuery } from '@tanstack/react-query';
import { apiRegistry } from '@gears-frontx/react';
import { ConnectorsApiService } from '../api/ConnectorsApiService';
import type { ConnectionHealth } from '../model/connection';

/** Long enough that a re-render is free; short enough that a fix shows up. */
const HEALTH_STALE_TIME = 5 * 60 * 1000;

export interface ConnectionHealthView {
  health: ConnectionHealth;
  reason: string | null;
}

function refusalText(error: unknown): string | null {
  if (typeof error !== 'object' || error === null) return null;
  const data = (error as { response?: { data?: unknown } }).response?.data;
  if (typeof data === 'string' && data.trim()) return data;
  if (typeof data === 'object' && data !== null) {
    const record = data as { message?: unknown; detail?: unknown };
    const message = record.message ?? record.detail;
    if (typeof message === 'string' && message.trim()) return message;
  }
  const message = (error as { message?: unknown }).message;
  return typeof message === 'string' && message.trim() ? message : null;
}

export function useConnectionHealth(
  connectionId: string,
  tenantId: string
): ConnectionHealthView {
  const connectors = apiRegistry.getService(ConnectorsApiService);

  // @cpt-begin:cpt-studiofrontend-algo-connection-list-health:p2:inst-1
  // @cpt-begin:cpt-studiofrontend-algo-connection-list-health:p2:inst-2
  const { isError, isSuccess, error } = useQuery({
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

  // @cpt-begin:cpt-studiofrontend-algo-connection-list-health:p2:inst-5
  // @cpt-begin:cpt-studiofrontend-algo-connection-list-health:p2:inst-6
  if (isError) return { health: 'unusable', reason: refusalText(error) };
  // @cpt-end:cpt-studiofrontend-algo-connection-list-health:p2:inst-5
  // @cpt-end:cpt-studiofrontend-algo-connection-list-health:p2:inst-6
  // @cpt-begin:cpt-studiofrontend-algo-connection-list-health:p2:inst-7
  if (isSuccess) return { health: 'healthy', reason: null };
  // @cpt-end:cpt-studiofrontend-algo-connection-list-health:p2:inst-7
  // @cpt-begin:cpt-studiofrontend-algo-connection-list-health:p2:inst-3
  // @cpt-begin:cpt-studiofrontend-algo-connection-list-health:p2:inst-4
  return { health: 'checking', reason: null };
  // @cpt-end:cpt-studiofrontend-algo-connection-list-health:p2:inst-3
  // @cpt-end:cpt-studiofrontend-algo-connection-list-health:p2:inst-4
}
