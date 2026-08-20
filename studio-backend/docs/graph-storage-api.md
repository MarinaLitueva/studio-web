# Graph Storage — current API, missing endpoints, and node payloads

From: Studio backend integration (`studio-web/studio-backend`, branch
`feature/graph-storage-gear`) · Date: 2026-08-20

Context: the graph-storage gear was vendored into the Studio assembly
(`src/graph_storage`, copied from `gears-rust/gears/graph-storage`), pointed at a
dedicated PostgreSQL 19 + pgvector server, and driven end to end — register
types, import a real GitHub repository, traverse it, search it. Everything below
was checked against that running integration, not against documentation.

Reference import: `constructorfabric/insight` @ `main` → 824 nodes, 823 edges
(622 files, 178 directories, 23 contributors) in 2.4 s, traversal served by the
SQL/PGQ `GRAPH_TABLE` backend with no fallback.

---

## 1. Current API

### 1.1 REST

Base path `/graph-storage/v1`, mounted under the gateway prefix (`/cf` in this
assembly). Every operation is authenticated and scoped to the caller's tenant.

| Method | Path | Request | Response |
| --- | --- | --- | --- |
| `GET` | `/stats` | — | `{ nodes, edges, graph_revision }` |
| `POST` | `/types` | `{ type_id, kind }` — `kind` is `node`, `edge` or `attribute` | `{ id }` — the interned integer id |
| `POST` | `/ingest` | `{ nodes: [{ node_key, type_id, name, search_text? }], edges: [{ type_id, from, to }] }` | `{ nodes_upserted, edges_upserted }` |
| `GET` | `/neighbours` | `?seeds=1,2,3&depth=2` | `{ nodes: [i64], truncated }` |
| `GET` | `/search` | `?q=text&limit=20` | `{ nodes: [{ id, node_key, name, type_id }] }` |
| `GET` | `/subgraph` | `?seeds=1,2,3&depth=2` | `{ nodes: [...], edges: [{ src, dst, type_id }], truncated }` |

`search` and `subgraph` were added by this integration — traversal otherwise
answers with bare node ids, which is enough for a consuming gear that knows its
own keys but not enough to render a graph or back a search box. Both are
candidates to go upstream.

Edges in `subgraph` require **both** endpoints to be in the authorised node set.
An edge with one visible endpoint would draw a line to a node the caller cannot
see and disclose that it exists.

### 1.2 In-process client

`GraphStorageClientV1`, published to `ClientHub`, is the only in-process entry
point. It has three methods:

```rust
async fn stats(&self, ctx: &SecurityContext) -> Result<GraphStats, GraphStorageError>;
async fn ingest(&self, ctx: &SecurityContext, nodes: &[NodeInput], edges: &[EdgeInput])
    -> Result<IngestResult, GraphStorageError>;
async fn register_type(&self, ctx: &SecurityContext, type_id: &str, kind: &str)
    -> Result<i32, GraphStorageError>;
```

**Write and count only.** A gear in the same binary cannot traverse, search or
read a subgraph without calling the HTTP surface of its own process. This is the
single largest gap for product use — see § 2.1.

### 1.3 Configuration

```yaml
graph-storage:
  database:
    server: "pg_graph"          # PostgreSQL 19 + pgvector; the gear cannot run elsewhere
    dbname: "graph_storage"
  config:
    ingest_max_nodes: 10000
    ingest_max_edges: 20000
    traversal_max_depth: 5
    traversal_max_nodes: 1000
    traversal_hop: pgq          # two_query | cte | pgq
```

`traversal_hop` selects the hop implementation. A request whose scope cannot be
reduced to a set of tenants is served by `two_query` instead of being refused,
and the substitution is logged at `warn` — a deployment configured for `pgq` and
silently served by `two_query` would make any measurement taken from it
meaningless.

### 1.4 Behaviour worth knowing

- **Scoping is by construction.** Every query goes through the secure ORM;
  element keys are composite `(tenant_id, id)`, so an edge structurally cannot
  join a node of another tenant even before a scope predicate is applied.
- **Ingest converges.** Nodes conflict on `(tenant_id, node_key)` and edges on a
  derived `edge_key`, so repeating a batch does not duplicate. Verified on the
  reference import: two consecutive runs leave the totals unchanged.
- **Node ids are surrogate and per-tenant.** They are not stable across tenants
  and are not the producer's key. Address nodes by `node_key` on write; you get
  ids back only by reading.

### 1.5 Known inaccuracies in the current contract

These are places where the implementation and its documented behaviour disagree.
They matter to a consumer because each one reads as a usable guarantee.

1. **`ingest` is documented as atomic and is not.** The SDK trait says "either
   every valid row commits or the call fails and nothing is written". There is no
   transaction: type registration, node upsert and edge upsert are separate
   statements on a pooled connection. Observed directly — a failed import left
   five newly registered types committed.
2. **`graph_revision` is always `0`.** Documented as "monotonic revision, bumped
   whenever stored state changes"; the implementation returns the literal `0`. A
   consumer polling it for change detection would wait forever.
3. **`nodes_upserted` / `edges_upserted` count the submitted batch, not affected
   rows.** A re-import that changes nothing still answers with the full count, so
   the figure cannot be used to detect drift.
4. **`search_text` is producer-supplied.** ADR-0003 specifies it as *composed* by
   the gear from attributes annotated `x-gts-vectorized`. The current field is a
   stopgap this integration added so lexical search has something to match; it
   should be removed once § 3 step 3 lands.
5. **Payload and `json_schema` columns exist and are always `{}`.** See § 3.

Fixed on this branch and worth carrying upstream: registering an
already-registered type, and re-ingesting an unchanged batch of edges, both
answered 500. Both use `ON CONFLICT DO NOTHING`, and when the clause skips every
row SeaORM reports the insert as `DbErr::RecordNotInserted`, which both call
sites treated as failure.

---

## 2. Endpoints to add

Ordered by what blocks a consumer first.

### 2.1 Read operations on the in-process client

Not a REST change — a trait change, and the highest-value one.

```rust
async fn neighbours(&self, ctx: &SecurityContext, seeds: &[i64], depth: u8)
    -> Result<Vec<i64>, GraphStorageError>;
async fn subgraph(&self, ctx: &SecurityContext, seeds: &[i64], depth: u8)
    -> Result<Subgraph, GraphStorageError>;
async fn search(&self, ctx: &SecurityContext, query: &SearchQuery)
    -> Result<Vec<NodeView>, GraphStorageError>;
async fn node_by_key(&self, ctx: &SecurityContext, node_key: &str)
    -> Result<Option<NodeView>, GraphStorageError>;
```

The domain services already implement all four; only the trait and the local
client adapter need extending. Without them, every in-process consumer that reads
the graph has to talk HTTP to its own process.

### 2.2 Delete

```
DELETE /graph-storage/v1/nodes/{id}          → 204
DELETE /graph-storage/v1/nodes?key={node_key} → 204
DELETE /graph-storage/v1/edges/{id}          → 204
POST   /graph-storage/v1/prune                → { nodes_deleted, edges_deleted }
       { "type_id": "...", "node_key_prefix": "repo:owner/name:", "not_seen_since": "<rfc3339>" }
```

Nothing can currently be removed. A graph that mirrors an external source only
grows: re-import a repository after files were deleted upstream and the old file
nodes stay indefinitely, indistinguishable from live ones.

`prune` is the operation an importer actually needs — a bulk "everything under
this prefix that this run did not touch". It presupposes that ingest stamps
`updated_at` on every touched row, which it already does.

Deleting a node must fail while edges reference it, or cascade explicitly. The
endpoint FKs are `RESTRICT` by design (removing a static node must not silently
destroy analysis edges attached to it), so the API needs to say which it does.

### 2.3 Directed and type-filtered traversal

```
GET /graph-storage/v1/neighbours?seeds=1&depth=2&direction=out&edge_types=cf.studio.kg.contains.v1~
GET /graph-storage/v1/subgraph  ?seeds=1&depth=2&direction=out&edge_types=...
```

`direction` ∈ `out` | `in` | `both` (default `both`, today's behaviour).
`edge_types` is a comma-separated list of GTS type ids.

The machinery already exists and is unused: the hop functions take an
`edge_type_ids: Option<&[i32]>` filter and the pattern builder has a `Direction`
enum, but the service passes `None` and always unions both directions. This is
plumbing a parameter through, not new capability — the cheapest item on this
list.

### 2.4 Read by key, listing, pagination

```
GET /graph-storage/v1/nodes/{id}                      → NodeDto
GET /graph-storage/v1/nodes?key={node_key}            → NodeDto
GET /graph-storage/v1/nodes?type_id=...&cursor=...&limit=...
                                                      → { items: [NodeDto], next_cursor }
GET /graph-storage/v1/edges?node={id}&direction=out   → { items: [EdgeDto], next_cursor }
GET /graph-storage/v1/types                           → { items: [{ id, type_id, kind }] }
```

Today a consumer can ingest a node under a key it chose and has no way to fetch
it back by that key, no way to enumerate nodes of a type, and no continuation
cursor anywhere — `search` takes a limit and `subgraph` a node budget, and both
simply truncate. Consumers end up maintaining their own key-to-id table, which is
a second source of truth for something the gear already knows.

`GET /types` is needed internally too: this integration had to query `graph_type`
directly to resolve interned ids back to GTS identifiers.

### 2.5 Hybrid search

```
POST /graph-storage/v1/hybrid
     { query_vector: [f32], text: "...", seed_limit: 50, limit: 20, depth: 1 }
     → { nodes: [{ id, distance, ... }] }
```

`infra::storage::hybrid` already implements this as a single SQL/PGQ statement —
vector similarity, graph expansion and full-text filtering together — and is unit
tested, but it is routed nowhere and `ingest` accepts no embedding, so the
`vector(384)` column is always NULL. This is the capability SQL/PGQ was chosen
for in ADR-0001; it is currently dead code.

Needs `embedding` on `NodeInput` (see § 3.2) and a decision on who computes query
embeddings — the gear has no model and should not acquire one.

### 2.6 Change detection

Either implement `graph_revision` as a real monotonic counter bumped on every
committed write, or remove it from `GraphStats`. A field that is documented to
change and never does is worse than one that is absent.

If implemented, the natural consumer-facing pairing is a conditional read:
`GET /stats` returns the revision, and listing endpoints accept
`?since_revision=` so an importer can ask what changed.

---

## 3. Node payloads

### 3.1 The design already exists

This is not an open design question. ADR-0003
(`cpt-cf-graph-storage-adr-metadata-partitioning`, status **accepted**) specifies
the whole model, and DESIGN builds on it normatively. Node metadata splits four
ways:

1. **Common columns** — tenant, node key, GTS type, display name, timestamps,
   actor, embedding, search vector. Gear-defined, every node has them.
2. **Indexed JSONB attributes** — payload attributes annotated in the GTS schema
   (`x-gts-indexed`) are filterable in tabular projections and scope filters; the
   gear maintains the supporting JSONB indexes.
3. **Vectorizable attributes** — string attributes annotated `x-gts-vectorized`
   join the node's composed search text for embedding and full-text indexing.
4. **Heavy content** — payloads above a configured ceiling are rejected;
   long-form content goes to the file-storage gear and is referenced from the
   payload by file identifier.

The `payload` JSONB column exists on `graph_node` and `graph_edge`, and
`graph_type.json_schema` exists to carry the type's schema. All three are always
written as `{}`. What is missing is implementation, not a decision.

The full ADR is a large body of work — a versioned annotation vocabulary with its
own meta-schema, derivation-chain validation with JSON-pointer error reporting,
and a durable index-activation lifecycle running `CREATE INDEX CONCURRENTLY` in a
background worker. Consumers need attributes on nodes long before that lands, so
the proposal below is a staged path whose first step is small and
forward-compatible with the ADR rather than a detour around it.

### 3.2 Step 1 — carry the payload (small, unblocks consumers)

Add the field to the ingest contract and store it:

```rust
pub struct NodeInput {
    pub node_key: String,
    pub type_id: String,
    pub name: String,
    pub search_text: Option<String>,
    /// Attributes of this node. A JSON **object**; anything else is rejected.
    pub payload: Option<serde_json::Value>,
}
```

Four decisions this needs, with the recommendation and why:

**Absent ≠ empty.** `payload: null`/omitted means "I have no opinion, leave what
is stored"; `payload: {}` means "this node has no attributes, clear them". A
producer that knows only part of a node — this integration's repository importer
knows paths but nothing about file contents — must be able to upsert a node
without destroying attributes another producer wrote.

**Replace, not merge.** When a payload is supplied, it replaces the stored one
wholesale (`payload = EXCLUDED.payload`). Merging looks friendlier and is the
wrong default here: the ADR requires that no payload is stored without passing
validation, and under a merge the *result* is what would have to validate — so an
ingest could fail because of data a different producer wrote earlier. Replace
keeps a clean invariant: **the stored payload is always exactly one producer's
validated document.** If genuine multi-producer attribute merging is needed later
it should be namespaced per producer (`payload.<producer> = {...}`), which is a
modelling decision for those types, not a default for all of them.

**Ceiling enforced at ingest.** New config key `ingest_max_payload_bytes`
(suggested default 64 KiB), measured on the serialized payload, per node.
Exceeding it rejects the batch with a new `DomainError::PayloadTooLarge { node_key,
limit, actual }` mapping to 400 with a field violation naming the node — the same
shape `BatchTooLarge` already uses. This is
`cpt-cf-graph-storage-constraint-payload-ceiling` and it must exist from the
first version: it is what stops the graph becoming the platform's accidental blob
store, and adding it later is a breaking change for whoever got used to its
absence.

**Objects only.** A scalar or array payload is rejected. The model is attributes;
allowing a bare array now would make the annotation vocabulary in step 3
ambiguous about what a path refers to.

Reading it back has to come with it, or the field is write-only:

- `GET /nodes/{id}` (§ 2.4) returns the payload.
- `search` and `subgraph` take `?include=payload`, defaulting to **off** — the
  drawing path fetches hundreds of nodes and should not pay for attributes it
  does not render.

`embedding` belongs to the same step if § 2.5 is wanted: an optional
`Vec<f32>` on `NodeInput`, dimension-checked against the column (384) at
ingest, with a clear error rather than a database-level failure.

**Do not add `payload` to the property graph's `PROPERTIES` list.** A column
absent from that list is invisible to `MATCH`, which is the desired outcome:
pattern-level JSONB predicates would sit outside the index story the ADR
describes, and PostgreSQL 19 expands every hop into a join whose cost is already
the thing being managed. Payload filtering belongs in the outer scoped query, not
in the pattern.

### 3.3 Step 2 — validate against the type's schema

`POST /types` gains an optional `json_schema`, stored in the column that already
exists. When a type carries a schema, payloads are validated against it at ingest
and failures are reported by JSON pointer, as DESIGN requires. Types registered
without one keep accepting anything, so this is additive and needs no migration
for data written under step 1.

`jsonschema = "0.40"` is already a workspace dependency in `gears-rust`, so this
costs no new third-party surface.

Full GTS derivation-chain validation — walking the ancestry so a derived type
inherits its parents' constraints — is the step-3 concern. Step 2 validates
against the leaf type only, which is strictly better than today and does not
contradict the final behaviour.

### 3.4 Step 3 — ADR-0003 proper

The remaining, larger work, listed so the increments above are visibly on the way
to it and not a parallel design:

- The `x-gts-indexed` / `x-gts-vectorized` annotation vocabulary, published as a
  versioned meta-schema, with the conflict, inheritance and narrowing rules the
  ADR enumerates; registration rejects unknown or malformed extensions.
- Index activation lifecycle: `requested → building → active`, `retiring →
  removed`, with `CREATE INDEX CONCURRENTLY` in a background worker and filters
  admitted only while the supporting index is `active`.
- Search text composed by the gear from `x-gts-vectorized` attributes, which
  retires the producer-supplied `search_text` added by this integration.
- Tabular projection (`cpt-cf-graph-storage-fr-tabular-projection`) over
  annotated attributes, rejecting filters on unannotated ones with an error that
  names the indexed alternatives.

### 3.5 Order of work

| # | Item | Size | Unblocks |
| --- | --- | --- | --- |
| 1 | Read methods on `GraphStorageClientV1` (§ 2.1) | S | every in-process consumer |
| 2 | `payload` on ingest + read-back + ceiling (§ 3.2) | S | attributes on nodes at all |
| 3 | `direction` / `edge_types` on traversal (§ 2.3) | XS | typed graph queries |
| 4 | Delete and `prune` (§ 2.2) | M | any mirrored source that changes |
| 5 | Read by key, listing, cursor (§ 2.4) | M | consumers dropping their own id tables |
| 6 | Schema validation of payloads (§ 3.3) | M | contract enforcement between producers |
| 7 | Hybrid endpoint + embeddings (§ 2.5) | M | the reason SQL/PGQ was chosen |
| 8 | ADR-0003 annotations and index lifecycle (§ 3.4) | L | filterable attributes at scale |

Items 1–3 are days, not weeks, and together they take the gear from
"write-complete, read-thin" to usable as a dependency.
