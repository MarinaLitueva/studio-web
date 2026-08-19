//! Transport-agnostic models exposed by the graph-storage contract.

/// Coarse counters describing the current state of a tenant's graph.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct GraphStats {
    /// Number of nodes visible to the caller.
    pub nodes: u64,
    /// Number of edges visible to the caller.
    pub edges: u64,
    /// Monotonic revision, bumped whenever stored state changes.
    pub graph_revision: u64,
}

/// A node submitted for ingest, identified by its producer-supplied key.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct NodeInput {
    /// Stable key, unique within the tenant. Re-ingesting a key updates it.
    pub node_key: String,
    /// GTS identifier of the node's registered type.
    pub type_id: String,
    /// Display name.
    pub name: String,
    /// Text fed to lexical search. `None` falls back to the display name, so a
    /// producer that supplies nothing is still findable by name rather than
    /// invisible — the column is `NOT NULL` and an empty one matches nothing.
    pub search_text: Option<String>,
}

/// An edge submitted for ingest, addressed by the node keys of its endpoints.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct EdgeInput {
    /// GTS identifier of the edge's registered type.
    pub type_id: String,
    /// Node key of the source endpoint.
    pub from: String,
    /// Node key of the target endpoint.
    pub to: String,
}

/// Outcome of one ingest batch.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct IngestResult {
    /// Nodes inserted or updated.
    pub nodes_upserted: u64,
    /// Edges inserted or updated.
    pub edges_upserted: u64,
}
