// REFERENCE TEMPLATE — copy this into your repo (e.g. codegen/generators/routes.ts) and own it.
// Then import it LOCALLY in metaobjects.config.ts:
//   import { routesFile } from "./codegen/generators/routes";
//
// use-when:      you want generated Fastify REST routes per entity. Drop it and hand-write routes
//                if you need bespoke endpoints — or keep it and add handlers via <Entity>.extra.ts.
// emits:         <target>/<Entity>.routes.ts — full CRUD for write-through entities, read-only
//                (GET list + GET :id) for projections, polymorphic + per-subtype for TPH bases.
// customize:     this generator (filter, output path, per-entity @emitRoutes opt-out, target) is
//                YOURS — edit it freely. The route *composition* itself is richer than the others
//                (M:N junction traversal, TPH per-subtype route sets), so it stays in the engine via
//                `renderRoutesFile`. To own the composition too, copy `renderRoutesFile`'s body out
//                of the package source — it dispatches projection → mountReadOnlyCrudRoutes,
//                write-through → mountCrudRoutes (+ M:N mounts). For per-verb control, import the
//                mount* helpers from `@metaobjectsdev/runtime-ts/drizzle-fastify` and mix with your
//                own handlers (auth, side effects).
// composes-with: entity.ts (imports the table/schemas/allowlists), queries.ts.

import { OBJECT_SUBTYPE_VALUE, type MetaObject } from "@metaobjectsdev/metadata";
import {
  perEntity,
  type Generator,
  type GeneratorFactory,
  renderRoutesFile,
  isTphSubtype,
  formatTs,
  entityOutputPath,
  CODEGEN_ATTR_EMIT_ROUTES,
} from "@metaobjectsdev/codegen-ts";

export interface RoutesFileOpts {
  filter?: (entity: MetaObject) => boolean;
  target?: string;
}

// value objects have no source.rdb / identity — mounting CRUD routes over one would
// import a Drizzle table + Update/Filter/Sort schemas the entity module never emits
// (renderValueObjectFile only emits the interface + Insert schema). Skip them here,
// mirroring queries.ts's skipNonQueryable — the reference template omitted this check.
const skipValueObjects = (e: MetaObject): boolean => e.subType !== OBJECT_SUBTYPE_VALUE;

export const routesFile = function routesFile(opts?: RoutesFileOpts): Generator {
  const userFilter = opts?.filter ?? (() => true);
  const generator: Generator = {
    name: "routes-file",
    // per-entity opt-out via `@emitRoutes: false`; TPH subtypes get no standalone routes
    // file (their routes live in the discriminator base's); value objects are never
    // routable; AND-composed with your filter.
    filter: (e: MetaObject) =>
      // ADR-0039: resolving — a concrete entity may inherit its @emit* opt-out flag via extends.
      e.attr(CODEGEN_ATTR_EMIT_ROUTES) !== false &&
      !isTphSubtype(e) &&
      skipValueObjects(e) &&
      userFilter(e),
    generate: perEntity(async (entity, ctx) => {
      if (!ctx.renderContext) {
        throw new Error("routes-file: renderContext is required (provided by runGen)");
      }
      return {
        path: entityOutputPath(ctx.config.outputLayout ?? "flat", entity.package, `${entity.name}.routes.ts`),
        content: await formatTs(renderRoutesFile(entity, ctx.renderContext)),
      };
    }),
  };
  if (opts?.target) {
    generator.target = opts.target;
  }
  return generator;
} as GeneratorFactory<RoutesFileOpts>;
