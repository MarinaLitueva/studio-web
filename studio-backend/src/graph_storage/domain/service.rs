//! Domain services.
//!
//! Phase 2 carries a single read-only service backed by the secure ORM, so the
//! storage and authorization wiring can be exercised end to end. Ingest,
//! search, traversal and analytics land here as their layers are implemented.

use std::sync::Arc;

use crate::graph_storage::sdk::{EdgeInput, GraphStats, IngestResult, NodeInput};
use toolkit_db::{DBProvider, DbError};
use toolkit_security::{AccessScope, SecurityContext};

use crate::graph_storage::config::{GraphStorageConfig, HopStrategy};
use crate::graph_storage::domain::error::DomainError;
use crate::graph_storage::infra::storage::read_model::{EdgeView, NodeView};
use crate::graph_storage::infra::storage::{
    counts, ingest_repo, pgq, read_model, traversal, traversal_pgq,
};

/// Composition of all domain services used by the gear.
pub struct GraphServices {
    config: GraphStorageConfig,
    db: Arc<DBProvider<DbError>>,
}

impl GraphServices {
    /// Build the service composition from validated configuration.
    #[must_use]
    pub fn new(config: GraphStorageConfig, db: Arc<DBProvider<DbError>>) -> Self {
        Self { config, db }
    }

    /// Effective gear configuration.
    #[must_use]
    pub fn config(&self) -> &GraphStorageConfig {
        &self.config
    }

    /// Coarse counters for the caller's graph.
    ///
    /// The scope is derived from the caller's tenant. A PDP-issued scope
    /// replaces this once the policy-enforcement layer lands; the call site
    /// does not change, because the repository already takes an `AccessScope`.
    ///
    /// # Errors
    /// Returns [`DomainError::Storage`] when the query fails.
    pub async fn stats(&self, ctx: &SecurityContext) -> Result<GraphStats, DomainError> {
        let scope = AccessScope::for_tenant(ctx.subject_tenant_id());
        let conn = self
            .db
            .conn()
            .map_err(|e| DomainError::Storage(e.to_string()))?;
        counts::graph_stats(&conn, &scope).await
    }

    /// Register a GTS type for the caller's tenant, returning its interned id.
    ///
    /// # Errors
    /// Returns [`DomainError::Storage`] when the write fails.
    pub async fn register_type(
        &self,
        ctx: &SecurityContext,
        type_id: &str,
        kind: &str,
    ) -> Result<i32, DomainError> {
        let tenant = ctx.subject_tenant_id();
        let scope = AccessScope::for_tenant(tenant);
        let conn = self
            .db
            .conn()
            .map_err(|e| DomainError::Storage(e.to_string()))?;
        ingest_repo::upsert_type(&conn, &scope, tenant, type_id, kind).await
    }

    /// Upsert a batch of nodes and edges.
    ///
    /// Validation runs before any write: every referenced type must be
    /// registered, and every edge endpoint must resolve to a node that either
    /// arrives in this batch or already exists. A batch that fails validation
    /// writes nothing.
    ///
    /// # Errors
    /// Returns [`DomainError::UnknownType`], [`DomainError::UnknownEndpoint`]
    /// or [`DomainError::Storage`].
    pub async fn ingest(
        &self,
        ctx: &SecurityContext,
        nodes: &[NodeInput],
        edges: &[EdgeInput],
    ) -> Result<IngestResult, DomainError> {
        if nodes.len() > self.config.ingest_max_nodes as usize {
            return Err(DomainError::BatchTooLarge {
                kind: "nodes",
                limit: self.config.ingest_max_nodes,
                requested: nodes.len(),
            });
        }
        if edges.len() > self.config.ingest_max_edges as usize {
            return Err(DomainError::BatchTooLarge {
                kind: "edges",
                limit: self.config.ingest_max_edges,
                requested: edges.len(),
            });
        }

        let tenant = ctx.subject_tenant_id();
        let scope = AccessScope::for_tenant(tenant);
        let conn = self
            .db
            .conn()
            .map_err(|e| DomainError::Storage(e.to_string()))?;

        // Resolve every referenced type before writing anything.
        let mut type_ids = std::collections::HashMap::new();
        for t in nodes
            .iter()
            .map(|n| n.type_id.as_str())
            .chain(edges.iter().map(|e| e.type_id.as_str()))
        {
            if !type_ids.contains_key(t) {
                let id = ingest_repo::interned_type_id(&conn, &scope, t).await?;
                type_ids.insert(t.to_owned(), id);
            }
        }

        let node_rows: Vec<(String, i32, String, String)> = nodes
            .iter()
            .map(|n| {
                (
                    n.node_key.clone(),
                    type_ids[&n.type_id],
                    n.name.clone(),
                    n.search_text.clone().unwrap_or_else(|| n.name.clone()),
                )
            })
            .collect();
        let nodes_upserted = ingest_repo::upsert_nodes(&conn, &scope, tenant, node_rows).await?;

        // Endpoints may arrive in this batch or already exist.
        let mut endpoint_keys: Vec<String> = edges
            .iter()
            .flat_map(|e| [e.from.clone(), e.to.clone()])
            .collect();
        endpoint_keys.sort();
        endpoint_keys.dedup();
        let ids = ingest_repo::resolve_node_ids(&conn, &scope, &endpoint_keys).await?;

        let mut edge_rows = Vec::with_capacity(edges.len());
        for e in edges {
            let src = *ids
                .get(&e.from)
                .ok_or_else(|| DomainError::UnknownEndpoint(e.from.clone()))?;
            let dst = *ids
                .get(&e.to)
                .ok_or_else(|| DomainError::UnknownEndpoint(e.to.clone()))?;
            let edge_key = format!("{}|{}|{}", e.type_id, e.from, e.to);
            edge_rows.push((edge_key, type_ids[&e.type_id], src, dst));
        }
        let edges_upserted = ingest_repo::upsert_edges(&conn, &scope, tenant, edge_rows).await?;

        Ok(IngestResult {
            nodes_upserted,
            edges_upserted,
        })
    }

    /// Rank the caller's nodes against a free-text query.
    ///
    /// Lexical only. The gear also carries a single-statement hybrid query that
    /// combines vector similarity, graph expansion and this same full-text
    /// predicate (`infra::storage::hybrid`), but its vector arm needs an
    /// embedding for the query, and this assembly has no embedding model — so
    /// what is wired here is the arm that works with the data producers
    /// actually supply.
    ///
    /// # Errors
    /// Returns [`DomainError::Storage`] when the query fails.
    pub async fn search(
        &self,
        ctx: &SecurityContext,
        text: &str,
        limit: u32,
    ) -> Result<Vec<NodeView>, DomainError> {
        let limit = limit.min(self.config.traversal_max_nodes);
        let scope = AccessScope::for_tenant(ctx.subject_tenant_id());
        let conn = self
            .db
            .conn()
            .map_err(|e| DomainError::Storage(e.to_string()))?;
        read_model::search(&conn, &scope, text, limit).await
    }

    /// The drawable neighbourhood around `seeds`: nodes and the edges between
    /// them.
    ///
    /// The node set is exactly what [`Self::neighbours`] returns, so the
    /// picture and the identifiers agree by construction and the traversal
    /// backend under test is the one being drawn.
    ///
    /// # Errors
    /// Returns [`DomainError::Storage`] when a query fails.
    pub async fn subgraph(
        &self,
        ctx: &SecurityContext,
        seeds: &[i64],
        depth: u8,
    ) -> Result<(Vec<NodeView>, Vec<EdgeView>), DomainError> {
        let ids = self.neighbours(ctx, seeds, depth).await?;

        let scope = AccessScope::for_tenant(ctx.subject_tenant_id());
        let conn = self
            .db
            .conn()
            .map_err(|e| DomainError::Storage(e.to_string()))?;

        let nodes = read_model::nodes(&conn, &scope, &ids).await?;
        let edges = read_model::edges_within(&conn, &scope, &ids).await?;
        Ok((nodes, edges))
    }

    /// Expand a breadth-first neighbourhood around `seeds`.
    ///
    /// Depth is clamped to the configured maximum and the result to the node
    /// budget, so an unbounded request is rejected by construction rather than
    /// attempted. Only nodes the caller may see enter the frontier, so the walk
    /// stays inside the caller-authorised subgraph.
    ///
    /// # Errors
    /// Returns [`DomainError::Storage`] when a hop query fails.
    pub async fn neighbours(
        &self,
        ctx: &SecurityContext,
        seeds: &[i64],
        depth: u8,
    ) -> Result<Vec<i64>, DomainError> {
        let depth = depth.min(self.config.traversal_max_depth);
        let budget = self.config.traversal_max_nodes as usize;
        let scope = AccessScope::for_tenant(ctx.subject_tenant_id());
        let conn = self
            .db
            .conn()
            .map_err(|e| DomainError::Storage(e.to_string()))?;

        // Resolved once for the whole walk rather than per hop: the scope does
        // not change between hops, and a per-hop decision would log the same
        // fallback once per level.
        let hop = Self::effective_hop(self.config.traversal_hop, &scope);

        let mut visited: Vec<i64> = seeds.to_vec();
        visited.sort_unstable();
        visited.dedup();
        let mut frontier = visited.clone();

        for _ in 0..depth {
            if frontier.is_empty() || visited.len() >= budget {
                break;
            }
            let neighbours = match hop {
                HopStrategy::TwoQuery => {
                    traversal::expand_frontier(&conn, &scope, &frontier, None).await?
                }
                HopStrategy::Cte => {
                    traversal::expand_frontier_cte(&conn, &scope, &frontier, None).await?
                }
                HopStrategy::Pgq => {
                    traversal_pgq::expand_frontier_pgq(&conn, &scope, &frontier, None).await?
                }
            };
            frontier = neighbours
                .into_iter()
                .filter(|id| !visited.contains(id))
                .collect();
            visited.extend(frontier.iter().copied());
            visited.sort_unstable();
            visited.dedup();
        }

        visited.truncate(budget);
        Ok(visited)
    }
}

impl GraphServices {
    /// Which hop implementation actually serves a request under `scope`.
    ///
    /// The `GRAPH_TABLE` backend needs the caller's scope reduced to a set of
    /// tenants, because a pattern with no tenant bound reads whichever tenant
    /// owns the ids it is given. Not every scope reduces that way — `allow_all`
    /// and tenant-subtree scopes do not — and those requests are served by the
    /// two-query hop instead of being refused.
    ///
    /// Falling back rather than refusing is the port's existing contract, not a
    /// concession: ADR-0001 already has the port choosing a backend per request
    /// shape, and the stand suite pins that both backends return the same ids
    /// for the same seeds and scope. What the fallback must not do is happen
    /// quietly — a deployment configured for `pgq` and silently served by
    /// `two_query` would make any measurement taken from it meaningless — so it
    /// is logged with the reason.
    fn effective_hop(configured: HopStrategy, scope: &AccessScope) -> HopStrategy {
        if configured == HopStrategy::Cte && !traversal::is_tenant_only(scope) {
            tracing::warn!(
                "scope carries filters a CTE body cannot express; serving this request with the two-query hop"
            );
            return HopStrategy::TwoQuery;
        }
        if configured != HopStrategy::Pgq {
            return configured;
        }
        match pgq::tenant_bound(scope) {
            Ok(_) => HopStrategy::Pgq,
            Err(reason) => {
                tracing::warn!(
                    %reason,
                    "scope cannot bound a graph pattern; serving this request with the two-query hop"
                );
                HopStrategy::TwoQuery
            }
        }
    }
}

#[cfg(test)]
mod hop_selection_tests {
    use super::*;
    use uuid::Uuid;

    /// A scope the pattern can bound is served by the configured backend.
    #[test]
    fn a_tenant_scope_keeps_the_pgq_hop() {
        let scope = AccessScope::for_tenant(Uuid::from_u128(1));
        assert_eq!(
            GraphServices::effective_hop(HopStrategy::Pgq, &scope),
            HopStrategy::Pgq
        );
    }

    /// A scope with no tenant bound falls back rather than failing the request.
    #[test]
    fn an_unbounded_scope_falls_back_to_the_two_query_hop() {
        assert_eq!(
            GraphServices::effective_hop(HopStrategy::Pgq, &AccessScope::allow_all()),
            HopStrategy::TwoQuery
        );
    }

    /// The fallback is specific to the pattern backend. The other two express
    /// any scope the secure ORM can, so nothing about them is conditional.
    #[test]
    fn the_other_backends_are_never_substituted() {
        for configured in [HopStrategy::TwoQuery, HopStrategy::Cte] {
            for scope in [
                AccessScope::allow_all(),
                AccessScope::deny_all(),
                AccessScope::for_tenant(Uuid::from_u128(1)),
            ] {
                assert_eq!(
                    GraphServices::effective_hop(configured, &scope),
                    configured,
                    "{configured:?} was substituted"
                );
            }
        }
    }

    /// `deny_all` reduces to "no tenants", which the pattern renders honestly
    /// as a predicate matching nothing. It is not a reason to fall back.
    #[test]
    fn deny_all_does_not_trigger_the_fallback() {
        assert_eq!(
            GraphServices::effective_hop(HopStrategy::Pgq, &AccessScope::deny_all()),
            HopStrategy::Pgq
        );
    }
}
