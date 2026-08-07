# Concept v2 — the Project is the unit, organizations are hidden

Status: **exploration** on `concept/project-is-workspace`. Not accepted, not a
build plan. It changes the portal's information architecture only; no backend,
gear, API or tenant-type change is part of it.

## What changed

Two things, and they are the same thing said twice.

**A workspace *is* a project.** The portal used to show a workspace and a
project as two different kinds of object: the workspace owned the sources, the
automation level, the people and the IDE session, while a "project" was an
effort container inside it (`studio-project` gear, ADR-0005). To the person
using it those are the same kind of thing at two granularities, so the UI now
says *project* at both levels: a **root project** (the AM tenant of type
`workspace`) and the **nested projects** running inside it. The wire words are
untouched — `tenant_type: workspace`, `workspace_id`, `.cf-workspace.toml` all
stay, and the frontend type is still called `Workspace`, precisely so the places
where the UI's noun and the platform's noun disagree remain visible in code
instead of being papered over by a rename.

**Organizations are hidden, not removed.** The organization tenant keeps doing
its two jobs: it owns the shared connector catalogue (one PAT serving every
project under it) and it anchors the tenant admin hierarchy. What it loses is
navigation — no Organizations page, no organization column in the switcher, no
"Org owner" chip. It is resolved implicitly: a new project is created in it, and
the Integrations page edits its catalogue without naming it. The tenant admin
surfaces still exist behind a flag:

```js
localStorage.setItem("studio.platformAdmin", "on")  // Admin → Platform section
```

That is deliberate. "Hide the level" is a product decision; keeping every
org-shaped seam (the `orgId` on a project, `scope: organization` connections,
the create/convert/delete flows) means reversing it is a UI change rather than a
re-architecture.

## Roles are project-scoped

Access is granted inside a project, so there is no organization-wide role. The
role a person holds is asked about *a project*, and the People page shows which
project each row's role refers to.

Enforcement has not moved. ADR-0004 parked Role Grants behind the Studio PDP and
authorization is still allow-all, so this branch is careful about what it
claims:

- **Derived from server state.** `Owner` is the project record's `created_by`.
  `Editor` is membership in the project's Resource Group. Everyone else in scope
  is `Viewer` — being reachable from a project is not authority.
- **`Admin` is grant-only**, because nothing the control plane records today
  proves that someone may administer a project.
- **Grants live in the browser.** Changing a role writes to `localStorage`
  (`studio.concept.roleGrants`), never to the backend, and every row says
  whether its value is `derived` or a `local` grant. When the PDP lands, that
  overlay is deleted and replaced by real Role Grant calls; the derivation
  survives as the fallback for projects with no explicit grant.

## Information architecture

```
Home
Projects            portfolio: root projects with their nested projects
  └ <project>       Overview · Nested projects · People · Integrations · Secrets
      └ <nested>    shape, journey stages, members
People              everyone, with their project-scoped role
Integrations        the shared connector catalogue (the hidden org's)
Chats · Files
System
```

Nothing in the sidebar depends on having selected a container first, which is
what removed the "pick a workspace first" dead ends: sources, secrets and nested
projects are not top-level surfaces, they belong to a project and live on its
page.

## What this does not do

- No renaming of gears, APIs or tenant types.
- No new backend endpoints. Root-project status in the portfolio is *derived*
  from its nested projects and says so on hover; a root project has no status
  of its own yet, and nothing invents one.
- No fake data. Where the model reserves a surface that does not exist yet
  (knowledge graph, findings, workflow runs, kits) it stays reserved.

## Open questions

1. Should a nested project be able to nest further, or is one level the point?
   The gear has no parent link today, so the UI shows exactly two levels.
2. Root projects have no `created_by` in AM — so no root project can derive an
   owner. Worth recording, or does ownership only ever mean the nested record?
3. If organizations stay hidden for good, the shared catalogue needs a name that
   does not lean on the word: "Integrations" is doing that job for now.
