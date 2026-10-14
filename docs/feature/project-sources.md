---
type: feature
status: draft
owner: studio-team
---

# Feature: The project's sources


- [ ] `p1` - **ID**: `cpt-studiofrontend-featstatus-project-sources`

- [ ] `p1` - `cpt-studio-feature-project-sources`

## Table of Contents

<!-- toc -->

- [1. Feature Context](#1-feature-context)
  - [1.1 Overview](#11-overview)
  - [1.2 Purpose](#12-purpose)
  - [1.3 Actors](#13-actors)
  - [1.4 References](#14-references)
- [2. Actor Flows (CDSL)](#2-actor-flows-cdsl)
  - [Connect repositories to a project](#connect-repositories-to-a-project)
- [3. Processes / Business Logic (CDSL)](#3-processes--business-logic-cdsl)
  - [Attach the picked repositories](#attach-the-picked-repositories)
  - [Sync the sources nothing has pulled in](#sync-the-sources-nothing-has-pulled-in)
- [4. States (CDSL)](#4-states-cdsl)
  - [Connect Source Dialog State Machine](#connect-source-dialog-state-machine)
- [5. Definitions of Done](#5-definitions-of-done)
  - [Connect source is an overlay extension, opened from the Sources header](#connect-source-is-an-overlay-extension-opened-from-the-sources-header)
  - [The dialog and the wizard share one repository picker](#the-dialog-and-the-wizard-share-one-repository-picker)
  - [A repository is attached once, and the project holds at most 100](#a-repository-is-attached-once-and-the-project-holds-at-most-100)
  - [The picks are appended to the config, and only then does the dialog close](#the-picks-are-appended-to-the-config-and-only-then-does-the-dialog-close)
  - [With no connection, the dialog leads to creating one](#with-no-connection-the-dialog-leads-to-creating-one)
  - [The project screen syncs the sources the graph does not have](#the-project-screen-syncs-the-sources-the-graph-does-not-have)
- [6. Acceptance Criteria](#6-acceptance-criteria)

<!-- /toc -->

## 1. Feature Context

### 1.1 Overview

The Sources section of a project: the repositories the project works from. A
project gets its first repositories in the New project wizard
([Create a project](project-create.md)); this section lists them and attaches
more.

This spec starts with attaching more: **Connect source** in the section's
header opens a dialog with the wizard's repository picker, and the picked
repositories join the project's config and its import. The rows, the row menu,
the table and uploading documents are added with #685, #686, #688 and #693.

### 1.2 Purpose

Until now a project's repositories were fixed at creation. The design's Sources
section has Connect source in its header, and everything it needs exists: the
wizard's picker, the config write (#709) and the import that syncs a
repository (`cpt-studiofrontend-algo-project-artifacts-sync`).

**Assumptions fixed here**, because the design is silent and each changes the
code:

- **The dialog offers the organization's existing connections only**, grouped
  by provider, as the wizard does: a chip per source-code provider it has a
  connection to, the chosen provider's connections under it. The design
  authorizes a provider inside the dialog; creating a connection here is out of
  #687's scope. An organization with no source connection is offered the
  connection form of the Connections screen instead.
  GitLab and Bitbucket connections are listed like GitHub ones; their
  repositories are attached and not synced (below).
- **A repository is attached once, whichever connection it came through.** Two
  sources are the same repository when their clone URLs give the same key, the
  one the backend uses (`repository_key`, `studio-backend/src/project_sources.rs`).
  A second connection to the same repository would sync a second copy of it.
- **100 repositories is the project's ceiling**, the attached ones and the
  picked ones together. The wizard's cap is the same number, for a project that
  has none yet.
- **A new source records its branch.** `branch` is the repository's default
  branch as the provider reports it when the source is attached, and
  `share_mode` is `branch`. The IDE session checks out that branch from then on,
  even if the repository's default changes later. A provider that reports no
  default branch gets no `branch`, and the session checks out the remote's HEAD.
- **The dialog writes the config and nothing else.** It is an overlay extension,
  and each extension of this MFE has its own store and event bus
  (`cpt-studiofrontend-dod-project-create-org-scope`), so the project screen
  cannot hear it. The screen finds the sources the graph has no repository for
  and syncs those, deciding from the data as it does for a new project's first
  import (`cpt-studiofrontend-dod-project-artifacts-import-detect`).
- **Only GitHub repositories are synced.** The GitLab and Bitbucket drivers list
  repositories and nothing more: a sync request for one is accepted, then fails
  five times. Such a repository is attached and its line in the import says why
  it is not synced (`cpt-studiofrontend-algo-project-artifacts-sync`).
- **The header's actions are a stopgap.** The project's section header has no
  actions slot in ui-kit yet; the projects MFE adds one per section until the
  kit's page header replaces the header.
- **Until #688, the section stays a placeholder.** After Connect source the new
  repositories' syncs show in Artifacts, where the import already reports.

**Requirements**: `cpt-studio-fr-connections`, `cpt-studio-fr-artifact-ingest`

**Principles**: `cpt-studio-principle-project-is-unit`

### 1.3 Actors

Actor ids are defined in the [PRD](../prd/constructor-studio.md); a gear taking part is cited by its design component id.

| Actor | Role in Feature |
|-------|-----------------|
| **Member** (`cpt-studio-actor-member`) | A signed-in member with the project open. Picks repositories and connects them. |
| **Shell** (`cpt-studio-actor-shell`) | Owns the overlay frame: mounts and unmounts the dialog, draws the scrim, handles Escape and click-outside. |
| **MFE** (`cpt-studio-actor-mfe`) | projects-mfe. Draws the dialog in one extension and the project screen in another; the screen syncs what the dialog attached. |
| **Connector gear** (`cpt-studio-component-connector`) | Lists the organization's connections and each connection's repositories. |
| **Artifact gear** (`cpt-studio-component-artifact-ingest`) | Syncs each new GitHub repository into the graph. |

### 1.4 References

- **PRD**: [PRD](../prd/constructor-studio.md)
- **Design**: [DESIGN](../design/constructor-studio.md), component `cpt-studio-component-projects-mfe`
- **Decomposition**: [DECOMPOSITION](../decomposition/constructor-studio.md), entry `cpt-studio-feature-project-sources`
- **Feature**: [Create a project](project-create.md): the picker this dialog shares, and the config's first write
- **Feature**: [Project artifacts](project-artifacts.md): the import the new repositories join
- **Feature**: [Connect a source host](connection-create.md): the form Add connection opens
- **Feature**: [The project's specs](project-specs.md): the section before this one
- **Issues**: #643 (the Specs and Sources sections), #687 (this part), #709 (the config write), #685, #686, #688, #693 (the rest of the section)

## 2. Actor Flows (CDSL)

Unchecked on purpose, for the reason stated in `project-create.md`: a checked
flow obliges every instruction to carry a code marker, and this one spans two
extensions, the shell's overlay frame and connections-mfe.

**Use case**: attach more repositories to a project.

### Connect repositories to a project

- [ ] `p1` - **ID**: `cpt-studiofrontend-flow-project-sources-connect`

**Actor**: Member

**Success Scenarios**:
- The picked repositories are in the project's config, and the new GitHub ones are syncing beside the project's other repositories.

**Error Scenarios**:
- The organization has no source connection; the dialog says so and offers Add connection.
- The config write is refused; the dialog stays open with the reason and the picks.
- The project's config cannot be read; the dialog says so and offers no Connect source.
- A picked repository is not on GitHub; it is attached and its line says why it is not synced.

**Steps**:
1. [ ] - `p1` - Member activates Connect source in the Sources header - `inst-1`
2. [ ] - `p1` - Mount the dialog's extension in the shell's overlay domain - `inst-2`
3. [ ] - `p1` - Reset the picks, the search and the chosen connection, so no earlier attempt is carried in - `inst-3`
4. [ ] - `p1` - `API: GET /studio-connector/v1/connections?tenant= and GET /studio-connector/v1/providers (a chip per source-code provider with a connection, nothing listed yet)` - `inst-4`
5. [ ] - `p1` - **IF** the organization has no source connection - `inst-5`
   1. [ ] - `p1` - Member activates Add connection - `inst-6`
   2. [ ] - `p1` - **RETURN** unmount the dialog and mount the connection form of connections-mfe - `inst-7`
6. [ ] - `p1` - Member picks a provider; its connections show, one in a line or several as tabs - `inst-4a`
7. [ ] - `p1` - `API: GET /cf/account-management/v1/tenants/{project}/metadata/{project config type} (the repositories already attached)` - `inst-8`
8. [ ] - `p1` - `API: GET /studio-connector/v1/connections/{id}/repositories?search=&limit= (rows for the active connection)` - `inst-9`
9. [ ] - `p1` - Member picks repositories, across providers and connections if needed; the attached ones show picked and cannot be changed - `inst-10`
10. [ ] - `p1` - Member activates Connect source - `inst-11`
11. [ ] - `p1` - Run `cpt-studiofrontend-algo-project-sources-attach` - `inst-12`
12. [ ] - `p1` - **IF** the write is refused - `inst-13`
    1. [ ] - `p1` - **RETURN** the dialog stays open with the reason and the picks - `inst-14`
13. [ ] - `p1` - Unmount the dialog - `inst-15`
14. [ ] - `p1` - The project screen runs `cpt-studiofrontend-algo-project-sources-sync-missing` - `inst-16`
15. [ ] - `p1` - **RETURN** the new repositories' syncs show in the project's import - `inst-17`

## 3. Processes / Business Logic (CDSL)

### Attach the picked repositories

- [x] `p2` - **ID**: `cpt-studiofrontend-algo-project-sources-attach`

**Input**: the open project and the picked repositories, each with its connection, path, clone URL and default branch

**Output**: the project's sources as written, or the reason the write was refused

**Steps**:
1. [x] - `p1` - Make a source of each pick: its connection, path and clone URL, `branch` set to its default branch when the provider reports one, and `share_mode` `branch` - `inst-1`
2. [x] - `p1` - Record a sync attempt for the project in the tab's session storage, so the screen does not start a first import of every source on its own - `inst-2`
3. [x] - `p1` - `API: GET /cf/account-management/v1/tenants/{project}/metadata/{project config type}`, read fresh - `inst-3`
4. [x] - `p1` - Append the new sources, skipping a repository the project already has through any connection - `inst-4`
   1. [x] - `p1` - **IF** that takes the project past 100 sources, **RETURN** the refusal that says so; nothing is written - `inst-4a`
5. [x] - `p1` - `API: PUT /cf/account-management/v1/tenants/{project}/metadata/{project config type}` with every other field of the config as it was read - `inst-5`
6. [x] - `p1` - **IF** the read or the write fails - `inst-6`
   1. [x] - `p1` - **RETURN** the refusal; the config is as it was - `inst-7`
7. [x] - `p1` - Drop the cached config, so every extension reading it reads it again - `inst-8`
8. [x] - `p1` - **RETURN** the sources as written - `inst-9`

### Sync the sources nothing has pulled in

- [x] `p2` - **ID**: `cpt-studiofrontend-algo-project-sources-sync-missing`

**Input**: the open project, each time the project screen reads its sources or its repository nodes

**Output**: the syncs requested for the sources the graph does not have yet, or nothing

**Steps**:
1. [x] - `p1` - **IF** the gear has not yet been asked for the project's syncs in flight since the project opened (`cpt-studiofrontend-algo-project-artifacts-sync-resume`) - `inst-13`
   1. [x] - `p1` - **RETURN** nothing for now; a sync another tab started gets its line first - `inst-14`
2. [x] - `p1` - **IF** the project's first import is starting (`cpt-studiofrontend-algo-project-artifacts-first-import`) - `inst-1`
   1. [x] - `p1` - **RETURN** nothing; the first import syncs every source - `inst-2`
3. [x] - `p1` - Read the project's sources from its config - `inst-3`
4. [x] - `p1` - `API: GET /cf/studio-artifact-ingest/v1/nodes?scope={project}&type=repo` for the repositories the graph has - `inst-4`
5. [x] - `p1` - Take the sources whose path has no repository node - `inst-5`
6. [x] - `p1` - Leave out a source that already has a line in the import, whatever its state - `inst-6`
7. [x] - `p1` - Leave out a source a sync was already requested for in this tab, whatever came of it - `inst-7`
8. [x] - `p1` - **IF** none is left - `inst-8`
   1. [x] - `p1` - **RETURN** nothing - `inst-9`
9. [x] - `p1` - Run `cpt-studiofrontend-algo-project-artifacts-sync-request` for them, so only GitHub repositories are asked for and the rest get an unsyncable line - `inst-10`
10. [x] - `p1` - Run `cpt-studiofrontend-algo-project-artifacts-sync-add` with what it returned; it records each repository as requested in this tab - `inst-11`
11. [x] - `p1` - **RETURN** the requested syncs - `inst-12`

The rule reads data, not a change. A source attached in another tab, or while
the project was closed, or just before a reload, has no repository node either,
so it is found the next time the project screen reads the project.

## 4. States (CDSL)

### Connect Source Dialog State Machine

- [ ] `p2` - **ID**: `cpt-studiofrontend-state-project-sources-connect`

**States**: Choosing, Picking, Writing

**Initial State**: Choosing

**Transitions**:
1. [ ] - `p1` - **FROM** Choosing **TO** Picking **WHEN** a provider is chosen - `inst-1`
2. [ ] - `p1` - **FROM** Picking **TO** Writing **WHEN** Connect source is activated with at least one repository picked - `inst-2`
3. [ ] - `p1` - **FROM** Writing **TO** Picking **WHEN** the write is refused; the reason is shown and the picks are kept - `inst-3`
4. [ ] - `p1` - **FROM** Picking **TO** Choosing **WHEN** Back is used; the picks are kept - `inst-4`

Choosing is the prototype's first step and the card is small: the chips and
the hint (or, with no source connection, the empty state and Add connection),
Back alone, no count and no Connect source. Picking and Writing keep one
height for every connection (a list, an empty state, an error), so the card does
not jump. It is the height the tallest empty state (connection tabs and Try
GitHub sample) needs whole: an empty state never scrolls, only a longer list does. The
viewport less 4rem caps it.

The dialog leaves every state by being unmounted: after a write, on Back from
Choosing, on Escape or on the scrim. Nothing is written once it is gone. Back
from Picking returns to Choosing and keeps the picks; the prototype closes the
dialog there.

## 5. Definitions of Done

### Connect source is an overlay extension, opened from the Sources header

- [x] `p1` - **ID**: `cpt-studiofrontend-dod-project-sources-connect-overlay`

The system **MUST** draw Connect source as an extension of the projects MFE in
the shell's overlay domain, with its own entry and lifecycle, and **MUST** open
it from a Connect source button in the Sources section's header.

The dialog reads the open project from the shell's selected-project property, so
the shell's overlay domain declares that property beside the organization and
the workspace. A domain that does not declare a property an entry requires
refuses the entry, and with it every extension of the MFE.

The header's actions belong to the section: the project screen draws the header
and asks the open section for its actions, and only Sources has any yet. Upload
documents joins them with #693. When the ui-kit page header lands, it takes the
actions as they are.

**Implements**:
- `cpt-studiofrontend-flow-project-sources-connect`

**Touches**:
- Entities: `mfe.json` (projects-mfe), `sourcesConnectLifecycle`, `sourcesConnectActions`, `ProjectScreen`, `SourcesActions`, `openOverlay` and `closeOverlay` (mfe-shared)
- Shell: the overlay domain's shared properties (`app/mfe/bootstrap.ts`), the overlay frame's height cap (`app/layout/OverlayDialog.tsx`)

### The dialog and the wizard share one repository picker

- [x] `p1` - **ID**: `cpt-studiofrontend-dod-project-sources-picker`

The system **MUST** draw the dialog's repositories with the New project wizard's
picker: a chip per source-code provider the organization has a connection to,
with nothing listed until one is chosen,
the chosen provider's connections under it (one named in a line, several as
tabs), the search, the table and its empty states. The picker **MUST NOT** hold state of its own. The picks, the search
and the chosen connection come in through its props, from the wizard's slice in
the wizard and from the dialog's slice in the dialog. The dialog's slice
**MUST** be reset when the dialog mounts.

Both slices **MUST** take the picker's navigation from one set of reducer
helpers: choosing a provider clears the connection and the search, choosing a
connection clears the search, and Back to the providers clears all three and
the error. The picks stay each slice's own, because the cap differs: the wizard
refuses the 101st pick itself, while the dialog has to count the project's
attached sources too, which only the dialog reads.

The wizard takes the picker with everything above, as `project-create.md`
describes: the provider chips first, Back to the providers, no Updated column,
and each pick written with `branch` and `share_mode`
(`cpt-studiofrontend-algo-project-create-repos`,
`cpt-studiofrontend-dod-project-create-many-sources`).

The dialog reuses the wizard's frame, small on its first step and one height after it, its
footer note and its strings, and adds its own: the title, Connect source,
Already attached, Add connection, the full project's footer and its errors. Its secondary button reads Back,
the wizard's string: from the repositories it returns to the providers, and
from the providers it closes the dialog.

**Implements**:
- `cpt-studiofrontend-flow-project-sources-connect`

**Touches**:
- Entities: `RepositoryPicker`, `SelectionNote`, `OverlayFrame.module.css`, `RepositoriesStep`, `RepositoriesFooterNote`, `sourcesConnectSlice`, `createSlice`, `pickerReducers`, `SourcesConnectDialog`

### A repository is attached once, and the project holds at most 100

- [x] `p1` - **ID**: `cpt-studiofrontend-dod-project-sources-attached`

The system **MUST** show a repository the project already has, through any
connection, as picked and inert, and **MUST NOT** let the attached and the
picked repositories exceed 100 together: at the ceiling the unpicked rows are
inert and the footer says so, also when the attached ones fill it alone.

A repository is the same when its clone URL gives the same key, the one the
config write compares by (`sameRepository`), so the dialog never offers a pick
the write would drop.

Both rest on the config the dialog has read. When that read fails, the dialog
**MUST** say so and offer no Connect source. The read may also be up to 30 s
old, so the write **MUST** check the ceiling again against the config it reads
fresh, and refuse rather than exceed it.

**Implements**:
- `cpt-studiofrontend-flow-project-sources-connect`

**Touches**:
- Entities: `RepositoryPicker`, `SourcesConnectDialog`, `model/projectSources`

### The picks are appended to the config, and only then does the dialog close

- [x] `p1` - **ID**: `cpt-studiofrontend-dod-project-sources-write`

The system **MUST** append the picks to the project's `sources[]`, reading the
config fresh and writing every other field back as it was, and **MUST** close
the dialog only once the write has succeeded. A refused write **MUST** leave the
dialog open with the reason and the picks.

Each new source carries `branch`, the repository's default branch when the
provider reports one, and `share_mode: branch`.

The write is last-write-wins (#709): AM's metadata carries no version to send
back.

**Implements**:
- `cpt-studiofrontend-algo-project-sources-attach`

**Touches**:
- API: `GET /cf/account-management/v1/tenants/{id}/metadata/{type}`, `PUT /cf/account-management/v1/tenants/{id}/metadata/{type}`
- Entities: `sourcesConnectEffects`, `projectSourcesEffects`, `model/projectSources`

### With no connection, the dialog leads to creating one

- [x] `p1` - **ID**: `cpt-studiofrontend-dod-project-sources-no-connection`

With no source connection in the organization, the system **MUST** say so in the
dialog and offer Add connection, which **MUST** unmount the dialog and mount the
connection form of connections-mfe in the overlay domain.

Creating a connection inside this dialog is out of scope. The connection form is
the Connections screen's own (`cpt-studiofrontend-dod-connection-create-overlay`);
once it has a connection, the member opens Connect source again. The form's
extension id moves to mfe-shared, as the workspace form's did when
organization-mfe began to open it.

**Implements**:
- `cpt-studiofrontend-flow-project-sources-connect`

**Touches**:
- Entities: `RepositoryPicker`, `SourcesConnectDialog`, `sourcesConnectActions`, `STUDIO_EXTENSION_CONNECTION_CREATE` (mfe-shared)

### The project screen syncs the sources the graph does not have

- [x] `p1` - **ID**: `cpt-studiofrontend-dod-project-sources-sync-missing`

The system **MUST** request, from the project screen, a sync for every GitHub
source of the open project that has no repository node in the graph, no line in
the import, whatever that line's state, and for which no sync was requested in
this tab, even one that then failed. It **MUST** decide this from the data each
time it reads the project's sources or repository nodes, not from what changed
in the config, and **MUST NOT** decide before the gear has been asked for the
project's syncs in flight since the project opened
(`cpt-studiofrontend-dod-project-artifacts-sync-resume`), whether that answered
or failed. The syncs **MUST** join the project's import rather than restart it,
and the member **MUST** stay on the section they are on.

The dialog cannot ask for the sync itself: it is another extension, with its own
store and event bus, so whatever it starts the screen never sees. It writes the
config and drops the cached copy; the screen reads it again and finds sources
with no repository node. Deciding from the data is what makes the answer hold
after a reload, for a source attached in another tab and for one attached while
the project was closed: whoever opens the project next starts what is missing.

A request is remembered per repository in the tab's session storage, by every
path that makes one: the first import, Sync repositories and this rule. So a
repository whose sync fails before its node is written is asked for once per
tab, as the first import already is, and not again on every read.

The cost is accepted: such a repository is asked for again in every new tab, by
every member who opens the project, and each request is a run the gear tries up
to five times. In return a repository whose token or path is put right syncs
the next time anyone opens the project, without anyone asking. Leaving out the
repositories whose last run failed would need the failed runs, and the gear
lists only the tenant's newest page of them, so the guard would hold only for
recent failures.

The dialog records the project's attempt before it writes. Otherwise a project
with no artifacts would meet the first import's conditions the moment its new
sources arrive, and the screen would sync every source and move to Artifacts.

Waiting for the gear's syncs in flight is what keeps a second tab from asking
again: a tab that opens the project after another has asked finds that run,
queued or running, and gives it a line before this rule looks. Accepted rather
than prevented: two tabs, or two members, that both look before either has
asked can request the same repository. Each request carries its own
Idempotency-Key, so the gear queues the second behind the first on the same
partition. The cost is one repeated upsert.

**Implements**:
- `cpt-studiofrontend-algo-project-sources-sync-missing`

**Touches**:
- API: `GET /cf/studio-artifact-ingest/v1/nodes?scope={project}&type=repo`
- Entities: `ProjectScreen`, `useSourcesSync`, `importAttempts`, `artifactSyncSlice`

## 6. Acceptance Criteria

- [ ] The Sources section's header shows Connect source, with a plug icon as in the prototype; no other section's header shows it.
- [ ] Activating it opens the dialog over the project; Escape, the scrim and Back on the providers close it and write nothing; Back on the repositories returns to the providers and keeps the picks.
- [ ] Before a provider is chosen the dialog is compact: the chips and the hint, and Back alone, with no count and no Connect source; choosing one grows it to the repositories, the count of the picks and Connect source, at one height for every connection: an empty state shows whole without a scroll, and only a longer list scrolls.
- [ ] The dialog opens on a chip per source-code provider the organization has a connection to, with nothing listed; choosing one shows its connections, its search and its table, the same as the New project wizard.
- [ ] Picking two repositories from two connections and activating Connect source closes the dialog, and the project's config lists both after its earlier sources, each with `branch` and `share_mode: branch`, and every other field unchanged.
- [ ] Their syncs start, and Artifacts shows them beside the project's earlier repositories, whose syncs are not restarted.
- [ ] A repository the project already has, through any connection, shows checked and cannot be unchecked or picked again.
- [ ] With 99 repositories attached, one more can be picked; then the unpicked rows are inert and the footer states the maximum.
- [ ] With 100 repositories attached, every row is inert and the footer says the project holds the maximum.
- [ ] When the project's config cannot be read, the dialog says so and offers no Connect source.
- [ ] A write that would take the project past 100, because its config grew after the dialog read it, is refused with the reason, and the picks are kept.
- [ ] A GitLab or Bitbucket repository is attached, no sync is requested for it, and its line says why.
- [ ] With no source connection, the dialog says so and offers Add connection, which closes it and opens the connection form.
- [ ] A refused config write leaves the dialog open with the reason and the picks.
- [ ] Connecting repositories to a project with no artifacts keeps the member on Sources and syncs only the new repositories.
- [ ] A repository attached in another tab, or just before a reload, is synced the next time the project screen reads the project.
- [ ] A repository whose sync is queued or running is not requested again.
- [ ] A repository whose sync another tab asked for and is still queued is not requested again when the project opens in a new tab, even when the project's other reads answer before the gear's runs.
- [ ] A repository whose sync failed before the graph had its node is not requested again in the same tab; a new tab asks for it once.
- [ ] Reopening a project syncs its GitHub sources that have no repository node and have not been requested in this tab, and no others.
- [ ] The New project wizard's repositories step works as `project-create.md` describes, on the same picker; in both, Back to the providers clears the connection, the search and any error, and keeps the picks.
