import {
  DOC_ATTR_ALIASES,
  DOC_ATTR_DEPRECATED,
  DOC_ATTR_DESCRIPTION,
  DOC_ATTR_REPLACED_BY,
  DOC_ATTR_SEE_ALSO,
  DOC_ATTR_TITLE,
} from "@metaobjectsdev/metadata";

export interface DocAttrs {
  description?: string;
  title?: string;
  /** Internal-only; NEVER emitted by this helper (D5 contract). */
  notes?: string;
  deprecated?: string;
  replacedBy?: string;
  seeAlso?: string[];
  aliases?: string[];
}

/**
 * Render the seven doc common attrs as a JSDoc block. Returns "" if no
 * relevant attrs are set. `notes` is intentionally NEVER emitted — it is
 * the internal-only rationale slot per the Documentation Provider design
 * (D5).
 */
export function renderJsDocBlock(attrs: DocAttrs): string {
  const bodyLines: string[] = [];

  // Description (primary text), falling back to title-only if no description.
  if (attrs.description) {
    bodyLines.push(...attrs.description.split("\n"));
  } else if (attrs.title) {
    bodyLines.push(attrs.title);
  }

  // Tags
  const tagLines: string[] = [];
  if (attrs.deprecated !== undefined) {
    const replaced = attrs.replacedBy ? ` Replaced by ${attrs.replacedBy}.` : "";
    tagLines.push(`@deprecated ${attrs.deprecated}${replaced}`);
  }
  for (const url of attrs.seeAlso ?? []) tagLines.push(`@see ${url}`);
  for (const alias of attrs.aliases ?? []) tagLines.push(`@alias ${alias}`);

  if (bodyLines.length === 0 && tagLines.length === 0) return "";

  // One-line shorthand: single body line + no tags
  if (bodyLines.length === 1 && tagLines.length === 0) {
    return `/** ${bodyLines[0]} */`;
  }

  const out: string[] = ["/**"];
  for (const line of bodyLines) out.push(line === "" ? " *" : ` * ${line}`);
  if (bodyLines.length > 0 && tagLines.length > 0) out.push(" *");
  for (const line of tagLines) out.push(` * ${line}`);
  out.push(" */");
  return out.join("\n");
}

/** Read the seven doc attrs from a MetaData node's `.attrs()` (effective). */
export function readDocAttrs(node: { attr: (n: string) => unknown }): DocAttrs {
  const str = (v: unknown): string | undefined =>
    typeof v === "string" ? v : undefined;
  const arr = (v: unknown): string[] | undefined =>
    Array.isArray(v) && v.every((x) => typeof x === "string") ? (v as string[]) : undefined;

  const description = str(node.attr(DOC_ATTR_DESCRIPTION));
  const title = str(node.attr(DOC_ATTR_TITLE));
  const deprecated = str(node.attr(DOC_ATTR_DEPRECATED));
  const replacedBy = str(node.attr(DOC_ATTR_REPLACED_BY));
  const seeAlso = arr(node.attr(DOC_ATTR_SEE_ALSO));
  const aliases = arr(node.attr(DOC_ATTR_ALIASES));
  // notes intentionally NOT read here — codegen consumers should never receive it
  return {
    ...(description !== undefined && { description }),
    ...(title !== undefined && { title }),
    ...(deprecated !== undefined && { deprecated }),
    ...(replacedBy !== undefined && { replacedBy }),
    ...(seeAlso !== undefined && { seeAlso }),
    ...(aliases !== undefined && { aliases }),
  };
}

/** Convenience: `renderJsDocBlock(readDocAttrs(node))`. Returns "" if no doc attrs. */
export function renderDocsFor(node: { attr: (n: string) => unknown }): string {
  return renderJsDocBlock(readDocAttrs(node));
}
