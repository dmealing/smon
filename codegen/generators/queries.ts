// REFERENCE TEMPLATE — copy this into your repo (e.g. codegen/generators/queries.ts) and own it.
// Then import it LOCALLY in metaobjects.config.ts:
//   import { queriesFile } from "./codegen/generators/queries";
//
// use-when:      you want generated typed CRUD finders (find<E>ById, list<E>s, create/update/delete)
//                over Drizzle. Drop it if you hand-write your data access.
// emits:         <target>/<Entity>.queries.ts per write-through entity.
// customize:     the vanilla CRUD assembly below is OWNED — reorder, drop verbs (e.g. no delete),
//                change the Db type alias, add your own finders. The render<Verb>Fn primitives emit
//                each block; call your own instead to change a verb's body.
// composes-with: entity.ts (imports the table + InsertSchema it emits).
//
// NOTE: the advanced TPH-base + projection variants delegate to the engine's composer
// (`renderQueriesFile`) — they're rarely customized. To own those too, copy their branches
// out of the package source. The vanilla path here is byte-identical to the built-in.

import { code, joinCode, type Code } from "ts-poet";
import { OBJECT_SUBTYPE_VALUE, type MetaObject } from "@metaobjectsdev/metadata";
import {
  perEntity,
  type Generator,
  type GeneratorFactory,
  type RenderContext,
  entityModuleSpecifier,
  renderFindByIdFn,
  renderListFn,
  renderCreateFn,
  renderUpdateFn,
  renderDeleteByIdFn,
  renderReverseFinderFns,
  reverseFksFor,
  isTphDiscriminatorBase,
  isProjection,
  isTphSubtype,
  renderQueriesFile, // engine composer — used for the delegated variants
  formatTs,
  entityOutputPath,
  GENERATED_HEADER,
} from "@metaobjectsdev/codegen-ts";

// --- composition (OWNED for the common case) ---
function renderQueries(obj: MetaObject, ctx: RenderContext): string {
  // Advanced variants delegate to the engine (byte-identical). Own them by copying their source.
  if (isTphDiscriminatorBase(obj, ctx.loadedRoot) || isProjection(obj)) {
    return renderQueriesFile(obj, ctx);
  }

  const entityName = obj.name;
  const entityFileName = entityModuleSpecifier(
    ctx.selfTarget,
    ctx.entityModuleTarget,
    obj.package,
    entityName,
    ctx.extStyle,
  );
  const varName = ctx.collectionName(entityName);

  // `db` is parameter-passed into every finder (ADR-0008). Emit the dialect-correct
  // Drizzle type alias so signatures typecheck without the consumer constructing one.
  const dbTypeImport =
    ctx.dialect === "postgres"
      ? `import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";`
      : `import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";`;
  const dbTypeAlias =
    ctx.dialect === "postgres"
      ? `type Db = PgDatabase<PgQueryResultHKT, Record<string, never>>;`
      : `type Db = BaseSQLiteDatabase<"sync" | "async", unknown>;`;

  const literalImports = code`
${dbTypeImport}
${dbTypeAlias}

import { ${varName}, type ${entityName}, ${entityName}InsertSchema } from ${JSON.stringify(entityFileName)};
`;

  const sections: Code[] = [
    literalImports,
    renderFindByIdFn(obj, ctx),
    renderListFn(obj, ctx),
    renderCreateFn(obj, ctx),
    renderUpdateFn(obj, ctx),
    renderDeleteByIdFn(obj, ctx),
  ];

  // ADR-0038 — reverse-relationship navigation as explicit FK finders. One
  // find<Plural>By<FkField> (+ batched …In) per FK this entity holds. OWNED:
  // drop this loop if you don't want reverse finders.
  for (const fk of reverseFksFor(obj)) {
    sections.push(renderReverseFinderFns(obj, fk, ctx));
  }

  const body = joinCode(sections, { on: "\n" }).toString();
  const header =
    `// ${GENERATED_HEADER} — DO NOT EDIT.\n` +
    `// Source metadata: ${entityName} (${obj.fqn()})\n` +
    `// Customize via ${entityName}.extra.ts in this directory (additional queries, custom logic).\n`;
  return header + body;
}

export interface QueriesFileOpts {
  filter?: (entity: MetaObject) => boolean;
  target?: string;
}

// value objects have no identity (findById/updateById would target a non-existent column),
// and TPH subtypes emit no standalone queries file — both are skipped unconditionally.
const skipNonQueryable = (e: MetaObject): boolean =>
  e.subType !== OBJECT_SUBTYPE_VALUE && !isTphSubtype(e);

export const queriesFile = function queriesFile(opts?: QueriesFileOpts): Generator {
  const userFilter = opts?.filter;
  const filter: (e: MetaObject) => boolean = userFilter
    ? (e) => skipNonQueryable(e) && userFilter(e)
    : skipNonQueryable;

  const generator: Generator = {
    name: "queries-file",
    filter,
    generate: perEntity(async (entity, ctx) => {
      if (!ctx.renderContext) {
        throw new Error("queries-file: renderContext is required (provided by runGen)");
      }
      return {
        path: entityOutputPath(ctx.config.outputLayout ?? "flat", entity.package, `${entity.name}.queries.ts`),
        content: await formatTs(renderQueries(entity, ctx.renderContext)),
      };
    }),
  };
  if (opts?.target) {
    generator.target = opts.target;
  }
  return generator;
} as GeneratorFactory<QueriesFileOpts>;
