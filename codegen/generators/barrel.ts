// REFERENCE TEMPLATE — copy this into your repo (e.g. codegen/generators/barrel.ts) and own it.
// Then import it LOCALLY in metaobjects.config.ts instead of from the package:
//   import { barrel } from "./codegen/generators/barrel.js";
//
// RUNTIME: this file executes under whatever runs `meta gen`, and the published CLI's
// shebang is `#!/usr/bin/env node` — so it runs under NODE even in a Bun project. Do not
// reach for `Bun.*` globals here; they are undefined and take the whole run down with
// `Bun is not defined`. Use `node:` builtins instead.
// targets:       nothing framework-specific — it re-exports whatever the other generators
//                emitted. `extStyle` decides whether the re-export specifiers carry a
//                `.js` extension.
// use-when:      you want a single `index.ts` re-exporting every generated entity module.
// emits:         <target>/index.ts with one `export * from "./<Entity>"` per entity, alphabetical.
// customize:     the export form (star vs named), ordering, grouping by package, what to include/exclude.
// composes-with: entity.ts (this re-exports the files entity.ts emits).
//
// Everything below imports ONLY from `@metaobjectsdev/codegen-ts` (the stable engine).
// The composition (`renderBarrel`) is inlined here so you own it — change it freely.

import {
  oncePerRun,
  type Generator,
  type GeneratorFactory,
  type ExtStyle,
  type ResolvedTarget,
  barrelModuleSpecifier,
  formatTs,
  GENERATED_HEADER,
} from "@metaobjectsdev/codegen-ts";

interface BarrelEntry {
  name: string;
  package: string | undefined;
}

// --- composition (OWNED) — the barrel file body. Customize freely. ---
function renderBarrel(
  entries: BarrelEntry[],
  extStyle: ExtStyle,
  selfTarget: ResolvedTarget,
  entityModuleTarget: ResolvedTarget,
): string {
  const sorted = [...entries].sort((a, b) => a.name.localeCompare(b.name));
  const exports = sorted
    .map((e) => `export * from ${JSON.stringify(barrelModuleSpecifier(selfTarget, entityModuleTarget, e.package, e.name, extStyle))};`)
    .join("\n");
  return `// ${GENERATED_HEADER} — DO NOT EDIT.\n${exports}\n`;
}

export interface BarrelOpts {
  target?: string;
}

export const barrel = function barrel(opts?: BarrelOpts): Generator {
  const generator: Generator = {
    name: "barrel",
    generate: oncePerRun(async (entities, ctx) => {
      if (!ctx.renderContext) {
        throw new Error("barrel: renderContext is required (provided by runGen)");
      }
      const rc = ctx.renderContext;
      return {
        path: "index.ts",
        content: await formatTs(
          renderBarrel(
            entities.map((e) => ({ name: rc.valueObjectEmittedName(e), package: e.package })),
            rc.extStyle,
            rc.selfTarget,
            rc.entityModuleTarget,
          ),
        ),
      };
    }),
  };
  if (opts?.target) {
    generator.target = opts.target;
  }
  return generator;
} as GeneratorFactory<BarrelOpts>;
