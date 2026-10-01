# Projections, `origin.*`, and managed views

> Part of the `metaobjects-authoring` skill. The skill covers the entity read-view, which is the right answer for most grids. Read this when you need an independent exposure (`object.projection`), the `origin.*` vocabulary, `@filter` / `@expr` shapes, or an `@sql` / `@unmanaged` view.

## Read-view or projection?

**Reach for a projection only when one of these is true** (from
`docs/features/source-kinds.md`, which carries the full decision table):

| Entity read-view | Projection |
|---|---|
| extras sit over the entity's **own** table | an independent **exposure contract** |
| same trust domain — a new entity field showing up in the view is correct | a subset, **renamed** columns, versioned, or external consumers |
| the base is still INSERTable and is the record of truth | keyless, multi-base, proc-backed, all-derived, or borrowed identity |

Two things genuinely force a projection: **renamed base columns** (a field carries one
`@column` per paradigm) and **row-filtered views** (soft-delete / `WHERE status='active'`
— an entity read-view exposes the whole entity; only a projection carries a row-scope
`@filter`, #207).

Choosing a projection when a read-view would do costs a second URL, a second type, a
second identity declaration, and re-stating every passthrough column — for no gain.

## Projections

A derived read model that IS an independent exposure is an **`object.projection`**
(FR-024): its fields `extends` entity fields (`extends: "Author.id"` — dotted
child traversal, package only on the root segment) and/or carry `origin.*`
children (`passthrough` / `aggregate` / `computed` / `first`)
declaring assembly; its identity passes through via `extends` (`identity.primary:
{ name: id, extends: "Author.id" }`); it is read-only by construction and the
declared field set IS the exposure (fail-closed). Give it a read-only `source.rdb`
`@kind: view` child (`source.rdb: { kind: view, view: v_author }`) — codegen keys
projection detection + view DDL off that read-only source, so without it `meta gen`
emits nothing for the projection.

**The borrowed key may be ANY unique key — including a composite, and including the
entity's `identity.secondary`.** The single-field `extends: "Author.id"` above is the
common case, not the limit. Both of these are legal:

```yaml
# Composite primary → composite primary. @fields is COMPUTED from the local
# pass-through fields, so it is optional here (declare it and it must agree).
- identity.primary: { name: pk, extends: "Order.pk" }      # Order.pk = [tenant, ref]

# A read model keyed on the entity's BUSINESS key, never surfacing its surrogate id.
# Account has both: identity.primary pk (auto-increment id) AND identity.secondary
# byCode (tenant + code). The view exposes tenant + code and borrows byCode.
- identity.primary: { name: pk, extends: "Account.byCode" }
```

The rule is **uniqueness, not nomination**: ADR-0040 put uniqueness in the type, so
`identity.primary` and `identity.secondary` are both unique keys and either can back a
projection's key. `identity.reference` cannot — a foreign key is not unique, so
`identity.primary extends: "Account.ownerRef"` is `ERR_EXTENDS_TARGET_MISMATCH`.

Key correspondence still holds in every case: every field named by the borrowed identity's
`@fields` needs a local field `extends`-ing that entity field, or the load fails with
`ERR_IDENTITY_KEY_MISMATCH` — the identity cannot claim a pass-through the fields do not
make.

**A CONCRETE projection declares its OWN source — never inherits one.** A
projection may `extends` another projection to reuse shape, but the child must
declare its own `source.rdb`; inheriting the parent's is
`ERR_PROJECTION_INHERITED_SOURCE`. `extends` only ADDS fields, so an inherited view
cannot provide the child's extra columns, and two objects would claim one physical
view with different exposures. The sanctioned pattern is an **abstract, sourceless**
projection base carrying shared shape, with each concrete projection declaring its
own view — so a versioned successor (`CustomersV2 extends CustomersV1`) declares
`v_customers_v2` rather than silently sharing V1's view. (Same rule JPA gets from
`@MappedSuperclass` and Django documents as the `db_table`-on-abstract trap; ADR-0028
amendment 2026-08-06.)

**Origin vocabulary (#195).** `origin.aggregate @agg` takes `count`/`sum`/`avg`/`min`/`max`
(numeric reduces over `@of`), `any`/`all` (predicate quantifiers over a `@filter`; `@of`
forbidden; empty set → `any=false`, `all=true`), and `collect` (an array rollup
into an `isArray` field, with optional `@distinct` / `@orderBy`). **`collect` is the one
`@agg` where `@of` is OPTIONAL (#335):** name a column with `@of` to collect scalars, or
omit `@of` on a `field.object @objectRef` to collect each related row as that declared
value object — a **whole-object rollup**, lowered to `jsonb_agg(jsonb_build_object(…))`
on Postgres. The whole-object form requires an explicit `@via`, refuses `@distinct` (it is
a no-op whenever the value object carries the primary key), and requires every value-object
member to match a field on the `@via` **terminal** entity by name, with the same subtype
and array-ness. The declared value object IS the exposure: a field the entity has and the
value object omits is not projected. Any aggregate may be
row-scoped with `@filter`. `origin.computed` carries a closed structured `@expr` tree (a
derived scalar). `origin.first` picks one related row's column (`@of`) along `@via`,
ordered by a **required `@orderBy`** (`["field:asc|desc", …]`, with the PK as tie-break) —
the ordering is what makes `origin.first` express "latest / earliest X"; it may be
row-scoped with `@filter` and is nullable. A field carrying any `origin.*` is derived ⇒
read-only.

`@expr` and `@filter` are **structured objects, not SQL strings** — guessing a string
body fails the load:

- **`@expr`** (on `origin.computed`) is a closed operation tree; a string body is a load
  error (`ERR_BAD_ATTR_VALUE`):
  ```json
  { "origin.computed": { "@expr": { "op": "isNotNull", "arg": { "field": "payloadJson" } } } }
  ```
- **`@filter`** (on `origin.aggregate` / `origin.first`, and object-level on a projection)
  is an `attr.filter` object — a field→predicate map. A bare value is `eq` shorthand; an
  operator map spells the op:
  ```json
  { "origin.aggregate": { "@agg": "any", "@via": "Session.turns", "@filter": { "success": false } } }
  { "@filter": { "status": { "ne": "archived" } } }
  ```

**Projection row-scope `@filter` (#207).** An object-level `@filter` on `object.projection`
(the same `attr.filter` object shown above) scopes the WHOLE view's rows — it lowers to
the view's outer `WHERE`. This is the metadata-managed way to author a soft-delete /
status / type view without hand-writing SQL. It may reference **only declared,
non-aggregate-derived** projection fields: naming an undeclared field fails the load
(`ERR_BAD_ATTR_FILTER`), and so does naming a field whose value comes from an
`origin.aggregate`.

```json
{ "object.projection": { "name": "ActiveOrders",
    "@filter": { "status": { "ne": "archived" } }, "children": [ … ] } }
```

**The `CREATE VIEW` body is generated from those `origin.*` children by the Node
`meta migrate` — never hand-author view SQL for a shape origins can express** (an unmodeled
view is *unmanaged*, so `meta verify --db` can't even catch the drift). For a genuinely
irreducible body (recursive CTE, window function, set operation) that origins can't express,
carry it in the `source.rdb` **`@sql`** escape (#208, ADR-0043) — a hand-written body the
tool registers, fingerprints, and drift-checks (adopt a pre-existing view with
`meta migrate --allow adopt-view`) — rather than a hand-edited migration file where it goes
accidentally unmanaged. For a DB object owned entirely elsewhere (Flyway), mark its source
**`@unmanaged: true`** (view or table); migrate/verify then never touch it.

**`@sql` fail-closed rules — an `@sql` body is a *second* source of truth, so the loader
walls it off (#208).** Author an `@sql` source under these constraints or the load fails:

- `@sql` is legal **only on a read-only `@kind`** (view / materializedView / storedProc /
  tableFunction) — never on a writable `@kind: table` (`ERR_SQL_BODY_ON_WRITABLE_KIND`).
- **No `origin.*`-bearing field may live under an `@sql` host** — the body already *is*
  the derivation, so an origin alongside it is a double-declaration
  (`ERR_ORIGIN_UNDER_SQL_BODY`). If you add an `@sql` body to a projection, **move its
  derived fields out** (into plain declared fields the body computes) rather than keeping
  their `origin.*` children.
- The object-level `@filter` (#207) is **mutually exclusive with `@sql`** (same error) —
  fold the predicate into the `@sql` body's own `WHERE`.
- `@sql` and `@unmanaged` are **mutually exclusive** (`ERR_SQL_BODY_WITH_UNMANAGED`); an
  empty/whitespace `@sql` is rejected (`ERR_BAD_ATTR_VALUE`).
- Under **`@unmanaged`**, an `origin.*`-bearing field only **warns** (the marker acts on
  nothing, so a documented-but-unacted-on lineage is benign) — the asymmetry with `@sql`
  is deliberate.
- Today `meta migrate` **lowers `@sql` only on `@kind: view`**; on matview / storedProc /
  tableFunction it is registered but not yet migrate-managed (mark those `@unmanaged`).

**A `passthrough` field must match its `@from` source's type.** A passthrough
forwards the source value unchanged, so the projection field's `field.<subType>`
and array-ness must be identical to the source field's — a `field.uuid` source
declared as `field.string` on the projection fails load with
`ERR_PASSTHROUGH_TYPE_MISMATCH` (this is exactly the mismodeling that leaves a
view `String`-typed over a `uuid` column and forces hand-written coercion).
Declare the source's type. If the type genuinely must differ on purpose, set
`@convert: true` on the `origin.passthrough` to acknowledge it — an
acknowledgement only, it does **not** generate a cast (you own any coercion).
Nullability may differ (an outer-join view legitimately widens `NOT NULL` →
nullable) — only subType + array-ness are checked.
