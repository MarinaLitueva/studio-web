import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { apiRegistry, useApiQuery, useQueryCache } from '@gears-frontx/react';
import {
  useDataGrid,
  type DataGridLoadContext,
  type DataGridLoadResult,
} from '@gears-frontx/ui-kit';
import { ConnectorsApiService } from '@constructor-studio/mfe-shared';
import { ArtifactIngestApiService } from '../api/ArtifactIngestApiService';
import { DocumentsApiService } from '../api/DocumentsApiService';
import { inFlight } from '../model/repoImport';
import {
  buildSourceRows,
  filterSourceRows,
  sourcesFooter,
  type SourceRow,
  type SourcesAnswers,
  type SourcesFooter,
} from '../model/sourceRows';
import { useProjectImport } from './useArtifactImport';
import { repositoryNodesParams } from './useArtifacts';
import { useProjectConfig } from './useProjectConfig';

export const SOURCES_SEARCH_KEY = 'textSearch';

export interface SourcesLoad {
  ready: boolean;
  failed: boolean;
  rows: SourceRow[];
  footer: SourcesFooter;
  windowDays: number | null;
  load: (context: DataGridLoadContext) => Promise<DataGridLoadResult<SourceRow>>;
  rowsBridge: React.ReactElement;
}

const RowsBridge: React.FC<{ rowsKey: string }> = ({ rowsKey }) => {
  const grid = useDataGrid();
  const shown = useRef(rowsKey);
  useEffect(() => {
    if (shown.current === rowsKey) return;
    shown.current = rowsKey;
    void grid.triggerLoad();
  }, [grid, rowsKey]);
  return null;
};

// @cpt-dod:cpt-studiofrontend-dod-project-sources-reads:p1
// @cpt-dod:cpt-studiofrontend-dod-project-sources-gaps:p1
// @cpt-dod:cpt-studiofrontend-dod-project-sources-search:p1
export function useSourcesLoad(projectId: string, workspaceId: string, orgId: string): SourcesLoad {
  const ingest = apiRegistry.getService(ArtifactIngestApiService);
  const documents = apiRegistry.getService(DocumentsApiService);
  const connectors = apiRegistry.getService(ConnectorsApiService);
  const cache = useQueryCache();

  const config = useProjectConfig(projectId);
  const nodesParams = useMemo(() => repositoryNodesParams(projectId), [projectId]);
  const nodes = useApiQuery(ingest.nodes(nodesParams));
  const connections = useApiQuery(connectors.connections({ tenantId: orgId }));
  const activity = useApiQuery(ingest.sourceActivity({ scope: projectId }));
  const specs = useApiQuery(documents.specsPerSource({ scope: projectId }));
  const studio = useApiQuery(documents.projectDocuments({ workspaceId, projectId, limit: 1 }));
  const { repos: lines } = useProjectImport(projectId);

  const answers = useMemo<SourcesAnswers>(
    () => ({
      sources: config.config?.sources ?? [],
      nodes: nodes.data?.nodes ?? [],
      connections: connections.isError ? null : (connections.data?.items ?? []),
      activity: activity.isError ? null : (activity.data ?? null),
      specs: specs.isError ? null : (specs.data ?? null),
      lines,
    }),
    [
      config.config,
      nodes.data,
      connections.isError,
      connections.data,
      activity.isError,
      activity.data,
      specs.isError,
      specs.data,
      lines,
    ]
  );
  const rows = useMemo(() => buildSourceRows(answers), [answers]);
  const documentsTotal = studio.isError ? null : (studio.data?.total ?? null);
  const footer = useMemo(
    () => sourcesFooter(rows, answers, documentsTotal),
    [rows, answers, documentsTotal]
  );

  const rowsKey = useMemo(() => JSON.stringify(rows), [rows]);

  // A repository's numbers move when its sync ends; nothing pushes them.
  const settled = lines
    .filter((line) => !inFlight(line.status))
    .map((line) => `${line.repo}:${line.runId}:${line.status}`)
    .join('\n');
  const seen = useRef<{ projectId: string; settled: Set<string> } | null>(null);
  useEffect(() => {
    const last = seen.current;
    const now = new Set(settled ? settled.split('\n') : []);
    seen.current = { projectId, settled: now };
    if (last?.projectId !== projectId) return;
    if (![...now].some((line) => !last.settled.has(line))) return;
    void cache.invalidate(ingest.nodes(nodesParams));
    void cache.invalidate(ingest.sourceActivity({ scope: projectId }));
    void cache.invalidate(documents.specsPerSource({ scope: projectId }));
  }, [settled, projectId, cache, ingest, documents, nodesParams]);

  const rowsRef = useRef(rows);
  useLayoutEffect(() => {
    rowsRef.current = rows;
  }, [rows]);

  const load = useCallback(
    async (context: DataGridLoadContext): Promise<DataGridLoadResult<SourceRow>> => {
      const search: string = context.filters?.[SOURCES_SEARCH_KEY]?.value ?? '';
      const shown = filterSourceRows(rowsRef.current, search);
      const { page, limit } = context.pagination ?? { page: 1, limit: shown.length };
      return { results: shown.slice((page - 1) * limit, page * limit), total: shown.length };
    },
    []
  );

  return {
    ready:
      !config.loading &&
      !nodes.isLoading &&
      !connections.isLoading &&
      !activity.isLoading &&
      !specs.isLoading &&
      !studio.isLoading,
    failed: config.failed || nodes.isError,
    rows,
    footer,
    windowDays: answers.activity?.days ?? null,
    load,
    rowsBridge: <RowsBridge rowsKey={rowsKey} />,
  };
}
