/* ── People & Team (concept v2, organization restored) ────────────────────────
 *
 * Two surfaces, one component:
 *
 *   mode="org"  — the organization's PEOPLE. Every account that belongs to the
 *                 organization (AM users owned by the org tenant). Inviting here
 *                 creates the account IN the organization — that part is real and
 *                 backend-backed (the org tenant becomes the person's home).
 *
 *   mode="team" — a project's TEAM. A subset of the organization's people who
 *                 work on this project. The platform can't record that today (an
 *                 AM user has exactly one owning tenant; a root project has no
 *                 Resource-Group member list of its own), so team membership is a
 *                 browser-local overlay — see `teamGrants` in roles.ts. It is
 *                 labelled unenforced and never sent to the backend, exactly like
 *                 the role overlay this screen already carries.
 */

import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
import { api, type Project, type User } from "./api";
import { errText, initials, matches } from "./format";
import {
  PROJECT_ROLES,
  ROLE_BLURB,
  ROLE_LABEL,
  effectiveRole,
  roleGrants,
  teamGrants,
  type ProjectRole,
} from "./roles";
import type { RootProject } from "./projects";

interface Person {
  user: User;
  /** True when this account is owned by the organization tenant itself. */
  homeIsOrg: boolean;
  /** Projects whose owning tenant IS this person (real, server-backed). */
  rootIds: string[];
  /** Nested projects (Works) they are a member of (Resource Group). */
  nested: Project[];
}

export function PeopleView({
  token,
  org,
  roots,
  mode,
  query,
  onOpenProject,
}: {
  token: string;
  /** Organization these accounts belong to. */
  org: { id: string; name: string } | null;
  /** Projects in scope. In team mode this is the single current project. */
  roots: RootProject[];
  mode: "org" | "team";
  query: string;
  onOpenProject: (rootId: string) => void;
}) {
  const [people, setPeople] = useState<Person[] | null>(null);
  const [username, setUsername] = useState("");
  const [addPick, setAddPick] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** Bumped after an overlay write so the table re-reads localStorage. */
  const [tick, setTick] = useState(0);

  const orgId = org?.id ?? null;
  const teamRoot = mode === "team" ? roots[0] ?? null : null;
  const ids = roots.map((r) => r.id).join(",");

  const load = useCallback(async () => {
    setError(null);
    const list = ids ? ids.split(",") : [];
    try {
      const [memberships, perRoot, orgUsers] = await Promise.all([
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
        orgId
          ? api.tenantUsers(token, orgId).then(
              (p) => p.items ?? [],
              () => [] as User[],
            )
          : Promise.resolve([] as User[]),
      ]);

      // group id → nested project, so a membership row can name a Work.
      const byGroup = new Map<string, Project>();
      for (const r of perRoot) {
        for (const p of r.projects) if (p.members_group_id) byGroup.set(p.members_group_id, p);
      }
      const nestedOf = new Map<string, Project[]>();
      for (const m of memberships) {
        const project = byGroup.get(m.group_id);
        if (!project) continue;
        nestedOf.set(m.resource_id, [...(nestedOf.get(m.resource_id) ?? []), project]);
      }

      const merged = new Map<string, Person>();
      const upsert = (u: User): Person => {
        let cur = merged.get(u.id);
        if (!cur) {
          cur = { user: u, homeIsOrg: false, rootIds: [], nested: nestedOf.get(u.id) ?? [] };
          merged.set(u.id, cur);
        }
        return cur;
      };
      for (const u of orgUsers) upsert(u).homeIsOrg = true;
      for (const r of perRoot) {
        for (const u of r.users) {
          const person = upsert(u);
          if (!person.rootIds.includes(r.id)) person.rootIds.push(r.id);
        }
      }
      setPeople([...merged.values()]);
    } catch (e) {
      setError(errText(e));
      setPeople([]);
    }
  }, [token, ids, orgId]);

  useEffect(() => {
    void load();
  }, [load]);

  const rootName = (id: string): string => roots.find((r) => r.id === id)?.name ?? id.slice(0, 8);

  /** Projects a person is on: real owning-tenant membership plus this session's
   *  team overlay. */
  function projectsOf(p: Person): { id: string; overlay: boolean }[] {
    const out = p.rootIds.map((id) => ({ id, overlay: false }));
    for (const r of roots) {
      if (out.some((o) => o.id === r.id)) continue;
      if (teamGrants.members(r.id).includes(p.user.id)) out.push({ id: r.id, overlay: true });
    }
    return out;
  }

  /* ── Organization invite (real) ── */
  async function invite(e: FormEvent) {
    e.preventDefault();
    if (!orgId || !username.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await api.inviteUser(token, orgId, {
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

  /* ── Team add / remove (overlay) ── */
  function addToTeam() {
    if (!teamRoot || !addPick) return;
    teamGrants.add(teamRoot.id, addPick);
    setAddPick("");
    setTick((t) => t + 1);
  }
  function removeFromTeam(userId: string) {
    if (!teamRoot) return;
    teamGrants.remove(teamRoot.id, userId);
    setTick((t) => t + 1);
  }

  const all = people ?? [];
  const filtered = all
    .filter((p) => matches(query, p.user.display_name, p.user.username, p.user.email))
    .sort((a, b) =>
      (a.user.display_name ?? a.user.username).localeCompare(b.user.display_name ?? b.user.username),
    );

  // Team membership (real owning-tenant + overlay) for the current project.
  const teamIds = new Set<string>();
  if (teamRoot) {
    for (const p of all) if (p.rootIds.includes(teamRoot.id)) teamIds.add(p.user.id);
    for (const id of teamGrants.members(teamRoot.id)) teamIds.add(id);
  }
  const teamPeople = teamRoot ? filtered.filter((p) => teamIds.has(p.user.id)) : [];
  const candidates = teamRoot
    ? all
        .filter((p) => !teamIds.has(p.user.id))
        .sort((a, b) =>
          (a.user.display_name ?? a.user.username).localeCompare(
            b.user.display_name ?? b.user.username,
          ),
        )
    : [];

  const overlayTotal = teamGrants.count();

  /* ── Organization People ── */
  if (mode === "org") {
    return (
      <>
        <div className="topbar">
          <div>
            <h1>People</h1>
            <p className="subtitle" style={{ margin: 0 }}>
              Everyone in {org?.name ?? "your organization"}. Invite a person to add them to the
              organization; put them on specific projects from a project's Team tab.
            </p>
          </div>
        </div>

        {error && <div className="error">{error}</div>}

        <div className="card">
          {people === null ? (
            <p className="hint">Loading people…</p>
          ) : !org ? (
            <p className="empty">No organization in context.</p>
          ) : filtered.length === 0 ? (
            <p className="empty">
              {all.length === 0
                ? "Nobody here yet — invite the first person below."
                : "Nobody matches the current filters."}
            </p>
          ) : (
            <table className="ptable people" key={tick}>
              <thead>
                <tr>
                  <th>Person</th>
                  <th>Belongs to</th>
                  <th>On projects</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((p) => {
                  const name = p.user.display_name ?? p.user.username;
                  const on = projectsOf(p);
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
                      <td className="sub">
                        {p.homeIsOrg ? org.name : rootName(p.rootIds[0] ?? "")}
                      </td>
                      <td>
                        <div className="chips">
                          {on.map((o) => (
                            <button
                              key={o.id}
                              type="button"
                              className={`chip${o.overlay ? "" : " on"}`}
                              title={o.overlay ? "Team assignment (concept overlay)" : "Open this project"}
                              onClick={() => onOpenProject(o.id)}
                            >
                              {rootName(o.id)}
                            </button>
                          ))}
                          {on.length === 0 && <span className="sub">not on a project</span>}
                        </div>
                      </td>
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
            <button className="primary" disabled={busy || !username.trim() || !org}>
              {busy ? "Inviting…" : "Invite to organization"}
            </button>
          </form>
          <p className="hint">
            The person is created in {org?.name ?? "the organization"} — that becomes their home
            tenant, the one part of access the platform enforces today. Assign them to projects from
            each project's Team tab.
          </p>
        </div>
      </>
    );
  }

  /* ── Project Team ── */
  return (
    <>
      <div className="topbar">
        <div>
          <h1>Team</h1>
          <p className="subtitle" style={{ margin: 0 }}>
            People working on {teamRoot?.name ?? "this project"} — a subset of{" "}
            {org?.name ?? "the organization"}. Add anyone from the organization below.
          </p>
        </div>
      </div>

      <div className="notice">
        <b>Team membership is a concept overlay.</b> The platform records one home tenant per
        account (the organization) and does not yet store a per-project team, so assignments here
        live in this browser and are never sent to the backend. Roles are likewise unenforced until
        the Studio PDP lands (ADR-0004).
        {overlayTotal > 0 && (
          <>
            {" "}
            <button
              className="ghost"
              onClick={() => {
                teamGrants.clear();
                roleGrants.clear();
                setTick((t) => t + 1);
              }}
            >
              reset {overlayTotal} local assignment{overlayTotal === 1 ? "" : "s"}
            </button>
          </>
        )}
      </div>

      {error && <div className="error">{error}</div>}

      <div className="card">
        {people === null ? (
          <p className="hint">Loading team…</p>
        ) : !teamRoot ? (
          <p className="empty">No project in context.</p>
        ) : teamPeople.length === 0 ? (
          <p className="empty">Nobody on the team yet — add someone from the organization below.</p>
        ) : (
          <table className="ptable people" key={tick}>
            <thead>
              <tr>
                <th>Person</th>
                <th>Role</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {teamPeople.map((p) => {
                const isOverlay = teamGrants.members(teamRoot.id).includes(p.user.id);
                const { role, granted } = effectiveRole(teamRoot.id, p.user.id, { isMember: true });
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
                          title={ROLE_BLURB[role]}
                          onChange={(e) => {
                            roleGrants.set(teamRoot.id, p.user.id, e.target.value as ProjectRole);
                            setTick((t) => t + 1);
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
                              : "Derived from membership"
                          }
                        >
                          {granted ? "local" : "derived"}
                        </span>
                      </div>
                    </td>
                    <td style={{ textAlign: "right" }}>
                      {isOverlay && (
                        <button
                          className="ghost"
                          title="Remove from this project's team"
                          onClick={() => removeFromTeam(p.user.id)}
                        >
                          Remove
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}

        <div className="inline" style={{ marginTop: 14, gap: 8 }}>
          <select value={addPick} onChange={(e) => setAddPick(e.target.value)}>
            <option value="">
              {candidates.length ? "Add from organization…" : "Everyone is already on the team"}
            </option>
            {candidates.map((p) => (
              <option key={p.user.id} value={p.user.id}>
                {p.user.display_name ?? p.user.username}
              </option>
            ))}
          </select>
          <button className="primary" disabled={!addPick} onClick={addToTeam}>
            Add to team
          </button>
        </div>
        <p className="hint">
          People come from {org?.name ?? "the organization"} — invite new accounts on the
          organization's People page, then add them to a project here.
        </p>
      </div>
    </>
  );
}
