# Kit Registry — prototype vertical slice

## Scope

This implementation intentionally exposes Kit Registry only in
`studio-frontend-prototype`. The production `studio-frontend` is unchanged.

A kit is a versioned bundle of Constructor Studio conventions and workflows
whose canonical content remains in Git. The initial official entry is:

- slug: `sdlc`
- repository: `https://github.com/constructorfabric/studio-kit-sdlc`
- manifest: `.cf-studio-kit.toml`
- default Git ref: `main`

## User flow

1. Open an organization, workspace and project in the prototype.
2. Select **Kits** in the project sidebar.
3. Choose a Git ref and installation mode.
4. Select **Install** or **Update request**.

The request is stored as project-scoped desired state with status `pending`.
Removing it deletes that desired-state entry. The browser does not clone a
repository and does not execute kit code.

## Backend API

All endpoints require the normal authenticated Studio security context.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/studio-kits/v1/catalog` | List registry entries |
| `GET` | `/studio-kits/v1/projects/{project_id}/installations` | Read project desired state |
| `POST` | `/studio-kits/v1/projects/{project_id}/installations` | Create or replace one request |
| `DELETE` | `/studio-kits/v1/projects/{project_id}/installations/{kit_slug}` | Remove one request |

Installations are persisted through Account Management tenant metadata using:

`gts.cf.core.am.tenant_metadata.v1~cf.studio.project.kit_installations.v1~`

The metadata uses `override_only`, so a project never inherits another
tenant's kit installation list.

Example request:

```json
{
  "kit_slug": "sdlc",
  "version": "v1.2.3",
  "install_mode": "copy"
}
```

## Installation boundary

This slice deliberately stops before materialization. A later trusted runner
inside the project IDE session will:

1. read pending desired state from Studio backend;
2. resolve the allow-listed registry repository and exact Git ref;
3. validate the kit manifest and compatibility;
4. invoke `cfs` with structured arguments in the workspace checkout;
5. report `installing`, `installed` or `failed` back to Studio;
6. keep an audit record with project, kit, version, actor and result.

The runner must not accept arbitrary repository URLs or shell fragments from
the browser. Private registries should use Studio Connections/Secrets and
short-lived credentials, never return credentials to the UI.

## Verification

- Prototype: `npm run build`
- Prototype tests: `npm test`
- Backend release image:

```text
docker build -f studio-backend/Dockerfile.src \
  -t studio-backend-kits-check \
  --build-arg "CARGO_FEATURES=--no-default-features --features graph" .
```
