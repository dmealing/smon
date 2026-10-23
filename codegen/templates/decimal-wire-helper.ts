// The wire rule for a field.decimal WRITE (ADR-0019 Amendment 1, W2 and W3), as text a generated
// model module carries as a local function. Generated model code imports nothing from
// MetaObjects, so the rule is emitted, not imported; runtime-ts/src/decimal-wire.ts holds the
// same grammar and both are held to fixtures/decimal-wire/vectors.json.

export const DECIMAL_WRITE_HELPER = "decimalWrite";

/** The Zod expression of a decimal WRITE field: a string in the JSON-number grammar or a JSON
 *  number, rewritten to the canonical string, refused when the column cannot hold it (W3). */
export function zodDecimalWriteExpr(precision: number | undefined, scale: number | undefined): string {
  const args = precision === undefined ? "" : `, ${precision}, ${scale ?? 0}`;
  return `z.union([z.string(), z.number()]).transform((v, ctx) => ${DECIMAL_WRITE_HELPER}(v, ctx${args}))`;
}

export const DECIMAL_WRITE_HELPER_DECL = [
  "/** A field.decimal on the wire: a string in the JSON-number grammar (an exponent is allowed) or a JSON",
  " *  number, rewritten to its canonical string (plain notation, no trailing fraction zeros, zero as \"0\").",
  " *  Garbage, or a value the column cannot hold without rounding, is a validation issue. Generated. */",
  `function ${DECIMAL_WRITE_HELPER}(v: string | number, ctx: z.RefinementCtx, precision?: number, scale = 0): string {`,
  '  if (typeof v === "number" && Number.isFinite(v) && !Number.isSafeInteger(v) && Number(v.toPrecision(15)) !== v) {',
  '    ctx.addIssue({ code: "custom", message: "Decimal number cannot be read exactly as a JSON number; send it as a string" });',
  "    return z.NEVER;",
  "  }",
  '  const text = typeof v === "number" ? (Number.isFinite(v) ? String(v) : "") : v;',
  "  const m = /^(-?)(0|[1-9][0-9]*)(?:\\.([0-9]+))?(?:[eE]([+-]?[0-9]+))?$/.exec(text);",
  "  const e = m === null || m[4] === undefined ? 0 : Number(m[4]);",
  "  if (m === null || !Number.isSafeInteger(e) || Math.abs(e) > 1000) {",
  '    ctx.addIssue({ code: "custom", message: "Not a decimal number" });',
  "    return z.NEVER;",
  "  }",
  '  const whole = m[2] ?? "";',
  '  let digits = whole + (m[3] ?? "");',
  "  let point = whole.length + e;",
  '  const lead = digits.length - digits.replace(/^0+/, "").length;',
  "  digits = digits.slice(lead).replace(/0+$/, \"\");",
  "  point -= lead;",
  '  if (digits.length === 0) return "0";',
  "  const plain = point <= 0",
  '    ? `0.${"0".repeat(-point)}${digits}`',
  "    : point >= digits.length",
  '      ? digits + "0".repeat(point - digits.length)',
  "      : `${digits.slice(0, point)}.${digits.slice(point)}`;",
  "  const fraction = point >= digits.length ? 0 : digits.length - Math.max(point, 0) + Math.max(-point, 0);",
  "  const integer = Math.max(point, 0);",
  "  if (plain.length > 1000 || (precision !== undefined && (fraction > scale || integer > precision - scale))) {",
  '    ctx.addIssue({ code: "custom", message: "Decimal out of range for the column" });',
  "    return z.NEVER;",
  "  }",
  '  return m[1] === "-" ? `-${plain}` : plain;',
  "}",
].join("\n");
