# TypeScript declarative template-codegen (Mustache)

> Part of the `metaobjects-codegen` skill's TypeScript reference. Read it when you want a Mustache template instead of a code generator.

`typescript.md` covers the **programmatic** path. A generator can also be **declarative** —
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
