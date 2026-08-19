//! Object-safe client trait registered in `ClientHub`.

use async_trait::async_trait;
use toolkit_security::SecurityContext;

use super::{EdgeInput, GraphStats, GraphStorageError, IngestResult, NodeInput};

/// Object-safe client for in-process consumption by other gears (version 1).
#[async_trait]
pub trait GraphStorageClientV1: Send + Sync {
    /// Return coarse counters for the caller's graph.
    async fn stats(&self, ctx: &SecurityContext) -> Result<GraphStats, GraphStorageError>;

    /// Upsert a batch of nodes and edges.
    ///
    /// The batch is applied atomically: either every valid row commits or the
    /// call fails and nothing is written. Node keys and edge identities are
    /// stable, so repeating an identical batch converges to the same state.
    async fn ingest(
        &self,
        ctx: &SecurityContext,
        nodes: &[NodeInput],
        edges: &[EdgeInput],
    ) -> Result<IngestResult, GraphStorageError>;

    /// Register a GTS type so nodes and edges can reference it.
    async fn register_type(
        &self,
        ctx: &SecurityContext,
        type_id: &str,
        kind: &str,
    ) -> Result<i32, GraphStorageError>;
}
