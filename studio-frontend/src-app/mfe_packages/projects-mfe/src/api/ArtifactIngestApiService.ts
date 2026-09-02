/** studio-artifact-ingest — the graph of what a project's repositories contain */

import {
  BaseApiService,
  RestEndpointProtocol,
  RestProtocol,
} from '@gears-frontx/react';
import type {
  ArtifactNodeListDto,
  SyncBody,
  SyncEnqueuedDto,
  TaskStatusDto,
} from './artifactTypes';

export const ARTIFACT_INGEST_API_BASE_URL = '/cf/studio-artifact-ingest/v1';

export interface NodesParams {
  scope: string;
}

export function nodesPath({ scope }: NodesParams): string {
  return `/nodes?${new URLSearchParams({ scope }).toString()}`;
}

export class ArtifactIngestApiService extends BaseApiService {
  constructor() {
    const restProtocol = new RestProtocol({ timeout: 30000 });
    const restEndpoints = new RestEndpointProtocol(restProtocol);

    super({ baseURL: ARTIFACT_INGEST_API_BASE_URL }, restProtocol, restEndpoints);
  }

  // @cpt-dod:cpt-studiofrontend-dod-project-artifacts-scope:p1
  readonly nodes = this.protocol(RestEndpointProtocol).queryWith<
    ArtifactNodeListDto,
    NodesParams
  >(nodesPath);

  readonly task = this.protocol(RestEndpointProtocol).queryWith<
    TaskStatusDto,
    { taskId: string }
  >(({ taskId }) => `/tasks/${taskId}`);

  readonly sync = this.protocol(RestEndpointProtocol).mutation<SyncEnqueuedDto, SyncBody>(
    'POST',
    '/sync'
  );
}
