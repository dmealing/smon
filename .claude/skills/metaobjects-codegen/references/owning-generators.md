# Owning a generator — defects, retargeting, and reading the model

> Part of the `metaobjects-codegen` skill. Read it when generated output is wrong, when your framework is not the one a reference emits for, or when you write or review a generator (the `own*()` accessor table is here).

## A defect in generated code is a defect in your generator

When generated output does not compile, has the wrong shape, or collides with code you
wrote, the defect is in the generator that emitted it — and that generator is yours. Fix
it there, in the same change, and keep going:

| Port | Where the fix goes |
|---|---|
| **TypeScript** | Your ejected copy under `codegen/generators/` — and, for routes, the HTTP adapter it calls: `meta eject routes` / `routes-hono` / `entity` also copy that adapter's source (mount helpers, filter parser, error envelopes, pagination) into `codegen/runtime/`, and the ejected output imports it from there, so a bug in a route's behaviour is fixed in that copy. If you are running a generator you never ejected, `meta eject <name>` it first. A generator that `meta eject --list` does not name (the prompt tier, for one) has no reference template yet: replace it in `generators` with your own `Generator`, starting from its source in the installed package. |
| **Java / Kotlin** | Your own generator class. Subclass the reference generator and override the `protected` method that emits the wrong piece; when that piece is `private`, copy the reference generator's source (Apache-2.0) into your own package and edit it. Put the class in a codegen module that the module running `metaobjects:generate` depends on — the plugin loads `<classname>` from that module's compile classpath, and `provided` scope keeps it out of your packaged app — then point `<classname>` at it. Full steps: the Java and Kotlin references. |
| **C# / Python** | Your owned copy (`dotnet meta eject <name>` / `metaobjects eject <name>`, then edit it), or a generator of your own that replaces the artifact — an `IGenerator` in `codegen/Program.cs` on C#, a `module:symbol` entry on Python — or a template spec (`--template-spec`). |

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
you will actually consume. Decide per generator, narrow one with its own `filter`, and
own the ones you keep — an emitted file nobody imports still reads as an invitation to
adopt the surface you decided against.

Every port gets a reference generator's source the same way — its `eject` command — and
writes a new one against the same small interface (the top of the skill). Your language
reference has the per-port mechanics.

## A generator of your own beside the references

Real apps routinely need output no reference emits as-is — a bespoke REST contract, custom
DTO or response shapes, an app-specific service layer, a document for another team. The
answer is the top of the skill: **write the generator**, in the same
`generators` list as any reference you ejected. It runs in the same pass, writes under the
same target rules, and is drift-gated the same way. The runner adds no header to its output;
on TypeScript, C# and Python none is needed, because the hash manifest records what was
written.

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
entity** (the scale win); a one-off edit when it's genuinely one file.

**The decision ladder:** an output the model describes that no reference emits → write
a generator (the top of the skill) · a reference is close → eject it and customize the
copy · a reference fits → use it · only the genuinely un-modelable (business algorithms,
external calls) is hand-written outside codegen — and it still imports the generated
types.
