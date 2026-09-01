use std::sync::Arc;

use account_management_sdk::{AccountManagementClient, UpsertMetadataRequest};
use anyhow::{Context, Result, bail};
use gts::GtsTypeId;
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;
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
    /// Desired-state status. Only a trusted `cfs` runner may advance this to
    /// `installed`; the registry API initially records `pending`.
    pub status: String,
    pub requested_by: String,
    pub requested_at: String,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
struct InstallationDocument {
    #[serde(default)]
    installations: Vec<KitInstallation>,
}

pub struct KitRegistryService {
    account_management: Arc<dyn AccountManagementClient>,
}

impl KitRegistryService {
    pub fn new(account_management: Arc<dyn AccountManagementClient>) -> Self {
        Self { account_management }
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
            .installations)
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
        };
        installations.retain(|entry| entry.kit_slug != requested.kit_slug);
        installations.push(requested.clone());
        installations.sort_by(|left, right| left.kit_slug.cmp(&right.kit_slug));

        self.write_installations(ctx, project_id, installations)
            .await?;
        Ok(requested)
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
        default_version: "main".to_owned(),
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
    Ok(value.to_owned())
}

fn normalize_install_mode(value: &str) -> Result<String> {
    match value.trim() {
        "copy" => Ok("copy".to_owned()),
        "register" => Ok("register".to_owned()),
        _ => bail!("install mode must be copy or register"),
    }
}

#[cfg(test)]
mod tests {
    use super::{normalize_install_mode, normalize_slug, normalize_version, official_catalogue};

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
        assert!(normalize_install_mode("shell").is_err());
    }
}
