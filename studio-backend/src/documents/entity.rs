//! `SeaORM` entities for studio-documents.
//!
//! Two tables, both scoped by the **workspace** tenant. A document's
//! `project_id` (NULL = workspace-level, inherited by every project under the
//! workspace) is a plain column, not a separate tenant — so the secure scope
//! stays single-tenant (`tenant_id` = workspace) and inheritance is a cheap
//! `project_id IS NULL OR project_id = ?` filter rather than a cross-tenant read.

/// A workspace-defined document type. Built-in types live in code
/// ([`super::model::builtin_types`]); only overrides and additions are rows.
pub mod doc_type {
    use sea_orm::entity::prelude::*;
    use time::OffsetDateTime;
    use toolkit_db::secure::Scopable;
    use uuid::Uuid;

    #[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel, Scopable)]
    #[sea_orm(table_name = "studio_document_types")]
    #[secure(tenant_col = "tenant_id", resource_col = "id", no_owner, no_type)]
    pub struct Model {
        /// Deterministic v5 UUID of `(tenant_id, key)` — the primary key is the
        /// uniqueness constraint on the type key and the `ON CONFLICT` target.
        #[sea_orm(primary_key, auto_increment = false)]
        pub id: Uuid,
        /// Workspace tenant that owns this type.
        pub tenant_id: Uuid,
        pub key: String,
        pub name: String,
        pub description: String,
        pub gts_type_id: String,
        /// JSON `TemplateSpec` — `{ body, sections, rules }`.
        pub template: String,
        pub created_at: OffsetDateTime,
        pub updated_at: OffsetDateTime,
    }

    #[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
    pub enum Relation {}

    impl ActiveModelBehavior for ActiveModel {}
}

/// A document instance.
pub mod document {
    use sea_orm::entity::prelude::*;
    use time::OffsetDateTime;
    use toolkit_db::secure::Scopable;
    use uuid::Uuid;

    #[derive(Clone, Debug, PartialEq, Eq, DeriveEntityModel, Scopable)]
    #[sea_orm(table_name = "studio_documents")]
    #[secure(tenant_col = "tenant_id", resource_col = "id", no_owner, no_type)]
    pub struct Model {
        #[sea_orm(primary_key, auto_increment = false)]
        pub id: Uuid,
        /// Workspace tenant (the scope).
        pub tenant_id: Uuid,
        /// NULL = workspace-level (inherited by projects); else the project id.
        pub project_id: Option<Uuid>,
        pub type_key: String,
        pub title: String,
        pub content: String,
        /// 0 = draft, 1 = review, 2 = approved.
        pub status: i16,
        pub conforms: bool,
        /// JSON `ValidationReport` from the last check.
        pub validation: String,
        /// Creator subject id (string principal).
        pub created_by: String,
        pub created_at: OffsetDateTime,
        pub updated_at: OffsetDateTime,
    }

    #[derive(Copy, Clone, Debug, EnumIter, DeriveRelation)]
    pub enum Relation {}

    impl ActiveModelBehavior for ActiveModel {}
}
