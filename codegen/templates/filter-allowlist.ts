import { code, type Code } from "@metaobjectsdev/codegen-ts/engine";
import { MetaField, MetaObject } from "@metaobjectsdev/metadata";
import {
  FIELD_ATTR_FILTERABLE,
  FIELD_SUBTYPE_BOOLEAN,
  FIELD_SUBTYPE_INT,
  FIELD_SUBTYPE_LONG,
  FIELD_SUBTYPE_DOUBLE,
  FIELD_SUBTYPE_FLOAT,
  FIELD_SUBTYPE_DECIMAL,
  FIELD_SUBTYPE_DATE,
  FIELD_SUBTYPE_TIME,
  FIELD_SUBTYPE_TIMESTAMP,
  FIELD_SUBTYPE_CURRENCY,
  FIELD_SUBTYPE_UUID,
  FIELD_SUBTYPE_ENUM,
  FIELD_ATTR_LOCAL_TIME,
  opsForField,
} from "@metaobjectsdev/metadata";
import { enumValues } from "@metaobjectsdev/codegen-ts/engine";
import { sortableFields, declaredSortDefaultOrder } from "./filter-shared.js";
import type { RenderContext } from "@metaobjectsdev/codegen-ts/engine";
import { httpRuntimeSpecifier } from "@metaobjectsdev/codegen-ts/engine";
import { effectivePackage } from "@metaobjectsdev/codegen-ts/engine";

/**
 * Where the allowlist TYPES are imported from — the package, unless an owned generator
 * pointed its render context at the adapter copy `meta eject` placed in the repo
 * (`owned-runtime.ts`). Absent `ctx`, or with no `httpRuntimeImport`, the package: the
 * byte-identical default.
 */
const PACKAGE_DEFAULT = { outputLayout: "flat", extStyle: "none" } as const;

function allowlistTypesFrom(entity: MetaObject, ctx: RenderContext | undefined): string {
  return httpRuntimeSpecifier("allowlists", ctx ?? PACKAGE_DEFAULT, effectivePackage(entity));
}

const NUMBER_SUBTYPES = new Set<string>([
  FIELD_SUBTYPE_INT,
  FIELD_SUBTYPE_LONG,
  FIELD_SUBTYPE_DOUBLE,
  FIELD_SUBTYPE_FLOAT,
  FIELD_SUBTYPE_DECIMAL,
  // currency is integer minor units — coerces as a number on the wire.
  FIELD_SUBTYPE_CURRENCY,
]);

const DATETIME_SUBTYPES = new Set<string>([
  FIELD_SUBTYPE_DATE,
  FIELD_SUBTYPE_TIME,
  FIELD_SUBTYPE_TIMESTAMP,
]);

/** Maps a field subtype to the FilterSubType category used in generated FilterAllowlist. */
function filterSubTypeFor(fieldSubType: string): "string" | "number" | "boolean" | "datetime" {
  if (fieldSubType === FIELD_SUBTYPE_BOOLEAN) return "boolean";
  if (NUMBER_SUBTYPES.has(fieldSubType)) return "number";
  if (DATETIME_SUBTYPES.has(fieldSubType)) return "datetime";
  return "string";
}

/**
 * Field subtypes whose filter values have an exact wire format the coarse FilterSubType
 * cannot express ("datetime" is three formats; a uuid is a "string"). The emitted
 * `format` value IS the subtype name — runtime-ts keys its checks on the same constants.
 */
const VALUE_FORMAT_SUBTYPES = new Set<string>([
  FIELD_SUBTYPE_DATE,
  FIELD_SUBTYPE_TIME,
  FIELD_SUBTYPE_TIMESTAMP,
  FIELD_SUBTYPE_UUID,
  FIELD_SUBTYPE_DECIMAL,
]);

/** Subtypes whose values are whole numbers — `field.currency` is integer minor units. */
const INTEGER_SUBTYPES = new Set<string>([
  FIELD_SUBTYPE_INT,
  FIELD_SUBTYPE_LONG,
  FIELD_SUBTYPE_CURRENCY,
]);

/**
 * The `format` / `enumValues` / `instant` / `integer` members of a rule, so runtime-ts's
 * filter parser can refuse a value that cannot be the field's type (`invalid_filter_value`)
 * instead of binding it — a malformed date compared as text on SQLite and silently matched
 * nothing, and `filter[dailyRateCents][gte]=40.5` was a 200. `instant` marks a
 * `field.timestamp` that is NOT `@localTime`: the parser reads a zoneless or date-only bound
 * as UTC, the same rule the generated write schema stores it by. Scalar fields only: an
 * array field's filter value is not one element of the declared type.
 */
function valueShape(f: MetaField): string {
  if (f.resolvedIsArray()) return "";
  if (INTEGER_SUBTYPES.has(f.subType)) return ", integer: true as const";
  if (VALUE_FORMAT_SUBTYPES.has(f.subType)) {
    const instant = f.subType === FIELD_SUBTYPE_TIMESTAMP && f.attr(FIELD_ATTR_LOCAL_TIME) !== true
      ? ", instant: true as const"
      : "";
    return `, format: ${JSON.stringify(f.subType)} as const${instant}`;
  }
  if (f.subType === FIELD_SUBTYPE_ENUM) {
    // Member SYMBOLS for string- and int-backed enums alike: an int-backed column's codec
    // maps the symbol to its integer when the value is bound.
    const members = enumValues(f);
    if (members !== undefined && members.length > 0) {
      return `, enumValues: [${members.map((m) => JSON.stringify(m)).join(", ")}] as const`;
    }
  }
  return "";
}

function filterableFields(entity: MetaObject, exclude?: string): MetaField[] {
  // fields() returns effective fields, so inherited fields (from extends:/super:) are included in allowlists.
  return entity
    .fields()
    .filter((c) => c.attr(FIELD_ATTR_FILTERABLE) === true && c.name !== exclude);
}

/**
 * `exclude` (FR-017): drop a field from the allowlist. Used by per-subtype TPH
 * allowlists to omit the discriminator — it's pinned by the per-subtype route
 * path, so a client must not filter on it.
 *
 * `ctx` supplies `timestampMode`: under `"date"` a `field.timestamp` column binds a JS
 * `Date`, so its rule carries `dateValues: true` and runtime-ts's filter parser coerces
 * the query-string value with `new Date(...)` rather than binding a string against a
 * Date-typed column (which threw at request time). `ctx.timestampMode` is already
 * normalized to `"string"` for sqlite/D1 at both config choke points, so no dialect
 * branching is needed here. Absent `ctx`, or in the default mode, output is unchanged.
 */
export function renderFilterAllowlist(entity: MetaObject, exclude?: string, ctx?: RenderContext): Code {
  const fields = filterableFields(entity, exclude);
  if (fields.length === 0) {
    return code`
import type { FilterAllowlist } from ${JSON.stringify(allowlistTypesFrom(entity, ctx))};

export const ${entity.name}FilterAllowlist = {} as const satisfies FilterAllowlist;
`;
  }
  const rows = fields
    .map((f) => {
      // opsForField, not opsForSubType — an int-backed field.enum (@intValueMap)
      // stores as an integer, so `like` (a substring match) is not in its band.
      const ops = opsForField(f).map((o) => JSON.stringify(o)).join(", ");
      const sub = filterSubTypeFor(f.subType);
      // Only field.timestamp is governed by timestampMode — Drizzle types
      // field.date / field.time as strings under every dialect.
      const dateValues = ctx?.timestampMode === "date" && f.subType === FIELD_SUBTYPE_TIMESTAMP
        ? ", dateValues: true as const"
        : "";
      return `  ${f.name}: { ops: [${ops}] as const, subType: ${JSON.stringify(sub)} as const, leadingWildcard: false${dateValues}${valueShape(f)} }`;
    })
    .join(",\n");
  return code`
import type { FilterAllowlist } from ${JSON.stringify(allowlistTypesFrom(entity, ctx))};

export const ${entity.name}FilterAllowlist = {
${rows}
} as const satisfies FilterAllowlist;
`;
}

export function renderSortAllowlist(entity: MetaObject, exclude?: string, ctx?: RenderContext): Code {
  // Sortable = explicit @sortable === true, OR (no @sortable AND @filterable === true).
  // @sortable: false explicitly opts out.
  // Uses shared isSortableField predicate — must stay in sync with renderFilterType.
  // `exclude` (FR-017): per-subtype TPH allowlists omit the discriminator.
  const sortable = sortableFields(entity).filter((f) => f.name !== exclude);
  if (sortable.length === 0) {
    return code`
import type { SortAllowlist } from ${JSON.stringify(allowlistTypesFrom(entity, ctx))};

export const ${entity.name}SortAllowlist = {} as const satisfies SortAllowlist;
`;
  }
  const rows = sortable
    .map((f) => {
      // The DECLARED order only — an undeclared field stays `{}` so the runtime's own
      // `?? "asc"` remains the single place the fallback is spelled. Read through the
      // shared resolver, never off the attr here, so this allowlist and the grid tier
      // cannot answer one declaration two ways.
      const defaultOrder = declaredSortDefaultOrder(f);
      const rule =
        defaultOrder === undefined
          ? `{}`
          : `{ defaultOrder: ${JSON.stringify(defaultOrder)} as const }`;
      return `  ${f.name}: ${rule}`;
    })
    .join(",\n");
  return code`
import type { SortAllowlist } from ${JSON.stringify(allowlistTypesFrom(entity, ctx))};

export const ${entity.name}SortAllowlist = {
${rows}
} as const satisfies SortAllowlist;
`;
}
