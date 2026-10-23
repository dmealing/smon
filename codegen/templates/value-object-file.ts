// Value-object file composer — emits a streamlined "value-only" module for
// metaobjects with no writable source.rdb child. Output is the TS interface +
// the Zod schema (and enum type aliases when applicable); no Drizzle table, no
// Infer*Model aliases, no filter allowlists. An `object.value` also gets a
// field-rules constant (`<VO>.<field>.rules`), without `$table` or `$path`.
//
// Two objects land here that are more than a value: a TPH subtype (it shares the
// base's table) and a SOURCELESS ENTITY (identity, no source: a record in a store
// MetaObjects does not manage — see isSourcelessEntity). Both get the create + PATCH
// schemas and the filter/sort allowlists on top of the interface.
//
// Dispatch: entity-file.ts routes here when hasWritableRdbSource(entity) is
// false. The entity may still have read-only source.* children (those are
// handled by the projection path before this one is reached).

import { joinCode, type Code } from "@metaobjectsdev/codegen-ts/engine";
import type { MetaObject } from "@metaobjectsdev/metadata";
import { OBJECT_SUBTYPE_VALUE } from "@metaobjectsdev/metadata";
import type { RenderContext } from "@metaobjectsdev/codegen-ts/engine";
import { renderValueObjectInterface, renderEnumTypeAliases } from "./inferred-types.js";
import {
  renderInsertSchemaOnly,
  renderZodValidators,
  renderTphSubtypeReadSchema,
} from "./zod-validators.js";
import { isTphSubtype, tphDiscriminatorPin } from "@metaobjectsdev/codegen-ts/engine";
import { renderEntityConstants, renderValueObjectConstants } from "./entity-constants.js";
import { renderFilterAllowlist, renderSortAllowlist } from "./filter-allowlist.js";
import { renderFilterType } from "./filter-type.js";
import { GENERATED_HEADER, GENERATED_EDIT_NOTE, sidecarLine } from "@metaobjectsdev/codegen-ts/engine";
import { namesRef, namesConstArg } from "@metaobjectsdev/codegen-ts/engine";
import { isSourcelessEntity } from "@metaobjectsdev/codegen-ts/engine";
import { isAbstract } from "@metaobjectsdev/codegen-ts/engine";

export function renderValueObjectFile(obj: MetaObject, apiPrefix = "", ctx?: RenderContext): string {
  const enumAliases = renderEnumTypeAliases(obj, ctx);
  // FR-017 Tier 2: a TPH subtype lands here (it inherits the base's source.rdb
  // but declares none of its own). In addition to the insert schema it emits a
  // full read schema `<Sub>Schema` so parse<Base>(row) can dispatch to it.
  const tphSubtype = isTphSubtype(obj);
  const tphReadSchema = tphSubtype ? renderTphSubtypeReadSchema(obj, ctx) : null;
  // FR-017 Tier 3: a TPH subtype also emits its field-metadata constants object
  // (the `<Sub>` const), so the React form generator can render per-field
  // labels / rules / inputs the same way it does for ordinary entities.
  //
  // §A6/§B2 — a TPH subtype declares no source.rdb of its own; it INHERITS the
  // discriminator base's single shared table (`children()` is resolving — ADR-0039).
  // `resolveObjectNames` therefore returns a DEFINED result for it (confirmed
  // empirically: `name` is the BASE's physical table name, `fields` covers both the
  // base's inherited columns and the subtype's own), and `namesFile()` really does emit
  // a `<Sub>.names.ts` for it — this is not a case where the literal is correct and must
  // stay. Same `namesRef` pair every other §A6 site builds; `ctx` is guaranteed present
  // at every real call site (entity-file.ts and its reference/entity.ts mirror both
  // always pass it) even though the parameter stays optional for a bare unit-test call.
  const tphNames = tphSubtype && ctx !== undefined ? namesRef(obj, ctx) : undefined;
  const tphConstants = tphSubtype
    ? renderEntityConstants(obj, apiPrefix, namesConstArg(tphNames))
    : null;
  // FR-017 Tier 3: per-subtype filter + sort allowlists, excluding the
  // discriminator (it's pinned by the per-subtype route path, so a client must
  // not filter on it). Included fields are the subtype's own + inherited base
  // filterable fields. Drives the per-subtype REST routes' filter layer.
  const discField = tphSubtype ? tphDiscriminatorPin(obj)?.fieldName : undefined;
  const tphFilterAllowlist = tphSubtype ? renderFilterAllowlist(obj, discField, ctx) : null;
  const tphSortAllowlist = tphSubtype ? renderSortAllowlist(obj, discField, ctx) : null;
  // FR-017 Tier 3: the per-subtype CLIENT filter type, discriminator-excluded —
  // kept in lockstep with the per-subtype allowlist above so a typed
  // `<Sub>Filter` can't express a filter the server allowlist would 400.
  const tphFilterType = tphSubtype ? renderFilterType(obj, discField) : null;
  // A sourceless entity's wire contract: create + PATCH schemas, allowlists, filter type.
  // No constants object — it names a table and a route this object does not have. The
  // allowlists import runtime types, so a contract-only target (runtime: false) skips them.
  const sourceless = !tphSubtype && isSourcelessEntity(obj);
  const sourcelessAllowlists = sourceless && ctx?.selfTarget.runtime !== false;
  const sections: Code[] = [
    renderValueObjectInterface(obj, ctx),
    ...(enumAliases !== null ? [enumAliases] : []),
    ...(tphReadSchema !== null ? [tphReadSchema] : []),
    // FR-036 Program B: a TPH subtype needs BOTH schemas — its per-subtype PATCH
    // route must carry the FR-035 present-key tristate (a non-@required subtype
    // column accepts an explicit null → clears), which lives in the UpdateSchema
    // (.nullable() for non-required). renderZodValidators emits <Sub>InsertSchema +
    // <Sub>UpdateSchema (the update omits the pinned discriminator). A pure value
    // object stays insert-only (no PATCH semantics — an UpdateSchema would mislead).
    tphSubtype || sourceless ? renderZodValidators(obj, ctx) : renderInsertSchemaOnly(obj, ctx),
    ...(tphConstants !== null ? [tphConstants] : []),
    // An `object.value` gets a field-rules constant, so a caller reads `<VO>.<field>.rules`
    // rather than the Zod schema's getters. It has no table or route, so the constant carries
    // no `$table`/`$path`. Only the value subtype: an abstract object, a TPH subtype, a
    // sourceless entity and an entity emitted to a contract-only target also land in this
    // composer, and none of them takes it.
    ...(obj.subType === OBJECT_SUBTYPE_VALUE && !isAbstract(obj)
      ? [renderValueObjectConstants(obj, ctx ? ctx.valueObjectEmittedName(obj) : undefined)]
      : []),
    ...(tphFilterAllowlist !== null ? [tphFilterAllowlist] : []),
    ...(tphSortAllowlist !== null ? [tphSortAllowlist] : []),
    ...(tphFilterType !== null ? [tphFilterType] : []),
    ...(sourcelessAllowlists ? [renderFilterAllowlist(obj, undefined, ctx), renderSortAllowlist(obj, undefined, ctx)] : []),
    ...(sourceless ? [renderFilterType(obj)] : []),
  ];
  const body = joinCode(sections, { on: "\n" }).toString();
  // ADR-0044/#228 — the hand-edit sidecar name follows this value object's EMITTED
  // module name (== the generated filename), so the `.extra.ts` hint is correct
  // even for a collision-qualified value object. Byte-identical (bare) otherwise.
  const emittedName = ctx ? ctx.valueObjectEmittedName(obj) : obj.name;
  const header =
    `// ${GENERATED_HEADER} — ${GENERATED_EDIT_NOTE}\n` +
    `// Source metadata: ${obj.name} (${obj.fqn()})\n` +
    sidecarLine(`${emittedName}.extra.ts`);
  return header + body;
}
