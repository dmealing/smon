// REFERENCE TEMPLATE — copy this into your repo (e.g. codegen/generators/entity.ts) and own it.
// Then import it LOCALLY in metaobjects.config.ts:
//   import { entityFile } from "./codegen/generators/entity";
//
// use-when:      ALWAYS — this is the entity-module generator. It owns the shape of each
//                generated <Entity>.ts (the Drizzle table, Zod schemas, inferred types,
//                constants, filter allowlists). Start here and adapt the assembly.
// emits:         <target>/<Entity>.ts per concrete object — and the shared-enums module once.
//                Dispatches: abstract/value → interface + Zod; projection → read-only view decl;
//                write-through entity → full Drizzle table path.
// customize:     reorder/drop sections in `sections` below; change the header; swap a sub-renderer
//                for your own (each render* is an engine primitive you call). To deeply own one
//                section (e.g. the Drizzle emit), copy/replace that sub-render call with your code.
// composes-with: queries.ts, routes.ts, barrel.ts (they import the files this emits).
//
// The composition (`renderEntity`) is the relocated body of the built-in entity composer —
// byte-identical to start, now YOURS to change. It imports only public engine primitives.

import { joinCode, type Code } from "ts-poet";
import type { MetaObject } from "@metaobjectsdev/metadata";
import {
  perEntity,
  type EmittedFile,
  type GenContext,
  type Generator,
  type GeneratorFactory,
  type RenderContext,
  // sub-renderers (engine primitives) — the LEGO blocks this composition assembles:
  renderDrizzleSchema,
  renderInferredTypes,
  renderEnumTypeAliases,
  renderZodValidators,
  renderEntityConstants,
  renderFilterAllowlist,
  renderSortAllowlist,
  renderFilterType,
  renderTphDiscriminatorUnion,
  isTphDiscriminatorBase,
  renderProjectionDecl,
  renderValueObjectFile,
  renderSharedEnumsFile,
  SHARED_ENUMS_BASENAME,
  // predicates + helpers:
  isProjection,
  isAbstract,
  hasWritableRdbSource,
  // engine plumbing:
  formatTs,
  entityOutputPath,
  GENERATED_HEADER,
} from "@metaobjectsdev/codegen-ts";

export interface RenderEntityOpts {
  readonly allowlists?: boolean;
}

// --- composition (OWNED) — assembles one <Entity>.ts. Change this to change the output. ---
function renderEntity(entity: MetaObject, ctx: RenderContext, opts?: RenderEntityOpts): string {
  const runtime = ctx.selfTarget.runtime;
  const allowlists = runtime ? (opts?.allowlists ?? true) : false;

  // Abstract → shape only (interface + Zod), never a table.
  if (isAbstract(entity)) {
    return renderValueObjectFile(entity, ctx.apiPrefix, ctx);
  }
  // Projection → read-only view declaration + read schema.
  if (isProjection(entity)) {
    return renderProjectionDecl(entity, ctx.loadedRoot, {
      columnNamingStrategy: ctx.columnNamingStrategy,
      dialect: ctx.dialect,
      apiPrefix: ctx.apiPrefix,
      timestampMode: ctx.timestampMode,
      allowlists,
      ctx,
      includeViewDecl: runtime,
    });
  }
  // Value-only / contract target → interface + Zod, no Drizzle table.
  if (!runtime || !hasWritableRdbSource(entity)) {
    return renderValueObjectFile(entity, ctx.apiPrefix, ctx);
  }

  // Write-through entity → the full Drizzle table file. Reorder/drop sections freely.
  const enumAliases = renderEnumTypeAliases(entity, ctx);
  const tphBlock = renderTphDiscriminatorUnion(entity, ctx.loadedRoot);
  const tphBase = tphBlock !== null && isTphDiscriminatorBase(entity, ctx.loadedRoot);
  const sections: Code[] = [
    renderDrizzleSchema(entity, ctx),
    renderInferredTypes(entity, tphBase, ctx),
    ...(enumAliases !== null ? [enumAliases] : []),
    renderZodValidators(entity, ctx),
    renderEntityConstants(entity, ctx.apiPrefix),
    ...(allowlists ? [renderFilterAllowlist(entity), renderSortAllowlist(entity)] : []),
    renderFilterType(entity),
    ...(tphBlock !== null ? [tphBlock] : []),
  ];

  const body = joinCode(sections, { on: "\n" }).toString();
  const header =
    `// ${GENERATED_HEADER} — DO NOT EDIT.\n` +
    `// Source metadata: ${entity.name} (${entity.fqn()})\n` +
    `// Customize via ${entity.name}.extra.ts in this directory.\n`;
  return header + body;
}

export interface EntityFileOpts {
  filter?: (entity: MetaObject) => boolean;
  target?: string;
  allowlists?: boolean;
}

export const entityFile = function entityFile(opts?: EntityFileOpts): Generator {
  const allowlists = opts?.allowlists ?? true;
  const perEntityEmit = perEntity(async (entity, ctx) => {
    if (!ctx.renderContext) {
      throw new Error("entity-file: renderContext is required (provided by runGen)");
    }
    if (isAbstract(entity) && !ctx.renderContext.emitAbstractShapes) {
      return [];
    }
    return {
      path: entityOutputPath(ctx.config.outputLayout ?? "flat", entity.package, `${entity.name}.ts`),
      content: await formatTs(renderEntity(entity, ctx.renderContext, { allowlists })),
    };
  });

  const generator: Generator = {
    name: "entity-file",
    emitsEntityModule: true,
    generate: async (ctx: GenContext): Promise<EmittedFile[]> => {
      const files = await perEntityEmit(ctx);
      // FR-019: emit the shared-enums module once per run (null → no file).
      const sharedEnums = renderSharedEnumsFile(ctx.loadedRoot);
      if (sharedEnums !== null) {
        files.push({ path: `${SHARED_ENUMS_BASENAME}.ts`, content: await formatTs(sharedEnums) });
      }
      return files;
    },
  };
  if (opts?.filter) {
    generator.filter = opts.filter;
  }
  if (opts?.target) {
    generator.target = opts.target;
  }
  return generator;
} as GeneratorFactory<EntityFileOpts>;
