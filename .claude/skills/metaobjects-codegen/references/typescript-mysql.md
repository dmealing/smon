# MySQL on TypeScript

> Part of the `metaobjects-codegen` skill's TypeScript reference. Read it when the app's
> database is MySQL (or MariaDB / PlanetScale).

MySQL is a **code generation and runtime** dialect. `meta gen` generates Drizzle
`mysqlTable` entities, Zod schemas, queries and Fastify/Hono routes for it, and the
`ObjectManager` reads and writes it. **`meta migrate` does not own a MySQL schema** — it
refuses `--dialect mysql` — so you write and evolve the DDL yourself, and `meta verify --db`,
`--replay` and the `agent/schema.md` docs page do not apply. `meta verify --codegen`,
`--templates` and `--docs` work as on any dialect.

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
