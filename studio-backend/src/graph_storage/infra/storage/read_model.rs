//! Read queries that render a graph for a human: lexical search and the
//! subgraph around a set of seeds.
//!
//! # Why this file is not in the upstream gear
//!
//! The upstream gear answers traversal with bare node identifiers, which is all
//! a consuming gear needs — it already knows what its own keys mean. A picture
//! does not: drawing a neighbourhood needs the nodes' names and types and the
//! edges *between* them, and a search box needs matches ranked by relevance.
//! Both are additions of this assembly, kept in one file so the divergence from
//! the vendored copy stays legible, and both are candidates to go upstream.
//!
//! # Scoping
//!
//! Every query here goes through the secure ORM, so the caller's `AccessScope`
//! is applied by construction. The edge query is deliberately restricted to
//! edges whose **both** endpoints are in the authorised node set: an edge to a
//! node the caller cannot see would otherwise render as a line into nothing,
//! and would leak the existence of that node.

use sea_orm::sea_query::{Alias, Expr, Order};
use sea_orm::{ColumnTrait, Condition, EntityTrait, FromQueryResult, QueryOrder, QuerySelect};
use toolkit_db::secure::{AccessScope, DBRunner, SecureEntityExt};

use crate::graph_storage::domain::error::DomainError;
use crate::graph_storage::infra::storage::entity::{graph_edge, graph_node, graph_type};
use crate::graph_storage::infra::storage::migrations::m20260818_000004_search_indexes::FTS_CONFIG;

/// Column the lexical rank is projected as.
const RANK: &str = "rank";

/// One node, resolved enough to draw and to list.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NodeView {
    /// Surrogate identifier, unique within the tenant.
    pub id: i64,
    /// Producer-supplied stable key.
    pub node_key: String,
    /// Display name.
    pub name: String,
    /// GTS identifier of the node's type, resolved from the interned id.
    pub type_id: String,
}

/// One edge between two nodes the caller may see.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EdgeView {
    /// Source node identifier.
    pub src: i64,
    /// Destination node identifier.
    pub dst: i64,
    /// GTS identifier of the edge's type.
    pub type_id: String,
}

/// Raw projection of the lexical search, before type ids are resolved.
#[derive(Debug, FromQueryResult)]
struct ScoredRow {
    id: i64,
    node_key: String,
    name: String,
    type_id: i32,
}

/// Rank nodes whose composed text matches `text`, most relevant first.
///
/// The predicate is written on the same expression the GIN index is built on
/// (`m20260818_000004_search_indexes`), read from the same constant: a
/// different configuration name would still return correct rows and silently
/// stop using the index.
///
/// # Errors
/// Returns [`DomainError::Storage`] when the query fails.
pub async fn search<C: DBRunner>(
    conn: &C,
    scope: &AccessScope,
    text: &str,
    limit: u32,
) -> Result<Vec<NodeView>, DomainError> {
    if text.trim().is_empty() {
        return Ok(Vec::new());
    }

    let matches = format!(
        "to_tsvector('{FTS_CONFIG}', search_text) @@ plainto_tsquery('{FTS_CONFIG}', $1)"
    );
    let rank = format!(
        "ts_rank(to_tsvector('{FTS_CONFIG}', search_text), plainto_tsquery('{FTS_CONFIG}', $1))"
    );
    let value = sea_orm::Value::from(text.to_owned());
    let limit = u64::from(limit);

    let rows: Vec<ScoredRow> = graph_node::Entity::find()
        .secure()
        .scope_with(scope)
        .filter(Condition::all().add(Expr::cust_with_values(matches, [value.clone()])))
        .project_all(conn, move |q| {
            q.select_only()
                .column(graph_node::Column::Id)
                .column(graph_node::Column::NodeKey)
                .column(graph_node::Column::Name)
                .column(graph_node::Column::TypeId)
                .expr_as(Expr::cust_with_values(rank, [value]), RANK)
                .order_by(Expr::col(Alias::new(RANK)), Order::Desc)
                .limit(limit)
                .into_model::<ScoredRow>()
        })
        .await
        .map_err(|e| DomainError::Storage(e.to_string()))?;

    resolve_types(conn, scope, rows).await
}

/// Fetch the nodes with the given ids, in id order.
///
/// # Errors
/// Returns [`DomainError::Storage`] when the query fails.
pub async fn nodes<C: DBRunner>(
    conn: &C,
    scope: &AccessScope,
    ids: &[i64],
) -> Result<Vec<NodeView>, DomainError> {
    if ids.is_empty() {
        return Ok(Vec::new());
    }

    let rows: Vec<ScoredRow> = graph_node::Entity::find()
        .secure()
        .scope_with(scope)
        .filter(Condition::all().add(graph_node::Column::Id.is_in(ids.iter().copied())))
        .project_all(conn, |q| {
            q.select_only()
                .column(graph_node::Column::Id)
                .column(graph_node::Column::NodeKey)
                .column(graph_node::Column::Name)
                .column(graph_node::Column::TypeId)
                .order_by(Expr::col(graph_node::Column::Id), Order::Asc)
                .into_model::<ScoredRow>()
        })
        .await
        .map_err(|e| DomainError::Storage(e.to_string()))?;

    resolve_types(conn, scope, rows).await
}

/// Raw projection of the edge query.
#[derive(Debug, FromQueryResult)]
struct EdgeRow {
    src_node_id: i64,
    dst_node_id: i64,
    type_id: i32,
}

/// Fetch the edges whose **both** endpoints are among `ids`.
///
/// Restricting both ends rather than one is what keeps the rendered graph
/// closed: an edge with one visible endpoint would draw a line to a node the
/// caller may not see, and disclose that it exists.
///
/// # Errors
/// Returns [`DomainError::Storage`] when the query fails.
pub async fn edges_within<C: DBRunner>(
    conn: &C,
    scope: &AccessScope,
    ids: &[i64],
) -> Result<Vec<EdgeView>, DomainError> {
    if ids.is_empty() {
        return Ok(Vec::new());
    }

    let rows: Vec<EdgeRow> = graph_edge::Entity::find()
        .secure()
        .scope_with(scope)
        .filter(
            Condition::all()
                .add(graph_edge::Column::SrcNodeId.is_in(ids.iter().copied()))
                .add(graph_edge::Column::DstNodeId.is_in(ids.iter().copied())),
        )
        .project_all(conn, |q| {
            q.select_only()
                .column(graph_edge::Column::SrcNodeId)
                .column(graph_edge::Column::DstNodeId)
                .column(graph_edge::Column::TypeId)
                .into_model::<EdgeRow>()
        })
        .await
        .map_err(|e| DomainError::Storage(e.to_string()))?;

    let types = interned_types(conn, scope).await?;
    Ok(rows
        .into_iter()
        .map(|r| EdgeView {
            src: r.src_node_id,
            dst: r.dst_node_id,
            type_id: types
                .get(&r.type_id)
                .cloned()
                .unwrap_or_else(|| r.type_id.to_string()),
        })
        .collect())
}

/// Replace interned type ids with their GTS identifiers.
///
/// One lookup for the whole batch rather than a join: `graph_type` holds one
/// row per registered type per tenant, so it is small, and joining would put
/// the scope predicate on two tables whose `id` means different things.
async fn resolve_types<C: DBRunner>(
    conn: &C,
    scope: &AccessScope,
    rows: Vec<ScoredRow>,
) -> Result<Vec<NodeView>, DomainError> {
    if rows.is_empty() {
        return Ok(Vec::new());
    }
    let types = interned_types(conn, scope).await?;
    Ok(rows
        .into_iter()
        .map(|r| NodeView {
            id: r.id,
            node_key: r.node_key,
            name: r.name,
            type_id: types
                .get(&r.type_id)
                .cloned()
                .unwrap_or_else(|| r.type_id.to_string()),
        })
        .collect())
}

/// Every type the caller may see, as `interned id -> GTS identifier`.
async fn interned_types<C: DBRunner>(
    conn: &C,
    scope: &AccessScope,
) -> Result<std::collections::HashMap<i32, String>, DomainError> {
    let rows = graph_type::Entity::find()
        .secure()
        .scope_with(scope)
        .all(conn)
        .await
        .map_err(|e| DomainError::Storage(e.to_string()))?;
    Ok(rows.into_iter().map(|t| (t.id, t.type_id)).collect())
}
