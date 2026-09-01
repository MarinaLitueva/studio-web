use std::sync::Arc;

use account_management_sdk::{AccountManagementClient, UpsertMetadataRequest};
use anyhow::{Context, Result, bail};
use gts::GtsTypeId;
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
use toolkit::client_hub::ClientHub;
use toolkit_security::SecurityContext;
use uuid::Uuid;

pub const INSTALLATIONS_METADATA_TYPE: &str =
    "gts.cf.core.am.tenant_metadata.v1~cf.studio.project.kit_installations.v1~";

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct KitDescriptor {
    pub slug: String,
    pub name: String,
    pub description: String,
    pub publisher: String,
    pub visibility: String,
    pub source: String,
    pub repository_url: String,
    pub default_version: String,
    pub manifest_path: String,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct KitInstallation {
    pub kit_slug: String,
    pub version: String,
    pub source: String,
    pub repository_url: String,
    pub install_mode: String,
    /// Desired-state status of the most recent materialize attempt. Only a
    /// trusted `cfs` runner may advance this to `installed`; the registry API
    /// initially records `pending`.
    pub status: String,
    pub requested_by: String,
    pub requested_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub installed_at: Option<String>,
    /// One entry per repository this kit has been materialized into.
    ///
    /// A list rather than a field because a kit is installed into a PROJECT and
    /// materialized in repositories: the project can gain a repository after the
    /// kit was requested, and each target carries its own version and outcome.
    /// A single field could only ever hold the last one, which stops being true
    /// the moment a second repository is materialized.
    #[serde(default)]
    pub materializations: Vec<KitMaterialization>,
    /// Compatibility only. Documents written before `materializations` existed
    /// recorded one `repository_id`, overwritten on every materialize. It is the
    /// only record such a project has of where its kit landed, so it is read and
    /// promoted by [`upgrade_installation`] -- and never written again.
    #[serde(rename = "repository_id", default, skip_serializing)]
    pub legacy_repository_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub failure_reason: Option<String>,
}

/// One repository this kit has been materialized into.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct KitMaterialization {
    pub repository_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub repository_label: Option<String>,
    /// The version actually written into this repository. It can lag the
    /// installation's requested version when a bump has not reached every
    /// target yet -- which is precisely why this is per-repository.
    pub version: String,
    /// `installed` or `failed`, for this repository alone.
    pub status: String,
    pub materialized_at: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub failure_reason: Option<String>,
}

/// One repository the project's running IDE has mounted, as offered to a
/// caller choosing where to materialize a kit.
///
/// Not persisted: the repository set is discovered by the IDE from the
/// workspace on disk, so it is only knowable while a session runs. Storing it
/// would mean storing a snapshot that goes stale the moment a source is cloned.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct ProjectRepository {
    pub repository_id: String,
    pub label: String,
    /// `"project"` or `"source"` -- see the SDK's `RepositoryDescriptor::kind`.
    pub kind: String,
    pub git_mode: Option<String>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
struct InstallationDocument {
    #[serde(default)]
    installations: Vec<KitInstallation>,
}

pub struct KitRegistryService {
    account_management: Arc<dyn AccountManagementClient>,
    #[cfg(feature = "theia-bridge")]
    client_hub: Arc<ClientHub>,
}

impl KitRegistryService {
    pub fn new(
        account_management: Arc<dyn AccountManagementClient>,
        _client_hub: Arc<ClientHub>,
    ) -> Self {
        Self {
            account_management,
            #[cfg(feature = "theia-bridge")]
            client_hub: _client_hub,
        }
    }

    pub fn catalogue(&self) -> Vec<KitDescriptor> {
        official_catalogue()
    }

    pub async fn list_installations(
        &self,
        ctx: &SecurityContext,
        project_id: Uuid,
    ) -> Result<Vec<KitInstallation>> {
        // Resolve the tenant under the caller's SecurityContext first. Besides
        // proving it exists, this delegates hierarchy authorization to AM.
        self.account_management
            .get_tenant(ctx, project_id)
            .await
            .map_err(|error| anyhow::anyhow!("cannot resolve project: {error}"))?;

        let type_id = GtsTypeId::new(INSTALLATIONS_METADATA_TYPE);
        let value = match self
            .account_management
            .get_metadata(ctx, project_id, type_id)
            .await
        {
            Ok(entry) => entry.value,
            Err(_) => return Ok(Vec::new()),
        };
        Ok(serde_json::from_value::<InstallationDocument>(value)
            .context("project kit-installation metadata is malformed")?
            .installations
            .into_iter()
            .map(upgrade_installation)
            .collect())
    }

    pub async fn request_installation(
        &self,
        ctx: &SecurityContext,
        project_id: Uuid,
        kit_slug: &str,
        version: &str,
        install_mode: &str,
    ) -> Result<KitInstallation> {
        let kit_slug = normalize_slug(kit_slug)?;
        let version = normalize_version(version)?;
        let install_mode = normalize_install_mode(install_mode)?;
        let kit = self
            .catalogue()
            .into_iter()
            .find(|kit| kit.slug == kit_slug)
            .context("kit is not registered")?;
        if kit.source == "github" && install_mode != "copy" {
            bail!("GitHub registry kits use the managed copy install mode");
        }

        let mut installations = self.list_installations(ctx, project_id).await?;
        let requested = KitInstallation {
            kit_slug: kit.slug,
            version,
            source: kit.source,
            repository_url: kit.repository_url,
            install_mode,
            status: "pending".to_owned(),
            requested_by: ctx.subject_id().to_string(),
            requested_at: OffsetDateTime::now_utc()
                .format(&time::format_description::well_known::Rfc3339)?,
            installed_at: None,
            materializations: Vec::new(),
            legacy_repository_id: None,
            failure_reason: None,
        };
        installations.retain(|entry| entry.kit_slug != requested.kit_slug);
        installations.push(requested.clone());
        installations.sort_by(|left, right| left.kit_slug.cmp(&right.kit_slug));

        self.write_installations(ctx, project_id, installations)
            .await?;
        Ok(requested)
    }

    /// Repositories the project's running IDE has mounted, project repository
    /// first, so a caller can offer a materialization target and preselect the
    /// default the node would have picked anyway.
    ///
    /// Fails when the bridge is absent or no session is running. That is the
    /// honest answer rather than an empty list: an empty list reads as "this
    /// project has no repositories", which would be wrong.
    pub async fn list_repositories(
        &self,
        ctx: &SecurityContext,
        project_id: Uuid,
    ) -> Result<Vec<ProjectRepository>> {
        #[cfg(feature = "theia-bridge")]
        {
            use crate::studio_theia::sdk::{SessionTarget, TheiaControlClientV1};
            let client = self
                .client_hub
                .try_get::<dyn TheiaControlClientV1>()
                .context("Theia control bridge is not enabled")?;
            let repositories = client
                .get_repositories(
                    ctx,
                    &SessionTarget {
                        workspace_id: project_id,
                    },
                )
                .await
                .map_err(|error| anyhow::anyhow!(error.to_string()))?;
            let mut repositories: Vec<ProjectRepository> = repositories
                .into_iter()
                .map(|repository| ProjectRepository {
                    repository_id: repository.repository_id,
                    label: repository.label,
                    kind: repository.kind,
                    git_mode: repository.git_mode,
                })
                .collect();
            // The node orders repositories deepest-first, which puts the project
            // repository last. Callers render this list in order and preselect
            // the first entry, so the default has to lead.
            repositories.sort_by_key(|repository| u8::from(repository.kind != "project"));
            Ok(repositories)
        }
        #[cfg(not(feature = "theia-bridge"))]
        {
            let _ = (ctx, project_id);
            bail!("Theia control bridge is not compiled into this backend")
        }
    }

    pub async fn materialize_installation(
        &self,
        ctx: &SecurityContext,
        project_id: Uuid,
        kit_slug: &str,
        repository_id: Option<String>,
    ) -> Result<KitInstallation> {
        let kit_slug = normalize_slug(kit_slug)?;
        let mut installations = self.list_installations(ctx, project_id).await?;
        let index = installations
            .iter()
            .position(|entry| entry.kit_slug == kit_slug)
            .context("kit installation has not been requested")?;
        installations[index].status = "installing".to_owned();
        installations[index].failure_reason = None;
        // Cloned rather than moved: the failure arm needs to know which
        // repository was asked for, and the bridge arm consumes the original.
        // Cloning also keeps the parameter used in the no-bridge build.
        let target_repository_id = repository_id.clone();
        self.write_installations(ctx, project_id, installations.clone())
            .await?;

        #[cfg(feature = "theia-bridge")]
        let outcome = async {
            use crate::studio_theia::sdk::{InstallKit, SessionTarget, TheiaControlClientV1};
            let client = self
                .client_hub
                .try_get::<dyn TheiaControlClientV1>()
                .context("Theia control bridge is not enabled")?;
            client
                .install_kit(
                    ctx,
                    &SessionTarget {
                        workspace_id: project_id,
                    },
                    &InstallKit {
                        kit_slug: installations[index].kit_slug.clone(),
                        version: installations[index].version.clone(),
                        repository_id,
                    },
                )
                .await
                .map_err(|error| anyhow::anyhow!(error.to_string()))
        }
        .await;
        #[cfg(not(feature = "theia-bridge"))]
        let outcome: Result<MaterializedKit> = Err(anyhow::anyhow!(
            "Theia control bridge is not compiled into this backend"
        ));

        match outcome {
            Ok(result) => {
                let materialized_at = now_rfc3339()?;
                let version = installations[index].version.clone();
                installations[index].status = "installed".to_owned();
                installations[index].installed_at = Some(materialized_at.clone());
                installations[index].failure_reason = None;
                upsert_materialization(
                    &mut installations[index].materializations,
                    KitMaterialization {
                        repository_id: result.repository_id,
                        repository_label: Some(result.repository_label),
                        version,
                        status: "installed".to_owned(),
                        materialized_at,
                        failure_reason: None,
                    },
                );
                self.write_installations(ctx, project_id, installations.clone())
                    .await?;
                Ok(installations.remove(index))
            }
            Err(error) => {
                let detail: String = error.to_string().chars().take(2_000).collect();
                installations[index].status = "failed".to_owned();
                installations[index].failure_reason = Some(detail.clone());
                // Recorded per repository only when the caller named one. With
                // no target the node chose for us, and the error may well be
                // that it could not choose -- attributing the failure to a
                // guessed repository would put a red row on the wrong one.
                if let Some(repository_id) = target_repository_id {
                    let version = installations[index].version.clone();
                    let materialized_at = now_rfc3339()?;
                    upsert_materialization(
                        &mut installations[index].materializations,
                        KitMaterialization {
                            repository_id,
                            repository_label: None,
                            version,
                            status: "failed".to_owned(),
                            materialized_at,
                            failure_reason: Some(detail),
                        },
                    );
                }
                self.write_installations(ctx, project_id, installations)
                    .await?;
                Err(error)
            }
        }
    }

    pub async fn remove_installation(
        &self,
        ctx: &SecurityContext,
        project_id: Uuid,
        kit_slug: &str,
    ) -> Result<bool> {
        let kit_slug = normalize_slug(kit_slug)?;
        let mut installations = self.list_installations(ctx, project_id).await?;
        let before = installations.len();
        installations.retain(|entry| entry.kit_slug != kit_slug);
        if installations.len() == before {
            return Ok(false);
        }
        self.write_installations(ctx, project_id, installations)
            .await?;
        Ok(true)
    }

    async fn write_installations(
        &self,
        ctx: &SecurityContext,
        project_id: Uuid,
        installations: Vec<KitInstallation>,
    ) -> Result<()> {
        let value = serde_json::to_value(InstallationDocument { installations })?;
        self.account_management
            .upsert_metadata(
                ctx,
                project_id,
                UpsertMetadataRequest::new(GtsTypeId::new(INSTALLATIONS_METADATA_TYPE), value),
            )
            .await
            .map_err(|error| anyhow::anyhow!("cannot write project kit installations: {error}"))?;
        Ok(())
    }
}

fn official_catalogue() -> Vec<KitDescriptor> {
    vec![KitDescriptor {
        slug: "sdlc".to_owned(),
        name: "Software Delivery Lifecycle".to_owned(),
        description: "Product-to-code traceability with PRD, ADR, DESIGN, FEATURE, review and validation workflows.".to_owned(),
        publisher: "Constructor Fabric".to_owned(),
        visibility: "public".to_owned(),
        source: "github".to_owned(),
        repository_url: "https://github.com/constructorfabric/studio-kit-sdlc".to_owned(),
        default_version: "5c5b85c870cb4b62ed0506ae1a8ca196156d1c74".to_owned(),
        manifest_path: ".cf-studio-kit.toml".to_owned(),
    }]
}

fn normalize_slug(value: &str) -> Result<String> {
    let value = value.trim().to_ascii_lowercase();
    if value.is_empty()
        || value.len() > 80
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
    {
        bail!("kit slug must contain only lowercase letters, digits and hyphens");
    }
    Ok(value)
}

fn normalize_version(value: &str) -> Result<String> {
    if value
        .chars()
        .any(|character| matches!(character, '\0' | '\n' | '\r'))
    {
        bail!("kit version must not contain control characters");
    }
    let value = value.trim();
    if value.is_empty() || value.len() > 120 {
        bail!("kit version must be a non-empty Git ref of at most 120 characters");
    }
    let mut chars = value.chars();
    let first = chars.next().unwrap_or_default();
    if !first.is_ascii_alphanumeric()
        || !chars.all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, '.' | '_' | '/' | '-')
        })
        || value.contains("..")
        || value.contains("@{")
        || value.ends_with('/')
        || value.ends_with(".lock")
    {
        bail!("kit version must be a safe Git ref");
    }
    Ok(value.to_owned())
}

fn normalize_install_mode(value: &str) -> Result<String> {
    match value.trim() {
        "copy" => Ok("copy".to_owned()),
        "register" => Ok("register".to_owned()),
        _ => bail!("install mode must be copy or register"),
    }
}

fn now_rfc3339() -> Result<String> {
    Ok(OffsetDateTime::now_utc().format(&time::format_description::well_known::Rfc3339)?)
}

#[cfg(not(feature = "theia-bridge"))]
struct MaterializedKit {
    repository_id: String,
    repository_label: String,
}

/// Replace this repository's row, or append it.
///
/// Keyed by repository id because the interesting state is "where is this kit
/// now, and at which version", not every attempt ever made. Re-running an
/// install updates the row instead of growing a history nobody reads.
fn upsert_materialization(
    materializations: &mut Vec<KitMaterialization>,
    entry: KitMaterialization,
) {
    match materializations
        .iter_mut()
        .find(|candidate| candidate.repository_id == entry.repository_id)
    {
        Some(existing) => *existing = entry,
        None => materializations.push(entry),
    }
}

/// Bring a stored installation up to the current shape.
///
/// Before materializations were a list, a successful install wrote its target
/// into `repository_id` and overwrote whatever was there. For a project written
/// by that code it is the only record of where the kit actually landed, so it is
/// promoted to a single materialization rather than dropped. Version and
/// timestamp come from the installation because that is all the old document
/// knew; the promoted row is then written back in the new shape on the next
/// materialize, and the legacy key never reappears.
fn upgrade_installation(mut installation: KitInstallation) -> KitInstallation {
    // Taken unconditionally: the legacy key is never written again, whether or
    // not it still has anything to contribute.
    let legacy_repository_id = installation.legacy_repository_id.take();
    if !installation.materializations.is_empty() {
        return installation;
    }
    let Some(repository_id) = legacy_repository_id else {
        return installation;
    };
    let materialized_at = installation
        .installed_at
        .clone()
        .unwrap_or_else(|| installation.requested_at.clone());
    installation.materializations.push(KitMaterialization {
        repository_id,
        repository_label: None,
        version: installation.version.clone(),
        status: installation.status.clone(),
        materialized_at,
        failure_reason: installation.failure_reason.clone(),
    });
    installation
}

#[cfg(test)]
mod tests {
    use super::{
        KitMaterialization, normalize_install_mode, normalize_slug, normalize_version,
        official_catalogue, upgrade_installation, upsert_materialization,
    };

    #[test]
    fn official_catalogue_uses_the_canonical_git_kit() {
        let kits = official_catalogue();
        assert_eq!(kits.len(), 1);
        assert_eq!(kits[0].slug, "sdlc");
        assert_eq!(
            kits[0].repository_url,
            "https://github.com/constructorfabric/studio-kit-sdlc"
        );
    }

    #[test]
    fn request_fields_are_shell_safe_and_bounded() {
        assert_eq!(normalize_slug("SDLC").unwrap(), "sdlc");
        assert!(normalize_slug("sdlc; rm").is_err());
        assert!(normalize_version("\nmain").is_err());
        assert!(normalize_version("--help").is_err());
        assert!(normalize_version("feature/../main").is_err());
        assert!(normalize_install_mode("shell").is_err());
    }

    #[test]
    fn a_document_written_before_materializations_upgrades_on_read() {
        let legacy = serde_json::json!({
            "kit_slug": "sdlc",
            "version": "main",
            "source": "github",
            "repository_url": "https://github.com/constructorfabric/studio-kit-sdlc",
            "install_mode": "copy",
            "status": "installed",
            "requested_by": "user-1",
            "requested_at": "2026-08-30T10:00:00Z",
            "installed_at": "2026-08-30T10:05:00Z",
            "repository_id": "repo-project"
        });

        let upgraded = upgrade_installation(serde_json::from_value(legacy).unwrap());

        assert_eq!(upgraded.materializations.len(), 1);
        assert_eq!(upgraded.materializations[0].repository_id, "repo-project");
        assert_eq!(upgraded.materializations[0].version, "main");
        assert_eq!(upgraded.materializations[0].status, "installed");
        assert_eq!(
            upgraded.materializations[0].materialized_at,
            "2026-08-30T10:05:00Z"
        );
        assert!(upgraded.legacy_repository_id.is_none());

        // The legacy key is read-only: writing the upgraded document back must
        // not resurrect the field that could only ever hold one target.
        let written = serde_json::to_value(&upgraded).unwrap();
        assert!(written.get("repository_id").is_none());
        assert_eq!(
            written["materializations"][0]["repository_id"],
            "repo-project"
        );
    }

    #[test]
    fn upgrade_leaves_an_already_migrated_document_alone() {
        let current = serde_json::json!({
            "kit_slug": "sdlc",
            "version": "main",
            "source": "github",
            "repository_url": "https://github.com/constructorfabric/studio-kit-sdlc",
            "install_mode": "copy",
            "status": "installed",
            "requested_by": "user-1",
            "requested_at": "2026-08-30T10:00:00Z",
            "repository_id": "repo-stale",
            "materializations": [{
                "repository_id": "repo-app",
                "version": "main",
                "status": "installed",
                "materialized_at": "2026-08-31T09:00:00Z"
            }]
        });

        let upgraded = upgrade_installation(serde_json::from_value(current).unwrap());

        // The list wins: a stale single field left over from an older writer
        // must not add a phantom target.
        assert_eq!(upgraded.materializations.len(), 1);
        assert_eq!(upgraded.materializations[0].repository_id, "repo-app");
    }

    #[test]
    fn materializing_the_same_repository_twice_replaces_its_row() {
        let mut materializations = vec![row("repo-app", "v1", "installed")];

        upsert_materialization(
            &mut materializations,
            row("repo-project", "v1", "installed"),
        );
        upsert_materialization(&mut materializations, row("repo-app", "v2", "failed"));

        assert_eq!(materializations.len(), 2);
        assert_eq!(materializations[0].version, "v2");
        assert_eq!(materializations[0].status, "failed");
        assert_eq!(materializations[1].repository_id, "repo-project");
    }

    fn row(repository_id: &str, version: &str, status: &str) -> KitMaterialization {
        KitMaterialization {
            repository_id: repository_id.to_owned(),
            repository_label: None,
            version: version.to_owned(),
            status: status.to_owned(),
            materialized_at: "2026-09-01T00:00:00Z".to_owned(),
            failure_reason: None,
        }
    }
}
