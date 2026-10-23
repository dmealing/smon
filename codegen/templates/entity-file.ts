// Entity file composer — combines drizzle-schema, inferred-types, and zod-validators
// into one file with the @generated header. ts-poet deduplicates imports.
//
// Dispatch:
//   isProjection(entity)               → renderProjectionDecl (read-only: view declaration + Zod + filter sections)
//   !hasWritableRdbSource(entity)      → renderValueObjectFile (in-memory / transit shape: interface + Zod schema)
//   vanilla / write-through entity     → Drizzle table path

import { code, imp, joinCode, type Code } from "@metaobjectsdev/codegen-ts/engine";
import type { MetaObject, MetaField } from "@metaobjectsdev/metadata";
import { SOURCE_ROLE_REPLICA } from "@metaobjectsdev/metadata";
import type { RenderContext } from "@metaobjectsdev/codegen-ts/engine";
import { renderDrizzleSchema } from "./drizzle-schema.js";
import { renderInferredTypes, renderEnumTypeAliases } from "./inferred-types.js";
import { renderZodValidators, primaryIdentityFieldNames } from "./zod-validators.js";
import { isTphSubtype } from "@metaobjectsdev/codegen-ts/engine";
import { renderEntityConstants } from "./entity-constants.js";
import { renderFilterAllowlist, renderSortAllowlist } from "./filter-allowlist.js";
import { renderFilterType } from "./filter-type.js";
import { renderTphDiscriminatorUnion, isTphDiscriminatorBase } from "./tph-discriminator.js";
import { GENERATED_HEADER, GENERATED_EDIT_NOTE, sidecarLine } from "@metaobjectsdev/codegen-ts/engine";
import { isProjection, isWriteThrough } from "@metaobjectsdev/codegen-ts/engine";
import { renderProjectionDecl } from "./projection-decl.js";
import {
  projectionViewName, projectionViewSchema, projectionViewRole,
} from "@metaobjectsdev/codegen-ts/engine";
import { renderExistingViewDecl, renderViewReadZodObject } from "./view-decl.js";
import { renderDocsFor } from "./jsdoc.js";
import { valueObjectModuleSpecifier } from "@metaobjectsdev/codegen-ts/engine";
import { namesRef, namesConstArg, physicalNameExpr, sourceSchemaExpr } from "@metaobjectsdev/codegen-ts/engine";
import { hasWritableRdbSource } from "@metaobjectsdev/codegen-ts/engine";
import { renderValueObjectFile } from "./value-object-file.js";
import { isAbstract } from "@metaobjectsdev/codegen-ts/engine";
import { effectivePackage } from "@metaobjectsdev/codegen-ts/engine";

/**
 * Render-time options for the entity-file composer.
 *
 * `allowlists` (default `true`) controls whether the Fastify-flavored
 * `<Entity>FilterAllowlist` + `<Entity>SortAllowlist` blocks (plus their
 * `runtime-ts/drizzle-fastify` type-only imports) are emitted. Workers/Lambda
 * consumers that don't mount Fastify-style server routes can pass `false` and
 * drop `@metaobjectsdev/runtime-ts` from their deps entirely. The client-side
 * `<Entity>Filter` type is always emitted — consumers still want it for typed
 * client calls regardless of how the server is wired.
 *
 * Whether the file emits ANY server runtime binding at all (Drizzle table/view,
 * the allowlists) is governed by the TARGET, not this option: `ctx.selfTarget.runtime`.
 * A contract-only target (`runtime: false`) renders every object as its plain
 * shape (interface + Zod) and every projection as its read schema — no
 * `drizzle-orm`, no `runtime-ts`. `allowlists` is a finer Fastify-vs-Hono opt-out
 * that only matters within a runtime target.
 */
export interface RenderEntityFileOpts {
  readonly allowlists?: boolean;
}

export function renderEntityFile(
  entity: MetaObject,
  ctx: RenderContext,
  opts?: RenderEntityFileOpts,
): string {
  // Contract-only target ⇒ no server runtime: no Drizzle pgView/pgTable, no
  // runtime-ts allowlists. The read schema + inferred types still emit.
  const runtime = ctx.selfTarget.runtime;
  const allowlists = runtime ? (opts?.allowlists ?? true) : false;

  // --- Abstract path (shape only) ---
  // An abstract entity contributes shape via inheritance only — it must NEVER
  // produce a Drizzle table / migration footprint / filter allowlist, even when
  // it carries a source.rdb child. This is the cross-port invariant (abstract →
  // no instance/write artifacts, including CREATE TABLE). It still emits its
  // value-object shape (interface + Zod) so subclasses/consumers can reference
  // it. The entity-file generator suppresses this entirely when
  // emitAbstractShapes is off; here we only guarantee "shape, never table".
  if (isAbstract(entity)) {
    return renderValueObjectFile(entity, ctx.apiPrefix, ctx);
  }

  // --- Projection path (read-only: view-backed entity with no table source) ---
  // Projections intentionally get the z.enum() validator but NOT a named enum
  // type alias — emitting aliases here is a deliberate v1 scope decision.
  if (isProjection(entity)) {
    // §A6/§B2 — same `namesRef` pair drizzle-schema.ts builds, so the projection's view
    // name + per-field dbCol reference the exact constant the names artifact exports
    // (undefined when the artifact is not in this run — see names.ts). `namesRef`'s
    // `{ resolved, symbol }` return is exactly the shape `ProjectionDeclOpts.names` wants.
    return renderProjectionDecl(entity, ctx.loadedRoot, {
      columnNamingStrategy: ctx.columnNamingStrategy,
      dialect: ctx.dialect,
      apiPrefix: ctx.apiPrefix,
      timestampMode: ctx.timestampMode,
      allowlists,
      ctx,
      // Contract target drops the Drizzle .existing() view decl + drizzle-orm import.
      includeViewDecl: runtime,
      names: namesRef(entity, ctx),
    });
  }

  // --- Value-only / contract path (no Drizzle table) ---
  // Reached when the entity has no writable source.rdb (in-memory / transit
  // shape) OR the target is contract-only (a UI/wire package gets the read shape,
  // not a DB table). Either way: interface + Zod, no migration footprint, no
  // drizzle-orm. Consumers validate via the Zod schema and type via the interface.
  //
  // A TPH subtype (FR-017) also routes here: it inherits the base's writable
  // source.rdb via extends (so hasWritableRdbSource is now true under the ADR-0039
  // resolving read), but the base owns the single shared table — the subtype must
  // emit its per-subtype read schema (<Sub>Schema), never its own pgTable.
  if (!runtime || !hasWritableRdbSource(entity) || isTphSubtype(entity)) {
    return renderValueObjectFile(entity, ctx.apiPrefix, ctx);
  }

  // --- Vanilla / write-through entity path ---
  const enumAliases = renderEnumTypeAliases(entity, ctx);
  // FR-017 Tier 1: when this entity carries @discriminator AND has concrete
  // subtypes, append the discriminated-union type alias, type guards, and
  // the parse<Base>(row) dispatcher. Returns null otherwise (no subtypes, or
  // not a discriminator-bearing entity); the section is suppressed cleanly.
  const tphBlock = renderTphDiscriminatorUnion(entity, ctx.loadedRoot);
  // FR-017: when a discriminator base also has a union block, the union owns the
  // bare `<Base>` type — so the inferred Drizzle row type is emitted as
  // `<Base>Row` to avoid a duplicate `export type <Base>`.
  const tphBase = tphBlock !== null && isTphDiscriminatorBase(entity, ctx.loadedRoot);

  // #214 — a write-through entity read-view (FR-024 §7): reads route to the replica
  // VIEW, so the entity file additionally declares the `.existing()` view (carrying the
  // derived fields the write table omits, #213) and a read schema `<Entity>Schema`
  // whose `z.infer` IS the read type <Entity> (dialect-agnostic — a Drizzle view is not
  // a Table, so InferSelectModel/`$inferSelect` don't uniformly apply; the Zod schema's
  // nullability mirrors the view columns exactly like a projection). The write table +
  // Insert/Update stay derived-free. `.existing()` is a runtime-target Drizzle binding,
  // and this path only runs in a runtime target (contract-only/non-writable returned above).
  // A TPH discriminator base owns `export type <Base>` via its discriminated-union block,
  // so it must NOT also emit the view-schema read type (that would be a duplicate-identifier
  // compile error). A base+write-through combo keeps the TPH polymorphic read path (reads
  // the base table); routing its reads through a replica view is a documented non-goal.
  const writeThrough = isWriteThrough(entity) && !tphBase;
  // Rendered BEFORE the replica view below, for two reasons that both matter: the table
  // DECLARES the int-backed-enum codecs (a `const` the view's declaration would duplicate,
  // and a duplicate module-scope const is a parse error), and those consts must precede the
  // view's use of them in the emitted file or the view hits a TDZ ReferenceError at import.
  const declaredEnumIntCodecs = new Set<string>();
  const schemaBlock = renderDrizzleSchema(entity, ctx, declaredEnumIntCodecs);
  const viewSections: Code[] = [];
  if (writeThrough) {
    const camel = entity.name.charAt(0).toLowerCase() + entity.name.slice(1);
    const fields = entity.fields();
    const entityPkg = effectivePackage(entity);
    // ADR-0044/#228 — resolve a view column's `@objectRef` to the value object's
    // EMITTED name + module TOGETHER (lock-step), so the read-view artifact imports
    // `AcmeAlphaNote` from `./AcmeAlphaNote.js` (not a bare `Note` → `./Note.js`)
    // under a cross-package short-name collision.
    const voRef = (field: MetaField): { name: string; module: string } => {
      const name = ctx.resolveValueObjectName(field);
      const module = valueObjectModuleSpecifier(name, ctx.packageOf, entityPkg, ctx.outputLayout, ctx.extStyle);
      return { name, module };
    };
    // ONE selection of the replica source: `projectionViewName` names it, and this is the
    // role its entry has in <Entity>Names.sources. Hardcoding "replica" here would be a
    // second derivation of the very thing extract-view-spec.ts exists to decide once.
    const viewRole = projectionViewRole(entity) ?? SOURCE_ROLE_REPLICA;
    const entityNames = namesRef(entity, ctx);
    const viewOpts = {
      dialect: ctx.dialect, columnNamingStrategy: ctx.columnNamingStrategy, timestampMode: ctx.timestampMode, voRef,
      // PK fields type non-null in the replica-view decl + read schema even
      // without @required (a PK is never NULL; see ViewDeclOpts.pkFieldNames).
      pkFieldNames: new Set(primaryIdentityFieldNames(entity)) as ReadonlySet<string>,
      // §A6 — the entity's names artifact supplies this view's COLUMN constants. A
      // replica view exposes the entity's own fields, so `<Entity>Names.fields.<f>.column`
      // is the same physical name the table side binds; a derived field the artifact
      // does not carry falls back to the literal via `columnExpr`. The view's own NAME
      // is passed separately below and stays a literal — the artifact holds the primary
      // (table) source's name, not this one.
      names: entityNames,
      // The table above already declared these; the view references them by name.
      declaredEnumIntCodecs,
      // The replica view's OWN @schema, from the same source node projectionViewName picks
      // — never the entity's, which is the WRITE TABLE's and would qualify this view with a
      // schema that belongs to something else. A view and the table it replicates need not
      // live in the same schema, and a name paired with someone else's schema is worse than
      // no schema at all.
      //
      // Both this and the view's NAME are now CONSTANTS. They were literals for a real
      // reason that has stopped being true: <Entity>Names carried the primary source only,
      // so a write-through entity's two physical names had one slot between them and the
      // second was emitted in full — the same escape C#'s AppDbContext had, in a different
      // language, which is what showed it was the artifact's shape and not the binding.
      schema: sourceSchemaExpr(entityNames, viewRole) ?? projectionViewSchema(entity),
    };
    const z = imp("z@zod");
    const docs = renderDocsFor(entity);
    const docsPrefix = docs ? `${docs}\n` : "";
    viewSections.push(
      renderExistingViewDecl(
        fields,
        physicalNameExpr(entityNames, projectionViewName(entity, ctx.columnNamingStrategy), entity, viewRole),
        `${camel}View`,
        viewOpts,
      ),
      code`
export const ${entity.name}Schema = ${renderViewReadZodObject(fields, viewOpts)};
`,
      code`
${docsPrefix}export type ${entity.name} = ${z}.infer<typeof ${entity.name}Schema>;
`,
    );
  }

  // §A6/§B2 — same `namesRef` pair drizzle-schema.ts (and this file's own projection
  // branch above) build, so the descriptor's $table references the exact constant the
  // names artifact exports (undefined when the artifact is not in this run).
  const constantsNames = namesRef(entity, ctx);

  const sections: Code[] = [
    schemaBlock,
    ...viewSections,
    renderInferredTypes(entity, tphBase, ctx, writeThrough /* skipRow — read type is the view schema */),
    ...(enumAliases !== null ? [enumAliases] : []),
    renderZodValidators(entity, ctx),
    renderEntityConstants(entity, ctx.apiPrefix, namesConstArg(constantsNames)),
    ...(allowlists ? [renderFilterAllowlist(entity, undefined, ctx), renderSortAllowlist(entity, undefined, ctx)] : []),
    renderFilterType(entity),
    ...(tphBlock !== null ? [tphBlock] : []),
  ];

  // Render ts-poet body first (ts-poet hoists imp()-tracked imports to the top),
  // then prepend the @generated header so it lands at line 1 — convention for
  // generated files and what most tooling (overwrite-policy, IDEs) expects.
  const body = joinCode(sections, { on: "\n" }).toString();
  const header =
    `// ${GENERATED_HEADER} — ${GENERATED_EDIT_NOTE}\n` +
    `// Source metadata: ${entity.name} (${entity.fqn()})\n` +
    sidecarLine(`${entity.name}.extra.ts`);
  return header + body;
}
