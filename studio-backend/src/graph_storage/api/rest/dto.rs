//! REST DTOs. Serialization lives here and nowhere else.

use crate::graph_storage::sdk::GraphStats;

/// Coarse counters describing the caller's graph.
#[derive(Debug, Clone, Copy)]
#[toolkit_macros::api_dto(response)]
pub struct GraphStatsDto {
    /// Number of nodes visible to the caller.
    pub nodes: u64,
    /// Number of edges visible to the caller.
    pub edges: u64,
    /// Monotonic revision, bumped whenever stored state changes.
    pub graph_revision: u64,
}

impl From<GraphStats> for GraphStatsDto {
    fn from(value: GraphStats) -> Self {
        Self {
            nodes: value.nodes,
            edges: value.edges,
            graph_revision: value.graph_revision,
        }
    }
}

/// Result of a bounded neighbourhood expansion.
#[derive(Debug, Clone)]
#[toolkit_macros::api_dto(response)]
pub struct NeighboursDto {
    /// Node ids reachable from the seeds within the requested depth,
    /// restricted to what the caller is authorised to see.
    pub nodes: Vec<i64>,
    /// Whether the node budget truncated the result.
    pub truncated: bool,
}

/// One node submitted for ingest.
#[derive(Debug, Clone)]
#[toolkit_macros::api_dto(request)]
pub struct NodeInputDto {
    /// Stable key, unique within the tenant.
    pub node_key: String,
    /// GTS identifier of a registered node type.
    pub type_id: String,
    /// Display name.
    pub name: String,
}

/// One edge submitted for ingest, addressed by endpoint node keys.
#[derive(Debug, Clone)]
#[toolkit_macros::api_dto(request)]
pub struct EdgeInputDto {
    /// GTS identifier of a registered edge type.
    pub type_id: String,
    /// Node key of the source endpoint.
    pub from: String,
    /// Node key of the target endpoint.
    pub to: String,
}

/// An ingest batch.
#[derive(Debug, Clone)]
#[toolkit_macros::api_dto(request)]
pub struct IngestReq {
    /// Nodes to upsert.
    #[serde(default)]
    pub nodes: Vec<NodeInputDto>,
    /// Edges to upsert.
    #[serde(default)]
    pub edges: Vec<EdgeInputDto>,
}

/// Outcome of an ingest batch.
#[derive(Debug, Clone, Copy)]
#[toolkit_macros::api_dto(response)]
pub struct IngestResultDto {
    /// Nodes inserted or updated.
    pub nodes_upserted: u64,
    /// Edges inserted or updated.
    pub edges_upserted: u64,
}

/// Registration of a GTS type.
#[derive(Debug, Clone)]
#[toolkit_macros::api_dto(request)]
pub struct RegisterTypeReq {
    /// GTS identifier.
    pub type_id: String,
    /// `node`, `edge` or `attribute`.
    pub kind: String,
}

/// Interned identifier assigned to a registered type.
#[derive(Debug, Clone, Copy)]
#[toolkit_macros::api_dto(response)]
pub struct RegisteredTypeDto {
    /// Interned id referenced by nodes and edges.
    pub id: i32,
}
