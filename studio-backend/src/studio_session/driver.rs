//! Session driver abstraction (ADR-0003).
//!
//! [`SessionService`](super::service::SessionService) owns everything that is
//! independent of *how* a session container runs — validation, the workspace
//! manifest, the in-memory registry, tenant isolation, credstore-resolved
//! tokens, the reaper. A [`SessionDriver`] owns the one thing that is not:
//! launching, probing, destroying, and re-adopting the actual runtime.
//!
//! The Docker driver ([`super::docker::DockerDriver`]) is the MVP: one
//! container per workspace on the local daemon, published on a loopback port.
//! The Kubernetes driver is its successor: one Pod+Service per session behind
//! the backend's authenticated proxy. Both satisfy this trait, so the REST
//! surface and the portal flow do not change with the backend.

use std::collections::HashMap;

use async_trait::async_trait;
use uuid::Uuid;

/// Where a launched session listens, as the driver exposes it.
#[derive(Debug, Clone)]
pub enum SessionAddress {
    /// Docker: published on the backend host's loopback at this port. The
    /// portal opens `http://<public_host>:<port>/` directly (single-host MVP).
    Loopback { port: u16 },
    /// Kubernetes: reachable in-cluster at this Service DNS `host:port`. The
    /// browser never touches it directly — the backend proxies `/studio/{id}`
    /// to it after checking the caller owns the session. Constructed by the
    /// Kubernetes driver (added with it); the match arms that read it ship now
    /// so the service is address-driven from the start.
    #[allow(dead_code)]
    Service { host: String, port: u16 },
}

/// A local source directory bind-mounted into the workspace. Docker-only: the
/// Kubernetes driver has no host filesystem to bind and rejects a non-empty
/// list at launch.
#[derive(Debug, Clone)]
pub struct LocalBind {
    /// Absolute path on the backend host.
    pub host_path: String,
    /// Mount point relative to the workspace root (e.g. `docs`).
    pub target: String,
}

/// Everything a driver needs to launch one IDE session. The service builds
/// this; drivers translate it into a container spec or a Pod spec.
pub struct LaunchSpec {
    /// The IDE image (`config.image`).
    pub image: String,
    /// `STUDIO_*` variables the entrypoint reads.
    pub env: Vec<String>,
    /// Host directory to mount at `/workspace` (Docker). The Kubernetes
    /// driver uses an ephemeral `emptyDir` and ignores this.
    pub workspace_host_dir: String,
    /// Local source binds (Docker only).
    pub local_binds: Vec<LocalBind>,
    /// Labels stamped on the container/Pod so [`SessionDriver::list_adoptable`]
    /// can find them after a backend restart.
    pub labels: HashMap<String, String>,
    /// Deterministic per-workspace name (`cf-studio-session-<workspace>`) —
    /// the Docker container name and the Kubernetes Pod name.
    pub name: String,
    /// Loopback port the Docker driver publishes; the Kubernetes driver
    /// ignores it (the Service always targets the fixed in-container port).
    pub port: u16,
}

/// A freshly launched session as the driver sees it.
#[derive(Debug, Clone)]
pub struct LaunchedSession {
    /// Container id (Docker) or Pod name (Kubernetes) — the destroy/probe key.
    pub handle: String,
    pub address: SessionAddress,
}

/// A session recovered from the runtime at boot (labeled container / Pod),
/// so a backend restart does not orphan running IDE sessions.
#[derive(Debug, Clone)]
pub struct AdoptedSession {
    pub workspace_id: Uuid,
    pub tenant_id: Uuid,
    pub handle: String,
    pub address: SessionAddress,
    pub running: bool,
    pub created_at_epoch_secs: u64,
    /// `STUDIO_SESSION_TOKEN` recovered from the runtime (empty if the driver
    /// cannot read it back — the session is then adopted ungated).
    pub session_token: String,
}

/// The runtime behind [`SessionService`](super::service::SessionService).
#[async_trait]
pub trait SessionDriver: Send + Sync {
    /// Is the image usable *right now*? The launch path calls this and never
    /// blocks on a pull. Docker inspects the local image; Kubernetes returns
    /// `true` (the kubelet pulls on Pod create per `imagePullPolicy`).
    async fn image_present(&self) -> bool;

    /// One image refresh. Docker pulls from the registry; Kubernetes is a
    /// no-op. Driven by the service's image keeper, never by a launch.
    async fn refresh_image(&self) -> anyhow::Result<()>;

    /// Launch one session. Idempotency and reuse are the service's job — the
    /// driver always creates a fresh runtime for the given spec.
    async fn launch(&self, spec: &LaunchSpec) -> anyhow::Result<LaunchedSession>;

    /// Is this handle's runtime alive? Used to discard a registered session
    /// whose container/Pod vanished out of band before reusing its address.
    async fn is_running(&self, handle: &str) -> bool;

    /// Has the session's port started accepting connections? Drives the
    /// `starting → running` transition on GET.
    async fn is_reachable(&self, address: &SessionAddress) -> bool;

    /// Stop and remove the runtime. Idempotent: an already-gone handle is Ok.
    async fn destroy(&self, handle: &str) -> anyhow::Result<()>;

    /// List labeled sessions surviving from a previous backend run.
    async fn list_adoptable(&self) -> anyhow::Result<Vec<AdoptedSession>>;
}
