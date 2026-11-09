// @cpt-algo:cpt-studiofrontend-algo-connection-list-read:p2
import React, { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiRegistry, useApiQuery, useQueryCache } from '@gears-frontx/react';
import type { DataGridLoadContext, DataGridLoadResult } from '@gears-frontx/ui-kit';
import {
  type ConnectionDto,
  ConnectorsApiService,
  type OrganizationRef,
  RowsBridge,
  TEXT_SEARCH_FILTER_KEY,
  useOrganization,
} from '@constructor-studio/mfe-shared';

export interface ConnectionRow {
  id: string;
  connection: ConnectionDto;
  providerName: string;
}

export interface ConnectionListView {
  loading: boolean;
  failed: boolean;
  org: OrganizationRef | null;
  total: number;
  /** What the search found; `null` until the grid's first load. */
  found: number | null;
  retry: () => void;
  load: (context: DataGridLoadContext) => Promise<DataGridLoadResult<ConnectionRow>>;
  rowsBridge: React.ReactElement;
}

export function matchesQuery(row: ConnectionRow, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  const { label, account, provider } = row.connection;
  return [label, account, provider, row.providerName].some((field) =>
    field.toLowerCase().includes(needle)
  );
}

export function useConnectionList(): ConnectionListView {
  const connectors = apiRegistry.getService(ConnectorsApiService);
  const cache = useQueryCache();
  const { org, loading: orgLoading } = useOrganization();

  // @cpt-begin:cpt-studiofrontend-algo-connection-list-read:p2:inst-2
  const { data: providerData, isLoading: providersLoading } = useApiQuery(connectors.providers);
  // @cpt-end:cpt-studiofrontend-algo-connection-list-read:p2:inst-2

  // @cpt-begin:cpt-studiofrontend-algo-connection-list-read:p2:inst-1
  const listing = connectors.connections({ tenantId: org?.id ?? '' });
  const {
    data: connectionData,
    isLoading: connectionsLoading,
    isError: connectionsFailed,
  } = useQuery({
    queryKey: listing.key,
    queryFn: ({ signal }) => listing.fetch({ signal }),
    enabled: Boolean(org?.id),
  });
  // @cpt-end:cpt-studiofrontend-algo-connection-list-read:p2:inst-1

  const all = useMemo<ConnectionRow[]>(() => {
    const names = new Map(
      (providerData?.items ?? []).map((provider) => [provider.provider, provider.display_name])
    );
    return (connectionData?.items ?? []).map((connection) => ({
      id: connection.id,
      connection,
      // @cpt-begin:cpt-studiofrontend-algo-connection-list-read:p2:inst-3
      providerName: names.get(connection.provider) ?? connection.provider,
      // @cpt-end:cpt-studiofrontend-algo-connection-list-read:p2:inst-3
    }));
  }, [providerData, connectionData]);

  const rowsKey = useMemo(() => JSON.stringify(all), [all]);
  const rowsRef = useRef(all);
  useLayoutEffect(() => {
    rowsRef.current = all;
  }, [all]);

  const [found, setFound] = useState<number | null>(null);
  const load = useCallback(
    async (context: DataGridLoadContext): Promise<DataGridLoadResult<ConnectionRow>> => {
      const search: string = context.filters?.[TEXT_SEARCH_FILTER_KEY]?.value ?? '';
      // @cpt-begin:cpt-studiofrontend-algo-connection-list-read:p2:inst-4
      const shown = rowsRef.current.filter((row) => matchesQuery(row, search));
      // @cpt-end:cpt-studiofrontend-algo-connection-list-read:p2:inst-4
      setFound(shown.length);
      const { page, limit } = context.pagination ?? { page: 1, limit: shown.length };
      return { results: shown.slice((page - 1) * limit, page * limit), total: shown.length };
    },
    []
  );

  const tenantId = org?.id ?? '';
  const retry = useCallback(() => {
    void cache.invalidate(connectors.connections({ tenantId }));
  }, [cache, connectors, tenantId]);

  // @cpt-begin:cpt-studiofrontend-algo-connection-list-read:p2:inst-6
  return {
    loading: orgLoading || providersLoading || connectionsLoading,
    failed: connectionsFailed,
    org,
    total: all.length,
    found,
    retry,
    load,
    rowsBridge: <RowsBridge rowsKey={rowsKey} />,
  };
  // @cpt-end:cpt-studiofrontend-algo-connection-list-read:p2:inst-6
}
