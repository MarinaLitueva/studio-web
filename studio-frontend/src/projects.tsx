/* ── Projects portfolio (concept v2) ─────────────────────────────────────────
 *
 * ONE noun. In concept v2 the thing that used to be called a *workspace* IS a
 * project — it owns the sources, the automation level, the people and the IDE
 * sessions — and the effort containers the `studio-project` gear records are
 * *nested projects* inside it. Same word at both levels, because to the person
 * looking at the screen they are the same kind of thing at two granularities.
 *
 * What that costs on the wire, honestly:
 *   root project   = AM tenant of type `workspace` (api.tenantChildren)
 *   nested project = studio-project gear record  (api.projects?tenant=<root>)
 * The organization tenant above the roots still exists and still owns the
 * connector catalogue — it is simply not a place you can navigate to any more.
 */

import { useCallback, useEffect, useState } from "react";
import type { CSSProperties, FormEvent } from "react";
import { api, TENANT_TYPES, type Project, type User } from "./api";
import { errText, matches, relTime } from "./format";

/** Initials + a stable hue from a name — the mockups' colored member discs. */
function initials(name: string): string {
  const parts = name.trim().split(/[\s._@-]+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}
function hueOf(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
  return h;
}
/** Overlapping member avatars (real users from tenantUsers), +N overflow. */
function Avatars({ users }: { users?: User[] }) {
  if (!users) return <span className="sub">…</span>;
  if (users.length === 0) return <span className="sub">—</span>;
  return (
    <span className="avatars">
      {users.slice(0, 3).map((u) => {
        const label = u.display_name || u.username;
        return (
          <span
            key={u.id}
            className="avatar"
            style={{ "--hue": hueOf(label) } as CSSProperties}
            title={label}
          >
            {initials(label)}
          </span>
        );
      })}
      {users.length > 3 && <span className="avatars-more">+{users.length - 3}</span>}
    </span>
  );
}

/** A small folder glyph for the project name cell (root vs nested). */
function FolderIcon() {
  return (
    <svg className="folder" width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M1.6 4.4A1.4 1.4 0 0 1 3 3h2.8l1.4 1.4H13A1.4 1.4 0 0 1 14.4 5.8v5.0A1.4 1.4 0 0 1 13 12.2H3A1.4 1.4 0 0 1 1.6 10.8z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** The AM tenant behind a root project — structurally what App.tsx holds. */
export interface RootProject {
  id: string;
  name: string;
  /** Implicit organization owning it. Hidden in the UI, kept in the model. */
  orgId: string;
  orgName: string;
  self_managed: boolean;
}

/** Root status is DERIVED, not stored — the tooltip says so wherever it shows. */
function rootStatus(nested: Project[] | undefined): { label: string; tone: string } {
  if (!nested) return { label: "…", tone: "" };
  if (nested.some((p) => p.status === "active")) return { label: "active", tone: "ok" };
  if (nested.length === 0) return { label: "setup", tone: "warn" };
  if (nested.every((p) => p.status === "archived")) return { label: "archived", tone: "" };
  return { label: "draft", tone: "warn" };
}

export function ProjectsPortfolio({
  token,
  roots,
  query,
  selfManagedOnly,
  sort,
  homeOrgId,
  onOpen,
  onOpenNested,
  onOpenStudio,
  onChanged,
}: {
  token: string;
  roots: RootProject[];
  /** Search box from the right-hand filter panel. */
  query: string;
  /** Filter panel: only projects whose tenant raised the isolation barrier. */
  selfManagedOnly: boolean;
  sort: "name-asc" | "name-desc";
  /** Where a new root project is created — the hidden organization. */
  homeOrgId: string | null;
  onOpen: (root: RootProject) => void;
  onOpenNested: (root: RootProject, project: Project) => void;
  onOpenStudio: (root: RootProject) => void;
  onChanged: () => void;
}) {
  const [nested, setNested] = useState<Record<string, Project[]>>({});
  const [people, setPeople] = useState<Record<string, User[]>>({});
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ids = roots.map((r) => r.id).join(",");

  const load = useCallback(async () => {
    if (!ids) {
      setNested({});
      setPeople({});
      return;
    }
    const list = ids.split(",");
    // Per root, and tolerant: a self-managed root answers 404 from outside its
    // subtree, which is tenant isolation working — not a reason to blank the page.
    const entries = await Promise.all(
      list.map(async (id) => {
        const [projects, users] = await Promise.all([
          api.projects(token, id).then(
            (p) => p.items ?? [],
            () => [] as Project[],
          ),
          api.tenantUsers(token, id).then(
            (p) => p.items ?? [],
            () => [] as User[],
          ),
        ]);
        return [id, projects, users] as const;
      }),
    );
    setNested(Object.fromEntries(entries.map(([id, p]) => [id, p])));
    setPeople(Object.fromEntries(entries.map(([id, , u]) => [id, u])));
  }, [token, ids]);

  useEffect(() => {
    void load();
  }, [load]);

  async function create(e: FormEvent) {
    e.preventDefault();
    if (!homeOrgId || !name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api.createTenant(token, {
        name: name.trim(),
        parent_id: homeOrgId,
        tenant_type: TENANT_TYPES.workspace,
      });
      setName("");
      setCreating(false);
      onChanged();
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove(root: RootProject) {
    const children = nested[root.id] ?? [];
    if (children.length > 0) {
      window.alert(
        `“${root.name}” still has ${children.length} nested project(s). Delete those first — ` +
          `a project is not a folder you can drop with its contents inside.`,
      );
      return;
    }
    if (!window.confirm(`Delete project “${root.name}”? This cannot be undone.`)) return;
    setError(null);
    try {
      await api.deleteTenant(token, root.id);
      onChanged();
    } catch (err) {
      setError(errText(err));
    }
  }

  function toggle(id: string) {
    setCollapsed((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // A root matches the search when it matches by name OR one of its nested
  // projects does — hiding a parent whose child matched would hide the match.
  const visible = roots
    .filter((r) => matches(query, r.name) || (nested[r.id] ?? []).some((p) => matches(query, p.name)))
    .filter((r) => !selfManagedOnly || r.self_managed)
    .sort((a, b) => (sort === "name-desc" ? b.name.localeCompare(a.name) : a.name.localeCompare(b.name)));

  const nestedCount = visible.reduce((n, r) => n + (nested[r.id] ?? []).length, 0);

  return (
    <>
      <div className="topbar">
        <div>
          <h1>Projects</h1>
          <p className="subtitle" style={{ margin: 0 }}>
            Every project owns its sources, its automation level and its people. Open one to work
            inside it; nested projects are the efforts running within it.
          </p>
        </div>
        <button className="primary" disabled={!homeOrgId} onClick={() => setCreating((v) => !v)}>
          New project
        </button>
      </div>

      {creating && (
        <div className="card">
          <form className="inline" onSubmit={create}>
            <input
              autoFocus
              style={{ flex: 1 }}
              placeholder="Project name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <button className="primary" disabled={busy || !name.trim()}>
              {busy ? "Creating…" : "Create"}
            </button>
            <button type="button" className="ghost" onClick={() => setCreating(false)}>
              cancel
            </button>
          </form>
          <p className="hint">
            Created inside your organization — which stays out of the UI on purpose: it owns the
            shared connector catalogue and nothing you need to navigate.
          </p>
        </div>
      )}

      {error && <div className="error">{error}</div>}

      <div className="card">
        {roots.length === 0 ? (
          <p className="empty">No projects yet — “New project” starts the first one.</p>
        ) : visible.length === 0 ? (
          <p className="empty">No projects match the current filters.</p>
        ) : (
          <table className="ptable">
            <thead>
              <tr>
                <th>Project</th>
                <th>Status</th>
                <th>People</th>
                <th>Updated</th>
                <th aria-label="actions" />
              </tr>
            </thead>
            <tbody>
              {visible.map((root) => {
                const children = nested[root.id] ?? [];
                const shut = collapsed.has(root.id);
                const st = rootStatus(nested[root.id]);
                const latest = children
                  .map((p) => p.updated_at)
                  .sort()
                  .at(-1);
                return [
                  <tr key={root.id} className="prow root">
                    <td>
                      <div className="pcell">
                        <button
                          type="button"
                          className={`twisty ${children.length === 0 ? "empty" : shut ? "" : "open"}`}
                          title={children.length === 0 ? "No nested projects" : shut ? "Expand" : "Collapse"}
                          disabled={children.length === 0}
                          onClick={() => toggle(root.id)}
                        >
                          ▸
                        </button>
                        <span className="pico" aria-hidden>
                          <FolderIcon />
                        </span>
                        <div>
                          <button type="button" className="pname" onClick={() => onOpen(root)}>
                            {root.name}
                          </button>
                          <div className="sub">
                            {children.length === 0
                              ? "no nested projects yet"
                              : `+${children.length} nested project${children.length === 1 ? "" : "s"}`}
                            {root.self_managed ? " · self-managed" : ""}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td>
                      <span
                        className={`badge ${st.tone}`}
                        title="Derived from the nested projects — a root project has no status of its own yet"
                      >
                        {st.label}
                      </span>
                    </td>
                    <td>
                      <Avatars users={people[root.id]} />
                    </td>
                    <td className="sub">{latest ? relTime(latest) : "—"}</td>
                    <td className="pactions">
                      <button onClick={() => onOpen(root)}>Open</button>
                      <button className="primary" onClick={() => onOpenStudio(root)}>
                        Open Studio
                      </button>
                      <button className="ghost" title="Delete project" onClick={() => void remove(root)}>
                        ✕
                      </button>
                    </td>
                  </tr>,
                  ...(shut
                    ? []
                    : children
                        .filter((p) => matches(query, p.name) || matches(query, root.name))
                        .map((p) => (
                          <tr key={p.id} className="prow nested">
                            <td>
                              <div className="pcell indent">
                                <span className="pico nest" aria-hidden>
                                  ↳
                                </span>
                                <div>
                                  <button
                                    type="button"
                                    className="pname"
                                    onClick={() => onOpenNested(root, p)}
                                  >
                                    {p.name}
                                  </button>
                                  <div className="sub">Child of {root.name}</div>
                                </div>
                              </div>
                            </td>
                            <td>
                              <span
                                className={`badge ${p.status === "active" ? "ok" : p.status === "draft" ? "warn" : ""}`}
                              >
                                {p.status}
                              </span>
                            </td>
                            <td className="sub">
                              {p.members_available ? "group" : (
                                <span title="No Resource Group member list was created for this project">
                                  none
                                </span>
                              )}
                            </td>
                            <td className="sub">{relTime(p.updated_at)}</td>
                            <td className="pactions">
                              <button onClick={() => onOpenNested(root, p)}>Open</button>
                            </td>
                          </tr>
                        ))),
                ];
              })}
            </tbody>
          </table>
        )}
        {visible.length > 0 && (
          <div className="ptable-foot">
            <span>
              {visible.length} project{visible.length === 1 ? "" : "s"}
              {nestedCount > 0 ? ` · ${nestedCount} nested` : ""}
            </span>
            <span className="sub">Organizations are hidden by design — the model still has them</span>
          </div>
        )}
      </div>
    </>
  );
}
