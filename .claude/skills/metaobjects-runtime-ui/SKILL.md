---
name: metaobjects-runtime-ui
description: Use when wiring MetaObjects generated code into an app — runtime queries/CRUD, REST routes, and the web client (forms, grids, filters).
---

# Wiring MetaObjects runtime + web client

This skill is the procedure for putting generated code to work: querying/persisting
through the runtime tier, serving the REST contract, and consuming it from the
universal web client. It is port-agnostic — the cross-cutting contracts are here;
the server- and client-specific imports/types live in reference fragments (pointed
to at the bottom).

## The runtime return-type contract

A port's runtime returns **native in-process language types**, never wire strings.
Query the runtime and you get back the language's natural type for each field:

- `field.decimal` → the language's exact-decimal type (`BigDecimal` / `decimal` /
  `Decimal`). Decimal is **lossless end-to-end** — no float round-tripping.
- temporal fields → native date/instant types.
- `field.object` (jsonb) → a native map/object.
- **TypeScript is the documented outlier: `field.decimal` is a `string`** in the
  TS runtime (JS has no native exact decimal), preserving precision as text.

Wire canonicalization (integer minor units for currency, ISO-8601 strings for
temporals, canonical hex for UUID) is applied only at the **serialization
boundary** — when a row leaves over HTTP — never inside the runtime query path. So:
compute with native types in-process; the HTTP layer handles wire encoding.

## Generated repo / query helpers take the context as a parameter

Generated finders and CRUD helpers **do not** reach for a module-level `db`
singleton. They take the persistence context (connection / session / data-access
handle) as an explicit **parameter**. You own the connection's lifecycle and pass
it in:

```
const rows = await findPostsForAuthor(db, authorId);   // db is passed, not imported
```

This keeps generated code free of global state, makes it testable, and lets one
process talk to multiple databases (multi-tenant, read-replica). Construct/own the
context in your app; thread it through every generated call.

## The REST contract

Generated (or hand-written) routes speak one cross-port HTTP contract so the same
universal web client serves any backend language.

### URL grammar

`apiPrefix` (default `/api`, set in project config) flows to both the server routes
and the client fetch URLs. `<entity>` is lowercased + pluralized (`Author` →
`authors`).

| Verb | Path | Purpose |
|---|---|---|
| `GET` | `/<apiPrefix>/<entity>?filter[...][...]=...&sort=...&limit=N&offset=N&withCount=1` | List |
| `GET` | `/<apiPrefix>/<entity>/:id` | Get by id |
| `POST` | `/<apiPrefix>/<entity>` | Create (201) |
| `PATCH` | `/<apiPrefix>/<entity>/:id` | Update (partial) |
| `PUT` | `/<apiPrefix>/<entity>/:id` | Update (replace) — optional |
| `DELETE` | `/<apiPrefix>/<entity>/:id` | Delete (204) |

### Filter operators by field subtype

Filters use a bracketed qs: `filter[<field>][<op>]=<value>`. A bare
`filter[<field>]=<value>` is sugar for `eq`. The operator set is **gated by field
subtype** via the generated `<Entity>FilterAllowlist` — an unsupported operator for
a field → HTTP 400.

| Operator | Strings | Numbers / Dates | Booleans |
|---|---|---|---|
| `eq`, `ne`, `isNull` | yes | yes | `eq` + `isNull` only |
| `in`, `like` | yes | `in` only | – |
| `gt`, `gte`, `lt`, `lte` | – | yes | – |

These eight (`eq` `ne` `gt` `gte` `lt` `lte` `in` `like` `isNull`) are the whole
closed set — every port implements these and only these.

### Sort + pagination

- `sort=<field>:asc|desc` — single sort key; the field must be in
  `<Entity>SortAllowlist`.
- `limit=N` / `offset=N` — page size + offset, identical across every endpoint.
- `withCount=1` — switches the list response from `[<row>...]` to
  `{ rows: [...], total: N }` (grids always send it).

### Wire format

JSON bodies (`application/json; charset=utf-8`). Single-row responses (`GET /:id`,
`POST`, `PATCH`, `PUT`) have **no envelope** — the body is the row. Type encodings:

| Field type | JSON | Notes |
|---|---|---|
| `field.string` / `field.uuid` / `field.enum` | string | UUID is canonical hex `8-4-4-4-12` |
| `field.int` / `field.long` / `field.double` | number | `long` may be string on overflow (per-port) |
| `field.boolean` | boolean | |
| `field.date` | string | ISO 8601 `YYYY-MM-DD` |
| `field.timestamp` | string | ISO 8601 with timezone |
| `field.currency` | **integer minor units** | cents/yen; float arithmetic forbidden; server never formats |
| `field.object` | object | per the sub-object schema |

The currency invariant is load-bearing: integer minor units on the wire, always.
Formatting happens client-side with locale-aware code.

Errors: non-2xx returns `{ "error": "<short_code>", "message"?: "..." }`. 400 for
validation/filter-parser errors, 404 for not-found (`{ "error": "not_found" }`),
5xx implementation-defined. Treat any 4xx as user-facing, any 5xx as retryable.

## The EntityFetcher browser contract

The web client never calls `fetch` directly. Every generated hook delegates to a
single `EntityFetcher` you supply once at the app root:

```ts
export type EntityFetcher = <T>(path: string, init?: RequestInit) => Promise<T>;
```

Your fetcher resolves the `path` (always starting with `apiPrefix`) to a full URL,
attaches auth (cookie / bearer / API key) per your policy, parses the JSON, and
throws on non-2xx (the hooks rely on the throw for error state). Provide it via the
fetcher-provider at the tree root; every generated hook reads it from context. The
generated grid and form components, filter-qs serializer, and cell renderers all
sit on top of this one seam.

---

For this project's runtime + web-client specifics, read every `references/*.md` file in this skill's directory (one per server language and client framework in this project's stack).
