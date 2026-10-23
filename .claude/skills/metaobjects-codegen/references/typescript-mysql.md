# MySQL on TypeScript

> Part of the `metaobjects-codegen` skill's TypeScript reference. Read it when the app's
> database is MySQL (or MariaDB / PlanetScale).

MySQL is a **code generation and runtime** dialect. `meta gen` generates Drizzle
`mysqlTable` entities, Zod schemas, queries and Fastify/Hono routes for it, and the
`ObjectManager` reads and writes it. **`meta migrate` does not own a MySQL schema** — it
refuses `--dialect mysql` — so you write and evolve the DDL yourself, and `meta verify --db`,
`--replay` and the `agent/schema.md` docs page do not apply. `meta verify --codegen`
and `--templates` work as on any dialect.

## Contents
- TypeScript setup
- Writing the DDL
- Reports
- Behaviour that differs from Postgres and SQLite

## TypeScript setup

```ts
// metaobjects.config.ts
export default defineConfig({
  dialect: "mysql",
  // …generators, outDir, dbImport as usual
});
```

```ts
// db.ts: what the generated routes import (dbImport)
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
export const db = drizzle(mysql.createPool(process.env.DATABASE_URL!));
```

For the ObjectManager, create the mysql2 pool with `timezone: "Z"`. `DATETIME` then holds the
UTC wall clock, which is what the generated tier and the Java driver store:

```ts
import { Kysely, MysqlDialect } from "kysely";
import { createPool } from "mysql2";
const db = new Kysely({ dialect: new MysqlDialect({ pool: createPool({ uri: url, timezone: "Z" }) }) });
const driver = kyselyDriver({ db, dialect: "mysql" });
```

## Writing the DDL

Write the tables to match the generated Drizzle declarations. The generated `<Entity>.ts` is
the reference: its column builders name the MySQL types.

| Field | Column |
|---|---|
| `field.string` with `@maxLength` | `VARCHAR(n)` |
| `field.string` without `@maxLength` | `TEXT`; `VARCHAR(255)` when the field is part of a key, an index, is `@unique` or has a `@default` (MySQL cannot key or default a `TEXT` column). Declare `@maxLength` to choose the length. |
| `field.enum` | `VARCHAR(n)`, where `n` is the longest member (int-backed: `INT`) |
| `field.int` / `field.long` / `field.currency` | `INT` / `BIGINT` / `BIGINT` |
| `field.decimal` | `DECIMAL(p,s)` (read back as a string) |
| `field.boolean` | `BOOLEAN` (`TINYINT(1)`) |
| `field.date` / `field.time` / `field.timestamp` | `DATE` / `TIME(3)` / `DATETIME(3)` |
| `field.uuid` / `field.inet` | `VARCHAR(36)` / `VARCHAR(45)` |
| arrays, `field.object`, `field.map`, `@dbColumnType: jsonb` | `JSON` |
| `@generation: increment` | `AUTO_INCREMENT` |
| `@generation: uuid` | `VARCHAR(36)`: the id is minted in the application |

A column named after a MySQL reserved word (`rank`, `order`) needs backticks in your DDL. The
generated code and both runtimes quote identifiers themselves.

### Reports

An `object.report` (the reporting vocabulary; see `references/reporting.md` in the
`metaobjects-authoring` skill) is a compiled view, and on MySQL you create that view
yourself, because `meta migrate` does not. Declare the report with a read-only
`source.rdb` of `@kind: view` and no `@unmanaged`, since `meta migrate` never targets MySQL
and so nothing manages the view either way:

```json
{ "source.rdb": { "@kind": "view", "@view": "v_program_minutes" } }
```

`buildReportViews` skips a report whose source is `@unmanaged: true`, so generate the SQL
before marking a source unmanaged if a shared model needs that flag for another database.

`buildReportViews` returns the body of each view-backed report for the `mysql` dialect. Put
each one in your own migration as `CREATE VIEW <name> AS <body>`:

```ts
import { buildReportViews } from "@metaobjectsdev/codegen-ts";
import { loadDirectory } from "@metaobjectsdev/metadata";

const { root } = await loadDirectory("metaobjects"); // wherever your metadata lives
for (const view of buildReportViews(root, { dialect: "mysql" })) {
  console.log(`CREATE VIEW \`${view.name}\` AS\n${view.sql};`);
}
```

The loop above ignores `view.schema`, which is the report source's `@schema` when it declares
one. If yours does, create the view in that schema yourself (qualify the name in your
migration); the loop will not.

The column names follow the project's `naming.columns` rule in `.metaobjects/config.json`
(default `snake_case`); set it there to match your tables.
The bodies are valid under MySQL's default `sql_mode`, `ONLY_FULL_GROUP_BY` included, and a
change to a report means a new `CREATE OR REPLACE VIEW` (or `DROP` and `CREATE`) in your
migrations; nothing diffs the live view for you. A `@spine` report's body is valid as
emitted too, and a measure with `@default` is a `COALESCE` whose column MySQL reports
`NOT NULL`. Two things differ from Postgres and SQLite:

- **Ratios and averages have four fractional digits by default.** MySQL divides to
  `div_precision_increment` digits, so a ratio of 2 to 3 is `0.6667` (Postgres returns
  `0.66666666666666666667`, SQLite `0.6666666666666666`), and a ratio of 3 to 4 is `0.7500`.
  A ratio that reads its `@default: 0` is `0.0000`.
- **`DATETIME` values are read as the UTC wall clock.** A `DATETIME(3)` column carries no zone,
  so every time grain and every relative-date window (`{ "now": "-P30D" }`, evaluated with
  `UTC_TIMESTAMP(3)` when the view is queried) treats the stored value as UTC. That matches
  what the generated tier and the ObjectManager store when the pool uses `timezone: "Z"`.

## Behaviour that differs from Postgres and SQLite

- **Writes read the row back.** MySQL has no `RETURNING`:
  - A create inserts the row, takes the key (from the body, or from `$returningId()` /
    `insertId` for `AUTO_INCREMENT`), and selects the row.
  - An update runs the `UPDATE` and then selects the row.
  - The generated `delete<Entity>ById` checks that the row exists before deleting it.
- **`like` is case-sensitive**, as the API contract requires (ADR-0049). MySQL's default
  collation is case-insensitive, so the generated routes compare with
  `COLLATE utf8mb4_bin`. The TypeScript-only `?search` stays case-insensitive.
- **Timestamps use Drizzle's `date` mode.** A `DATETIME` rejects the ISO wire form
  (`2026-05-28T20:26:40.002Z` is `ERROR 1292`). The generated Zod schema coerces the ISO string
  to a `Date`, Drizzle stores the UTC wall clock, and the JSON response carries ISO with `Z`.
  The `timestampMode` setting has no effect on MySQL.
- **`TIME` values cannot carry a UTC offset.** MySQL rejects them (`ERROR 1292`), so the
  generated write schema for a `field.time` column accepts `HH:MM[:SS[.fff]]` only and answers
  an offset with a 400. A `field.time` inside a value object is stored as JSON and still
  accepts an offset.
- **Index options.** MySQL has no partial indexes, so `@where` is not emitted. `@using` is not
  emitted either, because MySQL's index types are not access methods. Expression indexes
  (`@expr`) are emitted.
- **The `callable` generator** (stored procedures and table functions) emits Postgres calls
  only.
