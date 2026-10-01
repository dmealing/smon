# Your database, store or framework is not built in — work it out

> Part of the `metaobjects-codegen` skill. Read it when the app's database, data store, HTTP
> framework or UI framework is not one a reference generator targets. That is a normal
> situation with a known procedure, not a dead end and not a reason to hand-write the app.

MetaObjects is a **core** (the model, the loader, `verify`, prompt render and reply extract,
and `meta migrate` for Postgres/SQLite/D1) plus **generators you own**. The reference
generators cover some stacks. Every other stack is reached the same way: keep the model as the
source of truth, generate what is built in, and write or retarget a generator for the rest.
Nothing below needs a new MetaObjects release, a new metamodel attribute, or permission.

## 1. Find out what is built in — do not guess

```bash
npx meta gen --list --format json --probe   # every generator: layer, framework, what it emits for YOUR model
npx meta types --type source --kind subtype # the registered sources: only source.rdb
```

The dialects are `postgres`, `sqlite`, `d1` (TypeScript only) and `mysql` (codegen and runtime
only). The HTTP reference generators are `routes` (Fastify) and `routes-hono` (Hono). The UI
reference generators target React and TanStack. Anything else is this page.

## 2. Split the app into layers and decide each one

| Layer | Always available | When your target is not built in |
|---|---|---|
| **model** — types, create/PATCH validation, filter and sort allowlists | yes, in every port, for every store | — |
| **persistence** — how rows are read and written | Postgres, SQLite, D1; MySQL (TypeScript, Java) | §3 |
| **api** — the HTTP surface | Fastify, Hono | §4 |
| **client** — hooks, forms, grids | React, TanStack | §5 |

The model layer never depends on the store or the framework. Generate it first
(`meta eject entity`, wire `entityFile()`); everything you write later imports it.

## 3. Persistence

**MySQL (TypeScript).** Set `dialect: "mysql"`. The generated tables, queries and routes
target `drizzle-orm/mysql-core`, and the ObjectManager runs over `kyselyDriver` or
`drizzleDriver`. `meta migrate` does not own a MySQL schema, so you write the DDL. Setup,
the column-type table and the behaviour differences are in `typescript-mysql.md`. On Java,
OMDB's `MySQLDriver` reads and writes MySQL; the generated DTOs and controllers are
dialect-neutral.

**A SQL database that speaks another dialect's protocol.** Use that dialect: CockroachDB,
Neon, Supabase, AlloyDB and Aurora PostgreSQL are `postgres`; Turso and libSQL are `sqlite`
(or `d1` on Cloudflare); MariaDB and PlanetScale are `mysql`. Test the generated queries
against the real server before relying on them.

**Any other store** — MongoDB, Cassandra, DynamoDB, Firestore, Neo4j, Redis, Elasticsearch,
a SQL database no dialect covers, or a remote API. Model each stored record as a
**sourceless entity** and generate its data access with a generator you own:

1. An `object.entity` with an `identity.primary` and **no `source.*` child**. With no source,
   nothing generates a table, queries or routes for it, and `meta migrate` ignores it. It still
   gets its whole wire contract in every port: the type, the create and PATCH schemas, and the
   filter allowlist.
2. Store-specific settings go in a property bag of your own: any `@name` whose value is a JSON
   object is accepted, for example `"@mongo": { "collection": "orders" }` or
   `"@dynamo": { "table": "orders", "partitionKey": "customerId" }`. Your generator reads it.
   **Do not invent a document or graph source subtype, or a `@collection` attribute** — the loader
   refuses unregistered vocabulary (`ERR_UNKNOWN_ATTR`), and a bag needs no registration.
3. Embedded documents are value objects: `field.object` + `@objectRef` to an `object.value`,
   `isArray: true` for a list. They validate as part of the parent.
4. Write a repository generator: select objects with the port's sourceless predicate, and emit
   create / findById / list / patch / delete over the store's driver, validating with the
   generated schemas and checking filters against the generated allowlist. A complete,
   tested MongoDB generator for TypeScript is in `typescript-document-store.md`; for
   Cassandra, DynamoDB or an HTTP API only the driver calls change.

| Port | Sourceless predicate | Build the repository on |
|---|---|---|
| TypeScript | `isSourcelessEntity` (`@metaobjectsdev/codegen-ts`) | `<E>InsertSchema`, `<E>UpdateSchema`, `<E>FilterAllowlist` |
| Python | `is_sourceless_entity` | `<E>Create`, `<E>Patch`, `<e>_filter_allowlist` |
| Java / Kotlin | `RestSurfaceGate.isSourcelessEntity` | `<E>Dto`, `<E>Patch`, `<E>FilterAllowlist` |
| C# | `InstanceArtifacts.IsSourcelessEntity` | the entity POCO, `<E>FilterAllowlist` |

What a non-relational store does not get: schema management (create collections and indexes
the store's own way — or write a generator for its optional schema, such as a MongoDB
`$jsonSchema`), generated routes and client hooks (your repository is the seam; see §4), and
join traversal (`identity.reference` loads and documents, but nothing follows it across stores).

## 4. An HTTP framework that is not built in

Try these in order:

1. **Config first.** Several apparent framework mismatches are one setting: `apiPrefix`,
   `extStyle` (`"none"` for Turbopack and other bundlers that do not rewrite `.js`
   specifiers), `clientDirective` (React Server Components), `outDir`, per-target output.
2. **Hono reaches most hosts.** `routes-hono` emits Hono handlers that take the database as an
   injected dependency, and Hono runs on Node, Bun, Deno, Cloudflare Workers and inside a
   Next.js route handler (`hono/vercel`). Mount the generated Hono app inside your framework
   rather than rewriting routes.
3. **Eject the nearest reference and retarget it.** `meta eject routes` (or `routes-hono`)
   copies the generator and its HTTP adapter into your repo; change the emit to your
   framework's handler shape (Express, Koa, NestJS, Elysia, tRPC, …). The handlers call
   the generated queries, which carry no framework coupling. The TypeScript procedure is in
   `typescript-retargeting.md`.
4. **Or write a routes generator** from scratch over the generated queries or your
   repository — the same ~20-line generator shape as any other (the top of this skill).

Never hand-write per-entity routes the model describes: a generator gives every entity the
same surface, and `meta verify --codegen` keeps it in step with the model.

## 5. A UI framework that is not built in

`@metaobjectsdev/runtime-web` is framework-free: the fetch contract, filter query strings,
currency and grid config. Write a generator that emits your framework's hooks or components
(Vue composables, Svelte stores, Solid resources, Angular services) over it and over the
generated types. Angular has source-only reference packages in the MetaObjects repository.

## 6. Prove it works

- `meta verify --codegen` fails when committed output is stale — it re-runs your generator.
- Typecheck the generator (`npx tsc -p tsconfig.codegen.json`); `meta gen` loads it untyped.
- Write a test that **executes the generated code against the real store or framework** —
  create, read back, patch, a refused filter, a validation failure. A generator that emits
  plausible text is not proven until its output runs.
