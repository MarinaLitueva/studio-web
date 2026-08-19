//! In-process adapter implementing the SDK client trait over domain services.
//!
//! Registered in `ClientHub` so other gears can call graph-storage without
//! going through HTTP. It shares the same services — and, once the admission
//! and policy layers land, the same enforcement — as the REST surface.

use std::sync::Arc;

use async_trait::async_trait;
use crate::graph_storage::sdk::{
    EdgeInput, GraphStats, GraphStorageClientV1, GraphStorageError, IngestResult, NodeInput,
};
use toolkit_security::SecurityContext;

use crate::graph_storage::domain::service::GraphServices;

/// `ClientHub` adapter for in-process consumers.
pub struct GraphStorageLocalClient {
    services: Arc<GraphServices>,
}

impl GraphStorageLocalClient {
    /// Wrap the domain services in an object-safe client.
    #[must_use]
    pub fn new(services: Arc<GraphServices>) -> Self {
        Self { services }
    }
}

#[async_trait]
impl GraphStorageClientV1 for GraphStorageLocalClient {
    async fn stats(&self, ctx: &SecurityContext) -> Result<GraphStats, GraphStorageError> {
        Ok(self.services.stats(ctx).await?)
    }

    async fn ingest(
        &self,
        ctx: &SecurityContext,
        nodes: &[NodeInput],
        edges: &[EdgeInput],
    ) -> Result<IngestResult, GraphStorageError> {
        Ok(self.services.ingest(ctx, nodes, edges).await?)
    }

    async fn register_type(
        &self,
        ctx: &SecurityContext,
        type_id: &str,
        kind: &str,
    ) -> Result<i32, GraphStorageError> {
        Ok(self.services.register_type(ctx, type_id, kind).await?)
    }
}
