import { useEffect, useMemo, useState } from "react";

import { api, type PlatformIdentity } from "./api";
import { errText, initials, matches } from "./format";

export function IdentityDirectory({ token, query }: { token: string; query: string }) {
  const [identities, setIdentities] = useState<PlatformIdentity[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    api.platformIdentities(token).then(
      ({ items }) => {
        if (!cancelled) setIdentities(items);
      },
      (reason) => {
        if (!cancelled) {
          setError(errText(reason));
          setIdentities([]);
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [token]);

  const filtered = useMemo(
    () =>
      (identities ?? []).filter((identity) =>
        matches(
          query,
          identity.display_name,
          identity.username,
          identity.email,
          identity.home_tenant_name,
          identity.status,
        ),
      ),
    [identities, query],
  );

  return (
    <>
      <div className="topbar">
        <div>
          <h1>Identity directory</h1>
          <p className="subtitle" style={{ margin: 0 }}>
            Everyone whose identity exists in Studio Keycloak, including people waiting for
            organization access.
          </p>
        </div>
      </div>

      {error && <div className="error">{error}</div>}

      <div className="card">
        {identities === null ? (
          <p className="hint">Loading identities…</p>
        ) : filtered.length === 0 ? (
          <p className="empty">
            {identities.length === 0 ? "No identities found." : "No identities match the filter."}
          </p>
        ) : (
          <table className="ptable people">
            <thead>
              <tr>
                <th>Identity</th>
                <th>Provider</th>
                <th>Access</th>
                <th>First seen</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((identity) => {
                const name = identity.display_name || identity.username;
                const firstSeen = identity.first_seen_at_epoch_ms
                  ? new Date(identity.first_seen_at_epoch_ms).toLocaleString()
                  : "—";
                return (
                  <tr key={identity.id} className="prow">
                    <td>
                      <div className="pcell">
                        <span className="account-avatar small">{initials(name)}</span>
                        <div>
                          <div className="pname plain">{name}</div>
                          <div className="sub">{identity.email || identity.username}</div>
                        </div>
                      </div>
                    </td>
                    <td className="sub">{identity.identity_provider || "local"}</td>
                    <td>
                      <span className={`badge ${identity.status === "unassigned" ? "warning" : "workspace"}`}>
                        {identity.status === "platform_admin"
                          ? "Platform admin"
                          : identity.status === "assigned"
                            ? identity.home_tenant_name || "Assigned"
                            : "Waiting for access"}
                      </span>
                    </td>
                    <td className="sub">{firstSeen}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <p className="hint" style={{ marginTop: 14 }}>
          This is an identity directory, not an OAuth failure log. A rejected login that never
          created a Keycloak identity belongs in the security audit instead.
        </p>
      </div>
    </>
  );
}

