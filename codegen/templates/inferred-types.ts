// Inferred types template — emits Drizzle's InferSelectModel / InferInsertModel type aliases,
// plus named union types for field.enum fields.
//
// Also emits the structural TS interface for value-only objects (metaobjects
// with no writable source.rdb). That path side-steps Drizzle entirely: the
// interface is computed directly from the field tree, with `name?: T` for
// optional fields (matching Zod's `.optional()` inference — `T | undefined` —
// without the superfluous `| null` that Drizzle nullable columns introduce).

import { code, imp, joinCode, type Code } from "@metaobjectsdev/codegen-ts/engine";
import type { MetaObject, MetaField } from "@metaobjectsdev/metadata";
import {
  FIELD_SUBTYPE_ENUM,
  FIELD_SUBTYPE_OBJECT,
  FIELD_SUBTYPE_MAP,
  FIELD_SUBTYPE_STRING,
  FIELD_SUBTYPE_INT,
  FIELD_SUBTYPE_LONG,
  FIELD_SUBTYPE_DOUBLE,
  FIELD_SUBTYPE_FLOAT,
  FIELD_SUBTYPE_DECIMAL,
  FIELD_SUBTYPE_CURRENCY,
  FIELD_SUBTYPE_BOOLEAN,
  FIELD_SUBTYPE_DATE,
  FIELD_SUBTYPE_TIME,
  FIELD_SUBTYPE_TIMESTAMP,
  FIELD_SUBTYPE_UUID,
  FIELD_SUBTYPE_URI,
  FIELD_SUBTYPE_INET,
  FIELD_ATTR_REQUIRED,
  FIELD_ATTR_OBJECT_REF,
  FIELD_ATTR_VALUE_TYPE,
  FIELD_ATTR_DB_COLUMN_TYPE,
  DB_COLUMN_TYPE_JSONB,
} from "@metaobjectsdev/metadata";
import { variableNameFromEntity, toPascalCase } from "@metaobjectsdev/codegen-ts/engine";
import { valueObjectModuleSpecifier } from "@metaobjectsdev/codegen-ts/engine";
import { stripPackage } from "@metaobjectsdev/metadata";
import { enumValues } from "@metaobjectsdev/codegen-ts/engine";
import { sharedEnumZodConstName } from "./enums-file.js";
import { renderDocsFor } from "./jsdoc.js";
import { isTphReadNullTolerant } from "./zod-validators.js";
import { sharedEnumForField } from "@metaobjectsdev/codegen-ts/engine";
import { sharedEnumImportSpecifier, providedEnumImportSpecifier } from "@metaobjectsdev/codegen-ts/engine";
import type { RenderContext } from "@metaobjectsdev/codegen-ts/engine";
import { effectivePackage } from "@metaobjectsdev/codegen-ts/engine";

/**
 * Emit Drizzle's InferSelectModel / InferInsertModel aliases for an entity.
 *
 * `tphBase` (FR-017): when this entity is a TPH discriminator base, the
 * discriminated-union type (emitted by the tph-discriminator template) owns the
 * bare `<Base>` name, so the raw single-table row type is emitted as `<Base>Row`
 * to avoid a duplicate `export type <Base>`. Insert/Update keep their names
 * (no collision); they describe the physical TPH table row shape.
 */
export function renderInferredTypes(
  entity: MetaObject,
  tphBase = false,
  ctx?: RenderContext,
  skipRow = false,
): Code {
  // The inferred Row/Insert types reference the Drizzle table var, so they must
  // resolve to the SAME (possibly overridden) collection name the schema emits.
  // ctx is optional for bare unit-test calls — those fall back to the default
  // always-pluralize spelling.
  const varName = ctx ? ctx.collectionName(entity.name) : variableNameFromEntity(entity.name);
  // Type-only symbols (t: prefix) so ts-poet emits `import type` — otherwise a
  // value import of these types fails tsc under `verbatimModuleSyntax` (TS1484). (#165)
  const selectSym = imp("t:InferSelectModel@drizzle-orm");
  const insertSym = imp("t:InferInsertModel@drizzle-orm");
  const docs = renderDocsFor(entity);
  const docsPrefix = docs ? `${docs}\n` : "";
  const rowName = tphBase ? `${entity.name}Row` : entity.name;
  // #214 — a write-through entity read-view routes READS to the replica view, so the
  // read row type <Entity> is emitted from the VIEW's read schema (z.infer, carrying
  // the derived fields) by the entity-file composer, NOT here. `skipRow` suppresses
  // the table-inferred Row so there is no duplicate `export type <Entity>` (selectSym
  // then goes unreferenced and ts-poet drops its import). Insert/Update always stay
  // inferred from the write TABLE (derived-free, #213).
  if (skipRow) {
    return code`
export type ${entity.name}Insert = ${insertSym}<typeof ${varName}>;
export type ${entity.name}Update = Partial<${entity.name}Insert>;
`;
  }
  return code`
${docsPrefix}export type ${rowName} = ${selectSym}<typeof ${varName}>;
export type ${entity.name}Insert = ${insertSym}<typeof ${varName}>;
export type ${entity.name}Update = Partial<${entity.name}Insert>;
`;
}

/**
 * The string-literal-union type-alias name for a `field.enum` field — the SINGLE
 * source of truth for enum-union naming (reused by the entity inferred-types
 * emitter, the payload-VO emitter and the extractor so all agree byte-for-byte).
 *
 * - A field that resolves to a shared enum declaration (through any number of
 *   `extends` hops) takes that declaration's PascalCase name — the one type every
 *   consumer of the declaration references.
 * - Otherwise the enum is inline. One that extends another field keeps that
 *   immediate super's PascalCase name; one with no super is `<Owner><FieldPascal>`,
 *   where `<Owner>` is the owning object's name (entity OR payload value-object).
 */
export function enumUnionAliasName(ownerName: string, field: MetaField): string {
  const shared = sharedEnumForField(field);
  if (shared !== undefined) return shared.name;
  const superField = field.resolveSuper();
  return superField !== undefined
    ? toPascalCase(superField.name)
    : `${ownerName}${toPascalCase(field.name)}`;
}

/** The `"A" | "B"` union string for a set of enum member values. */
export function enumUnionString(values: string[]): string {
  return values.map((v) => JSON.stringify(v)).join(" | ");
}

/**
 * Emit the enum type-alias section for an entity file. Three cases per field:
 *
 *  • inline enum (members declared directly on the field; no root-abstract super)
 *    → `export type <Entity><Field> = "A" | "B";` — UNCHANGED (byte-identical).
 *  • shared materialized enum (extends a NON-@provided root-level abstract
 *    field.enum) → re-export the materialized type from the shared `./enums`
 *    module (`export { type E } from "./enums"`) instead of redeclaring it. The
 *    type is materialized ONCE in enums.ts (FR-019).
 *  • provided enum (extends a @provided root-level abstract field.enum) →
 *    re-export the type from the configured external module
 *    (`export { type E } from "<providedEnumModule>"`); metaobjects emits no
 *    declaration for it. A missing config is a codegen-time error.
 *
 * `ctx` is required to compute the shared/provided import specifiers. Returns
 * null when the entity has no enum-alias lines to emit.
 */
export function renderEnumTypeAliases(entity: MetaObject, ctx?: RenderContext): Code | null {
  // De-duplicate by type-alias name — multiple fields can extend the same abstract enum.
  const seen = new Set<string>();
  const lines: Code[] = [];
  // ADR-0044/#228 — an inline enum's alias is `<Owner><Field>`; `<Owner>` is this
  // object's EMITTED name so a collision-qualified value object declares (and its
  // interface references) `AcmeAlphaNoteStatus`, not a bare `NoteStatus`. Entities
  // and non-colliding value objects keep their bare name (byte-identical).
  const ownerName = ctx ? ctx.valueObjectEmittedName(entity) : entity.name;

  for (const field of entity.fields()) {
    if (field.subType !== FIELD_SUBTYPE_ENUM) continue;

    const values = enumValues(field);
    if (values === undefined) continue;

    const typeName = enumUnionAliasName(ownerName, field);
    if (seen.has(typeName)) continue;
    seen.add(typeName);

    // Without a RenderContext (bare unit-test calls) the shared/provided import
    // specifiers can't be computed — fall back to inline emission. Real runs
    // always pass ctx (entity-file template), so shared materialization applies.
    const shared = ctx !== undefined ? sharedEnumForField(field) : undefined;
    if (shared === undefined) {
      // Inline enum — the literal union, PLUS a named runtime constant.
      //
      // The type alias alone is erased at runtime, so hand-written code that needs a
      // MEMBER had nothing to import and wrote the symbol as a literal — while the same
      // list appeared three or four more times in this one generated file (the Drizzle
      // `enum:` option and each Zod schema). A package-level SHARED enum has always had
      // a runtime constant (`<E>Enum` in the shared enums module); an inline one had
      // none anywhere, so "use the constant, not a magic string" was advice an adopter
      // could not follow. Same name-shape as the shared one, so which kind of enum it is
      // stops mattering at the call site.
      //
      // `.options` is the member array and `.enum.<Member>` the individual symbol, in
      // both Zod 3 and Zod 4 — generated code here must be safe on both.
      lines.push(code`export type ${typeName} = ${enumUnionString(values)};`);
      lines.push(
        code`export const ${sharedEnumZodConstName(typeName)} = ${imp("z@zod")}.enum([${values
          .map((v) => JSON.stringify(v))
          .join(", ")}]);`,
      );
      continue;
    }
    // Shared / provided enum — re-export from the materialized module or the
    // configured external module; never redeclare the union here.
    const spec = shared.provided
      ? providedEnumImportSpecifier(ctx!, shared.name)
      : sharedEnumImportSpecifier(ctx!, effectivePackage(entity));
    // Re-export the runtime constant beside the type for a MATERIALIZED shared enum, so a
    // consumer reaches its members the same way it reaches an inline enum's, without having
    // to know which kind it is or which module the shared one landed in.
    //
    // NOT for a `@provided` enum. That declaration lives in a module the ADOPTER owns and
    // configured, and nothing here knows or can require that it exports a Zod constant —
    // naming one would emit an import of a symbol that may not exist and fail their build.
    // Only the type is contracted for a provided enum, and only the type is re-exported.
    lines.push(
      shared.provided
        ? code`export { type ${shared.name} } from ${JSON.stringify(spec)};`
        : code`export { type ${shared.name}, ${sharedEnumZodConstName(shared.name)} } from ${JSON.stringify(spec)};`,
    );
  }

  return lines.length > 0 ? joinCode(lines, { on: "\n" }) : null;
}

// ---------------------------------------------------------------------------
// Value-object interface emitter
// ---------------------------------------------------------------------------

const SCALAR_TS_BY_SUBTYPE: Record<string, string> = {
  [FIELD_SUBTYPE_STRING]: "string",
  [FIELD_SUBTYPE_UUID]: "string",
  // ADR-0036/0037 Wave 3: uri/inet bind to TS `string` (TS has no native URI/IP
  // type, same as uuid). Other ports bind to their native URI/IP type.
  [FIELD_SUBTYPE_URI]: "string",
  [FIELD_SUBTYPE_INET]: "string",
  [FIELD_SUBTYPE_INT]: "number",
  [FIELD_SUBTYPE_LONG]: "number",
  [FIELD_SUBTYPE_DOUBLE]: "number",
  [FIELD_SUBTYPE_FLOAT]: "number",
  // field.decimal is precision-exact: Drizzle's pg `numeric` column infers as
  // `string` (the driver returns NUMERIC as a string to avoid float rounding),
  // so the value-object/structural-interface scalar mapping must match.
  [FIELD_SUBTYPE_DECIMAL]: "string",
  [FIELD_SUBTYPE_CURRENCY]: "number",
  [FIELD_SUBTYPE_BOOLEAN]: "boolean",
  [FIELD_SUBTYPE_DATE]: "string",
  [FIELD_SUBTYPE_TIME]: "string",
  [FIELD_SUBTYPE_TIMESTAMP]: "string",
};

/**
 * The PLAIN-STRING TS type expression for a field — the SINGLE source of truth
 * for "what TS type does the codegen give this field". `valueObjectFieldType`
 * (which returns a `Code` so cross-module `field.object` refs hoist via
 * `imp(...)`) makes the SAME per-branch decisions; this string form exists for
 * consumers (the api-docs field-shape builder) that need the type name as text,
 * not a hoisting `Code`. The branch logic MUST stay in lock-step with
 * `valueObjectFieldType` below.
 *
 *  • field.object → the referenced object's bare (package-stripped) name, `[]`
 *    when an array; `unknown` / `unknown[]` when the @objectRef is missing.
 *  • field.enum   → the same enum-union alias `enumUnionAliasName` emits
 *    (`<Owner><Field>` or the abstract super's PascalCase), `string` fallback.
 *  • scalar       → SCALAR_TS_BY_SUBTYPE (else `unknown`), `[]` when an array.
 */
export function fieldTsTypeString(ownerName: string, field: MetaField): string {
  // `@dbColumnType: jsonb` (open JSON bag, legal only on field.string) → `unknown`:
  // the column is a bare `jsonb()` returning any parsed JSON value, so the TS type
  // stays in lock-step with the `z.unknown()` Zod emission (NOT `string`).
  if (field.attr(FIELD_ATTR_DB_COLUMN_TYPE) === DB_COLUMN_TYPE_JSONB) {
    return field.resolvedIsArray() ? "unknown[]" : "unknown";
  }
  if (field.subType === FIELD_SUBTYPE_OBJECT) {
    const ref = field.attr(FIELD_ATTR_OBJECT_REF);
    if (typeof ref === "string" && ref.length > 0) {
      // #228: docs-tier bare name under collision — this is the docs-tier
      // TEXT-shape helper (no ctx/root in scope; callers api-field-shape run under
      // api-model's `{ pkMap } as RenderContext` shim), so it can't resolve the ADR-0044
      // emitted name. Byte-identical to codegen in every non-colliding model; on a
      // cross-package collision it documents the bare `Note` while codegen emits
      // `AcmeAlphaNote`. Threading a real RenderContext into api-docs is out of scope.
      const base = stripPackage(ref);
      return field.resolvedIsArray() ? `${base}[]` : base;
    }
    return field.resolvedIsArray() ? "unknown[]" : "unknown";
  }
  if (field.subType === FIELD_SUBTYPE_ENUM) {
    const values = enumValues(field);
    if (values !== undefined) {
      // The emitted TS type is an enum-union ALIAS (`<Owner><Field>`), but its
      // definition IS this literal union — inline it so the documented shape is
      // self-contained (an agent sees the exact allowed values, not an opaque
      // alias name). Array enums wrap the parenthesized union: `(A | B)[]`.
      const union = enumUnionString(values);
      return field.resolvedIsArray() ? `(${union})[]` : union;
    }
    return field.resolvedIsArray() ? "string[]" : "string";
  }
  const scalar = SCALAR_TS_BY_SUBTYPE[field.subType] ?? "unknown";
  return field.resolvedIsArray() ? `${scalar}[]` : scalar;
}

/**
 * One-line TS type expression for a field on a value-only object.
 * Returns a `Code` so cross-module `field.object` refs can be hoisted via
 * ts-poet `imp(...)` — matching how the Zod emitter hoists `<Ref>InsertSchema`.
 */
function valueObjectFieldType(entity: MetaObject, field: MetaField, ctx?: RenderContext): Code {
  // ADR-0044/#228 — the owning value-object's EMITTED name (bare when unique in
  // the run, package-qualified on a cross-package short-name collision). Drives
  // the inline enum-union alias so it matches the alias declared for this object.
  const ownerName = ctx ? ctx.valueObjectEmittedName(entity) : entity.name;
  // `@dbColumnType: jsonb` (open JSON bag) → `unknown`, in lock-step with
  // fieldTsTypeString above and the `z.unknown()` Zod emission.
  if (field.attr(FIELD_ATTR_DB_COLUMN_TYPE) === DB_COLUMN_TYPE_JSONB) {
    return field.resolvedIsArray() ? code`unknown[]` : code`unknown`;
  }
  // field.object: import the referenced TS interface from its sibling module
  // so ts-poet hoists the import. Mirrors zod-validators.ts's `<Ref>InsertSchema`
  // import strategy, just for the type alias instead of the schema constant.
  if (field.subType === FIELD_SUBTYPE_OBJECT) {
    const ref = field.attr(FIELD_ATTR_OBJECT_REF);
    if (typeof ref === "string" && ref.length > 0) {
      // @objectRef may be authored fully-qualified (acme::sales::Brief) or bare.
      // ADR-0044/#228 — the referenced interface is named by its EMITTED name
      // (bare when unique in the run, package-qualified on a cross-package
      // short-name collision), resolved package-locally from the FIELD's declaring
      // package. The import MODULE is resolved through the shared
      // layout/package/extStyle-aware helper (the SAME one the Zod schema +
      // Drizzle .$type<> use) so all three agree. Without a ctx (bare unit-test
      // calls) fall back to the bare name + flat same-dir specifier.
      const entityPkg = effectivePackage(entity);
      const refName = ctx ? ctx.resolveValueObjectName(field) : stripPackage(ref);
      const moduleSpec = ctx
        ? valueObjectModuleSpecifier(refName, ctx.packageOf, entityPkg, ctx.outputLayout, ctx.extStyle)
        : `./${refName}.js`;
      // `t:` — the interface is a TYPE. Without it ts-poet merges it with the Zod
      // `<Ref>InsertSchema` VALUE from the same module into one value import, which is
      // TS1484 under `verbatimModuleSyntax` (on in a fresh `tsc --init`). Same rule as
      // the shared-enum branch below (#341).
      const refImp = imp(`t:${refName}@${moduleSpec}`);
      return field.resolvedIsArray() ? code`${refImp}[]` : code`${refImp}`;
    }
    return field.resolvedIsArray() ? code`unknown[]` : code`unknown`;
  }

  // field.map: Record<string, V> — V is a value-object (@objectRef) or a scalar (@valueType).
  if (field.subType === FIELD_SUBTYPE_MAP) {
    const ref = field.attr(FIELD_ATTR_OBJECT_REF);
    if (typeof ref === "string" && ref.length > 0) {
      const entityPkg = effectivePackage(entity);
      const refName = ctx ? ctx.resolveValueObjectName(field) : stripPackage(ref);
      const moduleSpec = ctx
        ? valueObjectModuleSpecifier(refName, ctx.packageOf, entityPkg, ctx.outputLayout, ctx.extStyle)
        : `./${refName}.js`;
      const refImp = imp(`t:${refName}@${moduleSpec}`);
      return code`Record<string, ${refImp}>`;
    }
    const vt = field.attr(FIELD_ATTR_VALUE_TYPE);
    const scalar = (typeof vt === "string" ? SCALAR_TS_BY_SUBTYPE[vt] : undefined) ?? "string";
    return code`Record<string, ${scalar}>`;
  }

  // field.enum: use the same type-alias name as renderEnumTypeAliases emits.
  if (field.subType === FIELD_SUBTYPE_ENUM) {
    const values = enumValues(field);
    if (values !== undefined) {
      const alias = enumUnionAliasName(ownerName, field);
      // FR-019: a shared/provided enum's type lives in another module (./enums or
      // the provided module). The `t:` prefix is load-bearing (#341) — it is what
      // makes ts-poet hoist `import { type E }` rather than a VALUE import. Without
      // it the enum's TYPE and its Zod VALUE (`<E>Enum`) merge into one value
      // import, which is a hard TS1484 under `verbatimModuleSyntax: true` — the
      // default in current Vite/TS templates — so generated code the adopter cannot
      // edit fails to compile. Invisible with the flag off, which is why it shipped.
      // Inline enums reference the locally-declared `<Entity><Field>` alias.
      if (ctx !== undefined) {
        const shared = sharedEnumForField(field);
        if (shared !== undefined) {
          const spec = shared.provided
            ? providedEnumImportSpecifier(ctx, shared.name)
            : sharedEnumImportSpecifier(ctx, effectivePackage(entity));
          const sym = imp(`t:${shared.name}@${spec}`);
          return field.resolvedIsArray() ? code`${sym}[]` : code`${sym}`;
        }
      }
      return field.resolvedIsArray() ? code`${alias}[]` : code`${alias}`;
    }
    return field.resolvedIsArray() ? code`string[]` : code`string`;
  }

  const scalar = SCALAR_TS_BY_SUBTYPE[field.subType] ?? "unknown";
  return field.resolvedIsArray() ? code`${scalar}[]` : code`${scalar}`;
}

/**
 * Emit a structural `interface <Name> { ... }` for a value-only object.
 *
 * Optional fields use `name?: T | undefined` (exactly the Zod `.optional()`
 * inference) instead of `name?: T | null`. Value objects never round-trip
 * through Drizzle nullable columns, so the null-bridge is unnecessary here —
 * and forces consumers into a residual cast at the call site.
 *
 * The explicit `| undefined` is load-bearing under `exactOptionalPropertyTypes`
 * (on in a fresh `tsc --init`): there a bare `name?: T` refuses the
 * `name?: T | undefined` a Zod `.optional()` output carries, so the generated
 * response parser (which returns this interface from `schema.parse(...)`) and a
 * jsonb column typed `$type<ThisInterface>()` fail TS2375. Without the option the
 * two spellings are the same type, so nothing else changes.
 */
export function renderValueObjectInterface(entity: MetaObject, ctx?: RenderContext): Code {
  const docs = renderDocsFor(entity);
  const docsPrefix = docs ? `${docs}\n` : "";
  // ADR-0044/#228 — the declared interface name is this value object's EMITTED
  // name (bare when unique in the run, package-qualified on a cross-package
  // short-name collision). Byte-identical (bare) when there is no collision.
  const objName = ctx ? ctx.valueObjectEmittedName(entity) : entity.name;

  const lines: Code[] = [];
  for (const field of entity.fields()) {
    const required = field.attr(FIELD_ATTR_REQUIRED) === true;
    const optional = required ? "" : "?";
    const undefinedArm = required ? "" : " | undefined";
    const tsType = valueObjectFieldType(entity, field, ctx);
    // A TPH subtype's read schema accepts `null` for a column that is NULL on a
    // sibling subtype's row; the declared type has to admit the same values, or
    // `parse<Base>()` returns something this interface rejects. One predicate
    // answers it for both emitters (ADR-style single source, see its docblock).
    const nullable = isTphReadNullTolerant(entity, field) ? " | null" : "";
    lines.push(code`  ${field.name}${optional}: ${tsType}${nullable}${undefinedArm};`);
  }

  // joinCode with "\n" interpolates each Code segment on its own line and
  // keeps the imp() registrations intact so ts-poet hoists the imports.
  return code`${docsPrefix}export interface ${objName} {
${joinCode(lines, { on: "\n" })}
}
`;
}
