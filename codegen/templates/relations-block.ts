// Relations block template — emits the Drizzle relations() block for one entity.
// Derived from the RelationMap pre-pass (relation-resolver.ts).

import { code, imp, joinCode, type Code } from "@metaobjectsdev/codegen-ts/engine";
import type { MetaObject } from "@metaobjectsdev/metadata";
import { CARDINALITY_ONE, CARDINALITY_MANY } from "@metaobjectsdev/metadata";
import { type RenderContext } from "@metaobjectsdev/codegen-ts/engine";
import { crossEntitySpecifier } from "@metaobjectsdev/codegen-ts/engine";
import type { RelationEntry } from "@metaobjectsdev/codegen-ts/engine";
import { effectivePackage } from "@metaobjectsdev/codegen-ts/engine";
import { tphStorageObject } from "@metaobjectsdev/codegen-ts/engine";
import { pkInfoOf } from "@metaobjectsdev/codegen-ts/engine";

/**
 * Render the relations() block for one entity.
 * Returns null if the entity has no relations to emit.
 */
export function renderRelationsBlock(entity: MetaObject, ctx: RenderContext): Code | null {
  const entries = ctx.relationMap.get(entity.name);
  if (!entries || entries.length === 0) return null;

  const varName = ctx.collectionName(entity.name);
  const relationsFn = imp("relations@drizzle-orm");
  const relationsVarName = `${varName}Relations`;

  const hasOne = entries.some((e) => e.cardinality === CARDINALITY_ONE);
  const hasMany = entries.some((e) => e.cardinality === CARDINALITY_MANY);

  const paramParts: string[] = [];
  if (hasOne) paramParts.push("one");
  if (hasMany) paramParts.push("many");
  const params = `{ ${paramParts.join(", ")} }`;

  const thisEntityPackage = effectivePackage(entity);
  const lines: Code[] = entries.map((entry) =>
    renderRelationEntry(entry, ctx, entity, varName, thisEntityPackage),
  );

  return code`export const ${relationsVarName} = ${relationsFn}(${varName}, (${params}) => ({
${joinCode(lines, { on: ",\n", trim: false })}
}));
`;
}

function renderRelationEntry(
  entry: RelationEntry,
  ctx: RenderContext,
  thisEntity: MetaObject,
  thisVarName: string,
  thisEntityPackage: string | undefined,
): Code {
  // FR-018 M:N: the source navigates through the junction table, so the Drizzle
  // many() targets the JUNCTION, not the target entity (the relational query API
  // then hops junction → target via the junction's one() sides). The
  // mountM2mRoute the routes generator emits performs the flattened two-stage
  // traversal for the REST contract.
  if (entry.cardinality === CARDINALITY_MANY && entry.junctionEntity !== undefined && entry.junction !== undefined) {
    const junctionSpec = crossEntitySpecifier(
      ctx.outputLayout,
      thisEntityPackage,
      effectivePackage(entry.junction),
      entry.junctionEntity,
      ctx.extStyle,
    );
    const junctionVarSym = imp(`${ctx.collectionName(entry.junctionEntity)}@${junctionSpec}`);
    return code`  ${entry.name}: many(${junctionVarSym})`;
  }

  // Bind to the table that stores the target's rows: a TPH subtype's module has no
  // table const, so a navigation onto `Carrier` binds `parties` from `Party`.
  const targetTable = tphStorageObject(entry.target);
  const targetTableEntity = targetTable.name;
  // A navigation onto this entity's OWN table (`Order.parent`, or a TPH base onto one of
  // its subtypes) names the local const: importing it from this very module clashes with
  // its declaration (TS2440). Otherwise imp() tracks and emits the cross-entity import.
  const targetVarSym = targetTable === thisEntity
    ? thisVarName
    : imp(`${ctx.collectionName(targetTableEntity)}@${crossEntitySpecifier(
      ctx.outputLayout,
      thisEntityPackage,
      effectivePackage(targetTable),
      targetTableEntity,
      ctx.extStyle,
    )}`);

  if (entry.cardinality === CARDINALITY_ONE) {
    const pkInfo = pkInfoOf(targetTable);
    const targetPkField = pkInfo?.fieldName ?? "id";
    return code`  ${entry.name}: one(${targetVarSym}, { fields: [${thisVarName}.${entry.fkField ?? "id"}], references: [${targetVarSym}.${targetPkField}] })`;
  }
  return code`  ${entry.name}: many(${targetVarSym})`;
}
