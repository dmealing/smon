# Prisma on TypeScript

> Part of the `metaobjects-codegen` skill's TypeScript reference. Read it when the app keeps
> Prisma as its ORM.

Under `orm: "prisma"`, `meta gen` writes `schema.prisma` from the model, along with Zod schemas
and types that have no Drizzle code. Prisma still creates the tables (`prisma db push` or
`prisma migrate`) and runs the queries. `meta verify --codegen` fails when someone edits
`schema.prisma` or it is out of date. `meta verify --db` fails when the database Prisma created
differs from the model (Postgres and SQLite). Do not hand-write a Prisma model for a table the
MetaObjects model declares.

## Contents
- TypeScript setup
- The workflow
- How the model maps
- What it refuses
- SQLite and MySQL
- Eject it

## TypeScript setup

```ts
// metaobjects.config.ts
import { defineConfig } from "@metaobjectsdev/cli";
import { prismaSchemaFile } from "@metaobjectsdev/codegen-ts/generators";

export default defineConfig({
  orm: "prisma",
  dialect: "postgres",                 // "postgres" | "mysql" | "sqlite": picks the Prisma provider
  outDir: "src/generated",             // Zod schemas and types
  targets: { prisma: { outDir: "prisma" } },
  generators: ["entity", prismaSchemaFile({ target: "prisma" })],
});
```

`orm: "prisma"` does two things:

- **Every target defaults to `runtime: false`.** The `entity` generator then writes Zod schemas
  and types with no `drizzle-orm` import. A target that sets `runtime: true` is refused.
- **Generators that write Drizzle code are refused** by name: `queries`, `routes`,
  `routes-hono` and `callable`. Your routes call the Prisma Client instead. `meta gen` exits
  with `orm: "prisma" refuses "queries", …` and makes no changes.

The default `orm` is `"drizzle"`, and it changes nothing.

Prisma 7 reads the connection URL from `prisma.config.ts`, not from the schema:

```ts
// prisma.config.ts
import { defineConfig } from "prisma/config";
export default defineConfig({ schema: "prisma/schema.prisma", datasource: { url: process.env.DATABASE_URL! } });
```

The generated schema names the `prisma-client` generator, writing to `prisma/generated`. To
choose your own generator and datasource blocks, pass `header` as a string. Pass
`header: false` for a multi-file schema (`prisma/schema/`) whose blocks live in a file you own.
Other options:

- `provider` overrides the provider that `dialect` picks.
- `fileName` renames the file (default `schema.prisma`).
- `filter` narrows which objects get a model.
- `checks: "omit"` drops the CHECK file.

## The workflow

```bash
meta gen                                            # writes prisma/schema.prisma (+ schema.checks.sql)
npx prisma db push                                  # or: npx prisma migrate dev
npx prisma db execute --file prisma/schema.checks.sql
npx prisma generate                                 # the Prisma Client, as usual
meta verify --codegen --db "$DATABASE_URL"          # in CI: fails on an edited schema or a drifted database
```

To change a field, edit the model and run `meta gen`. **Do not edit `schema.prisma` by hand.**
The generator overwrites hand edits instead of merging them. Prisma treats the whole file as
the schema, so a merged edit would change the database without the model knowing.
`meta verify --codegen` fails on the edit until you run `meta gen` again. `prisma format`
leaves the file unchanged, so formatting it does not count as an edit.

A Prisma schema cannot declare a CHECK constraint, so the constraints the model implies go in
`schema.checks.sql`. These are enum membership checks plus the `@min`/`@max` and length
validators. Apply the file after every `db push` or migration. On Postgres the file drops each
constraint before adding it, so you can apply it more than once. On MySQL it only adds them,
so apply it once, when you create the table. When a check changes, drop the old one in a Prisma
migration. When the model has no checks left, `meta gen` deletes the file.

With `prisma migrate`, keep the Prisma migration chain: `meta gen` changes `schema.prisma`, and
`prisma migrate dev` writes the SQL. To make the checks part of the chain, put the contents of
`schema.checks.sql` into a migration (`prisma migrate dev --create-only`, then add the SQL).

## How the model maps

The schema is built from the same expected schema that `meta migrate` writes and
`meta verify --db` compares against. A database that Prisma creates from it therefore passes
the gate.

| Model | Prisma |
|---|---|
| object with a writable `source.rdb` | `model <Name>` with `@@map("<table>")` when the names differ |
| field | a scalar field with `@map("<column>")` when the names differ; `?` when the field is not `@required` |
| `field.string @maxLength` | `String @db.VarChar(n)` (Postgres, MySQL) |
| `field.int` / `field.long` / `field.currency` | `Int` / `BigInt` / `BigInt` |
| `field.double` / `field.float` | `Float` / `Float @db.Real` (Postgres) |
| `field.decimal` | `Decimal @db.Decimal(p, s)` |
| `field.boolean` | `Boolean` |
| `field.timestamp` / `field.date` / `field.time` | `DateTime` with `@db.Timestamptz`/`@db.Timestamp`, `@db.Date`, `@db.Time` (Postgres); `String` on SQLite, where the column holds ISO text |
| `field.uuid` | `String @db.Uuid` (Postgres), `@db.VarChar(36)` (MySQL) |
| `field.enum` | `String` plus a CHECK in `schema.checks.sql` (not a Prisma `enum`, so the column matches `meta migrate`'s) |
| `field.object`, `field.map`, `@storage: jsonb` | `Json` |
| `field.object @storage: flattened` | one field per field of the value object, `<field><Nested>` with `@map("<column>_<nested_column>")` |
| `isArray` scalar | a list (`String[]`) on Postgres; `Json` on MySQL; `String` holding JSON text on SQLite |
| `identity.primary` | `@id` or `@@id([...])`; `@generation: increment` is `@default(autoincrement())`; `@generation: uuid` is `gen_random_uuid()` on Postgres, `uuid()` elsewhere |
| `@default` | `@default(...)` for a literal; `"now"` and other expressions are `dbgenerated(...)`, so the default text matches what `verify --db` expects (a MySQL `DateTime` takes `now()`) |
| `identity.secondary` | `@unique` or `@@unique` (the index name in `map:`) |
| `index.lookup` | `@@index` (`@orders` becomes `sort: Desc`) |
| `identity.reference` | a relation field on both models, with `fields`, `references`, `onDelete`, `onUpdate` and the constraint name in `map:` |
| `@schema` on `source.rdb` | `@@schema("<schema>")` and the datasource's `schemas` list (Postgres) |

## What it refuses

The generator stops with an error code rather than write a schema that would push a database
the model does not describe. Each message names the object or index, says why, and says what
to change.

| Code | When | What to do |
|---|---|---|
| `ERR_PRISMA_READ_ONLY_SOURCE` | an object declares a view that `meta migrate` creates and `meta verify --db` expects (a projection, a write-through entity's read view, or a served report) | create the view in a Prisma migration and mark its read `source.rdb` `@unmanaged: true`, or leave the object out with `filter` |
| `ERR_PRISMA_UNSUPPORTED_INDEX` | an index has `@expr` or `@where`, or a `@using` method other than `btree` or, on Postgres, `hash`, `gin`, `gist`, `brin` or `spgist` | create it in a Prisma migration, or drop the attribute |
| `ERR_PRISMA_UNSUPPORTED_SCHEMA` | a `source.rdb` declares `@schema` and the provider is not `postgresql`, where Prisma has no `@@schema` | remove the `@schema`, or use the `postgresql` provider |
| `ERR_PRISMA_UNSUPPORTED_CHECK` | the provider is SQLite and the model implies a CHECK | pass `checks: "omit"` |
| `ERR_PRISMA_NO_PRIMARY_KEY` | a table has no primary key | declare an `identity.primary` |
| `ERR_PRISMA_UNMAPPABLE_RELATION` | a foreign key points at a table with no model, at a non-unique key, or at a column of another type | include the table, reference a key, or match the subtype |
| `ERR_PRISMA_NAME_COLLISION` | two objects, or two fields, would get the same Prisma name | rename one, or narrow `filter` |
| `ERR_PRISMA_UNSUPPORTED_PROVIDER` | the dialect or `provider` is not `postgresql`, `mysql` or `sqlite` | pass `provider` |

A model with projections, write-through read views or served reports therefore needs one of
those two fixes before the generator runs. A stored procedure, table function or materialized
view is not refused: `meta migrate` does not create it, so neither does Prisma. Read the view's rows with Prisma's `$queryRaw`, and validate them with the
generated Zod schema.

## SQLite and MySQL

- **SQLite** cannot add a CHECK to an existing table. Pass `checks: "omit"`. `meta verify --db`
  then reports each missing CHECK as an `add-check` row and nothing else. Only the Zod schemas
  enforce those rules. Timestamps, dates and times are `String` in the Prisma Client, because the
  column holds ISO text, as it does under `meta migrate`.
- **MySQL** gets the enum CHECKs only. The other checks are written in Postgres SQL. The schema
  matches the column types in the MySQL recipe, but `meta verify --db` does not support MySQL,
  so on MySQL the drift gate is `verify --codegen` alone.

## Eject it

```bash
meta eject prisma-schema
```

This copies the generator to `codegen/generators/prisma-schema.ts`, and the mapping and
renderers to `codegen/templates/prisma/`. To change a type mapping, edit your copy. A mapping
that no longer matches the expected schema makes `meta verify --db` report drift.
