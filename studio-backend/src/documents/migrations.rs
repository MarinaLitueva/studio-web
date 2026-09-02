//! `SeaORM` migrations for studio-documents.
//!
//! Raw per-backend SQL (not the schema builder) so the `CHECK`/`UNIQUE`
//! constraints are preserved verbatim — the same approach `studio-credstore-pg`
//! takes. Two tables: workspace-defined document types and document instances.

use toolkit_db::sea_orm_migration::prelude::*;

pub struct Migrator;

#[async_trait::async_trait]
impl MigratorTrait for Migrator {
    fn migrations() -> Vec<Box<dyn MigrationTrait>> {
        vec![Box::new(m0001::Migration)]
    }
}

mod m0001 {
    use toolkit_db::sea_orm_migration::prelude::*;
    use toolkit_db::sea_orm_migration::sea_orm;
    use toolkit_db::sea_orm_migration::sea_orm::ConnectionTrait;

    const UNSUPPORTED: &str = "studio-documents migrations: only PostgreSQL and SQLite are \
        supported (this migration set does not target MySQL)";

    pub struct Migration;

    impl MigrationName for Migration {
        fn name(&self) -> &str {
            "m0001_studio_documents"
        }
    }

    #[async_trait::async_trait]
    impl MigrationTrait for Migration {
        async fn up(&self, manager: &SchemaManager) -> Result<(), DbErr> {
            let statements: [&str; 3] = match manager.get_database_backend() {
                sea_orm::DatabaseBackend::Postgres => [
                    r"
CREATE TABLE IF NOT EXISTS studio_document_types (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL,
    key TEXT NOT NULL CHECK (length(key) BETWEEN 1 AND 80),
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    gts_type_id TEXT NOT NULL,
    template TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (tenant_id, key)
);",
                    r"
CREATE TABLE IF NOT EXISTS studio_documents (
    id UUID PRIMARY KEY,
    tenant_id UUID NOT NULL,
    project_id UUID,
    type_key TEXT NOT NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    status SMALLINT NOT NULL DEFAULT 0,
    conforms BOOLEAN NOT NULL DEFAULT FALSE,
    validation TEXT NOT NULL DEFAULT '{}',
    created_by TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);",
                    r"CREATE INDEX IF NOT EXISTS idx_studio_documents_tenant_project
    ON studio_documents (tenant_id, project_id);",
                ],
                sea_orm::DatabaseBackend::Sqlite => [
                    r"
CREATE TABLE IF NOT EXISTS studio_document_types (
    id BLOB PRIMARY KEY NOT NULL,
    tenant_id BLOB NOT NULL,
    key TEXT NOT NULL CHECK (length(key) BETWEEN 1 AND 80),
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    gts_type_id TEXT NOT NULL,
    template TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (tenant_id, key)
);",
                    r"
CREATE TABLE IF NOT EXISTS studio_documents (
    id BLOB PRIMARY KEY NOT NULL,
    tenant_id BLOB NOT NULL,
    project_id BLOB,
    type_key TEXT NOT NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    status SMALLINT NOT NULL DEFAULT 0,
    conforms BOOLEAN NOT NULL DEFAULT 0,
    validation TEXT NOT NULL DEFAULT '{}',
    created_by TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);",
                    r"CREATE INDEX IF NOT EXISTS idx_studio_documents_tenant_project
    ON studio_documents (tenant_id, project_id);",
                ],
                _ => return Err(DbErr::Custom(UNSUPPORTED.to_owned())),
            };

            // One statement per call: `execute_unprepared` runs raw SQL and not
            // every backend accepts several statements in one batch.
            for sql in statements {
                manager.get_connection().execute_unprepared(sql).await?;
            }
            Ok(())
        }

        async fn down(&self, manager: &SchemaManager) -> Result<(), DbErr> {
            if matches!(
                manager.get_database_backend(),
                sea_orm::DatabaseBackend::MySql
            ) {
                return Err(DbErr::Custom(UNSUPPORTED.to_owned()));
            }
            for sql in [
                "DROP TABLE IF EXISTS studio_documents;",
                "DROP TABLE IF EXISTS studio_document_types;",
            ] {
                manager.get_connection().execute_unprepared(sql).await?;
            }
            Ok(())
        }
    }
}
