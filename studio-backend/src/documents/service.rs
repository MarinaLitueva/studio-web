//! studio-documents service: built-in ∪ workspace-defined types, create from
//! template, effective (inherited) document lists, structural validation, and
//! CRUD. Bridges the domain model to the sea-orm rows the repo persists.

use std::collections::BTreeMap;
use std::sync::Arc;

use account_management_sdk::AccountManagementClient;
use anyhow::{bail, Context, Result};
use time::format_description::well_known::Rfc3339;
use time::OffsetDateTime;
use toolkit_security::SecurityContext;
use uuid::Uuid;

use super::entity::{doc_type, document};
use super::model::{
    builtin_types, type_gts_id, DocStatus, Document, DocumentType, Owner, TemplateSpec,
};
use super::repo::{type_row_id, DocScope, DocumentsRepo};
use super::validate::{validate, ValidationReport};

pub struct DocumentsService {
    repo: Arc<DocumentsRepo>,
    account_management: Arc<dyn AccountManagementClient>,
}

impl DocumentsService {
    pub fn new(
        repo: Arc<DocumentsRepo>,
        account_management: Arc<dyn AccountManagementClient>,
    ) -> Self {
        Self {
            repo,
            account_management,
        }
    }

    /// Authorize the caller against a tenant from the request path. Resolving
    /// the tenant under the caller's `SecurityContext` both proves it exists and
    /// delegates hierarchy authorization to account-management — the same guard
    /// `studio-kits` puts in front of its project routes. Callers must run this
    /// before touching a workspace or project's documents.
    pub async fn authorize(&self, ctx: &SecurityContext, tenant_id: Uuid) -> Result<()> {
        self.account_management
            .get_tenant(ctx, tenant_id)
            .await
            .map_err(|e| anyhow::anyhow!("tenant {tenant_id} not accessible: {e}"))?;
        Ok(())
    }

    // ── types ────────────────────────────────────────────────────────────────

    /// Effective types for a workspace: the platform catalogue, overlaid by any
    /// workspace-defined type of the same key.
    pub async fn list_types(&self, workspace_id: Uuid) -> Result<Vec<DocumentType>> {
        let mut by_key: BTreeMap<String, DocumentType> = builtin_types()
            .into_iter()
            .map(|t| (t.key.clone(), t))
            .collect();
        for row in self.repo.list_types(workspace_id).await? {
            let t = type_from_row(row)?;
            by_key.insert(t.key.clone(), t);
        }
        Ok(by_key.into_values().collect())
    }

    pub async fn get_type(&self, workspace_id: Uuid, key: &str) -> Result<Option<DocumentType>> {
        Ok(self
            .list_types(workspace_id)
            .await?
            .into_iter()
            .find(|t| t.key == key))
    }

    /// Define or replace a workspace-owned type.
    pub async fn upsert_type(
        &self,
        workspace_id: Uuid,
        mut ty: DocumentType,
    ) -> Result<DocumentType> {
        ty.key = normalize_key(&ty.key)?;
        ty.owner = Owner::Workspace {
            tenant_id: workspace_id,
        };
        ty.gts_type_id = type_gts_id(&ty.key);
        let now = OffsetDateTime::now_utc();
        let model = doc_type::Model {
            id: type_row_id(workspace_id, &ty.key),
            tenant_id: workspace_id,
            key: ty.key.clone(),
            name: ty.name.clone(),
            description: ty.description.clone(),
            gts_type_id: ty.gts_type_id.clone(),
            template: serde_json::to_string(&ty.template)?,
            created_at: now,
            updated_at: now,
        };
        self.repo.upsert_type(model).await?;
        Ok(ty)
    }

    // ── documents ─────────────────────────────────────────────────────────────

    /// Create a document from a type. `project_id = None` makes it a
    /// workspace-level document inherited by every project.
    pub async fn create_document(
        &self,
        workspace_id: Uuid,
        project_id: Option<Uuid>,
        type_key: &str,
        title: &str,
        content: Option<String>,
        created_by: String,
    ) -> Result<Document> {
        let ty = self
            .get_type(workspace_id, type_key)
            .await?
            .context("unknown document type")?;
        let body = content.unwrap_or_else(|| ty.template.body.clone());
        let report = validate(&body, &ty.template);
        let now = OffsetDateTime::now_utc();
        let model = document::Model {
            id: Uuid::new_v4(),
            tenant_id: workspace_id,
            project_id,
            type_key: ty.key.clone(),
            title: title.trim().to_string(),
            content: body,
            status: DocStatus::Draft.rank() as i16,
            conforms: report.conforms,
            validation: serde_json::to_string(&report)?,
            created_by,
            created_at: now,
            updated_at: now,
        };
        self.repo.upsert_doc(model.clone()).await?;
        doc_from_row(model)
    }

    /// Effective documents. For a project: its own plus the workspace-level
    /// ones it inherits. For a workspace (`project_id = None`): the
    /// workspace-level ones only.
    pub async fn list_documents(
        &self,
        workspace_id: Uuid,
        project_id: Option<Uuid>,
    ) -> Result<Vec<Document>> {
        let scope = match project_id {
            Some(pid) => DocScope::Effective(pid),
            None => DocScope::WorkspaceLevel,
        };
        self.repo
            .list_docs(workspace_id, scope)
            .await?
            .into_iter()
            .map(doc_from_row)
            .collect()
    }

    pub async fn get_document(&self, workspace_id: Uuid, id: Uuid) -> Result<Option<Document>> {
        match self.repo.get_doc(workspace_id, id).await? {
            Some(row) => Ok(Some(doc_from_row(row)?)),
            None => Ok(None),
        }
    }

    pub async fn update_document(
        &self,
        workspace_id: Uuid,
        id: Uuid,
        title: Option<String>,
        content: Option<String>,
        status: Option<DocStatus>,
    ) -> Result<Document> {
        let mut row = self
            .repo
            .get_doc(workspace_id, id)
            .await?
            .context("no such document")?;
        if let Some(t) = title {
            row.title = t.trim().to_string();
        }
        if let Some(c) = content {
            row.content = c;
        }
        if let Some(next) = status {
            let current = status_from_i16(row.status);
            if !current.can_move_to(next) {
                bail!("status can only move forward");
            }
            row.status = next.rank() as i16;
        }
        // Re-validate against the (possibly workspace-overridden) type.
        let report = match self.get_type(workspace_id, &row.type_key).await? {
            Some(ty) => validate(&row.content, &ty.template),
            None => ValidationReport {
                conforms: false,
                sections: Vec::new(),
                issues: vec!["unknown document type".to_string()],
            },
        };
        row.conforms = report.conforms;
        row.validation = serde_json::to_string(&report)?;
        row.updated_at = OffsetDateTime::now_utc();
        self.repo.upsert_doc(row.clone()).await?;
        doc_from_row(row)
    }

    pub async fn validate_document(
        &self,
        workspace_id: Uuid,
        id: Uuid,
    ) -> Result<ValidationReport> {
        let row = self
            .repo
            .get_doc(workspace_id, id)
            .await?
            .context("no such document")?;
        let ty = self
            .get_type(workspace_id, &row.type_key)
            .await?
            .context("unknown document type")?;
        Ok(validate(&row.content, &ty.template))
    }

    pub async fn delete_document(&self, workspace_id: Uuid, id: Uuid) -> Result<bool> {
        self.repo.delete_doc(workspace_id, id).await
    }
}

// ── domain ↔ row mapping ────────────────────────────────────────────────────

fn type_from_row(row: doc_type::Model) -> Result<DocumentType> {
    let template: TemplateSpec =
        serde_json::from_str(&row.template).context("document type template is malformed")?;
    Ok(DocumentType {
        key: row.key,
        name: row.name,
        description: row.description,
        gts_type_id: row.gts_type_id,
        owner: Owner::Workspace {
            tenant_id: row.tenant_id,
        },
        template,
    })
}

fn doc_from_row(row: document::Model) -> Result<Document> {
    Ok(Document {
        id: row.id,
        tenant_id: row.tenant_id,
        project_id: row.project_id,
        type_key: row.type_key,
        title: row.title,
        content: row.content,
        status: status_from_i16(row.status),
        conforms: row.conforms,
        created_by: row.created_by,
        created_at: rfc3339(row.created_at),
        updated_at: rfc3339(row.updated_at),
    })
}

fn status_from_i16(value: i16) -> DocStatus {
    match value {
        1 => DocStatus::Review,
        2 => DocStatus::Approved,
        _ => DocStatus::Draft,
    }
}

fn rfc3339(t: OffsetDateTime) -> String {
    t.format(&Rfc3339).unwrap_or_default()
}

fn normalize_key(key: &str) -> Result<String> {
    let key = key.trim().to_ascii_lowercase();
    if key.is_empty()
        || key.len() > 80
        || !key
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'_' || b == b'-')
    {
        bail!("type key must be lowercase letters, digits, underscores or hyphens");
    }
    Ok(key)
}
