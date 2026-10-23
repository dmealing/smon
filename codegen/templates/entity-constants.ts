// Entity-constants template — emits an `<Entity>` const with all the
// metadata-derived strings consumers should use INSTEAD of magic strings.
//
// Shape (each non-$-prefixed key is a per-field object):
//
//   export const Subscriber = {
//     $entity: "Subscriber",
//     $table:  "subscribers",
//     $path:   "/subscribers",
//
//     email: {
//       name:        "email",
//       label:       "Email Address",      // @title on the surface's view, else @title on the field, else humanized field name
//       view:        "text",                // MetaView subtype
//       htmlType:    "email",               // optional; only when the view maps to a real HTML input type
//       rules: {                             // optional; derived from validator children
//         required:  "Email is required",
//         maxLength: { value: 255, message: "Must be 255 characters or fewer" },
//         pattern:   { value: /.../, message: "Invalid email" },
//       },
//     },
//     // ...
//   } as const;
//
// Consumers spread `form.input.email` from useEntityForm and never touch
// per-attribute access (placeholder, rules, etc.) by hand — the helper
// picks them up from this object automatically.

import { code, joinCode, type Code } from "@metaobjectsdev/codegen-ts/engine";
import { MetaObject } from "@metaobjectsdev/metadata";
import { resolveTableName } from "@metaobjectsdev/metadata";
import { physicalNameExpr } from "@metaobjectsdev/codegen-ts/engine";
import {
  buildEntityUiDescriptor,
  resourcePath,
  type UiFieldDescriptor,
  type UiRule,
} from "@metaobjectsdev/codegen-ts/engine";

// `resourcePath` moved to entity-ui-descriptor.ts with the rest of the form derivation.
// Re-exported here because it is part of this module's published surface (the package
// barrel re-exports it from this path, and api-model.ts imports it from here).
export { resourcePath };

/**
 * Render one rule entry as the RHF-shaped code fragment the descriptor emits.
 *
 * Order is the descriptor's, which is declaration order — see the ordering note in
 * entity-ui-descriptor.ts for why that is not incidental.
 */
function renderRule(r: UiRule): string {
  switch (r.kind) {
    case "required":
      return `required: ${JSON.stringify(r.message)}`;
    case "minLength":
      return `minLength: { value: ${r.value}, message: ${JSON.stringify(r.message)} }`;
    case "maxLength":
      return `maxLength: { value: ${r.value}, message: ${JSON.stringify(r.message)} }`;
    case "pattern": {
      // Emit as a RegExp literal /.../ — `as const` preserves the value-ref. The
      // descriptor carries the RAW pattern; forward-slash and backslash are escaped
      // HERE, because closing a TypeScript regex literal is an emission concern.
      const safe = r.pattern.replace(/\\/g, "\\\\").replace(/\//g, "\\/");
      return `pattern: { value: /${safe}/, message: ${JSON.stringify(r.message)} }`;
    }
  }
}

/** Build one nested field-object entry like `email: { name, label, ... },`. */
function renderFieldEntry(f: UiFieldDescriptor): string {
  const entries: string[] = [
    `name: ${JSON.stringify(f.name)}`,
    `label: ${JSON.stringify(f.label)}`,
    `view: ${JSON.stringify(f.view)}`,
  ];
  if (f.htmlType !== undefined) entries.push(`htmlType: ${JSON.stringify(f.htmlType)}`);
  if (f.step !== undefined) entries.push(`step: ${JSON.stringify(f.step)}`);
  if (f.inputMode !== undefined) entries.push(`inputMode: ${JSON.stringify(f.inputMode)}`);
  if (f.rules.length > 0) entries.push(`rules: { ${f.rules.map(renderRule).join(", ")} }`);

  // A `field.enum`'s member symbols. Emitted whenever the field has them, because the
  // descriptor reports `view: "dropdown"` for an enum and a dropdown without options is
  // a promise the descriptor cannot keep.
  if (f.options !== undefined && f.options.length > 0) {
    entries.push(`options: [${f.options.map((v) => JSON.stringify(v)).join(", ")}] as const`);
  }

  // Currency-specific keys: only emitted for currency-subtype fields.
  if (f.currency !== undefined) {
    entries.push(`currency: ${JSON.stringify(f.currency.currency)}`);
    entries.push(`locale: ${JSON.stringify(f.currency.locale)}`);
  }

  return `  ${f.name}: {\n    ${entries.join(",\n    ")},\n  }`;
}

/**
 * The field-rules constant of an `object.value`: `export const <VO> = { $entity, <field>: { name,
 * label, view, rules, ... } } as const`. The same per-field shape an entity's constant carries,
 * minus `$table` and `$path` — a value object has no source and no route — so a caller reads a
 * limit as `<VO>.<field>.rules.maxLength.value` instead of reaching through the Zod schema's
 * getters. Emitted for the value subtype only (see `renderValueObjectFile`).
 */
export function renderValueObjectConstants(obj: MetaObject, emittedName?: string): Code {
  const descriptor = buildEntityUiDescriptor(obj);
  // The emitted name (collision-qualified, ADR-0044) matches the value object's interface.
  const name = emittedName ?? descriptor.entity;
  const body = joinCode(
    [code`  $entity: ${JSON.stringify(descriptor.entity)}`, ...descriptor.fields.map((f) => code`${renderFieldEntry(f)}`)],
    { on: ",\n" },
  );
  return code`
/**
 * Metadata constants for the value object ${name}: each field's name, label, view and the
 * validation rules derived from its validator children (e.g. \`${name}.<field>.rules.maxLength.value\`).
 */
export const ${name} = {
${body},
} as const;
`;
}

export function renderEntityConstants(
  obj: MetaObject,
  /**
   * @deprecated Accepted and IGNORED. The API base URL left the descriptor: generated
   * client artifacts emit entity-relative paths and the base is supplied once at the
   * client provider (`baseUrl`), because where the browser sends a request is a
   * deployment fact rather than something to freeze at `meta gen` time.
   *
   * It must STAY in the signature: `src/reference/entity.ts` is copied verbatim into
   * adopter repos (ADR-0034) and calls this positionally, so removing the parameter
   * would fail to compile in every ejected copy. Removal is a separate later break.
   */
  _apiPrefix = "",
  // §A6. OPTIONAL, and it must stay optional: `src/reference/entity.ts` is copied
  // verbatim into adopter repos by ADR-0034 scaffold-and-own and calls this with two
  // arguments. A required parameter would fail to compile in every ejected copy.
  names?: { readonly name: string; readonly symbol: Code } | undefined,
): Code {
  // ONE derivation of the form surface, shared with the `agent/ui.md` docs page — see
  // entity-ui-descriptor.ts. The descriptor already walks the RESOLVING fields(), so
  // inherited fields (from extends:/super:) appear here as they always have.
  const descriptor = buildEntityUiDescriptor(obj);
  const entityName = descriptor.entity;
  const tableName = resolveTableName(obj);
  const path = descriptor.path;

  const fieldEntries: string[] = descriptor.fields.map(renderFieldEntry);

  // A6/B2 — reference the constant whenever the artifact is in the run. No equality
  // guard: primaryRdbSource (@metaobjectsdev/metadata) refuses any object whose
  // @role: primary sources disagree on a physical name, and both the constant and the
  // literal below resolve through it, so a reference here is the single spelling. `physicalNameExpr` accepts
  // any `{ symbol }`-shaped value, so it works with this function's `{ name, symbol }`
  // parameter as well as `namesRef`'s own `{ resolved, symbol }`.
  const tableLine: Code = code`  $table: ${physicalNameExpr(names, tableName, obj)}`;

  const body = joinCode(
    [
      code`  $entity: ${JSON.stringify(entityName)}`,
      tableLine,
      code`  $path: ${JSON.stringify(path)}`,
      ...fieldEntries.map((e) => code`${e}`),
    ],
    { on: ",\n" },
  );

  return code`
/**
 * Metadata constants for ${entityName}.
 *
 * Use these instead of magic strings so TS catches typos and refactors stay
 * coherent. Each non-dollar-prefixed key is a per-field object carrying
 * name, label, view, an htmlType where the field's view maps to one, and the
 * RHF-shaped validation rules derived from the field's validator children.
 *
 * placeholder and helpText are NOT emitted — no provider registers an attribute
 * for them, so nothing here could derive one. (htmlType is emitted, but derived
 * from the view subtype; the @htmlType override was removed for the same reason.)
 * useEntityForm still honours placeholder if you add it: this file is generated,
 * hand edits inside it survive regeneration through the three-way merge, and the
 * consumers read this const rather than the metadata. That is the intended way
 * to set it.
 *
 * Typical usage with the metaobjects React form helper:
 *
 *   import { useEntityForm } from '@metaobjectsdev/react';
 *   const form = useEntityForm(${entityName}, ${entityName}InsertSchema);
 *   <input {...form.input.${
    fieldEntries[0]?.match(/^\s*(\w+):/)?.[1] ?? "fieldName"
  }} />
 */
export const ${entityName} = {
${body},
} as const;
`;
}
