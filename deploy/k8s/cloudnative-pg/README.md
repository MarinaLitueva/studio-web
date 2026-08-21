# Graph PostgreSQL for dev and test

This is an experimental PostgreSQL 19 beta deployment. PostgreSQL 19 is not in
CloudNativePG's supported PostgreSQL range yet; do not use this profile for
production data.

## Ordering

1. Merge or push the release workflow changes and wait for the immutable
   `ghcr.io/constructorfabric/studio-web/graph-postgres:sha-<commit>` image.
2. Confirm that all three release images are anonymously readable from GHCR.
   Public image visibility does not grant Kubernetes deploy access; deployments
   remain controlled by cluster RBAC.
3. Install the pinned CloudNativePG operator version documented in the cluster
   runbook and wait for its controller deployment.
4. Render `dev-cluster.template.yaml` and/or `test-cluster.template.yaml` with
   the immutable image reference and apply each to its matching namespace.
5. Wait for `cluster/studio-postgres` to report `Cluster in healthy state`.
6. Verify that Secret `studio-postgres-app` exists. CloudNativePG creates it;
   both Helm environment values map the username key to `username`.

The dev template creates one 10 GiB Cinder-backed instance. The test template
creates two 20 GiB Cinder-backed instances on separate nodes. Neither exposes a
public Service. Each template also reconciles a separate logical `keycloak`
database and login role inside the same PostgreSQL cluster. Create the
namespace-local `keycloak-postgres-app` Secret before applying the template; it
must use type `kubernetes.io/basic-auth`, contain `username: keycloak` and a
strong `password`, and also provide `host`, `port`, and `dbname` keys for the
Keycloak workload. Keycloak 26.7 does not officially support PostgreSQL 19, so
this shared-cluster layout is for dev/test only. Backup configuration is
intentionally a separate gate and must be completed before storing important
data.
