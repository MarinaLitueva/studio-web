//! REST surface for artifact ingest.
//!
//! `POST /studio-artifact-ingest/v1/sync` enqueues a background sync (issues,
//! pull requests and files) and returns a task id; `GET /tasks/{id}` polls it.

use std::sync::Arc;

use axum::extract::{Path, Query};
use axum::{Extension, Router};
use serde_json::Value;
use toolkit::api::canonical_prelude::*;
use toolkit::api::operation_builder::{CORE_GLOBAL_BASE_LICENSE_FEATURE, LicenseFeature};
use toolkit::api::{OpenApiRegistry, OperationBuilder};
use toolkit_canonical_errors::resource_error;
use toolkit_security::SecurityContext;

use super::service::IngestService;

/// Errors attributable to an artifact-ingest resource (e.g. an unknown task).
/// Five tokens in the segment (`vendor.package.namespace.type.vN`); `_` is the
/// empty namespace slot.
#[resource_error(gts_id!("cf.studio._.artifact_ingest.v1~"))]
pub struct StudioArtifactIngestError;

/// Service handle. `None` = the gear booted without any connector driver
/// linked; the route stays mounted and answers 503 with the reason.
#[derive(Clone)]
pub struct Ingest(pub Option<Arc<IngestService>>);

impl Ingest {
    fn get(&self) -> ApiResult<&Arc<IngestService>> {
        self.0.as_ref().ok_or_else(|| {
            CanonicalError::service_unavailable()
                .with_detail(
                    "artifact ingest is not available in this deployment \
                     (no connector driver plugin is registered)",
                )
                .create()
        })
    }
}

struct License;
impl AsRef<str> for License {
    fn as_ref(&self) -> &'static str {
        CORE_GLOBAL_BASE_LICENSE_FEATURE
    }
}
impl LicenseFeature for License {}

#[derive(Debug)]
#[toolkit_macros::api_dto(request)]
pub struct SyncRequest {
    /// Driver key: `github` (gitlab/bitbucket land as drivers implement them).
    pub provider: String,
    /// Installation root; omitted = the provider's default.
    #[serde(default)]
    pub base_url: Option<String>,
    /// credstore reference holding the connector token.
    pub secret_ref: String,
    /// Namespaced repository path, e.g. `org/repo`.
    pub repo_full_path: String,
    /// RFC 3339 lower bound for incremental sync (optional).
    #[serde(default)]
    pub since: Option<String>,
    /// Workspace tenant this repo belongs to (the parent of `project_id`).
    /// Tagged onto every stored node so a workspace-level graph can show every
    /// project's artifacts. Omitted = not scoped to a workspace.
    #[serde(default)]
    pub workspace_id: Option<String>,
    /// Project tenant this repo belongs to. Tagged onto every stored node so a
    /// project-level graph shows only its own artifacts, and used (in
    /// preference to `workspace_id`) to locate the IDE's shared checkout —
    /// `{workspaces_root}/{project_id}/{repo_dir}` — so ingest reads the same
    /// clone the IDE opened instead of cloning its own. Omitted = fall back to
    /// `workspace_id`, then own-clone / tree API.
    #[serde(default)]
    pub project_id: Option<String>,
    /// Directory name of this repo under the checkout root (the source's
    /// `target`, or its `name`). Pairs with `project_id`/`workspace_id`.
    #[serde(default)]
    pub repo_dir: Option<String>,
}

/// Acknowledgement that a sync was accepted and is running in the background.
#[derive(Debug)]
#[toolkit_macros::api_dto(response)]
pub struct SyncEnqueued {
    /// Poll `GET /studio-artifact-ingest/v1/tasks/{task_id}` for the outcome.
    pub task_id: String,
    /// `queued` at enqueue time.
    pub status: String,
}

/// The state of a background sync task.
#[derive(Debug)]
#[toolkit_macros::api_dto(response)]
pub struct TaskStatusResponse {
    pub task_id: String,
    /// `queued` | `running` | `succeeded` | `failed`.
    pub status: String,
    pub repo_full_path: String,
    /// Current phase while running, or the error message on failure.
    pub message: Option<String>,
    /// Live counts, updated per phase while running (not only on success) so the
    /// portal can show progress as objects are pulled and stored.
    pub issues: u32,
    pub pull_requests: u32,
    pub files: u32,
    pub comments: u32,
    pub commits: u32,
    /// Nodes already flushed to the graph store so far — the objects that are
    /// queryable right now, mid-sync.
    pub stored: u32,
}

#[derive(Debug, serde::Deserialize)]
pub struct NodesQuery {
    /// Type substring to filter by: `issue`, `pull_request` or `repo`.
    /// Omitted = every ingested node.
    #[serde(default)]
    pub r#type: Option<String>,
    /// Tenant scope: keep only nodes whose `workspace_id` OR `project_id`
    /// equals this. Pass a workspace tenant to see every project under it, or a
    /// project tenant to see just that project. Omitted = no scoping.
    #[serde(default)]
    pub scope: Option<String>,
}

#[derive(Debug, serde::Deserialize)]
pub struct EdgesQuery {
    /// Tenant scope (see [`NodesQuery::scope`]): keep only edges whose both
    /// endpoints are in-scope nodes. Omitted = every relation.
    #[serde(default)]
    pub scope: Option<String>,
}

/// True when a node's `value` is inside `scope` — i.e. its `workspace_id` or
/// its `project_id` equals `scope`. Used to keep a project's (or workspace's)
/// graph to its own artifacts. A `None` scope admits everything.
fn node_in_scope(value: &Value, scope: Option<&str>) -> bool {
    let Some(scope) = scope else {
        return true;
    };
    let obj = match value.as_object() {
        Some(o) => o,
        None => return false,
    };
    let matches = |key: &str| obj.get(key).and_then(Value::as_str) == Some(scope);
    matches("workspace_id") || matches("project_id")
}

/// One ingested artifact node.
#[derive(Debug)]
#[toolkit_macros::api_dto(response)]
pub struct ArtifactNodeDto {
    /// GTS type id, e.g. `gts.cf.studio.artifact.issue.v1~`.
    pub type_id: String,
    /// Deterministic instance id (uuid5 of a stable key).
    pub instance_id: String,
    /// The normalized artifact payload.
    #[schema(value_type = Object)]
    pub value: Value,
}

#[derive(Debug)]
#[toolkit_macros::api_dto(response)]
pub struct ArtifactNodeListResponse {
    pub nodes: Vec<ArtifactNodeDto>,
}

/// One relation between two artifact nodes, endpoints addressed by instance id.
#[derive(Debug)]
#[toolkit_macros::api_dto(response)]
pub struct ArtifactEdgeDto {
    /// GTS relation type id, e.g. `gts.cf.studio.rel.modifies.v1~`.
    pub type_id: String,
    /// Instance id of the source node.
    pub from: String,
    /// Instance id of the target node.
    pub to: String,
}

#[derive(Debug)]
#[toolkit_macros::api_dto(response)]
pub struct ArtifactEdgeListResponse {
    pub edges: Vec<ArtifactEdgeDto>,
}

#[derive(Debug, serde::Deserialize)]
pub struct RepoFilesQuery {
    /// Workspace the repo belongs to.
    pub workspace_id: String,
    /// The repo's directory under the workspace root (its `target`/`name`).
    pub repo_dir: String,
}

/// One text file from the repository checkout.
#[derive(Debug)]
#[toolkit_macros::api_dto(response)]
pub struct RepoFileDto {
    pub path: String,
    pub text: String,
}

#[derive(Debug)]
#[toolkit_macros::api_dto(response)]
pub struct RepoFilesResponse {
    pub files: Vec<RepoFileDto>,
}

/// One spec-quality finding to persist (portal-parsed from a detector result).
#[derive(Debug)]
#[toolkit_macros::api_dto(request)]
pub struct QualityFindingDto {
    /// `bloat` | `traceability` | `leak` | `purpose`.
    pub detector: String,
    /// Instance id of the document node the finding is about.
    pub subject: String,
    /// Document path/name, for display.
    #[serde(default)]
    pub path: Option<String>,
    /// Verdict/severity label (detector-specific).
    #[serde(default)]
    pub severity: Option<String>,
    /// One-line human summary of the finding.
    #[serde(default)]
    pub summary: Option<String>,
    /// Optional numeric score (e.g. duplication ratio).
    #[serde(default)]
    pub score: Option<f64>,
    /// The raw detector detail object, stored verbatim.
    #[serde(default)]
    #[schema(value_type = Object)]
    pub details: Value,
}

/// A derived relation between two document nodes (endpoints by instance id).
#[derive(Debug)]
#[toolkit_macros::api_dto(request)]
pub struct QualityLinkDto {
    pub from: String,
    pub to: String,
}

/// Batch of spec-quality results to materialize into the graph.
#[derive(Debug)]
#[toolkit_macros::api_dto(request)]
pub struct QualityFindingsRequest {
    #[serde(default)]
    pub findings: Vec<QualityFindingDto>,
    /// Bloat near-duplicate pairs → `duplicates` edges.
    #[serde(default)]
    pub duplicates: Vec<QualityLinkDto>,
    /// Traceability links → `traces_to` edges.
    #[serde(default)]
    pub traces: Vec<QualityLinkDto>,
    /// Workspace tenant these findings belong to — tagged onto each finding
    /// node so it survives a workspace-level graph scope (see the `scope` param
    /// on `/nodes`). Omitted = the findings are unscoped.
    #[serde(default)]
    pub workspace_id: Option<String>,
    /// Project tenant these findings belong to — tagged onto each finding node
    /// so it survives a project-level graph scope. Omitted = workspace-only.
    #[serde(default)]
    pub project_id: Option<String>,
}

/// Count of graph objects upserted.
#[derive(Debug)]
#[toolkit_macros::api_dto(response)]
pub struct QualityFindingsResponse {
    pub nodes: u32,
    pub edges: u32,
}

/// A search over the artifact graph. Semantic (hybrid) when an embedder is
/// wired, lexical otherwise — the request shape is the same either way.
#[derive(Debug)]
#[toolkit_macros::api_dto(request)]
pub struct SearchRequest {
    /// Free-text query.
    pub text: String,
    /// Maximum matches (default 20, capped at 200).
    #[serde(default)]
    pub limit: Option<u32>,
}

/// A manually-added file to store in the graph as a `file` node (no connector).
#[derive(Debug)]
#[toolkit_macros::api_dto(request)]
pub struct ManualFileRequest {
    /// Workspace tenant this file belongs to (the parent of `project_id`).
    /// Tagged onto the node so a workspace-level graph shows it. Also keys the
    /// node's identity, so re-uploading the same name upserts.
    pub workspace_id: String,
    /// Project tenant this file belongs to. Tagged onto the node so a
    /// project-level graph shows only its own files. Omitted = workspace-only.
    #[serde(default)]
    pub project_id: Option<String>,
    /// File name or relative path.
    pub path: String,
    /// Text content (for text files). Omit for binary — only metadata is kept.
    #[serde(default)]
    pub text: Option<String>,
    /// Size in bytes (defaults to the text length when omitted).
    #[serde(default)]
    pub size: Option<u64>,
}

/// The stored file node's id.
#[derive(Debug)]
#[toolkit_macros::api_dto(response)]
pub struct ManualFileResponse {
    pub instance_id: String,
}

async fn sync(
    Extension(ctx): Extension<SecurityContext>,
    Extension(ingest): Extension<Ingest>,
    Json(req): Json<SyncRequest>,
) -> ApiResult<JsonBody<SyncEnqueued>> {
    let svc = ingest.get()?;
    // Resolve the token now, while we still have the request's security context;
    // the background job carries only the resolved token.
    let secret_ref = req.secret_ref.trim().to_string();
    let token = svc
        .resolve_token(&ctx, &secret_ref)
        .await
        .map_err(|e| CanonicalError::internal(format!("{e:#}")).create())?;
    let task_id = svc.enqueue_sync(
        ctx,
        req.provider.trim().to_string(),
        req.base_url
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string),
        secret_ref,
        req.repo_full_path.trim().to_string(),
        req.since
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string),
        token,
        req.workspace_id
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string),
        req.project_id
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string),
        req.repo_dir
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string),
    );
    Ok(Json(SyncEnqueued {
        task_id,
        status: "queued".to_string(),
    }))
}

async fn task_status(
    Extension(_ctx): Extension<SecurityContext>,
    Extension(ingest): Extension<Ingest>,
    Path(id): Path<String>,
) -> ApiResult<JsonBody<TaskStatusResponse>> {
    let svc = ingest.get()?;
    let rec = svc.task(&id).ok_or_else(|| {
        StudioArtifactIngestError::not_found("no such sync task")
            .with_resource(id.clone())
            .create()
    })?;
    Ok(Json(TaskStatusResponse {
        task_id: rec.id,
        status: rec.status.as_str().to_string(),
        repo_full_path: rec.repo_full_path,
        message: rec.message,
        issues: rec.issues,
        pull_requests: rec.pull_requests,
        files: rec.files,
        comments: rec.comments,
        commits: rec.commits,
        stored: rec.stored,
    }))
}

async fn list_nodes(
    Extension(ctx): Extension<SecurityContext>,
    Extension(ingest): Extension<Ingest>,
    Query(q): Query<NodesQuery>,
) -> ApiResult<JsonBody<ArtifactNodeListResponse>> {
    let svc = ingest.get()?;
    let filter = q.r#type.as_deref().map(str::trim).filter(|s| !s.is_empty());
    let scope = q.scope.as_deref().map(str::trim).filter(|s| !s.is_empty());
    let nodes = svc
        .list_nodes(&ctx, filter)
        .await
        .map_err(|e| CanonicalError::internal(format!("{e:#}")).create())?;
    Ok(Json(ArtifactNodeListResponse {
        nodes: nodes
            .into_iter()
            .filter(|n| node_in_scope(&n.value, scope))
            .map(|n| {
                // File nodes carry full text content; drop it from the listing
                // so the payload stays small (`has_text` still flags it). A
                // dedicated content endpoint can serve the body when needed.
                let mut value = n.value;
                if let Some(obj) = value.as_object_mut() {
                    obj.remove("text");
                }
                ArtifactNodeDto {
                    type_id: n.type_id.to_string(),
                    instance_id: n.instance_id,
                    value,
                }
            })
            .collect(),
    }))
}

async fn list_edges(
    Extension(ctx): Extension<SecurityContext>,
    Extension(ingest): Extension<Ingest>,
    Query(q): Query<EdgesQuery>,
) -> ApiResult<JsonBody<ArtifactEdgeListResponse>> {
    let svc = ingest.get()?;
    let scope = q.scope.as_deref().map(str::trim).filter(|s| !s.is_empty());
    // When scoped, an edge is kept only if BOTH endpoints are in-scope nodes.
    // Build that id set from the (scope-filtered) node list first; endpoints
    // reference nodes by instance id.
    let in_scope: Option<std::collections::HashSet<String>> = if scope.is_some() {
        let nodes = svc
            .list_nodes(&ctx, None)
            .await
            .map_err(|e| CanonicalError::internal(format!("{e:#}")).create())?;
        Some(
            nodes
                .into_iter()
                .filter(|n| node_in_scope(&n.value, scope))
                .map(|n| n.instance_id)
                .collect(),
        )
    } else {
        None
    };
    let edges = svc
        .list_relations(&ctx)
        .await
        .map_err(|e| CanonicalError::internal(format!("{e:#}")).create())?;
    Ok(Json(ArtifactEdgeListResponse {
        edges: edges
            .into_iter()
            .filter(|e| {
                in_scope
                    .as_ref()
                    .map(|set| set.contains(&e.from) && set.contains(&e.to))
                    .unwrap_or(true)
            })
            .map(|e| ArtifactEdgeDto {
                type_id: e.type_id,
                from: e.from,
                to: e.to,
            })
            .collect(),
    }))
}

async fn repo_files(
    Extension(_ctx): Extension<SecurityContext>,
    Extension(ingest): Extension<Ingest>,
    Query(q): Query<RepoFilesQuery>,
) -> ApiResult<JsonBody<RepoFilesResponse>> {
    let svc = ingest.get()?;
    let files = svc
        .read_repo_files(q.workspace_id.trim(), q.repo_dir.trim())
        .await
        .map_err(|e| CanonicalError::internal(format!("{e:#}")).create())?;
    Ok(Json(RepoFilesResponse {
        files: files
            .into_iter()
            .map(|(path, text)| RepoFileDto { path, text })
            .collect(),
    }))
}

async fn save_quality(
    Extension(ctx): Extension<SecurityContext>,
    Extension(ingest): Extension<Ingest>,
    Json(req): Json<QualityFindingsRequest>,
) -> ApiResult<JsonBody<QualityFindingsResponse>> {
    let svc = ingest.get()?;
    let findings: Vec<super::service::QualityFinding> = req
        .findings
        .into_iter()
        .map(|f| super::service::QualityFinding {
            detector: f.detector,
            subject: f.subject,
            path: f.path,
            severity: f.severity,
            summary: f.summary,
            score: f.score,
            details: f.details,
        })
        .collect();
    let to_link = |l: QualityLinkDto| super::service::QualityLink {
        from: l.from,
        to: l.to,
    };
    let duplicates: Vec<super::service::QualityLink> =
        req.duplicates.into_iter().map(to_link).collect();
    let traces: Vec<super::service::QualityLink> = req.traces.into_iter().map(to_link).collect();
    let workspace_id = req
        .workspace_id
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string);
    let project_id = req
        .project_id
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string);

    let (nodes, edges) = svc
        .upsert_quality(
            &ctx,
            &findings,
            &duplicates,
            &traces,
            workspace_id.as_deref(),
            project_id.as_deref(),
        )
        .await
        .map_err(|e| CanonicalError::internal(format!("{e:#}")).create())?;
    Ok(Json(QualityFindingsResponse {
        nodes: nodes as u32,
        edges: edges as u32,
    }))
}

async fn search(
    Extension(ctx): Extension<SecurityContext>,
    Extension(ingest): Extension<Ingest>,
    Json(req): Json<SearchRequest>,
) -> ApiResult<JsonBody<ArtifactNodeListResponse>> {
    let svc = ingest.get()?;
    let limit = req.limit.unwrap_or(20).clamp(1, 200);
    let nodes = svc
        .search(&ctx, req.text.trim(), limit)
        .await
        .map_err(|e| CanonicalError::internal(format!("{e:#}")).create())?;
    Ok(Json(ArtifactNodeListResponse {
        nodes: nodes
            .into_iter()
            .map(|n| {
                let mut value = n.value;
                if let Some(obj) = value.as_object_mut() {
                    obj.remove("text");
                }
                ArtifactNodeDto {
                    type_id: n.type_id.to_string(),
                    instance_id: n.instance_id,
                    value,
                }
            })
            .collect(),
    }))
}

async fn add_file(
    Extension(ctx): Extension<SecurityContext>,
    Extension(ingest): Extension<Ingest>,
    Json(req): Json<ManualFileRequest>,
) -> ApiResult<JsonBody<ManualFileResponse>> {
    let svc = ingest.get()?;
    let workspace_id = req.workspace_id.trim().to_string();
    let project_id = req
        .project_id
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string);
    let path = req.path.trim().to_string();
    if workspace_id.is_empty() || path.is_empty() {
        return Err(CanonicalError::internal("workspace_id and path are required").create());
    }
    let size = req
        .size
        .unwrap_or_else(|| req.text.as_ref().map(|t| t.len() as u64).unwrap_or(0));
    let instance_id = svc
        .upsert_manual_file(
            &ctx,
            &workspace_id,
            project_id.as_deref(),
            &path,
            size,
            req.text,
        )
        .await
        .map_err(|e| CanonicalError::internal(format!("{e:#}")).create())?;
    Ok(Json(ManualFileResponse { instance_id }))
}

pub fn register_routes(
    router: Router,
    openapi: &dyn OpenApiRegistry,
    service: Option<Arc<IngestService>>,
) -> Router {
    let router = OperationBuilder::post("/studio-artifact-ingest/v1/sync")
        .operation_id("studio_artifact_ingest.sync")
        .summary("Enqueue a background sync of a connector source into the graph")
        .description(
            "Resolves the connector driver and token, then runs a background \
             sync: issues and pull requests from the API, and files from a \
             shallow git clone (or the tree API when no volume is mounted). \
             Returns a task id to poll.",
        )
        .tag("StudioArtifactIngest")
        .authenticated()
        .require_license_features::<License>([])
        .json_request::<SyncRequest>(openapi, "Source to ingest")
        .handler(sync)
        .json_response_with_schema::<SyncEnqueued>(openapi, StatusCode::OK, "Sync enqueued")
        .error_400(openapi)
        .error_401(openapi)
        .error_500(openapi)
        .register(router, openapi);

    let router = OperationBuilder::get("/studio-artifact-ingest/v1/tasks/{id}")
        .operation_id("studio_artifact_ingest.task_status")
        .summary("Poll a background sync task")
        .description("Returns the status of a sync task and, once succeeded, its counts.")
        .tag("StudioArtifactIngest")
        .authenticated()
        .require_license_features::<License>([])
        .path_param("id", "Sync task id")
        .handler(task_status)
        .json_response_with_schema::<TaskStatusResponse>(openapi, StatusCode::OK, "Task status")
        .error_401(openapi)
        .error_404(openapi)
        .error_500(openapi)
        .register(router, openapi);

    let router = OperationBuilder::get("/studio-artifact-ingest/v1/nodes")
        .operation_id("studio_artifact_ingest.list_nodes")
        .summary("List ingested artifact nodes")
        .description(
            "Reads back the artifact nodes upserted by /sync, optionally \
             filtered to a type (issue, pull_request, repo).",
        )
        .tag("StudioArtifactIngest")
        .authenticated()
        .require_license_features::<License>([])
        .handler(list_nodes)
        .json_response_with_schema::<ArtifactNodeListResponse>(
            openapi,
            StatusCode::OK,
            "Ingested nodes",
        )
        .error_401(openapi)
        .error_500(openapi)
        .register(router, openapi);

    let router = OperationBuilder::get("/studio-artifact-ingest/v1/edges")
        .operation_id("studio_artifact_ingest.list_edges")
        .summary("List relations between ingested artifact nodes")
        .description(
            "Reads back the relations upserted by /sync — authored_by, modifies, \
             artifact_of, contains — as endpoint instance-id pairs, so the portal \
             can draw links between the nodes it already holds.",
        )
        .tag("StudioArtifactIngest")
        .authenticated()
        .require_license_features::<License>([])
        .handler(list_edges)
        .json_response_with_schema::<ArtifactEdgeListResponse>(
            openapi,
            StatusCode::OK,
            "Ingested relations",
        )
        .error_401(openapi)
        .error_500(openapi)
        .register(router, openapi);

    let router = OperationBuilder::get("/studio-artifact-ingest/v1/repo-files")
        .operation_id("studio_artifact_ingest.repo_files")
        .summary("Text files from a repository checkout")
        .description(
            "Returns the text files (path and content) of the studio-session \
             checkout for one repository, so analysis can run over the actual \
             repo. Empty until the IDE has cloned it.",
        )
        .tag("StudioArtifactIngest")
        .authenticated()
        .require_license_features::<License>([])
        .handler(repo_files)
        .json_response_with_schema::<RepoFilesResponse>(openapi, StatusCode::OK, "Repository files")
        .error_401(openapi)
        .error_500(openapi)
        .register(router, openapi);

    let router = OperationBuilder::post("/studio-artifact-ingest/v1/quality")
        .operation_id("studio_artifact_ingest.save_quality")
        .summary("Persist spec-quality detector results into the artifact graph")
        .description(
            "Upserts, per document, a spec_finding node (bloat/traceability/leak/\
             purpose) with its finding_on edge, plus the derived document↔document \
             relations (duplicates, traces_to) the portal built from a detector \
             result. Idempotent by (detector, document).",
        )
        .tag("StudioArtifactIngest")
        .authenticated()
        .require_license_features::<License>([])
        .json_request::<QualityFindingsRequest>(openapi, "Findings and derived links")
        .handler(save_quality)
        .json_response_with_schema::<QualityFindingsResponse>(
            openapi,
            StatusCode::OK,
            "Upsert counts",
        )
        .error_400(openapi)
        .error_401(openapi)
        .error_500(openapi)
        .register(router, openapi);

    let router = OperationBuilder::post("/studio-artifact-ingest/v1/search")
        .operation_id("studio_artifact_ingest.search")
        .summary("Search the artifact graph (semantic when embeddings exist, else lexical)")
        .description(
            "Ranks artifact nodes against a free-text query. With node embeddings \
             present the store runs hybrid retrieval (vector similarity seeds a \
             graph walk, filtered by text); without them it falls back to a \
             lexical full-text match. The request shape is identical either way.",
        )
        .tag("StudioArtifactIngest")
        .authenticated()
        .require_license_features::<License>([])
        .json_request::<SearchRequest>(openapi, "Query text and limit")
        .handler(search)
        .json_response_with_schema::<ArtifactNodeListResponse>(
            openapi,
            StatusCode::OK,
            "Ranked matches, most relevant first",
        )
        .error_400(openapi)
        .error_401(openapi)
        .error_500(openapi)
        .register(router, openapi);

    let router = OperationBuilder::post("/studio-artifact-ingest/v1/files")
        .operation_id("studio_artifact_ingest.add_file")
        .summary("Add a manually-uploaded file to the artifact graph")
        .description(
            "Stores a hand-added file as a `file` node (origin=manual) in the \
             graph, scoped to a workspace — no connector or file-storage \
             data-plane needed. Text content is kept for text files; binary \
             uploads keep only metadata. Idempotent by (workspace, path).",
        )
        .tag("StudioArtifactIngest")
        .authenticated()
        .require_license_features::<License>([])
        .json_request::<ManualFileRequest>(openapi, "File to store")
        .handler(add_file)
        .json_response_with_schema::<ManualFileResponse>(openapi, StatusCode::OK, "Stored file id")
        .error_400(openapi)
        .error_401(openapi)
        .error_500(openapi)
        .register(router, openapi);

    router.layer(Extension(Ingest(service)))
}
