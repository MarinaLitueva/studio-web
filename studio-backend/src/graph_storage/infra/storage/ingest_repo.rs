//! Batch writes through the secure ORM.
//!
//! Ids come from database sequences, so a batch never reserves a range and
//! never reads back before writing. Conflicts resolve on the tenant-scoped
//! natural keys (`node_key`, `edge_key`), which is what makes a repeated batch
//! converge instead of duplicating.
//!
//! `SecureInsertMany` cannot validate rows against the scope one by one, so it
//! exposes `scope_unchecked`. The rows here are built by the caller with the
//! tenant of the security context, and every read path that observes them is
//! scoped, so the invariant holds — but it is worth naming: on the write side
//! the tenant column is set by this layer, not enforced by the compiler.

use sea_orm::{ActiveValue::Set, EntityTrait, sea_query::OnConflict};
use time::OffsetDateTime;
use toolkit_db::secure::{AccessScope, DBRunner, SecureInsertManyExt};
use uuid::Uuid;

use crate::graph_storage::domain::error::DomainError;
use crate::graph_storage::infra::storage::entity::{graph_edge, graph_node, graph_type};

fn storage_err(e: impl std::fmt::Display) -> DomainError {
    DomainError::Storage(e.to_string())
}

/// Upsert a GTS type and return its interned id.
///
/// # Errors
/// Returns [`DomainError::Storage`] when the write or the read-back fails.
pub async fn upsert_type<C: DBRunner>(
    conn: &C,
    scope: &AccessScope,
    tenant: Uuid,
    type_id: &str,
    kind: &str,
) -> Result<i32, DomainError> {
    let row = graph_type::ActiveModel {
        tenant_id: Set(tenant),
        type_uuid: Set(Uuid::new_v4()),
        type_id: Set(type_id.to_owned()),
        kind: Set(kind.to_owned()),
        json_schema: Set(serde_json::json!({})),
        created_at: Set(OffsetDateTime::now_utc()),
        ..Default::default()
    };

    graph_type::Entity::insert_many([row])
        .secure()
        .scope_unchecked(scope)
        .map_err(storage_err)?
        .on_conflict_raw(
            OnConflict::columns([graph_type::Column::TenantId, graph_type::Column::TypeId])
                .do_nothing()
                .to_owned(),
        )
        .exec(conn)
        .await
        .map_err(storage_err)?;

    interned_type_id(conn, scope, type_id).await
}

/// Look up the interned id of an already registered type.
///
/// # Errors
/// Returns [`DomainError::UnknownType`] when the type is not registered.
pub async fn interned_type_id<C: DBRunner>(
    conn: &C,
    scope: &AccessScope,
    type_id: &str,
) -> Result<i32, DomainError> {
    use sea_orm::{ColumnTrait, Condition};
    use toolkit_db::secure::SecureEntityExt;

    let found = graph_type::Entity::find()
        .secure()
        .scope_with(scope)
        .filter(Condition::all().add(graph_type::Column::TypeId.eq(type_id)))
        .one(conn)
        .await
        .map_err(storage_err)?;

    found
        .map(|t| t.id)
        .ok_or_else(|| DomainError::UnknownType(type_id.to_owned()))
}

/// Upsert nodes by their tenant-scoped natural key.
///
/// # Errors
/// Returns [`DomainError::Storage`] when the write fails.
pub async fn upsert_nodes<C: DBRunner>(
    conn: &C,
    scope: &AccessScope,
    tenant: Uuid,
    rows: Vec<(String, i32, String, String)>,
) -> Result<u64, DomainError> {
    if rows.is_empty() {
        return Ok(0);
    }
    let now = OffsetDateTime::now_utc();
    let count = rows.len() as u64;

    let models: Vec<graph_node::ActiveModel> = rows
        .into_iter()
        .map(|(node_key, type_id, name, search_text)| graph_node::ActiveModel {
            tenant_id: Set(tenant),
            node_key: Set(node_key),
            type_id: Set(type_id),
            name: Set(name),
            payload: Set(serde_json::json!({})),
            search_text: Set(search_text),
            created_at: Set(now),
            updated_at: Set(now),
            ..Default::default()
        })
        .collect();

    graph_node::Entity::insert_many(models)
        .secure()
        .scope_unchecked(scope)
        .map_err(storage_err)?
        .on_conflict_raw(
            OnConflict::columns([graph_node::Column::TenantId, graph_node::Column::NodeKey])
                .update_columns([
                    graph_node::Column::Name,
                    graph_node::Column::TypeId,
                    graph_node::Column::SearchText,
                    graph_node::Column::UpdatedAt,
                ])
                .to_owned(),
        )
        .exec(conn)
        .await
        .map_err(storage_err)?;

    Ok(count)
}

/// Resolve node keys to their surrogate ids, scoped to the caller.
///
/// # Errors
/// Returns [`DomainError::Storage`] when the lookup fails.
pub async fn resolve_node_ids<C: DBRunner>(
    conn: &C,
    scope: &AccessScope,
    keys: &[String],
) -> Result<std::collections::HashMap<String, i64>, DomainError> {
    use sea_orm::{ColumnTrait, Condition};
    use toolkit_db::secure::SecureEntityExt;

    if keys.is_empty() {
        return Ok(std::collections::HashMap::new());
    }

    let found = graph_node::Entity::find()
        .secure()
        .scope_with(scope)
        .filter(Condition::all().add(graph_node::Column::NodeKey.is_in(keys.iter().cloned())))
        .all(conn)
        .await
        .map_err(storage_err)?;

    Ok(found.into_iter().map(|n| (n.node_key, n.id)).collect())
}

/// Upsert edges by their derived, tenant-scoped edge key.
///
/// # Errors
/// Returns [`DomainError::Storage`] when the write fails.
pub async fn upsert_edges<C: DBRunner>(
    conn: &C,
    scope: &AccessScope,
    tenant: Uuid,
    rows: Vec<(String, i32, i64, i64)>,
) -> Result<u64, DomainError> {
    if rows.is_empty() {
        return Ok(0);
    }
    let now = OffsetDateTime::now_utc();
    let count = rows.len() as u64;

    let models: Vec<graph_edge::ActiveModel> = rows
        .into_iter()
        .map(|(edge_key, type_id, src, dst)| graph_edge::ActiveModel {
            tenant_id: Set(tenant),
            edge_key: Set(edge_key),
            type_id: Set(type_id),
            src_node_id: Set(src),
            dst_node_id: Set(dst),
            payload: Set(serde_json::json!({})),
            created_at: Set(now),
            ..Default::default()
        })
        .collect();

    graph_edge::Entity::insert_many(models)
        .secure()
        .scope_unchecked(scope)
        .map_err(storage_err)?
        .on_conflict_raw(
            OnConflict::columns([graph_edge::Column::TenantId, graph_edge::Column::EdgeKey])
                .do_nothing()
                .to_owned(),
        )
        .exec(conn)
        .await
        .map_err(storage_err)?;

    Ok(count)
}
