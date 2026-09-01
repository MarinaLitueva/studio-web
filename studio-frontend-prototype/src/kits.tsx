import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  api,
  type KitInstallation,
  type KitMaterialization,
  type ProjectRepository,
  type StudioKit,
} from "./api";
import { errText } from "./format";

export function ProjectKits({ token, projectId }: { token: string; projectId: string }) {
  const [catalog, setCatalog] = useState<StudioKit[] | null>(null);
  const [installed, setInstalled] = useState<KitInstallation[]>([]);
  const [versions, setVersions] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [repositories, setRepositories] = useState<ProjectRepository[] | null>(null);
  const [repositoriesNote, setRepositoriesNote] = useState<string | null>(null);
  const [targets, setTargets] = useState<Record<string, string>>({});
  const [scopes, setScopes] = useState<Record<string, boolean>>({});
  // Slug@version pairs already reconciled on this mount, so a reload does not
  // re-run a rollout that has nothing left to do.
  const reconciled = useRef(new Set<string>());

  const reload = useCallback(async () => {
    setError(null);
    let current: KitInstallation[] = [];
    try {
      const [kits, installations] = await Promise.all([
        api.kits(token),
        api.kitInstallations(token, projectId),
      ]);
      current = installations.items;
      setCatalog(kits.items);
      setInstalled(current);
      setVersions((previous) => {
        const next = { ...previous };
        for (const kit of kits.items) {
          const existing = current.find((item) => item.kit_slug === kit.slug);
          if (!next[kit.slug]) next[kit.slug] = existing?.version ?? kit.default_version;
        }
        return next;
      });
    } catch (cause) {
      setError(errText(cause));
      setCatalog([]);
    }

    // Loaded apart from the catalogue, and its failure is not an error banner.
    // The repository list comes from the running IDE, so "no session yet" is
    // the ordinary state of this page -- folding it into the load above would
    // blank the kit grid every time someone opens the tab before the IDE.
    let mounted: ProjectRepository[] | null = null;
    try {
      mounted = (await api.projectRepositories(token, projectId)).items;
      setRepositories(mounted);
      setRepositoriesNote(null);
    } catch (cause) {
      setRepositories(null);
      setRepositoriesNote(errText(cause));
    }

    /*
     * The automatic half of "install in every repository".
     *
     * A kit scoped that way is meant to reach a repository that joined the
     * project after it was installed, and a running session is the only moment
     * the portal can see that such a repository exists. The call is idempotent
     * -- the backend skips repositories already at this version -- and it is
     * keyed by slug@version here so a reload does not keep asking.
     */
    if (!mounted) return;
    const pending = current.filter(
      (installation) =>
        installation.scope === "all-repositories" &&
        installation.status !== "installing" &&
        !reconciled.current.has(`${installation.kit_slug}@${installation.version}`),
    );
    if (pending.length === 0) return;
    for (const installation of pending) {
      reconciled.current.add(`${installation.kit_slug}@${installation.version}`);
      try {
        await api.reconcileKitInstallation(token, projectId, installation.kit_slug);
      } catch {
        // Per-repository outcomes are recorded on the rows either way; the
        // refresh below is what surfaces them.
      }
    }
    try {
      setInstalled((await api.kitInstallations(token, projectId)).items);
    } catch {
      // Keep what is on screen rather than blanking it over a refresh.
    }
  }, [projectId, token]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const bySlug = useMemo(
    () => new Map(installed.map((installation) => [installation.kit_slug, installation])),
    [installed],
  );

  /*
   * Where a kit lands, most specific first: what the user picked, then the
   * repository this kit was last materialized into (so "Reinstall / update"
   * does not silently move it), then the project repository.
   *
   * Undefined is a valid answer -- with no session the list is unknown, the
   * request goes out without `repository_id`, and the IDE resolves the project
   * repository itself. That is the same call this page made before the picker
   * existed.
   */
  const defaultRepositoryId = useMemo(
    () =>
      repositories?.find((repository) => repository.kind === "project")?.repository_id ??
      repositories?.[0]?.repository_id,
    [repositories],
  );

  const targetFor = (slug: string): string | undefined =>
    targets[slug] ?? bySlug.get(slug)?.repository_id ?? defaultRepositoryId;

  const everyRepository = (slug: string): boolean =>
    scopes[slug] ?? bySlug.get(slug)?.scope === "all-repositories";

  /*
   * The label recorded at materialization time wins: it is what the repository
   * was called when the kit landed there, and it stays readable after the IDE
   * is closed. The live list only fills gaps -- rows upgraded from a
   * pre-materializations document have no label of their own.
   */
  const repositoryLabel = (entry: KitMaterialization): string => {
    const mounted = repositories?.find(
      (repository) => repository.repository_id === entry.repository_id,
    );
    const name = entry.repository_label ?? mounted?.label ?? entry.repository_id;
    return mounted?.kind === "project" ? `${name} · whole project` : name;
  };

  const install = async (kit: StudioKit) => {
    const version = (versions[kit.slug] ?? kit.default_version).trim();
    if (!version) return;
    setBusy(kit.slug);
    setError(null);
    try {
      const scope = everyRepository(kit.slug) ? "all-repositories" : "project";
      await api.requestKitInstallation(token, projectId, {
        kit_slug: kit.slug,
        version,
        install_mode: "copy",
        scope,
      });
      if (scope === "all-repositories") {
        // One call covers every repository, so there is no target to choose
        // and no point materializing one of them first.
        reconciled.current.add(`${kit.slug}@${version}`);
        await api.reconcileKitInstallation(token, projectId, kit.slug);
      } else {
        await api.materializeKitInstallation(token, projectId, kit.slug, targetFor(kit.slug));
      }
      await reload();
    } catch (cause) {
      await reload();
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
        Open this project's IDE first. Install requests are sent through the authenticated backend
        to its trusted <code>cfs</code> runner; the browser never executes repository scripts.
      </div>
      {repositoriesNote && (
        <div className="notice">
          The IDE has not reported its repositories yet, so a kit will be installed into the
          project repository. Open the IDE and press Refresh to choose a different one.
        </div>
      )}
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
                    Source policy
                    <input value="Official GitHub kit · managed copy" disabled />
                  </label>
                  {repositories && repositories.length > 1 && (
                    <label className="kit-scope">
                      <input
                        type="checkbox"
                        checked={everyRepository(kit.slug)}
                        onChange={(event) =>
                          setScopes((current) => ({
                            ...current,
                            [kit.slug]: event.target.checked,
                          }))
                        }
                      />
                      Install in every repository
                    </label>
                  )}
                  {repositories && repositories.length > 1 && !everyRepository(kit.slug) && (
                    <label>
                      Repository
                      <select
                        value={targetFor(kit.slug) ?? ""}
                        onChange={(event) =>
                          setTargets((current) => ({ ...current, [kit.slug]: event.target.value }))
                        }
                      >
                        {repositories.map((repository) => (
                          <option key={repository.repository_id} value={repository.repository_id}>
                            {repository.kind === "project"
                              ? `${repository.label} · whole project`
                              : repository.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                </div>
                {installation && (
                  <p className="sub">
                    Requested <code>{installation.version}</code> · {installation.install_mode} ·{" "}
                    {new Date(installation.requested_at).toLocaleString()}
                  </p>
                )}
                {installation && installation.materializations?.length ? (
                  <ul className="sub kit-materializations">
                    {installation.materializations.map((entry) => (
                      <li key={entry.repository_id}>
                        {repositoryLabel(entry)} · <code>{entry.version}</code> ·{" "}
                        {new Date(entry.materialized_at).toLocaleString()}
                        {entry.status === "failed" && (
                          <span className="badge failed"> failed</span>
                        )}
                      </li>
                    ))}
                  </ul>
                ) : null}
                {installation?.failure_reason && (
                  <div className="error">{installation.failure_reason}</div>
                )}
                <div className="inline kit-actions">
                  <button className="primary" disabled={isBusy} onClick={() => void install(kit)}>
                    {isBusy ? "Installing…" : installation ? "Reinstall / update" : "Install in IDE"}
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
