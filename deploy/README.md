# Deploying studio-web to Kubernetes

The chart and environment values live in this repository so application and
deployment changes can be reviewed together. `.github/workflows/deploy.yml`
performs a manually approved dev or test deployment; no separate infra
repository or Argo CD installation is used. `helm/values-dmz.example.yaml`
documents the generic configuration contract.

## Images

Published by GitHub Actions on a `v*` tag (`.github/workflows/release.yml`):

- `ghcr.io/constructorfabric/studio-web/studio-backend:<tag>`
- `ghcr.io/constructorfabric/studio-web/studio-frontend:<tag>`

Both run non-root (backend: `studio` system user; frontend:
nginx-unprivileged, uid 101, port 8080). Chart requires explicit immutable
tags — no `latest`.

## Configuration model

One image, any environment:

- **Backend** starts with `--config config/k8s.yaml`, which resolves every
  environment-specific value from env vars; the chart wires those from
  pre-created Secrets (see `values-dmz.example.yaml` header for the exact
  Secret names/keys).
- **Frontend** serves a static bundle; per-environment values (OIDC issuer,
  client id, links) are injected at container start into `env.js`
  (`window.__STUDIO_ENV__`) — no rebuild per environment.

## Feature flags in cluster v1

- **IDE sessions are disabled** (`studio-session.enabled=false` in
  `k8s.yaml`): the Docker session driver needs `/var/run/docker.sock`;
  the per-session Pod driver is a future step (ADR-0003). Session APIs
  answer 503 with a clear message; the rest of the portal is unaffected.
- **User invites are optional**: set `backend.idpAdmin.baseUrl` +
  `idp_admin_secret` to enable the Keycloak Admin provisioning plugin;
  without them the plugin self-deprioritizes.

## Install

```bash
helm upgrade --install studio-web deploy/helm/studio-web \
  -n studio --create-namespace \
  -f values-dmz.yaml
```

Prerequisites: the three Secrets from `values-dmz.example.yaml`, an OIDC
realm (issuer must serve real TLS), and a Postgres with a CREATEDB-capable
app user. Per-gear databases are NOT auto-provisioned: `auto_provision` only creates SQLite directories, so the databases come from the initdb list in k8s/postgres.yaml, which runs once on an empty volume — add one by hand if you introduce a gear later.

## GitHub deployment

All routine dev and test deployments are performed only by the GitHub Actions
**Deploy** workflow. Direct local `helm` or `kubectl` mutations are reserved for
documented break-glass recovery; after recovery, reconcile the same state
through GitHub so the deployment history remains authoritative.

Create GitHub Environments named `dev` and `test`. In each Environment add a
secret named `KUBE_CONFIG_B64` containing the base64-encoded kubeconfig for
that namespace's `studio-deployer` ServiceAccount. Never use the administrator
kubeconfig. Add required reviewers when repository access is hardened.

Run the **Deploy** workflow from the `main` branch. A full `sha-<commit>`
snapshot built from any internal branch may be deployed only to `dev`. A
versioned `v*` release tag pointing to a commit on `main` may be deployed to
`dev` or `test`. Production will be added only after its namespace and values
exist. The deploy job:

1. enforces the snapshot-to-dev and release-to-environment promotion policy and rejects cluster-admin credentials;
2. verifies the three application images and required namespace Secrets;
3. lints and server-side dry-runs the rendered chart;
4. performs a Helm upgrade with automatic rollback and waits for readiness;
5. verifies deployed image tags, HTTPS health and the environment OIDC issuer.
