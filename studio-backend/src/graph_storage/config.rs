//! Gear configuration.
//!
//! Values mirror the Capacity and Admission Contract in `docs/DESIGN.md`:
//! every bound is a named key with a safe default. Hard-range validation is
//! added together with the admission layer.

use serde::{Deserialize, Serialize};

/// How one traversal hop is executed.
#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum HopStrategy {
    /// Two scoped queries: edges, then authorised endpoints.
    #[default]
    TwoQuery,
    /// One statement with a scoped CTE over the edge table.
    Cte,
    /// One statement with a `GRAPH_TABLE` pattern per direction, unioned.
    ///
    /// Requires `PostgreSQL` 19 with the property graph the migrations create.
    /// A pattern must be bounded to a set of tenants, so a request whose scope
    /// cannot be enumerated into one is served by [`HopStrategy::TwoQuery`]
    /// instead; see `GraphServices::effective_hop`.
    Pgq,
}

/// Configuration of the graph-storage gear.
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(default)]
pub struct GraphStorageConfig {
    /// Maximum number of nodes accepted in one ingest batch.
    pub ingest_max_nodes: u32,
    /// Maximum number of edges accepted in one ingest batch.
    pub ingest_max_edges: u32,
    /// Maximum traversal depth accepted by the graph API.
    pub traversal_max_depth: u8,
    /// Default node budget of a traversal response.
    pub traversal_max_nodes: u32,
    /// Hop execution strategy: `two_query` (works on stock toolkit-db), `cte`
    /// (one statement, requires safe CTE support), or `pgq` (one statement per
    /// direction through `GRAPH_TABLE`, requires `PostgreSQL` 19). Present so
    /// they can be measured against each other on the same data.
    pub traversal_hop: HopStrategy,
}

impl Default for GraphStorageConfig {
    fn default() -> Self {
        Self {
            ingest_max_nodes: 10_000,
            ingest_max_edges: 20_000,
            traversal_max_depth: 5,
            traversal_max_nodes: 1_000,
            traversal_hop: HopStrategy::TwoQuery,
        }
    }
}
