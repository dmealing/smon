// Filter type template — emits <Entity>Filter type with subtype-gated operators.
// String fields get eq/ne/in/like; numbers get eq/ne/gt/gte/lt/lte/in; booleans get eq/isNull only;
// datetimes get eq/ne/gt/gte/lt/lte/in. An enum's operand type is its member union.

import { code, type Code } from "@metaobjectsdev/codegen-ts/engine";
import { MetaField, MetaObject } from "@metaobjectsdev/metadata";
import {
  FIELD_ATTR_FILTERABLE,
  FIELD_SUBTYPE_BOOLEAN,
  FIELD_SUBTYPE_INT,
  FIELD_SUBTYPE_LONG,
  FIELD_SUBTYPE_DOUBLE,
  FIELD_SUBTYPE_FLOAT,
  FIELD_SUBTYPE_CURRENCY,
  FIELD_SUBTYPE_ENUM,
  opsForField,
} from "@metaobjectsdev/metadata";
import { isSortableField } from "./filter-shared.js";
import { enumValues } from "@metaobjectsdev/codegen-ts/engine";

// currency is integer minor units (allowlist `integer: true`, row schema `z.number().int()`).
// VALUE-type classification only (distinct from the OPERATOR band, which comes from
// opsForSubType). decimal is deliberately NOT here: its operator band stays NUMERIC
// (eq/ne/gt/gte/lt/lte/in/isNull, see OPS_BY_SUBTYPE) but its VALUE type is `string`,
// matching the entity field representation (exact decimal string, not lossy number).
const NUMBER_VALUE_SUBTYPES = new Set<string>([
  FIELD_SUBTYPE_INT,
  FIELD_SUBTYPE_LONG,
  FIELD_SUBTYPE_DOUBLE,
  FIELD_SUBTYPE_FLOAT,
  FIELD_SUBTYPE_CURRENCY,
]);

/**
 * The TS VALUE type a field's filter operands carry.
 *
 * A `field.enum` declaring `@values` narrows to its member union, so a misspelt member is
 * a compile error instead of an empty result. That holds for an int-backed enum
 * (`@intValueMap`) too: the wire value is still the member SYMBOL, which runtime-ts maps
 * to its integer. Read through the resolving accessor (ADR-0039) inside `enumValues`, so
 * a field inheriting `@values` from an abstract enum narrows as well.
 */
function tsNameFor(field: MetaField): string {
  if (field.subType === FIELD_SUBTYPE_BOOLEAN) return "boolean";
  if (NUMBER_VALUE_SUBTYPES.has(field.subType)) return "number";
  if (field.subType === FIELD_SUBTYPE_ENUM) {
    const values = enumValues(field);
    if (values !== undefined && values.length > 0) {
      return values.map((v) => JSON.stringify(v)).join(" | ");
    }
  }
  return "string";
}

function renderFieldUnion(field: MetaField): string {
  // opsForField, not opsForSubType — an int-backed field.enum (@intValueMap) stores
  // as an integer, so `like` is not in its band. The client type and the server
  // allowlist MUST agree: offering `like` here that the allowlist 400s is a
  // client/server mismatch of exactly the kind filter-shared.ts exists to prevent.
  const ops = opsForField(field);
  const tsName = tsNameFor(field);
  // A member union needs parentheses before `[]`; a single type name does not.
  const elementType = tsName.includes(" | ") ? `(${tsName})` : tsName;
  const opEntries = ops.map((op) => {
    if (op === "in") return `in?: ${elementType}[]`;
    if (op === "isNull") return `isNull?: boolean`;
    // `like` takes a PATTERN, never a member — it stays a string even on an enum (the
    // band itself is pinned cross-port by fixtures/conformance/filter-ops-matrix).
    if (op === "like") return `like?: string`;
    return `${op}?: ${tsName}`;
  });
  return `${tsName} | { ${opEntries.join("; ")} }`;
}

/**
 * `exclude` (FR-017): drop a field from the client filter type. Used by
 * per-subtype TPH filter types to omit the discriminator (it's pinned by the
 * per-subtype route path), keeping the client `<Sub>Filter` type aligned with
 * the server's per-subtype allowlist.
 */
export function renderFilterType(entity: MetaObject, exclude?: string): Code {
  // fields() returns effective fields, so inherited fields (from extends:/super:) are included in filter types.
  const allFields = entity.fields().filter((c) => c.name !== exclude);
  const filterableFieldsList = allFields.filter((c) => c.attr(FIELD_ATTR_FILTERABLE) === true);
  // Sort union uses isSortableField — same predicate as renderSortAllowlist to prevent
  // client/server mismatches (@filterable: true + @sortable: false must be excluded from both).
  const sortFieldNames = allFields.filter(isSortableField).map((f) => `"${f.name}"`);

  const fieldLines: string[] = [];
  for (const f of filterableFieldsList) {
    fieldLines.push(`  ${f.name}?: ${renderFieldUnion(f)};`);
  }

  if (fieldLines.length === 0 && sortFieldNames.length === 0) {
    return code`
export type ${entity.name}Filter = {
  limit?: number;
  offset?: number;
  sort?: string;
  or?: ${entity.name}Filter[];
  and?: ${entity.name}Filter[];
};
`;
  }

  const sortType =
    sortFieldNames.length === 0
      ? `string`
      : (() => {
          const sortUnion = sortFieldNames.join(" | ");
          return `\`\${${sortUnion}}:\${"asc" | "desc"}\` | ${sortUnion}`;
        })();

  return code`
export type ${entity.name}Filter = {
  limit?: number;
  offset?: number;
  sort?: ${sortType};
${fieldLines.join("\n")}
  or?: ${entity.name}Filter[];
  and?: ${entity.name}Filter[];
};
`;
}
