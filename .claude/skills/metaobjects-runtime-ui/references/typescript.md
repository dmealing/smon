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
