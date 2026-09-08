# TypeScript server runtime

The Node-side runtime tier is `@metaobjectsdev/runtime-ts`. It supplies both the
helpers the generated routes lean on (`parseFilterParams`) and a metadata-driven
`ObjectManager` for full-runtime CRUD / validation / relationship traversal.

## Two ways to persist

**1. Generated query helpers (the common path).** `queriesFile()` emits a
`<Entity>.queries.ts` per entity with typed CRUD. Per ADR-0008 every generated
helper takes the Drizzle/Kysely `db` as its **first parameter** — no module-level
`db` singleton:

```ts
import { findAuthorById, createAuthor, listAuthors } from "./generated/Author.queries";

const author = await findAuthorById(db, 42);            // db passed, not imported
const created = await createAuthor(db, { name: "Ada" });
const page = await listAuthors(db, { limit: 25 });
```

You own the connection lifecycle and thread `db` through every call — that keeps
the code testable and lets one process talk to multiple databases.

**2. The `ObjectManager` runtime (dynamic CRUD / admin UIs / MCP tools).** Drives
behavior directly off loaded metadata, no per-entity generated file needed:

```ts
import { MetaDataLoader } from "@metaobjectsdev/metadata";
import { FileSource } from "@metaobjectsdev/metadata/core";
import { ObjectManager } from "@metaobjectsdev/runtime-ts";
import { kyselyDriver } from "@metaobjectsdev/runtime-ts/drivers";

const { root } = await new MetaDataLoader().load([
  new FileSource("metaobjects/meta.blog.json"),
]);

const om = new ObjectManager({
  metadata: root,
  driver: kyselyDriver({ db: kyselyInstance, dialect: "postgres" }),
});

const post  = await om.create("Post", { title: "Hello", authorId: 1 });
const found = await om.findById("Post", post.id, { include: ["author"] });
const list  = await om.findMany("Post", { authorId: 1 }, { limit: 10 });
await om.update("Post", post.id, { title: "Updated" });
await om.delete("Post", post.id);

const result = om.validate("Post", { title: "x" });      // pure, no DB hit
if (!result.ok) console.log(result.errors);

await om.transaction(async (tx) => { /* ... */ });
```

### Drivers

- `kyselyDriver({ db, dialect })` — real DBs (SQLite/libsql/Turso, Postgres via
  `pg` / Neon). You provide the Kysely instance.
- `inMemoryDriver({ seed?, pkFields? })` — Map-backed; unit tests, prototyping, MCP
  sandboxing.

`findMany` filters take a Mongo-style object: `{ field: value }` (eq),
`{ field: null }` (IS NULL), `{ field: [a, b] }` (IN), or explicit operators
`{ field: { $gte, $like, $in, ... } }`.

> Driver note: generated CRUD uses Kysely's `.returning()`. Works on libsql/Turso,
> `node-postgres`, `@neondatabase/serverless`; NOT on `better-sqlite3` / `bun:sqlite`
> (no native RETURNING) — use a custom driver or `inMemoryDriver` there.

### Physical names: the column object first, `<Entity>Names` where there is none

The generated query helpers and `ObjectManager` never make you spell a table or column.
Where you drop below them, bind to the Drizzle column object (`programs.createdAt` —
checked against the schema at compile time), never a string. What Drizzle does not
reach — a `sql` template fragment, a string-keyed Kysely identifier, a migration script,
a log line — takes the generated `<Entity>.names.ts` (`namesFile()` is in the `meta init`
scaffold):

```ts
import { sql } from "drizzle-orm";
import { ProgramNames } from "./generated/Program.names.js";

sql`SELECT ${sql.identifier(ProgramNames.fields.createdAt.column)}
    FROM ${sql.identifier(ProgramNames.sources.primary.table)}`
```

A literal is a second spelling of a fact the metadata owns: `@column` is free-form, and a
rename in metadata moves the constant, not the string.

**`excluded.<column>` has no handle.** In an `ON CONFLICT … DO UPDATE SET`, Drizzle maps the
`set` keys (they are FIELD names) but the value on the right is raw SQL, and `excluded` is a
pseudo-table Postgres binds to the row the INSERT proposed — there is no column object for it.
That is the one place a physical name is unavoidable in otherwise-typed Drizzle code, so it is
where the constant earns the most:

```ts
const excluded = (column: string) => sql`excluded.${sql.identifier(column)}`;
// …
.onConflictDoUpdate({ target: programs.slug, set: {
  title: excluded(ProgramNames.fields.title.column),
} })
```

The existing row, by contrast, IS reachable: Postgres exposes it under the table's own name
inside `ON CONFLICT`, and a Drizzle column object renders as exactly that qualified name — so
`${programs.updatedBy}` is `"program"."updated_by"` with nothing spelled by hand.

### Getting the name INTO a query is a per-driver question

The artifact hands you a string. Every driver has its own way to place a string in identifier
position, and they are not interchangeable — a value placeholder there is a syntax error, and a
bare interpolation is an injection hole the moment the name stops being a constant. **Find your
driver's identifier form once, wrap it in a one-line local helper, and use the helper
everywhere**; that is the whole integration, and it is the same shape whether you are on Drizzle,
Kysely, `postgres.js`, `node-postgres`, `mysql2`, or a query builder this page has never heard of.

Two properties decide whether a form is the right one:

- **It escapes.** A physical name is free-form (`@column` takes whatever you declare), so the
  helper must quote and escape rather than concatenate. Most drivers ship this; `pg` exposes it as
  `Client.prototype.escapeIdentifier`, `mysql2` as `escapeId`.
- **It means the same thing in every clause.** This is the one that bites, because a form can work
  in `SELECT` and fail in `INSERT`. Test your helper in `SELECT`, `FROM`, `WHERE`, `INSERT INTO`,
  a column list, `UPDATE … SET` and inside a transaction before you commit to it — against a real
  engine, not a snapshot.

`postgres.js` is the worked example of the second property going wrong, and it is worth reading
even if you are on another driver, because the failure is silent until it is a syntax error in
production. Its `sql(name)` builder is **not** an identifier: it dispatches on the SQL text BEFORE
the interpolation. In `INSERT INTO ${sql("audit_entry")} (…)` it matches the library's
insert-builder, which reads the value as a row object and emits a column list, and the statement
dies with `syntax error at or near "("`. `sql([name])` survives that one and is the same trapdoor
a clause away. The form that is inert in every clause is a quoted identifier through `unsafe`:

```ts
const ident = (name: string) => sql.unsafe(`"${name.replace(/"/g, '""')}"`);

await sql`SELECT ${ident(ProgramNames.fields.createdAt.column)}
            FROM ${ident(ProgramNames.sources.primary.table)}`;
```

`unsafe` names the one thing the caller must guarantee — that the string is a name you authored,
never user input — and a generated constant is exactly that. Built once on the pooled client, the
fragment carries no per-query state, so it can be shared across a module and composed inside a
`sql.begin()` transaction.

A module that touches one table usually wants the whole artifact turned into helpers at once
rather than a call per site — derive them from the artifact so the module names the ENTITY and
never restates its own field list:

```ts
const P = {
  table: ident(ProgramNames.sources.primary.table),
  col: Object.fromEntries(
    Object.entries(ProgramNames.fields).map(([f, d]) => [f, ident(d.column)]),
  ),
};
```

## Return-type contract

The runtime returns **native in-process types**, never wire strings — temporal
fields as native dates, jsonb as native objects. The one documented TS outlier:
`field.decimal` comes back as a **`string`** (JS has no native exact decimal),
preserving precision. Wire canonicalization (currency → integer minor units,
temporals → ISO-8601, UUID → canonical hex) is applied only at the HTTP
serialization boundary, never inside the query path.

## Serving the REST contract

`routesFile()` (Fastify) or `routesFileHono()` (Hono/Workers/edge) emits CRUD
routes on the cross-port contract. Mount them with the `db` injected:

```ts
import { registerAuthorRoutes } from "./generated/Author.routes";
registerAuthorRoutes(app, { db });   // GET/POST/PATCH/PUT/DELETE under apiPrefix
```

The routes call `parseFilterParams` (from `@metaobjectsdev/runtime-ts/drizzle-fastify`)
to validate `?filter[..][..]=..&sort=..&limit=&offset=` against the generated
`<Entity>FilterAllowlist` / `<Entity>SortAllowlist`, returning HTTP 400 on an
unknown field or disallowed operator.

### Granular routes — mount some, hand-write the rest (don't read `node_modules`)

When the API doesn't match generated CRUD, you don't have to choose all-generated
or all-hand-written, and you never need to reverse-engineer the runtime package.
`@metaobjectsdev/runtime-ts/drizzle-fastify` exports the mount helpers the generated
routes are built from — call them directly:

```ts
import {
  mountCrudRoutes, mountGetRoute, mountListRoute, mountReadOnlyCrudRoutes,
} from "@metaobjectsdev/runtime-ts/drizzle-fastify";
import { RecipeInsertSchema, RecipeUpdateSchema } from "./generated/Recipe.js";

// all five verbs:
mountCrudRoutes({ fastify: app, path: "/recipes", db, table: recipes,
  insertSchema: RecipeInsertSchema, updateSchema: RecipeUpdateSchema });

mountCrudRoutes({ ...opts, expose: ["list", "get"] }); // only some verbs
mountReadOnlyCrudRoutes({ ...opts });                  // list + get only
mountGetRoute({ ...opts });                            // a single verb
```

`CrudRoutesOptions` = `{ fastify, path, db, table, insertSchema, updateSchema }`
plus `expose?` (limit verbs), `routeOptions?` (Fastify hooks — e.g.
`{ preHandler: requireAuthHook }` for auth), and `updateMethod?` (`"patch"` default
/ `"put"`). So **mount the standard verbs with these helpers and hand-write only the
custom routes** (HTML pages, nested resources, computed fields) — calling the
generated query helpers, and a projection's generated query for derived/aggregate
data. Generate the data layer; hand-write only what's genuinely custom.
