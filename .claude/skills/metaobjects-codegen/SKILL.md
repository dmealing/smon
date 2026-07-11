---
name: metaobjects-codegen
description: Use when configuring or running MetaObjects code generation — generators/targets/dialect config, the gen command, and hand-edit-preserving regeneration.
---

# MetaObjects code generation

Codegen is the first pillar: MetaObjects reads your typed metadata and emits
**idiomatic per-language code** — entity types, DB tables/schemas, query helpers,
REST routes, validators, payload value-objects, output parsers. The metadata is the
durable spine; the generated code is a disposable artifact. It runs at runtime
**without any MetaObjects dependency** — if the libraries disappeared tomorrow, you
keep working code.

This skill is the port-agnostic procedure. The exact config file, generator names,
and command for *this* project's server language live in a reference fragment
(pointed to at the bottom).

## What codegen does

You run a `gen` step. The runner:

1. Loads all metadata under `metaobjects/` (the same loader the runtime uses).
2. Resolves output targets and precomputes shared render state.
3. Runs each configured **generator** — most emit one file per entity; some emit a
   single shared file (a barrel, a DB-context, an app-config).
4. Refuses to overwrite any file that does NOT carry the `@generated` header;
   overwrites the ones that do.

The output is normal idiomatic code in your language — you import it and use it
like any hand-written module.

## The `@generated` header + hand-edit-preserving regen

Every emitted file carries a `@generated` header. This is load-bearing:

- **Never hand-edit a file with a `@generated` header for a change you want to
  keep.** The next `gen` run overwrites it. If you need different output, change
  the metadata (or the template), not the generated file.
- **Hand-written regions are preserved by three-way merge.** Where the codegen
  supports designated hand-editable regions, regeneration runs a three-way merge
  (base → yours → newly-generated) so your edits survive a regen. Code review is
  the backstop: a diff on a `@generated` file that wasn't produced by `gen` is a
  smell.

Practical rule: **pattern-derivable-from-metadata = regenerate; business logic =
hand-write in a non-generated file.** FK columns, CRUD, validator chains,
type-safe finders, `relations()` blocks — all derived, never hand-coded. Custom
SQL views, regex from outside metadata, and domain logic are what you hand-write.

## Selecting generators by stable name

Codegen is a set of named generators you opt into. Each generator has a **stable
name** (kebab-case) that surfaces in diagnostics — reference generators by that
name, never by inlining what they emit. Typical generators cover: the entity
type/model, the DB table/schema, query/finder helpers, REST routes, client
form/grid/hook artifacts, filter + sort allowlists, payload value-objects, and
`template.output` parsers. You enable the subset your project needs; an abstract
entity never emits instance/write artifacts regardless.

Per-entity opt-outs exist (e.g. skipping client-side artifacts for a given
entity) and are set as attributes on the entity in metadata, not in code.

## You don't have to generate everything — pick your layers

Codegen is **granular and à la carte, not all-or-nothing.** The most powerful
pattern when an app's API doesn't match generated CRUD: **generate the data layer,
hand-write only the API layer** — never abandon codegen wholesale and hand-write
the data access too.

- **Generate the data layer, skip the routes.** Omit `routesFile()` from the
  `generators` array (keep `entityFile()` + `queriesFile()` + `barrel()`): you get
  the typed entity/table, schemas, and query/finder helpers, then write your own
  routes by hand — *calling the generated queries*. Do this whenever the API shape
  (custom paths, HTML responses, nested payloads) doesn't fit generated REST CRUD.
- **Mix generated and hand-written routes.** Even with custom paths, mount the
  standard verbs with the runtime helpers and hand-write only the custom ones (see
  the runtime skill's `mountCrudRoutes` / `mount<Verb>Route` / `expose`). You are
  never forced into all-generated or all-hand-written.
- **Derived/aggregate data → declare a projection, then USE its generated query.**
  Don't hand-write a join or an `AVG()`/`COUNT()`. Declare an `object.projection`
  with `origin.aggregate` / `origin.passthrough` / `origin.collection` children
  **and a read-only `source.rdb` `@kind: view` child** (codegen detects a
  projection by that read-only source, not by the subtype alone — omit it and
  nothing is generated). `meta gen` emits a read-only query for it (and
  `meta migrate` its DB view), and you **call that generated query from your
  route**. Declaring the projection is only half the win — *consuming* its
  generated query is the other half.

`meta gen --list` prints every generator by stable name; the `generators` array in
`metaobjects.config.ts` is where you opt each one in or out.

### Adopting onto existing code — make codegen match the code, not the code match codegen

On a **brownfield adoption** (existing working code / live schema — see
`metaobjects-authoring` → "Adopting onto an existing codebase"), the goal of codegen is to
**reproduce the shape the code already has** so the generated output drops in with minimal
churn. When generated output doesn't match — different names, file layout, imports, or
signatures than the existing code — **customize the codegen to match the existing code first**,
using the à-la-carte layers, `outputPattern`/target layout, naming strategy, template
customization, and owned/custom generators described here. That is the intended adoption path,
**not a hack** — the whole point of owned generators + three-way merge is to shape output to
your codebase. Reshaping working call sites to fit the generator's defaults is the **last**
resort, and only for the layer codegen is actually replacing (the hand-rolled CRUD/DTO/mapper
you're deleting behind a parity gate). If matching the existing shape would require a genuinely
hacky generator contortion, that is the moment to **ask the human** which side should give —
don't silently churn the existing code.

## Write your own generators — the built-ins rarely fit an app exactly

The built-in generators (entity, queries, routes, form, grid, barrel) cover the
common shape, but **real apps routinely need output the built-ins don't emit as-is**
— a bespoke REST contract, custom DTO/response shapes, an app-specific service or
repository layer, a UI the defaults don't produce. When that happens the model-first
move is **not** to abandon metadata and hand-write the layer. Write a **custom
generator** that reads the same metadata and emits *your* app's shape.

Treat this as a first-class, expected activity — not an escape hatch. A custom
generator is still model-first: it derives from the metadata spine, so it
regenerates on change and stays consistent across every entity — the leverage you'd
forfeit by hand-writing. Hand-rolling *away from* metadata is the anti-pattern;
generating *your own shape from* metadata is the point.

The plugin interface is small (`@metaobjectsdev/codegen-ts`): a `Generator` is
`{ name, filter?, generate }`, where `generate(ctx)` returns `EmittedFile[]`
(`{ path, content }`). `perEntity` / `oncePerRun` wrap the common cases:

```ts
import { perEntity } from "@metaobjectsdev/codegen-ts";
import type { Generator } from "@metaobjectsdev/codegen-ts";

// One file per entity, in YOUR shape — reads the loaded metadata, emits your code.
export function serviceFile(): Generator {
  return {
    name: "service-file",                      // kebab-case; shows in `meta gen --list`
    filter: (e) => e.isEntity,                 // which nodes it applies to
    generate: perEntity((entity, ctx) => ({
      path: `${entity.name}.service.ts`,
      content: renderYourService(entity.fields(), ctx),  // walk the typed metadata
    })),
  };
}
```

`ctx` gives you `entities`, the `loadedRoot`, and `config`; `oncePerRun((entities,
ctx) => …)` is the one-shot variant (a barrel, an app-config). Add your generator to
the `generators` array in `metaobjects.config.ts` next to the built-ins — it runs in
the same pass, writes under the same target rules, and carries the `@generated`
header so it round-trips like any other.

### Never read metadata through an `own*()` accessor (ADR-0039) — top bug source

When writing OR reviewing a generator, **read every field/node property and iterate
every member set through the resolving/effective accessor — never the `own*()` form.**
`extends` is a **super-reference, not a flatten**: a concrete field/entity that
`extends` an abstract parent keeps its inherited attributes and members physically on
the parent, reachable only through the *resolving* accessor. An `own*()` read of an
effective property (`isArray`, `subType`, `maxLength`, `precision`/`scale`, `default`,
the physical column name, `objectRef`, `storage`, `required`, …) or an own-only member
iteration **silently drops everything inherited via `extends`** — the classic symptom
was a concrete field that inherited `isArray: true` from an abstract parent generating
a *scalar* column. These reads compile and pass every fixture that never exercises
`extends`, so they are a latent, cross-port top bug source.

**The one legitimate `own*()` use:** a generator emitting a generated **subclass** that
`extends` a generated base iterates **own members** (`ownFields()`) so the inherited
members are **not re-emitted** — the generated base class already declares them (the
`class Sub extends Base` / TPH pattern). Everywhere else, resolve. (The own-mode
canonical serializer and overlay-merge are the only other sanctioned own reads, and
they are library-internal, not app-generator concerns.) The one deliberately-own
attribute is `@dbColumnType` — a physical column-type override that is never inherited.

**Per-port own↔resolving mapping** (reach for the resolving column; comment any
`own*()` call with the sanctioned case it is):

| Port | Resolving (default — use this) | Own-only (avoid unless emitting a subclass's own members) |
|---|---|---|
| TypeScript | `attr(name)`, `children()`, `fields()` | `ownAttr(name)`, `ownChildren()`, `ownFields()`, the raw `isArray` field flag |
| Python | `attrs().get(name)`, `children()`, `fields()` | `attr(name)` **(own!)**, `own_children()`, `own_fields()` |
| Java / Kotlin | `getMetaAttr(name)`, resolving `getChildren()` | `getMetaAttr(name, false)`, own-only child walks |
| C# | resolving attr/`Children`/`Fields` accessors | `IsArray` native flag, `OwnChildren()`, own attr reads |

**Naming inversion — the trap:** the *default-named* accessor is NOT consistently the
safe one. **TS `attr()` RESOLVES; Python `attr()` is OWN** (own-only). In Python you
must call `attrs().get(name)` to get the inherited value — a bare `attr(name)` is the
own read that drops inheritance. When you review or port a generator, check the port's
convention, not the method name.

**Close but not exact?** You don't always need a new generator — a generated file is
a normal source file. Copy it and customize the copy (three-way merge preserves your
edits on regen), or customize the template a built-in renders from. Reach for a
custom generator when you want the change applied **consistently across every
entity** (the scale win); a one-off edit when it's genuinely one file.

**The decision ladder:** a built-in fits → use it · close → customize the
output/template · doesn't fit → write a generator that emits your shape *from the
metadata* · only the genuinely un-modelable (business algorithms, external calls) is
hand-written outside codegen — and it still imports the generated types.

## Dialects

Generated DB schema/DDL targets a SQL **dialect**:

- `postgres` — the default, fullest-featured.
- `sqlite` — supported; rejects non-default DB schemas.
- `d1` (Cloudflare D1) — **TypeScript-only**. It is SQLite at the SQL level; the
  non-TS server ports have no analogue, so it never appears in their config.

Set the dialect once in the project's codegen config. Field subtypes map to the
dialect's column types deterministically (`field.string` + `@maxLength` →
`varchar(N)`, `field.currency` → integer, `field.uuid` → native `uuid` on
Postgres, `field.enum` → `varchar` + `CHECK`, etc.).

Codegen only ever maps the **shapes you authored** — so author them right. If you
find the generator emitting the wrong column type, the fix is the field shape, not a
template hack. See "Choosing the right shape — the general decision procedure" in the
**`metaobjects-authoring`** skill for the ordered derive→`@dbColumnType`→subtype/
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

For this project's server-language codegen specifics, read every `references/*.md` file in this skill's directory (one per server language in this project's stack).
