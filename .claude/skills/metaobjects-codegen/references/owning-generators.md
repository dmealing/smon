# Owning a generator — defects, retargeting, and reading the model

> Part of the `metaobjects-codegen` skill. Read it when generated output is wrong, when your framework is not the one a reference emits for, or when you write or review a generator (the `own*()` accessor table is here).

## Contents
- A defect in generated code is a defect in your generator
- Run it as shipped, or own a copy
- A generator of your own beside the references
- Your framework isn't the default — the retargeting procedure
- Never read metadata through an `own*()` accessor (ADR-0039) — top bug source

## A defect in generated code is a defect in your generator

When generated output does not compile, has the wrong shape, or collides with code you
wrote, the defect is in the generator that emitted it — and that generator is yours. Fix
it there, in the same change, and keep going:

| Port | Where the fix goes |
|---|---|
| **TypeScript** | Your ejected copy under `codegen/generators/` — and, for routes, the HTTP adapter it calls: `meta eject routes` / `routes-hono` / `entity` also copy that adapter's source (mount helpers, filter parser, error envelopes, pagination) into `codegen/runtime/`, and the ejected output imports it from there, so a bug in a route's behaviour is fixed in that copy. If you are running a generator you never ejected (imported from its package), `meta eject <name>` it first and swap the import for the local one eject prints. Every stock generator can be ejected except the `template` primitive, which has no emit logic of its own to own, and `docs-site`, whose builder stays in the package (`meta eject docs-site` copies the site's templates and assets into `codegen/docs-site/`); an ejected generator comes with the template modules that write its output (`codegen/templates/`): the text of what it emits is yours to change too. An ejected `docs` or `api-docs` goes in `generators`, like any other owned copy — there is no separate docs list, and `meta gen` runs it. A generator `meta gen --list` marks `package-only` has no reference template: replace it in `generators` with your own `Generator`, starting from its source in the installed package. |
| **Java / Kotlin** | Your own generator class. Subclass the reference generator and override the `protected` method that emits the wrong piece; when that piece is `private`, copy the reference generator's source (Apache-2.0) into your own package and edit it. Put the class in a codegen module that the module running `metaobjects:generate` depends on — the plugin loads `<classname>` from that module's compile classpath, and `provided` scope keeps it out of your packaged app — then point `<classname>` at it. Full steps: the Java and Kotlin references. |
| **C# / Python** | Your owned copy (`dotnet meta eject <name>` / `metaobjects eject <name>`, then edit it), or a generator of your own that replaces the artifact — an `IGenerator` in `codegen/Generators.cs` on C#, a `module:symbol` entry in a target's `generators` on Python — or a template spec. |

Then do **not**:

- file an issue against MetaObjects for it, or draft one "for upstream";
- pin an older MetaObjects release, or wait for a newer one, to get past it;
- branch, patch, or rebuild a clone of the MetaObjects repository.

The reference generators are starting points you take a copy of. They are
conformance-gated so the copy starts out correct — not so that each project's output
becomes the library's problem. Once you run a generator in your build, what it emits for
your model is yours, exactly as if you had written it.

**What is legitimately upstream** is only what you cannot own: the **loader and
metamodel** (valid metadata rejected, invalid metadata accepted, a wrong resolution), the
**core runtime** your app imports (the metadata-driven `ObjectManager`, prompt render, the
reply parser — not an HTTP adapter you ejected, which is yours), the **codegen engine
itself** (the runner, the three-way merge, `verify`), and **`meta migrate`**. The test is
mechanical: if changing a generator — or a file eject copied beside it — fixes it, it is
yours.

**The converse, so ownership does not become sprawl:** wire a generator only for output
you will actually consume. Decide per generator, narrow one to the objects you consume, and
own the ones you keep — an emitted file nobody imports still reads as an invitation to
adopt the surface you decided against.

**How you narrow one is each language's own idiom, not one shared flag:**

| Port | Narrow a generator to some objects |
|---|---|
| **TypeScript** | the generator's `filter: (obj) => boolean` |
| **C#** | `new EntityGenerator { Include = o => ... }` on the entry in `codegen/Generators.cs` (also on `db-context`, `routes`, `filter-allowlist`, `names`, `callable`); for any other generator, wrap it and hand it a narrowed `GenContext` (`ctx.Narrow(...)`), or eject and edit. `references/csharp.md`, "Scoping a generator to some objects". Never emit everything and delete files by name afterwards |
| **Python** | the `filter=` argument on the generator factory (a callable of the object), e.g. `trace_helper_generator(filter=...)` |
| **Java / Kotlin** | the entry's `<args>` in the pom where the generator offers one; otherwise `mvn metaobjects:eject` the generator and edit its object selection |

Every port gets a reference generator's source the same way — its `eject` command — and
writes a new one against the same small interface (the top of the skill). Your language
reference has the per-port mechanics.

## Run it as shipped, or own a copy

Owning a generator is how you **change** it. It is not a precondition for running one, and
a copy you never change is a cost: it duplicates the reference and falls behind it, so the
project misses fixes it would have received by upgrading.

| You want | Do |
|---|---|
| A stock generator's output, unchanged | Wire it from its package and copy nothing. TypeScript: the import line on its `meta gen --list` row, for example `import { entityFile } from "@metaobjectsdev/codegen-ts/generators";`. Other ports: select it by its stable name. |
| To change what a stock generator emits | Eject it, edit the copy, and point the config at the copy. On TypeScript the factory keeps its name, so that is one import line. |
| To stop carrying a copy you never changed | Each port's listing marks every owned copy identical to the reference or differing from it: `meta eject --list --format text` (TypeScript), `metaobjects gen --list` (Python), `dotnet meta gen --list` (C#), `mvn metaobjects:eject -Dlist` (Java, Kotlin). On TypeScript, only a copy marked identical is proven unmodified: there the mark means byte-for-byte equal. On Python, C# and Java/Kotlin, identical compares lines without regard to their order, so it rules out added, edited and removed lines but not reordered ones: confirm from the file's history (`git log -p` on the copy shows no edit after the eject) before dropping it. On every port, one marked as the same content in your formatting, or as differing with no lines of your own, may still carry lines you removed or reordered, because that count rules out added or edited lines only: confirm from the file's history (`git log -p` on the copy shows no edit after the eject) before dropping it. On TypeScript, replace its local import with the package import, delete the file, run `meta gen` and review the diff. `entity`, `routes` and `routes-hono` also own the HTTP adapter under `codegen/runtime/`: treat one as unmodified only when the generator file and every runtime file it reaches are marked identical. The runtime rows are printed by `meta eject --list --format text`, and carried as the `runtimeCopy` array (a `verdict` per file) inside the `source` object of the generator's row in `meta gen --list --format json`. Away from a terminal, `meta eject --list` without `--format text` prints generator rows only, and a listing with no runtime rows is not evidence that the adapter is unmodified. If a runtime file differs, your change lives there, so keep the owned generator, which is what points the output at that adapter. |

A generator you import is still a reference helper: its output can change when you upgrade,
and `verify --codegen` reports that as drift until you regenerate. If output has to hold
still across upgrades, own the copy.

On TypeScript `@metaobjectsdev/*` 1.0.x, `entityFile`, `queriesFile`, `routesFile` and
`barrel` are not exported from the package and an owned copy is the only way to run them.
1.1 restored the import. Check the installed version before replacing a copy with it.

## A generator of your own beside the references

Real apps routinely need output no reference emits as-is — a bespoke REST contract, custom
DTO or response shapes, an app-specific service layer, a document for another team. The
answer is the top of the skill: **write the generator**, in the same
`generators` list as any reference you ejected. It runs in the same pass, writes under the
same target rules, and is drift-gated the same way. The runner adds no header to its output;
on TypeScript, C# and Python none is needed, because the hash manifest records what was
written.

**Is it worth a generator? Run the cost test first.** Write an adopter-owned generator only
when at least one holds:

1. **It is smaller.** The generator code plus its generated output, plus the metadata it
   adds, is fewer lines than the hand-written code it replaces.
2. **More instances are coming.** The app will keep adding entities, routes or events of this
   shape, so the generator's cost is paid back as the model grows.
3. **Drift protection is the point.** A change to the model could pass the compiler and go
   wrong silently (a runtime lookup by name, a string a consumer compares), and regeneration
   plus `verify` is what catches it.

Otherwise hand-write it: a one-off layer that reads typed generated properties cannot drift
and is a fine place to stop. A generator with a general shape (usable by any app on this
model) belongs in the MetaObjects library, not copied into each app; that is an upstream
request, not a reason to grow your own.

Write a new generator when the *shape* needs to change. When a reference's shape is right
and only its *target* is wrong — a different framework than the reference emits for — eject
that generator and retarget it instead; see "Your framework isn't the default" below.

## Your framework isn't the default — the retargeting procedure

(Database or store not built in either? `any-stack.md` covers persistence, API and client together.)

If the shipped templates do not emit for your stack, retargeting is the **normal first
move** — not a workaround and not a sign of a bug. Owning a generator is the supported
path to any framework; MetaObjects does not ship a codegen package per framework and is
not waiting to.

The doctrine, in order of what to try:

1. **Check config first.** Several apparent codegen failures are one config value
   (module-specifier style, output directory, dialect, API prefix). Change it and retest
   before writing any code.
2. **Own the generator, not the renderer.** Take a copy of the reference template for the
   artifact that is wrong and edit the one step your framework disagrees about. Each
   template's header names what its emit is coupled to and which call to swap.
3. **Compose, do not fork.** Call the exported render function and wrap its result where
   you can, so you keep receiving upstream fixes. Forking a whole renderer is the thing
   to avoid — not owning the generator.
4. **Server-tier output is usually already portable.** The entity module and the query
   helpers carry no HTTP-framework coupling; retargeting is usually only needed at the
   routes and UI tiers.

Hand-rolling *away from* metadata is the anti-pattern. Generating *your own shape from*
metadata is the point.

## Never read metadata through an `own*()` accessor (ADR-0039) — top bug source

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
| TypeScript | `attr(name)`, `children()`, `fields()`, `isRequired`, `resolvedIsArray()` | `ownAttr(name)`, `ownChildren()`, `ownFields()`, the raw `isArray` field flag |
| Python | `metaobjects.codegen.model_walk`, `attrs().get(name)`, `children()`, `fields()` | `attr(name)` **(own!)**, `own_children()`, `own_fields()`, the raw `is_array` |
| Java / Kotlin | `ModelWalk.*`, `getMetaAttr(name)`, `getMetaFields()`, `isArrayType()` | `getMetaAttr(name, false)`, `isArray()`, own-only child walks (and `getName()` is the FQN — `ModelWalk.name` is the bare name) |
| C# | `Attr(name)`, `Children()`, `Fields()`, `ResolvedIsArray()`, `EffectiveEnumValues` | `IsArray` native flag, `OwnChildren()`, `OwnAttr(name)`, `EnumValues` |

**Naming inversion — the trap:** the *default-named* accessor is NOT consistently the
safe one. **TS `attr()` RESOLVES; Python `attr()` is OWN** (own-only). In Python you
must call `attrs().get(name)` to get the inherited value — a bare `attr(name)` is the
own read that drops inheritance. When you review or port a generator, check the port's
convention, not the method name.

**Close but not exact?** You don't always need a new generator — a generated file is
a normal source file. Copy it and customize the copy (three-way merge preserves your
edits on regen), or customize the template a built-in renders from. Reach for a
custom generator when you want the change applied **consistently across every
entity** and it passes the cost test above; a one-off edit when it's genuinely one file.

**The decision ladder:** an output the model describes that no reference emits → write
a generator if it passes the cost test (the top of the skill) · a reference is close → eject it and customize the
copy · a reference fits → use it · only the genuinely un-modelable (business algorithms,
external calls) is hand-written outside codegen — and it still imports the generated
types.
