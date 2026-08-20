//! The graph-store contract for artifact ingest.
//!
//! Artifacts are normalized into typed GTS nodes and handed to a
//! [`GraphStore`]. The real store is the graph-storage gear (see
//! `graph_backend::GraphStorageBackend`); [`InMemoryGraphStore`] is the
//! fallback when that gear is not linked (the `graph` Cargo feature is off) or
//! its client is not available.
//!
//! Every operation carries the caller's [`SecurityContext`] because the real
//! store is tenant-scoped; the in-memory fallback ignores it.

use std::collections::HashMap;
use std::sync::Mutex;

use async_trait::async_trait;
use serde_json::Value;
use toolkit_security::SecurityContext;

/// A GTS node to persist: its type id (`gts.cf.studio.artifact.*`), a
/// deterministic instance id (uuid5 of a stable key — idempotent across
/// syncs), and the payload.
#[derive(Debug, Clone)]
pub struct GtsNode {
    pub type_id: &'static str,
    pub instance_id: String,
    pub value: Value,
}

/// The graph store contract. Batched, idempotent by instance id, and readable
/// back so the UI can list what was ingested.
#[async_trait]
pub trait GraphStore: Send + Sync {
    async fn upsert_nodes(&self, ctx: &SecurityContext, nodes: &[GtsNode]) -> anyhow::Result<()>;

    /// All stored nodes, optionally filtered to those whose type id contains
    /// `type_filter` (e.g. `issue`, `pull_request`, `file`, `repo`).
    async fn list(
        &self,
        ctx: &SecurityContext,
        type_filter: Option<&str>,
    ) -> anyhow::Result<Vec<GtsNode>>;
}

/// In-memory store: keyed by instance id, so a re-sync upserts. Not persistent
/// — it resets when the backend restarts. Swap for the real graph-storage
/// adapter once its API lands.
#[derive(Default)]
pub struct InMemoryGraphStore {
    nodes: Mutex<HashMap<String, GtsNode>>,
}

#[async_trait]
impl GraphStore for InMemoryGraphStore {
    async fn upsert_nodes(&self, _ctx: &SecurityContext, nodes: &[GtsNode]) -> anyhow::Result<()> {
        let total = {
            let mut map = self
                .nodes
                .lock()
                .map_err(|_| anyhow::anyhow!("graph store lock poisoned"))?;
            for n in nodes {
                map.insert(n.instance_id.clone(), n.clone());
            }
            map.len()
        };
        tracing::info!(
            batch = nodes.len(),
            total,
            "studio-artifact-ingest: in-memory graph upsert"
        );
        Ok(())
    }

    async fn list(
        &self,
        _ctx: &SecurityContext,
        type_filter: Option<&str>,
    ) -> anyhow::Result<Vec<GtsNode>> {
        let out = {
            let map = self
                .nodes
                .lock()
                .map_err(|_| anyhow::anyhow!("graph store lock poisoned"))?;
            map.values()
                .filter(|n| type_filter.is_none_or(|t| n.type_id.contains(t)))
                .cloned()
                .collect()
        };
        Ok(out)
    }
}
