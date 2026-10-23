# Declaring dimensions, measures and reports

How to declare a report. `reporting.md` covers the columns a report gets and how it behaves.

## Contents
- Reporting — dimensions, measures and reports

## Reporting — dimensions, measures and reports

Reach for it when a dashboard number would otherwise be a hand-written `GROUP BY`: revenue per
day, buyers per program, a total. You name the pieces once, on the entity that owns the rows,
and an `object.report` combines them by name. Four node kinds:

- `dimension.attribute` / `dimension.time` — what to group by (`@of: Entity.field`; a time
  dimension lists the `@grains` it supports: `hour`, `day`, `week`, `month`, `quarter`, `year`);
- `measure.aggregate` (`@agg`: `count`, `sum`, `avg`, `min`, `max`, `any`, `all`) and `measure.ratio`
  (`@numerator` / `@denominator`, both measures of the entity). `any` / `all` take a
  `field.boolean` `@of`, or no `@of` and a `@filter` or `@segment`: `{ "name": "hasError",
  "@agg": "any", "@filter": { "success": false } }` is "some row has `success` false" (a row
  whose condition is null does not pass);
- `segment.filter` — a named, reusable `@filter` ("active purchase");
- `object.report` — a top-level object: `@from` an entity, `@dimensions` (`name` or
  `name:grain`), `@measures`.

```json
{ "metadata.root": {
    "package": "acme::shop",
    "children": [
      { "object.entity": {
          "name": "Purchase",
          "children": [
            { "source.rdb": { "@table": "purchases" } },
            { "field.long":      { "name": "id" } },
            { "field.string":    { "name": "status" } },
            { "field.currency":  { "name": "amountCents" } },
            { "field.timestamp": { "name": "purchasedAt" } },
            { "identity.primary": { "name": "id", "@fields": ["id"] } },
            { "segment.filter":      { "name": "active", "@filter": { "status": "active" } } },
            { "dimension.time":      { "name": "purchasedAt", "@of": "Purchase.purchasedAt",
                                       "@grains": ["day", "month"] } },
            { "measure.aggregate":   { "name": "purchases", "@agg": "count", "@of": "Purchase.id",
                                       "@segment": "active" } },
            { "measure.aggregate":   { "name": "revenue", "@agg": "sum", "@of": "Purchase.amountCents" } }
          ]
      }},
      { "object.report": {
          "name": "DailyRevenue",
          "@from": "Purchase",
          "@dimensions": ["purchasedAt:day"],
          "@measures": ["purchases", "revenue"],
          "children": [
            { "source.rdb": { "@kind": "view", "@view": "v_daily_revenue" } }
          ]
      }}
    ]
}}
```

Three rules an author trips on:

1. **Every measure belongs to `@from`.** A report cannot mix measures of two entities (joining
   two fact tables multiplies each side's rows); two fact tables are two reports.
2. **`@via` is to-one only, and each hop needs a declared foreign key.** A dimension reaches a
   related entity's column through a `relationship.*` with `@cardinality: one` (or an
   `identity.reference`), never through a to-many, which would repeat fact rows and double-count
   a `sum`. The view joins the hop through an `identity.reference` between the two entities
   (`{ "identity.reference": { "name": "fkProgram", "@fields": ["programId"], "@references":
   "Program" } }`); a relationship with none behind it loads and then fails `meta migrate`.
   After `@via`, a bare entity name in `@of` resolves in the package of the entity the `@via`
   reaches (`"@of": "Realm.name"` after a hop onto `world::Realm`).
3. **A report declares no fields.** Its columns are derived: one per dimension, then one per
   measure (a time dimension at a grain is `<name><Grain>`, so `purchasedAt:day` is
   `purchasedAtDay`). A `field.*` or `identity.*` child on a report is an error.

Two questions to answer for every report:

- **Do I want the rows that have no facts?** A report's rows come from the facts, so a
  program nobody bought has no row. If the page should list it, add `"@spine":
  "Purchase.program"` to the report (a to-one path from `@from`, written like `@via`), and
  **reach every listed dimension through it**: each needs an `@via` that begins with the
  spine's hops (`programId` as `Program.id` via `Purchase.program`). A dimension on the fact
  row is a load error under `@spine`. List the spine entity's key to get one row per program.
- **Is zero true here, or is null?** A `sum`, `avg`, `min`, `max` or ratio with nothing to
  aggregate is null. If zero is the true answer (revenue of a program nobody bought), declare
  `"@default": 0` on the measure; if the value is unknown (an average rating with no
  ratings), leave it null. **Never on a `count`**: it is already `0`, and `@default` there is a
  load error. Write `0`, never `0.0`.

**A report is served only when it declares `source.rdb` with `@kind: view`.** That declaration
is what makes `meta migrate` create the view (Postgres, SQLite, D1), what every port's
runtime reads, and what makes every port's generators serve it: one read-only list route at
the pluralized snake_case name (`InvoicesByMonth` is `/invoices_by_months`), with paging,
and filter and sort on every derived field whose type has filter operators (an `object` or
`map` derived field is neither filterable nor sortable), `405` on `POST` and no `/{id}`
route. A report with
no `source.*` is checked at load and generates nothing.

A report `@from` a TPH subtype is refused when its view is derived (the subtype shares its
base's table): declare it `@from` the base with an `@filter` on the discriminator field.

What does not exist: no grid or form for a report (TypeScript generates a list hook; no other port has a client tier), no way to narrow which
derived fields are filterable, no `measure.derived`
(arithmetic between measures beyond `measure.ratio`), no query-time choice of dimensions or
measures (a report is a fixed, compiled combination), and no time-zone vocabulary (grains and
relative dates are UTC). Column types, the null rules, Monday weeks and per-engine differences
are in `references/reporting.md`.
