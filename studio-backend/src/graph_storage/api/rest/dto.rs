//! REST DTOs. Serialization lives here and nowhere else.

use crate::graph_storage::infra::storage::read_model::{EdgeView, NodeView};
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
    /// Text fed to lexical search. Omitted means "index the display name".
    #[serde(default)]
    pub search_text: Option<String>,
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

/// One node, resolved enough to list or to draw.
#[derive(Debug, Clone)]
#[toolkit_macros::api_dto(response)]
pub struct GraphNodeDto {
    /// Surrogate identifier, unique within the tenant.
    pub id: i64,
    /// Producer-supplied stable key.
    pub node_key: String,
    /// Display name.
    pub name: String,
    /// GTS identifier of the node's type.
    pub type_id: String,
}

impl From<NodeView> for GraphNodeDto {
    fn from(v: NodeView) -> Self {
        Self {
            id: v.id,
            node_key: v.node_key,
            name: v.name,
            type_id: v.type_id,
        }
    }
}

/// One edge between two nodes the caller may see.
#[derive(Debug, Clone)]
#[toolkit_macros::api_dto(response)]
pub struct GraphEdgeDto {
    /// Source node identifier.
    pub src: i64,
    /// Destination node identifier.
    pub dst: i64,
    /// GTS identifier of the edge's type.
    pub type_id: String,
}

impl From<EdgeView> for GraphEdgeDto {
    fn from(v: EdgeView) -> Self {
        Self {
            src: v.src,
            dst: v.dst,
            type_id: v.type_id,
        }
    }
}

/// Ranked matches of a lexical search.
#[derive(Debug, Clone)]
#[toolkit_macros::api_dto(response)]
pub struct SearchResultDto {
    /// Matching nodes, most relevant first.
    pub nodes: Vec<GraphNodeDto>,
}

/// A drawable neighbourhood: nodes plus the edges between them.
#[derive(Debug, Clone)]
#[toolkit_macros::api_dto(response)]
pub struct SubgraphDto {
    /// Nodes reachable from the seeds within the requested depth.
    pub nodes: Vec<GraphNodeDto>,
    /// Edges whose both endpoints are in `nodes`.
    pub edges: Vec<GraphEdgeDto>,
    /// Whether the node budget truncated the result.
    pub truncated: bool,
}
