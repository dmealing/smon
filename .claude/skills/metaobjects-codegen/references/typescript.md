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
(the docs generators). The procedure for any unsupported stack is `any-stack.md`.

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

In a repository that also has a C# port, `dotnet meta init` writes its codegen project into
this same `codegen/` (`Generators.cs`, `Program.cs`, `Codegen.csproj`, and C# ejects in
`codegen/generators/`). The two coexist: `tsconfig.codegen.json` includes only
`codegen/**/*.ts`, and the C# project compiles only `*.cs`.

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
you choose it. Each import below runs a generator as shipped; `meta gen --list` prints
the exact line for every generator. Only a generator you are going to change is ejected:
`meta eject <name>` copies it into `codegen/generators/` and prints the local import to
swap in for the package one.

```ts
import { defineConfig } from "@metaobjectsdev/cli";
// Run as shipped: nothing copied, fixes arrive by upgrading the package.
import { entityFile, queriesFile, routesFile, barrel } from "@metaobjectsdev/codegen-ts/generators";
import { formFile } from "@metaobjectsdev/codegen-ts-react";
import { tanstackQuery, tanstackGrid } from "@metaobjectsdev/codegen-ts-tanstack";

export default defineConfig({
  outDir: "src/generated",
  dialect: "postgres",                 // "postgres" | "sqlite" | "d1" | "mysql" (mysql: codegen + runtime; migrate does not own it)
  extStyle: "js",                      // "js" (default) for Node ESM / plain tsc; "none" for a bundler-resolution toolchain — see `owning-generators.md` "Your framework isn't the default"
  apiPrefix: "/api",                   // flows to routes AND client fetch URLs
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

Every command's directory argument (`meta gen <project-root>`, `--cwd`) is the
PROJECT ROOT that CONTAINS the metadata — never the metadata directory itself.

## The generators

Server-side, framework-neutral. **None is wired by default** — `meta init` writes
`generators: []` and an empty `codegen/generators/`. Every generator below is imported from
`@metaobjectsdev/codegen-ts/generators` to run it as shipped; `meta gen --list` prints
each import line. To change what one emits, `meta eject <name>...` copies it into your
repo, imported from `./codegen/generators/*` instead (ADR-0034); the factory keeps its
name. Import by default and eject to customize: an owned copy you never change only falls
behind the reference. (`entityFile` / `queriesFile` / `routesFile` / `barrel` were removed
from that subpath at 1.0 and restored in 1.1, so on a 1.0.x install an owned copy is the
only path for those four.) Two entries cannot be ejected and are `package-only` in
`meta gen --list`: the `template` primitive, which has no emit logic of its own, and
`docs-site`, whose builder stays in the package (`meta eject docs-site` copies the site's
templates and assets into `codegen/docs-site/`). An ejected generator comes with the
template modules that write its output (`codegen/templates/`); the engine stays in the
package, and an owned copy imports it from `@metaobjectsdev/codegen-ts/engine`.

Some ejectable entries behave differently from the rest:

- **`docs`, `api-docs`, `requirements` and `agent-docs` are run by `meta gen`, like any
  other entry.** There is no separate docs command (removed in 1.1.0, ADR-0034 Amendment
  9): list `docsFile()`, `apiDocsFile()`, `requirementsFile()` and `agentDocsFile()` in
  `generators` the same way you list `entityFile()`. Each defaults to a target named
  `docs` (`targets.docs.outDir`) unless given its own `target`, and a run that lists one
  while `targets` has no `docs` entry is refused, naming the generator. To change the
  pages, `meta eject docs` (or `api-docs`, `requirements`, `agent-docs`) and list the copy
  in `generators` in place of the packaged factory — there is no separate `docs` block to
  put it in. To change only a page's wording, put your own
  `templates/docs/entity-page.md.mustache` in the project instead. Full reference:
  `typescript-docs.md`.
- **The ER diagram comes from `docsFile()`** (overview page, and each entity's page). The
  standalone `mermaidErDiagram()` / `"mermaid-er"` generator was removed in 1.1; a config
  that still wires it fails with a message saying so. Remove it and run `meta gen`.
- **`shared-model` ejects with its artifact builder.** The copy decides which source files
  may contribute and where the published version comes from. The artifact, its hash and the
  manifest a consumer's `meta deps sync` verifies are written by `buildSharedModel` and
  `renderSharedModelFiles`, copied beside it: change what they do and you stop agreeing with
  every consumer.

In an owned generator, read the project's own files through `ctx.inputRoot`. Under
`meta verify --codegen` the run writes into a temporary tree and `ctx.projectRoot` is that
tree; under a plain `meta gen` it is the directory that holds `metaobjects.config.ts`.

**`requirementTests()` — one test stub per requirement the model claims.** A recommended
approach, not a contract: a `live` or `partial` requirement gets a stub that fails until
you write its assertion (the three-way merge keeps it), a `planned` or `retired` one a
skipped stub. Options: `filter` (a predicate over `subType`, `level`, `status`, `path`,
`package`, `implementedByTypes` that REPLACES the default of functional L4/L5), `grain`
(`"concern"`, the default, or `"member"`; anything else is refused), `warnUncovered`,
`renderers` / `resolveRenderer`. `meta eject requirement-tests` copies the generator and
its default stub renderer into `codegen/generators/requirement-tests.ts`; the requirement
walk, each test's identity and the claim digest are engine and stay in the package. The requirement
checks in `meta verify` are core and are not ejectable.

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
path answers GET. A KEYLESS projection mounts no `/:id` route at all, so it refuses only
the collection verb, and it gets no `find…ById` query and no detail hook. Keyless means no
declared `identity.primary`: a field that is merely named `id` is a convention, not a key, so
a projection with an `id` field and no declared identity is keyless too (in every port).
`routesFile()` mounts it through `mountReadOnlyCrudRoutes` from the drizzle-fastify
adapter (your `codegen/runtime/` copy once ejected), which is where the refusals live.
A `field.decimal` in a view's read schema is `z.string()`: the driver reads `numeric` as
a string.

**Reports.** A concrete `object.report` whose read source is `source.rdb @kind: view` is
served like a keyless projection, from a detached read model of its derived fields
(dimensions, then measures). For a report `<R>` the generators write `<R>.ts` (Drizzle
view binding, Zod read schema, row type, descriptor, filter and sort allowlists),
`<R>.queries.ts` (`list…` only, no by-id), `<R>.routes.ts` (and `<R>.routes.hono.ts` from
`routesFileHono()`): GET list, `POST` answers 405, no `/:id`; `<R>.names.ts`; and the barrel
export. Every derived field with filter operators is filterable and sortable. The UI tier
writes the list hook and nothing else: `<R>.hooks.ts` (`use<R>List`, typed with the report's
filter, no detail or mutation hook) and its `<R>.meta.ts` descriptor, and `agent/ui.md` lists
the report. The hook generator gates on `servesClientHooks`, which is true for a served
report; the grid generators gate on `servesClientTier`, which is false, so there is no grid,
grid hook or form. An ejected hook generator keeps the gate it was copied with and writes no
report hook until you resync it (`meta eject`). On SQLite a decimal field of a report (an
`avg`, a ratio) is sent as a string, as on Postgres: the route passes `decimalColumns` to the
mount. A report with no view source, or an abstract one, generates nothing. The route and
contract: `references/reporting.md` in the `metaobjects-authoring` skill.

**Cube export (`cubeModel()`).** A reference helper that writes the reporting vocabulary
(`dimension.*`, `measure.*`, `segment.filter`, a served `object.report`) as Cube data-model files,
`model/cubes/<Cube>.yml`: a cube for each table-backed entity that declares any of it, a join for
each to-one reference between cubes, and a `rollup` pre-aggregation on the `@from` cube for each
served report (a report with a relative date in its `@filter`, `@segment` or a listed measure's
condition gets no rollup, and a `<report>Scope` segment only when it has a `@filter`). It
is opt-in: `meta eject cube-model` copies it, or import `cubeModel` from
`@metaobjectsdev/codegen-ts` (also from `/generators`), and point it at the Cube project with a
target (`targets: { cube: { outDir: "cube" } }`, `cubeModel({ target: "cube" })`). Options:
`dialect` (`"postgres"` or `"mysql"`, default the config's; `sqlite` and `d1` raise
`ERR_CUBE_UNSUPPORTED_DIALECT`), `filter` and `target`. What Cube cannot take is an `ERR_CUBE_*`
error naming the node (an array or object dimension, a name that is a Python keyword, two members
of one name); the exporter never renames or drops. A measure's `@default` is a `COALESCE` over it
(a `measure.aggregate` keeps its aggregate as a `public: false` `<m>Raw` member), and a served
report with `@spine` is a Cube view, `model/views/<Report>.yml`, rooted at the spine cube over a
`public: false` `<Report>Facts` cube that holds the report's scope, with no rollup. The mapping,
wiring and the `cube` lane that checks it against a real Cube are in
`docs/features/cube-export.md`.

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
