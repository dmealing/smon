// The six type names the entity module exports for an entity. A client written against the
// generated entity (a typed API client, a form, a service layer) imports these by name, so
// the spelling is part of the generator's contract, not an accident of three templates.
// `entityTypeNames` is the one place that spelling lives: the templates that emit the names
// call it, and an owned generator that refers to them calls it too, so a rename cannot
// leave one side behind. `docs/ports/typescript.md` ("Types exported per entity") is the
// reader-facing table; test/entity-type-names.test.ts pins it to the golden output.

import type { MetaData } from "@metaobjectsdev/metadata";

export interface EntityTypeNames {
  /** The row type read back from the table: `InferSelectModel` of the Drizzle table. */
  row: string;
  /** What an insert accepts: `InferInsertModel` of the Drizzle table. */
  insert: string;
  /** `Partial<Insert>`. */
  update: string;
  /** The Zod insert schema's INPUT type, the argument of `create<Entity>`. */
  create: string;
  /** The Zod update schema's INPUT type: every settable field optional, the argument of `update<Entity>`. */
  patch: string;
  /** The client filter object: filterable fields, `sort`, `limit`, `offset`, `or`, `and`. */
  filter: string;
}

export interface EntityTypeNamesOpts {
  /**
   * The row type is `<Entity>Row` instead of `<Entity>` when the entity is a TPH
   * discriminator base, because its discriminated-union type owns the bare name.
   */
  tphBase?: boolean;
  /** Use this spelling instead of `obj.name` (a value object renamed on a name collision). */
  name?: string;
}

export function entityTypeNames(obj: MetaData, opts: EntityTypeNamesOpts = {}): EntityTypeNames {
  const base = opts.name ?? obj.name;
  return {
    row: opts.tphBase ? `${base}Row` : base,
    insert: `${base}Insert`,
    update: `${base}Update`,
    create: `${base}Create`,
    patch: `${base}Patch`,
    filter: `${base}Filter`,
  };
}
