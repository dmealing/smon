# Sources and read-views

## Contents
- Sources — `source.rdb` + `@kind`
- A store MetaObjects does not manage — MongoDB, Cassandra, Neo4j, an API
- Derived/computed columns: reach for an ENTITY READ-VIEW first

## Sources — `source.rdb` + `@kind`

`source.rdb` declares where an entity's data lives. Read-only-ness derives from
`@kind` (it is NOT a separate subtype):

| `@kind` | Read-only | Default? |
|---|---|---|
| `table` | no | yes (when `@kind` omitted) |
| `view` | yes | – |
| `materializedView` | yes | – |
| `storedProc` | yes | – |
| `tableFunction` | yes | – |

The physical name attr is **kind-matched** — never `@name`: `@table` for a table,
`@view` for a view, `@materializedView`, `@proc` (storedProc), `@function`
(tableFunction). (`@table` on a non-table kind is a pre-1.0 legacy spelling the
canonical serializer rewrites to the kind's alias; author the kind-matched attr
directly.) The physical column name on a field is `@column`. `@schema` namespaces
the DB schema (Postgres default `public`; SQLite rejects non-default values).
Multi-source: multiple `source.rdb` children, each with a `@role`, exactly one
`primary`.

```json
{ "source.rdb": { "@kind": "view", "@view": "v_author", "@schema": "blog" } }
```

**This declaration is the only place a physical name is ever spelled.** Codegen emits a
per-object names artifact from it (`<Entity>Names` — `ProgramNames.fields.createdAt.column`,
`ProgramNames.CreatedAtColumn`, `PROGRAM_CREATED_AT_COLUMN`, per port), the generated table
binding reads that artifact, and hand-written SQL, repositories and migration scripts
reference it — so a consumer never restates `v_author` or `created_at`, and a rename here
propagates. Declare `@column` explicitly whenever the physical name is not the naming
strategy's answer (`callPurpose` → `purpose_code`): nothing downstream can recover that
mapping by derivation, and the constant is what carries it. (See `metaobjects-codegen` →
"Never hand-write a physical name".)

**An entity's PRIMARY source must be writable** (`table`) — read-only kinds are
legal only in non-primary roles.

### A store MetaObjects does not manage — MongoDB, Cassandra, Neo4j, an API

`source.rdb` is the only registered source. A record kept in a document, wide-column or
graph store, or behind a remote API, is an `object.entity` with an `identity.primary` and
**no `source.*` child**: a *sourceless entity*. Do not invent a document or graph source
subtype, or a `@collection` attr: ADR-0007 designs them but registers only `rdb`, so the
loader refuses them. Put
store settings in your own property bag instead: any `@name` whose value is a JSON object is
a registered `attr.properties` bag, for example `"@mongo": { "collection": "orders" }`.

A sourceless entity gets no table, queries, routes or migration. It still gets its wire
contract in every port: the create and PATCH schemas and the filter allowlist. Keep the
`identity.primary`, because it is what makes the record addressable. Without it the object
is a shape only. The data access layer is a generator you own: the procedure is in the
`metaobjects-codegen` skill, `references/any-stack.md`, and on TypeScript
`references/typescript-document-store.md` carries a complete, tested MongoDB repository
generator to copy.

**The database dialect is codegen config, not metadata.** MySQL, Postgres, SQLite and D1
entities are all modeled with `source.rdb`; `dialect` in the codegen config picks the target.
Do not encode the database in the model.

### Derived/computed columns: reach for an ENTITY READ-VIEW first

**Do not default to `object.projection` for a list screen, grid, or "one extra
column" read.** The usual need — an entity's own rows plus a joined display name or a
per-row count, filterable and sortable like any other column — is an **entity
read-view**, not a projection:

```jsonc
{ "object.entity": { "name": "Order", "children": [
  { "source.rdb": { "@kind": "table", "@table": "orders" } },              // writes
  { "source.rdb": { "@kind": "view", "@view": "v_order", "@role": "replica" } },  // reads
  // …the entity's own fields stay as they are — you re-state NOTHING…
  { "field.string": { "name": "customerName", "@filterable": true, "children": [
    { "origin.passthrough": { "@from": "Customer.name" } } ]}},
  { "field.int": { "name": "itemCount", "@filterable": true, "children": [
    { "origin.aggregate": { "@agg": "count", "@of": "OrderItem.id", "@via": "Order.items" } } ]}}
]}}
```

That is the whole change. Writes route to the table (derived fields are excluded from
the write codecs); reads route to the view; `meta migrate` emits the `CREATE VIEW` from
the **same assembly logic** a projection view uses — one emitter, two hosts (FR-024 §7,
#213/#214). Filtering and sorting on `customerName` / `itemCount` work like any other
column because the filter tier runs against the view.

**When you need an independent exposure** — a subset, renamed columns, a row-filtered
view, a versioned or external shape — that is an `object.projection`. It, the `origin.*`
vocabulary, the structured `@filter` / `@expr` shapes and the `@sql` / `@unmanaged` escapes
are in `references/read-views-and-projections.md`.
