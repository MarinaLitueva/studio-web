//! Persistence for studio-documents over `toolkit_db` (sea-orm), scoped to the
//! workspace tenant. Mirrors the secure-CRUD shape of `studio-credstore-pg`:
//! `.secure().scope_with(..)` for reads, `.secure().scope_unchecked(..)` for
//! writes the gear has already authorized, and an `ON CONFLICT (id)` upsert.

use std::sync::Arc;

use anyhow::Result;
use sea_orm::{ColumnTrait, Condition, EntityTrait, IntoActiveModel, QueryFilter};
use toolkit_db::DBProvider;
use toolkit_db::secure::{SecureEntityExt, SecureInsertExt, SecureOnConflict};
use toolkit_security::AccessScope;
use uuid::Uuid;

use super::entity::{doc_type, document};

/// UUIDv5 namespace for a document type's deterministic id — makes `(tenant,
/// key)` the primary key and gives `upsert_type` an idempotent conflict target.
const TYPE_NS: Uuid = Uuid::from_u128(0x7d0c_9f21_4b6a_5e88_9c14_a2f3_71b6_0d42);

/// Which documents a list call wants.
pub enum DocScope {
    /// Only workspace-level documents (`project_id IS NULL`).
    WorkspaceLevel,
    /// Effective set for a project: workspace-level (inherited) + the project's
    /// own (`project_id IS NULL OR project_id = pid`).
    Effective(Uuid),
}

/// Deterministic id for a workspace-defined type.
pub fn type_row_id(workspace_id: Uuid, key: &str) -> Uuid {
    Uuid::new_v5(&TYPE_NS, format!("{workspace_id}|{key}").as_bytes())
}

pub struct DocumentsRepo {
    db: Arc<DBProvider<anyhow::Error>>,
}

impl DocumentsRepo {
    pub fn new(db: Arc<DBProvider<anyhow::Error>>) -> Self {
        Self { db }
    }

    // ── document types ──────────────────────────────────────────────────────

    /// Workspace-defined types (built-ins are added by the service).
    pub async fn list_types(&self, workspace_id: Uuid) -> Result<Vec<doc_type::Model>> {
        let conn = self.db.conn()?;
        let rows = doc_type::Entity::find()
            .secure()
            .scope_with(&AccessScope::for_tenant(workspace_id))
            .all(&conn)
            .await?;
        Ok(rows)
    }

    /// Insert or replace a workspace-defined type.
    pub async fn upsert_type(&self, model: doc_type::Model) -> Result<()> {
        let conn = self.db.conn()?;
        let workspace_id = model.tenant_id;
        let on_conflict = SecureOnConflict::<doc_type::Entity>::columns([doc_type::Column::Id])
            .update_columns([
                doc_type::Column::Name,
                doc_type::Column::Description,
                doc_type::Column::GtsTypeId,
                doc_type::Column::Template,
                doc_type::Column::UpdatedAt,
            ])?;
        doc_type::Entity::insert(model.into_active_model())
            .secure()
            .scope_unchecked(&AccessScope::for_tenant(workspace_id))?
            .on_conflict(on_conflict)
            .exec(&conn)
            .await?;
        Ok(())
    }

    // ── documents ───────────────────────────────────────────────────────────

    pub async fn get_doc(&self, workspace_id: Uuid, id: Uuid) -> Result<Option<document::Model>> {
        let conn = self.db.conn()?;
        let row = document::Entity::find()
            .secure()
            .scope_with(&AccessScope::for_tenant(workspace_id))
            .filter(Condition::all().add(document::Column::Id.eq(id)))
            .one(&conn)
            .await?;
        Ok(row)
    }

    pub async fn list_docs(
        &self,
        workspace_id: Uuid,
        scope: DocScope,
    ) -> Result<Vec<document::Model>> {
        let conn = self.db.conn()?;
        let filter = match scope {
            DocScope::WorkspaceLevel => Condition::all().add(document::Column::ProjectId.is_null()),
            DocScope::Effective(project_id) => Condition::any()
                .add(document::Column::ProjectId.is_null())
                .add(document::Column::ProjectId.eq(project_id)),
        };
        let rows = document::Entity::find()
            .secure()
            .scope_with(&AccessScope::for_tenant(workspace_id))
            .filter(filter)
            .all(&conn)
            .await?;
        Ok(rows)
    }

    /// Create (fresh id → plain insert) or update (existing id → conflict
    /// updates the mutable columns; identity/provenance columns are left as they
    /// were, since the service passes them through unchanged).
    pub async fn upsert_doc(&self, model: document::Model) -> Result<()> {
        let conn = self.db.conn()?;
        let workspace_id = model.tenant_id;
        let on_conflict = SecureOnConflict::<document::Entity>::columns([document::Column::Id])
            .update_columns([
                document::Column::Title,
                document::Column::Content,
                document::Column::Status,
                document::Column::Conforms,
                document::Column::Validation,
                document::Column::UpdatedAt,
            ])?;
        document::Entity::insert(model.into_active_model())
            .secure()
            .scope_unchecked(&AccessScope::for_tenant(workspace_id))?
            .on_conflict(on_conflict)
            .exec(&conn)
            .await?;
        Ok(())
    }

    /// Delete a document. Authorized by a scoped fetch first; the delete itself
    /// targets the globally-unique primary key.
    pub async fn delete_doc(&self, workspace_id: Uuid, id: Uuid) -> Result<bool> {
        if self.get_doc(workspace_id, id).await?.is_none() {
            return Ok(false);
        }
        let conn = self.db.conn()?;
        document::Entity::delete_by_id(id).exec(&conn).await?;
        Ok(true)
    }
}
