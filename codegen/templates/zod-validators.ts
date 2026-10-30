// Zod validators template — emits InsertSchema (for create) and UpdateSchema (for update).
// Auto-generated PKs are EXCLUDED from InsertSchema (caller doesn't provide them).
// @autoSet fields: INSERT → .optional().transform(() => new Date().toISOString())
//                 UPDATE → onCreate fields omitted entirely; onUpdate gets same transform
//
// field.object isArray:true objectRef:<Ref> — emits z.array(<Ref>InsertSchema)
// with a cross-module imp() so consumers passing the schema to
// zod-to-json-schema get a properly element-typed array. Without this, every
// object-array field collapsed to z.array(z.string()) and the JSON Schema sent
// downstream (e.g. to LLM tool_use input_schema) lost the nested object shape.

import { entityTypeNames } from "./entity-type-names.js";
import { code, joinCode, imp, type Code } from "@metaobjectsdev/codegen-ts/engine";
import { MetaObject, MetaField, type MetaRoot, stripPackage } from "@metaobjectsdev/metadata";
import {
  FIELD_SUBTYPE_STRING, FIELD_SUBTYPE_INT, FIELD_SUBTYPE_LONG, FIELD_SUBTYPE_CURRENCY,
  FIELD_SUBTYPE_BOOLEAN, FIELD_SUBTYPE_DECIMAL, FIELD_ATTR_PRECISION, FIELD_ATTR_SCALE, FIELD_SUBTYPE_DOUBLE, FIELD_SUBTYPE_FLOAT,
  FIELD_SUBTYPE_DATE, FIELD_SUBTYPE_TIME, FIELD_SUBTYPE_TIMESTAMP,
  FIELD_SUBTYPE_ENUM, FIELD_SUBTYPE_OBJECT, FIELD_SUBTYPE_MAP, FIELD_SUBTYPE_UUID,
  FIELD_SUBTYPE_URI, FIELD_SUBTYPE_INET,
  VALIDATOR_SUBTYPE_REQUIRED, VALIDATOR_SUBTYPE_LENGTH, VALIDATOR_SUBTYPE_REGEX,
  VALIDATOR_SUBTYPE_NUMERIC, VALIDATOR_SUBTYPE_ARRAY,
  IDENTITY_ATTR_FIELDS, IDENTITY_ATTR_GENERATION,
  FIELD_ATTR_STRING_FORMAT, FIELD_ATTR_LENIENT, FIELD_ATTR_LOCAL_TIME, STRING_FORMAT_EMAIL, STRING_FORMAT_HOSTNAME,
  FIELD_ATTR_REQUIRED, FIELD_ATTR_MAX_LENGTH, FIELD_ATTR_DEFAULT,
  FIELD_ATTR_AUTO_SET, FIELD_ATTR_OBJECT_REF, FIELD_ATTR_VALUE_TYPE,
  isReadOnlyMutability, isWriteOnceMutability,
  FIELD_ATTR_DB_COLUMN_TYPE, DB_COLUMN_TYPE_JSONB,
  AUTO_SET_ON_CREATE, AUTO_SET_ON_UPDATE,
  VALIDATOR_ATTR_MAX, VALIDATOR_ATTR_MIN, VALIDATOR_ATTR_PATTERN,
  GENERATION_INCREMENT, GENERATION_UUID,
  OBJECT_ATTR_DISCRIMINATOR, OBJECT_ATTR_DISCRIMINATOR_VALUE,
  OBJECT_SUBTYPE_VALUE,
} from "@metaobjectsdev/metadata";
import { enumValues } from "@metaobjectsdev/codegen-ts/engine";
import { zodEnumExpr } from "./zod-enum.js";
import { ZOD_INET_EXPR } from "./net-regex.js";
import {
  UTC_TIMESTAMP_HELPER_DECL,
  ZOD_DATE_EXPR,
  ZOD_TIME_EXPR,
  ZOD_TIME_NO_OFFSET_EXPR,
  ZOD_TIMESTAMP_EXPR,
  ZOD_TIMESTAMP_UTC_EXPR,
} from "./date-time-regex.js";
import { renderDocsFor } from "./jsdoc.js";
import { DECIMAL_WRITE_HELPER_DECL, zodDecimalWriteExpr } from "./decimal-wire-helper.js";
import { sharedEnumForField } from "@metaobjectsdev/codegen-ts/engine";
import { sharedEnumImportSpecifier } from "@metaobjectsdev/codegen-ts/engine";
import { sharedEnumZodConstName } from "./enums-file.js";
import type { RenderContext } from "@metaobjectsdev/codegen-ts/engine";
import { valueObjectModuleSpecifier } from "@metaobjectsdev/codegen-ts/engine";
// FR-035: the SAME required-predicate that drives the Drizzle column's .notNull()
// drives the UpdateSchema's .nullable() exclusion — shared so they cannot drift.
import { isRequired } from "@metaobjectsdev/codegen-ts/engine";
import { effectivePackage } from "@metaobjectsdev/codegen-ts/engine";
import { isTphSubtype, tphDiscriminatorBase, tphDiscriminatorPin } from "@metaobjectsdev/codegen-ts/engine";
/** @deprecated Moved to the engine module `tph.ts` (ADR-0034 Amendment 8). Import these from `@metaobjectsdev/codegen-ts`. */
export {
  declaresTphDiscriminator,
  isTphSubtype,
  tphDiscriminatorBase,
  tphDiscriminatorPin,
  tphStorageName,
  tphStorageObject,
} from "@metaobjectsdev/codegen-ts/engine";

// Counts emissions of ZOD_TIMESTAMP_UTC_EXPR. A schema emitter compares it before and after
// building its field lines to learn whether its module needs the local normalizer —
// exactly when a line references it, so the helper is never emitted unused. (Rendering is
// synchronous; each module is rendered by exactly one schema emitter.)
let utcTimestampUses = 0;

/** The normalizer's declaration when `since` is behind the running count, else nothing. */
function utcTimestampHelperSince(since: number): string {
  return utcTimestampUses > since ? `${UTC_TIMESTAMP_HELPER_DECL}\n\n` : "";
}

// The same device for the decimal write rule (decimal-wire-helper.ts).
let decimalWriteUses = 0;

function decimalHelperSince(since: number): string {
  return decimalWriteUses > since ? `${DECIMAL_WRITE_HELPER_DECL}\n\n` : "";
}


/** True when this object declares at least one @autoSet timestamp field
 *  (onCreate or onUpdate). Drives whether codegen emits the #203
 *  `<Entity>InsertPreservingSchema` + `insertPreserving<Entity>` escape hatch —
 *  a plain entity has nothing to preserve, so both are omitted. Resolving
 *  (ADR-0039): honors an @autoSet inherited via extends. */
export function hasAutoSetFields(obj: MetaObject): boolean {
  for (const child of obj.fields()) {
    const autoSet = child.attr(FIELD_ATTR_AUTO_SET);
    if (autoSet === AUTO_SET_ON_CREATE || autoSet === AUTO_SET_ON_UPDATE) return true;
  }
  return false;
}

/** Is this field's column one the TPH BASE declares, rather than a subtype-only one?
 *
 *  Resolving (ADR-0039) and compared by name against `base.fields()` — exactly the set
 *  `collectTphSubtypeFields` treats as "already emitted" when it folds the subtype
 *  columns into the base table, so the two answers cannot drift apart. A field declared
 *  on an abstract level BETWEEN the base and the subtype is subtype-only: the base's own
 *  field set does not carry it, and neither does the base's `.notNull()`. */
function isTphBaseOwnField(obj: MetaObject, field: MetaField): boolean {
  const base = tphDiscriminatorBase(obj);
  if (base === undefined) return false;
  return base.fields().some((f) => f.name === field.name);
}

/**
 * Is this field NULL-tolerant in a TPH subtype's READ shape?
 *
 * Answered from the PHYSICAL column, because that is the only thing a read can return.
 * A TPH subtype shares one table with its siblings, so a column only some subtypes
 * declare is NULL on every other subtype's row and `drizzle-schema.ts` drops its
 * `.notNull()` whatever `@required` says (its `forceNullable` fold). A column the base
 * itself declares carries `.notNull()` precisely when the field is required. The PRIMARY
 * KEY is the shared base table's key and is present on every row.
 *
 * `@default` is deliberately NOT consulted, and that is the fix rather than an omission.
 * A default decides whether an INSERT may leave the value out; it says nothing about what
 * a READ can see. Asking `fieldWillBeOptional` here widened a `NOT NULL DEFAULT` column to
 * `| null` and — through the `.optional()` that same predicate mirrors — to `| undefined`,
 * which the declared interface did not admit: `parse<Base>()` returned a value not
 * assignable to the base union and the generated module failed to compile (TS2322).
 *
 * ONE predicate, because TWO emitters answer this question about the same field: the
 * Zod read schema (`renderTphSubtypeReadSchema`) and the declared TS type
 * (`renderValueObjectInterface`). A second answer to one question is the defect;
 * keeping the two call sites pointed here is the fix.
 */
export function isTphReadNullTolerant(obj: MetaObject, field: MetaField): boolean {
  if (!isTphSubtype(obj)) return false;
  if (primaryIdentityFieldNames(obj).includes(field.name)) return false;
  if (!isTphBaseOwnField(obj, field)) return true;
  return !isRequired(field);
}

/**
 * FR-017 Tier 2 — the per-subtype FULL read schema `<Sub>Schema`. Unlike the
 * insert schema, this includes every effective field (PK included) so a raw DB
 * row parses through it. The discriminator field is pinned to its literal value
 * (`type: z.literal("Bridge")`) so the schema rejects a row of another subtype.
 *
 * This is the schema parse<Base>(row) dispatches to (see tph-discriminator.ts).
 * Non-required columns are `.nullable()`-tolerant: a nullable TPH column read
 * back from the DB arrives as `null`, not `undefined`, so the read schema must
 * accept null (the insert schema, by contrast, makes them `.optional()`).
 */
export function renderTphSubtypeReadSchema(obj: MetaObject, ctx?: RenderContext): Code {
  const z = imp("z@zod");
  const tphPin = tphDiscriminatorPin(obj);

  const fieldLines: Code[] = [];
  for (const child of obj.fields()) {
    if (tphPin !== undefined && child.name === tphPin.fieldName) {
      fieldLines.push(code`  ${child.name}: z.literal(${JSON.stringify(tphPin.value)})`);
      continue;
    }
    // forceRequired: a row selected from the table carries every column as a KEY —
    // a nullable one arrives as `null`, never absent — so nothing with a COLUMN in a
    // read shape is `.optional()`. Letting zodFieldExpr append it made the inferred
    // type `T | undefined` while the declared interface said `T`, and the two
    // disagreed. A derived (origin-bearing) field is the one member of obj.fields()
    // with no column — drizzle-schema.ts emits none, and the TPH queries path selects
    // the bare base table — so its key is genuinely absent from every parsed row and
    // it alone keeps `.optional()`, matching the interface's `?: T | null`.
    // Null-tolerance is added below, from the column, by isTphReadNullTolerant.
    const expr = zodFieldExpr(child, obj, ctx, !child.isDerived(), true);
    fieldLines.push(
      isTphReadNullTolerant(obj, child)
        ? code`  ${child.name}: ${expr}.nullable()`
        : code`  ${child.name}: ${expr}`,
    );
  }

  const objName = ctx ? ctx.valueObjectEmittedName(obj) : obj.name;
  const docs = renderDocsFor(obj);
  const docsPrefix = docs ? `${docs}\n` : "";
  return code`
${docsPrefix}export const ${objName}Schema = ${z}.object({
${joinCode(fieldLines, { on: ",\n" })}
});
`;
}

/** Field names participating in the object's PRIMARY identity, normalized to a
 *  list. Empty when the object has no primary identity. Exported for the
 *  view-decl read-schema path, which must type PK columns non-null too. */
export function primaryIdentityFieldNames(obj: MetaObject): string[] {
  const primary = obj.primaryIdentity();
  if (!primary) return [];
  const fields = primary.attr(IDENTITY_ATTR_FIELDS);
  if (Array.isArray(fields)) return fields.map(String);
  if (typeof fields === "string") return [fields];
  return [];
}

/** Auto-generated PK field names that should be omitted from InsertSchema. */
function autoGenPkFieldNames(obj: MetaObject): Set<string> {
  const generation = obj.primaryIdentity()?.attr(IDENTITY_ATTR_GENERATION);
  if (generation !== GENERATION_INCREMENT && generation !== GENERATION_UUID) return new Set();
  return new Set(primaryIdentityFieldNames(obj));
}

/** ALL field names participating in the object's PRIMARY identity, regardless of
 *  @generation. A PK column is never NULL (single-col via Drizzle `.primaryKey()`,
 *  composite via `.notNull()`), so FR-035 PATCH-2 must NOT make a PK field
 *  `.nullable()` in the UpdateSchema even when it carries no @required — otherwise
 *  an explicit null typechecks into Drizzle's `.set()` (which rejects null on a
 *  not-null column) and would violate NOT NULL at runtime. Unlike
 *  autoGenPkFieldNames (which only lists increment/uuid PKs, already excluded from
 *  the schema), this covers assigned + extended-identity projection PKs too. */
function primaryKeyFieldNames(obj: MetaObject): Set<string> {
  return new Set(primaryIdentityFieldNames(obj));
}

/** PK field names the CALLER must supply on insert: an ASSIGNED primary key —
 *  a natural key or an externally-issued id, i.e. a primary identity carrying no
 *  @generation — that also has no @default to fill it.
 *
 *  These are insert-REQUIRED regardless of @required, and that is a typing
 *  necessity rather than a policy choice: the Drizzle column for such a PK is
 *  `text("id").primaryKey()` with no default, so its inferred insert type
 *  requires the value. Deriving the PK's optionality from @required like any
 *  other field emitted `id: z.string().optional()`, and the generated
 *  `create<Entity>` — which pipes `InsertSchema.parse(data)` straight into
 *  `.values()` — then failed to compile (TS2769). It was also a semantic hole:
 *  the schema accepted a create payload with no primary key at all.
 *
 *  Excluded, because each is already insert-optional for a real reason:
 *    • @generation increment|uuid PKs — omitted from the schema entirely
 *      (autoGenPkFieldNames), the caller never supplies them;
 *    • a PK carrying @default — the column gets that default, so omitting is
 *      legal and forcing it required would make callers repeat the default.
 *  Mirrors primaryKeyFieldNames' reasoning for the UpdateSchema: a PK column is
 *  never NULL, so PK optionality can never be read off @required alone. */
function assignedPkFieldNames(obj: MetaObject): Set<string> {
  const autoGen = autoGenPkFieldNames(obj);
  const out = new Set<string>();
  for (const name of primaryIdentityFieldNames(obj)) {
    if (autoGen.has(name)) continue;
    out.add(name);
  }
  return out;
}

/** True when this field is an assigned PK with no @default — see
 *  assignedPkFieldNames. Kept as one predicate so the emitters and the
 *  documented-shape function (insertSchemaFields) cannot drift. */
function isInsertRequiredPk(field: MetaField, assignedPk: Set<string>): boolean {
  if (!assignedPk.has(field.name)) return false;
  return field.attr(FIELD_ATTR_DEFAULT) === undefined;
}

/**
 * Emit ONLY the `<Name>InsertSchema`. Used by the value-object file emitter
 * for metaobjects with no writable source.rdb — those have no PATCH/update
 * semantics, so emitting an UpdateSchema would be misleading.
 *
 * The schema name is kept as `<Name>InsertSchema` even for pure value objects
 * so consumer imports don't churn. A future polish PR could add a `<Name>Schema`
 * alias for clarity.
 */
export function renderInsertSchemaOnly(obj: MetaObject, ctx?: RenderContext): Code {
  const z = imp("z@zod");
  const utcUsesBefore = utcTimestampUses;
  const decimalUsesBefore = decimalWriteUses;
  const autoGenPkFields = autoGenPkFieldNames(obj);
  const assignedPkFields = assignedPkFieldNames(obj);
  const tphPin = tphDiscriminatorPin(obj);

  const insertFieldLines: Code[] = [];
  for (const child of obj.fields()) {
    if (autoGenPkFields.has(child.name)) continue;
    // FR-037 R1: an @mutability:"readOnly" field is populated by DB / replication /
    // external owner; the application has no path to write it. Exclude from the
    // create-shape schema entirely. ("writeOnce" is NOT excluded here — that is
    // the whole point of the mode: settable on create, frozen after.)
    // #213 — a derived (origin-bearing) field is read-only (FR-024 §7 / ADR-0028):
    // excluded from the Insert/Update/preserving schemas, exactly like readOnly.
    if (isReadOnlyMutability(child) || child.isDerived()) continue;

    // FR-017 Tier 1: TPH subtype pins its discriminator field to z.literal(...).
    if (tphPin !== undefined && child.name === tphPin.fieldName) {
      insertFieldLines.push(
        code`  ${child.name}: z.literal(${JSON.stringify(tphPin.value)})`,
      );
      continue;
    }

    const autoSet = child.attr(FIELD_ATTR_AUTO_SET);

    if (autoSet === AUTO_SET_ON_CREATE || autoSet === AUTO_SET_ON_UPDATE) {
      insertFieldLines.push(
        ctx?.timestampMode === "date"
          // CRITICAL 1: these schemas validate raw JSON request bodies (wire
          // timestamps are ISO strings), never a live `Date` — z.coerce.date()
          // (not z.date()) so a string round-trips; z.date() rejects every JSON
          // wire value outright (verified: z.date().safeParse(isoString) is false).
          ? code`  ${child.name}: z.coerce.date().optional().transform(() => new Date())`
          : code`  ${child.name}: z.string().optional().transform(() => new Date().toISOString())`,
      );
    } else {
      insertFieldLines.push(
        code`  ${child.name}: ${zodFieldExpr(child, obj, ctx, isInsertRequiredPk(child, assignedPkFields))}`,
      );
    }
  }

  // ADR-0044/#228 — the schema name follows the value object's EMITTED name
  // (bare when unique in the run, package-qualified on a cross-package short-name
  // collision) so importers (entity/extract tiers) resolve the same symbol.
  const objName = ctx ? ctx.valueObjectEmittedName(obj) : obj.name;
  const insertSchemaName = `${objName}InsertSchema`;
  const docs = renderDocsFor(obj);
  const docsPrefix = docs ? `${docs}\n` : "";

  return code`
${utcTimestampHelperSince(utcUsesBefore)}${decimalHelperSince(decimalUsesBefore)}${docsPrefix}export const ${insertSchemaName} = ${z}.object({
${joinCode(insertFieldLines, { on: ",\n" })}
});
`;
}

/** One documented field in an Insert/Update schema's accepted shape. */
export interface SchemaFieldShape {
  /** The field name (the schema property key). */
  name: string;
  /** Whether the property is optional in the schema (`.optional()` / omitted-OK). */
  optional: boolean;
  /** For the @discriminator field on a TPH subtype's InsertSchema: the pinned
   *  literal value (`z.literal("Bridge")`). Undefined otherwise. */
  pinnedLiteral?: string;
  /** True for @autoSet timestamp fields the schema fills server-side
   *  (`z.string().optional().transform(...)`). */
  autoSet?: boolean;
}

/**
 * The field SET (name + optionality) the `<Name>InsertSchema` accepts — derived
 * by the SAME iteration + skip rules `renderInsertSchemaOnly` /
 * `renderZodValidators` use to EMIT that schema, so a documented create-payload
 * shape can never drift from the real schema:
 *   • auto-generated PK fields are omitted (caller doesn't provide them);
 *   • @readOnly fields are omitted (DB / replication owns the write path);
 *   • a TPH subtype's @discriminator field is a pinned `z.literal(value)`;
 *   • @autoSet fields are present but optional (server fills them);
 *   • an ASSIGNED primary key with no @default is required (see
 *     assignedPkFieldNames — its Drizzle column has no default);
 *   • every other field's optionality is `fieldWillBeOptional` (not required, or
 *     carries a @default).
 */
export function insertSchemaFields(obj: MetaObject): SchemaFieldShape[] {
  const autoGenPkFields = autoGenPkFieldNames(obj);
  const assignedPkFields = assignedPkFieldNames(obj);
  const tphPin = tphDiscriminatorPin(obj);
  const out: SchemaFieldShape[] = [];
  for (const child of obj.fields()) {
    if (autoGenPkFields.has(child.name)) continue;
    // #213 — a derived (origin-bearing) field is read-only (FR-024 §7 / ADR-0028):
    // excluded from the Insert/Update/preserving schemas, exactly like readOnly.
    // "writeOnce" stays IN the create shape — it is settable exactly once.
    if (isReadOnlyMutability(child) || child.isDerived()) continue;
    if (tphPin !== undefined && child.name === tphPin.fieldName) {
      out.push({ name: child.name, optional: false, pinnedLiteral: tphPin.value });
      continue;
    }
    const autoSet = child.attr(FIELD_ATTR_AUTO_SET);
    if (autoSet === AUTO_SET_ON_CREATE || autoSet === AUTO_SET_ON_UPDATE) {
      out.push({ name: child.name, optional: true, autoSet: true });
    } else {
      out.push({
        name: child.name,
        optional: isInsertRequiredPk(child, assignedPkFields) ? false : fieldWillBeOptional(child),
      });
    }
  }
  return out;
}

/**
 * The field SET the `<Name>UpdateSchema` accepts — same iteration + skip rules
 * as `insertSchemaFields`, but mirroring the UpdateSchema branch of
 * `renderZodValidators`:
 *   • a TPH subtype's @discriminator field is OMITTED (clients can't change subtype);
 *   • @autoSet onCreate fields are OMITTED (creation timestamps are immutable);
 *   • @autoSet onUpdate fields are present + optional (server fills them);
 *   • every other field is optional (PATCH semantics).
 */
export function updateSchemaFields(obj: MetaObject): SchemaFieldShape[] {
  const autoGenPkFields = autoGenPkFieldNames(obj);
  const tphPin = tphDiscriminatorPin(obj);
  const out: SchemaFieldShape[] = [];
  for (const child of obj.fields()) {
    if (autoGenPkFields.has(child.name)) continue;
    // #213 — a derived (origin-bearing) field is read-only (FR-024 §7 / ADR-0028):
    // excluded from the Insert/Update/preserving schemas, exactly like readOnly.
    if (isReadOnlyMutability(child) || child.isDerived()) continue;
    // FR-037 R1 — "writeOnce" leaves the UPDATE shape, and only the update shape.
    // Omitted, not rejected: a key absent from the settable set is STRIPPED on this
    // path today (D1), and the generated edit form submits EVERY registered field
    // (0.19.2 switched the resolver to UpdateSchema on edit and does not
    // diff-and-omit), so 400-on-present would fail every save on every generated
    // edit form for an entity carrying one. Clearing counts as a write, so the
    // FR-035 present-null arm never reaches it either.
    if (isWriteOnceMutability(child)) continue;
    // TPH subtype discriminator: omitted from the update schema entirely.
    if (tphPin !== undefined && child.name === tphPin.fieldName) continue;
    const autoSet = child.attr(FIELD_ATTR_AUTO_SET);
    if (autoSet === AUTO_SET_ON_CREATE) {
      // Omitted: creation timestamps cannot change after creation.
      continue;
    }
    if (autoSet === AUTO_SET_ON_UPDATE) {
      out.push({ name: child.name, optional: true, autoSet: true });
      continue;
    }
    // All non-autoSet fields are optional in the update schema (PATCH semantics).
    out.push({ name: child.name, optional: true });
  }
  return out;
}

export function renderZodValidators(obj: MetaObject, ctx?: RenderContext): Code {
  const z = imp("z@zod");
  const utcUsesBefore = utcTimestampUses;
  const decimalUsesBefore = decimalWriteUses;
  const autoGenPkFields = autoGenPkFieldNames(obj);
  const pkFields = primaryKeyFieldNames(obj);
  const assignedPkFields = assignedPkFieldNames(obj);
  const tphPin = tphDiscriminatorPin(obj);

  const insertFieldLines: Code[] = [];
  const updateFieldLines: Code[] = [];
  // #203 — the `insertPreserving` escape hatch's schema: same shape as the insert
  // schema, but @autoSet columns are written VERBATIM (no create-time now()
  // transform). Only emitted when the entity declares @autoSet fields.
  const preservingFieldLines: Code[] = [];
  const emitPreserving = hasAutoSetFields(obj);
  for (const child of obj.fields()) {
    if (autoGenPkFields.has(child.name)) continue;
    // FR-037 R1: an @mutability:"readOnly" field appears in neither InsertSchema
    // nor UpdateSchema. The DB / trigger / replication owns the write path; the app
    // must not pass these values in POST/PATCH bodies (routesFile enforces the same
    // contract at the boundary with a 400 response).
    // #213 — a derived (origin-bearing) field is read-only (FR-024 §7 / ADR-0028):
    // excluded from the Insert/Update/preserving schemas, exactly like readOnly.
    if (isReadOnlyMutability(child) || child.isDerived()) continue;

    // FR-017 Tier 1: TPH subtype pins its discriminator field to z.literal(...).
    // The discriminator is implicit on subtype rows (controlled by URL / insert
    // path) — the app never writes it via the body and never updates it.
    // Insert: pinned literal. Update: omitted entirely (clients can't change subtype).
    if (tphPin !== undefined && child.name === tphPin.fieldName) {
      const litLine = code`  ${child.name}: z.literal(${JSON.stringify(tphPin.value)})`;
      insertFieldLines.push(litLine);
      preservingFieldLines.push(litLine);
      continue;
    }

    const autoSet = child.attr(FIELD_ATTR_AUTO_SET);

    // Insert schema: @autoSet fields use transform (always override client input).
    if (autoSet === AUTO_SET_ON_CREATE || autoSet === AUTO_SET_ON_UPDATE) {
      insertFieldLines.push(
        ctx?.timestampMode === "date"
          // CRITICAL 1: these schemas validate raw JSON request bodies (wire
          // timestamps are ISO strings), never a live `Date` — z.coerce.date()
          // (not z.date()) so a string round-trips; z.date() rejects every JSON
          // wire value outright (verified: z.date().safeParse(isoString) is false).
          ? code`  ${child.name}: z.coerce.date().optional().transform(() => new Date())`
          : code`  ${child.name}: z.string().optional().transform(() => new Date().toISOString())`,
      );
      // Preserving schema: the @autoSet column is validated verbatim (its natural
      // field expr) so an import/restore keeps the caller's original timestamp.
      preservingFieldLines.push(code`  ${child.name}: ${zodFieldExpr(child, obj, ctx)}`);
    } else {
      // The preserving schema is an INSERT shape (import / restore / replication),
      // so an assigned PK is required there for the same typing reason.
      const fieldLine = code`  ${child.name}: ${zodFieldExpr(child, obj, ctx, isInsertRequiredPk(child, assignedPkFields))}`;
      insertFieldLines.push(fieldLine);
      preservingFieldLines.push(fieldLine);
    }

    // FR-037 R1 — "writeOnce": present in Insert + preserving (both are CREATE
    // shapes), absent from Update. Same mechanism that drops @autoSet onCreate
    // below; a value presented on PATCH is stripped, not 400'd (see
    // updateSchemaFields for the grounding).
    if (isWriteOnceMutability(child)) continue;

    // Update schema: @autoSet onCreate → omit entirely; onUpdate → transform
    if (autoSet === AUTO_SET_ON_CREATE) {
      // Omit: creation timestamps cannot be changed after creation
    } else if (autoSet === AUTO_SET_ON_UPDATE) {
      updateFieldLines.push(
        ctx?.timestampMode === "date"
          // CRITICAL 1: these schemas validate raw JSON request bodies (wire
          // timestamps are ISO strings), never a live `Date` — z.coerce.date()
          // (not z.date()) so a string round-trips; z.date() rejects every JSON
          // wire value outright (verified: z.date().safeParse(isoString) is false).
          ? code`  ${child.name}: z.coerce.date().optional().transform(() => new Date())`
          : code`  ${child.name}: z.string().optional().transform(() => new Date().toISOString())`,
      );
    } else {
      // All non-autoSet fields are optional in the update schema (PATCH semantics).
      // zodFieldExpr already appends .optional() when the field is non-required
      // OR has a default; only append once more when it didn't.
      const baseExpr = zodFieldExpr(child, obj, ctx);
      let expr = fieldWillBeOptional(child) ? baseExpr : code`${baseExpr}.optional()`;
      // FR-035 PATCH-2: a NON-@required field additionally accepts an explicit
      // null — a present null CLEARS the column (`.set({field: null})` writes NULL).
      // Keyed on required-ness, NOT fieldWillBeOptional: a required-with-@default
      // field stays non-nullable so an explicit null on it is a 400 (validation),
      // never a silent clear. PK fields are excluded: their Drizzle column is
      // always not-null, so a nullable Zod type would fail `.set()`'s typecheck
      // (and NOT NULL at runtime) — see primaryKeyFieldNames.
      if (!isRequired(child) && !pkFields.has(child.name)) expr = code`${expr}.nullable()`;
      updateFieldLines.push(code`  ${child.name}: ${expr}`);
    }
  }

  // ADR-0044/#228 — schema + type-alias names follow the object's EMITTED name.
  // For entities (never in the value-object collision set) and non-colliding value
  // objects this equals `obj.name` (byte-identical).
  const objName = ctx ? ctx.valueObjectEmittedName(obj) : obj.name;
  const insertSchemaName = `${objName}InsertSchema`;
  const updateSchemaName = `${objName}UpdateSchema`;
  const preservingSchemaName = `${objName}InsertPreservingSchema`;
  const { create: createName, patch: patchName } = entityTypeNames(obj, { name: objName });

  const docs = renderDocsFor(obj);
  const docsPrefix = docs ? `${docs}\n` : "";

  // #203 — emit the preserving insert-shape only for @autoSet entities (nothing to
  // preserve otherwise). Backs `insertPreserving<Entity>` (import/restore/replication).
  const preservingBlock = emitPreserving
    ? code`

/** Insert-shape for import / restore / replication of ${objName}: identical to
 * ${insertSchemaName}, but the @autoSet timestamp columns are written VERBATIM
 * (no create-time now() stamp) so the caller's original values are preserved. */
export const ${preservingSchemaName} = ${z}.object({
${joinCode(preservingFieldLines, { on: ",\n" })}
});

/** Typed input of \`insertPreserving${objName}\` — ${preservingSchemaName}'s pre-transform shape. */
export type ${objName}CreatePreserving = ${z}.input<typeof ${preservingSchemaName}>;`
    : code``;

  return code`
${utcTimestampHelperSince(utcUsesBefore)}${decimalHelperSince(decimalUsesBefore)}${docsPrefix}export const ${insertSchemaName} = ${z}.object({
${joinCode(insertFieldLines, { on: ",\n" })}
});

${docsPrefix}export const ${updateSchemaName} = ${z}.object({
${joinCode(updateFieldLines, { on: ",\n" })}
});

/** Typed create shape for ${objName}: the insert schema's INPUT (pre-transform) type. A
 * renamed/dropped/misspelt field is a compile error at every \`create${objName}\` call site;
 * the schema still validates at runtime. */
export type ${createName} = ${z}.input<typeof ${insertSchemaName}>;

/** Typed patch shape for ${objName}: every settable field, optional (FR-035 PATCH). A
 * renamed/dropped field is a compile error at every \`update${objName}\` call site. */
export type ${patchName} = ${z}.input<typeof ${updateSchemaName}>;${preservingBlock}
`;
}

/**
 * ADR-0036/0037 Wave 3 — the CANONICAL hostname matcher for @stringFormat:
 * hostname, emitted as a Zod `.regex(...)` literal. The matcher lives in codegen
 * (NOT author validator.regex) so every port can replicate the SAME canonical
 * form — cross-language regex engines diverge, so the byte-identical source of
 * truth is this one expression. RFC 1123 labels: 1–63 chars each, alphanumeric
 * + internal hyphens, dot-separated; total form anchored.
 */
const HOSTNAME_REGEX_LITERAL =
  "/^(?=.{1,253}$)([a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)(?:\\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/";

/** Zod expression for a scalar value subtype (used for a field.map's @valueType). */
function zodScalarFor(subType: string): string {
  if (subType === FIELD_SUBTYPE_INT || subType === FIELD_SUBTYPE_LONG || subType === FIELD_SUBTYPE_CURRENCY) return "z.number().int()";
  if (subType === FIELD_SUBTYPE_DOUBLE || subType === FIELD_SUBTYPE_FLOAT) return "z.number()";
  if (subType === FIELD_SUBTYPE_BOOLEAN) return "z.boolean()";
  // A map value is JSON in a jsonb column — always the ISO string, never a Date.
  if (subType === FIELD_SUBTYPE_DATE) return ZOD_DATE_EXPR;
  if (subType === FIELD_SUBTYPE_TIME) return ZOD_TIME_EXPR;
  if (subType === FIELD_SUBTYPE_TIMESTAMP) return ZOD_TIMESTAMP_EXPR;
  return "z.string()"; // string/uuid/decimal/enum on the wire
}

function zodFieldExpr(
  field: MetaField,
  owner?: MetaObject,
  ctx?: RenderContext,
  /** Suppress the trailing `.optional()`. Set by the insert-shape emitters for an
   *  assigned PK (see assignedPkFieldNames) and by the TPH read shape, where every
   *  column is a present key. The UPDATE shape must stay optional (PATCH semantics). */
  forceRequired = false,
  /** The TPH READ shape parses rows the database already holds, so it keeps the
   *  calendar/clock subtypes a bare `z.string()`: a row written before the write-side
   *  format check existed must still read back. Every other caller builds a WRITE shape. */
  readShape = false,
): Code {
  // `@dbColumnType: jsonb` on a scalar (legal only on field.string) is the
  // sanctioned "open JSON bag" escape hatch — a genuinely untyped JSON column
  // with no value-object to reference. Its Drizzle column is a bare `jsonb()`,
  // which node-postgres returns as a PARSED JS value (object/array/scalar), not
  // a string. Emitting `z.string()` here would 400-reject the real value on
  // insert and fail the same schema on read-back, contradicting the column type
  // AND the native-object runtime-return contract (ADR-0019). Emit `z.unknown()`
  // (jsonb holds any JSON value — same treatment as an objectRef-less
  // field.object below).
  if (field.attr(FIELD_ATTR_DB_COLUMN_TYPE) === DB_COLUMN_TYPE_JSONB) {
    let base: Code = code`z.unknown()`;
    if (field.resolvedIsArray()) base = code`z.array(${base})`;
    return appendValidatorChain(base, field, forceRequired);
  }

  // FIELD_SUBTYPE_OBJECT: emit z.array(<Ref>InsertSchema) / <Ref>InsertSchema
  // via an imp() so ts-poet hoists the cross-module import. Without this the
  // field used to collapse to z.string() / z.array(z.string()) and downstream
  // JSON Schema (e.g. LLM tool_use input_schema) lost the nested object shape.
  if (field.subType === FIELD_SUBTYPE_OBJECT) {
    const ref = field.attr(FIELD_ATTR_OBJECT_REF);
    if (typeof ref === "string" && ref.length > 0) {
      // @objectRef may be authored fully-qualified or bare. ADR-0044/#228 — the
      // referenced <Ref>InsertSchema is named by the value object's EMITTED name
      // (bare when unique in the run, package-qualified on a cross-package
      // short-name collision), resolved package-locally from the FIELD's declaring
      // package. The import MODULE is resolved via the shared
      // layout/package/extStyle-aware helper (the SAME one the field's TS type +
      // Drizzle .$type<> use) so all three agree. Without owner/ctx (bare
      // unit-test calls) fall back to the bare name + flat same-dir.
      const ownerPkg = (ctx && owner) ? effectivePackage(owner) : undefined;
      const refName = (ctx && owner) ? ctx.resolveValueObjectName(field) : stripPackage(ref);
      const moduleSpec = (ctx && owner)
        ? valueObjectModuleSpecifier(refName, ctx.packageOf, ownerPkg, ctx.outputLayout, ctx.extStyle)
        : `./${refName}.js`;
      const refImp = imp(`${refName}InsertSchema@${moduleSpec}`);
      let base: Code = code`${refImp}`;
      if (field.resolvedIsArray()) base = code`z.array(${base})`;
      return appendValidatorChain(base, field, forceRequired);
    }
    // No resolvable @objectRef — fall through to z.unknown(); downstream code
    // can still pass a value through but loses validation.
    let base: Code = code`z.unknown()`;
    if (field.resolvedIsArray()) base = code`z.array(${base})`;
    return appendValidatorChain(base, field, forceRequired);
  }

  // field.map → z.record(z.string(), V): value is a VO's InsertSchema (@objectRef)
  // or a scalar zod (@valueType). Keys are always strings.
  if (field.subType === FIELD_SUBTYPE_MAP) {
    const ref = field.attr(FIELD_ATTR_OBJECT_REF);
    if (typeof ref === "string" && ref.length > 0) {
      const ownerPkg = (ctx && owner) ? effectivePackage(owner) : undefined;
      const refName = (ctx && owner) ? ctx.resolveValueObjectName(field) : stripPackage(ref);
      const moduleSpec = (ctx && owner)
        ? valueObjectModuleSpecifier(refName, ctx.packageOf, ownerPkg, ctx.outputLayout, ctx.extStyle)
        : `./${refName}.js`;
      const refImp = imp(`${refName}InsertSchema@${moduleSpec}`);
      return appendValidatorChain(code`z.record(z.string(), ${refImp})`, field, forceRequired);
    }
    const vt = field.attr(FIELD_ATTR_VALUE_TYPE);
    return appendValidatorChain(code`z.record(z.string(), ${zodScalarFor(typeof vt === "string" ? vt : "string")})`, field, forceRequired);
  }

  let baseStr: string;
  switch (field.subType) {
    case FIELD_SUBTYPE_INT:
    case FIELD_SUBTYPE_CURRENCY:
    case FIELD_SUBTYPE_LONG:
      baseStr = "z.number().int()";
      break;
    case FIELD_SUBTYPE_DOUBLE:
    case FIELD_SUBTYPE_FLOAT:
      baseStr = "z.number()";
      break;
    case FIELD_SUBTYPE_BOOLEAN:
      baseStr = "z.boolean()";
      break;
    // Calendar date / time-of-day — always ISO-string-shaped, not governed by
    // timestampMode. A WRITE shape checks that shape (date-time-regex.ts); the TPH
    // READ shape keeps a bare string, so a row that predates the check still parses.
    case FIELD_SUBTYPE_DATE:
      baseStr = readShape ? "z.string()" : ZOD_DATE_EXPR;
      break;
    case FIELD_SUBTYPE_TIME: {
      // A MySQL TIME column refuses an offset (date-time-regex.ts). A value object's member
      // is JSON, which stores any string, so it keeps the portable check.
      const mysqlColumn = ctx?.dialect === "mysql" && owner?.subType !== OBJECT_SUBTYPE_VALUE;
      baseStr = readShape ? "z.string()" : mysqlColumn ? ZOD_TIME_NO_OFFSET_EXPR : ZOD_TIME_EXPR;
      break;
    }
    case FIELD_SUBTYPE_TIMESTAMP: {
      // Must agree with column-mapper.ts's mapColumnType, which already honors
      // ctx.timestampMode for the Drizzle column itself — z.string() here regardless would
      // disagree with a "date"-mode column (Date-typed) and fail to typecheck downstream
      // (reported against an adopting project).
      //
      // IMPORTANT 5: a VO-hosted (object.value) timestamp is jsonb storage —
      // inherently ISO-string JSON, never a live `Date` — so it stays z.string()
      // regardless of ctx.timestampMode; that matches the VO structural interface
      // (inferred-types.ts's SCALAR_TS_BY_SUBTYPE, deliberately NOT mode-aware —
      // the two are documented as lock-step). An entity/TPH-subtype field (a real
      // DB column) honors the mode.
      const voHosted = owner?.subType === OBJECT_SUBTYPE_VALUE;
      // CRITICAL 1: z.coerce.date() (not z.date()) — the ONE expression correct
      // for both readers of zodFieldExpr's output: the TPH read schema parses DB
      // rows (already a `Date` under pg date mode — z.coerce.date() passes a
      // Date through unchanged) while insert/update/preserving parse wire JSON
      // (an ISO string — z.coerce.date() parses it; z.date() would reject it).
      // A WRITE shape rewrites a zoned value to UTC (date-time-regex.ts) — except on an
      // @localTime field, which is a wall clock: shifting it would change its meaning.
      const localTime = field.attr(FIELD_ATTR_LOCAL_TIME) === true;
      baseStr = ctx?.timestampMode === "date" && !voHosted
        ? "z.coerce.date()"
        : readShape ? "z.string()" : localTime ? ZOD_TIMESTAMP_EXPR : ZOD_TIMESTAMP_UTC_EXPR;
      if (baseStr === ZOD_TIMESTAMP_UTC_EXPR) utcTimestampUses++;
      break;
    }
    case FIELD_SUBTYPE_ENUM: {
      const values = enumValues(field);
      if (values === undefined) {
        baseStr = "z.string()";
        break;
      }
      // FR-019: a field extending a MATERIALIZED root-level abstract enum uses the
      // shared `<E>Enum` Zod const (imported from ./enums) instead of inlining
      // z.enum([...]). A @provided enum keeps inline z.enum([...]) — validation
      // stays metaobjects-owned (the @values SSOT); only the TS type is external.
      // Inline enums (and bare-ctx unit-test calls) keep inlining as before.
      if (ctx !== undefined) {
        const shared = sharedEnumForField(field);
        if (shared !== undefined && !shared.provided) {
          const constName = sharedEnumZodConstName(shared.name);
          const spec = sharedEnumImportSpecifier(ctx, owner?.package);
          const sharedConst = imp(`${constName}@${spec}`);
          let base: Code = code`${sharedConst}`;
          if (field.resolvedIsArray()) base = code`z.array(${base})`;
          return appendValidatorChain(base, field, forceRequired);
        }
      }
      baseStr = zodEnumExpr(values);
      break;
    }
    case FIELD_SUBTYPE_URI:
      // ADR-0036/0037 Wave 3: a URI/URL string — codegen owns the canonical
      // URL matcher (Zod .url()), never author regex. #234: @lenient opts out
      // of well-formedness — bind a plain string.
      baseStr = field.attr(FIELD_ATTR_LENIENT) === true ? "z.string()" : "z.string().url()";
      break;
    case FIELD_SUBTYPE_INET:
      // ADR-0036/0037 Wave 3 + #234: an IP-address string (v4 or v6 literal) —
      // codegen owns the canonical IP matcher. Zod-version-agnostic regex union
      // (Zod 4 removed `z.string().ip()`); see net-regex.ts. @lenient → a plain string.
      baseStr = field.attr(FIELD_ATTR_LENIENT) === true ? "z.string()" : ZOD_INET_EXPR;
      break;
    case FIELD_SUBTYPE_STRING: {
      // ADR-0036/0037 Wave 3: @stringFormat narrows a plain string to a closed
      // validated format. The canonical matcher per format lives HERE (codegen),
      // not author validator.regex. The field stays a plain string.
      const fmt = field.attr(FIELD_ATTR_STRING_FORMAT);
      if (fmt === STRING_FORMAT_EMAIL) {
        baseStr = "z.string().email()";
      } else if (fmt === STRING_FORMAT_HOSTNAME) {
        baseStr = `z.string().regex(${HOSTNAME_REGEX_LITERAL})`;
      } else {
        baseStr = "z.string()";
      }
      break;
    }
    case FIELD_SUBTYPE_DECIMAL: {
      // ADR-0019 Amendment 1 (W2, W3): a WRITE shape takes a decimal as a string in the
      // JSON-number grammar or a JSON number, stores its canonical string, and refuses what the
      // column cannot hold. A decimal inside a jsonb value object follows the same rule (captain
      // ruling C1: its @precision / @scale bound it, the stored JSON holds the canonical string).
      // Only the TPH read shape, which parses rows the database already holds, keeps a bare string.
      if (readShape) {
        baseStr = "z.string()";
        break;
      }
      const precision = field.attr(FIELD_ATTR_PRECISION);
      const scale = field.attr(FIELD_ATTR_SCALE);
      baseStr = zodDecimalWriteExpr(
        typeof precision === "number" ? precision : undefined,
        typeof scale === "number" ? scale : undefined,
      );
      decimalWriteUses++;
      break;
    }
    case FIELD_SUBTYPE_UUID:
    default:
      baseStr = "z.string()";
      break;
  }

  if (field.resolvedIsArray()) baseStr = `z.array(${baseStr})`;
  return appendValidatorChain(code`${baseStr}`, field, forceRequired);
}

/** Mirrors the optional-or-not decision inside appendValidatorChain so the update-schema
 *  caller can avoid stacking a second `.optional()` onto an already-optional expression. */
function fieldWillBeOptional(field: MetaField): boolean {
  const hasDefault = field.attr(FIELD_ATTR_DEFAULT) !== undefined;
  return !isRequired(field) || hasDefault;
}

/** Numeric field subtypes whose Zod base is `z.number()` — value bounds apply. */
const NUMERIC_FIELD_SUBTYPES = new Set<string>([
  FIELD_SUBTYPE_INT, FIELD_SUBTYPE_LONG, FIELD_SUBTYPE_CURRENCY,
  FIELD_SUBTYPE_DOUBLE, FIELD_SUBTYPE_FLOAT,
]);

/** Append .min/.max/.regex/.optional() based on field-level validators + required state.
 *
 * Bound semantics by field shape:
 *  - string (scalar)        → .min/.max = character count (validator.length + @maxLength)
 *  - numeric (scalar)       → .min/.max = numeric value     (validator.numeric)
 *  - array (any element)    → .min/.max = element count     (validator.array)
 */
function appendValidatorChain(base: Code, field: MetaField, forceRequired = false): Code {
  let isRequired = field.attr(FIELD_ATTR_REQUIRED) === true;
  let maxLen: number | undefined = field.attr(FIELD_ATTR_MAX_LENGTH) as number | undefined;
  let minLen: number | undefined;
  let pattern: string | undefined;
  let numMin: number | undefined;
  let numMax: number | undefined;
  let arrMin: number | undefined;
  let arrMax: number | undefined;
  for (const child of field.validators()) {
    if (child.subType === VALIDATOR_SUBTYPE_REQUIRED) isRequired = true;
    // ADR-0039: resolving — a validator may inherit @min/@max/@pattern via extends
    // (matches Java attrInt's resolving getMetaAttr(attr)).
    if (child.subType === VALIDATOR_SUBTYPE_LENGTH) {
      const max = child.attr(VALIDATOR_ATTR_MAX);
      const min = child.attr(VALIDATOR_ATTR_MIN);
      // FR-036 A3: @maxLength × validator.length @max = strictest-wins (min).
      // maxLen already carries the field-level @maxLength; fold the validator's
      // @max in as a lower bound so the effective cap is min(@maxLength, @max).
      if (typeof max === "number") maxLen = maxLen === undefined ? max : Math.min(maxLen, max);
      if (typeof min === "number") minLen = min;
    }
    if (child.subType === VALIDATOR_SUBTYPE_REGEX) {
      const p = child.attr(VALIDATOR_ATTR_PATTERN);
      if (typeof p === "string") pattern = p;
    }
    if (child.subType === VALIDATOR_SUBTYPE_NUMERIC) {
      const max = child.attr(VALIDATOR_ATTR_MAX);
      const min = child.attr(VALIDATOR_ATTR_MIN);
      if (typeof max === "number") numMax = max;
      if (typeof min === "number") numMin = min;
    }
    if (child.subType === VALIDATOR_SUBTYPE_ARRAY) {
      const max = child.attr(VALIDATOR_ATTR_MAX);
      const min = child.attr(VALIDATOR_ATTR_MIN);
      if (typeof max === "number") arrMax = max;
      if (typeof min === "number") arrMin = min;
    }
  }

  // A `field.string` + `@dbColumnType: jsonb` open bag has a `z.unknown()` base, so
  // the string character-count validators (.min/.max/.regex) do NOT apply — chaining
  // `.min(1)` for a required bag yields `z.unknown().min(1)`, a TS compile error.
  // "Required" for an open bag means non-optional only (handled by the optional()
  // logic below). A jsonb ARRAY still gets element-count bounds via the array branch.
  const isJsonbBag = field.attr(FIELD_ATTR_DB_COLUMN_TYPE) === DB_COLUMN_TYPE_JSONB;

  let chain: Code = base;
  // Array element-count bounds apply to the z.array(...) wrapper regardless of element type.
  if (field.resolvedIsArray()) {
    if (arrMin !== undefined) chain = code`${chain}.min(${arrMin})`;
    if (arrMax !== undefined) chain = code`${chain}.max(${arrMax})`;
  } else if (field.subType === FIELD_SUBTYPE_STRING && !isJsonbBag) {
    // FR-036 Pin 1: a @required string is non-empty by default (implicit floor of
    // 1) — but an explicitly authored `validator.length @min` is ALWAYS
    // authoritative over that floor (#224 / ADR-0044): `@min: 0` opts back to
    // presence-only, restoring "must be provided, may be empty". The floor
    // applies only when no @min was authored at all. A non-required field keeps
    // its authored @min unchanged (undefined -> 0, i.e. no minimum).
    const effectiveMin = minLen !== undefined ? minLen : isRequired ? 1 : 0;
    if (effectiveMin > 0) chain = code`${chain}.min(${effectiveMin})`;
    if (maxLen !== undefined) chain = code`${chain}.max(${maxLen})`;
    if (pattern !== undefined) {
      // FR-036 Pin 2: validator.regex @pattern is FULL-MATCH — the whole value
      // must match. JS RegExp.test searches, so anchor as ^(?:…)$ (always-wrap;
      // a redundant anchor on an already-anchored pattern still matches identically).
      const anchored = `^(?:${pattern})$`;
      chain = code`${chain}.regex(new RegExp(${JSON.stringify(anchored)}))`;
    }
  } else if (NUMERIC_FIELD_SUBTYPES.has(field.subType)) {
    if (numMin !== undefined) chain = code`${chain}.min(${numMin})`;
    if (numMax !== undefined) chain = code`${chain}.max(${numMax})`;
  }

  // An assigned PK is insert-REQUIRED whatever @required says — its Drizzle
  // column has no default, so an optional value cannot typecheck into
  // `.values()`. Only the caller knows this (the update/read shapes must stay
  // optional), hence the explicit opt-in. See assignedPkFieldNames.
  if (forceRequired) return chain;

  // Fields with DB-level defaults are optional in the InsertSchema: the caller
  // can omit them and the DB will fill in. Otherwise required-with-default
  // would force callers to repeat the default at every call site.
  const hasDefault = field.attr(FIELD_ATTR_DEFAULT) !== undefined;
  if (!isRequired || hasDefault) chain = code`${chain}.optional()`;
  return chain;
}
