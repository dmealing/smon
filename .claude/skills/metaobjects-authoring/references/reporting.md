# Reporting: the columns a report gets, and how it behaves

> Part of the `metaobjects-authoring` skill. `declaring-reports.md` covers declaring dimensions, measures, segments and a report. Read this when you need to know what a report returns: its column names and types, the time-grain and null rules, rows with no facts (`@spine`), defaults for empty measures (`@default`), what differs between databases, and what it leaves out.

## Contents
- A report is served only with a view source
- The columns you get
- Time grains
- Relative dates
- Nulls and zeros
- Rows with no facts: `@spine`
- Joins: a dimension through a required reference drops rows
- Engine differences
- Known limits
- How a report is served
- Exporting to Cube
- What a report does not have

## A report is served only with a view source

A report is a compiled view. The report's **own** read-only source decides what happens:

| The report declares | Result |
|---|---|
| no `source.*` | Checked at load, nothing else. No view, no migrate statement, no runtime read (an `ObjectManager` refuses it as "not served"). |
| `source.rdb` with `@kind: view` | `meta migrate` creates the view (Postgres, SQLite, D1) under the source's `@view` name, and every port reads it. |
| the same, plus `@sql` | Your SQL is the view body. The columns below still define what is read. |
| the same, plus `@unmanaged: true` | `meta migrate` never creates or drops it; the runtime still reads it. |
| `@kind: materializedView`, `storedProc`, `tableFunction` | `meta migrate` skips it. |

A derived report view (no `@sql`) whose `@from` entity has no table (abstract, or no writable `source.rdb`) fails `meta migrate` with an error naming the report and the entity; a report with an `@sql` source skips that check, since your SQL is used as written. A changed report is dropped and re-created by `meta migrate`. When a report declares several read-only sources, the one with `@role: primary` decides (else the first).

## The columns you get

A report declares no fields. Its columns are one per `@dimensions` item in listed order, then one per `@measures` item in listed order, named by the derived field name (your naming strategy applies to that name; an `@column` on the `@of` field is not inherited). A report has no primary key: read it with list and count (filter, sort and limit work on the derived columns); get-by-id and every write are refused.

| Item | Column | Type | Never null? |
|---|---|---|---|
| `dimension.attribute` | the dimension's name | the `@of` field's type | only with no `@via` and an `@of` field with `@required: true` |
| `dimension.time` at `hour` | `<name>Hour` | `timestamp` | same rule |
| `dimension.time` at `day`, `week`, `month`, `quarter`, `year` | `<name><Grain>` | `date` (first day of the bucket) | same rule |
| `count`, with or without `@distinct` | the measure's name | `long` | yes |
| `sum` of `int` / `long` | the measure's name | `long` | no |
| `sum` of `currency` | the measure's name | `currency` (minor units) | no |
| `sum` of `decimal` | the measure's name | `decimal` | no |
| `sum` of `double` / `float` | the measure's name | `double` | no |
| `avg` of `int`, `long`, `currency`, `decimal` | the measure's name | `decimal` | no |
| `avg` of `double` / `float` | the measure's name | `double` | no |
| `min` / `max` | the measure's name | the `@of` field's type | no |
| `any` / `all` (boolean OR / AND, `bool_or` / `bool_and`; over a `field.boolean` `@of`, or with no `@of` over the measure's `@filter` / `@segment`) | the measure's name | `boolean` | no |
| `measure.ratio` | the measure's name | `decimal` | no |
| any measure above except `count`, declaring `@default` | the measure's name | as above | yes: it reads the default instead of null |
| in a `@spine` report, a dimension over a column of the spine entity | the dimension's name | the `@of` field's type | yes when the field is `@required` or in that entity's `identity.primary`; no for a dimension beyond the spine entity |

Only those last two rows make a measure other than `count`, or a dimension reached by `@via`, never null; every port's row type follows (no `| null`, no `?`, no `Optional`). A column carries its `@of` field's type-shaping attributes (`@currency`, `@values`, `@precision`, `@scale`, `@localTime`, ...) and nothing else: no field `@default`, no validators.

## Time grains

`hour, day, week, month, quarter, year`; `hour` is illegal on a `field.date`. **Weeks start on Monday (ISO-8601)** on every engine: Sunday 2026-05-17 falls in the week of 2026-05-11, and Monday 2026-06-01 opens its own week.

**Bucketing is UTC.** A `field.timestamp` instant is bucketed in UTC whatever the reader's session time zone is, so every reader gets the same buckets. A `@localTime` timestamp and a `field.date` are bucketed as stored. There is no vocabulary for another time zone; do not look for one.

## Relative dates

A filter value `{ "now": "-P30D" }` (the current time plus a signed ISO-8601 duration) is legal only on a `field.date` or `field.timestamp`, under `gt`, `gte`, `lt` or `lte`, and only in the `@filter` of a `segment`, a `measure.aggregate` or an `object.report`. It is evaluated when the view is **queried**, against the UTC clock.

## Nulls and zeros

- A `count` is `0` over nothing, never null. It counts rows whose `@of` column is not null; a tuple with any null component is not counted.
- A `sum` of nothing is **null**, not zero: no matching rows, or a filtered measure that matched none of a group's rows. So are `avg`, `min` and `max`.
- An `any` or `all` over no rows, or only null values, is **null**, not `false`. `"@default": 0` reads `false` and `"@default": 1` reads `true` (any other number is refused).
- A ratio is `numerator / NULLIF(denominator, 0)`: a zero denominator is **null**. Each operand must be a numeric measure: a `count`, a `sum`, an `avg`, or a `min` or `max` of a numeric field. An `any` or `all` (a boolean), or a `min` or `max` of a date, timestamp, string, uuid or enum, is refused as `@numerator` or `@denominator`. For a share, use an `@agg: count` with a `@filter`.
- A report with no dimensions is one row for the whole table, and still one row over an empty table (counts `0`, sums and ratios null).

**Ask: is zero true here, or is null?** If "nothing to aggregate" means zero (revenue of a program nobody bought is `0`), declare `"@default": 0` on the measure (`revenue` in the example under "Rows with no facts"). If it means unknown (the average rating of a product with no ratings is not `0`), leave it null. Do not default in the client what the model can state once.

- `@default` is an integer. Write `0`, not `0.0`: a fraction (`0.5`) is refused in every port, and `0.0` loads in TypeScript but is refused by C#, Java and Python.
- **Never on a `count`** (it is never null, so the default could never apply) and never on a `min` / `max` over a field that is not numeric (a date or a string): both are load errors.
- It applies whenever the measure would be null: nothing matched, every matched value was null, or a ratio's denominator is zero or null. The column is then never null in any port.
- **A ratio's operand carries its own `@default` into the ratio.** `revenue` defaulted to `0` over `buyers` reads `0` for a group with buyers and no revenue. The ratio's own `@default` covers a zero denominator.
- A filter on a defaulted measure sees the default: `?filter[revenue][eq]=0` matches the empty rows, `isNull=true` matches nothing. A sort on it is the same on every engine.

## Rows with no facts: `@spine`

A report's rows are the dimension tuples its `@from` rows have, so a per-program report has no row for a program nobody bought. **Ask: do I want the rows that have no facts?** If the page lists every program (a catalogue, a chart whose empty bars matter), add `@spine`: a to-one path from `@from`, written like `@via`, to the entity whose rows the report should have.

```json
{ "metadata.root": {
    "package": "acme::shop",
    "children": [
      { "object.entity": { "name": "Program", "children": [
          { "source.rdb": { "@table": "programs" } },
          { "field.long": { "name": "id" } },
          { "field.string": { "name": "title" } },
          { "identity.primary": { "name": "id", "@fields": ["id"] } } ] } },
      { "object.entity": { "name": "Purchase", "children": [
          { "source.rdb": { "@table": "purchases" } },
          { "field.long": { "name": "id" } },
          { "field.long": { "name": "programId" } },
          { "field.currency": { "name": "amountCents" } },
          { "identity.primary": { "name": "id", "@fields": ["id"] } },
          { "identity.reference": { "name": "fkProgram", "@fields": ["programId"], "@references": "Program" } },
          { "relationship.association": { "name": "program", "@objectRef": "Program", "@cardinality": "one" } },
          { "dimension.attribute": { "name": "programId", "@of": "Program.id", "@via": "Purchase.program" } },
          { "dimension.attribute": { "name": "programTitle", "@of": "Program.title", "@via": "Purchase.program" } },
          { "measure.aggregate": { "name": "purchases", "@agg": "count", "@of": "Purchase.id" } },
          { "measure.aggregate": { "name": "revenue", "@agg": "sum", "@of": "Purchase.amountCents", "@default": 0 } } ] } },
      { "object.report": { "name": "ProgramSales", "@from": "Purchase", "@spine": "Purchase.program",
          "@dimensions": ["programId", "programTitle"], "@measures": ["purchases", "revenue"],
          "children": [ { "source.rdb": { "@kind": "view", "@view": "v_program_sales" } } ] } }
    ]
}}
```

A program with no purchases has a row: `purchases` `0`, `revenue` `0`.

- **Every dimension goes through the spine.** Each listed dimension needs an `@via` that begins with the spine's hops (`programId` is `Program.id` via `Purchase.program`). A dimension on the fact row (`Purchase.programId` with no `@via`, the purchase month) is a load error: a program with no purchases has no value for it.
- **Write the same hops as the spine.** `Purchase.program` (relationship) and `Purchase.fkProgram` (reference) are the same join, but a spine written one way and a dimension the other is refused.
- List at least one dimension, and list the spine entity's key (`Program.id`) to get exactly one row per program; two programs listed only by a shared title are one row.
- On a row with no facts, a `count` is `0` and every other measure is null unless it declares `@default`.
- The report's `@segment` and `@filter` still scope the facts and never remove a program's row. They name `@from`'s fields only; to show only some programs, list the column as a dimension and filter it on the request.
- A fact whose reference is null, or matches nothing, is in no row of a `@spine` report.
- Every hop needs an `identity.reference`, and the spine entity (and every entity on the way) needs a table of its own: an abstract entity or a TPH subtype fails `meta migrate`.
- The empty rows are listed and counted on the route; `?filter[purchases][gt]=0` hides them on request, so one report serves both pages.

## Joins: a dimension through a required reference drops rows

A dimension reached by `@via` joins like a projection does: a required belongs-to foreign key joins `INNER`, anything else `LEFT OUTER`. So **a fact row whose required reference matches no row is left out of that report** (a dimension you do not list adds no join). That is the existing projection rule, not a reporting special case. In a `@spine` report every join is `LEFT OUTER`.

**Each `@via` hop needs a foreign key the model declares**: an `identity.reference` between the two entities, for example `{ "identity.reference": { "name": "fkProgram", "@fields": ["programId"], "@references": "Program" } }` on the entity that holds `programId`. A `relationship.*` with `@cardinality: one` and no reference behind it loads, and then `meta migrate` fails with an error naming the hop.

## Engine differences

| | Postgres | SQLite / D1 | MySQL |
|---|---|---|---|
| View created by | `meta migrate` | `meta migrate` | you: see below |
| A ratio or `avg` of `2` over `3` | `0.66666666666666666667` | `0.6666666666666666` | `0.6667` |
| `decimal` | `NUMERIC` | none: `avg`, a ratio and a `sum` of a decimal column are `REAL` | `DECIMAL` |
| A ratio reading its `@default: 0` | `0` | `0.0` (the default is written `0.0` so the `REAL` column keeps one storage class) | `0.0000` |
| Instants | `TIMESTAMPTZ` | ISO-8601 text | `DATETIME(3)`, read as the UTC wall clock |

**MySQL owns its own DDL.** `meta migrate` never targets MySQL, so you create the view yourself: `buildReportViews(root, { dialect: "mysql" })` (`@metaobjectsdev/codegen-ts`) returns each view-backed report's body. That function is in the TypeScript package, so the MySQL view SQL comes from a TypeScript toolchain whatever language your application is in; the recipe showing the loop ships as the MySQL guide in the `metaobjects-codegen` skill's TypeScript stacks only. It skips a report whose source is `@unmanaged`.

## Known limits

- **A report `@from` a TPH subtype is refused** when its view is derived. The subtype shares its base's table with every other subtype, so the view would count all of their rows. Declare the report `@from` the base, with an `@filter` on the discriminator field (`"@filter": { "kind": "ADMIN" }`). An `@sql` or `@unmanaged` report over a subtype is yours to scope.
- **An empty `in` list in a filter is refused** at `meta migrate`, naming the report and the field.
- **An abstract view-backed report, or one whose source `@kind` is `materializedView`, `storedProc` or `tableFunction`, is not served by any port and gets no C# row class and no Kotlin table object.** The TypeScript, Java and Python runtimes still read whatever relation the source names (fine for a materialized view you created, a database error for a routine).
- **Do not group by a `field.object`.** A dimension over one, or over a field carrying `@objectRef`, loads everywhere but is refused by name by Java OMDB on read and by Java, Kotlin and C# `gen`; only TypeScript and Python read and serve it (as parsed JSON, neither filterable nor sortable). Group by a scalar field.
- **One `@spine` per report.** Two independent spines (every program against every customer) cannot be written. Entities to-one beyond the spine are ordinary dimensions.
- **No row scope on the spine entity** (only published programs): a report `@filter` names `@from`'s fields. List the column as a dimension and filter it on the request.
- **No fact-row dimension beside a spine** (every program, split by purchase month), and no dimension over the reference column itself (`Purchase.programId`). Declare it over the spine entity's key instead. Zero-filled time buckets are not available yet.
- **No join on a natural key, no anti-join, no report over two fact tables.** A `@spine` reaches its facts through a declared reference only: give the fact a reference to the spine entity.
- **`@default` is a whole number.** A fraction is `ERR_BAD_ATTR_VALUE` on the measure in every port (TypeScript's message says it is not an integer; C#, Java and Python use their integer-attribute message). `0.0` or `1.0` loads in TypeScript and is refused elsewhere, and `"zero"` on a `count` is two errors in TypeScript, C# and Python but one in Java. Write `0`.

## How a report is served

A concrete report whose read source is `@kind: view` is served by every port's generated code. An abstract report, a sourceless one, and one over a `materializedView`, `storedProc` or `tableFunction` are not.

| Request | Answer |
|---|---|
| `GET /<apiPrefix>/<segment>` | `200`, an array of rows, one per distinct dimension tuple. `?filter[...]`, `?sort=`, `limit`, `offset` and `withCount=1` work as on any list route; `total` counts groups after filtering. |
| `POST /<apiPrefix>/<segment>` | `405 {"error": "method_not_allowed"}` |
| any verb on `/<apiPrefix>/<segment>/{id}` | not mounted (the framework's `404`): a report has no identity |

- `<segment>` is the report name, snake_cased then pluralized, like any object: `InvoicesByMonth` is `/invoices_by_months`, `StoreTotals` is `/store_totals`. There is no report-specific spelling.
- **Every derived field with filter operators is filterable and sortable**, dimension and measure alike, with its type's own operators. You cannot narrow that set: a report has no field to put `@filterable` on. A field of the `@from` entity that the report does not expose is refused with a `400`.
- A time dimension at `day` or coarser is `YYYY-MM-DD`; a null measure is `null` with the key present (a measure with `@default` is never null); `currency` is integer minor units.
- **A decimal (`avg`, a ratio, a `sum` of a decimal) is one canonical string in every port** (ADR-0019 Amendment 1: `12.5`, never `12.50` or an exponent). Display formatting is a view's job. Do not parse it as a float to compare.
- `meta gen` writes a model page for every report (`docsFile()`; a sourceless one is marked "Not served") and an API page for a served one (`apiDocsFile()`) — each an ordinary entry in `generators`.

The files each port generates are in the `metaobjects-codegen` skill's reference for that language ("Reports").

## Exporting to Cube

The TypeScript `cube-model` generator (`meta eject cube-model`; see the `metaobjects-codegen` skill's
TypeScript reference) writes this vocabulary as Cube data-model files: a cube for each table-backed
entity that declares dimensions, measures or segments, and a rollup for each served report. It keeps
your names as written, so an entity, dimension, measure or segment name must be one Cube accepts (a
letter first, then letters, digits and `_`, and not a Python keyword such as `from`, `class` or `in`);
otherwise the export fails with `ERR_CUBE_INVALID_NAME` and renames nothing. It also refuses a
dimension over an array, object or map field. A report with a relative date in its `@filter`,
its `@segment`'s filter or a listed measure's condition gets no rollup. Its `<report>Scope`
segment is written only when it has a `@filter`. A served report with `@spine` becomes a Cube view
with its scope inside a facts cube and no rollup, so the spine's empty rows survive, and a measure's
`@default` is a `COALESCE`, as in the view. A report that is not served contributes nothing. Reference: `docs/features/cube-export.md`.

## What a report does not have

In TypeScript a served report gets a generated list hook; no port generates a grid or a form for a report, and the other ports have no client tier, so there you get the route and the row type. There is no `measure.derived`, no query-time choice of dimensions or measures, and no time-zone vocabulary.
