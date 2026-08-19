//! Route registration: one chain per endpoint describes the route, its
//! `OpenAPI` schema, authentication and every Problem status it can return.

use std::sync::Arc;

use axum::{Extension, Router};
use toolkit::api::OpenApiRegistry;
use toolkit::api::operation_builder::{
    CORE_GLOBAL_BASE_LICENSE_FEATURE, LicenseFeature, OperationBuilder,
};

use crate::graph_storage::api::rest::{dto, handlers};
use crate::graph_storage::domain::service::GraphServices;

const API_TAG: &str = "Graph Storage";
const BASE: &str = "/graph-storage/v1";

pub(crate) struct License;

impl AsRef<str> for License {
    fn as_ref(&self) -> &'static str {
        CORE_GLOBAL_BASE_LICENSE_FEATURE
    }
}

impl LicenseFeature for License {}

/// Register every REST route of the gear.
pub fn register_routes(
    router: Router,
    openapi: &dyn OpenApiRegistry,
    services: Arc<GraphServices>,
) -> Router {
    let router = OperationBuilder::get(format!("{BASE}/stats"))
        .operation_id("graph_storage.get_stats")
        .summary("Graph counters")
        .description("Coarse node and edge counters for the caller's graph")
        .tag(API_TAG)
        .authenticated()
        .require_license_features::<License>([])
        .handler(handlers::get_stats)
        .json_response_with_schema::<dto::GraphStatsDto>(
            openapi,
            http::StatusCode::OK,
            "Graph counters",
        )
        .error_401(openapi)
        .error_403(openapi)
        .error_500(openapi)
        .register(router, openapi);

    let router = OperationBuilder::get(format!("{BASE}/neighbours"))
        .operation_id("graph_storage.get_neighbours")
        .summary("Bounded neighbourhood expansion")
        .description(
            "Breadth-first expansion around seed nodes, bounded by the configured \
             depth and node budget, restricted to the caller-authorised subgraph",
        )
        .tag(API_TAG)
        .authenticated()
        .require_license_features::<License>([])
        .query_param("seeds", true, "Comma-separated seed node ids")
        .query_param_typed("depth", false, "Traversal depth", "integer")
        .handler(handlers::get_neighbours)
        .json_response_with_schema::<dto::NeighboursDto>(
            openapi,
            http::StatusCode::OK,
            "Reachable node ids",
        )
        .error_400(openapi)
        .error_401(openapi)
        .error_403(openapi)
        .error_500(openapi)
        .register(router, openapi);

    let router = OperationBuilder::get(format!("{BASE}/search"))
        .operation_id("graph_storage.search")
        .summary("Lexical search")
        .description(
            "Rank the caller's nodes against a free-text query, most relevant \
             first, restricted to the caller-authorised subgraph",
        )
        .tag(API_TAG)
        .authenticated()
        .require_license_features::<License>([])
        .query_param("q", true, "Free text to match")
        .query_param_typed("limit", false, "Maximum matches", "integer")
        .handler(handlers::search)
        .json_response_with_schema::<dto::SearchResultDto>(
            openapi,
            http::StatusCode::OK,
            "Ranked matches",
        )
        .error_400(openapi)
        .error_401(openapi)
        .error_403(openapi)
        .error_500(openapi)
        .register(router, openapi);

    let router = OperationBuilder::get(format!("{BASE}/subgraph"))
        .operation_id("graph_storage.get_subgraph")
        .summary("Drawable neighbourhood")
        .description(
            "The same expansion as /neighbours, resolved into nodes with names \
             and types plus the edges between them, so a client can render it",
        )
        .tag(API_TAG)
        .authenticated()
        .require_license_features::<License>([])
        .query_param("seeds", true, "Comma-separated seed node ids")
        .query_param_typed("depth", false, "Traversal depth", "integer")
        .handler(handlers::get_subgraph)
        .json_response_with_schema::<dto::SubgraphDto>(
            openapi,
            http::StatusCode::OK,
            "Nodes and the edges between them",
        )
        .error_400(openapi)
        .error_401(openapi)
        .error_403(openapi)
        .error_500(openapi)
        .register(router, openapi);

    let router = OperationBuilder::post(format!("{BASE}/types"))
        .operation_id("graph_storage.register_type")
        .summary("Register a GTS type")
        .description("Intern a node or edge type so ingested rows can reference it")
        .tag(API_TAG)
        .authenticated()
        .require_license_features::<License>([])
        .json_request::<dto::RegisterTypeReq>(openapi, "Type to register")
        .handler(handlers::register_type)
        .json_response_with_schema::<dto::RegisteredTypeDto>(
            openapi,
            http::StatusCode::OK,
            "Interned type id",
        )
        .error_400(openapi)
        .error_401(openapi)
        .error_403(openapi)
        .error_500(openapi)
        .register(router, openapi);

    let router = OperationBuilder::post(format!("{BASE}/ingest"))
        .operation_id("graph_storage.ingest")
        .summary("Upsert nodes and edges")
        .description(
            "Batch upsert keyed on tenant-scoped natural keys, so repeating an \
             identical batch converges instead of duplicating",
        )
        .tag(API_TAG)
        .authenticated()
        .require_license_features::<License>([])
        .json_request::<dto::IngestReq>(openapi, "Nodes and edges to upsert")
        .handler(handlers::ingest)
        .json_response_with_schema::<dto::IngestResultDto>(
            openapi,
            http::StatusCode::OK,
            "Counts of upserted rows",
        )
        .error_400(openapi)
        .error_401(openapi)
        .error_403(openapi)
        .error_500(openapi)
        .register(router, openapi);

    router.layer(Extension(services))
}
