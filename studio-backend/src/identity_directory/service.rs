use std::collections::HashMap;
use std::sync::Arc;
use std::time::Duration;

use account_management_sdk::AccountManagementClient;
use anyhow::{Context, Result, bail};
use reqwest::Client;
use serde::Deserialize;
use toolkit_security::SecurityContext;
use uuid::Uuid;

pub const PLATFORM_ROOT_TENANT_ID: Uuid = Uuid::from_u128(1);

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
                .get("tenant_id")
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
}
