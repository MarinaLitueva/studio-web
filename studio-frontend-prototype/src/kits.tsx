import { useCallback, useEffect, useMemo, useState } from "react";
import { api, type KitInstallation, type StudioKit } from "./api";
import { errText } from "./format";

export function ProjectKits({ token, projectId }: { token: string; projectId: string }) {
  const [catalog, setCatalog] = useState<StudioKit[] | null>(null);
  const [installed, setInstalled] = useState<KitInstallation[]>([]);
  const [versions, setVersions] = useState<Record<string, string>>({});
  const [modes, setModes] = useState<Record<string, "copy" | "register">>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setError(null);
    try {
      const [kits, installations] = await Promise.all([
        api.kits(token),
        api.kitInstallations(token, projectId),
      ]);
      setCatalog(kits.items);
      setInstalled(installations.items);
      setVersions((current) => {
        const next = { ...current };
        for (const kit of kits.items) {
          const existing = installations.items.find((item) => item.kit_slug === kit.slug);
          if (!next[kit.slug]) next[kit.slug] = existing?.version ?? kit.default_version;
        }
        return next;
      });
      setModes((current) => {
        const next = { ...current };
        for (const kit of kits.items) {
          const existing = installations.items.find((item) => item.kit_slug === kit.slug);
          if (!next[kit.slug]) next[kit.slug] = existing?.install_mode ?? "copy";
        }
        return next;
      });
    } catch (cause) {
      setError(errText(cause));
      setCatalog([]);
    }
  }, [projectId, token]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const bySlug = useMemo(
    () => new Map(installed.map((installation) => [installation.kit_slug, installation])),
    [installed],
  );

  const install = async (kit: StudioKit) => {
    const version = (versions[kit.slug] ?? kit.default_version).trim();
    if (!version) return;
    setBusy(kit.slug);
    setError(null);
    try {
      await api.requestKitInstallation(token, projectId, {
        kit_slug: kit.slug,
        version,
        install_mode: modes[kit.slug] ?? "copy",
      });
      await reload();
    } catch (cause) {
      setError(errText(cause));
    } finally {
      setBusy(null);
    }
  };

  const remove = async (kit: StudioKit) => {
    setBusy(kit.slug);
    setError(null);
    try {
      await api.removeKitInstallation(token, projectId, kit.slug);
      await reload();
    } catch (cause) {
      setError(errText(cause));
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="kits-view">
      <div className="card-head">
        <div>
          <h2>Project kits</h2>
          <p className="subtitle">
            Reusable Studio workflows and conventions, pinned to a Git version for this project.
          </p>
        </div>
        <button className="ghost" onClick={() => void reload()} disabled={busy !== null}>
          Refresh
        </button>
      </div>

      <div className="notice">
        This prototype records desired state only. A trusted <code>cfs</code> runner in the IDE will
        materialize pending kits; the browser never runs repository scripts.
      </div>
      {error && <div className="error">{error}</div>}

      {catalog === null ? (
        <p className="empty">Loading kit registry…</p>
      ) : catalog.length === 0 ? (
        <p className="empty">No kits are published in this registry.</p>
      ) : (
        <div className="kit-grid">
          {catalog.map((kit) => {
            const installation = bySlug.get(kit.slug);
            const isBusy = busy === kit.slug;
            return (
              <article className="card kit-card" key={kit.slug}>
                <div className="kit-card-head">
                  <div>
                    <span className="badge info">{kit.publisher}</span>
                    <h3>{kit.name}</h3>
                  </div>
                  {installation && (
                    <span className={`badge ${installation.status}`}>{installation.status}</span>
                  )}
                </div>
                <p>{kit.description}</p>
                <p className="sub">
                  <a href={kit.repository_url} target="_blank" rel="noreferrer">
                    {kit.repository_url} ↗
                  </a>
                  <br />Manifest: <code>{kit.manifest_path}</code>
                </p>
                <div className="kit-controls">
                  <label>
                    Version / Git ref
                    <input
                      value={versions[kit.slug] ?? kit.default_version}
                      onChange={(event) =>
                        setVersions((current) => ({ ...current, [kit.slug]: event.target.value }))
                      }
                    />
                  </label>
                  <label>
                    Install mode
                    <select
                      value={modes[kit.slug] ?? "copy"}
                      onChange={(event) =>
                        setModes((current) => ({
                          ...current,
                          [kit.slug]: event.target.value as "copy" | "register",
                        }))
                      }
                    >
                      <option value="copy">Copy into project</option>
                      <option value="register">Register from source</option>
                    </select>
                  </label>
                </div>
                {installation && (
                  <p className="sub">
                    Requested <code>{installation.version}</code> · {installation.install_mode} ·{" "}
                    {new Date(installation.requested_at).toLocaleString()}
                  </p>
                )}
                <div className="inline kit-actions">
                  <button className="primary" disabled={isBusy} onClick={() => void install(kit)}>
                    {isBusy ? "Saving…" : installation ? "Update request" : "Install"}
                  </button>
                  {installation && (
                    <button className="ghost" disabled={isBusy} onClick={() => void remove(kit)}>
                      Remove
                    </button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
