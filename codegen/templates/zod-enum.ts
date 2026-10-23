// The Zod expression for a set of enum members. Emitted text, so it is handed over with the
// generator that writes it (ADR-0034 Amendment 8); the member list itself comes from the
// engine's `enumValues` (enum-meta.ts).

/** Build the Zod expression for a set of enum members, e.g. `z.enum(["A", "B"])`. */
export function zodEnumExpr(values: string[]): string {
  return `z.enum([${values.map((v) => JSON.stringify(v)).join(", ")}])`;
}
