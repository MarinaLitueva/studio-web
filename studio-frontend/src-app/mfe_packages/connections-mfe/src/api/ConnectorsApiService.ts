/**
 * studio-connector — the only gear behind this MFE.
 */

import { BaseApiService, RestEndpointProtocol, RestProtocol } from '@gears-frontx/react';
import type {
  ConnectionListDto,
  ConnectionTestDto,
  CreateConnectionBody,
  ProviderListDto,
} from './connectorTypes';

export const CONNECTORS_API_BASE_URL = '/cf/studio-connector/v1';

export interface ConnectionsParams {
  tenantId: string;
}

export interface ConnectionTestParams {
  connectionId: string;
  tenantId: string;
}

export function connectionsPath({ tenantId }: ConnectionsParams): string {
  return `/connections?tenant=${encodeURIComponent(tenantId)}`;
}

export function connectionTestPath({ connectionId, tenantId }: ConnectionTestParams): string {
  return `/connections/${encodeURIComponent(connectionId)}/test?tenant=${encodeURIComponent(
    tenantId
  )}`;
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
