//! Link-time gear registration.
//!
//! CF/Gears discovers gears via `inventory` at link time — importing a gear
//! crate is what registers it. This file pins the exact assembly of the
//! Studio backend. Unlike `cf-gears-example-server`, nothing is behind
//! feature flags: the Studio assembly is a deliberate, fixed set.
#![allow(unused_imports)]
#![allow(clippy::single_component_path_imports)]

// System gears
use api_gateway as _;
use authn_resolver as _;
use authz_resolver as _;
use gear_orchestrator as _;
use grpc_hub as _;
use nodes_registry as _;
use resource_group as _;
use tenant_resolver as _;
use types_registry as _;

// Dev auth plugins (static tokens; swap for OIDC plugins in production)
use oidc_authn_plugin as _; // real login (config/oidc.yaml profile)
use static_authn_plugin as _;
use static_authz_plugin as _;

// Account Management + its static IdP echo plugin.
// AM also brings its co-located Tenant Resolver plugin (reads tenant_closure).
use account_management as _;
use static_idp_plugin as _;

// Feature gears: per-user settings, file storage, credstore.
use credstore as _;
use file_storage as _;
use simple_user_settings as _;
use static_credstore_plugin as _;

// Workspace AI chat (mini-chat + oagw LLM egress). Behind the `llm` feature:
// oagw's post_init provisions its upstream under the root tenant, which does
// not exist on a fresh database until account-management's run-phase saga
// seeds it — so with oagw present the first boot deadlocks. Off in the k8s
// release image (no LLM key, no IDE sessions). mini_chat also brings its
// in-crate static model-policy + audit plugins.
#[cfg(feature = "llm")]
use api_egress as _;
#[cfg(feature = "llm")]
use mini_chat as _;
