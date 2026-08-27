//! Platform-admin identity directory.
//!
//! Account Management lists users only inside one tenant. ADR-0011 needs a
//! separate onboarding view for identities that authenticated successfully but
//! have not been assigned to an organization. This gear keeps the Keycloak
//! Admin API and its credential server-side and exposes a root-scoped read-only
//! projection to the portal.

mod rest;
mod service;

use std::sync::{Arc, OnceLock};

use account_management_sdk::AccountManagementClient;
use async_trait::async_trait;
use axum::Router;
use toolkit::api::OpenApiRegistry;
use toolkit::{Gear, GearCtx};
use tracing::{info, warn};

use service::IdentityDirectoryService;

#[toolkit::gear(
    name = "studio-identity-directory",
    deps = [account_management],
    capabilities = [rest]
)]
#[derive(Default)]
pub struct IdentityDirectoryGear {
    service: OnceLock<Option<Arc<IdentityDirectoryService>>>,
}
#[async_trait]
impl Gear for IdentityDirectoryGear {
    async fn init(&self, ctx: &GearCtx) -> anyhow::Result<()> {
        let base_url = std::env::var("STUDIO_IDP_ADMIN_BASE_URL").unwrap_or_default();
        let secret = std::env::var("STUDIO_IDP_ADMIN_SECRET").unwrap_or_default();
        let service = if base_url.trim().is_empty() || secret.is_empty() {
            warn!(
                base_url_set = !base_url.trim().is_empty(),
                secret_set = !secret.is_empty(),
                "studio-identity-directory: Keycloak admin connection is not configured"
            );
            None
        } else {
            let account_management = ctx.client_hub().get::<dyn AccountManagementClient>()?;
            let service = IdentityDirectoryService::new(
                base_url,
                "studio".to_owned(),
                "studio-admin".to_owned(),
                secret,
                account_management,
            )?;
            info!("studio-identity-directory: Keycloak-backed directory configured");
            Some(Arc::new(service))
        };
        self.service
            .set(service)
            .map_err(|_| anyhow::anyhow!("studio-identity-directory already initialized"))?;
        Ok(())
    }
}

#[async_trait]
impl toolkit::contracts::RestApiCapability for IdentityDirectoryGear {
    fn register_rest(
        &self,
        _ctx: &GearCtx,
        router: Router,
        openapi: &dyn OpenApiRegistry,
    ) -> anyhow::Result<Router> {
        let service = self
            .service
            .get()
            .ok_or_else(|| anyhow::anyhow!("studio-identity-directory not initialized"))?
            .clone();
        Ok(rest::register_routes(router, openapi, service))
    }
}
