# Feature: Workspaces in scope

<!-- toc -->

- [1. Feature Context](#1-feature-context)
  - [1.1 Overview](#11-overview)
  - [1.2 Purpose](#12-purpose)
  - [1.3 Actors](#13-actors)
  - [1.4 References](#14-references)
- [2. Actor Flows (CDSL)](#2-actor-flows-cdsl)
  - [Create a workspace](#create-a-workspace)
  - [Switch the workspace in scope](#switch-the-workspace-in-scope)
- [3. Processes / Business Logic (CDSL)](#3-processes--business-logic-cdsl)
  - [Resolve the organization's workspaces](#resolve-the-organizations-workspaces)
  - [Write the workspace](#write-the-workspace)
- [4. States (CDSL)](#4-states-cdsl)
  - [Workspace Slot State Machine](#workspace-slot-state-machine)
- [5. Definitions of Done](#5-definitions-of-done)
  - [The shell owns the workspace list](#the-shell-owns-the-workspace-list)
  - [The workspace has its own slot next to the organization](#the-workspace-has-its-own-slot-next-to-the-organization)
  - [Creation is an overlay extension with one field](#creation-is-an-overlay-extension-with-one-field)
  - [A created workspace reaches the shell and becomes current](#a-created-workspace-reaches-the-shell-and-becomes-current)
  - [The projects list is rooted at the workspace](#the-projects-list-is-rooted-at-the-workspace)
  - [A project is created inside the current workspace](#a-project-is-created-inside-the-current-workspace)
  - [Without a workspace there is nothing to create a project in](#without-a-workspace-there-is-nothing-to-create-a-project-in)
- [6. Acceptance Criteria](#6-acceptance-criteria)

<!-- /toc -->

- [ ] `p1` - **ID**: `cpt-studiofrontend-featstatus-workspace-scope`

## 1. Feature Context

### 1.1 Overview

The workspace a session is working in: created from the Projects list, chosen in
the shell's top bar next to the organization, and applied to everything below —
the Projects list shows that workspace's projects, and a new project is created
inside it.

### 1.2 Purpose

A project is an account-management tenant, and the level it belongs in is the
**workspace** (ADR-0010). Until now the portal had no workspace anywhere: the
Projects list read the organization's children and the wizard created projects
directly under the organization. This feature introduces the missing level.

The backend permits both parents — `allowed_parent_types` for
`cf.studio.tenant.project.v1` names the organization *and* the workspace — so
what the wizard did was accepted rather than refused. The choice made here is
the portal's: every project it creates goes into a workspace, and the list shows
one workspace at a time. A project parented straight to an organization (seeded,
or written by another client) is therefore not listed anywhere; nothing in the
portal produces one.

**Assumptions fixed here**, because the mockups are silent and the choice
changes the code:

- A workspace is created **under the organization** in scope, and carries a name
  and nothing else. There is no description, no template and no member picker:
  account-management accepts `name`, `parent_id` and `tenant_type` on create, and
  a field the backend would drop is not offered.
- The **shell owns** the workspace list, as it already owns the organization
  list: both are account-management tenants the shell reads for the top bar, and
  a list that must exist before any MFE mounts cannot be an MFE's to publish.
- **One workspace is always current** when the organization has any. There is no
  "all workspaces" scope: the tenant API has no subtree read, so a list across
  workspaces would be one request per workspace and still incomplete.
- The **first** workspace of the list becomes current on arrival, and a created
  one becomes current immediately. The selection is not persisted between
  sessions; nothing in the portal persists per-user preferences yet.

### 1.3 Actors

Named, not identified — a FEATURE may only define `algo`, `dod`, `featstatus`,
`flow` and `state` ids. See the same note in `project-create.md`.

| Actor | Role in Feature |
|-------|-----------------|
| **Member** | A signed-in member of the organization in scope. Creates workspaces and chooses the current one. |
| **Shell** | The portal shell. Reads the organization's workspaces, draws the switcher next to the organization, and publishes the current one to every MFE. |

### 1.4 References

- **ADR**: [ADR-0010 — a project is an AM tenant](../../../../docs/adr/0010-projects-are-am-tenants.md)
- **ADR**: [ADR-0008 — simplified navigation shell](../../../../docs/adr/0008-simplified-navigation-shell.md)
- **Feature**: [Create a project](project-create.md) — the parent it creates under is this feature's answer
- **Dependencies**: account-management (`/cf/account-management/v1`)

## 2. Actor Flows (CDSL)

Unchecked on purpose, for the reason stated in `project-create.md`: a checked
flow obliges every instruction to carry a code marker, and these span the shell,
two MFE roots and the extension plumbing between them. Their evidence is the
acceptance criteria in section 6; the implementation claims they rest on are the
Definitions of Done, which are traced.

**Use case**: work inside a workspace.

### Create a workspace

- [ ] `p1` - **ID**: `cpt-studiofrontend-flow-workspace-scope-create`

**Actor**: Member

**Success Scenarios**:
- The workspace appears in the shell's switcher, becomes the current one, and the Projects list is empty and rooted in it.

**Error Scenarios**:
- The name duplicates a sibling workspace; account-management refuses and the form keeps the name.
- There is no organization in scope; the form refuses to submit and says so.

**Steps**:
1. [ ] - `p1` - Member activates "New workspace" in the Projects list toolbar - `inst-1`
2. [ ] - `p1` - Mount the workspace overlay extension in the shell's overlay domain - `inst-2`
3. [ ] - `p1` - Reset the form so no abandoned name is carried in - `inst-3`
4. [ ] - `p1` - Member types a name and confirms - `inst-4`
5. [ ] - `p1` - Run `cpt-studiofrontend-algo-workspace-scope-write` - `inst-5`
6. [ ] - `p1` - **IF** account-management refuses - `inst-6`
   1. [ ] - `p1` - **RETURN** the overlay stays open with the name intact and reports the refusal - `inst-7`
7. [ ] - `p1` - Announce the created workspace to the shell so it enters the switcher and becomes current - `inst-8`
8. [ ] - `p1` - **RETURN** unmount the overlay extension - `inst-9`

### Switch the workspace in scope

- [ ] `p1` - **ID**: `cpt-studiofrontend-flow-workspace-scope-switch`

**Actor**: Member

**Success Scenarios**:
- The Projects list shows the chosen workspace's projects and nothing else.

**Error Scenarios**:
- The organization has no workspace; the switcher shows nothing and "New project" is inert.

**Steps**:
1. [ ] - `p1` - Member opens the workspace slot in the top bar - `inst-1`
2. [ ] - `p1` - Member picks a workspace - `inst-2`
3. [ ] - `p1` - The shell makes it current and publishes it as a shared property - `inst-3`
4. [ ] - `p1` - **IF** a project was open - `inst-4`
   1. [ ] - `p1` - Leave project scope: the open project belongs to the workspace being left - `inst-5`
5. [ ] - `p1` - **RETURN** the Projects list re-roots on the workspace and reads its children - `inst-6`

## 3. Processes / Business Logic (CDSL)

### Resolve the organization's workspaces

- [x] `p2` - **ID**: `cpt-studiofrontend-algo-workspace-scope-resolve`

**Input**: the organization tenant in scope

**Output**: the workspaces to offer, and which of them is current

**Steps**:
1. [x] - `p1` - `API: GET /cf/account-management/v1/tenants/{org}/children?$filter=tenant_type eq '{workspace type}' (one page)` - `inst-1`
2. [x] - `p1` - **IF** the read fails - `inst-2`
   1. [x] - `p1` - **RETURN** an empty list rather than a stale one; the slot then offers nothing - `inst-3`
3. [x] - `p1` - Keep the current workspace if it is still in the list, otherwise take the first - `inst-4`
4. [x] - `p1` - **RETURN** the list and the current workspace - `inst-5`

### Write the workspace

- [x] `p2` - **ID**: `cpt-studiofrontend-algo-workspace-scope-write`

**Input**: a name and the organization tenant in scope

**Output**: the created tenant, or the reason it was refused

**Steps**:
1. [x] - `p1` - Trim the name; reject an empty one before any request - `inst-1`
2. [x] - `p1` - `API: POST /cf/account-management/v1/tenants (name, workspace tenant type, parent = organization)` - `inst-2`
3. [x] - `p1` - **IF** account-management refuses - `inst-3`
   1. [x] - `p1` - **RETURN** the refusal; the name survives so the member can correct it - `inst-4`
4. [x] - `p1` - **RETURN** the created tenant's id and name - `inst-5`

## 4. States (CDSL)

### Workspace Slot State Machine

- [ ] `p2` - **ID**: `cpt-studiofrontend-state-workspace-scope-slot`

**States**: Unresolved, Empty, Selected

**Initial State**: Unresolved

**Transitions**:
1. [ ] - `p1` - **FROM** Unresolved **TO** Selected **WHEN** the organization's workspaces are read and at least one exists - `inst-1`
2. [ ] - `p1` - **FROM** Unresolved **TO** Empty **WHEN** the organization has no workspace, or the read failed - `inst-2`
3. [ ] - `p1` - **FROM** Empty **TO** Selected **WHEN** a workspace is created - `inst-3`
4. [ ] - `p1` - **FROM** Selected **TO** Unresolved **WHEN** the organization is switched - `inst-4`

## 5. Definitions of Done

### The shell owns the workspace list

- [x] `p1` - **ID**: `cpt-studiofrontend-dod-workspace-scope-shell-owns`

The system **MUST** read the organization's workspaces in the shell, keep the
current one in the shell's own context state, and publish it to the MFEs as a
shared property — never derive it inside an MFE.

Same split as the organization, and for the same reason: workspaces are
account-management tenants, which the shell already talks to, and the answer is
needed by the top bar before any MFE has mounted. Publishing it is the only
host → child channel that survives an MFE's module realm.

**Implements**:
- `cpt-studiofrontend-algo-workspace-scope-resolve`

**Touches**:
- API: `GET /cf/account-management/v1/tenants/{id}/children`
- Property: `constructor_studio.context.workspace.selected.v1~`
- Entities: `appContextSlice`, `appContextEffects`, `sharedContext`

### The workspace has its own slot next to the organization

- [x] `p1` - **ID**: `cpt-studiofrontend-dod-workspace-scope-slot`

The system **MUST** show the current workspace in the top bar next to the
organization, as its own slot with its own menu, and **MUST** render nothing at
all when the organization has no workspace **or when the mounted screen does not
work in a workspace**.

A second slot rather than a third scope of the existing one: the organization
and the workspace are both in scope at the same time, while the existing slot's
`org`/`project` scopes are alternatives to each other.

Which screens those are is **not** a list kept in the shell. The screen turns the
slot on for itself, by executing the workspaces action against the screen domain
when it mounts; the shell turns it off when the drawer mounts another screen.
That is the mechanism the project slot beside it already uses, and one top bar
governed by one mechanism is worth more than either rule chosen alone.

Visibility only: the chosen workspace stays chosen and stays published while an
organization-scoped screen is open, or navigating to People and back would lose
the scope and the overlays would open without a parent.

**Implements**:
- `cpt-studiofrontend-flow-workspace-scope-switch`

**Touches**:
- Action: `constructor_studio.context.workspaces.publish.v1~` (`kind: scoped`)
- Entities: `WorkspaceSwitcher`, `Header`, `ProjectsRoot`, `Menu`, `appContextSlice`

### Creation is an overlay extension with one field

- [x] `p1` - **ID**: `cpt-studiofrontend-dod-workspace-scope-overlay`

The system **MUST** render the workspace form as an extension of the projects
MFE in the shell's overlay domain, mounted and unmounted through the extension
lifecycle actions, and **MUST** offer exactly one field — the name.

**Implements**:
- `cpt-studiofrontend-flow-workspace-scope-create`

**Touches**:
- Entities: `mfe.json`, `workspaceOverlayLifecycle`, `NewWorkspaceForm`, `workspaceActions`

### A created workspace reaches the shell and becomes current

- [x] `p1` - **ID**: `cpt-studiofrontend-dod-workspace-scope-announce`

The system **MUST** hand the created workspace to the shell through an action
chain executed against the overlay domain, and the shell **MUST** add it to the
switcher and make it current.

Not an event and not a refetch: the overlay runs in its own module realm, so the
shell never hears its event bus, and the shell has no reason to re-read a list it
is being told the one new row of.

**Implements**:
- `cpt-studiofrontend-flow-workspace-scope-create`

**Touches**:
- Action: `constructor_studio.context.workspaces.publish.v1~`
- Entities: `contextActions`, `bootstrap`, `workspaceEffects`

### The projects list is rooted at the workspace

- [x] `p1` - **ID**: `cpt-studiofrontend-dod-workspace-scope-list-root`

The system **MUST** build the Projects list from the projects of the current
workspace, as one flat list, and **MUST** show nothing but an empty state when
there is no workspace.

The organization is no longer the root: its children are workspaces, and listing
them as rows would present containers as projects.

Flat, and not a tree with the workspace at the top, because the type registry
leaves nothing to nest: a workspace's only allowed parent is an organization, and
a project's are an organization or a workspace — so a workspace's children are
projects, and a project's children are nothing. The lazily expanded tenant tree
the earlier list needed is gone with the level it was walking, chevrons,
indentation, per-node fetching and all.

The one page is narrowed to the project type server-side rather than partitioned
on the client: with one level a tenant of another type has no row to be sorted
into.

**Implements**:
- `cpt-studiofrontend-flow-workspace-scope-switch`

**Touches**:
- API: `GET /cf/account-management/v1/tenants/{workspace}/children?$filter=tenant_type eq '{project type}'`
- Entities: `workspaceProjects`, `useProjectList`, `ProjectsTable`, `workspace` (shared)

### A project is created inside the current workspace

- [x] `p1` - **ID**: `cpt-studiofrontend-dod-workspace-scope-project-parent`

The system **MUST** create a project as a child of the current workspace, and
**MUST NOT** offer a parent picker — the workspace in the top bar is the answer.

This supersedes the assumption in `project-create.md` that a project is created
under the organization. Both parents are allowed by the type registry; the
portal picks the workspace, and the list shows only what is in one.

**Implements**:
- `cpt-studiofrontend-flow-workspace-scope-create`

**Touches**:
- API: `POST /cf/account-management/v1/tenants`
- Entities: `wizardEffects`, `NewProjectWizard`

### Without a workspace there is nothing to create a project in

- [x] `p1` - **ID**: `cpt-studiofrontend-dod-workspace-scope-no-workspace`

The system **MUST** disable "New project" while no workspace is current, and
**MUST** leave "New workspace" available — that is the way out of the state.

**Implements**:
- `cpt-studiofrontend-flow-workspace-scope-create`

**Touches**:
- Entities: `ProjectsToolbar`

## 6. Acceptance Criteria

- [ ] With no workspace in the organization, the top bar shows the organization alone, "New project" is disabled and "New workspace" is not.
- [ ] The workspace slot is in the top bar on the Projects screen and absent on Connections and People.
- [ ] Leaving Projects for another screen and coming back shows the same workspace still current, and the Projects list unchanged.
- [ ] Activating "New workspace" opens an overlay with a single name field; Escape, the scrim and Cancel all close it and write nothing.
- [ ] Confirming a name creates a tenant of the workspace type whose parent is the organization in scope.
- [ ] The created workspace appears in the top bar slot immediately and is the current one, without a page reload.
- [ ] A name that duplicates an existing workspace leaves the overlay open, keeps the name, and shows what was refused.
- [ ] With a workspace current, "New project" is enabled and a project created through the wizard is a child of that workspace.
- [ ] Switching workspaces replaces the Projects list with the chosen workspace's projects, and an open project is left.
- [ ] Switching organizations re-reads the workspaces and selects one of the new organization's, never one of the previous organization's.
- [ ] The Projects list shows an empty state, not workspace rows, for a workspace with no projects.
- [ ] Every row in the list is a project: no expandable rows, no indentation and no container rows anywhere in it.
