/* ── People (concept v2) ──────────────────────────────────────────────────────
 *
 * Access is granted INSIDE a project. There is no organization-wide role any
 * more — no "Org owner" chip — because in concept v2 nobody navigates to an
 * organization: it is a hidden container that owns the shared connector
 * catalogue and the tenant hierarchy, nothing a person is a citizen *of*.
 *
 * What is real here and what is not:
 *   real — the person list (AM users per project tenant), which project is
 *          their access scope (their home tenant, set by the invite), and
 *          nested-project membership (Resource Group memberships).
 *   not  — enforcement of the role itself. ADR-0004 parks Role Grants behind
 *          the Studio PDP; authz is allow-all today. The role column is
 *          therefore labelled unenforced, and edits land in a browser-local
 *          overlay (see roles.ts) so this screen can be exercised without
 *          anyone believing access control shipped.
 */

import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { api, USER_MEMBER_HANDLE, type Project, type User } from "./api";
import { errText, initials, matches } from "./format";
import {
  PROJECT_ROLES,
  ROLE_BLURB,
  ROLE_LABEL,
  effectiveRole,
  roleGrants,
  type ProjectRole,
} from "./roles";
import type { RootProject } from "./projects";

interface Person {
  user: User;
  /** Root project that is this person's access scope (their home tenant). */
  homeRootId: string | null;
  /** Root projects they are listed in. */
  rootIds: string[];
  /** Nested projects they are a member of. */
  nested: Project[];
}

export function PeopleView({
  token,
  roots,
  query,
  onOpenProject,
}: {
  token: string;
  roots: RootProject[];
  query: string;
  onOpenProject: (rootId: string) => void;
}) {
  const [people, setPeople] = useState<Person[] | null>(null);
  const [nestedByRoot, setNestedByRoot] = useState<Record<string, Project[]>>({});
  /** "" = judge everyone in their own home project. */
  const [scope, setScope] = useState("");
  const [inviteTo, setInviteTo] = useState("");
  const [username, setUsername] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** Bumped after an overlay write so the table re-reads localStorage. */
  const [grantTick, setGrantTick] = useState(0);

  const ids = roots.map((r) => r.id).join(",");

  const load = useCallback(async () => {
    setError(null);
    if (!ids) {
      setPeople([]);
      setNestedByRoot({});
      return;
    }
    const list = ids.split(",");
    try {
      // One memberships call for the whole platform — the gear has no
      // per-group filter, and asking once beats asking per project.
      const [memberships, perRoot] = await Promise.all([
        api.memberships(token).then(
          (p) => p.items ?? [],
          () => [],
        ),
        Promise.all(
          list.map(async (id) => {
            const [users, projects] = await Promise.all([
              api.tenantUsers(token, id).then(
                (p) => p.items ?? [],
                () => [] as User[],
              ),
              api.projects(token, id).then(
                (p) => p.items ?? [],
                () => [] as Project[],
              ),
            ]);
            return { id, users, projects };
          }),
        ),
      ]);

      setNestedByRoot(Object.fromEntries(perRoot.map((r) => [r.id, r.projects])));

      // group id → nested project, so a membership row can name a project.
      const byGroup = new Map<string, Project>();
      for (const r of perRoot) {
        for (const p of r.projects) if (p.members_group_id) byGroup.set(p.members_group_id, p);
      }
      const nestedOf = new Map<string, Project[]>();
      for (const m of memberships) {
        if (m.resource_type !== USER_MEMBER_HANDLE) continue;
        const project = byGroup.get(m.group_id);
        if (!project) continue;
        nestedOf.set(m.resource_id, [...(nestedOf.get(m.resource_id) ?? []), project]);
      }

      const merged = new Map<string, Person>();
      for (const r of perRoot) {
        for (const u of r.users) {
          const cur = merged.get(u.id);
          if (cur) cur.rootIds.push(r.id);
          else
            merged.set(u.id, {
              user: u,
              // Listed under a project tenant IS the home-tenant relation AM
              // records — the first one wins if the platform ever lists more.
              homeRootId: r.id,
              rootIds: [r.id],
              nested: nestedOf.get(u.id) ?? [],
            });
        }
      }
      setPeople([...merged.values()]);
    } catch (e) {
      setError(errText(e));
      setPeople([]);
    }
  }, [token, ids]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    // Default the invite target to the only project, when there is only one.
    if (!inviteTo && roots.length === 1) setInviteTo(roots[0].id);
  }, [roots, inviteTo]);

  async function invite(e: FormEvent) {
    e.preventDefault();
    if (!inviteTo || !username.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api.inviteUser(token, inviteTo, {
        username: username.trim(),
        email: `${username.trim()}@example.com`,
        display_name: username.trim(),
      });
      setUsername("");
      await load();
    } catch (err) {
      setError(errText(err));
    } finally {
      setBusy(false);
    }
  }

  const rootName = (id: string): string => roots.find((r) => r.id === id)?.name ?? id.slice(0, 8);

  /** Which project this row's role is about, and the evidence backing it.
   *
   *  With no scope chosen, the row speaks about the MOST SPECIFIC project the
   *  person belongs to — a nested project they are a member of, else the project
   *  that is their access scope. Judging everyone by their root project would
   *  print the same word on every row, which tells you nothing. */
  function roleContext(p: Person): {
    projectId: string | null;
    label: string;
    createdBy?: string | null;
    isMember: boolean;
  } {
    if (scope) {
      const nested = Object.values(nestedByRoot)
        .flat()
        .find((n) => n.id === scope);
      if (nested) {
        return {
          projectId: nested.id,
          label: nested.name,
          createdBy: nested.created_by,
          isMember: p.nested.some((n) => n.id === nested.id),
        };
      }
      return { projectId: scope, label: rootName(scope), isMember: p.rootIds.includes(scope) };
    }
    const own = p.nested[0];
    if (own) {
      return { projectId: own.id, label: own.name, createdBy: own.created_by, isMember: true };
    }
    return p.homeRootId
      ? { projectId: p.homeRootId, label: rootName(p.homeRootId), isMember: false }
      : { projectId: null, label: "—", isMember: false };
  }

  const visible = (people ?? [])
    .filter((p) => matches(query, p.user.display_name, p.user.username, p.user.email))
    .filter((p) => {
      if (!scope) return true;
      const nested = Object.values(nestedByRoot)
        .flat()
        .find((n) => n.id === scope);
      return nested ? p.nested.some((n) => n.id === nested.id) : p.rootIds.includes(scope);
    })
    .sort((a, b) =>
      (a.user.display_name ?? a.user.username).localeCompare(b.user.display_name ?? b.user.username),
    );

  const overlayCount = Object.keys(nestedByRoot)
    .flatMap((id) => [id, ...(nestedByRoot[id] ?? []).map((p) => p.id)])
    .reduce((n, id) => n + Object.keys(roleGrants.all(id)).length, 0);

  return (
    <>
      <div className="topbar">
        <div>
          <h1>People</h1>
          <p className="subtitle" style={{ margin: 0 }}>
            Access is granted inside a project. Roles are project-scoped — there is no
            organization-wide role, because there is no organization to be a member of.
          </p>
        </div>
        <div className="inline" style={{ gap: 8 }}>
          <select value={scope} onChange={(e) => setScope(e.target.value)} title="Whose access to show">
            <option value="">Role in each person's own project</option>
            {roots.map((r) => (
              <optgroup key={r.id} label={r.name}>
                <option value={r.id}>{r.name} (project)</option>
                {(nestedByRoot[r.id] ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    ↳ {p.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </div>
      </div>

      <div className="notice">
        <b>Roles are not enforced yet.</b> Authorization is allow-all until the Studio PDP lands
        (ADR-0004, phase 3), so what you change here is a concept overlay kept in this browser —
        never sent to the backend. <i>Owner</i> and <i>Editor</i> are still derived from real server
        state (who created the project, who is in its member group); <i>Admin</i> exists only as a
        grant, because nothing recorded today proves it.
        {overlayCount > 0 && (
          <>
            {" "}
            <button
              className="ghost"
              onClick={() => {
                roleGrants.clear();
                setGrantTick((t) => t + 1);
              }}
            >
              reset {overlayCount} local grant{overlayCount === 1 ? "" : "s"}
            </button>
          </>
        )}
      </div>

      {error && <div className="error">{error}</div>}

      <div className="card">
        {people === null ? (
          <p className="hint">Loading people…</p>
        ) : roots.length === 0 ? (
          <p className="empty">No projects yet — people are invited into a project.</p>
        ) : visible.length === 0 ? (
          <p className="empty">
            {people.length === 0 ? "Nobody here yet — invite the first person below." : "Nobody matches the current filters."}
          </p>
        ) : (
          <table className="ptable people" key={grantTick}>
            <thead>
              <tr>
                <th>Person</th>
                <th>Access</th>
                <th>Projects</th>
                <th>Role in</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((p) => {
                const ctx = roleContext(p);
                const { role, granted } = ctx.projectId
                  ? effectiveRole(ctx.projectId, p.user.id, {
                      createdBy: ctx.createdBy,
                      isMember: ctx.isMember,
                    })
                  : { role: "viewer" as ProjectRole, granted: false };
                const name = p.user.display_name ?? p.user.username;
                return (
                  <tr key={p.user.id} className="prow">
                    <td>
                      <div className="pcell">
                        <span className="account-avatar small">{initials(name)}</span>
                        <div>
                          <div className="pname plain">{name}</div>
                          <div className="sub">{p.user.email ?? p.user.username}</div>
                        </div>
                      </div>
                    </td>
                    <td>
                      <div className="inline" style={{ gap: 6, alignItems: "center" }}>
                        <select
                          value={role}
                          disabled={!ctx.projectId}
                          title={ROLE_BLURB[role]}
                          onChange={(e) => {
                            if (!ctx.projectId) return;
                            roleGrants.set(ctx.projectId, p.user.id, e.target.value as ProjectRole);
                            setGrantTick((t) => t + 1);
                          }}
                        >
                          {PROJECT_ROLES.map((r) => (
                            <option key={r} value={r}>
                              {ROLE_LABEL[r]}
                            </option>
                          ))}
                        </select>
                        <span
                          className={`badge ${granted ? "warn" : ""}`}
                          title={
                            granted
                              ? "Local concept grant — not enforced, not stored server-side"
                              : "Derived from server state (created_by / access scope / membership)"
                          }
                        >
                          {granted ? "local" : "derived"}
                        </span>
                      </div>
                    </td>
                    <td>
                      <div className="chips">
                        {p.rootIds.map((id) => (
                          <button
                            key={id}
                            type="button"
                            className="chip on"
                            title="Open this project"
                            onClick={() => onOpenProject(id)}
                          >
                            {rootName(id)}
                          </button>
                        ))}
                        {p.nested.map((n) => (
                          <span key={n.id} className="chip" title={`Nested in ${rootName(n.workspace_id)}`}>
                            ↳ {n.name}
                          </span>
                        ))}
                        {p.rootIds.length === 0 && p.nested.length === 0 && (
                          <span className="sub">no project</span>
                        )}
                      </div>
                    </td>
                    <td className="sub">{ctx.label}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        <form className="inline" onSubmit={invite} style={{ marginTop: 14 }}>
          <input
            placeholder="username to invite"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
          <select value={inviteTo} onChange={(e) => setInviteTo(e.target.value)}>
            <option value="">into project…</option>
            {roots.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
          <button className="primary" disabled={busy || !username.trim() || !inviteTo}>
            {busy ? "Inviting…" : "Invite person"}
          </button>
        </form>
        <p className="hint">
          The project you invite into becomes the person's access scope — the platform records it as
          their home tenant, and it is the one thing about access that is enforced today.
        </p>
      </div>
    </>
  );
}
