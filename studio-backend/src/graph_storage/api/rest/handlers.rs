//! REST handlers. Thin: they delegate to domain services and map results.

use std::sync::Arc;

use axum::extract::Query;
use axum::{Extension, Json};
use serde::Deserialize;
use toolkit_canonical_errors::CanonicalError;
use toolkit_security::SecurityContext;

use crate::graph_storage::api::rest::dto::{
    GraphStatsDto, IngestReq, IngestResultDto, NeighboursDto, RegisterTypeReq, RegisteredTypeDto,
};
use crate::graph_storage::domain::service::GraphServices;
use crate::graph_storage::sdk::{EdgeInput, NodeInput};

/// Handler result alias.
pub type ApiResult<T> = Result<T, CanonicalError>;

/// Return coarse counters for the caller's graph.
#[tracing::instrument(skip(services, ctx), fields(user.id = %ctx.subject_id()))]
pub async fn get_stats(
    Extension(ctx): Extension<SecurityContext>,
    Extension(services): Extension<Arc<GraphServices>>,
) -> ApiResult<Json<GraphStatsDto>> {
    let stats = services.stats(&ctx).await?;
    Ok(Json(GraphStatsDto::from(stats)))
}

/// Query parameters of the neighbourhood endpoint.
#[derive(Debug, Deserialize)]
pub struct NeighboursParams {
    /// Comma-separated seed node ids.
    pub seeds: String,
    /// Requested depth; clamped to the configured maximum.
    #[serde(default = "default_depth")]
    pub depth: u8,
}

const fn default_depth() -> u8 {
    2
}

/// Expand a bounded neighbourhood around the given seeds.
#[tracing::instrument(skip(services, ctx), fields(user.id = %ctx.subject_id()))]
pub async fn get_neighbours(
    Extension(ctx): Extension<SecurityContext>,
    Extension(services): Extension<Arc<GraphServices>>,
    Query(params): Query<NeighboursParams>,
) -> ApiResult<Json<NeighboursDto>> {
    let seeds: Vec<i64> = params
        .seeds
        .split(',')
        .filter_map(|s| s.trim().parse::<i64>().ok())
        .collect();

    let budget = services.config().traversal_max_nodes as usize;
    let nodes = services.neighbours(&ctx, &seeds, params.depth).await?;
    let truncated = nodes.len() >= budget;

    Ok(Json(NeighboursDto { nodes, truncated }))
}

/// Register a GTS type for the caller's tenant.
#[tracing::instrument(skip(services, ctx, body), fields(user.id = %ctx.subject_id()))]
pub async fn register_type(
    Extension(ctx): Extension<SecurityContext>,
    Extension(services): Extension<Arc<GraphServices>>,
    Json(body): Json<RegisterTypeReq>,
) -> ApiResult<Json<RegisteredTypeDto>> {
    let id = services
        .register_type(&ctx, &body.type_id, &body.kind)
        .await?;
    Ok(Json(RegisteredTypeDto { id }))
}

/// Upsert a batch of nodes and edges.
#[tracing::instrument(
    skip(services, ctx, body),
    fields(user.id = %ctx.subject_id(), nodes = body.nodes.len(), edges = body.edges.len())
)]
pub async fn ingest(
    Extension(ctx): Extension<SecurityContext>,
    Extension(services): Extension<Arc<GraphServices>>,
    Json(body): Json<IngestReq>,
) -> ApiResult<Json<IngestResultDto>> {
    let nodes: Vec<NodeInput> = body
        .nodes
        .into_iter()
        .map(|n| NodeInput {
            node_key: n.node_key,
            type_id: n.type_id,
            name: n.name,
        })
        .collect();
    let edges: Vec<EdgeInput> = body
        .edges
        .into_iter()
        .map(|e| EdgeInput {
            type_id: e.type_id,
            from: e.from,
            to: e.to,
        })
        .collect();

    let result = services.ingest(&ctx, &nodes, &edges).await?;
    Ok(Json(IngestResultDto {
        nodes_upserted: result.nodes_upserted,
        edges_upserted: result.edges_upserted,
    }))
}
