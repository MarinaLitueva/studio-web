//! GitHub driver (github.com and GitHub Enterprise Server).

use async_trait::async_trait;
use serde::Deserialize;

use super::driver::{
    ConnectionAuth, ConnectorCategory, ConnectorDriver, DriverIdentity, RemoteIssue,
    RemotePullRequest, RemoteRepo,
};

pub struct GitHubDriver {
    http: reqwest::Client,
}

impl GitHubDriver {
    pub fn new(http: reqwest::Client) -> Self {
        Self { http }
    }

    /// GitHub rejects requests without a User-Agent, and pins the response
    /// shape to the Accept header.
    fn request(&self, url: &str, auth: &ConnectionAuth) -> reqwest::RequestBuilder {
        self.http
            .get(url)
            .header("Authorization", format!("Bearer {}", auth.token))
            .header("Accept", "application/vnd.github+json")
            .header("X-GitHub-Api-Version", "2022-11-28")
            .header("User-Agent", "constructor-studio")
    }
}

#[derive(Deserialize)]
struct GitHubUser {
    login: String,
    name: Option<String>,
}

#[derive(Deserialize)]
struct GitHubRepo {
    id: i64,
    name: String,
    full_name: String,
    clone_url: String,
    default_branch: Option<String>,
    description: Option<String>,
    private: bool,
}

#[derive(Deserialize)]
struct GitHubLabel {
    name: String,
}

/// `head`/`base` on a pull request carry the branch under `ref` — a Rust
/// keyword, so it is renamed on the way in.
#[derive(Deserialize)]
struct GitHubRef {
    #[serde(rename = "ref")]
    ref_name: String,
}

#[derive(Deserialize)]
struct GitHubIssue {
    id: i64,
    number: i64,
    title: String,
    state: String,
    #[serde(default)]
    user: Option<GitHubUser>,
    #[serde(default)]
    body: Option<String>,
    html_url: String,
    #[serde(default)]
    created_at: Option<String>,
    #[serde(default)]
    updated_at: Option<String>,
    #[serde(default)]
    labels: Vec<GitHubLabel>,
    /// Present only when this "issue" is actually a pull request — GitHub's
    /// `/issues` endpoint returns both, and we drop the PRs here.
    #[serde(default)]
    pull_request: Option<serde_json::Value>,
}

#[derive(Deserialize)]
struct GitHubPull {
    id: i64,
    number: i64,
    title: String,
    state: String,
    #[serde(default)]
    user: Option<GitHubUser>,
    #[serde(default)]
    body: Option<String>,
    html_url: String,
    #[serde(default)]
    head: Option<GitHubRef>,
    #[serde(default)]
    base: Option<GitHubRef>,
    #[serde(default)]
    merged_at: Option<String>,
    #[serde(default)]
    created_at: Option<String>,
    #[serde(default)]
    updated_at: Option<String>,
}

#[async_trait]
impl ConnectorDriver for GitHubDriver {
    fn provider(&self) -> &'static str {
        "github"
    }

    fn display_name(&self) -> &'static str {
        "GitHub"
    }

    fn default_base_url(&self) -> &'static str {
        "https://api.github.com"
    }

    fn category(&self) -> ConnectorCategory {
        ConnectorCategory::SourceCode
    }

    fn credential_hint(&self) -> &'static str {
        "ghp_…"
    }

    async fn test(&self, auth: &ConnectionAuth) -> anyhow::Result<DriverIdentity> {
        let url = format!("{}/user", auth.root());
        let res = self.request(&url, auth).send().await?;
        let status = res.status();
        if !status.is_success() {
            let body = res.text().await.unwrap_or_default();
            anyhow::bail!(
                "GitHub {status}: {}",
                body.chars().take(200).collect::<String>()
            );
        }
        let user: GitHubUser = res.json().await?;
        Ok(DriverIdentity {
            account: user.login,
            display_name: user.name,
        })
    }

    async fn list_repositories(
        &self,
        auth: &ConnectionAuth,
        search: Option<&str>,
        limit: u32,
    ) -> anyhow::Result<Vec<RemoteRepo>> {
        // /user/repos has no server-side search, so the filter is applied
        // locally over the most recently touched page.
        let url = format!(
            "{}/user/repos?sort=updated&per_page={}",
            auth.root(),
            limit.clamp(1, 100)
        );
        let res = self.request(&url, auth).send().await?;
        let status = res.status();
        if !status.is_success() {
            let body = res.text().await.unwrap_or_default();
            anyhow::bail!(
                "GitHub {status}: {}",
                body.chars().take(200).collect::<String>()
            );
        }
        let repos: Vec<GitHubRepo> = res.json().await?;
        let needle = search
            .map(|s| s.trim().to_lowercase())
            .filter(|s| !s.is_empty());
        Ok(repos
            .into_iter()
            .filter(|r| {
                needle
                    .as_ref()
                    .is_none_or(|n| r.full_name.to_lowercase().contains(n))
            })
            .map(|r| RemoteRepo {
                id: r.id.to_string(),
                name: r.name,
                full_path: r.full_name,
                clone_url: r.clone_url,
                default_branch: r.default_branch,
                description: r.description,
                visibility: Some(if r.private { "private" } else { "public" }.to_string()),
            })
            .collect())
    }

    async fn list_issues(
        &self,
        auth: &ConnectionAuth,
        repo_full_path: &str,
        since: Option<&str>,
        page: u32,
        per_page: u32,
    ) -> anyhow::Result<Vec<RemoteIssue>> {
        // /issues returns both issues and PRs; a PR carries a `pull_request`
        // object, which we drop so this endpoint means issues only.
        let mut url = format!(
            "{}/repos/{repo_full_path}/issues?state=all&sort=updated&direction=desc&per_page={}&page={}",
            auth.root(),
            per_page.clamp(1, 100),
            page.max(1),
        );
        if let Some(since) = since.map(str::trim).filter(|s| !s.is_empty()) {
            url.push_str("&since=");
            url.push_str(since);
        }
        let res = self.request(&url, auth).send().await?;
        let status = res.status();
        if !status.is_success() {
            let body = res.text().await.unwrap_or_default();
            anyhow::bail!(
                "GitHub {status}: {}",
                body.chars().take(200).collect::<String>()
            );
        }
        let issues: Vec<GitHubIssue> = res.json().await?;
        Ok(issues
            .into_iter()
            .filter(|i| i.pull_request.is_none())
            .map(|i| RemoteIssue {
                id: i.id.to_string(),
                number: i.number,
                title: i.title,
                state: i.state,
                author: i.user.map(|u| u.login),
                body: i.body,
                url: Some(i.html_url),
                created_at: i.created_at,
                updated_at: i.updated_at,
                labels: i.labels.into_iter().map(|l| l.name).collect(),
            })
            .collect())
    }

    async fn list_pull_requests(
        &self,
        auth: &ConnectionAuth,
        repo_full_path: &str,
        since: Option<&str>,
        page: u32,
        per_page: u32,
    ) -> anyhow::Result<Vec<RemotePullRequest>> {
        // /pulls has no `since` filter; we sort by most-recent activity and let
        // the caller stop once it walks past the incremental cursor.
        let _ = since;
        let url = format!(
            "{}/repos/{repo_full_path}/pulls?state=all&sort=updated&direction=desc&per_page={}&page={}",
            auth.root(),
            per_page.clamp(1, 100),
            page.max(1),
        );
        let res = self.request(&url, auth).send().await?;
        let status = res.status();
        if !status.is_success() {
            let body = res.text().await.unwrap_or_default();
            anyhow::bail!(
                "GitHub {status}: {}",
                body.chars().take(200).collect::<String>()
            );
        }
        let pulls: Vec<GitHubPull> = res.json().await?;
        Ok(pulls
            .into_iter()
            .map(|p| {
                let merged = p.merged_at.is_some();
                RemotePullRequest {
                    id: p.id.to_string(),
                    number: p.number,
                    title: p.title,
                    state: if merged {
                        "merged".to_string()
                    } else {
                        p.state
                    },
                    author: p.user.map(|u| u.login),
                    body: p.body,
                    url: Some(p.html_url),
                    source_branch: p.head.map(|r| r.ref_name),
                    target_branch: p.base.map(|r| r.ref_name),
                    merged,
                    created_at: p.created_at,
                    updated_at: p.updated_at,
                }
            })
            .collect())
    }
}
