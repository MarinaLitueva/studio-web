//! studio-artifact-ingest — pull issues, pull requests and files from a
//! connector source into the graph as typed GTS nodes.
//!
//! Three channels feed the artifact graph: the connector API (issues, pull
//! requests) and files. Files are read from the studio-session workspace
//! checkout when the IDE has already cloned the repo (one shared clone,
//! `STUDIO_WORKSPACES_ROOT`); otherwise from our own shallow clone
//! (`STUDIO_ARTIFACT_WORKDIR`, opt-in), otherwise the connector tree API
//! (metadata only). Entities are normalized to `gts.cf.studio.artifact.*`
//! instances with deterministic ids and upserted into a graph store (an
//! in-memory store, readable back by the portal, until the real
//! `hypothesis/graph-storage` adapter lands).

mod clone;
mod graph;
mod gts;
mod rest;
mod service;
mod tasks;

use std::collections::HashMap;
use std::path::PathBuf;
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
use graph::InMemoryGraphStore;
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

        // Preferred file source: the studio-session workspaces root. When the
        // IDE has cloned a repo into `{root}/{workspace_id}/{repo_dir}`, ingest
        // reads that same checkout — one shared clone. Mirrors the session
        // gear's default (`~/.cf-studio-workspaces`) and its `~` expansion.
        let workspaces_root = resolve_dir("STUDIO_WORKSPACES_ROOT")
            .or_else(|| resolve_home_relative(".cf-studio-workspaces"));
        if let Some(r) = &workspaces_root {
            info!(dir = %r.display(), "studio-artifact-ingest: reading files from the session workspaces root when present");
        }

        // Optional fallback: our own shallow clone volume. Off unless
        // STUDIO_ARTIFACT_WORKDIR is set — with the shared workspace as the
        // primary source, most deployments leave this unset (tree API otherwise).
        let work_root = match resolve_dir("STUDIO_ARTIFACT_WORKDIR") {
            Some(path) => match std::fs::create_dir_all(&path) {
                Ok(()) => {
                    info!(dir = %path.display(), "studio-artifact-ingest: fallback own-clone volume enabled");
                    Some(path)
                }
                Err(e) => {
                    warn!(dir = %path.display(), error = %e, "studio-artifact-ingest: fallback work dir not usable");
                    None
                }
            },
            None => None,
        };

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
                Arc::new(InMemoryGraphStore::default()),
                workspaces_root,
                work_root,
            )))
        };

        self.service
            .set(service)
            .map_err(|_| anyhow::anyhow!("studio-artifact-ingest gear already initialized"))?;
        info!("studio-artifact-ingest: initialized");
        Ok(())
    }
}

/// A directory path from an env var, `~`-expanded, or `None` if unset/empty.
fn resolve_dir(env: &str) -> Option<PathBuf> {
    let raw = std::env::var(env).ok()?;
    let raw = raw.trim();
    if raw.is_empty() {
        return None;
    }
    if let Some(rest) = raw.strip_prefix("~/") {
        if let Ok(home) = std::env::var("HOME") {
            return Some(PathBuf::from(home).join(rest));
        }
    }
    Some(PathBuf::from(raw))
}

/// `$HOME/<rel>`, or `None` when `$HOME` is unset.
fn resolve_home_relative(rel: &str) -> Option<PathBuf> {
    std::env::var("HOME")
        .ok()
        .map(|h| PathBuf::from(h).join(rel))
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
