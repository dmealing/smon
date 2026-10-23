// Drizzle schema template — emits a single sqliteTable() or pgTable() definition,
// with FK .references() on FK columns derived from relationship children,
// plus the relations() block auto-emitted at the end.

import { code, imp, joinCode, type Code } from "@metaobjectsdev/codegen-ts/engine";
import { MetaObject, MetaField, MetaIndex, isMetaObject } from "@metaobjectsdev/metadata";
import {
  IDENTITY_ATTR_FIELDS, IDENTITY_ATTR_GENERATION,
  IDENTITY_ATTR_EXPR, IDENTITY_ATTR_USING, IDENTITY_ATTR_ORDERS, IDENTITY_ATTR_WHERE,
  GENERATION_INCREMENT, GENERATION_UUID,
  FIELD_ATTR_AUTO_SET,
  FIELD_ATTR_OBJECT_REF,
  FIELD_SUBTYPE_TIMESTAMP,
  FIELD_SUBTYPE_DATE,
  IDENTITY_REFERENCE_ATTR_REFERENCES,
  refTarget,
} from "@metaobjectsdev/metadata";
import type { RenderContext } from "@metaobjectsdev/codegen-ts/engine";
import { crossEntitySpecifier, valueObjectModuleSpecifier } from "@metaobjectsdev/codegen-ts/engine";
import {
  mapColumnType, PG_IDENTITY_CAPABLE_FNS,
  type ColumnSpec, type EnumIntCustomType,
} from "@metaobjectsdev/codegen-ts/engine";
import { tableNameFromEntity } from "@metaobjectsdev/codegen-ts/engine";
import { dialectModule } from "@metaobjectsdev/codegen-ts/engine";
import {
  namesRef, physicalNameExpr, sourceSchemaExpr, indexNameExpr, columnExpr,
} from "@metaobjectsdev/codegen-ts/engine";
import { resolveTableSchema } from "@metaobjectsdev/metadata";
import { renderEnumIntCustomType } from "./enum-int-codec.js";
import { renderRelationsBlock } from "./relations-block.js";
import { renderDocsFor } from "./jsdoc.js";
import { collectTphSubtypeFields, tphConcreteSubtypes } from "./tph-discriminator.js";
import { tphStorageObject } from "@metaobjectsdev/codegen-ts/engine";
import { effectivePackage } from "@metaobjectsdev/codegen-ts/engine";

/**
 * Render the Drizzle table definition for one entity, including:
 * - FK .references() on FK columns derived from relationship children
 * - relations() block at the end of the section
 *
 * Returns a Code object so ts-poet can deduplicate imports when this composes
 * with the rest of the entity file. Biome formatting runs after composition.
 */
export function renderDrizzleSchema(
  obj: MetaObject,
  ctx: RenderContext,
  /**
   * OUT param: the int-backed-enum codec const names this table DECLARES. A caller that
   * emits another artifact referencing the same codecs into the SAME module — entity-file's
   * write-through replica view — passes a set here and hands it to that emitter, which then
   * references the consts instead of re-declaring them. A duplicate module-scope `const` is
   * a JS parse error, so the module would not even load.
   */
  declaredEnumIntCodecs?: Set<string>,
): Code {
  const dialect = ctx.dialect;
  const { tableFn, core: importModule } = dialectModule(dialect);
  const tableFnSym = imp(`${tableFn}@${importModule}`);

  const tableName = obj.dbTable ?? tableNameFromEntity(obj.name, ctx.columnNamingStrategy);
  const varName = ctx.collectionName(obj.name);

  // §A6/§B2 — reference `<Entity>Names` instead of embedding the physical names a SECOND
  // time. `namesRef` is undefined whenever the names generator is not active in this run
  // (opt-in under ADR-0034 scaffold-and-own — an unconditional import would break every
  // project that has not enabled it) or the object has no primary source — both PRESENCE
  // guards. No per-site equality check: whenever the constant exists, it IS the name;
  // `primaryRdbSource` (@metaobjectsdev/metadata) already refuses (throws) any object
  // whose `@role: primary` sources disagree on a name, and BOTH branches reach it — the
  // constant through `resolveObjectNames`, and `obj.dbTable` above on its own — so this
  // file never has to re-check, and the literal arm is refused too rather than silently
  // binding the inherited parent's table when the names generator is out of the run.
  const names = namesRef(obj, ctx);
  const tableNameExpr: Code = physicalNameExpr(names, tableName, obj);

  // @schema — the table binding must land in the SAME schema the migration creates the table
  // in. migrate-ts qualifies every table, view, index and FK it emits (`CREATE TABLE
  // "sales"."widgets"`), and under ADR-0015 it owns where a table lives; codegen dropping the
  // schema meant generated queries hit `public.widgets` while the migration built
  // `sales.widgets`. Whether that surfaced depended entirely on the adopter's `search_path`,
  // which is the worst kind of bug — it works on the machine that has it configured.
  //
  // Drizzle expresses this with a DIFFERENT call shape rather than a third argument:
  // `pgSchema("sales").table(name, …)`. It is built inline rather than hoisted to a `const`
  // so two tables in one file sharing a schema cannot collide on a generated identifier; a
  // schema object is just a descriptor, so a second call costs nothing.
  //
  // sqlite/d1 are excluded because SQLite has no schema concept at all — migrate already
  // REFUSES a non-default @schema there (expected-schema.ts), so there is nothing to honour
  // and no divergence to close.
  const tableSchema = dialect === "sqlite" ? undefined : resolveTableSchema(obj);
  const schemaExpr: Code | undefined =
    tableSchema === undefined ? undefined
    : sourceSchemaExpr(names) ?? code`${JSON.stringify(tableSchema)}`;
  const tableCall: Code = schemaExpr === undefined
    ? code`${tableFnSym}`
    : code`${imp(`${dialect === "mysql" ? "mysqlSchema" : "pgSchema"}@${importModule}`)}(${schemaExpr}).table`;
  // A column's constant, on the same terms — but resolved against the entity that DECLARES
  // the field, which is not always `obj`. Under TPH the fold below emits a subtype's own
  // columns into this base's table, and those columns live in the SUBTYPE's names artifact;
  // looking them up in the base's finds nothing.
  //
  // This used to pass `names` for every column and call the resulting miss "normal". It was
  // not: the base's artifact genuinely does not carry a subtype's column, so every TPH
  // subtype column fell through to the literal while `<Sub>Names.fields.<f>.column` sat
  // right there, already imported by the subtype's own artifact. C# never had the bug
  // because its emitter passes the subtype entity to `ColumnRef`; this is that shape.
  //
  // `fromPackage` stays `obj.package` so the import path is computed relative to the file
  // being emitted (this base's), not to the subtype's own package.
  // THIS entity's artifact first. It already carries every INHERITED field — a concrete
  // entity's artifact spreads its abstract parent's `fields` — so an `extends` chain needs
  // no redirect, and taking one would be a regression: an abstract base has no source, so
  // it has no artifact of its own to redirect TO, and the column would fall back to a
  // literal that `obj`'s artifact was carrying all along.
  //
  // A miss here means the field belongs to a different entity ENTIRELY, which under TPH is
  // exactly the subtype whose columns this base's table absorbs. Only then resolve against
  // the declaring entity, found through the field's own parent link.
  //
  // `isMetaObject`, never `instanceof`: two physical copies of @metaobjectsdev/metadata in
  // one process give the class object and the instance different identities, so the check
  // would return false for a real node — silently.
  // `obj` never changes across this function, so its effective package is computed once
  // and reused everywhere below (the `fromPackage` passed to `namesRef` here, and the
  // per-field `renderColumn` calls in both the own-field and TPH-subtype-fold loops).
  const pkg = effectivePackage(obj);
  const columnNameExpr = (field: MetaField, dbName: string): Code => {
    if (names === undefined || names.resolved.fields[field.name] !== undefined) {
      return columnExpr(names, field.name, dbName);
    }
    const owner = field.parent;
    // `fromPackage` is obj's: the import path is relative to the file being emitted (this
    // base's), not to the subtype's own package.
    const ownerNames =
      owner !== undefined && isMetaObject(owner) && owner !== obj
        ? namesRef(owner, ctx, pkg)
        : undefined;
    return columnExpr(ownerNames, field.name, dbName);
  };

  const primary = obj.primaryIdentity();
  const rawPkFields = primary?.attr(IDENTITY_ATTR_FIELDS);
  const pkFieldsList: string[] = Array.isArray(rawPkFields)
    ? rawPkFields as string[]
    : typeof rawPkFields === "string"
      ? rawPkFields.split(",").map((f) => f.trim()).filter(Boolean)
      : [];
  const pkFieldNames = new Set<string>(pkFieldsList);
  const pkGeneration = primary?.attr(IDENTITY_ATTR_GENERATION) as string | undefined;

  const fkMap = buildFkMapForEntity(obj, ctx);

  const isComposite = pkFieldNames.size > 1;

  // Collect secondary identities and the field names that need .unique() on
  // their column. identity.secondary is ALWAYS unique (no @unique attr) — only
  // An `identity.secondary` reaches the table ONLY as the `uniqueIndex(...)` callback
  // emitted further down — never additionally as `.unique()` on its column.
  //
  // It used to do both for a single-column identity, under a comment describing an
  // either/or ("single-column identities propagate .unique() to the column; multi-column
  // ones emit a callback uniqueIndex() entry instead") that the code did not implement:
  // the callback loop has no column-count condition, so a one-column secondary got a
  // column-level unique AND a table-level unique index. `migrate-ts` emits only the index
  // for that shape — it mirrors a `<table>_<col>_unique` constraint for `@unique` fields
  // and nothing extra for a secondary — so the generated schema declared a constraint the
  // database does not have, and `drizzle-kit push` run against it proposes creating one.
  //
  // `.unique()` still comes from the FIELD's own `@unique`, via the column mapper, which
  // is exactly the arm migrate mirrors.
  const secondaryIdentities = obj.secondaryIdentities();

  const columnLines: Code[] = [];
  // Collect CHECK constraints for enum columns; emitted as table-level check() callbacks.
  const checkConstraints: Array<{ name: Code; expr: Code }> = [];
  /**
   * One CHECK entry, composed against `<Entity>Names` when the artifact is in the run.
   *
   * #293 — migrate's `<table>_<col>_chk` is the shared convention and it is the AUTHORITY:
   * its suffix form is systematic across five constraint kinds and those names are already
   * in live databases, so flipping migrate instead would emit DROP/ADD CONSTRAINT churn
   * against production for a cosmetic difference. Referencing the constants therefore
   * composes the IDENTICAL string at runtime rather than changing the convention — the
   * template literal below evaluates to exactly what the literal arm spells.
   *
   * The expression's column goes through `sql.raw`, not `sql.identifier`: the latter QUOTES
   * the name, which changes the constraint text migrate compares against.
   */
  const checkEntry = (field: MetaField, spec: ColumnSpec): { name: Code; expr: Code } => {
    const colExpr = columnNameExpr(field, spec.dbName);
    const values = spec.checkConstraintValues;
    const sqlSym = imp("sql@drizzle-orm");
    // No artifact in this run (the documented ADR-0034 opt-out) — spell both halves, which
    // is what this file did unconditionally before.
    if (names === undefined || values === undefined) {
      return {
        name: code`${JSON.stringify(`${tableName}_${spec.dbName}_chk`)}`,
        expr: code`${spec.checkConstraint ?? ""}`,
      };
    }
    // `\${` emits a literal `${` into the generated source: the name becomes a template
    // literal and the expression an interpolation, both evaluated at run time in the
    // consumer's code, where they produce the identical strings the literal arm spells.
    return {
      name: code`\`\${${tableNameExpr}}_\${${colExpr}}_chk\``,
      expr: code`\${${sqlSym}.raw(${colExpr})} IN (${values})`,
    };
  };
  // Int-backed field.enum customType helpers, emitted ahead of the table. Keyed by
  // const name so a shared enum used by two fields of the SAME entity emits once.
  const enumIntTypes = new Map<string, EnumIntCustomType>();
  for (const child of obj.fields()) {
    // #213 — a derived (origin-bearing) field is read-only, materialized on the
    // read (view) side, NOT a column on the entity's write table (FR-024 §7).
    // Emitting it here would declare a Drizzle column for a table column migrate
    // no longer creates.
    if (child.isDerived()) continue;
    const isPk = pkFieldNames.has(child.name);
    const fkInfo = fkMap.get(child.name);
    // Compute the column spec once per field and reuse it for both the column
    // line and the CHECK collection.
    const spec = mapColumnType(child, ctx.dialect, ctx.columnNamingStrategy, ctx.timestampMode);
    if (spec.enumIntCustomType !== undefined) {
      enumIntTypes.set(spec.enumIntCustomType.fnConstName, spec.enumIntCustomType);
    }
    const fieldDocs = renderDocsFor(child);
    const columnLine = renderColumn(spec, columnNameExpr(child, spec.dbName), child, ctx, isPk, pkGeneration, fkInfo, isComposite, pkg, obj.name);
    columnLines.push(fieldDocs ? code`  ${fieldDocs}\n${columnLine}` : columnLine);
    if (spec.checkConstraint !== undefined) checkConstraints.push(checkEntry(child, spec));
  }

  // FR-017 Tier 2 — TPH single-table inheritance. When this entity is a
  // discriminator base, fold every concrete subtype's own columns into this
  // one table. Subtype-only columns are ALWAYS nullable (a row of any other
  // subtype stores NULL there) and never carry a DB default (a default would
  // stamp onto other-subtype inserts), regardless of the field's @required.
  // Subtype entities emit no table of their own (the value-object path).
  for (const child of collectTphSubtypeFields(obj, ctx.loadedRoot)) {
    // #213 — a TPH subtype's derived field is read-only too; never a table column.
    if (child.isDerived()) continue;
    const spec = mapColumnType(child, ctx.dialect, ctx.columnNamingStrategy, ctx.timestampMode);
    if (spec.enumIntCustomType !== undefined) {
      enumIntTypes.set(spec.enumIntCustomType.fnConstName, spec.enumIntCustomType);
    }
    const fieldDocs = renderDocsFor(child);
    const columnLine = renderColumn(
      spec, columnNameExpr(child, spec.dbName), child, ctx, false, undefined, fkMap.get(child.name), isComposite, pkg, obj.name, true,
    );
    columnLines.push(fieldDocs ? code`  ${fieldDocs}\n${columnLine}` : columnLine);
    // Enum CHECK constraints stay valid under TPH: `NULL IN (...)` is NULL
    // (not false), so other-subtype rows with NULL pass the check.
    if (spec.checkConstraint !== undefined) checkConstraints.push(checkEntry(child, spec));
  }

  // Build all table callback entries
  const callbackEntries: Code[] = [];

  if (isComposite && primary !== undefined) {
    callbackEntries.push(buildCompositeKeyCallback(pkFieldNames, importModule));
  }

  /**
   * One index callback entry, for BOTH `identity.secondary` (unique) and `index.lookup`
   * (non-unique). The two shapes differ only in that boolean, and migrate treats their
   * physical attributes identically — `@expr`/`@using`/`@orders`/`@where` are registered on
   * both by the same provider — so they are emitted by ONE function here. They used to be
   * two near-identical loops, which is how the physical attributes came to be honoured by
   * neither: a rule written twice is a rule that can be forgotten twice.
   *
   * What was missing is a SHAPE divergence, not a naming one (the names were reconciled
   * separately). An `@expr`-only index emitted NOTHING at all here, because both loops
   * required a non-empty `@fields` — while migrate emits it, keying off `@expr`. And
   * `@where` never reached this file, so a PARTIAL unique index read as a FULLY unique one
   * in the generated schema: `drizzle-kit push` would propose replacing the database's
   * partial index with a total one, and any diff written from generated source disagreed
   * with the database over a difference that was not real. Same class as the sqlite
   * emitter dropping these in 0.15.21.
   */
  const indexEntry = (
    // `type`/`subType` as well as `name`: the index-name resolver and the artifact's
    // `identities` / `indexes` collections both key off which KIND of node this is, and
    // ADR-0040 put that distinction in the type rather than in an attribute.
    node: { name: string; type: string; subType: string; attr: (n: string) => unknown },
    fieldNames: string[],
    unique: boolean,
  ): Code | undefined => {
    const str = (n: string): string | undefined => {
      const raw = node.attr(n);
      return typeof raw === "string" && raw.trim().length > 0 ? raw.trim() : undefined;
    };
    const expr = str(IDENTITY_ATTR_EXPR);
    // An expression index keys off @expr; a plain one needs @fields. Mirrors migrate's
    // `if (fieldNames.length === 0 && expr === undefined) continue`.
    if (fieldNames.length === 0 && expr === undefined) return undefined;

    const sqlSym = imp("sql@drizzle-orm");
    const indexSym = imp(`${unique ? "uniqueIndex" : "index"}@${importModule}`);

    // @orders is positional against @fields; migrate only serializes it when at least one
    // entry is `desc`, because an all-ascending array must be indistinguishable from no
    // orders at all for diff stability. Match that exactly or the two disagree on a
    // no-op.
    const ordersRaw = node.attr(IDENTITY_ATTR_ORDERS);
    const orders = Array.isArray(ordersRaw)
      ? fieldNames.map((_, i) => (ordersRaw[i] === "desc" ? "desc" : "asc"))
      : [];
    const anyDesc = orders.some((o) => o === "desc");
    const colRefs = fieldNames.map((f, i) =>
      anyDesc ? `table.${f}.${orders[i] === "desc" ? "desc" : "asc"}()` : `table.${f}`);

    // sqlite's `.on()` accepts only columns — no SQL — so an expression index is not
    // expressible there. It is skipped rather than emitted wrong; migrate still creates it,
    // and a Drizzle declaration that silently indexed a COLUMN instead of the expression
    // would be a worse answer than an absent one.
    if (expr !== undefined && dialect === "sqlite") return undefined;

    // @using selects the access method and takes the columns itself, so it REPLACES .on().
    // Postgres-only: SQLite has no USING clause, and MySQL's (btree/hash) is an index
    // option rather than an access method taking the columns. migrate omits a `btree`
    // value as the default, and so does this — emitting it would be a spurious difference.
    const using = dialect === "postgres" ? str(IDENTITY_ATTR_USING) : undefined;
    const target: Code =
      expr !== undefined ? code`${sqlSym}\`${expr}\``
      : code`${colRefs.join(", ")}`;
    // The CONSTANT when the artifact is in the run, the literal otherwise — and the
    // literal arm goes through `resolveIndexName` too, so the two paths answer with one
    // function. Both halves matter: migrate's expected-schema resolves the same name and
    // the two spelled it independently until now, which is how codegen came to declare
    // `idx_<table>_<col>` against an index the database actually held under
    // `identity.name` (fdb4118f1); and an empty `index.lookup` name — which the loader
    // accepts, unlike an identity — is refused here rather than emitting `index("")`.
    const indexName = indexNameExpr(names, node);
    const head: Code =
      using !== undefined && using !== "btree"
        ? code`${indexSym}(${indexName}).using(${JSON.stringify(using)}, ${target})`
        : code`${indexSym}(${indexName}).on(${target})`;

    // @where — the partial-index predicate, on Postgres and SQLite. MySQL has no partial
    // indexes, so there the index is declared over the whole table; the adopter's DDL
    // cannot say otherwise either.
    const where = dialect === "mysql" ? undefined : str(IDENTITY_ATTR_WHERE);
    return where === undefined ? head : code`${head}.where(${sqlSym}\`${where}\`)`;
  };

  // identity.secondary — always unique (uniqueness is in the type, no boolean).
  for (const sec of secondaryIdentities) {
    const fields = sec.attr(IDENTITY_ATTR_FIELDS) as string[] | undefined;
    // The identity's OWN name, which is what migrate puts in the database
    // (`expected-schema.ts`, secondary-identity pass) and what `index.lookup` three
    // blocks below already emits. This used to compose `idx_<table>_<col>...` by running
    // the naming strategy over the FIELD names — two defects in one expression: the name
    // disagreed with migrate's (so a DROP INDEX written from generated source failed, and
    // any schema diff reported a difference that was not real), and running the strategy
    // over a field NAME cannot see `@column`, so a declared physical column was invisible
    // to it. Gated by `secondary-index-name-parity.test.ts`, whose fixture is de-blinded
    // against exactly that second defect.
    // Column refs use the callback param `table` (not the outer varName) so TS does not see
    // the table referencing itself inside its own initializer (TS7022/TS7024).
    const entry = indexEntry(sec, Array.isArray(fields) ? fields : [], /* unique */ true);
    if (entry !== undefined) callbackEntries.push(entry);
  }

  // index.lookup — always non-unique. Use MetaIndex.fields() per ADR-0039.
  for (const lookup of obj.lookupIndexes()) {
    const entry = indexEntry(lookup, lookup.fields(), /* unique */ false);
    if (entry !== undefined) callbackEntries.push(entry);
  }

  // Emit table-level CHECK constraints for enum fields. Both halves are composed by
  // `checkEntry` above, which owns the constant-vs-literal decision for the pair.
  for (const { name, expr } of checkConstraints) {
    const checkSym = imp(`check@${importModule}`);
    const sqlSym = imp("sql@drizzle-orm");
    callbackEntries.push(code`${checkSym}(${name}, ${sqlSym}\`${expr}\`)`);
  }

  let tableBlock: Code;
  if (callbackEntries.length > 0) {
    tableBlock = code`
export const ${varName} = ${tableCall}(${tableNameExpr}, {
${joinCode(columnLines, { on: ",\n", trim: false })}
}, (table) => [
  ${joinCode(callbackEntries, { on: ",\n  ", trim: false })}
]);
`;
  } else {
    tableBlock = code`
export const ${varName} = ${tableCall}(${tableNameExpr}, {
${joinCode(columnLines, { on: ",\n", trim: false })}
});
`;
  }

  // Emit the relations() block (returns null if no relations).
  const relationsBlock = renderRelationsBlock(obj, ctx);

  // Int-backed enum codecs are declared BEFORE the table that references them.
  // Sorted by const name so output is deterministic regardless of field order.
  const enumIntBlocks = [...enumIntTypes.values()]
    .sort((a, b) => a.fnConstName.localeCompare(b.fnConstName))
    .map((t) => renderEnumIntCustomType(t, importModule));
  if (declaredEnumIntCodecs !== undefined) {
    for (const name of enumIntTypes.keys()) declaredEnumIntCodecs.add(name);
  }

  const blocks: Code[] = [...enumIntBlocks, tableBlock];
  if (relationsBlock !== null) blocks.push(relationsBlock);
  return blocks.length === 1 ? blocks[0]! : joinCode(blocks, { on: "\n" });
}

interface FkInfo {
  targetVarName: string;    // e.g., "users"
  targetEntityName: string; // e.g., "User" — used for the import path
  targetPackage: string | undefined; // the target's effective package, for the import path
  targetPkField: string;    // e.g., "id"
}

/** Pre-pass: map fkFieldName → FkInfo for this entity's effective (own + inherited) identity.reference children. */
function buildFkMapForEntity(obj: MetaObject, ctx: RenderContext): Map<string, FkInfo> {
  const result = new Map<string, FkInfo>();
  // FR-017 TPH: a discriminator base's table carries every concrete subtype's folded
  // columns (collectTphSubtypeFields), so it carries their FKs too — otherwise a reference
  // declared on a subtype, or on an abstract level between it and the base, lands as a
  // plain column. Same effective, not-already-on-the-base rule as the column fold.
  // A copy: referenceIdentities() is the node's cached array, and loaded metadata is read-only.
  const refs = [...obj.referenceIdentities()];
  const baseRefNames = new Set(refs.map((r) => r.name));
  for (const sub of tphConcreteSubtypes(obj, ctx.loadedRoot)) {
    for (const ref of sub.referenceIdentities()) {
      if (!baseRefNames.has(ref.name)) refs.push(ref);
    }
  }
  for (const ref of refs) {
    // @enforce: false → logical-only reference. Skip the .references() emission;
    // the column stays plain. Drizzle's relations() block (driven by
    // relation-resolver) still includes the relationship for query navigation.
    if (!ref.enforce) continue;
    const fkFieldNames = ref.fields;
    if (fkFieldNames.length === 0) continue;
    const fkField = fkFieldNames[0]!;
    // Two subtypes declaring the same reference fold to one column with one FK.
    if (result.has(fkField)) continue;
    // ADR-0059 R7 — the object `@references` binds to, never a short-name lookup.
    const targetObj = refTarget(ref, IDENTITY_REFERENCE_ATTR_REFERENCES);
    if (!isMetaObject(targetObj)) continue;
    // A TPH subtype has no table const of its own; its rows live in the base's table.
    const storage = tphStorageObject(targetObj);
    const targetPkField = ref.resolvedTargetPkField(ctx.loadedRoot) ?? "id";
    result.set(fkField, {
      targetVarName: ctx.collectionName(storage.name),
      targetEntityName: storage.name,
      targetPackage: effectivePackage(storage),
      targetPkField,
    });
  }
  return result;
}

/**
 * Build the `primaryKey({ columns: [table.f1, table.f2] })` Code expression
 * for composite primary keys. Uses imp() so ts-poet tracks the import.
 */
function buildCompositeKeyCallback(
  pkFieldNames: Set<string>,
  importModule: string,
): Code {
  const primaryKeySym = imp(`primaryKey@${importModule}`);
  const columnRefs = Array.from(pkFieldNames)
    .map((f) => `table.${f}`)
    .join(", ");
  return code`${primaryKeySym}({ columns: [${columnRefs}] })`;
}

/** Build a JS-style object literal string (not JSON.stringify which uses quoted keys).
 *  Array values get `as const` appended so Drizzle's text(...,{ enum: [...] })
 *  narrows the inferred column type to a literal union instead of bare `string`. */
function inlineObjectLiteral(obj: Record<string, unknown>): string {
  const entries = Object.entries(obj).map(([k, v]) => {
    const lit = JSON.stringify(v);
    if (Array.isArray(v)) {
      return `${k}: ${lit} as const`;
    }
    return `${k}: ${lit}`;
  });
  return `{ ${entries.join(", ")} }`;
}

/** Render one column line (field name + Drizzle column expression). */
/** SQLite "now" for a timestamp column, spelled like Date.toISOString(). Must stay
 *  byte-identical to migrate-ts `SQLITE_ISO_NOW`, which owns the DDL (ADR-0015). */
const SQLITE_ISO_NOW = "strftime('%Y-%m-%dT%H:%M:%fZ','now')";

function renderColumn(
  spec: ColumnSpec,
  // §A6 — the column's physical name as an EXPRESSION: either the `<Entity>Names` constant
  // or the same literal as before. Passed in rather than derived here so one call site owns
  // the decision (and the equality check that makes it byte-safe).
  dbNameExpr: Code,
  field: MetaField,
  ctx: RenderContext,
  isPk: boolean,
  pkGeneration: string | undefined,
  fkInfo: FkInfo | undefined,
  isComposite: boolean,
  entityPackage: string | undefined = undefined,
  // Name of the entity this column belongs to — used to detect a self-referential
  // FK (target entity === this entity), which Drizzle emits without a self-import.
  currentEntityName: string = "",
  // FR-017 Tier 2 — TPH subtype-only column: force nullable (drop .notNull())
  // and suppress any DB default (other-subtype rows must stay NULL here).
  forceNullable: boolean = false,
): Code {
  // An int-backed field.enum's column function is a LOCAL generated const (the
  // customType helper emitted into this same file), so it must not be imported
  // from drizzle-orm/*-core like a built-in column type would be.
  const fnSym =
    spec.enumIntCustomType !== undefined
      ? spec.enumIntCustomType.fnConstName
      : imp(`${spec.fnName}@${spec.importModule}`);

  let baseCall: Code;
  if (spec.fnOptions !== undefined && Object.keys(spec.fnOptions).length > 0) {
    baseCall = code`${fnSym}(${dbNameExpr}, ${inlineObjectLiteral(spec.fnOptions)})`;
  } else {
    baseCall = code`${fnSym}(${dbNameExpr})`;
  }

  let pkSuffix = "";
  if (isPk) {
    if (pkGeneration === GENERATION_INCREMENT) {
      if (ctx.dialect === "sqlite") {
        // Composite PKs don't use .primaryKey() per-column; table callback owns it.
        pkSuffix = isComposite ? "" : ".primaryKey({ autoIncrement: true })";
      } else if (ctx.dialect === "mysql") {
        // MySQL: an AUTO_INCREMENT column. The generated writes read the new key back
        // with Drizzle's `$returningId()` (MySQL has no RETURNING).
        pkSuffix = isComposite ? ".autoincrement()" : ".primaryKey().autoincrement()";
      } else {
        // Postgres: the column KEEPS the type the column-mapper derived and
        // GAINS the identity clause. It does not get a second spelling.
        //
        // This used to substitute `serial`/`bigserial` for the mapped
        // `integer`/`bigint`, and that was the 1.0 defect wearing another hat:
        // migrate emits `… GENERATED BY DEFAULT AS IDENTITY` (emit/postgres.ts
        // renderColumn) for the same field, and `serial` is NOT that column.
        // `serial` is historical sugar for integer + an owned sequence + a
        // genuine DEFAULT nextval(...); an identity column carries neither a
        // default nor a droppable sequence. So the generated Drizzle schema
        // misrepresented the live PK of every integer-keyed table migrate had
        // created — one question, two doors, two answers, and nothing compared
        // them. migrate owns the DDL (ADR-0015), so codegen is what changes —
        // the same call #293 made when the two named a CHECK constraint
        // differently.
        //
        // The clause is gated on the MAPPED column function rather than on the
        // field subtype, so the two cannot drift apart again: only Drizzle's
        // int family (integer/bigint/smallint, via PgIntColumnBaseBuilder)
        // carries .generatedByDefaultAsIdentity(). A subtype outside that
        // family with @generation:"increment" is a combination Postgres cannot
        // express at all — migrate emits `TEXT GENERATED BY DEFAULT AS
        // IDENTITY` and fails at apply — and the honest thing here is to leave
        // the declared type alone and let that failure be loud, rather than
        // silently substituting an integer column for the declared one.
        pkSuffix = isComposite ? "" : ".primaryKey()";
        if (
          spec.enumIntCustomType === undefined &&
          PG_IDENTITY_CAPABLE_FNS.has(spec.fnName)
        ) {
          pkSuffix += ".generatedByDefaultAsIdentity()";
        }
      }
    } else if (pkGeneration === GENERATION_UUID) {
      pkSuffix = isComposite
        ? ""
        : ctx.dialect === "postgres"
          ? ".primaryKey().defaultRandom()"
          // SQLite and MySQL have no uuid default: the id is minted client-side.
          : ".primaryKey().$defaultFn(() => crypto.randomUUID())";
    } else {
      // No generation: natural PK. Composite hands off to table callback.
      pkSuffix = isComposite ? "" : ".primaryKey()";
    }
  }

  let modifiersStr = pkSuffix;
  // No `isUnique` parameter here any more, and its absence is the fix rather than a tidy-up.
  // A single-column `identity.secondary` used to append `.unique()` on top of the constraint
  // migrate already emits under the identity's own name, so codegen declared one constraint
  // the database does not have. When that producer was removed both call sites started
  // passing a literal `false`, leaving a parameter whose every branch was unreachable — a
  // dead switch that reads like a live one. `spec.modifiers` carries whatever uniqueness the
  // column genuinely has, and the loop below is the only thing that applies it.
  for (const m of spec.modifiers) {
    // Single-column PKs imply notNull/unique; avoid emitting them twice.
    // Composite-PK columns are NOT declared with .primaryKey(), so they DO need .notNull().
    if (isPk && !isComposite && (m === ".notNull()" || m === ".unique()")) continue;
    // TPH subtype-only column: never .notNull() / .unique() — rows of other
    // subtypes store NULL, so neither constraint can hold across the table.
    if (forceNullable && (m === ".notNull()" || m === ".unique()")) continue;
    modifiersStr += m;
  }

  // sqlDefaultSegment must be a Code segment (not a raw string) so ts-poet tracks
  // the `sql` import via imp(); a raw `.default(sql`...`)` would leave `sql`
  // unresolved in the generated file.
  let sqlDefaultSegment: Code | null = null;
  if (spec.defaultExpr !== undefined && !isPk && !forceNullable) {
    if (spec.defaultExpr.kind === "now") {
      if (ctx.dialect === "sqlite") {
        const sqlSym = imp("sql@drizzle-orm");
        // A timestamp column defaults to the ISO UTC form generated code writes, the same
        // expression `meta migrate` puts in the DDL (migrate-ts SQLITE_ISO_NOW).
        sqlDefaultSegment = field.subType === FIELD_SUBTYPE_TIMESTAMP
          ? code`.default(${sqlSym}\`(${SQLITE_ISO_NOW})\`)`
          : code`.default(${sqlSym}\`CURRENT_TIMESTAMP\`)`;
      } else if (ctx.dialect === "mysql") {
        // MySQL's datetime builder has no defaultNow(); spell the expression default,
        // at the column's millisecond precision.
        const sqlSym = imp("sql@drizzle-orm");
        sqlDefaultSegment = field.subType === FIELD_SUBTYPE_TIMESTAMP
          ? code`.default(${sqlSym}\`(CURRENT_TIMESTAMP(3))\`)`
          : field.subType === FIELD_SUBTYPE_DATE
            ? code`.default(${sqlSym}\`(CURRENT_DATE)\`)`
            : code`.default(${sqlSym}\`(CURRENT_TIME)\`)`;
      } else {
        modifiersStr += `.defaultNow()`;
      }
    } else if (spec.defaultExpr.kind === "arrayLiteral") {
      // isArray field: Drizzle's .array().default(x) (postgres) and
      // .$type<E[]>().default(x) (sqlite json) want a JS array literal, not the
      // raw @default string. Elements are pre-rendered TS source literals.
      // MySQL cannot give a JSON column a literal DEFAULT, so there the array is filled in
      // client-side on insert.
      modifiersStr += ctx.dialect === "mysql"
        ? `.$defaultFn(() => [${spec.defaultExpr.elements.join(", ")}])`
        : `.default([${spec.defaultExpr.elements.join(", ")}])`;
    } else if (spec.defaultExpr.kind === "sqlExpr") {
      const sqlSym = imp("sql@drizzle-orm");
      // Raw SQL keyword/expression — emit as sql`<raw>` for both dialects. This
      // is also the always-typechecks fallback for an array @default whose shape
      // parseArrayDefault couldn't safely model.
      sqlDefaultSegment = code`.default(${sqlSym}\`${spec.defaultExpr.raw}\`)`;
    } else {
      // literal
      modifiersStr += `.default(${JSON.stringify(spec.defaultExpr.value)})`;
    }
  }

  // FK .references() uses imp() so ts-poet tracks the cross-entity import.
  let fkRefSegment: Code | null = null;
  if (fkInfo !== undefined && !isPk) {
    // Always annotate the .references() callback with the dialect's Any*Column return
    // type. Drizzle needs this to break circular type inference — not only for
    // self-referential FKs but also for cross-module circular references (table A → B
    // while B → A), which otherwise surface as TS7022 ("implicitly has type 'any'
    // because it does not have a type annotation and is referenced … in its own
    // initializer") under `strict`. The annotation is a harmless explicit supertype
    // for acyclic FKs, so emitting it unconditionally is safe.
    const anyColType = dialectModule(ctx.dialect).anyColumn;
    // Used only as a return-type annotation → type-only import (t:) so it emits
    // `import type` and doesn't fail tsc under `verbatimModuleSyntax` (TS1484). (#165)
    const anyColSym = imp(`t:${anyColType}@${spec.importModule}`);
    if (fkInfo.targetEntityName === currentEntityName) {
      // Self-referential FK (e.g. createdBy → this same table): reference the local
      // table const directly — NOT a self-import.
      fkRefSegment = code`.references((): ${anyColSym} => ${fkInfo.targetVarName}.${fkInfo.targetPkField})`;
    } else {
      const targetSpec = crossEntitySpecifier(
        ctx.outputLayout,
        entityPackage,
        fkInfo.targetPackage,
        fkInfo.targetEntityName,
        ctx.extStyle,
      );
      const targetVarSym = imp(`${fkInfo.targetVarName}@${targetSpec}`);
      fkRefSegment = code`.references((): ${anyColSym} => ${targetVarSym}.${fkInfo.targetPkField})`;
    }
  }

  // @autoSet fields: emit a $defaultFn so Drizzle inserts stamp the server-side timestamp
  // automatically. This means callers don't need to supply createdAt / updatedAt in INSERT
  // calls — Drizzle fills them in. The stamp's shape must match ctx.timestampMode — the base
  // column type already does (mapColumnType, above) — or a "date" column ends up with a
  // $defaultFn that hands Drizzle a string, which fails to typecheck (reported against an
  // adopting project: TS2322 "Type 'string' is not assignable to type 'Date | SQL<unknown>'",
  // cascading into every generated insert/update query touching the field).
  const autoSet = field.attr(FIELD_ATTR_AUTO_SET);
  const autoSetSuffix = (autoSet === "onCreate" || autoSet === "onUpdate")
    ? ctx.timestampMode === "date"
      ? `.$defaultFn(() => new Date())`
      : `.$defaultFn(() => new Date().toISOString())`
    : "";

  // $type<E[]>() chain — emitted as Code (not a string modifier) so ts-poet can
  // hoist the cross-module type import for objectRef variants. Positioned
  // immediately after the baseCall so the chain reads `.text(...).$type<...>().notNull()...`
  // which Drizzle accepts in any order but is conventional for "type narrowing
  // first."
  // Resolve a VO name → an imported type symbol (shared layout/package/extStyle-aware
  // helper, so the .$type<VO> import matches the field's TS type + Zod schema).
  // ADR-0044/#228 — resolve the field's @objectRef to the value object's EMITTED
  // name (bare when unique in the run, package-qualified on a cross-package
  // short-name collision), resolved package-locally from the FIELD's declaring
  // package. `name` (the bare dollarTypeRef name) is the byte-identical fallback
  // when the ref doesn't resolve to an emitted value object.
  const voSym = (name: string) => {
    const refRaw = field.attr(FIELD_ATTR_OBJECT_REF);
    const emitted = typeof refRaw === "string"
      ? ctx.resolveValueObjectName(field)
      : name;
    return imp(`t:${emitted}@${valueObjectModuleSpecifier(emitted, ctx.packageOf, entityPackage, ctx.outputLayout, ctx.extStyle)}`);
  };

  let dollarTypeSegment: Code | string = "";
  if (spec.dollarTypeRef !== undefined) {
    const ref = spec.dollarTypeRef;
    if (ref.kind === "scalar") {
      dollarTypeSegment = `.$type<${ref.tsType}${ref.array ? "[]" : ""}>()`;
    } else if (ref.kind === "objectRef") {
      const refSym = voSym(ref.name);
      dollarTypeSegment = ref.array ? code`.$type<${refSym}[]>()` : code`.$type<${refSym}>()`;
    } else {
      // field.map → Record<string, V>; V is a scalar or a hoisted value-object.
      dollarTypeSegment = "scalar" in ref.value
        ? `.$type<Record<string, ${ref.value.scalar}>>()`
        : code`.$type<Record<string, ${voSym(ref.value.objectRef)}>>()`;
    }
  }

  const columnLine = code`  ${field.name}: ${baseCall}${dollarTypeSegment}${modifiersStr}${autoSetSuffix}${sqlDefaultSegment ?? ""}${fkRefSegment ?? ""}`;
  return spec.leadingComment !== undefined
    ? code`  // ${spec.leadingComment}\n${columnLine}`
    : columnLine;
}
