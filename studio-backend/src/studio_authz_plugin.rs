//! Studio AuthZ plugin — the Studio PDP (ADR-0006).
//!
//! Step 1 (this file): a faithful clone of `static-authz-plugin` under a Studio
//! identity, registered at a HIGHER precedence (priority 40 < static's 100), so
//! the `authz-resolver` gear selects it. Behaviour is deliberately identical to
//! static today — a tenant clamp — so wiring it in changes nothing at runtime
//! and proves the assembly still boots.
//!
//! Next steps (see docs/studio-authz-plugin.md): read the org access config from
//! AM tenant metadata (`cf.studio.access.v1`) and, when the model is "roles",
//! decide from grants → roles → privileges instead of the flat tenant clamp.

use std::sync::{Arc, OnceLock};

use async_trait::async_trait;
use authz_resolver_sdk::{
    AuthZResolverError, AuthZResolverPluginClient, AuthZResolverPluginSpecV1, Capability,
    Constraint, EvaluationRequest, EvaluationResponse, EvaluationResponseContext, InPredicate,
    InTenantSubtreePredicate, Predicate,
};
use serde::Deserialize;
use toolkit::Gear;
use toolkit::client_hub::ClientScope;
use toolkit::context::GearCtx;
use toolkit::gts::PluginV1;
use toolkit_macros::domain_model;
use toolkit_security::pep_properties;
use tracing::info;
use types_registry_sdk::{RegisterResult, TypesRegistryClient};
use uuid::Uuid;

/// GTS instance id for this plugin (two-segment chain under the plugin base).
const INSTANCE_ID: &str = "cf.studio.authz_resolver.plugin.v1";

/* ── Config ── */

#[derive(Debug, Clone, Deserialize)]
#[serde(default, deny_unknown_fields)]
pub struct StudioAuthZPluginConfig {
    /// Vendor for GTS registration — same pool as static-authz.
    pub vendor: String,
    /// Plugin priority (lower = higher precedence). Below tr(50)/static(100).
    pub priority: i16,
}

impl Default for StudioAuthZPluginConfig {
    fn default() -> Self {
        Self {
            vendor: "constructorfabric".to_owned(),
            priority: 40,
        }
    }
}

/* ── Gear ── */

#[toolkit::gear(
    name = "studio-authz-plugin",
    deps = [types_registry]
)]
pub struct StudioAuthZPlugin {
    service: OnceLock<Arc<Service>>,
}

impl Default for StudioAuthZPlugin {
    fn default() -> Self {
        Self {
            service: OnceLock::new(),
        }
    }
}

#[async_trait]
impl Gear for StudioAuthZPlugin {
    async fn init(&self, ctx: &GearCtx) -> anyhow::Result<()> {
        let cfg: StudioAuthZPluginConfig = ctx.config_or_default()?;
        info!(
            vendor = %cfg.vendor,
            priority = cfg.priority,
            "Loaded Studio AuthZ plugin configuration"
        );

        let (instance_id, instance_json) =
            PluginV1::<AuthZResolverPluginSpecV1>::build_registration(
                INSTANCE_ID,
                cfg.vendor.clone(),
                cfg.priority,
            )?;

        let registry = ctx.client_hub().get::<dyn TypesRegistryClient>()?;
        let results = registry.register(vec![instance_json]).await?;
        RegisterResult::ensure_all_ok(&results)?;

        let service = Arc::new(Service::new());
        self.service
            .set(service.clone())
            .map_err(|_| anyhow::anyhow!("{} gear already initialized", Self::MODULE_NAME))?;

        let api: Arc<dyn AuthZResolverPluginClient> = service;
        ctx.client_hub()
            .register_scoped::<dyn AuthZResolverPluginClient>(
                ClientScope::gts_id(&instance_id),
                api,
            );

        info!(instance_id = %instance_id, "Studio AuthZ plugin registered");
        Ok(())
    }
}

/* ── Client (trait) ── */

#[async_trait]
impl AuthZResolverPluginClient for Service {
    async fn evaluate(
        &self,
        request: EvaluationRequest,
    ) -> Result<EvaluationResponse, AuthZResolverError> {
        Ok(self.evaluate(&request))
    }
}

/* ── Service ── */

/// Studio AuthZ service. Step 1: same tenant clamp as static-authz.
#[domain_model]
#[derive(Default)]
pub struct Service;

impl Service {
    #[must_use]
    pub fn new() -> Self {
        Self
    }

    /// Evaluate an authorization request (tenant clamp — behaviour == static).
    #[must_use]
    #[allow(clippy::unused_self)] // &self reserved for the role-based path
    pub fn evaluate(&self, request: &EvaluationRequest) -> EvaluationResponse {
        let tenant_id = request
            .context
            .tenant_context
            .as_ref()
            .and_then(|t| t.root_id)
            .or_else(|| {
                request
                    .subject
                    .properties
                    .get("tenant_id")
                    .and_then(|v| v.as_str())
                    .and_then(|s| Uuid::parse_str(s).ok())
            });

        let Some(tid) = tenant_id else {
            return EvaluationResponse {
                decision: false,
                context: EvaluationResponseContext::default(),
            };
        };

        if tid == Uuid::default() {
            return EvaluationResponse {
                decision: false,
                context: EvaluationResponseContext::default(),
            };
        }

        let mut constraints = vec![Constraint {
            predicates: vec![Predicate::In(InPredicate::new(
                pep_properties::OWNER_TENANT_ID,
                [tid],
            ))],
        }];

        if advertises_tenant_hierarchy(request) {
            for prop in [pep_properties::OWNER_TENANT_ID, pep_properties::RESOURCE_ID] {
                if supports_property(request, prop) {
                    constraints.push(Constraint {
                        predicates: vec![Predicate::InTenantSubtree(
                            InTenantSubtreePredicate::new(prop, tid),
                        )],
                    });
                }
            }
        }

        EvaluationResponse {
            decision: true,
            context: EvaluationResponseContext {
                constraints,
                ..Default::default()
            },
        }
    }
}

fn advertises_tenant_hierarchy(request: &EvaluationRequest) -> bool {
    request
        .context
        .capabilities
        .iter()
        .any(|c| matches!(c, Capability::TenantHierarchy))
}

fn supports_property(request: &EvaluationRequest, property: &str) -> bool {
    request
        .context
        .supported_properties
        .iter()
        .any(|p| p == property)
}
