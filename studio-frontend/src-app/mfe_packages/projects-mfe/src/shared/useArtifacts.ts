import { useCallback, useMemo } from 'react';
import { apiRegistry, useApiQuery, useQueryCache } from '@gears-frontx/react';
import { ArtifactIngestApiService } from '../api/ArtifactIngestApiService';
import { buildArtifactRows, type ArtifactRow } from '../model/artifact';
import { useProjectConfig } from './useProjectConfig';
import type { ProjectSource } from '../api/types';

export interface ArtifactsView {
  rows: ArtifactRow[];
  sources: ProjectSource[];
  loading: boolean;
  failed: boolean;
  refetch: () => void;
}

// @cpt-dod:cpt-studiofrontend-dod-project-artifacts-counters:p1
export function useArtifacts(projectId: string): ArtifactsView {
  const ingest = apiRegistry.getService(ArtifactIngestApiService);
  const cache = useQueryCache();

  const nodesQuery = ingest.nodes({ scope: projectId });
  const { data, isLoading, isError } = useApiQuery(nodesQuery);
  const { config, loading: configLoading, failed: configFailed } = useProjectConfig(projectId);

  const sources = useMemo(() => config?.sources ?? [], [config]);
  const rows = useMemo(() => buildArtifactRows(data?.nodes ?? []), [data]);

  const refetch = useCallback(() => {
    void cache.invalidate(ingest.nodes({ scope: projectId }));
  }, [cache, ingest, projectId]);

  return {
    rows,
    sources,
    loading: isLoading || configLoading,
    failed: isError || configFailed,
    refetch,
  };
}
