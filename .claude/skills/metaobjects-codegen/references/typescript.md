# TypeScript codegen specifics

The TS port is the reference implementation, published to npm as `@metaobjectsdev/*`
packages. Codegen runs through the Node `meta` CLI (`@metaobjectsdev/cli`, binary
`meta`).

## Contents
- Install
- `metaobjects.config.ts`
- The generators
- Declarative template-codegen (Mustache)
- Run
- Multiple output targets
- Field subtype → column mapping
- Retargeting to another framework — the TypeScript procedure

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

```ts
import { defineConfig } from "@metaobjectsdev/cli";
// Owned generators scaffolded by `meta init` (ADR-0034 scaffold-and-own).
import { entityFile } from "./codegen/generators/entity";
import { queriesFile } from "./codegen/generators/queries";
import { routesFile } from "./codegen/generators/routes";
import { barrel } from "./codegen/generators/barrel";
import { formFile } from "@metaobjectsdev/codegen-ts-react";
import { tanstackQuery, tanstackGrid } from "@metaobjectsdev/codegen-ts-tanstack";

export default defineConfig({
  outDir: "src/generated",
  dialect: "postgres",                 // "postgres" | "sqlite" | "d1" (D1 is TS-only)
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

Server-side, framework-neutral. The first four are **scaffolded into your repo** by
`meta init` and imported from `./codegen/generators/*` (ADR-0034) — 1.0 REMOVED their
`@metaobjectsdev/codegen-ts/generators` export, so an owned copy is the only path. The
engine primitives come from the package main entry, `@metaobjectsdev/codegen-ts`. The
`/generators` subpath itself is NOT deprecated: it is the supported home of the generators
with no ownable copy — `promptRender`, `outputParser`, `outputPrompt`, `extractor`,
`renderHelper`, `traceHelperFile`, `routesFileHono`, `namesFile`, `callableFile`.

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
finder (no create/update/delete). The `CREATE VIEW` DDL is generated by `meta migrate`
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

## Docs — `meta docs` (one door, three surfaces)

Documentation is NOT a `meta gen` generator. The single door is the `meta docs`
command, which emits three cross-linked **surfaces** under one output dir (default
`./docs`):

- **model surface** (`./docs/<Entity>.md`, `./docs/<Template>.md`) — the neutral
  metadata reference: one page per entity and per template, including the linked
  template-source section.
- **api surface** (`./docs/api/<Entity>.md`, `./docs/api/README.md`,
  `./docs/api/AGENT-API.md`) — the SDK/API reference: the concrete imports,
  function signatures, payload field shapes, and runnable examples for *this*
  project's generated code.
- **requirements surface** (`./docs/requirements.md`, `./docs/requirements.toon`) —
  the declared `requirement.*` ledger as documentation, with each entry headed by its
  dotted path and its `title` where it has one, and each entity page naming the
  requirements that claim it. Metadata-alone like the model surface, so it needs no
  gen config. **On by default since 0.24.0** — a project declaring no `requirement.*`
  nodes writes no requirements file and the run says nothing about the surface at all,
  deliberately: reporting "0 requirement pages" would advertise a surface that never ran.

```bash
npx meta docs                     # all three → ./docs (model) + ./docs/api + ./docs/requirements.*
npx meta docs --model             # model surface only
npx meta docs --api               # api surface only
npx meta docs --requirements      # requirement ledger only
npx meta docs --out ./site-docs   # write under a different root
```

Other flags: `--layout flat|package`, `--base-url <url>`. Configure defaults in a
`docs:` block in `metaobjects.config.ts` (`outDir`, `layout`, `baseUrl`,
`surfaces`); CLI flags override it. The api surface needs the gen config
(it documents what the codegen produced); with no config it is skipped with a note,
and the model surface still emits from metadata alone.

**Before calling any generated code, read `./docs/api/AGENT-API.md`** — it has the
exact imports, signatures, payload field shapes, and runnable examples for this
project's generated API, so you don't have to guess them.

From `@metaobjectsdev/codegen-ts-react`: `formFile()` → `<Entity>.form.tsx`.
From `@metaobjectsdev/codegen-ts-tanstack`: `tanstackQuery()` → `<Entity>.hooks.ts`
(5 React Query hooks), `tanstackGrid()` → `<Entity>.columns.tsx`,
`tanstackGridHook()` → `<Entity>.grid.tsx`.

`entityFile({ allowlists: false })` drops the `runtime-ts/drizzle-fastify` import
for edge/worker consumers that don't mount server routes.

**Wire a generator only for output you consume, and narrow it with its `filter`.**
Every generator factory takes `{ filter?: (entity) => boolean }`, ANDed with the
generator's built-in gates — so it can only NARROW what emits, never widen it:
`tanstackQuery({ filter: (e) => e.name !== "InternalAudit" })` emits no hooks for
that entity. There is no `@emit*` metadata attribute to do this — `@emitTanstack`,
`@emitRoutes`, `@emitForm`, `@emitGrid` and `@emitAngular` were never registered
vocabulary, so they passed `meta gen` and failed `meta verify`. If a project carries
one, `meta upgrade --apply` removes it.

The one thing a `filter` can't express is opting a TPH subtype IN to its own
per-subtype grid (that WIDENS): `tanstackGrid({ tphSubtypeGrids: (e) => … })`,
default `() => false`. Pass the same predicate to `tanstackGridHook()` or you get
a `<Sub>.grid.ts` whose `<Sub>.columns.tsx` is never emitted.

## Declarative template-codegen (Mustache)

Everything above is the **programmatic** path. A generator can also be **declarative** —
a Mustache template plus a scope, no generator code — and on TypeScript you have both.
Pick a template when the output SHAPE is what you are iterating on, or when you want the
same output across languages; pick programmatic when the logic is gnarly or the run is
hot.

**There is no `--template-spec` flag on `meta gen`.** Do not look for one and do not
report its absence as a gap. `metaobjects.config.ts` takes generator VALUES, so a
template generator is declared there like any other — which is also what keeps it
visible to `meta verify --codegen`, a gate that re-runs the config's generator list.

```ts
import { templateGenerator } from "@metaobjectsdev/codegen-ts";

export default defineConfig({
  generators: [
    entityFile(),
    templateGenerator({
      name: "entity-service",
      template: "service/entity-service",   // → templates/service/entity-service.mustache
      scope: "perEntity",                   // "perEntity" | "perPackage" | "perModel"
      outputPattern: "{package}/{Name}Service.ts",
    }),
  ],
});
```

- `template` resolves under the project's `templates/` dir first, then framework defaults.
- `outputPattern` placeholders: `{name}`, `{Name}`, `{package}` (its `::` segments become
  nested directories). An unknown placeholder throws.
- `scope` and `walk` are mutually exclusive — supply exactly one. `walk` is the escape
  hatch for a walk none of the three scopes expresses.
- Abstract objects are excluded from every scope.

**Reusing a C#/Python spec.** Those ports declare the same generators as a JSON
template-spec because their registries are closed and the flag is their only seam. Parse
it and spread it:

```ts
import { parseTemplateSpec, templateSpecToGenerators } from "@metaobjectsdev/codegen-ts";

const spec = parseTemplateSpec(JSON.parse(readFileSync("./template-spec.json", "utf8")));
// generators: [entityFile(), ...templateSpecToGenerators(spec)]
```

Portability runs ONE way: TS also accepts a `target` field that the CLI ports reject, so
a spec written there always runs here, but not the reverse. Keep `target` out of a shared
spec. The data dict a template renders against is the cross-port byte-gated contract —
`docs/features/codegen-data-shapes.md`.

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

## Retargeting to another framework — the TypeScript procedure

This is the TypeScript implementation of the retargeting doctrine in SKILL.md
("Your framework isn't the default"). Read that first for the order of moves;
everything below — `meta eject`, `metaobjects.config.ts` keys, the exported
`render*` functions — is Node-CLI-specific and exists only on this port.

The shipped reference templates emit for **Fastify on Node** (plus a Hono variant) with
Drizzle and Zod. If that is not your stack, retargeting is the **normal first move** — not
a workaround and not a sign of a bug. Each template's header carries a `targets:` line
naming exactly what its emit is coupled to and which call to swap.

Work the list in order; the first two cost nothing.

**1. Check the target-shaped config first.** Several apparent codegen failures are one
config value in `metaobjects.config.ts`:

- **`extStyle`** — `"js"` emits `./Entity.js` specifiers, correct for Node ESM and a plain
  `tsc` with `nodenext`. Bundlers disagree on whether they perform the TypeScript
  `.js`→`.ts` rewrite: it fails outright under **Turbopack** — including between two
  generated files, which makes the whole generated tree unresolvable — while Vite and
  esbuild are documented to accept it and webpack needs `resolve.extensionAlias` to do the
  same. **If a generated import fails to resolve, set `extStyle: "none"` and retest** for
  your toolchain rather than assuming either setting from this list.
- **`clientDirective`** — `true` prepends `"use client";` to the generated form, hooks,
  columns and grid-hook modules. Defaults to `false`. **Set it if your framework compiles
  server and client from one tree** (React Server Components — Next.js App Router and
  friends); leave it off otherwise, where the directive is inert and some bundlers warn
  about it.
- **`outDir`** / **`targets`** — where output lands, per generator.
- **`apiPrefix`**, **`dialect`** — route mounting and column mapping.

**2. Ask whether your framework splits the module graph.** Some frameworks compile server
and client from one source tree and resolve each half under *different export conditions*
(React Server Components, Angular universal, Qwik). Where they do:

- a generated artifact using client-only APIs may need a **marker directive** or a distinct
  import path, and
- the resulting error frequently **names a package that is installed and present** — because
  resolution failed under the server condition, not because the dependency is missing.

Read that error as a *boundary* problem, not a dependency problem. The fix belongs in the
generator that emits the artifact, which you own.

**3. If the emit is wrong for your framework, own the generator.**

    meta eject --list          # every template you can take ownership of
    meta eject form            # copies it to codegen/generators/form.ts

Then compose the engine and replace only the step that differs. Every generator's renderer
is exported, so wrapping is available — but **how much that buys you differs by tier, and
it is worth knowing which one you are in before you start**:

- **Entity module (`entity`)** — genuinely composable. `renderDrizzleSchema`,
  `renderZodValidators`, `renderInferredTypes`, `renderFilterAllowlist` and friends are
  separate exported sections the template assembles into a `Code[]`. Swap or drop one and
  keep the rest.
- **Routes and UI (`routes`, `routes-hono`, `form`, `hooks`, `grid`, `grid-hook`)** — one
  whole-file renderer each, so "replace a step" really means wrap the whole output. That
  is enough for a marker directive, a header, or a post-process, and it is what the RSC
  case below needs. It is **not** enough to retarget the emitted framework: if you need
  Svelte or Angular instead of React, you are writing a renderer, and the honest move is
  to keep the generator's metadata walk and replace the render call entirely.

**`"use client"` needs no ejecting at all — it is a config knob.** The generated form,
hooks, columns and grid-hook modules are client components; React Server Components
frameworks (Next.js App Router and friends) require the directive saying so. Set it once:

```ts
export default defineConfig({
  clientDirective: true,   // prepend `"use client";` to generated client artifacts
  // ...
});
```

Defaults to `false`, because the directive is only *required* under RSC and is inert
(and warned about by some bundlers) everywhere else. It is applied ahead of the
`@generated` header, exactly once, and only to the four client artifacts — the entity
module, the query helpers and `<Entity>.meta.ts` are untouched, since `.meta.ts` is plain
data and in RSC the boundary is the importing component, not everything it reaches.

For the general wrap-the-output case — a directive or header MetaObjects does not model:

```ts
// codegen/generators/form.ts — OWNED
import { renderFormFile } from "@metaobjectsdev/codegen-ts-react";

// ...inside generate():
if (!ctx.renderContext) throw new Error("renderContext is required (provided by runGen)");
const body = renderFormFile(entity, ctx.renderContext);
return { path, content: `// @my-framework:client\n` + body };
```

You keep receiving upstream fixes to `renderFormFile` while owning the one line your
framework cares about. **Forking the whole renderer is the thing to avoid**, not owning the
generator.

**4. Server-tier output is usually already portable.** The entity module (a table plus
validation schemas) and the query helpers (which take `db` as a parameter rather than
importing a singleton) carry no HTTP-framework coupling — a server-rendered component can
call a generated query directly. Retargeting is usually only needed at the routes and UI
tiers.
