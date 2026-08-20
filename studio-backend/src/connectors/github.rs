//! GitHub driver (github.com and GitHub Enterprise Server).

use async_trait::async_trait;
use serde::Deserialize;

use super::driver::{
    ConnectionAuth, ConnectorCategory, ConnectorDriver, Contributor, DriverIdentity, RemoteRepo,
    RepoTree, TreeEntry,
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

#[cfg_attr(not(feature = "graph"), allow(dead_code))]
#[derive(Deserialize)]
struct GitHubTree {
    tree: Vec<GitHubTreeEntry>,
    /// GitHub caps a recursive tree at 100k entries / 7 MB and says so here.
    #[serde(default)]
    truncated: bool,
}

#[cfg_attr(not(feature = "graph"), allow(dead_code))]
#[derive(Deserialize)]
struct GitHubTreeEntry {
    path: String,
    /// `blob` | `tree` | `commit` (the last one is a submodule).
    #[serde(rename = "type")]
    kind: String,
}

#[cfg_attr(not(feature = "graph"), allow(dead_code))]
#[derive(Deserialize)]
struct GitHubContributor {
    login: String,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    contributions: u64,
}

#[cfg_attr(not(feature = "graph"), allow(dead_code))]
#[derive(Deserialize)]
struct GitHubRepoHead {
    default_branch: Option<String>,
}

/// Turn a non-2xx response into an error carrying a slice of the body.
///
/// GitHub explains refusals in the body — a missing scope on the token, a
/// repository that exists but is invisible to it — and a bare status code
/// sends people looking in the wrong place.
#[cfg_attr(not(feature = "graph"), allow(dead_code))]
async fn ensure_ok(res: reqwest::Response) -> anyhow::Result<reqwest::Response> {
    let status = res.status();
    if status.is_success() {
        return Ok(res);
    }
    let body = res.text().await.unwrap_or_default();
    anyhow::bail!(
        "GitHub {status}: {}",
        body.chars().take(200).collect::<String>()
    )
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

    async fn repo_tree(
        &self,
        auth: &ConnectionAuth,
        full_path: &str,
        git_ref: Option<&str>,
    ) -> anyhow::Result<RepoTree> {
        // The tree API needs a concrete ref; "the default branch" is not one.
        let git_ref = match git_ref {
            Some(r) if !r.trim().is_empty() => r.trim().to_string(),
            _ => {
                let url = format!("{}/repos/{full_path}", auth.root());
                let res = ensure_ok(self.request(&url, auth).send().await?).await?;
                let head: GitHubRepoHead = res.json().await?;
                head.default_branch
                    .ok_or_else(|| anyhow::anyhow!("{full_path} has no default branch"))?
            }
        };

        let url = format!(
            "{}/repos/{full_path}/git/trees/{git_ref}?recursive=1",
            auth.root()
        );
        let res = ensure_ok(self.request(&url, auth).send().await?).await?;
        let tree: GitHubTree = res.json().await?;

        let entries = tree
            .tree
            .into_iter()
            // Submodules ("commit") are neither a file nor a directory of this
            // repository, and following one would need its own credential.
            .filter(|e| e.kind == "blob" || e.kind == "tree")
            .map(|e| TreeEntry {
                is_dir: e.kind == "tree",
                path: e.path,
            })
            .collect();

        Ok(RepoTree {
            git_ref,
            entries,
            truncated: tree.truncated,
        })
    }

    async fn contributors(
        &self,
        auth: &ConnectionAuth,
        full_path: &str,
        limit: u32,
    ) -> anyhow::Result<Vec<Contributor>> {
        let url = format!(
            "{}/repos/{full_path}/contributors?per_page={}",
            auth.root(),
            limit.clamp(1, 100)
        );
        let res = self.request(&url, auth).send().await?;
        // An empty repository answers 204 with no body, which is not an error.
        if res.status() == reqwest::StatusCode::NO_CONTENT {
            return Ok(Vec::new());
        }
        let res = ensure_ok(res).await?;
        let people: Vec<GitHubContributor> = res.json().await?;
        Ok(people
            .into_iter()
            .map(|c| Contributor {
                login: c.login,
                display_name: c.name,
                contributions: c.contributions,
            })
            .collect())
    }
}
