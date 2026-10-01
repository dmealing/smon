# You don't have to generate everything — pick your layers

> Part of the `metaobjects-codegen` skill. Read it when the generated API does not fit the app, when you need derived or joined data, or when adopting onto existing code.

Codegen is **granular and à la carte, not all-or-nothing.** The most powerful
pattern when an app's API doesn't match generated CRUD: **generate the data layer,
hand-write only the API layer** — never abandon codegen wholesale and hand-write
the data access too.

- **Generate the data layer, skip the routes.** Omit `routesFile()` from the
  `generators` array (keep `entityFile()` + `queriesFile()` + `barrel()`): you get
  the typed entity/table, schemas, and query/finder helpers, then write your own
  routes by hand — *calling the generated queries*. Do this whenever the API shape
  (custom paths, HTML responses, nested payloads) doesn't fit generated REST CRUD.
- **Mix generated and hand-written routes.** Even with custom paths, mount the
  standard verbs with the runtime helpers and hand-write only the custom ones (see
  the runtime skill's `mountCrudRoutes` / `mount<Verb>Route` / `expose`). You are
  never forced into all-generated or all-hand-written.
- **Entity's OWN columns + a joined extra → an entity read-view, NOT a projection.**
  The most common legacy view is `SELECT o.*, c.name AS customer_name FROM orders o
  JOIN customers c …` — the entity *with a read route*, not an independent exposure.
  Reach for an **entity read-view** first: keep the entity's writable `table` source
  and add a **non-primary** read-only source (`source.rdb` `@role: replica`
  `@kind: view`), declaring only the *extra* as a derived (`origin.*`) field — the
  entity's own field set already covers `o.*`, so you re-state nothing but the extra.
  Codegen then routes **reads** to the view and **writes** to the table (derived
  fields don't exist there and are excluded from the write codecs); a create/update
  re-reads the row through the view by primary key, so the returned value carries the
  derived columns (read-your-writes). Shipped all five ports (#213 write half + #214
  read half). Reach for a **projection** (below) instead only when it is an
  independent exposure contract — a subset, renamed base columns, a versioned/external
  shape, or a row-filtered view. See `docs/features/source-kinds.md`.
- **Derived/aggregate data → declare a projection, then USE its generated query.**
  Don't hand-write a join or an `AVG()`/`COUNT()`. Declare an `object.projection`
  with `origin.*` children — `origin.passthrough` (a forwarded column),
  `origin.aggregate` (`@agg` `count`/`sum`/`avg`/`min`/`max`, plus the #195
  `any`/`all` predicate quantifiers over a `@filter` and `collect` array-rollup with
  optional `@distinct`/`@orderBy`; any aggregate may be row-scoped with `@filter`),
  `origin.computed` (a row-level `@expr`), and
  `origin.first` (one related row's column along `@via`/`@of`/`@orderBy`) — **and a
  read-only `source.rdb` `@kind: view` child** (codegen detects a projection by that
  read-only source, not by the subtype alone — omit it and nothing is generated).
  `meta gen` emits a read-only query for it (and `meta migrate` its DB view), and you
  **call that generated query from your route**. Declaring the projection is only half
  the win — *consuming* its generated query is the other half.
  - **Row-filtered views are a projection `@filter`, not hand-written SQL.** An
    object-level `@filter` on `object.projection` (the same `attr.filter` shape as a
    preset filter) scopes the whole view's rows — it lowers to the view's outer
    `WHERE` (#207). This is the metadata-managed way to author a soft-delete / status
    / type view without hand-writing SQL.
  - **Never hand-author the view SQL for a shape origins can express.** The
    `CREATE VIEW` body is emitted by the Node `meta migrate` from the projection's
    `origin.*` children — hand-writing it is a second source of truth that drifts
    silently, because an unmodeled DB view is *unmanaged*: `meta verify --db` never
    flags it. For a genuinely irreducible body (recursive CTE, window function, set
    op) that origins can't express, carry it in the `source.rdb` **`@sql`** escape
    (#208, ADR-0043) — a hand-written body the tool registers, fingerprints, and
    drift-checks (adopt a pre-existing view with `meta migrate --allow adopt-view`) —
    rather than a hand-edited migration file where it goes accidentally unmanaged.
    For a DB object owned entirely elsewhere (Flyway), mark its source
    **`@unmanaged: true`** (view or table); migrate/verify then never touch it.
    `@sql` and `@unmanaged` are mutually exclusive.

`meta gen --list` prints every generator by stable name (add `--probe` for a file count
against your own model); the `generators` array in `metaobjects.config.ts` is where you
opt each one in. It starts empty.

## Adopting onto existing code — make codegen match the code, not the code match codegen

On a **brownfield adoption** (existing working code / live schema — see
`metaobjects-authoring` → "Adopting onto an existing codebase"), the goal of codegen is to
**reproduce the shape the code already has** so the generated output drops in with minimal
churn. When generated output doesn't match — different names, file layout, imports, or
signatures than the existing code — **customize the codegen to match the existing code first**,
using the à-la-carte layers, `outputPattern`/target layout, naming strategy, template
customization, and owned/custom generators described here. That is the intended adoption path,
**not a hack** — the whole point of owned generators + three-way merge is to shape output to
your codebase. Reshaping working call sites to fit the generator's defaults is the **last**
resort, and only for the layer codegen is actually replacing (the hand-rolled CRUD/DTO/mapper
you're deleting behind a parity gate). If matching the existing shape would require a genuinely
hacky generator contortion, that is the moment to **ask the human** which side should give —
don't silently churn the existing code.
