use std::sync::Arc;

use axum::{Extension, Router, extract::Path};
use toolkit::api::canonical_prelude::*;
use toolkit::api::operation_builder::{CORE_GLOBAL_BASE_LICENSE_FEATURE, LicenseFeature};
use toolkit::api::{OpenApiRegistry, OperationBuilder};
use toolkit_canonical_errors::resource_error;
use toolkit_security::SecurityContext;
use uuid::Uuid;

use super::service::{KitDescriptor, KitInstallation, KitRegistryService};

#[resource_error(gts_id!("cf.studio.kits.registry.v1~"))]
pub struct KitRegistryError;

struct License;
impl AsRef<str> for License {
    fn as_ref(&self) -> &'static str {
        CORE_GLOBAL_BASE_LICENSE_FEATURE
    }
}
impl LicenseFeature for License {}

#[derive(Debug)]
#[toolkit_macros::api_dto(response)]
pub struct KitDto {
    pub slug: String,
    pub name: String,
    pub description: String,
    pub publisher: String,
    pub visibility: String,
    pub source: String,
    pub repository_url: String,
    pub default_version: String,
    pub manifest_path: String,
}

#[derive(Debug)]
#[toolkit_macros::api_dto(response)]
pub struct KitListDto {
    pub items: Vec<KitDto>,
}

#[derive(Debug)]
#[toolkit_macros::api_dto(response)]
pub struct KitInstallationDto {
    pub kit_slug: String,
    pub version: String,
    pub source: String,
    pub repository_url: String,
    pub install_mode: String,
    pub status: String,
    pub requested_by: String,
    pub requested_at: String,
    pub installed_at: Option<String>,
    pub repository_id: Option<String>,
    pub failure_reason: Option<String>,
}

#[derive(Debug)]
#[toolkit_macros::api_dto(response)]
pub struct KitInstallationListDto {
    pub items: Vec<KitInstallationDto>,
}

#[derive(Debug)]
#[toolkit_macros::api_dto(request)]
pub struct RequestKitInstallationDto {
    pub kit_slug: String,
    pub version: String,
    pub install_mode: String,
}

#[derive(Debug)]
#[toolkit_macros::api_dto(request)]
pub struct MaterializeKitInstallationDto {
    pub repository_id: Option<String>,
}

impl From<KitDescriptor> for KitDto {
    fn from(value: KitDescriptor) -> Self {
        Self {
            slug: value.slug,
            name: value.name,
            description: value.description,
            publisher: value.publisher,
            visibility: value.visibility,
            source: value.source,
            repository_url: value.repository_url,
            default_version: value.default_version,
            manifest_path: value.manifest_path,
        }
    }
}

impl From<KitInstallation> for KitInstallationDto {
    fn from(value: KitInstallation) -> Self {
        Self {
            kit_slug: value.kit_slug,
            version: value.version,
            source: value.source,
            repository_url: value.repository_url,
            install_mode: value.install_mode,
            status: value.status,
            requested_by: value.requested_by,
            requested_at: value.requested_at,
            installed_at: value.installed_at,
            repository_id: value.repository_id,
            failure_reason: value.failure_reason,
        }
    }
}

fn internal(error: anyhow::Error) -> CanonicalError {
    CanonicalError::internal(format!("kit registry failed: {error:#}")).create()
}

async fn catalogue(
    Extension(_ctx): Extension<SecurityContext>,
    Extension(service): Extension<Arc<KitRegistryService>>,
) -> ApiResult<JsonBody<KitListDto>> {
    Ok(Json(KitListDto {
        items: service.catalogue().into_iter().map(Into::into).collect(),
    }))
}

async fn list_installations(
    Extension(ctx): Extension<SecurityContext>,
    Extension(service): Extension<Arc<KitRegistryService>>,
    Path(project_id): Path<Uuid>,
) -> ApiResult<JsonBody<KitInstallationListDto>> {
    let items = service
        .list_installations(&ctx, project_id)
        .await
        .map_err(internal)?;
    Ok(Json(KitInstallationListDto {
        items: items.into_iter().map(Into::into).collect(),
    }))
}

async fn request_installation(
    Extension(ctx): Extension<SecurityContext>,
    Extension(service): Extension<Arc<KitRegistryService>>,
    Path(project_id): Path<Uuid>,
    Json(body): Json<RequestKitInstallationDto>,
) -> ApiResult<JsonBody<KitInstallationDto>> {
    let value = service
        .request_installation(
            &ctx,
            project_id,
            &body.kit_slug,
            &body.version,
            &body.install_mode,
        )
        .await
        .map_err(|error| {
            KitRegistryError::invalid_argument()
                .with_constraint(error.to_string())
                .create()
        })?;
    Ok(Json(value.into()))
}

async fn remove_installation(
    Extension(ctx): Extension<SecurityContext>,
    Extension(service): Extension<Arc<KitRegistryService>>,
    Path((project_id, kit_slug)): Path<(Uuid, String)>,
) -> ApiResult<StatusCode> {
    service
        .remove_installation(&ctx, project_id, &kit_slug)
        .await
        .map_err(internal)?;
    Ok(StatusCode::NO_CONTENT)
}

async fn materialize_installation(
    Extension(ctx): Extension<SecurityContext>,
    Extension(service): Extension<Arc<KitRegistryService>>,
    Path((project_id, kit_slug)): Path<(Uuid, String)>,
    Json(body): Json<MaterializeKitInstallationDto>,
) -> ApiResult<JsonBody<KitInstallationDto>> {
    let value = service
        .materialize_installation(&ctx, project_id, &kit_slug, body.repository_id)
        .await
        .map_err(internal)?;
    Ok(Json(value.into()))
}

pub fn register_routes(
    mut router: Router,
    openapi: &dyn OpenApiRegistry,
    service: Arc<KitRegistryService>,
) -> Router {
    router = OperationBuilder::get("/studio-kits/v1/catalog")
        .operation_id("studio_kits.list_catalog")
        .summary("List kits available to Constructor Studio")
        .tag("StudioKits")
        .authenticated()
        .require_license_features::<License>([])
        .handler(catalogue)
        .json_response_with_schema::<KitListDto>(openapi, StatusCode::OK, "Kit catalogue")
        .error_401(openapi)
        .error_500(openapi)
        .register(router, openapi);

    router = OperationBuilder::get("/studio-kits/v1/projects/{project_id}/installations")
        .operation_id("studio_kits.list_project_installations")
        .summary("List desired kit installations for a project")
        .tag("StudioKits")
        .authenticated()
        .require_license_features::<License>([])
        .path_param("project_id", "Project tenant id")
        .handler(list_installations)
        .json_response_with_schema::<KitInstallationListDto>(
            openapi,
            StatusCode::OK,
            "Project kit installations",
        )
        .error_401(openapi)
        .error_403(openapi)
        .error_500(openapi)
        .register(router, openapi);

    router = OperationBuilder::post("/studio-kits/v1/projects/{project_id}/installations")
        .operation_id("studio_kits.request_installation")
        .summary("Request a registered kit for a project")
        .description("Records desired state as pending. A trusted cfs runner materializes it in a later phase.")
        .tag("StudioKits").authenticated().require_license_features::<License>([])
        .path_param("project_id", "Project tenant id")
        .json_request::<RequestKitInstallationDto>(openapi, "Kit installation request")
        .handler(request_installation)
        .json_response_with_schema::<KitInstallationDto>(openapi, StatusCode::OK, "Requested installation")
        .error_400(openapi).error_401(openapi).error_403(openapi).error_500(openapi).register(router, openapi);

    router = OperationBuilder::post(
        "/studio-kits/v1/projects/{project_id}/installations/{kit_slug}/materialize",
    )
    .operation_id("studio_kits.materialize_installation")
    .summary("Install a requested kit in the project's running IDE")
    .description("Calls the S2S-token-gated Theia runner. The kit and Git ref are independently validated by the IDE.")
    .tag("StudioKits")
    .authenticated()
    .require_license_features::<License>([])
    .path_param("project_id", "Project tenant id")
    .path_param("kit_slug", "Registered kit slug")
    .json_request::<MaterializeKitInstallationDto>(openapi, "Optional target repository")
    .handler(materialize_installation)
    .json_response_with_schema::<KitInstallationDto>(openapi, StatusCode::OK, "Materialized installation")
    .error_401(openapi)
    .error_403(openapi)
    .error_500(openapi)
    .register(router, openapi);

    OperationBuilder::delete("/studio-kits/v1/projects/{project_id}/installations/{kit_slug}")
        .operation_id("studio_kits.remove_installation")
        .summary("Remove a project's desired kit installation")
        .tag("StudioKits")
        .authenticated()
        .require_license_features::<License>([])
        .path_param("project_id", "Project tenant id")
        .path_param("kit_slug", "Kit slug")
        .handler(remove_installation)
        .no_content_response(StatusCode::NO_CONTENT, "Installation removed")
        .error_400(openapi)
        .error_401(openapi)
        .error_403(openapi)
        .error_500(openapi)
        .register(router, openapi)
        .layer(Extension(service))
}
