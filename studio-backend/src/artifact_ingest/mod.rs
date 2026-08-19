//! studio-artifact-ingest — pull issues/PRs from a connector source into the
//! graph as typed GTS nodes.
//!
//! Two channels feed the artifact graph: git clone (files — future slice) and
//! the connector API (issues, pull requests — this gear). Entities are
//! normalized to `gts.cf.studio.artifact.*` instances with deterministic ids
//! and upserted into a graph store (a logging stub until the real
//! `hypothesis/graph-storage` adapter lands).

mod graph;
mod gts;
mod rest;
mod service;

use std::collections::HashMap;
use std::sync::Arc;

use async_trait::async_trait;
use axum::Router;
use credstore_sdk::CredStoreClientV1;
use toolkit::api::OpenApiRegistry;
use toolkit::client_hub::ClientScope;
use toolkit::contracts::RestApiCapability;
use toolkit::{Gear, GearCtx};
use tracing::{info, warn};
use types_registry_sdk::{RegisterResult, TypesRegistryClient};

use crate::connectors::driver::ConnectorDriver;
use graph::LoggingGraphStore;
use service::IngestService;

#[toolkit::gear(
    name = "studio-artifact-ingest",
    deps = [types_registry, credstore],
    capabilities = [rest]
)]
#[derive(Default)]
pub struct StudioArtifactIngestGear {
    /// `None` inside the `OnceLock` = booted without a driver → routes 503.
    service: std::sync::OnceLock<Option<Arc<IngestService>>>,
}

#[async_trait]
impl Gear for StudioArtifactIngestGear {
    async fn init(&self, ctx: &GearCtx) -> anyhow::Result<()> {
        // Register the artifact GTS type schemas (idempotent — same documents
        // every boot).
        let registry = ctx.client_hub().get::<dyn TypesRegistryClient>()?;
        let results = registry.register(gts::type_schemas()).await?;
        RegisterResult::ensure_all_ok(&results)?;

        // Resolve the source connector drivers by the same ClientHub ids the
        // connector gear uses. A provider whose plugin is not linked is skipped.
        let mut drivers: HashMap<String, Arc<dyn ConnectorDriver>> = HashMap::new();
        for id in crate::connectors::source_driver_ids() {
            if let Ok(d) = ctx
                .client_hub()
                .get_scoped::<dyn ConnectorDriver>(&ClientScope::gts_id(id))
            {
                drivers.insert(d.provider().to_string(), d);
            }
        }

        let service = if drivers.is_empty() {
            warn!(
                "studio-artifact-ingest: no connector driver plugins registered — \
                 /sync will answer 503"
            );
            None
        } else {
            let credstore = ctx.client_hub().get::<dyn CredStoreClientV1>()?;
            Some(Arc::new(IngestService::new(
                credstore,
                drivers,
                Arc::new(LoggingGraphStore),
            )))
        };

        self.service
            .set(service)
            .map_err(|_| anyhow::anyhow!("studio-artifact-ingest gear already initialized"))?;
        info!("studio-artifact-ingest: initialized");
        Ok(())
    }
}

#[async_trait]
impl RestApiCapability for StudioArtifactIngestGear {
    fn register_rest(
        &self,
        _ctx: &GearCtx,
        router: Router,
        openapi: &dyn OpenApiRegistry,
    ) -> anyhow::Result<Router> {
        let service = self.service.get().cloned().flatten();
        Ok(rest::register_routes(router, openapi, service))
    }
}
