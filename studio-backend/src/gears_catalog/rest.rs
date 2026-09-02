//! REST surface for the gears catalog.
//!
//! `POST /studio-gears-catalog/v1/sync` enqueues a background sync of the
//! crates.io keyword into the graph and returns a task id; `GET /tasks/{id}`
//! polls it. `GET /gears` and `GET /versions` read the catalog back.

use std::sync::Arc;

use axum::extract::{Path, Query};
use axum::{Extension, Router};
use serde_json::Value;
use toolkit::api::canonical_prelude::*;
use toolkit::api::operation_builder::{CORE_GLOBAL_BASE_LICENSE_FEATURE, LicenseFeature};
use toolkit::api::{OpenApiRegistry, OperationBuilder};
use toolkit_canonical_errors::resource_error;
use toolkit_security::SecurityContext;

use super::service::CatalogService;

/// Errors attributable to a gears-catalog resource (e.g. an unknown task).
#[resource_error(gts_id!("cf.studio._.gears_catalog.v1~"))]
pub struct StudioGearsCatalogError;

/// Service handle, injected into the handlers.
#[derive(Clone)]
pub struct Catalog(pub Arc<CatalogService>);

struct License;
impl AsRef<str> for License {
    fn as_ref(&self) -> &'static str {
        CORE_GLOBAL_BASE_LICENSE_FEATURE
    }
}
impl LicenseFeature for License {}

/// Acknowledgement that a sync was accepted and is running in the background.
#[derive(Debug)]
#[toolkit_macros::api_dto(response)]
pub struct CatalogSyncEnqueued {
    /// Poll `GET /studio-gears-catalog/v1/tasks/{task_id}` for the outcome.
    pub task_id: String,
    pub status: String,
}

/// The state of a background catalog sync task.
#[derive(Debug)]
#[toolkit_macros::api_dto(response)]
pub struct CatalogTaskStatusResponse {
    pub task_id: String,
    /// `queued` | `running` | `succeeded` | `failed`.
    pub status: String,
    /// Current phase while running, or the error message on failure.
    pub message: Option<String>,
    /// Live counts, updated per gear while running.
    pub gears: u32,
    pub versions: u32,
    /// Nodes already flushed to the graph store.
    pub stored: u32,
}

/// One catalog node (gear or crate_version).
#[derive(Debug)]
#[toolkit_macros::api_dto(response)]
pub struct CatalogNodeDto {
    /// GTS type id, e.g. `gts.cf.studio.catalog.gear.v1~`.
    pub type_id: String,
    /// Deterministic instance id.
    pub instance_id: String,
    /// The curated crate/version payload.
    #[schema(value_type = Object)]
    pub value: Value,
}

#[derive(Debug)]
#[toolkit_macros::api_dto(response)]
pub struct CatalogNodeListResponse {
    pub nodes: Vec<CatalogNodeDto>,
}

/// Open, Studio-owned metadata for a gear. The payload is intentionally
/// extensible: it holds delivery metrics and links that crates.io cannot know.
#[derive(Debug, serde::Deserialize)]
#[toolkit_macros::api_dto(request)]
pub struct SaveGearProfileRequest {
    #[schema(value_type = Object)]
    pub profile: Value,
}

#[derive(Debug, serde::Deserialize)]
pub struct VersionsQuery {
    /// Optional crate name (query param `crate`) to filter versions to one gear.
    #[serde(rename = "crate", default)]
    pub crate_name: Option<String>,
}

async fn sync(
    Extension(ctx): Extension<SecurityContext>,
    Extension(catalog): Extension<Catalog>,
) -> ApiResult<JsonBody<CatalogSyncEnqueued>> {
    let task_id = catalog.0.enqueue_sync(ctx);
    Ok(Json(CatalogSyncEnqueued {
        task_id,
        status: "queued".to_string(),
    }))
}

async fn task_status(
    Extension(_ctx): Extension<SecurityContext>,
    Extension(catalog): Extension<Catalog>,
    Path(id): Path<String>,
) -> ApiResult<JsonBody<CatalogTaskStatusResponse>> {
    let rec = catalog.0.task(&id).ok_or_else(|| {
        StudioGearsCatalogError::not_found("no such sync task")
            .with_resource(id.clone())
            .create()
    })?;
    Ok(Json(CatalogTaskStatusResponse {
        task_id: rec.id,
        status: rec.status.as_str().to_string(),
        message: rec.message,
        gears: rec.gears,
        versions: rec.versions,
        stored: rec.stored,
    }))
}

fn to_dtos(nodes: Vec<super::gts::GtsNode>) -> Vec<CatalogNodeDto> {
    nodes
        .into_iter()
        .map(|n| CatalogNodeDto {
            type_id: n.type_id.to_string(),
            instance_id: n.instance_id,
            value: n.value,
        })
        .collect()
}

async fn list_gears(
    Extension(ctx): Extension<SecurityContext>,
    Extension(catalog): Extension<Catalog>,
) -> ApiResult<JsonBody<CatalogNodeListResponse>> {
    let nodes = catalog
        .0
        .list_nodes(&ctx, Some(super::gts::GEAR_TYPE))
        .await
        .map_err(|e| CanonicalError::internal(format!("{e:#}")).create())?;
    Ok(Json(CatalogNodeListResponse {
        nodes: to_dtos(nodes),
    }))
}

async fn list_profiles(
    Extension(ctx): Extension<SecurityContext>,
    Extension(catalog): Extension<Catalog>,
) -> ApiResult<JsonBody<CatalogNodeListResponse>> {
    let nodes = catalog
        .0
        .list_profiles(&ctx)
        .await
        .map_err(|e| CanonicalError::internal(format!("{e:#}")).create())?;
    Ok(Json(CatalogNodeListResponse { nodes: to_dtos(nodes) }))
}

async fn save_profile(
    Extension(ctx): Extension<SecurityContext>,
    Extension(catalog): Extension<Catalog>,
    Path(name): Path<String>,
    Json(body): Json<SaveGearProfileRequest>,
) -> ApiResult<JsonBody<CatalogNodeDto>> {
    let node = catalog
        .0
        .save_profile(&ctx, &name, body.profile)
        .await
        .map_err(|e| {
            StudioGearsCatalogError::invalid_argument()
                .with_constraint(format!("invalid gear profile: {e:#}"))
                .create()
        })?;
    let dto = to_dtos(vec![node])
        .into_iter()
        .next()
        .expect("one profile node converts to one DTO");
    Ok(Json(dto))
}

async fn list_versions(
    Extension(ctx): Extension<SecurityContext>,
    Extension(catalog): Extension<Catalog>,
    Query(q): Query<VersionsQuery>,
) -> ApiResult<JsonBody<CatalogNodeListResponse>> {
    let mut nodes = catalog
        .0
        .list_nodes(&ctx, Some("crate_version"))
        .await
        .map_err(|e| CanonicalError::internal(format!("{e:#}")).create())?;
    if let Some(name) = q
        .crate_name
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
    {
        nodes.retain(|n| n.value.get("crate").and_then(Value::as_str) == Some(name));
    }
    Ok(Json(CatalogNodeListResponse {
        nodes: to_dtos(nodes),
    }))
}

pub fn register_routes(
    router: Router,
    openapi: &dyn OpenApiRegistry,
    service: Arc<CatalogService>,
) -> Router {
    let router = OperationBuilder::post("/studio-gears-catalog/v1/sync")
        .operation_id("studio_gears_catalog.sync")
        .summary("Enqueue a background sync of the crates.io keyword into the graph")
        .description(
            "Lists every crate under the configured keyword (constructorfabric), \
             fetches each crate's detail and version history from crates.io, and \
             upserts gear + crate_version nodes (joined by has_version) into the \
             graph. Returns a task id to poll.",
        )
        .tag("StudioGearsCatalog")
        .authenticated()
        .require_license_features::<License>([])
        .handler(sync)
        .json_response_with_schema::<CatalogSyncEnqueued>(openapi, StatusCode::OK, "Sync enqueued")
        .error_401(openapi)
        .error_500(openapi)
        .register(router, openapi);

    let router = OperationBuilder::get("/studio-gears-catalog/v1/tasks/{id}")
        .operation_id("studio_gears_catalog.task_status")
        .summary("Poll a background catalog sync task")
        .tag("StudioGearsCatalog")
        .authenticated()
        .require_license_features::<License>([])
        .path_param("id", "Sync task id")
        .handler(task_status)
        .json_response_with_schema::<CatalogTaskStatusResponse>(
            openapi,
            StatusCode::OK,
            "Task status",
        )
        .error_401(openapi)
        .error_404(openapi)
        .error_500(openapi)
        .register(router, openapi);

    let router = OperationBuilder::get("/studio-gears-catalog/v1/gears")
        .operation_id("studio_gears_catalog.list_gears")
        .summary("List the ingested gear crates")
        .tag("StudioGearsCatalog")
        .authenticated()
        .require_license_features::<License>([])
        .handler(list_gears)
        .json_response_with_schema::<CatalogNodeListResponse>(openapi, StatusCode::OK, "Gears")
        .error_401(openapi)
        .error_500(openapi)
        .register(router, openapi);

    let router = OperationBuilder::get("/studio-gears-catalog/v1/versions")
        .operation_id("studio_gears_catalog.list_versions")
        .summary("List ingested crate versions, optionally filtered to one crate")
        .tag("StudioGearsCatalog")
        .authenticated()
        .require_license_features::<License>([])
        .handler(list_versions)
        .json_response_with_schema::<CatalogNodeListResponse>(openapi, StatusCode::OK, "Versions")
        .error_401(openapi)
        .error_500(openapi)
        .register(router, openapi);

    let router = OperationBuilder::get("/studio-gears-catalog/v1/profiles")
        .operation_id("studio_gears_catalog.list_profiles")
        .summary("List Studio-managed, editable Gear profiles")
        .tag("StudioGearsCatalog")
        .authenticated()
        .require_license_features::<License>([])
        .handler(list_profiles)
        .json_response_with_schema::<CatalogNodeListResponse>(openapi, StatusCode::OK, "Gear profiles")
        .error_401(openapi)
        .error_500(openapi)
        .register(router, openapi);

    let router = OperationBuilder::post("/studio-gears-catalog/v1/gears/{name}/profile")
        .operation_id("studio_gears_catalog.save_profile")
        .summary("Create or replace Studio-managed metadata for one Gear")
        .tag("StudioGearsCatalog")
        .authenticated()
        .require_license_features::<License>([])
        .path_param("name", "Crate name")
        .handler(save_profile)
        .json_request::<SaveGearProfileRequest>(openapi, "Gear profile")
        .json_response_with_schema::<CatalogNodeDto>(openapi, StatusCode::OK, "Saved Gear profile")
        .error_400(openapi)
        .error_401(openapi)
        .error_500(openapi)
        .register(router, openapi);

    router.layer(Extension(Catalog(service)))
}
