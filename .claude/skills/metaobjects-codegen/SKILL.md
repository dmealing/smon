---
name: metaobjects-codegen
description: Use when you need ANY output derived from the MetaObjects model — write your own generator (OpenAPI, JSON Schema, Zod, DTOs, a client, docs, anything) or eject a reference one — and when configuring or running code generation, generators/targets/dialect config, the gen command, and hand-edit-preserving regeneration.
---

# MetaObjects code generation

Codegen is the first pillar: MetaObjects reads your typed metadata and emits
**idiomatic per-language code** — entity types, DB tables/schemas, query helpers,
REST routes, validators, payload value-objects, output parsers. The metadata is the
durable spine; the generated code is a disposable artifact. It has **no
proprietary runtime**: entity and model code imports nothing from MetaObjects, and the
REST, prompt and client tiers import ordinary Apache-2.0 packages you can vendor or
replace — if the libraries disappeared tomorrow, you keep working code.

**MetaObjects is the core; the generators are yours** (ADR-0034 Amendments 3 and 4). The
core — model, loader, registry, `verify`, `migrate`, prompt render and reply extract — is
what MetaObjects guarantees. On it, you build the generators the application needs. The
generators MetaObjects ships are reference examples: copy one with `eject` when it is
close to what you need, and write your own when it is not. When a generated file is
wrong, fix the generator that emitted it — do not hand-edit around it, and do not treat it
as a broken core guarantee.

This skill is the port-agnostic procedure. The exact config file, generator names,
and command for *this* project's server language live in a reference fragment
(see the table below).

## Reference files — open only the one your task needs

Your server language's file (`references/typescript.md`, `references/java.md`, …) has the
exact config, generator names and commands for this project; read it. The other files in
`references/` are topics — open one when its row matches what you are doing.

| File | Open it when |
|---|---|
| `references/any-stack.md` | **the database, data store, HTTP framework or UI framework is not one a reference generator targets** — MySQL, MongoDB, DynamoDB, Express, NestJS, Next.js, Vue, … |
| `references/owning-generators.md` | generated output is wrong; your framework is not the one a reference emits for; you write or review a generator (the `own*()` accessor table) |
| `references/choosing-layers.md` | the generated API does not fit, you need joined or derived data, or you are adopting onto existing code |
| `references/template-or-code.md` | choosing between a code generator and a Mustache template |
| `references/physical-names.md` | before you write a table, column or index name as a string |
| `references/dependencies-and-shared-models.md` | the project consumes or publishes metadata across projects |

## Need an output? Write the generator — this is the primary path

**When.** You need an output the model fully describes and no reference generator emits —
or none emits it the way this application needs it. OpenAPI, JSON Schema, Zod schemas,
DTOs or a client for a framework nothing here ships, a service layer in the house style,
a data dictionary, a search-index mapping, test fixtures. That is a generator, and you
write it now, in this change. Do not hand-write the output (it drifts the day the model
changes and nothing notices), do not wait for MetaObjects to ship it, and do not ask
permission: a generator in this repo is ordinary source you own.

**How — the shape is about 20 lines in every port.** A generator is a `name` plus a
function from the loaded model to a list of `{ path, content }` files:

```ts
import { isAbstract, perEntity, type Generator } from "@metaobjectsdev/codegen-ts";

export function fieldListGenerator(): Generator {
  return {
    name: "field-list",                          // shows in diagnostics
    filter: (obj) => !isAbstract(obj),           // ctx.entities has EVERY object, abstract ones too
    generate: perEntity((obj) => ({              // perPackage / perModel for other scopes
      path: `field-list/${obj.name}.txt`,        // relative to outDir
      content: obj.fields()                      // fields() includes inherited fields
        .map((f) => `${f.name}: ${f.subType}${f.resolvedIsArray() ? "[]" : ""}${f.isRequired ? "" : "?"}`)
        .join("\n") + "\n",
    })),
  };
}
```

**Start from the scaffold (TypeScript):** `meta generator new <name> [--scope
entity|package|model]` writes a working, commented generator into `codegen/generators/`
and wires it into `metaobjects.config.ts`. `meta gen` runs it straight away. Then change
what it emits.

**Register it** — the one step per port:

| Port | Registration | Model helpers |
|---|---|---|
| TypeScript | import it in `metaobjects.config.ts`, add it to `generators: [...]` (the scaffold does both) | `@metaobjectsdev/codegen-ts`: `objectRefTarget`, `enumValues`, `effectivePackage`, `packageToPath`, `servedPath`, `toCamelCase`/`toPascalCase`/`toSnakeCase`/`pluralize`, `isAbstract`, `hasAnyRdbSource`, `servesReadApi`/`servesWriteApi` |
| Python | a `module:symbol` entry in `--generators` or a target's `generators` in `metaobjects.config.yaml`; the symbol is an instance or a function returning one, never the class | `metaobjects.codegen.model_walk` |
| C# | `new YourGenerator()` in the owned `codegen/Program.cs`; `dotnet meta gen` / `verify --codegen` hand off to `codegen/` whenever `codegen/Codegen.csproj` exists | node accessors, `ValueObjectNames.ResolveFieldRef`, `CSharpNaming.RoutePath` |
| Java / Kotlin | `<generator><classname>` plus `<args><outputDir>`, from a module on the plugin's classpath; extend `FileEmittingGenerator` | `com.metaobjects.generator.ModelWalk` |

**Verify it** — nothing to register. `verify --codegen` (`mvn metaobjects:verify` on the
JVM) re-runs the same generator list and fails when committed output is stale. Typecheck
a TypeScript generator with `npx tsc -p tsconfig.codegen.json`: `meta gen` loads it
without typechecking, so a wrong accessor runs silently.

**Read the model correctly — the rules that make a generator right:**

- **Which objects.** The runner hands you every object — entities, value objects,
  projections and abstract bases. Filter: abstract bases only contribute fields to what
  `extends` them.
- **Resolving accessors, always (ADR-0039).** `fields()`, `attr()`, `isRequired`,
  `resolvedIsArray()` see what a field or object inherits through `extends`; the `own*()`
  forms and the raw `isArray` flag do not, and the output is silently wrong on any model
  that uses inheritance. In Python `attr()` is the OWN read — use `model_walk` or
  `attrs().get()`. On the JVM `getName()` is the fully-qualified name — use
  `ModelWalk.name`. Full table: `references/owning-generators.md`.
- **Names from the model, resolved by the engine's rules.** An `@objectRef` resolves
  package-locally through the port's helper (`objectRefTarget` and its equivalents),
  never by matching a short name. A REST address is `servedPath` / `route_path` /
  `RoutePath` / `ModelWalk.collectionSegment`, the same rule the reference routes use.
- **Any format.** `content` is written as given — no port formats it or adds a header.
  Make it deterministic: the same model must give the same bytes, or verify reports drift.

Every port's minimal generator (each run through gen, verify and a convicted model
change) and two worked examples to copy — JSON Schema and OpenAPI 3.1, examples and not a
product surface — are in the guide "Write your own generator":
<https://github.com/metaobjectsdev/metaobjects/blob/main/docs/recipes/write-your-own-generator.md>.

**Eject instead** only when a reference generator already emits something close to what
you need: `meta gen --list --probe` is the catalog, `meta eject <name>` copies one in.
**Hand-write** only what the model cannot express — business logic, calls to other
systems — and have it import the generated types.

## What codegen does

You run a `gen` step. The runner:

1. Loads all metadata under `metaobjects/` (the same loader the runtime uses).
2. Resolves output targets and precomputes shared render state.
3. Runs each configured **generator** — most emit one file per entity; some emit a
   single shared file (a barrel, a DB-context, an app-config).
4. Decides whether it may overwrite a file — and **the rule differs by port**:
   - **TypeScript, C#, Python** — by a committed **hash manifest**
     (`.metaobjects/.gen-state/.hashes.json`). If a file still hashes to what the
     generator recorded writing, it is safe to overwrite; if it was edited, or there is
     no record of it, the write is **refused by name**. TypeScript additionally
     three-way-merges against a snapshot when one is present locally.
   - **Java, Kotlin** — by a bare **`GENERATED`** token in the file's header comment
     (`GeneratedFileWriter.GENERATED_MARKER`). The token is `GENERATED`, **not**
     `@generated`: the matcher allows only whitespace between the comment punctuation
     and the token, so an `@`-prefixed tag does not match it. Remove that token and
     regeneration never touches the file again.

   **A refusal FAILS the run — exit 1 on every port** (TypeScript always did; Python and
   C# warned and exited 0 until 1.0, so a `gen` wired into CI was green while codegen
   refused to write). The one-time fix for a project that predates the committed manifest
   is **`gen --baseline=adopt`**: it records the files you have as the baseline and writes
   nothing, so there is finally a `.hashes.json` to commit — then `gen` again, and the
   regeneration lands as its own diff. Adopting DECLARES those files to be generated
   output, so an edit already inside one is part of the baseline and that regeneration
   replaces it; commit before you run it. (TypeScript additionally has
   `--baseline=fresh`: write fresh output now and discard the edits.)

   **The two rules protect a hand edit in opposite ways, so do not carry a habit across
   ports.** On TypeScript, C# and Python, *editing the content* is what takes ownership —
   that is what breaks the hash — and deleting the header changes nothing except your
   ability to tell what generated the file. On Java and Kotlin the reverse holds: editing
   a file protects it not at all, because the `GENERATED` token is still there and the
   next run overwrites the edit; only removing that token does.

   (The header text differs per port and none of it is the write decision on the
   hash-manifest ports: TypeScript and Python emit `@generated by …`, C# emits
   `<auto-generated/>`, Java and Kotlin emit the `GENERATED` token above.)

The output is normal idiomatic code in your language — you import it and use it
like any hand-written module.

## The `@generated` header + hand-edit-preserving regen

Every file a reference generator emits carries a `@generated` header (a generator you
write adds one only if it chooses to — the runner adds none, and JSON cannot hold one).
Treat any generated file this way:

- **Never hand-edit a file with a `@generated` header for a change you want to
  keep.** The next `gen` run overwrites it. If you need different output, change the
  metadata, or change the generator that emits it.
- **This rule is about emitted output — it is not a rule about your generators.** A
  generator you own carries no `@generated` header and is edited like any other source
  file in your repo. See the next section before you conclude a shape is unreachable.
- **Hand-written regions are preserved by three-way merge.** Where the codegen
  supports designated hand-editable regions, regeneration runs a three-way merge
  (base → yours → newly-generated) so your edits survive a regen. Code review is
  the backstop: a diff on a `@generated` file that wasn't produced by `gen` is a
  smell.

Practical rule: **pattern-derivable-from-metadata = regenerate; business logic =
hand-write in a non-generated file.** FK columns, CRUD, validator chains,
type-safe finders, `relations()` blocks — all derived, never hand-coded. What you
hand-write is what metadata genuinely can't express: regex from outside metadata and
domain logic. Most views are NOT irreducible — model them as an `object.projection`
and the view DDL is generated (see `references/choosing-layers.md`); a hand-written view
for a shape origins can express is drift the drift gate can't even see. A genuinely
*irreducible* view body (recursive CTE, window function, set op) isn't hand-written
loose either — it goes in the `source.rdb` **`@sql`** escape (#208, ADR-0043) so the
tool still registers, fingerprints, and drift-checks it.

## Your generators are yours — editing one needs no permission

A generator in your repo is your code, not a vendor artifact. ADR-0034 is
**scaffold-and-own**: the generators the scaffolded config wires are copied into your
repo at init, and every reference template's header says so in its own first line
("copy this into your repo … and own it", "now YOURS to change"). None carries a
`@generated` header. Editing one is ordinary work.

**A standing rule not to change the MetaObjects repo is not a rule about your
generators.** They are different repositories, and you own yours outright. That
generalisation is the observed failure mode, not a hypothetical: an agent told not to
touch upstream quietly drops "edit the generator" from the moves available to it and
hand-writes the layer instead — the single outcome the rest of this skill exists to
prevent. If you are about to hand-write something data-shaped because the generated
shape is wrong, the generator is the file to open, and you do not need to ask first.

**The order when generated output does not fit:**

1. **The metadata**, if the model is wrong — wrong column type, missing relationship,
   a join that should be a projection. Fix the spine first; it fixes every port at once.
2. **Your own generator**, if the model is right and the *emit* is wrong — naming, file
   layout, imports, framework, signatures.
3. **Hand-write**, only for what metadata genuinely cannot express — and wire it to the
   generated types.

Hand-writing something the metadata already describes is step 3 used as step 1.

**A defect in generated code is a defect in your generator.** When generated output does not
compile, has the wrong shape, or collides with your code, fix the generator that emitted it (or
the runtime file `eject` copied beside it) in the same change. Do not file an issue upstream,
pin an older release, or patch a clone of MetaObjects for it. What is legitimately upstream is
only what you cannot own: the loader and metamodel, the core runtime, the codegen engine, and
`meta migrate`. Per-port steps: `references/owning-generators.md`.

**Wire a generator only for output you will consume.** An emitted file nobody imports still
reads as an invitation to adopt the surface you decided against.

## Selecting generators — NOTHING is generated until you choose it

**`meta init` wires no generators, and no port ships a default suite.** A fresh
scaffold has `generators: []` and an empty `codegen/generators/`; `--generators` is
required on the C# and Python CLIs; Java has never had a default set. Choosing what an
application needs is a judgment over its purpose and stack, and the tool's job is to
make that choice cheap and truthful, not to make it for you.

Each generator has a **stable name** (kebab-case) that is the same in every port and
surfaces in diagnostics — reference generators by that name, never by inlining what
they emit.

### The procedure

1. **Read the app's purpose and stack.** What is it for; what does it already use.
2. **`meta gen --list --format json --probe`** — the catalog. Every generator with its
   `layer`, `framework`, what it emits, what it requires, what it costs to install,
   and — with `--probe`, which constructs each generator and dry-runs it against YOUR
   model — how many files each would actually emit.
3. **Check the libraries before you choose generators.** The same catalog carries
   `kind: "library"` rows — declared design MetaObjects ships, each with a `useWhen`.
   If one matches a capability you are about to model, **opt in and adapt rather than
   author**: you inherit its entities, its requirements, and the rulings recorded with
   them. Layers are how much of it you take. The bare name is the CORE layer — the
   model and its ledger, sourceless, so it adds **no tables and no generated code**;
   `<lib>/db` is the separate opt-in that proposes the schema. Opt in with
   `"libraries": ["iam", "iam/db"]` in `.metaobjects/config.json`.
4. **Choose by `layer`.** Satisfy every `requires`. Take what `wouldEmit > 0` says your
   model is already asking for.
   - Pick **ONE** framework on the `api` layer: `routes` and `routes-hono` are
     alternatives, and wiring both silently produces two complete HTTP surfaces.
   - Do **NOT** apply that rule to `client`. `@metaobjectsdev/tanstack` peers on
     `react`, so a form generator plus the TanStack hook/grid generators is the
     intended composition, not a conflict.
5. **`meta eject <names...> --format json`** — copies each into `codegen/generators/`
   (yours to edit), and reports the import line, the entry to add to `generators`, one
   consolidated install command, and any config keys those generators read. On
   TypeScript, a generator whose output calls an HTTP adapter (`routes`, `routes-hono`,
   `entity`) also gets that adapter's source copied into `codegen/runtime/`, and each JSON
   row lists those files under `runtime`.
6. **`meta gen`** — read its warnings, then typecheck.

A library row also carries `provides` (what is in the box) and, under `--probe`, a
`project` block: which layers you selected, how many tables and requirements they
added here, which of your entities `extends` into it, and any generator the library
implies that you have not wired.

### The six layers, and what picks them

| layer | what it is | chosen by |
|---|---|---|
| `model` | entity/DTO/value-object modules and the constants beside them | app shape |
| `persistence` | how rows are read and written | app shape |
| `api` | the HTTP surface — pick one framework | app shape |
| `client` | the browser tier | app shape |
| `docs` | on by default; the canonical door is `meta docs` | — |
| `capability` | prompts, parsers, payloads, traces, test stubs | **`--probe`** |

At intent level: a **headless data service** is `model` + `persistence`; an **HTTP API**
adds `api` with one framework; an **admin UI** adds `client`. Members come from the live
catalog, never from a list in prose — a list here would go stale the day a generator is
added, and `--probe` cannot, because it runs the generators rather than describing them.

`capability` looking like one large bucket is the point: you are not meant to choose
inside it by reading labels. You declared a `template.prompt`, or a
`requirement.functional`, or a stored-proc source — `--probe` reports the file count
that follows, for your model.

An abstract entity never emits instance/write artifacts regardless of what is wired.

**A dependency's metadata is load-only by default:** codegen excludes nodes from a package a
dependency owns unless `scope.include` names that package literally. See
`references/dependencies-and-shared-models.md`, which also covers publishing with
`sharedModelFile()`.

## You don't have to generate everything — pick your layers

Codegen is à la carte. When the app's API does not match generated CRUD, **generate the data
layer and hand-write only the routes**, calling the generated queries — never abandon codegen
for the data access too. An entity's own columns plus a joined extra is an **entity read-view**,
not a projection; derived or aggregate data is a projection whose generated query you call.
Details and the adoption rules: `references/choosing-layers.md`.

## Two ways to author a generator

A generator is **programmatic** (code that builds the output) or **declarative** (a Mustache
template plus a `scope` and an `outputPattern`). Both ship in every port. Use programmatic code
when the logic is involved; use a template when the shape is what you are iterating on, or you
want one output across languages. The per-port wiring is in
`references/template-or-code.md`. Whether a base/extension split or a write-if-absent
file exists is answered in `docs/features/codegen-concepts.md` §5-§7: MetaObjects ships one
hand-edit strategy, and no shipped generator emits either.

## Never hand-write a physical name

A table, column, schema or index name is declared in metadata. Every port can emit a per-object
names artifact (`<Entity>.names.ts`, `<Entity>Names.java`, …) — **but only when you wire the
`names` generator**, since no port generates it by default. Reference its constants from raw SQL,
migration scripts and external mappings; prefer the ORM's typed column handle where one exists.
Details: `references/physical-names.md`.

## Dialects

Generated DB schema/DDL targets a SQL **dialect**:

- `postgres` — the default, fullest-featured.
- `sqlite` — supported; rejects non-default DB schemas.
- `d1` (Cloudflare D1) — **TypeScript-only**. It is SQLite at the SQL level; the
  non-TS server ports have no analogue, so it never appears in their config.
- `mysql` — **TypeScript codegen and runtime only.** `meta migrate` does not own a MySQL
  schema and refuses `--dialect mysql`; you keep the DDL yourself.

Set the dialect once in the project's codegen config. Field subtypes map to the
dialect's column types deterministically (`field.string` + `@maxLength` →
`varchar(N)`, `field.currency` → integer, `field.uuid` → native `uuid` on
Postgres, `field.enum` → `varchar` + `CHECK`, etc.).

Codegen only ever maps the **shapes you authored** — so author them right. If you
find the generator emitting the wrong column type, the fix is the field shape, not a
template hack. See the decision procedure in the **`metaobjects-authoring`** skill
(`references/choosing-a-shape.md`) for the ordered derive→`@dbColumnType`→subtype/
`@kind`/attribute routing (ADR-0037) — e.g. arrays are `isArray: true` (never an
array column type) and a native UUID is `field.uuid` (not a string + `@dbColumnType`).
When you register custom vocabulary for a custom generator, the same ADR-0037
procedure decides whether it's a subtype, a `@kind` variant, or an attribute.

## Per-target output

Generated code can be routed to **multiple output directories/packages** so each
artifact lands with its runtime concern: the entity model in a database package,
routes in the API app, client hooks/forms/grids in the web app. Each generator can
declare which named target it writes to; same-target references stay relative,
cross-target references go through the target's configured import base. With no
targets configured, everything lands in a single output directory — output is
byte-identical to the single-directory case. Use multiple targets only when the
project's package boundaries justify it.

## Running gen

The shape is always the same — a `gen` verb that loads metadata, renders, merges,
and writes — but the binary differs per server language (the Node `meta`, a
language-native console tool, or a build-plugin goal). A dry-run mode previews
without writing; a watch mode re-runs on metadata changes where supported. Pass
specific entity names to scope a run to those entities.

---

For this project's codegen specifics, read the `references/<language>.md` file for each server
language in this project's stack (only those are installed). Open the topic files in
`references/` only when the table at the top points you to one.
