/**
 * account-management — the only gear behind this MFE now.
 */

import {
  BaseApiService,
  RestEndpointProtocol,
  RestProtocol,
  type EndpointDescriptor,
} from '@gears-frontx/react';
import { orNullOnNotFound } from '../shared/notFound';
import { TENANT_TYPES } from './types';
import type { Me, MetadataEntry, Page, ProjectConfig, TenantDto, User } from './types';

/** `POST /tenants`. AM accepts these three fields on create. */
export interface CreateTenantBody {
  name: string;
  parent_id: string;
  tenant_type: string;
}

export const ACCOUNTS_API_BASE_URL = '/cf/account-management/v1';

/** AM's own ceiling (`listing.max_top`), so one page is usually enough. */
export const CHILDREN_PAGE_LIMIT = 200;

export interface ProjectConfigParams {
  tenantId: string;
  metadataType: string;
}

export interface UserLookupParams {
  tenantId: string;
  userId: string;
}

function userLookupPath({ tenantId, userId }: UserLookupParams): string {
  const query = new URLSearchParams({ $filter: `id eq ${userId}`, limit: '1' });
  return `/tenants/${tenantId}/users?${query.toString()}`;
}

export interface ChildrenParams {
  tenantId: string;
  tenantType?: string;
  limit?: number;
  cursor?: string;
}

export function childrenPageParams(tenantId: string): ChildrenParams {
  return { tenantId, tenantType: TENANT_TYPES.project, limit: CHILDREN_PAGE_LIMIT };
}

function childrenPath({ tenantId, tenantType, limit, cursor }: ChildrenParams): string {
  const query = new URLSearchParams();
  if (tenantType) query.set('$filter', `tenant_type eq '${tenantType}'`);
  if (limit !== undefined) query.set('limit', String(limit));
  if (cursor) query.set('cursor', cursor);
  const suffix = query.toString();
  return `/tenants/${tenantId}/children${suffix ? `?${suffix}` : ''}`;
}

export class AccountsApiService extends BaseApiService {
  constructor() {
    const restProtocol = new RestProtocol({ timeout: 30000 });
    const restEndpoints = new RestEndpointProtocol(restProtocol);

    super({ baseURL: ACCOUNTS_API_BASE_URL }, restProtocol, restEndpoints);
  }

  readonly me = this.protocol(RestEndpointProtocol).query<Me>('/me');

  readonly tenant = this.protocol(RestEndpointProtocol).queryWith<TenantDto, { tenantId: string }>(
    ({ tenantId }) => `/tenants/${tenantId}`
  );

  readonly children = this.protocol(RestEndpointProtocol).queryWith<Page<TenantDto>, ChildrenParams>(
    childrenPath
  );

  readonly tenantUser = this.protocol(RestEndpointProtocol).queryWith<
    Page<User>,
    UserLookupParams
  >(userLookupPath);


  private readonly projectConfigEntry = this.protocol(RestEndpointProtocol).queryWith<
    MetadataEntry<ProjectConfig>,
    ProjectConfigParams
  >(({ tenantId, metadataType }) => `/tenants/${tenantId}/metadata/${metadataType}`);

  readonly projectConfig = (
    params: ProjectConfigParams
  ): EndpointDescriptor<MetadataEntry<ProjectConfig> | null> =>
    orNullOnNotFound(this.projectConfigEntry(params));

  readonly createTenant = this.protocol(RestEndpointProtocol).mutation<
    TenantDto,
    CreateTenantBody
  >('POST', '/tenants');

  projectConfigWrite(tenantId: string, metadataType: string) {
    return this.protocol(RestEndpointProtocol).mutation<unknown, ProjectConfig>(
      'PUT',
      `/tenants/${tenantId}/metadata/${metadataType}`
    );
  }
}
