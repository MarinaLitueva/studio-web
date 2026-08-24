# GitHub SSO through Keycloak

Constructor Studio uses the existing `studio` Keycloak realm as an identity
broker. GitHub is the external identity provider; Studio itself continues to
consume the same OIDC issuer and does not receive or store GitHub OAuth tokens.

Access is restricted to active members of the GitHub organization
`constructorfabric`. The custom Keycloak GitHub provider calls
`GET /user/memberships/orgs/constructorfabric` during every OAuth login, before
the broker can create or link a user. Only a `200` response whose membership
state is `active` is accepted. Pending memberships, missing memberships,
insufficient OAuth scopes, organization-blocked OAuth Apps, and GitHub API
failures are denied. The provider does not store the GitHub access token.

## OAuth Apps

Create a separate organization-owned GitHub OAuth App for each environment.
An organization owner or a user with administrative access to the organization
must perform this step.

| Environment | Homepage URL | Authorization callback URL |
| --- | --- | --- |
| dev | `https://studio-dev.cfabric.org` | `https://studio-dev.cfabric.org/auth/realms/studio/broker/github/endpoint` |
| test | `https://studio-test.cfabric.org` | `https://studio-test.cfabric.org/auth/realms/studio/broker/github/endpoint` |

Suggested names are `Constructor Studio Dev` and `Constructor Studio Test`.
The Keycloak provider requests only `user:email read:org`: email is needed for
the local Keycloak identity and `read:org` is needed to see private organization
membership. No repository scope is requested.

If the organization restricts OAuth App access, an organization owner must
approve both applications for `constructorfabric`.

## Kubernetes credentials

Never commit the OAuth client secret or put it into a Helm values file. Store
the client ID and secret in an environment-local Kubernetes Secret mounted by
Keycloak's files-plaintext vault. Keycloak resolves `${vault.github-client-id}`
and `${vault.github-client-secret}` from the files named below.

The following PowerShell keeps entered values out of command history:

```powershell
$githubClientId = Read-Host "GitHub OAuth Client ID"
$githubClientSecretSecure = Read-Host "GitHub OAuth Client Secret" -AsSecureString
$githubClientSecret = [Net.NetworkCredential]::new("", $githubClientSecretSecure).Password

kubectl -n studio-dev create secret generic studio-web-keycloak-vault `
  --from-literal=studio_github-client-id="$githubClientId" `
  --from-literal=studio_github-client-secret="$githubClientSecret" `
  --dry-run=client -o yaml | kubectl apply -f -

Remove-Variable githubClientSecret, githubClientSecretSecure, githubClientId
```

Repeat for `studio-test` using that environment's independent OAuth App and
namespace. Restrict read access to this Secret to the Keycloak deployment and
the namespace-scoped infrastructure deployer.

## Build and rollout

1. Merge the Keycloak extension and realm changes.
2. Publish an immutable `infra-v*` release. The infrastructure build compiles
   and tests the restricted GitHub provider before producing
   `cf-studio-keycloak`.
3. Create `studio-web-keycloak-vault` in the target namespace.
4. Update the environment's `studio-web-keycloak-realm` from
   `keycloak/realm-studio.json`. Realm startup import is only effective for a
   new realm; for an existing realm, use Keycloak Admin Console partial import
   with `keycloak/github-sso-partial-import.json` and select **Overwrite**.
5. Run **Deploy Infra** for dev with the new `infra-v*` tag.
6. Test an active organization member and a non-member account before promoting
   the same immutable image to test.

## Expected identity

On first successful login Keycloak creates and links a realm user whose
username comes from the GitHub login and whose email comes from GitHub's primary
email endpoint. The `github-tenant-id` mapper assigns the sandbox tenant
`00000000-0000-0000-0000-000000000002`; the root admin remains in tenant
`00000000-0000-0000-0000-000000000001`.

Removing a person from `constructorfabric` blocks their next GitHub login. It
does not delete their Keycloak record, which preserves audit references.
