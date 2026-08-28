use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use account_management_sdk::{AccountManagementClient, UpsertMetadataRequest};
use anyhow::{Context, Result, bail};
use gts::GtsTypeId;
use reqwest::Client;
use serde::Deserialize;
use toolkit_security::SecurityContext;
use uuid::Uuid;

pub const PLATFORM_ROOT_TENANT_ID: Uuid = Uuid::from_u128(1);
const HOME_TENANT_ATTRIBUTE: &str = "tenant_id";
const ORGANIZATION_ROLE_ATTRIBUTE: &str = "studio_organization_role";
const TENANT_GROUP_ROOT: &str = "tenants";
const ACCESS_METADATA_TYPE: &str = "gts.cf.core.am.tenant_metadata.v1~cf.studio.access.config.v1~";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DirectoryIdentity {
    pub id: String,
    pub username: String,
    pub email: Option<String>,
    pub display_name: Option<String>,
    pub identity_provider: Option<String>,
    pub first_seen_at_epoch_ms: Option<i64>,
    pub status: &'static str,
    pub home_tenant_id: Option<Uuid>,
    pub home_tenant_name: Option<String>,
    pub organization_role: Option<String>,
}

#[derive(Debug, Deserialize)]
struct TokenResponse {
    access_token: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FederatedIdentity {
    identity_provider: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct KeycloakUser {
    id: String,
    #[serde(default)]
    username: String,
    email: Option<String>,
    first_name: Option<String>,
    last_name: Option<String>,
    created_timestamp: Option<i64>,
    service_account_client_id: Option<String>,
    #[serde(default)]
    attributes: HashMap<String, Vec<String>>,
    #[serde(default)]
    federated_identities: Vec<FederatedIdentity>,
}

#[derive(Debug, Deserialize)]
struct KeycloakGroup {
    id: String,
    name: String,
    path: String,
}

pub struct IdentityDirectoryService {
    http: Client,
    admin_base_url: String,
    realm: String,
    client_id: String,
    client_secret: String,
    account_management: Arc<dyn AccountManagementClient>,
}

impl IdentityDirectoryService {
    pub fn new(
        admin_base_url: String,
        realm: String,
        client_id: String,
        client_secret: String,
        account_management: Arc<dyn AccountManagementClient>,
    ) -> Result<Self> {
        let http = Client::builder()
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(30))
            .build()?;
        Ok(Self {
            http,
            admin_base_url: admin_base_url.trim_end_matches('/').to_owned(),
            realm,
            client_id,
            client_secret,
            account_management,
        })
    }

    async fn admin_token(&self) -> Result<String> {
        let url = format!(
            "{}/realms/{}/protocol/openid-connect/token",
            self.admin_base_url, self.realm
        );
        let response = self
            .http
            .post(url)
            .form(&[
                ("grant_type", "client_credentials"),
                ("client_id", self.client_id.as_str()),
                ("client_secret", self.client_secret.as_str()),
            ])
            .send()
            .await
            .context("request Keycloak admin access token")?
            .error_for_status()
            .context("Keycloak rejected identity-directory client credentials")?
            .json::<TokenResponse>()
            .await
            .context("decode Keycloak admin access token response")?;
        if response.access_token.is_empty() {
            bail!("Keycloak returned an empty admin access token");
        }
        Ok(response.access_token)
    }

    async fn keycloak_users(&self, token: &str) -> Result<Vec<KeycloakUser>> {
        let url = format!("{}/admin/realms/{}/users", self.admin_base_url, self.realm);
        self.http
            .get(url)
            .bearer_auth(token)
            .query(&[
                ("first", "0"),
                ("max", "200"),
                ("briefRepresentation", "false"),
            ])
            .send()
            .await
            .context("list Keycloak users")?
            .error_for_status()
            .context("Keycloak rejected the identity-directory request")?
            .json::<Vec<KeycloakUser>>()
            .await
            .context("decode Keycloak users response")
    }

    async fn tenant_group(&self, token: &str, tenant_id: Uuid) -> Result<KeycloakGroup> {
        let groups_url = format!("{}/admin/realms/{}/groups", self.admin_base_url, self.realm);
        let parent = self
            .http
            .get(groups_url)
            .bearer_auth(token)
            .query(&[
                ("search", TENANT_GROUP_ROOT),
                ("exact", "true"),
                ("briefRepresentation", "false"),
            ])
            .send()
            .await
            .context("find Keycloak tenant group root")?
            .error_for_status()
            .context("Keycloak rejected the tenant group root lookup")?
            .json::<Vec<KeycloakGroup>>()
            .await
            .context("decode Keycloak tenant group root")?
            .into_iter()
            .find(|group| {
                group.name == TENANT_GROUP_ROOT && group.path == format!("/{TENANT_GROUP_ROOT}")
            })
            .context("Keycloak tenant group root does not exist")?;

        let children_url = format!(
            "{}/admin/realms/{}/groups/{}/children",
            self.admin_base_url, self.realm, parent.id
        );
        let tenant_name = tenant_id.to_string();
        self.http
            .get(children_url)
            .bearer_auth(token)
            .query(&[
                ("search", tenant_name.as_str()),
                ("exact", "true"),
                ("briefRepresentation", "false"),
            ])
            .send()
            .await
            .context("find Keycloak organization group")?
            .error_for_status()
            .context("Keycloak rejected the organization group lookup")?
            .json::<Vec<KeycloakGroup>>()
            .await
            .context("decode Keycloak organization group")?
            .into_iter()
            .find(|group| {
                group.name == tenant_name
                    && group.path == format!("/{TENANT_GROUP_ROOT}/{tenant_name}")
            })
            .context("Keycloak organization group does not exist")
    }

    async fn sync_tenant_group_membership(
        &self,
        token: &str,
        identity_id: Uuid,
        tenant_id: Uuid,
    ) -> Result<()> {
        let target = self.tenant_group(token, tenant_id).await?;
        let groups_url = format!(
            "{}/admin/realms/{}/users/{}/groups",
            self.admin_base_url, self.realm, identity_id
        );
        let current = self
            .http
            .get(&groups_url)
            .bearer_auth(token)
            .query(&[
                ("first", "0"),
                ("max", "200"),
                ("briefRepresentation", "false"),
            ])
            .send()
            .await
            .context("list Keycloak user groups")?
            .error_for_status()
            .context("Keycloak rejected the user group lookup")?
            .json::<Vec<KeycloakGroup>>()
            .await
            .context("decode Keycloak user groups")?;

        let tenant_path_prefix = format!("/{TENANT_GROUP_ROOT}/");
        for group in current
            .into_iter()
            .filter(|group| group.path.starts_with(&tenant_path_prefix) && group.id != target.id)
        {
            let membership_url = format!("{groups_url}/{}", group.id);
            self.http
                .delete(membership_url)
                .bearer_auth(token)
                .send()
                .await
                .context("remove stale Keycloak organization membership")?
                .error_for_status()
                .context("Keycloak rejected stale organization membership removal")?;
        }

        let membership_url = format!("{groups_url}/{}", target.id);
        self.http
            .put(membership_url)
            .bearer_auth(token)
            .send()
            .await
            .context("add Keycloak organization membership")?
            .error_for_status()
            .context("Keycloak rejected the organization membership")?;
        Ok(())
    }

    pub async fn list(&self, ctx: &SecurityContext) -> Result<Vec<DirectoryIdentity>> {
        let token = self.admin_token().await?;
        let users = self.keycloak_users(&token).await?;
        let mut tenants = HashMap::<Uuid, Option<String>>::new();
        let mut identities = Vec::with_capacity(users.len());

        for user in users {
            if user.service_account_client_id.is_some() {
                continue;
            }

            let requested_tenant = user
                .attributes
                .get(HOME_TENANT_ATTRIBUTE)
                .and_then(|values| values.first())
                .and_then(|value| Uuid::parse_str(value).ok());

            let home_tenant_name = if let Some(tenant_id) = requested_tenant {
                if let Some(cached) = tenants.get(&tenant_id) {
                    cached.clone()
                } else {
                    let resolved = self
                        .account_management
                        .get_tenant(ctx, tenant_id)
                        .await
                        .ok()
                        .map(|tenant| tenant.name);
                    tenants.insert(tenant_id, resolved.clone());
                    resolved
                }
            } else {
                None
            };

            let home_tenant_id = requested_tenant.filter(|_| home_tenant_name.is_some());
            let status = if home_tenant_id == Some(PLATFORM_ROOT_TENANT_ID) {
                "platform_admin"
            } else if home_tenant_id.is_some() {
                "assigned"
            } else {
                "unassigned"
            };
            let display_name = [user.first_name.as_deref(), user.last_name.as_deref()]
                .into_iter()
                .flatten()
                .filter(|part| !part.trim().is_empty())
                .collect::<Vec<_>>()
                .join(" ");

            identities.push(DirectoryIdentity {
                id: user.id,
                username: user.username,
                email: user.email,
                display_name: (!display_name.is_empty()).then_some(display_name),
                identity_provider: user
                    .federated_identities
                    .first()
                    .map(|identity| identity.identity_provider.clone()),
                first_seen_at_epoch_ms: user.created_timestamp,
                status,
                home_tenant_id,
                home_tenant_name,
                organization_role: user
                    .attributes
                    .get(ORGANIZATION_ROLE_ATTRIBUTE)
                    .and_then(|values| values.first())
                    .cloned(),
            });
        }

        identities.sort_by(|left, right| {
            right
                .first_seen_at_epoch_ms
                .cmp(&left.first_seen_at_epoch_ms)
                .then_with(|| left.username.cmp(&right.username))
        });
        Ok(identities)
    }

    /// Assign an existing Keycloak identity to an Account Management tenant.
    ///
    /// Account Management's user surface is an IdP-backed projection. Tokens
    /// use the `tenant_id` attribute while tenant-scoped user listing uses the
    /// matching Keycloak group, so assignment must update both representations.
    pub async fn assign(
        &self,
        ctx: &SecurityContext,
        identity_id: &str,
        tenant_id: Uuid,
        organization_role: &str,
    ) -> Result<()> {
        let identity_id = Uuid::parse_str(identity_id).context("identity id is not a UUID")?;
        let identity_id_string = identity_id.to_string();
        let tenant = self
            .account_management
            .get_tenant(ctx, tenant_id)
            .await
            .map_err(|error| anyhow::anyhow!("cannot resolve target organization: {error}"))?;

        let token = self.admin_token().await?;
        let url = format!(
            "{}/admin/realms/{}/users/{}",
            self.admin_base_url, self.realm, identity_id
        );
        let mut user = self
            .http
            .get(&url)
            .bearer_auth(&token)
            .send()
            .await
            .context("get Keycloak user for organization assignment")?
            .error_for_status()
            .context("Keycloak rejected the user lookup")?
            .json::<serde_json::Value>()
            .await
            .context("decode Keycloak user representation")?;

        let attributes = user
            .as_object_mut()
            .context("Keycloak user representation is not an object")?
            .entry("attributes")
            .or_insert_with(|| serde_json::json!({}));
        let attributes = attributes
            .as_object_mut()
            .context("Keycloak user attributes are not an object")?;
        attributes.insert(
            HOME_TENANT_ATTRIBUTE.to_owned(),
            serde_json::json!([tenant_id.to_string()]),
        );
        attributes.insert(
            ORGANIZATION_ROLE_ATTRIBUTE.to_owned(),
            serde_json::json!([organization_role]),
        );

        // Owner is also a real organization-wide access grant understood by
        // Studio's PDP. Member is tenant membership without that elevated
        // grant; project roles can still be assigned independently.
        self.set_owner_grant(
            ctx,
            tenant_id,
            &tenant.name,
            &identity_id_string,
            organization_role == "owner",
        )
        .await?;

        self.http
            .put(url)
            .bearer_auth(&token)
            .json(&user)
            .send()
            .await
            .context("update Keycloak organization assignment")?
            .error_for_status()
            .context("Keycloak rejected the organization assignment")?;

        // Account Management's Keycloak IdP projection lists members from
        // the per-tenant group, not from the `tenant_id` attribute. Keep both
        // representations synchronized so assigned identities immediately
        // appear in the organization's People screen.
        self.sync_tenant_group_membership(&token, identity_id, tenant_id)
            .await?;
        Ok(())
    }

    async fn set_owner_grant(
        &self,
        ctx: &SecurityContext,
        tenant_id: Uuid,
        tenant_name: &str,
        identity_id: &str,
        owner: bool,
    ) -> Result<()> {
        let type_id = GtsTypeId::new(ACCESS_METADATA_TYPE);
        let mut config = match self
            .account_management
            .get_metadata(ctx, tenant_id, type_id.clone())
            .await
        {
            Ok(entry) => entry.value,
            Err(_) => serde_json::json!({ "model": "tenant", "roles": [], "grants": [] }),
        };
        let config_object = config
            .as_object_mut()
            .context("organization access config is not an object")?;
        let grants = config_object
            .entry("grants")
            .or_insert_with(|| serde_json::json!([]))
            .as_array_mut()
            .context("organization access grants are not an array")?;
        grants.retain(|grant| {
            grant.get("subjectType").and_then(|value| value.as_str()) != Some("member")
                || grant.get("subjectId").and_then(|value| value.as_str()) != Some(identity_id)
                || grant.get("scopeType").and_then(|value| value.as_str()) != Some("org")
                || grant.get("roleKey").and_then(|value| value.as_str()) != Some("owner")
        });
        if owner {
            grants.push(serde_json::json!({
                "id": Uuid::new_v4().to_string(),
                "subjectType": "member",
                "subjectId": identity_id,
                "subjectName": identity_id,
                "roleKey": "owner",
                "scopeType": "org",
                "scopeId": tenant_id.to_string(),
                "scopeName": tenant_name,
            }));
        }
        self.account_management
            .upsert_metadata(ctx, tenant_id, UpsertMetadataRequest::new(type_id, config))
            .await
            .map_err(|error| anyhow::anyhow!("cannot update organization owner grant: {error}"))?;
        Ok(())
    }
}
