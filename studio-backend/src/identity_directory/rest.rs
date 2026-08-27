use std::sync::Arc;

use axum::{Extension, Router};
use toolkit::api::canonical_prelude::*;
use toolkit::api::operation_builder::{CORE_GLOBAL_BASE_LICENSE_FEATURE, LicenseFeature};
use toolkit::api::{OpenApiRegistry, OperationBuilder};
use toolkit_canonical_errors::resource_error;
use toolkit_security::SecurityContext;
use uuid::Uuid;

use super::service::{DirectoryIdentity, IdentityDirectoryService, PLATFORM_ROOT_TENANT_ID};

#[resource_error(gts_id!("cf.studio.identity.directory.v1~"))]
pub struct IdentityDirectoryError;

struct License;
impl AsRef<str> for License {
    fn as_ref(&self) -> &'static str {
        CORE_GLOBAL_BASE_LICENSE_FEATURE
    }
}
impl LicenseFeature for License {}

#[derive(Debug)]
#[toolkit_macros::api_dto(response)]
pub struct PlatformIdentityDto {
    pub id: String,
    pub username: String,
    pub email: Option<String>,
    pub display_name: Option<String>,
    pub identity_provider: Option<String>,
    pub first_seen_at_epoch_ms: Option<i64>,
    pub status: String,
    #[schema(value_type = Option<String>)]
    pub home_tenant_id: Option<Uuid>,
    pub home_tenant_name: Option<String>,
}

#[derive(Debug)]
#[toolkit_macros::api_dto(response)]
pub struct PlatformIdentityListDto {
    pub items: Vec<PlatformIdentityDto>,
}

fn to_dto(identity: DirectoryIdentity) -> PlatformIdentityDto {
    PlatformIdentityDto {
        id: identity.id,
        username: identity.username,
        email: identity.email,
        display_name: identity.display_name,
        identity_provider: identity.identity_provider,
        first_seen_at_epoch_ms: identity.first_seen_at_epoch_ms,
        status: identity.status.to_owned(),
        home_tenant_id: identity.home_tenant_id,
        home_tenant_name: identity.home_tenant_name,
    }
}

async fn list_identities(
    Extension(ctx): Extension<SecurityContext>,
    Extension(service): Extension<Option<Arc<IdentityDirectoryService>>>,
) -> ApiResult<JsonBody<PlatformIdentityListDto>> {
    if ctx.subject_tenant_id() != PLATFORM_ROOT_TENANT_ID {
        return Err(IdentityDirectoryError::permission_denied()
            .with_reason("PLATFORM_ADMIN_REQUIRED")
            .create());
    }
    let service = service.ok_or_else(|| {
        CanonicalError::service_unavailable()
            .with_detail(
                "identity directory is not configured; set the Keycloak admin base URL and secret",
            )
            .create()
    })?;
    let items = service
        .list(&ctx)
        .await
        .map_err(|error| {
            CanonicalError::internal(format!("identity directory failed: {error:#}")).create()
        })?
        .into_iter()
        .map(to_dto)
        .collect();
    Ok(Json(PlatformIdentityListDto { items }))
}

pub fn register_routes(
    router: Router,
    openapi: &dyn OpenApiRegistry,
    service: Option<Arc<IdentityDirectoryService>>,
) -> Router {
    OperationBuilder::get("/studio-identity/v1/users")
        .operation_id("studio_identity.list_users")
        .summary("List identities known to Studio's Keycloak realm")
        .description(
            "Platform-admin-only identity directory. Includes authenticated but unassigned users; \
             organization owners must use their tenant-scoped People endpoint instead.",
        )
        .tag("StudioIdentity")
        .authenticated()
        .require_license_features::<License>([])
        .handler(list_identities)
        .json_response_with_schema::<PlatformIdentityListDto>(
            openapi,
            StatusCode::OK,
            "Identity directory",
        )
        .error_401(openapi)
        .error_403(openapi)
        .error_500(openapi)
        .register(router, openapi)
        .layer(Extension(service))
}
