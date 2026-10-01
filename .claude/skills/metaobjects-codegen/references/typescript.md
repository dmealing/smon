# TypeScript codegen specifics

The TS port is the reference implementation, published to npm as `@metaobjectsdev/*`
packages. Codegen runs through the Node `meta` CLI (`@metaobjectsdev/cli`, binary
`meta`).

## Contents
- Write your own generator
- Install
- `metaobjects.config.ts`
- The generators
- Run
- Multiple output targets
- Field subtype → column mapping

Topic files beside this one, to open when they come up:
`typescript-mysql.md` (a MySQL database), `typescript-document-store.md` (MongoDB or any
store MetaObjects does not manage, with a tested repository generator),
`typescript-retargeting.md` (a framework other than Fastify, Hono or React),
`typescript-templates.md` (declarative Mustache template-codegen) and `typescript-docs.md`
(`meta docs`). The procedure for any unsupported stack is `any-stack.md`.

## Write your own generator

For any output the model describes and no reference emits, start here:

```bash
meta generator new openapi --scope model   # entity (default) | package | model
meta gen                                   # runs it — it already emits JSON per unit
meta verify --codegen                      # gates it; nothing to register
npx tsc -p tsconfig.codegen.json           # typecheck it; meta gen loads it untyped
```

`meta generator new <name>` writes `codegen/generators/<name>.ts` — a working, commented
generator exporting `<camelName>Generator()` — and adds its import and entry to
`metaobjects.config.ts` (when the config has one literal `generators: [...]`; otherwise it
prints the two lines to add). It refuses a reference generator's name (eject that one
instead) and never overwrites your file without `--force`. Then edit the emit.

Everything a generator reads comes from `@metaobjectsdev/codegen-ts`: `perEntity` /
`perPackage` / `perModel`, `isAbstract`, `hasAnyRdbSource`, `isProjection`,
`servesReadApi` / `servesWriteApi`, `objectRefTarget`, `enumValues`, `effectivePackage`,
`packageToPath`, `servedPath`, `toCamelCase` / `toPascalCase` / `toSnakeCase` /
`pluralize`, and `formatTs` for TypeScript output. The config's `apiPrefix` is
`ctx.renderContext?.apiPrefix`. Worked JSON Schema and OpenAPI 3.1 generators to copy:
`docs/recipes/generators/typescript/` in the MetaObjects repository.

## Install

```bash
npm install --save-dev @metaobjectsdev/cli @metaobjectsdev/codegen-ts
npm install            @metaobjectsdev/metadata @metaobjectsdev/runtime-ts
```

For the React + TanStack codegen packages, also:

```bash
npm install --save-dev @metaobjectsdev/codegen-ts-react @metaobjectsdev/codegen-ts-tanstack
```

## `metaobjects.config.ts`

Codegen is wired in a type-checked TS config at the project root. `defineConfig`
comes from `@metaobjectsdev/cli`; the generators come from their packages.

`meta init` scaffolds this file with **`generators: []`** — nothing is generated until
you choose it. Each import below appears once you `meta eject` that generator, which
prints the exact line to add.

```ts
import { defineConfig } from "@metaobjectsdev/cli";
// Owned generators — copied in by `meta eject` (ADR-0034 scaffold-and-own).
import { entityFile } from "./codegen/generators/entity";
import { queriesFile } from "./codegen/generators/queries";
import { routesFile } from "./codegen/generators/routes";
import { barrel } from "./codegen/generators/barrel";
import { formFile } from "@metaobjectsdev/codegen-ts-react";
import { tanstackQuery, tanstackGrid } from "@metaobjectsdev/codegen-ts-tanstack";

export default defineConfig({
  outDir: "src/generated",
  dialect: "postgres",                 // "postgres" | "sqlite" | "d1" | "mysql" (mysql: codegen + runtime; migrate does not own it)
  extStyle: "js",                      // "js" (default) for Node ESM / plain tsc; "none" for a bundler-resolution toolchain — see SKILL.md "Your framework isn't the default"
  apiPrefix: "/api",                   // flows to routes AND client fetch URLs
  columnNamingStrategy: "snake_case",  // "snake_case" (default) | "literal" | "kebab-case"
  timestampMode: "string",             // "string" (default, ISO-8601 wire contract) | "date" (Drizzle native Date)
  pluralizeCollections: true,          // default; table VARS auto-pluralize (AgentConfig → agentConfigs)
  collectionNameOverrides: {           // per-entity escape hatch for names the rule gets wrong
    AuditLog: "auditLog", LlmTierConfig: "llmTierConfig",
  },
  generators: [
    entityFile(), queriesFile(), routesFile(), barrel(),
    formFile(), tanstackQuery(), tanstackGrid(),
  ],
});
```

Naming + timestamp knobs are **codegen config**, not metadata attributes — a
collection variable name and a Drizzle column mode are per-port rendering choices
with no meaning to the other language ports, so they carry no cross-port
conformance cost. `collectionNameOverrides` wins over `pluralizeCollections` and is
applied consistently to the table declaration, every FK reference, the `relations()`
block, and the inferred types.

A second file, `.metaobjects/config.json`, holds static project state parseable by
non-TS tooling; `meta init` scaffolds both plus the `metaobjects/` source dir.

`sources` in that file is where the metadata lives — `metaobjects/` is only its
DEFAULT value, so a project can point it anywhere. **Every entry is an OBJECT, never
a bare string**, and it names a DIRECTORY or a file:

```jsonc
{ "schema_version": 1, "sources": [{ "path": "model" }, { "path": "../shared/metadata" }] }
```

Every command's directory argument (`meta docs <project-root>`, `--cwd`) is the
PROJECT ROOT that CONTAINS the metadata — never the metadata directory itself.

## The generators

Server-side, framework-neutral. **None is wired by default** — `meta init` writes
`generators: []` and an empty `codegen/generators/`. `meta eject <name>...` copies the
ownable ones into your repo, imported from `./codegen/generators/*` (ADR-0034); 1.0
REMOVED their `@metaobjectsdev/codegen-ts/generators` export, so an owned copy is the only
path for those. The engine primitives come from the package main entry,
`@metaobjectsdev/codegen-ts`. The `/generators` subpath itself is NOT deprecated. It
exports the prompt tier (`promptRender`, `outputParser`, `outputPrompt`, `extractor`,
`renderHelper`) and `namesFile`, which you may import from there OR eject to own, and it is
the only home of the package-only generators — `traceHelperFile`, `callableFile`,
`requirementTests` — which ship no reference template (`meta gen --list` marks them
`package-only`).

The table below is a per-emission reference, NOT the selection surface. Select with
`meta gen --list --format json --probe`, which is generated from the live registry and
reports a file count for your own model; a table in a document cannot do either.

| Generator | Emits per entity |
|---|---|
| `entityFile()` | `<Entity>.ts` — Drizzle table + FK `.references()` + `relations()` + inferred types + Zod insert/update schemas + `<Entity>FilterAllowlist` / `<Entity>SortAllowlist`. A TPH `@discriminator` base folds every subtype's columns into ONE Drizzle table (subtype-only columns nullable, no default — single-table inheritance) and emits a discriminated-union type + per-subtype Zod schemas + a `parse<Base>` dispatcher; subtype entities emit no table of their own. |
| `queriesFile()` | `<Entity>.queries.ts` — typed CRUD (`findPostById`, `listPosts`, `createPost`, `updatePost`, `deletePostById`) |
| `routesFile()` | `<Entity>.routes.ts` — Fastify CRUD routes on the cross-port REST contract. `routesFileHono()` is the Hono/Workers variant. A TPH `@discriminator` base mounts polymorphic `GET /<base>(+/:id)` plus a per-subtype CRUD set at `<basePath>/<discriminatorValue lowercased>` — create omits the discriminator (the URL names the subtype; the runtime injects it); get/update/delete scoped to the subtype (cross-subtype → 404); discriminator immutable via the runtime `discriminator` option. |
| `barrel()` | `index.ts` re-exporting each `<Entity>.ts` (one-shot, not per-entity) |
| `promptRender()` | `render<Name>()` per `template.prompt` |
| `outputParser()` | `<Name>.response.ts` (`parse*` / `safeParse*`) per **responding `template.prompt`** — one carrying `@responseRef` (ADR-0052: this tier is INBOUND; `template.output` is outbound only and emits nothing here). Siblings: `outputPrompt()` → `<Name>.responseFormat.ts` (the FR-010 output-format fragment, presentation via `@promptStyle`), `extractor()` → `<Name>.extractor.ts` (the tolerant `extract` mapper). |
| `callableFile()` | `<Entity>.callable.ts` — an FR-015 `call<Entity>` wrapper for a `source.rdb` `@kind: storedProc`/`tableFunction` (args from the `@parameterRef` value object, in declaration order) |
| `namesFile()` | `<Entity>.names.ts` — `export const <Entity>Names`, mirroring the object's metadata tree. Every node carries its own `type`/`subType`/`name`; `name` is the OBJECT's name, and a physical name sits under the key naming what it is: `sources.<role>.{table,view,materializedView,proc,function}` (`<role>` is `primary` or `replica`, so a write-through entity's read view has a slot), plus `sources.<role>.{kind,schema}`, `fields.<field>.{name,column}`, and `identities.<name>` / `indexes.<name>` carrying `.index` (the database index name) for `identity.secondary` and `index.lookup`. No `readOnly` — it was derived from `kind`, never declared. Emitted for every object with a declared or inherited primary source, PLUS a fragment for any abstract base such an object extends (columns only, `sources: {}` — it has no table and must never acquire one). An artifact whose object extends another spreads the parent's collections rather than restating them, and a TPH subtype spreads `...AuthNames.sources` too, since it shares its base's table. With this generator in the run, **no generated TypeScript spells a physical name at all** — table, view, proc, column, schema and index name all travel as references; drop it from the suite and they fall back to literals. |

**Projections (read-only views).** For an `object.projection` (a read-only `source.rdb`
`@kind: view` child), `entityFile()` emits a `pgView(...)` + read-only Zod + a read-only
finder (no create/update/delete).

Its REST surface is generated and READ-ONLY (F22): GET list + GET by id, the same
`?filter[...]`/`?sort=` grammar as a table entity against allowlists built from the
projection's OWN declared field set, and `POST` / `PATCH` / `PUT` / `DELETE` each
answering `405 {"error": "method_not_allowed"}` — 405 and not 404 because the same
path answers GET. A KEYLESS projection (no `identity.primary`) mounts no `/{id}` route
at all, so it refuses only the collection verb.
`routesFile()` mounts it through `mountReadOnlyCrudRoutes` from the drizzle-fastify
adapter (your `codegen/runtime/` copy once ejected), which is where the refusals live.

The `CREATE VIEW` DDL is generated by `meta migrate`
from the projection's `origin.*` children — `origin.passthrough` (a forwarded column),
`origin.aggregate` (`@agg` `count`/`sum`/`avg`/`min`/`max`, plus the #195 `any`/`all`
predicate quantifiers over a `@filter` and `collect` array-rollup with optional
`@distinct`/`@orderBy`; any aggregate row-scoped with `@filter`),
`origin.computed` (a row-level `@expr`), `origin.first` (one related row's
column along `@via`/`@of`/`@orderBy`). An object-level `@filter` on the projection scopes
the whole view's rows (#207 — lowers to the outer `WHERE`, the metadata-managed
soft-delete/status view). **Never hand-write the view SQL** for a shape origins can
express (an unmodeled view is unmanaged and drifts silently); for a genuinely irreducible
body (recursive CTE, window function, set op), carry it in the `source.rdb` **`@sql`**
escape (#208) so the tool still owns it, or mark a Flyway-owned object `@unmanaged: true`.

**Entity read-view (write-through).** An `object.entity` that keeps its writable `table`
primary source and adds a `@role: replica` `@kind: view` source is a write-through
read-view (#214): `entityFile()` routes generated **reads** through the replica `pgView`
(the read Zod carries the derived `origin.*` fields via `z.infer`), while `queriesFile()`
writes target the table with derived fields excluded from the insert/update codecs; a
create/update re-reads the row via the view by primary key (read-your-writes). The replica
view's DDL is emitted by `meta migrate` from the same origin assembly as a projection view.

## Discriminator inheritance (TPH)

The TS reference implementation fully supports **table-per-hierarchy (TPH)
inheritance** (`tph-discriminator.ts` is the shared descriptor): an `object.entity`
carrying `@discriminator` (naming a `field.enum`) is the base; concrete entities
that `extends` it and declare `@discriminatorValue` are its subtypes, all persisted
to the base's **single** Drizzle table (single-table inheritance). `entityFile()`
folds each subtype's columns into that table nullable and emits the
discriminated-union type + per-subtype Zod schemas + a `parse<Base>` dispatcher;
`routesFile()` mounts polymorphic reads + per-subtype CRUD scoped by the
discriminator. At runtime, `@metaobjectsdev/runtime-ts`'s ObjectManager enforces the
subtype contract: it injects the discriminator on create, scopes every
read/update/delete to the subtype (a foreign-subtype row is invisible), and treats
the discriminator as immutable — mirroring the generated per-subtype route's
cross-subtype 404. Conformance-gated by `fixtures/api-contract-conformance/tph`
(HTTP wire shape) and `fixtures/persistence-conformance/tph-*` (single-table
runtime semantics).

## Run

```bash
npx meta gen                 # load metadata → render → 3-way merge → write
npx meta gen --dry-run       # preview without writing
npx meta gen Author Post     # scope to named entities
```

Generated files carry an `@generated by @metaobjectsdev/codegen-ts` header. It is
**informational** — the write decision never reads it. `.metaobjects/.gen-state/`
decides: the snapshot body if this machine has one (three-way merge), otherwise the
committed `.hashes.json` (byte-for-byte what it wrote ⇒ overwrite; anything else ⇒
refused, path named, exit 1). So the merge is machine-local: a file you edited and
pushed is REFUSED on a fresh clone or in CI, not merged. Recovery is in
`docs/features/own-your-codegen.md`.

A project with NO manifest at all (it predates the manifest being committed) is a
different case with a different fix: every stale file refuses, and a run where everything
refuses writes no manifest — so "commit `.hashes.json`" has nothing to commit. Run
`meta gen --baseline=adopt` once: it records the files you have as the merge base and
writes nothing, leaving exactly one file to commit; the next `meta gen` is then the
regeneration, as its own reviewable diff. Adopting declares those files to BE generated
output, so an edit already inside one is part of the base and that regeneration replaces
it — `--baseline=fresh` + `git checkout` is the sequence that KEEPS an edit.

Hand-customizations that metadata can't express go in a sibling module you create and
import yourself — `<Entity>.extra.ts` by convention. The name carries no tool behaviour:
the file is safe because codegen writes only the paths it records, and the generated
barrel (built from the model, not a directory listing) does **not** re-export it.

**Output format:** `meta gen` (and the CLI generally) is TTY-aware — human-readable
text on a terminal, TOON on a pipe or agent. Override with `--format toon|json|text`.
TOON is the structured default for agents; `--format json` is also available.

## Multiple output targets

A `targets: { web: { outDir }, api: { outDir } }` registry plus a per-generator
`target` routes each artifact to its own package (model → database package, routes →
API app, hooks/forms → web app). The top-level `outDir` is the implicit `default`
(entity-module) target; set `entityModuleImportBase` on it when generators route
elsewhere so cross-target imports resolve. With no `targets`, output is
byte-identical to a single-`outDir` project.

## Field subtype → column mapping

Deterministic per dialect: `field.string` + `@maxLength` → `varchar(N)`,
`field.currency` → integer minor units (`bigint`), `field.uuid` → native `uuid`
(Postgres) + `gen_random_uuid()`, `field.enum` → `varchar` + `CHECK`. Override a
field's physical column name with `@column` on the field; the DB schema name lives
on `source.rdb` via `@schema`.

### Value-object jsonb columns

A `field.object` with `@storage: jsonb` (or the default `subdocument`) becomes a
single typed jsonb column — the referenced value-object's TS type is carried onto
the Drizzle column via `.$type<>()`, and its Zod schema is the VO's `InsertSchema`:

```ts
// field.object @objectRef=LlmConfig @storage=jsonb
llmConfigJson: jsonb("llm_config_json").$type<LlmConfig>(),
// field.object @objectRef=Triple @storage=jsonb isArray=true
triples: jsonb("triples").$type<Triple[]>(),   // one jsonb column, NOT a native jsonb[]
```

The VO type, its Zod `InsertSchema`, and this `.$type<>()` all import the VO from
the same module (layout/package/`extStyle`-aware resolution). An opaque jsonb column
(`field.string @dbColumnType: jsonb`) gets no `.$type<>()` — it stays `unknown`,
which is the correct shape for freeform payloads with no fixed VO.
