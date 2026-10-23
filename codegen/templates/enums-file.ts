// FR-019 — shared enums module.
//
// Emits, ONCE per run, the materialized (non-@provided) shared enum types that
// at least one concrete entity field references via `extends` of a root-level
// abstract `field.enum`. Each enum yields:
//   • `export type <E> = "A" | "B";`   — the cross-port type identity
//   • `export const <E>Enum = z.enum(["A","B"]);` — the shared Zod validator
//
// Consuming entity files import these instead of redeclaring the union inline.
// @provided enums are NEVER materialized here (they live in hand-written code,
// imported from the configured providedEnumModule).

import { code, imp, joinCode, type Code } from "@metaobjectsdev/codegen-ts/engine";
import type { MetaRoot } from "@metaobjectsdev/metadata";
import { GENERATED_HEADER, GENERATED_EDIT_NOTE } from "@metaobjectsdev/codegen-ts/engine";
import { materializedSharedEnums, type SharedEnum } from "@metaobjectsdev/codegen-ts/engine";
import { enumUnionString } from "./inferred-types.js";

/** Basename (no extension) of the shared-enums module emitted at the entity-module target root. */
export const SHARED_ENUMS_BASENAME = "enums";

/** The exported Zod-constant name for a shared enum (`<E>Enum`). */
export function sharedEnumZodConstName(enumName: string): string {
  return `${enumName}Enum`;
}

/** One enum's two declarations (type alias + shared z.enum const). */
function renderOneSharedEnum(e: SharedEnum): Code {
  const z = imp("z@zod");
  const members = e.values.map((v) => JSON.stringify(v)).join(", ");
  return code`
export type ${e.name} = ${enumUnionString(e.values)};
export const ${sharedEnumZodConstName(e.name)} = ${z}.enum([${members}]);
`;
}

/**
 * The full shared-enums module body, or null when the model has no materialized
 * shared enums (so the generator emits no file at all).
 *
 * `opts.select` (FR-023 §11.1 item 2) — the model-wide scope predicate over a
 * CONSUMING entity's `resolutionKey()`: an enum extended only by entities
 * `select` excludes is not materialized. This module renders once per run from
 * the WHOLE loaded root (never per-generator-filtered — see #266), so it is the
 * one shared-enums call site that must be threaded the scope predicate
 * separately from `ctx.matches`. Omitted ⇒ every entity counts, byte-identical
 * to a caller that never passes `opts` at all.
 */
export function renderSharedEnumsFile(
  root: MetaRoot,
  opts?: { select?: (fqn: string) => boolean },
): string | null {
  const enums = materializedSharedEnums(root, opts?.select);
  if (enums.length === 0) return null;

  const body = joinCode(enums.map(renderOneSharedEnum), { on: "\n" }).toString();
  const header =
    `// ${GENERATED_HEADER} — ${GENERATED_EDIT_NOTE}\n` +
    `// Shared enum types (FR-019): one declaration per reused package-level enum.\n`;
  return header + body;
}
