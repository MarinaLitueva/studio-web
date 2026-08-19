//! REST surface for artifact ingest.
//!
//! `POST /studio-artifact-ingest/v1/sync` pulls issues and pull requests from a
//! connector source and upserts them into the graph as typed GTS nodes.

use std::sync::Arc;

use axum::{Extension, Router};
use toolkit::api::canonical_prelude::*;
use toolkit::api::operation_builder::{CORE_GLOBAL_BASE_LICENSE_FEATURE, LicenseFeature};
use toolkit::api::{OpenApiRegistry, OperationBuilder};
use toolkit_security::SecurityContext;

use super::service::IngestService;

/// Service handle. `None` = the gear booted without any connector driver
/// linked; the route stays mounted and answers 503 with the reason.
#[derive(Clone)]
pub struct Ingest(pub Option<Arc<IngestService>>);

impl Ingest {
    fn get(&self) -> ApiResult<&Arc<IngestService>> {
        self.0.as_ref().ok_or_else(|| {
            CanonicalError::service_unavailable()
                .with_detail(
                    "artifact ingest is not available in this deployment \
                     (no connector driver plugin is registered)",
                )
                .create()
        })
    }
}

struct License;
impl AsRef<str> for License {
    fn as_ref(&self) -> &'static str {
        CORE_GLOBAL_BASE_LICENSE_FEATURE
    }
}
impl LicenseFeature for License {}

#[derive(Debug)]
#[toolkit_macros::api_dto(request)]
pub struct SyncRequest {
    /// Driver key: `github` (gitlab/bitbucket land as drivers implement them).
    pub provider: String,
    /// Installation root; omitted = the provider's default.
    #[serde(default)]
    pub base_url: Option<String>,
    /// credstore reference holding the connector token.
    pub secret_ref: String,
    /// Namespaced repository path, e.g. `org/repo`.
    pub repo_full_path: String,
    /// RFC 3339 lower bound for incremental sync (optional).
    #[serde(default)]
    pub since: Option<String>,
}

#[derive(Debug)]
#[toolkit_macros::api_dto(response)]
pub struct SyncResponse {
    pub issues: u32,
    pub pull_requests: u32,
}

async fn sync(
    Extension(ctx): Extension<SecurityContext>,
    Extension(ingest): Extension<Ingest>,
    Json(req): Json<SyncRequest>,
) -> ApiResult<JsonBody<SyncResponse>> {
    let svc = ingest.get()?;
    let summary = svc
        .sync(
            &ctx,
            req.provider.trim(),
            req.base_url.as_deref(),
            req.secret_ref.trim(),
            req.repo_full_path.trim(),
            req.since.as_deref(),
        )
        .await
        .map_err(|e| CanonicalError::internal(format!("{e:#}")).create())?;
    Ok(Json(SyncResponse {
        issues: summary.issues as u32,
        pull_requests: summary.pull_requests as u32,
    }))
}

pub fn register_routes(
    router: Router,
    openapi: &dyn OpenApiRegistry,
    service: Option<Arc<IngestService>>,
) -> Router {
    let router = OperationBuilder::post("/studio-artifact-ingest/v1/sync")
        .operation_id("studio_artifact_ingest.sync")
        .summary("Ingest issues and pull requests from a connector source into the graph")
        .description(
            "Resolves the connector driver and token, pulls issues and pull \
             requests, normalizes them to typed GTS nodes and upserts them into \
             the graph store.",
        )
        .tag("StudioArtifactIngest")
        .authenticated()
        .require_license_features::<License>([])
        .json_request::<SyncRequest>(openapi, "Source to ingest")
        .handler(sync)
        .json_response_with_schema::<SyncResponse>(openapi, StatusCode::OK, "Ingest summary")
        .error_400(openapi)
        .error_401(openapi)
        .error_500(openapi)
        .register(router, openapi);

    router.layer(Extension(Ingest(service)))
}
