// Shared Drizzle `.existing()` view declaration builder.
//
// A view-backed read model — a projection (read-only, view-only) OR the replica
// view of a write-through entity (FR-024 §7, #214) — declares its physical SQL
// view to Drizzle via `<viewVar> = pgView/sqliteView(<name>, { …cols }).existing()`
// so `db.select().from(<viewVar>)` is typed and `.existing()` tells Drizzle not to
// attempt DDL (the SQL view is created/owned by migrate-ts). Both hosts emit the
// SAME declaration shape, so it lives here once (extracted from projection-decl).

import { code, imp, joinCode, type Code } from "@metaobjectsdev/codegen-ts/engine";
import { dialectModule } from "@metaobjectsdev/codegen-ts/engine";
import type { Dialect } from "@metaobjectsdev/codegen-ts/engine";
import {
  type MetaField, FIELD_SUBTYPE_OBJECT, FIELD_ATTR_OBJECT_REF,
} from "@metaobjectsdev/metadata";
import type { ColumnNamingStrategy } from "@metaobjectsdev/codegen-ts/engine";
import { mapColumnType, type EnumIntCustomType } from "@metaobjectsdev/codegen-ts/engine";
import { renderEnumIntCustomType } from "./enum-int-codec.js";
import { zodTypeFor } from "./field-meta.js";
import { columnExpr, type ObjectNames } from "@metaobjectsdev/codegen-ts/engine";

export interface ViewDeclOpts {
  readonly dialect: Dialect;
  readonly columnNamingStrategy: ColumnNamingStrategy;
  /** Drives the timestamp column TS type (Date vs string) in the view declaration. */
  readonly timestampMode: "date" | "string";
  /**
   * Int-backed-enum codec const names ALREADY declared in the module this view lands in.
   * A write-through entity's table and its replica view share one file, and both reference
   * the same codecs — so the view references these by name and declares only what the table
   * did not (a derived field's codec, which the write table omits). Absent = the view owns
   * every codec it needs, which is the projection case.
   */
  readonly declaredEnumIntCodecs?: ReadonlySet<string>;
  /**
   * ADR-0044/#228 — resolve a `field.object` / `field.map`'s `@objectRef` to the
   * value object's EMITTED name (bare when unique in the run, package-qualified on
   * a cross-package short-name collision) AND its import module, TOGETHER, so the
   * imported symbol and its module can never diverge (a bare `Note` symbol pointing
   * at an `./AcmeAlphaNote.js` module, or vice-versa). Callers build this from
   * `RenderContext.resolveValueObjectName` + `valueObjectModuleSpecifier`.
   */
  readonly voRef: (field: MetaField) => { name: string; module: string };
  /**
   * Field names of the owning object's PRIMARY identity (see
   * `primaryIdentityFieldNames` in zod-validators). A PK column sits on the FROM
   * side of every synthesized view, so it is never NULL even when the field
   * carries no `@required` — the view column gets `.notNull()` and the read
   * schema stays non-nullable, matching the generated api-docs, queries and
   * UpdateSchema, all of which already treat the PK as non-null.
   */
  readonly pkFieldNames: ReadonlySet<string>;
  /**
   * §A6 — the resolved names artifact supplying this declaration's COLUMN constants,
   * plus the ts-poet symbol reference (`imp()`'d import of `<Object>Names`), when the
   * names generator is in the run. Absent ⇒ every column stays a literal.
   *
   * Deliberately says nothing about the view's OWN physical name: the two answers come
   * apart on a write-through entity, whose artifact holds the TABLE's name (its primary
   * source) while this declaration binds the REPLICA view. Conflating them cost the
   * write-through read model its column constants — it had to omit `names` entirely to
   * stop the artifact's view name being emitted, and lost every
   * `.fields.<f>.column` reference with it. The view's name is now the caller's to pass
   * (see the `viewName` parameter), which is the only place that knows.
   */
  readonly names?: { readonly resolved: ObjectNames; readonly symbol: Code } | undefined;
  /**
   * The view's `@schema` — a bare name, or an EXPRESSION for it (a names constant).
   *
   * Passed in rather than derived from `names`, and for the same reason `viewName` is: a
   * write-through entity's REPLICA view is a different source node from the one
   * `<Entity>Names` resolves, so the artifact's `schema` there is the WRITE TABLE's and
   * would be a confidently wrong answer. A caller whose artifact genuinely names this view
   * passes the constant expression; the replica-view caller passes its own literal, which
   * is consistent with that view's NAME already being a known literal for the same reason.
   */
  readonly schema?: string | Code | undefined;
}

/**
 * The typed view column map for a Drizzle `.existing()` declaration — keyed by
 * field name, valued by the column builder for the (renamed) physical view column,
 * so `db.select().from(<view>)` is typed. Honors `@dbColumnType`; `.existing()`
 * views carry type + physical name only (no PK/default/notNull DDL modifiers).
 */
function viewColumnLine(
  f: MetaField,
  opts: ViewDeclOpts,
  /** Codecs this view needs, collected for the caller to DECLARE — see below. */
  enumIntTypes: Map<string, EnumIntCustomType>,
): Code {
  const { dialect, columnNamingStrategy, timestampMode } = opts;
  const spec = mapColumnType(f, dialect, columnNamingStrategy, timestampMode);
  // An int-backed field.enum's column function is a LOCAL generated const (the
  // customType helper the caller emits into this same file), so it must not be
  // imported from drizzle-orm/*-core like a built-in column type would be. Same
  // rule the table template applies in `renderColumn`; a view reads the very same
  // integer column and needs the very same decode on the way out.
  if (spec.enumIntCustomType !== undefined) {
    enumIntTypes.set(spec.enumIntCustomType.fnConstName, spec.enumIntCustomType);
  }
  const colSym =
    spec.enumIntCustomType !== undefined
      ? spec.enumIntCustomType.fnConstName
      : imp(`${spec.fnName}@${spec.importModule}`);
  const optsArg =
    spec.fnOptions && Object.keys(spec.fnOptions).length > 0
      ? `, ${JSON.stringify(spec.fnOptions)}`
      : "";
  // #204 — of the table modifiers, only `.array()` (postgres native array element
  // typing) and `.notNull()` (shapes the SELECT type) carry to an existing view;
  // `.primaryKey()`/`.default()`/`.references()`/`.unique()` are table-DDL concerns
  // and invalid on a `.existing()` view declaration. Preserve the canonical order.
  // A primary-identity column additionally gains `.notNull()`: on the table side
  // its non-null comes from `.primaryKey()` (which the view cannot carry), so
  // without this the view SELECT type — and the Zod read schema derived from it —
  // typed the PK `T | null` for a column that can never be NULL.
  const kept = spec.modifiers.filter((m) => m === ".array()" || m === ".notNull()");
  if (opts.pkFieldNames.has(f.name) && !kept.includes(".notNull()")) kept.push(".notNull()");
  const viewModifiers = kept.join("");
  // Narrow the column to its resolved element/value type — `.$type<…>()` — mirroring
  // the entity column so the read row is typed (not `unknown`) and an array column
  // reads as `T[]`, not `T`.
  let dollarType: Code | string = "";
  const dtr = spec.dollarTypeRef;
  if (dtr?.kind === "scalar") {
    dollarType = `.$type<${dtr.tsType}${dtr.array ? "[]" : ""}>()`;
  } else if (dtr?.kind === "objectRef") {
    // #228 — emitted name + module resolved together (lock-step) from the field's ref.
    const vo = opts.voRef(f);
    const voTypeSym = imp(`t:${vo.name}@${vo.module}`);
    dollarType = dtr.array ? code`.$type<${voTypeSym}[]>()` : code`.$type<${voTypeSym}>()`;
  } else if (dtr?.kind === "map") {
    if ("scalar" in dtr.value) {
      dollarType = `.$type<Record<string, ${dtr.value.scalar}>>()`;
    } else {
      const vo = opts.voRef(f);
      dollarType = code`.$type<Record<string, ${imp(`t:${vo.name}@${vo.module}`)}>>()`;
    }
  }
  // A6 — reference the constant whenever the artifact is in the run AND carries this
  // field. A lookup MISS is normal, not a divergence — see ViewDeclOpts.names.
  const dbNameExpr = columnExpr(opts.names, f.name, spec.dbName);
  return code`  ${f.name}: ${colSym}(${dbNameExpr}${optsArg})${dollarType}${viewModifiers}`;
}

/**
 * Emit `export const <viewVar> = <viewFn>(<viewName>, { …cols }).existing();` for a
 * view-backed read model (projection or write-through replica view). `fields` are the
 * view's exposed columns (already resolved to effective fields by the caller).
 */
export function renderExistingViewDecl(
  fields: readonly MetaField[],
  /**
   * The view's own physical name: a plain string is emitted as a literal, a `Code` is
   * emitted verbatim (a caller whose names artifact genuinely names THIS view passes
   * `physicalNameExpr(names, viewName)`). See `ViewDeclOpts.names` for why this is not
   * derived from that artifact here.
   */
  viewName: string | Code,
  viewVar: string,
  opts: ViewDeclOpts,
): Code {
  const { viewFn, core: viewModule } = dialectModule(opts.dialect);
  const viewSym = imp(`${viewFn}@${viewModule}`);
  const enumIntTypes = new Map<string, EnumIntCustomType>();
  const viewColumnLines = fields.map((f) => viewColumnLine(f, opts, enumIntTypes));
  const viewNameExpr = typeof viewName === "string" ? code`${JSON.stringify(viewName)}` : viewName;

  // @schema — a view lands in a schema exactly as a table does, and migrate qualifies the
  // `CREATE VIEW` it emits. Fixing the table binding and leaving this one would be the more
  // dangerous half-job: the two would then disagree with each OTHER as well as with the
  // database. Drizzle spells it with the same shape as the table case, `pgSchema(s).view(...)`
  // — PgSchema carries `view` alongside `table`. sqlite is excluded for the same reason as
  // there: no schema concept, and migrate refuses a non-default @schema on that dialect.
  const viewSchemaExpr: Code | undefined =
    opts.dialect === "sqlite" || opts.schema === undefined ? undefined
    : typeof opts.schema === "string" ? code`${JSON.stringify(opts.schema)}`
    : opts.schema;
  const viewCall: Code = viewSchemaExpr === undefined
    ? code`${viewSym}`
    : code`${imp(`${opts.dialect === "mysql" ? "mysqlSchema" : "pgSchema"}@${viewModule}`)}(${viewSchemaExpr}).view`;
  // Int-backed enum codecs are declared BEFORE the view that references them, sorted
  // by const name so output is deterministic regardless of field order — the same
  // contract the table template holds.
  const alreadyDeclared = opts.declaredEnumIntCodecs;
  const enumIntBlocks = [...enumIntTypes.values()]
    .filter((t) => alreadyDeclared === undefined || !alreadyDeclared.has(t.fnConstName))
    .sort((a, b) => a.fnConstName.localeCompare(b.fnConstName))
    .map((t) => renderEnumIntCustomType(t, viewModule));

  const viewBlock = code`
// View declaration — Drizzle uses this for typed SELECT queries.
// The SQL view is created/managed by migrate-ts; .existing() tells Drizzle
// not to attempt DDL for this declaration.
export const ${viewVar} = ${viewCall}(${viewNameExpr}, {
${joinCode(viewColumnLines, { on: ",\n" })}
}).existing();
`;
  return enumIntBlocks.length === 0
    ? viewBlock
    : joinCode([...enumIntBlocks, viewBlock], { on: "\n" });
}

/**
 * The Zod object body for a view-backed read model — one `field: z.<type>[.nullable()]`
 * line per column, the read counterpart of {@link renderExistingViewDecl}. A column that
 * is not `.notNull()` in the view is `.nullable()` (Drizzle's SELECT infers `T | null`),
 * so `z.infer<>` of the object equals the view row type. This is the dialect-agnostic read
 * type (a Drizzle view exposes `$inferSelect` on Postgres but not SQLite). A `field.object`
 * passthrough carries the value-object's schema so the read type exposes the VO shape.
 * `voModule` resolves a value-object short name → its import module.
 */
export function renderViewReadZodObject(fields: readonly MetaField[], opts: ViewDeclOpts): Code {
  const { dialect, columnNamingStrategy, timestampMode } = opts;
  const z = imp("z@zod");
  const lines: Code[] = fields.map((f) => {
    // Non-null when the column is `.notNull()` OR it is a primary-identity
    // field — a PK is never NULL, but its table-side non-null is expressed via
    // `.primaryKey()`, not a `.notNull()` modifier (see viewColumnLine above).
    const nonNull =
      mapColumnType(f, dialect, columnNamingStrategy, timestampMode).modifiers.includes(".notNull()") ||
      opts.pkFieldNames.has(f.name);
    const nullable = nonNull ? "" : ".nullable()";
    const hasObjectRef =
      f.subType === FIELD_SUBTYPE_OBJECT &&
      typeof f.attr(FIELD_ATTR_OBJECT_REF) === "string" &&
      (f.attr(FIELD_ATTR_OBJECT_REF) as string).length > 0;
    if (hasObjectRef) {
      // #228 — the <Ref>InsertSchema symbol + its module resolved together from the
      // field's ref, so a cross-package collision qualifies both consistently.
      const vo = opts.voRef(f);
      const schemaSym = imp(`${vo.name}InsertSchema@${vo.module}`);
      const base = f.resolvedIsArray() ? code`${z}.array(${schemaSym})` : code`${schemaSym}`;
      return code`  ${f.name}: ${base}${nullable}`;
    }
    // #204 — an array passthrough reads as `T[]`; zodTypeFor returns the ELEMENT type.
    // CRITICAL 3: thread timestampMode through so a FIELD_SUBTYPE_TIMESTAMP column
    // agrees with the Drizzle view column's mode (both sourced from `opts` above).
    const inner = code`${z}.${zodTypeFor(f, timestampMode).replace(/^z\./, "")}`;
    const zbase = f.resolvedIsArray() ? code`${z}.array(${inner})` : inner;
    return code`  ${f.name}: ${zbase}${nullable}`;
  });
  return code`${z}.object({
${joinCode(lines, { on: ",\n" })}
})`;
}
