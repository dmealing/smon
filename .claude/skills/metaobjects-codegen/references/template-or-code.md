# Two ways to author a generator — programmatic or template

> Part of the `metaobjects-codegen` skill. Read it when choosing between a code generator and a Mustache template, or to find the template path on your port.

A generator can be **programmatic** (code that builds the output) or **declarative** (a
Mustache template plus a scope). Both are first-class, both ship in every port, and they
are good at different things.

| | Programmatic | Declarative template |
|---|---|---|
| What you write | a `Generator` in the port's language, using its AST builder (ts-poet, KotlinPoet, …) | a `.mustache` file + `{ template, scope, outputPattern, format? }` |
| Output shape | expressed in code | **is the file you are editing** |
| Cross-language | per-port by construction | one template emits for any language — it renders against the neutral, byte-gated data dict |
| Logic | any | what a template can express: sections, iteration, presence flags |

**The rule:** reach for **programmatic** when the logic is gnarly or the run is hot; reach
for a **template** when the *shape* is what you are iterating on, or when you want the same
output across languages. `scope` is `perEntity` / `perPackage` / `perModel` — the walk you
would otherwise hand-write — and `outputPattern` is the output path per item, with
`{name}` / `{Name}` / `{package}` placeholders (e.g. `"{package}/{Name}Service.java"`).
Full tradeoff table and the data dict: `docs/features/codegen-concepts.md` §3 and §10.
**Asking whether a base/extension split or a write-if-absent file exists? That's §5-§7, not
here.** §5 (*Preserving hand edits*) states MetaObjects ships exactly one hand-edit strategy —
no shipped generator on any port emits a generated-base + hand-owned-concrete pair, or a
write-if-absent file; §6 names the `skip-existing` merge strategy `runGen` accepts for
building that pair yourself, reachable only from a programmatic caller (no CLI flag selects
it); §7 (*Safety*) is the per-port write-decision mechanism behind "What codegen does" step 4
above.

**A template is not limited to documents.** It emits source as readily as docs — that is
what the neutral data dict is for.

## Both are available in every port

**TypeScript** has both, and the whole programmatic procedure is documented: `meta
generator new`, `meta eject`, the `metaobjects.config.ts` keys, the exported `render*`
functions — see this skill's `references/typescript.md` (and `references/typescript-templates.md`
for the declarative path). The declarative path is declared
in the SAME config: call
`templateGenerator()` in `generators`, or spread a parsed JSON spec with
`templateSpecToGenerators(parseTemplateSpec(...))` to reuse one written for C#/Python.
**There is no `--template-spec` flag on `meta gen` and its absence is not a gap** — the
config takes generator values, and keeping the declaration there is what keeps
`meta verify --codegen` regenerating with it.

**Java / Kotlin** have both, and both are ownable. `mvn metaobjects:eject -Dnames=<name,...>`
copies a reference generator into a `codegen/` Maven module you own and edit. A new
programmatic generator extends `com.metaobjects.generator.FileEmittingGenerator` (return
the files; it writes them under `outputDir`) and reads the model through `ModelWalk`; name
your class in the Maven `<generator>` element, which the plugin loads from the project
classpath. The declarative
path is `TemplateScopeGenerator`, wired the same way with `<template>` / `<scope>` /
`<outputPattern>` / `<format>` / `<templatesDir>` (plus the standard `<outputDir>`), and
covers Java and Kotlin alike. No `--template-spec` flag here either, for the same reason:
`<generator>` already loads a consumer class from the project classpath.

**C# and Python** have both. Programmatic: on C#, an `IGenerator` listed in
`codegen/Generators.cs` (the list `dotnet meta gen` / `verify --codegen` run); on Python,
a `module:symbol` entry in a target's `generators` in `metaobjects.config.yaml`. (Python's
`--provider module:symbol` registers **metamodel vocabulary**, not a generator.)
Declarative: a JSON template-spec. On Python it is declared on a target
(`templateSpec: <json>`, refs resolved under `--templates <dir>`) and runs into that target's
`outDir`. On C# it is an entry in `codegen/Generators.cs`:
`new MetaObjects.Codegen.TemplateCodegen.TemplateSpecGenerator { Spec = "template-spec.json",
TemplateRoot = "templates" }`. Neither port reads a spec it was not given there: a leftover
project-root `template-spec.json` with nothing declaring a spec fails the run. Worked examples
with the full JSON: `docs/ports/python.md` and `docs/ports/csharp.md`.

So on every port, "I need a shape the built-ins do not emit" is answered by a generator of
your own or a template. Do not conclude the port cannot be customized.

Each port's `references/` fragment documents what its built-ins emit, which is what you
compare your own emit against; they do not carry a step-by-step retargeting procedure.
