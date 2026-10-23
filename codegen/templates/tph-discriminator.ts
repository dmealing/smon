// FR-017 Tier 1 — TS discriminated-union + type guards + dispatcher emission.
//
// For an entity that carries `@discriminator`, this template emits:
//   1. `export type <Base> = <Sub1> | <Sub2> | ...` — discriminated union of
//      every concrete subtype declaring @discriminatorValue against this base.
//   2. `export function is<Sub>(value: <Base>): value is <Sub>` — one type
//      guard per subtype, checking the discriminator field's value.
//   3. `export function parse<Base>(row: unknown): <Base>` — runtime dispatcher
//      that reads the discriminator off the raw row and parses with the
//      matching subtype's Zod schema.
//
// When the entity does NOT carry @discriminator, returns null. When the entity
// carries @discriminator but has no concrete subtypes yet (refactor-in-progress
// shape — covered by FR-014 fixture `tph-discriminator-string-no-subtypes`),
// returns null too: there are no subtype names to union.

import { code, joinCode, imp, type Code } from "@metaobjectsdev/codegen-ts/engine";
import {
  type MetaObject,
  type MetaField,
  type MetaRoot,
  OBJECT_ATTR_DISCRIMINATOR,
  OBJECT_ATTR_DISCRIMINATOR_VALUE,
  OBJECT_SUBTYPE_ENTITY,
} from "@metaobjectsdev/metadata";

interface SubtypeBinding {
  subtype: MetaObject;
  value: string;
}

/** One concrete subtype in a {@link TphPlan}. */
export interface TphSubtypePlan {
  /** The concrete subtype entity. */
  entity: MetaObject;
  /** Its `@discriminatorValue`. */
  value: string;
  /** The per-subtype REST route segment (e.g. `"bridge"`). The ONE place this
   *  rule is derived — see {@link tphRouteSegment}. */
  routeSegment: string;
}

/**
 * The single source of truth for a TPH base's polymorphic shape: the
 * discriminator field name, the concrete subtypes (stable name-sorted order),
 * each subtype's `@discriminatorValue`, and its per-subtype route segment.
 *
 * Every generator in the stack (entity, queries, routes, hooks, grid, forms)
 * derives its TPH behavior from this one model rather than re-walking the root
 * and re-deriving the segment / write-shape independently — so the route-segment
 * rule and subtype set can never drift between, say, the generated routes and
 * the generated hooks that call them.
 */
export interface TphPlan {
  base: MetaObject;
  discriminatorField: string;
  subtypes: TphSubtypePlan[];
}

// Memoized per base instance — the plan is pure over the (immutable, fully
// resolved) post-load model, and a base belongs to exactly one root, so caching
// by the base node identity is safe and erases the repeated root walks.
const _tphPlanCache = new WeakMap<MetaObject, TphPlan | null>();

/** The per-subtype REST route segment for a discriminator value. The ONE place
 *  this rule lives: `routesFile` and the TanStack hooks both read it through the
 *  plan, so generated hooks can't call a URL the generated routes don't serve. */
export function tphRouteSegment(discriminatorValue: string): string {
  return discriminatorValue.toLowerCase();
}

/** The {@link TphPlan} for a discriminator base, or `null` when `base` is not a
 *  discriminator base (no `@discriminator`, or no concrete subtypes). */
export function tphPlan(base: MetaObject, root: MetaRoot): TphPlan | null {
  const cached = _tphPlanCache.get(base);
  if (cached !== undefined) return cached;
  // ADR-0039: own — TPH super-resolution walk (mirrors C# TphPlan). @discriminator
  // must be read own to identify WHICH hierarchy level owns it (the discriminator
  // base); a subtype must not be treated as a base by inheriting it.
  const discriminatorField = base.ownAttr(OBJECT_ATTR_DISCRIMINATOR);
  let plan: TphPlan | null = null;
  if (typeof discriminatorField === "string" && discriminatorField !== "") {
    const bindings = collectConcreteSubtypes(base, root);
    if (bindings.length > 0) {
      plan = {
        base,
        discriminatorField,
        subtypes: bindings.map((b) => ({
          entity: b.subtype,
          value: b.value,
          routeSegment: tphRouteSegment(b.value),
        })),
      };
    }
  }
  _tphPlanCache.set(base, plan);
  return plan;
}

/** True when this entity is a TPH discriminator base — it carries
 *  `@discriminator` AND at least one concrete subtype declares
 *  `@discriminatorValue` extending it. This is the predicate the generator
 *  stack uses to switch into single-table-inheritance emission. */
export function isTphDiscriminatorBase(obj: MetaObject, root: MetaRoot): boolean {
  return tphPlan(obj, root) !== null;
}

/** The concrete subtypes bound to this discriminator base, in stable
 *  (name-sorted) order. Returns `[]` when `base` is not a discriminator base. */
export function tphConcreteSubtypes(base: MetaObject, root: MetaRoot): MetaObject[] {
  return tphPlan(base, root)?.subtypes.map((s) => s.entity) ?? [];
}

/**
 * The subtype-only fields that must be folded into the base's single TPH table.
 * For each concrete subtype, every effective field NOT already on the base is
 * collected (effective, so fields declared on abstract intermediate levels of a
 * multi-level hierarchy are captured too). Deduplicated by field name across
 * subtypes — two subtypes sharing a column name contribute one column. The
 * caller emits each as a nullable column (rows of other subtypes store NULL).
 */
export function collectTphSubtypeFields(base: MetaObject, root: MetaRoot): MetaField[] {
  // ADR-0039: own — TPH super-resolution walk; @discriminator identifies the base level.
  const discFieldName = base.ownAttr(OBJECT_ATTR_DISCRIMINATOR);
  if (typeof discFieldName !== "string" || discFieldName === "") return [];

  const baseFieldNames = new Set(base.fields().map((f) => f.name));
  const seen = new Set<string>();
  const out: MetaField[] = [];
  for (const { subtype } of collectConcreteSubtypes(base, root)) {
    for (const f of subtype.fields()) {
      if (baseFieldNames.has(f.name)) continue; // base column — already emitted
      if (seen.has(f.name)) continue; // shared subtype column — emit once
      seen.add(f.name);
      out.push(f);
    }
  }
  return out;
}

/** Render the TPH union + guards + dispatcher block, or null when the entity
 *  is not a discriminator-bearing base with at least one concrete subtype. */
export function renderTphDiscriminatorUnion(
  base: MetaObject,
  root: MetaRoot,
): Code | null {
  // ADR-0039: own — TPH super-resolution walk; @discriminator identifies the base level.
  const discFieldName = base.ownAttr(OBJECT_ATTR_DISCRIMINATOR);
  if (typeof discFieldName !== "string" || discFieldName === "") return null;

  const subtypes = collectConcreteSubtypes(base, root);
  if (subtypes.length === 0) return null;

  const baseName = base.name;

  // 1. Union type alias. Subtype names are imported lazily via ts-poet `imp()`
  //    so they resolve cross-module without manual import wiring.
  const unionMembers: Code[] = subtypes.map((b) => {
    const sub = imp(`t:${b.subtype.name}@./${b.subtype.name}.js`);
    return code`${sub}`;
  });
  const unionType = code`export type ${baseName} = ${joinCode(unionMembers, { on: " | " })};`;

  // 2. Type guards.
  const guards: Code[] = subtypes.map((b) => {
    const sub = imp(`t:${b.subtype.name}@./${b.subtype.name}.js`);
    return code`
/** True when value is a ${b.subtype.name} (discriminated by ${discFieldName} === "${b.value}"). */
export function is${b.subtype.name}(value: ${baseName}): value is ${sub} {
  return value.${discFieldName} === "${b.value}";
}`;
  });

  // 3. Dispatcher. The head-read uses z.object so the discriminator is read
  //    without committing the row to any subtype yet.
  const z = imp("z@zod");
  const enumLiterals = subtypes.map((b) => JSON.stringify(b.value)).join(", ");

  const caseBranches: Code[] = subtypes.map((b) => {
    const schema = imp(`${b.subtype.name}Schema@./${b.subtype.name}.js`);
    return code`    case ${JSON.stringify(b.value)}: return ${schema}.parse(row);`;
  });

  const dispatcher = code`
/**
 * Parse a row from the ${baseName} table, dispatching by the
 * \`${discFieldName}\` discriminator value to the matching subtype's
 * Zod schema. Throws on unknown discriminator values.
 */
export function parse${baseName}(row: unknown): ${baseName} {
  const head = ${z}.object({ ${discFieldName}: ${z}.enum([${enumLiterals}]) }).parse(row);
  switch (head.${discFieldName}) {
${joinCode(caseBranches, { on: "\n" })}
  }
}
`;

  return code`
${unionType}

${joinCode(guards, { on: "\n" })}

${dispatcher}
`;
}

/** Walk every top-level object.entity in the root and return the concrete
 *  subtypes whose @discriminatorValue is bound to this base via extends.
 *  Abstract intermediates are skipped (they don't have polymorphic instances). */
function collectConcreteSubtypes(base: MetaObject, root: MetaRoot): SubtypeBinding[] {
  const bindings: SubtypeBinding[] = [];
  for (const obj of root.objects()) {
    if (obj.subType !== OBJECT_SUBTYPE_ENTITY) continue;
    if (obj.isAbstract === true) continue;
    if (obj === base) continue;

    // ADR-0039: own — each concrete subtype declares its OWN @discriminatorValue;
    // it must NOT inherit a parent's value (super-resolution walk, category 3).
    const value = obj.ownAttr(OBJECT_ATTR_DISCRIMINATOR_VALUE);
    if (typeof value !== "string" || value === "") continue;

    // Walk this entity's extends chain looking for `base`.
    let cursor = obj.superResolved;
    let found = false;
    while (cursor !== undefined) {
      if (cursor === base) {
        found = true;
        break;
      }
      cursor = cursor.superResolved;
    }
    if (!found) continue;

    bindings.push({ subtype: obj, value });
  }
  // Stable order by subtype name so emission is deterministic.
  bindings.sort((a, b) => a.subtype.name.localeCompare(b.subtype.name));
  return bindings;
}
