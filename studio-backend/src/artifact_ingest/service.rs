//! Ingest orchestration: connector API → normalized GTS nodes → graph store.
//!
//! The first cut pulls issues and pull requests (the two channels git clone
//! cannot give). The connection is passed explicitly (`provider`, `base_url`,
//! `secret_ref`) so the pipeline is testable on its own; resolving a
//! connection by id from the connector catalogue is a thin follow-up.

use std::collections::HashMap;
use std::sync::Arc;

use anyhow::anyhow;
use credstore_sdk::{CredStoreClientV1, SecretRef};
use toolkit_security::SecurityContext;

use super::graph::{GraphStore, GtsNode};
use super::gts;
use crate::connectors::driver::{ConnectionAuth, ConnectorDriver};

/// Hard cap on pages per channel — a runaway loop backstop, not a real limit.
const MAX_PAGES: u32 = 50;
const PER_PAGE: u32 = 100;

#[derive(Debug, Clone, Copy)]
pub struct SyncSummary {
    pub issues: usize,
    pub pull_requests: usize,
}

pub struct IngestService {
    credstore: Arc<dyn CredStoreClientV1>,
    /// provider key (`github`, …) → driver.
    drivers: HashMap<String, Arc<dyn ConnectorDriver>>,
    graph: Arc<dyn GraphStore>,
}

impl IngestService {
    pub fn new(
        credstore: Arc<dyn CredStoreClientV1>,
        drivers: HashMap<String, Arc<dyn ConnectorDriver>>,
        graph: Arc<dyn GraphStore>,
    ) -> Self {
        Self {
            credstore,
            drivers,
            graph,
        }
    }

    async fn token(&self, ctx: &SecurityContext, secret_ref: &str) -> anyhow::Result<String> {
        let key = SecretRef::new(secret_ref).map_err(|e| anyhow!("bad secret reference: {e}"))?;
        let secret = self
            .credstore
            .get(ctx, &key)
            .await
            .map_err(|e| anyhow!("credstore: {e}"))?
            .ok_or_else(|| {
                anyhow!("the token for '{secret_ref}' is not readable (wrong scope or removed)")
            })?;
        String::from_utf8(secret.value.as_bytes().to_vec())
            .map_err(|_| anyhow!("stored token is not valid UTF-8"))
    }

    /// Pull issues + PRs for one repository and upsert them into the graph.
    pub async fn sync(
        &self,
        ctx: &SecurityContext,
        provider: &str,
        base_url: Option<&str>,
        secret_ref: &str,
        repo_full_path: &str,
        since: Option<&str>,
    ) -> anyhow::Result<SyncSummary> {
        let driver = self
            .drivers
            .get(provider)
            .ok_or_else(|| anyhow!("no driver for provider '{provider}' (plugin not linked?)"))?;

        let base_url = match base_url.map(str::trim).filter(|s| !s.is_empty()) {
            Some(b) => b.to_string(),
            None => driver.default_base_url().to_string(),
        };
        let auth = ConnectionAuth {
            base_url,
            token: self.token(ctx, secret_ref).await?,
        };

        // Key the graph on the credstore ref for now — one connection, one repo.
        let connector_id = secret_ref;
        let mut nodes: Vec<GtsNode> = Vec::new();
        let repo = gts::repo_node(connector_id, provider, repo_full_path);
        let repo_id = repo.instance_id.clone();
        nodes.push(repo);

        let mut issues = 0usize;
        for page in 1..=MAX_PAGES {
            let batch = driver
                .list_issues(&auth, repo_full_path, since, page, PER_PAGE)
                .await?;
            if batch.is_empty() {
                break;
            }
            issues += batch.len();
            for i in batch {
                nodes.push(gts::issue_node(&repo_id, connector_id, repo_full_path, i));
            }
        }

        let mut pull_requests = 0usize;
        for page in 1..=MAX_PAGES {
            let batch = driver
                .list_pull_requests(&auth, repo_full_path, since, page, PER_PAGE)
                .await?;
            if batch.is_empty() {
                break;
            }
            pull_requests += batch.len();
            for p in batch {
                nodes.push(gts::pull_request_node(
                    &repo_id,
                    connector_id,
                    repo_full_path,
                    p,
                ));
            }
        }

        self.graph.upsert_nodes(&nodes).await?;
        Ok(SyncSummary {
            issues,
            pull_requests,
        })
    }
}
