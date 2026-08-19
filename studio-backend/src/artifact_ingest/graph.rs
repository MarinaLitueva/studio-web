//! The graph-store contract for artifact ingest.
//!
//! Artifacts are normalized into typed GTS nodes and handed to a
//! [`GraphStore`]. The real `hypothesis/graph-storage` adapter is future work
//! (its API is not defined yet); until then [`LoggingGraphStore`] keeps the
//! ingest pipeline exercised end to end.

use async_trait::async_trait;
use serde_json::Value;

/// A GTS node to persist: its type id (`gts.cf.studio.artifact.*`), a
/// deterministic instance id (uuid5 of a stable key — idempotent across
/// syncs), and the payload.
#[derive(Debug, Clone)]
pub struct GtsNode {
    pub type_id: &'static str,
    pub instance_id: String,
    pub value: Value,
}

/// The graph store contract. Batched and idempotent by instance id.
#[async_trait]
pub trait GraphStore: Send + Sync {
    async fn upsert_nodes(&self, nodes: &[GtsNode]) -> anyhow::Result<()>;
}

/// Stub store: logs what would be written. Swap for the real graph-storage
/// adapter once its API lands (see the architecture note).
pub struct LoggingGraphStore;

#[async_trait]
impl GraphStore for LoggingGraphStore {
    async fn upsert_nodes(&self, nodes: &[GtsNode]) -> anyhow::Result<()> {
        for n in nodes {
            tracing::info!(
                type_id = n.type_id,
                instance_id = %n.instance_id,
                "studio-artifact-ingest: graph upsert (stub)"
            );
        }
        tracing::info!(
            count = nodes.len(),
            "studio-artifact-ingest: graph batch (stub)"
        );
        Ok(())
    }
}
