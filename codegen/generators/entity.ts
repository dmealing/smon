// REFERENCE TEMPLATE — copy this into your repo (e.g. codegen/generators/entity.ts) and own it.
// Then import it LOCALLY in metaobjects.config.ts:
//   import { entityFile } from "./codegen/generators/entity.js";
//
// RUNTIME: this file executes under whatever runs `meta gen`, and the published CLI's
// shebang is `#!/usr/bin/env node` — so it runs under NODE even in a Bun project. Do not
// reach for `Bun.*` globals here; they are undefined and take the whole run down with
// `Bun is not defined`. Use `node:` builtins instead.
// targets:       Drizzle ORM + Zod. The emitted module is a Drizzle table plus Zod
//                insert/update schemas; the column mapping follows `dialect`. On the
//                default (vanilla) path, replace the `renderDrizzleSchema` /
//                `renderZodValidators` calls to target a different ORM or validator — the
//                metadata walk that feeds them is ORM-neutral. (The `isWriteThrough`
//                branch calls `renderEntityFile` instead — a narrow #214 read-view case,
//                not the default.)
// use-when:      ALWAYS — this is the entity-module generator. It owns the shape of each
//                generated <Entity>.ts (the Drizzle table, Zod schemas, inferred types,
//                constants, filter allowlists). Start here and adapt the assembly.
// emits:         <target>/<Entity>.ts per concrete object — and the shared-enums module once.
//                Dispatches: abstract/value → interface + Zod; sourceless entity (identity, no
//                source — a MongoDB/Cassandra/Neo4j record) → interface + create/PATCH Zod +
//                allowlists; projection → read-only view decl; write-through entity → full
//                Drizzle table path.
// customize:     reorder/drop sections in `sections` below; change the header; swap a sub-renderer
//                for your own (each render* is an engine primitive you call). To deeply own one
//                section (e.g. the Drizzle emit), copy/replace that sub-render call with your code.
// owns:          the allowlist TYPES too. `<Entity>FilterAllowlist` / `<Entity>SortAllowlist`
//                are typed by `FilterAllowlist` / `SortAllowlist`, which `meta eject entity`
//                copies into `codegen/runtime/drizzle-fastify/filter-allowlist.ts`; the emitted
//                type import points there, not at `@metaobjectsdev/runtime-ts`.
//                `runtimeImport` moves it; `runtimeImport: "@metaobjectsdev/runtime-ts"`
//                goes back to the package.
// composes-with: queries.ts, routes.ts, barrel.ts (they import the files this emits).
//
// The composition (`renderEntity`) is the relocated body of the built-in entity composer —
// byte-identical to start, now YOURS to change. It imports only public engine primitives.

// ts-poet combinators come from the engine package, NOT a bare "ts-poet" import: the
// Code sections composed here must share ONE ts-poet instance with the render*
// primitives below, or (with a globally-installed / linked CLI, where the project and
// the CLI resolve ts-poet to different physical copies) every section renders
// standalone with its own duplicate import header.
import { joinCode, type Code, effectivePackage } from "@metaobjectsdev/codegen-ts";
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
  isWriteThrough,
  isAbstract,
  hasWritableRdbSource,
  isTphSubtype,
  // engine composer — used for the delegated write-through variant:
  renderEntityFile,
  // engine plumbing:
  formatTs,
  ownedRuntimeImport,
  entityOutputPath,
  namesRef,
  namesConstArg,
  GENERATED_HEADER,
  GENERATED_EDIT_NOTE,
  sidecarLine,
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
    // §A6/§B2 — same `namesRef` pair renderDrizzleSchema builds, so the projection's view
    // name + per-field dbCol reference the exact constant the names artifact exports
    // (undefined when the artifact is not in this run). `namesRef`'s `{ resolved, symbol }`
    // return is exactly the shape `ProjectionDeclOpts.names` wants.
    return renderProjectionDecl(entity, ctx.loadedRoot, {
      columnNamingStrategy: ctx.columnNamingStrategy,
      dialect: ctx.dialect,
      apiPrefix: ctx.apiPrefix,
      timestampMode: ctx.timestampMode,
      allowlists,
      ctx,
      includeViewDecl: runtime,
      names: namesRef(entity, ctx),
    });
  }
  // Value-only / contract target → interface + Zod, no Drizzle table.
  //
  // A TPH subtype (FR-017) routes here too. It INHERITS the discriminator base's writable
  // source.rdb through `extends`, so `hasWritableRdbSource` is true for it under the
  // ADR-0039 resolving read — but the base owns the single shared table. Without the
  // isTphSubtype clause this template fell through to the vanilla path and emitted a
  // SECOND Drizzle table bound to the base's physical name, carrying only the subtype's
  // own columns.
  if (!runtime || !hasWritableRdbSource(entity) || isTphSubtype(entity)) {
    return renderValueObjectFile(entity, ctx.apiPrefix, ctx);
  }
  // #214 — a write-through entity read-view (writable table + a read-only replica view +
  // derived origin.* fields) needs the hybrid file (table + `.existing()` view decl + a
  // z.infer read type carrying the derived fields). Delegate to the engine composer rather
  // than duplicate that branch here (mirrors the projection delegation above).
  if (isWriteThrough(entity)) {
    return renderEntityFile(entity, ctx, { allowlists });
  }

  // Vanilla entity → the full Drizzle table file. Reorder/drop sections freely.
  const enumAliases = renderEnumTypeAliases(entity, ctx);
  const tphBlock = renderTphDiscriminatorUnion(entity, ctx.loadedRoot);
  const tphBase = tphBlock !== null && isTphDiscriminatorBase(entity, ctx.loadedRoot);
  // §A6/§B2 — same `namesRef` pair renderDrizzleSchema (and the projection branch above)
  // build, so the descriptor's $table references the exact constant the names artifact
  // exports (undefined when the artifact is not in this run).
  const constantsNames = namesRef(entity, ctx);
  const sections: Code[] = [
    renderDrizzleSchema(entity, ctx),
    renderInferredTypes(entity, tphBase, ctx),
    ...(enumAliases !== null ? [enumAliases] : []),
    renderZodValidators(entity, ctx),
    renderEntityConstants(entity, ctx.apiPrefix, namesConstArg(constantsNames)),
    ...(allowlists ? [renderFilterAllowlist(entity, undefined, ctx), renderSortAllowlist(entity, undefined, ctx)] : []),
    renderFilterType(entity),
    ...(tphBlock !== null ? [tphBlock] : []),
  ];

  const body = joinCode(sections, { on: "\n" }).toString();
  const header =
    `// ${GENERATED_HEADER} — ${GENERATED_EDIT_NOTE}\n` +
    `// Source metadata: ${entity.name} (${entity.fqn()})\n${sidecarLine(`${entity.name}.extra.ts`)}`;
  return header + body;
}

export interface EntityFileOpts {
  filter?: (entity: MetaObject) => boolean;
  target?: string;
  allowlists?: boolean;
  /**
   * Where the emitted allowlist TYPES are imported from. Absent: the copy `meta eject
   * entity` placed in `codegen/runtime/`, by a path computed from the target's output
   * directory. A relative value is relative to the output root (like `dbImport`);
   * `"@metaobjectsdev/runtime-ts"` imports the package instead.
   */
  runtimeImport?: string;
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
    const renderContext: RenderContext = {
      ...ctx.renderContext,
      httpRuntimeImport: opts?.runtimeImport
        ?? ownedRuntimeImport(ctx.projectRoot ?? ".", ctx.renderContext.selfTarget.outDir),
    };
    return {
      path: entityOutputPath(ctx.config.outputLayout ?? "flat", effectivePackage(entity), `${entity.name}.ts`),
      content: await formatTs(renderEntity(entity, renderContext, { allowlists })),
    };
  });

  const generator: Generator = {
    name: "entity-file",
    emitsEntityModule: true,
    generate: async (ctx: GenContext): Promise<EmittedFile[]> => {
      const files = await perEntityEmit(ctx);
      // FR-019: emit the shared-enums module once per run (null → no file).
      // FR-023 §11.1 item 2: this is a REFERENCE TEMPLATE `meta init` copies into
      // every scaffolded project's codegen/generators/ (ADR-0034) — the DEFAULT
      // path, not an opt-in one. `select` (never `ctx.matches`, which never runs
      // for a whole-root render like this one) excludes an enum used only by an
      // imported, out-of-scope entity; without it every `meta init` project would
      // silently emit shared enums the library path correctly excludes.
      const sharedEnums = renderSharedEnumsFile(
        ctx.loadedRoot,
        ctx.select !== undefined ? { select: ctx.select } : undefined,
      );
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
