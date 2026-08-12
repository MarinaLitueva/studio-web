/* ── Project-scoped roles (concept v2) ────────────────────────────────────────
 *
 * The concept: a **Project** is the only unit of work in the UI, and access is
 * granted *inside a project*. There is no organization-wide role — the
 * organization tenant still exists in the platform (it owns the connector
 * catalogue and the tenant hierarchy), but nobody is an "Org owner" any more,
 * because nobody sees an organization.
 *
 * Enforcement: NONE yet. ADR-0004 parked Role Grants behind the Studio PDP
 * (authz is allow-all today), and a role picker that pretends otherwise is an
 * illusion of access control. So this module is deliberately two halves:
 *
 *   1. `deriveRole` — what the SERVER can already prove. A project's
 *      `created_by` is its owner; membership in the project's Resource Group
 *      makes you a member. That part is real.
 *   2. `roleGrants` — a browser-local overlay so the People screen can be
 *      exercised in this concept branch. It is scoped per project, labelled as
 *      unenforced everywhere it surfaces, and never sent to the backend.
 *
 * When the PDP lands, (2) is deleted and replaced by real Role Grant calls;
 * (1) survives as the fallback for projects with no explicit grant.
 */

/** Roles a project can grant. Ordered from most to least privileged. */
export const PROJECT_ROLES = ["owner", "admin", "editor", "viewer"] as const;

export type ProjectRole = (typeof PROJECT_ROLES)[number];

export const ROLE_LABEL: Record<ProjectRole, string> = {
  owner: "Owner",
  admin: "Admin",
  editor: "Editor",
  viewer: "Viewer",
};

export const ROLE_BLURB: Record<ProjectRole, string> = {
  owner: "Created the project — can delete it and hand it over",
  admin: "Manages people, sources and automation of this project",
  editor: "Works in the project: sessions, documents, runs",
  viewer: "Reads the project and its findings",
};

/** What the backend can already prove about someone's standing in a project. */
export interface RoleEvidence {
  /** The project record's `created_by` (nested projects) — real ownership. */
  createdBy?: string | null;
  /** Is the person in the project's Resource Group member list? */
  isMember?: boolean;
}

/**
 * The role we can defend from server state alone.
 *
 * Deliberately conservative, and deliberately missing `admin`: nothing the
 * control plane records today proves that someone may administer a project.
 * Being *in scope* of a project (it is your home tenant) is not authority, it
 * is reachability — so it derives `viewer`. Admin exists only as an explicit
 * grant, which is exactly the gap the Studio PDP closes. Guessing upward is how
 * a demo turns into a wrong claim about who may change what.
 */
export function deriveRole(userId: string, ev: RoleEvidence): ProjectRole {
  if (ev.createdBy && ev.createdBy === userId) return "owner";
  if (ev.isMember) return "editor";
  return "viewer";
}

/* ── Browser-local grant overlay (concept branch only) ── */

const STORE_KEY = "studio.concept.roleGrants";

type GrantMap = Record<string, Record<string, ProjectRole>>;

function readStore(): GrantMap {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as GrantMap) : {};
  } catch {
    return {}; // private mode / corrupt value — behave as if nothing was granted
  }
}

function writeStore(map: GrantMap): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(map));
  } catch {
    /* non-fatal: the overlay is a prototyping aid, not state we owe anyone */
  }
}

export const roleGrants = {
  /** An explicit grant for this person in this project, if one was made here. */
  get(projectId: string, userId: string): ProjectRole | null {
    return readStore()[projectId]?.[userId] ?? null;
  },

  /** Grant (or re-grant) a role. `null` clears it back to the derived value. */
  set(projectId: string, userId: string, role: ProjectRole | null): void {
    const map = readStore();
    const forProject = { ...(map[projectId] ?? {}) };
    if (role) forProject[userId] = role;
    else delete forProject[userId];
    if (Object.keys(forProject).length === 0) delete map[projectId];
    else map[projectId] = forProject;
    writeStore(map);
  },

  /** Every explicit grant in this project. */
  all(projectId: string): Record<string, ProjectRole> {
    return { ...(readStore()[projectId] ?? {}) };
  },

  /** Drop the whole overlay — the "back to what the server says" button. */
  clear(): void {
    try {
      localStorage.removeItem(STORE_KEY);
    } catch {
      /* non-fatal */
    }
  },
};

/** The effective role: an explicit grant wins, otherwise what we can prove. */
export function effectiveRole(
  projectId: string,
  userId: string,
  ev: RoleEvidence,
): { role: ProjectRole; granted: boolean } {
  const granted = roleGrants.get(projectId, userId);
  return granted ? { role: granted, granted: true } : { role: deriveRole(userId, ev), granted: false };
}
