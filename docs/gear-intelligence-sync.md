# Gear Intelligence Sync

## Purpose

The Gears catalogue must show more than crates.io package metadata. It needs a
repeatable, auditable import of delivery evidence from each Gear repository:
documentation, ownership, API/configuration contracts, code statistics,
quality signals, dependencies and extension points.

## Sources of truth

| Data | Source of truth | Storage in Studio Web |
| --- | --- | --- |
| Package identity, releases, downloads | crates.io | Durable catalogue record |
| Repository files and GitHub work items | The configured GitHub Connection | Extracted facts and file references |
| PRD, ADR, DESIGN, API and diagram files | Git repository | S3 object for large bytes; durable reference and parsed facts |
| Lifecycle, category, product owner and overrides | Studio-managed Gear profile | Durable metadata record |
| Graph relations | Derived index | Optional Graph Storage projection; never the only durable copy |

The Kubernetes release currently runs without the optional graph-storage gear.
Therefore a graph node is an index when available, not the persistence layer for
the Gear catalogue or its editable profile.

## Connection and authorization

A Platform Admin selects one existing GitHub Connection as the catalogue
connection. The importer uses its existing connector driver and credential; it
does not expose tokens to the browser and does not introduce an unauthenticated
parallel GitHub client. Public and private repositories use the same flow.

Only Platform Admins can change the selected connection or save Gear overrides.
All authenticated users may view imported data allowed by their tenant scope.

## Import stages

1. **Discover** — read repository, default branch, recursive tree, CODEOWNERS,
   Cargo manifests and GitHub contributors/issues/releases.
2. **Classify documents** — recognise README, PRD, ADR, DESIGN, OpenAPI,
   configuration guides, changelog and UML/Draw.io/Mermaid files.
3. **Extract facts** — count Rust/spec/test LOC; parse Cargo dependencies;
   identify database/configuration references, feature flags, events, metrics
   and declared GTS extension points.
4. **Store** — write a versioned Gear snapshot and document references to
   durable Studio storage. Store only large document bytes in S3.
5. **Project** — publish the current snapshot to cards/table and, when graph is
   enabled, upsert a derived graph projection.

Each snapshot contains repository URL, commit SHA, import timestamp, extractor
version and warnings, so every displayed value is traceable to a Git revision.

## UI

`Sync from repository` runs the import for one Gear; `Sync all` queues every
catalogue Gear with a configured repository. Cards show the latest snapshot;
the table compares selected metrics. A detail view lists each document and its
source path/revision. Manual profile values are labelled **Override** and never
overwrite imported facts.

## Delivery phases

1. Platform-admin Connection selection and durable Gear snapshot/profile store.
2. Repository discovery plus document inventory and links.
3. Cargo/LOC/dependency/config extraction.
4. GitHub issues, releases, CI quality and security signals.
5. Artifact graph projection, historical trends and scheduled refresh.
