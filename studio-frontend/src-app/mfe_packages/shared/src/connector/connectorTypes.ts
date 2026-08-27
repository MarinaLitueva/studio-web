/**
 * Wire shapes of the studio-connector gear. Kept apart from any MFE's own
 * vocabulary: these are connections and repositories, not tenants.
 */

export interface ProviderDto {
  provider: string;
  display_name: string;
  default_base_url: string;
  instance_id: string;
  category: string;
  credential_label: string;
  credential_hint: string;
}

export interface ProviderListDto {
  items: ProviderDto[];
}

/** A configured source host. `GET /connections`. */
export interface ConnectionDto {
  id: string;
  owner_tenant_id: string;
  provider: string;
  label: string;
  account: string;
  base_url: string;
  scope: string;
  secret_ref: string;
  created_at_epoch_secs: number;
}

export interface ConnectionListDto {
  items: ConnectionDto[];
}

/** The answer to both `POST /connections` and `POST /connections/{id}/test`. */
export interface ConnectionTestDto {
  connection: ConnectionDto;
  account: string;
  display_name?: string | null;
}

export interface CreateConnectionBody {
  provider: string;
  label: string;
  base_url?: string;
  token: string;
  scope: string;
  owner_tenant_id: string;
}

export interface RemoteRepoDto {
  id: string;
  name: string;
  full_path: string;
  clone_url: string;
  default_branch?: string | null;
  description?: string | null;
  visibility?: string | null;
}

export interface RemoteRepoListDto {
  items: RemoteRepoDto[];
}
