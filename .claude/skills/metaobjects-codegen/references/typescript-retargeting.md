# Retargeting to another framework — the TypeScript procedure

> Part of the `metaobjects-codegen` skill's TypeScript reference. Read it when your HTTP or UI framework is not Fastify, Hono or React.

This is the TypeScript implementation of the retargeting doctrine in
`owning-generators.md` ("Your framework isn't the default"). Read that first for the order of moves;
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
- **Routes (`routes`, `routes-hono`)** — the whole route composition is IN the ejected
  file (`renderRoutes` / `renderRoutesHono`: CRUD, read-only projections, M:N traversal,
  TPH per-subtype sets), so change what is emitted by editing it. Ejecting also copies the
  HTTP adapter the emitted routes call — see "Ejecting routes hands over the adapter too"
  below.
- **UI (`form`, `hooks`, `grid`, `grid-hook`)** — one
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
