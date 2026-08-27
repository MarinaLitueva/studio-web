/**
 * The studio-connector client, for every MFE that talks to that gear.
 */

import { BaseApiService, RestEndpointProtocol, RestProtocol } from '@gears-frontx/react';
import type {
  ConnectionListDto,
  ConnectionTestDto,
  CreateConnectionBody,
  ProviderListDto,
  RemoteRepoListDto,
} from './connectorTypes';

export const CONNECTORS_API_BASE_URL = '/cf/studio-connector/v1';

export const REPOSITORY_PAGE_LIMIT = 100;

export interface ConnectionsParams {
  /** Organization tenant whose catalogue to read. */
  tenantId: string;
}

export interface ConnectionTestParams {
  connectionId: string;
  tenantId: string;
}

export interface RepositoriesParams {
  connectionId: string;
  tenantId: string;
  search?: string;
  limit?: number;
}

export function connectionsPath({ tenantId }: ConnectionsParams): string {
  return `/connections?tenant=${encodeURIComponent(tenantId)}`;
}

export function connectionTestPath({ connectionId, tenantId }: ConnectionTestParams): string {
  return `/connections/${encodeURIComponent(connectionId)}/test?tenant=${encodeURIComponent(
    tenantId
  )}`;
}

export function repositoriesPath({
  connectionId,
  tenantId,
  search,
  limit,
}: RepositoriesParams): string {
  const query = new URLSearchParams({ tenant: tenantId });
  if (search) query.set('search', search);
  if (limit !== undefined) query.set('limit', String(limit));
  return `/connections/${encodeURIComponent(connectionId)}/repositories?${query.toString()}`;
}

export class ConnectorsApiService extends BaseApiService {
  constructor() {
    const restProtocol = new RestProtocol({ timeout: 30000 });
    const restEndpoints = new RestEndpointProtocol(restProtocol);

    super({ baseURL: CONNECTORS_API_BASE_URL }, restProtocol, restEndpoints);
  }

  readonly providers = this.protocol(RestEndpointProtocol).query<ProviderListDto>('/providers');

  readonly connections = this.protocol(RestEndpointProtocol).queryWith<
    ConnectionListDto,
    ConnectionsParams
  >(connectionsPath);

  readonly repositories = this.protocol(RestEndpointProtocol).queryWith<
    RemoteRepoListDto,
    RepositoriesParams
  >(repositoriesPath);

  readonly createConnection = this.protocol(RestEndpointProtocol).mutation<
    ConnectionTestDto,
    CreateConnectionBody
  >('POST', '/connections');

  connectionTest(params: ConnectionTestParams) {
    return this.protocol(RestEndpointProtocol).mutation<ConnectionTestDto, void>(
      'POST',
      connectionTestPath(params)
    );
  }
}
