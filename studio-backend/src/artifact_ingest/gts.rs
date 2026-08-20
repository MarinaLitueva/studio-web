//! GTS identifiers, type schemas and instance normalization for artifacts.
//!
//! Type ids and the free-form registration documents live here; the full
//! property schemas are in `studio-backend/gts/artifact/*.schema.json` (the
//! graph-store contract). Instance ids are deterministic (uuid5 of a stable
//! key) so re-syncing the same entity upserts rather than duplicates.

use serde_json::{json, Value};
use uuid::Uuid;

use super::graph::GtsNode;
use crate::connectors::driver::{RemoteFile, RemoteIssue, RemotePullRequest};

/// Fixed namespace for uuid5 instance ids (studio artifact graph).
const INSTANCE_NS: Uuid = Uuid::from_u128(0xcf57_0000_0000_4000_8000_0000_0000_0001);

pub const REPO_TYPE: &str = "gts.cf.studio.artifact.repo.v1~";
pub const ISSUE_TYPE: &str = "gts.cf.studio.artifact.issue.v1~";
pub const PULL_REQUEST_TYPE: &str = "gts.cf.studio.artifact.pull_request.v1~";
pub const FILE_TYPE: &str = "gts.cf.studio.artifact.file.v1~";

/// Every artifact node type, for registering and enumerating.
pub const ALL_NODE_TYPES: [&str; 4] = [REPO_TYPE, ISSUE_TYPE, PULL_REQUEST_TYPE, FILE_TYPE];

/// The type id the graph-storage gear stores this artifact type under. The gear
/// keeps its own type table and its ids omit the `gts.` scheme token (its own
/// examples are `cf.studio.kg.file.v1~`), so we strip it.
pub fn graph_type_id(our_type: &str) -> String {
    our_type
        .strip_prefix("gts.")
        .unwrap_or(our_type)
        .to_string()
}

/// Reverse of [`graph_type_id`]: map a graph-storage type id back to our
/// `&'static` constant so a node read back becomes a [`GtsNode`].
pub fn our_type_from_graph(graph_type: &str) -> Option<&'static str> {
    ALL_NODE_TYPES
        .into_iter()
        .find(|t| graph_type_id(t) == graph_type)
}

/// GTS Type Schemas registered at gear init. Declared free-form (`type:
/// object`) — the same shape the studio types use in `config/*.yaml` — so
/// registration never trips the closed-envelope narrowing check; the full
/// property schemas live alongside as JSON files and are the graph contract.
pub fn type_schemas() -> Vec<Value> {
    [
        (
            REPO_TYPE,
            "Repository",
            "A source repository ingested from a connector.",
        ),
        (
            ISSUE_TYPE,
            "Issue",
            "An issue pulled from the connector API.",
        ),
        (
            PULL_REQUEST_TYPE,
            "PullRequest",
            "A pull/merge request pulled from the connector API.",
        ),
        (
            FILE_TYPE,
            "File",
            "A file in the repository tree pulled from the connector API.",
        ),
    ]
    .into_iter()
    .map(|(id, title, description)| {
        json!({
            "$id": format!("gts://{id}"),
            "$schema": "http://json-schema.org/draft-07/schema#",
            "title": title,
            "description": description,
            "type": "object",
        })
    })
    .collect()
}

/// Deterministic instance id from a stable composite key.
fn anon_id(parts: &[&str]) -> String {
    Uuid::new_v5(&INSTANCE_NS, parts.join("|").as_bytes()).to_string()
}

/// The repository node; `connector_id` keys the graph so two connections to
/// the same host stay distinct.
pub fn repo_node(connector_id: &str, provider: &str, repo_full_path: &str) -> GtsNode {
    GtsNode {
        type_id: REPO_TYPE,
        instance_id: anon_id(&[connector_id, repo_full_path, "repo"]),
        value: json!({
            "connector_id": connector_id,
            "provider": provider,
            "full_path": repo_full_path,
        }),
    }
}

pub fn issue_node(
    repo_id: &str,
    connector_id: &str,
    repo_full_path: &str,
    i: RemoteIssue,
) -> GtsNode {
    GtsNode {
        type_id: ISSUE_TYPE,
        instance_id: anon_id(&[connector_id, repo_full_path, "issue", &i.id]),
        value: json!({
            "repo": repo_id,
            "external_id": i.id,
            "number": i.number,
            "title": i.title,
            "state": i.state,
            "author": i.author,
            "body": i.body,
            "url": i.url,
            "labels": i.labels,
            "created_at": i.created_at,
            "updated_at": i.updated_at,
        }),
    }
}

pub fn file_node(
    repo_id: &str,
    connector_id: &str,
    repo_full_path: &str,
    f: RemoteFile,
) -> GtsNode {
    GtsNode {
        type_id: FILE_TYPE,
        instance_id: anon_id(&[connector_id, repo_full_path, "file", &f.path]),
        value: json!({
            "repo": repo_id,
            "path": f.path,
            "sha": f.sha,
            "is_dir": f.is_dir,
            "size": f.size,
        }),
    }
}

/// A File node built from a real checkout on disk: same identity as the
/// tree-API node (keyed on path, so the two channels upsert the same instance),
/// but carrying the snapshot `commit` and, for text files, their `text`.
pub fn file_node_cloned(
    repo_id: &str,
    connector_id: &str,
    repo_full_path: &str,
    path: &str,
    size: u64,
    text: Option<String>,
    commit: Option<&str>,
) -> GtsNode {
    GtsNode {
        type_id: FILE_TYPE,
        instance_id: anon_id(&[connector_id, repo_full_path, "file", path]),
        value: json!({
            "repo": repo_id,
            "path": path,
            "is_dir": false,
            "size": size,
            "commit": commit,
            "has_text": text.is_some(),
            "text": text,
        }),
    }
}

pub fn pull_request_node(
    repo_id: &str,
    connector_id: &str,
    repo_full_path: &str,
    p: RemotePullRequest,
) -> GtsNode {
    GtsNode {
        type_id: PULL_REQUEST_TYPE,
        instance_id: anon_id(&[connector_id, repo_full_path, "pull_request", &p.id]),
        value: json!({
            "repo": repo_id,
            "external_id": p.id,
            "number": p.number,
            "title": p.title,
            "state": p.state,
            "author": p.author,
            "body": p.body,
            "url": p.url,
            "source_branch": p.source_branch,
            "target_branch": p.target_branch,
            "merged": p.merged,
            "created_at": p.created_at,
            "updated_at": p.updated_at,
        }),
    }
}
