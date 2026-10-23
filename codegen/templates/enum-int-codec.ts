/**
 * The int-backed `field.enum` codec emitter, shared by the two artifacts that can
 * reference one: the entity's Drizzle table (`drizzle-schema.ts`) and any view-backed
 * read model (`view-decl.ts` — a projection or an entity read-view).
 *
 * It lives in its own module because the codec is a MODULE-LOCAL const in whatever file
 * declares the column, so every emitter that can produce such a column must be able to
 * declare it too. While only the table template owned it, the view template emitted the
 * call site and let the const name fall through to `imp(fnName@drizzle-orm/*-core)` —
 * importing a member that package does not export, which `meta gen` reported as success
 * and only `tsc` caught.
 *
 * The invariant this module exists to protect: the codec is declared ONCE PER MODULE, and
 * it must precede every use. A write-through entity puts its table and its replica view in
 * one file and both reference the same consts, so `entity-file.ts` renders the table first,
 * collects the names it declared, and hands them to the view — which then references them
 * instead of re-declaring. Two module-scope `const`s of one name is a JS parse error, and a
 * declaration emitted after its use is a TDZ ReferenceError at import: both are worse than
 * the missing-codec bug, because neither lets the module load at all.
 */
import { code, imp, type Code } from "@metaobjectsdev/codegen-ts/engine";
import type { EnumIntCustomType } from "@metaobjectsdev/codegen-ts/engine";

/**
 * Render an int-backed `field.enum`'s Drizzle `customType` helper plus its two
 * lookup maps.
 *
 * The codec lives HERE, in the column definition, so nothing downstream needs to
 * know about it: `db.insert().values()` encodes on bind, a selected row decodes on
 * read, and a filter comparison encodes because Drizzle binds through the column
 * type. That is why this shape was chosen over a Zod write-transform plus a
 * generated read-decode — TS's generated queries return raw Drizzle rows and have
 * no decode seam, so the query-layer approach meant inventing one and wrapping
 * every generated read. It is also the direct analogue of what the other four
 * ports already do (EF Core `HasConversion`, OMDB `JdbcFieldCodec`, Exposed
 * `customEnumeration`, Python `ObjectManager` coercion).
 *
 * `fromDriver` throws on an unmapped integer rather than returning undefined: a
 * value outside the map means the DB holds data the model says is impossible
 * (a hand-written INSERT, or a member removed without a migration), and silently
 * yielding `undefined` for a non-nullable field would surface far from the cause.
 */
export function renderEnumIntCustomType(t: EnumIntCustomType, importModule: string): Code {
  const customTypeSym = imp(`customType@${importModule}`);
  const union = t.members.map((m) => JSON.stringify(m)).join(" | ");
  const toEntries = t.members
    .map((m) => `${JSON.stringify(m)}: ${t.intByMember[m]}`)
    .join(", ");
  const fromEntries = t.members
    .map((m) => `${t.intByMember[m]}: ${JSON.stringify(m)}`)
    .join(", ");
  return code`
const ${t.toIntConstName} = { ${toEntries} } as const satisfies Record<${union}, number>;
const ${t.fromIntConstName}: Record<number, ${union}> = { ${fromEntries} };
const ${t.fnConstName} = ${customTypeSym}<{ data: ${union}; driverData: number }>({
  dataType: () => ${JSON.stringify(t.dataType)},
  toDriver: (value) => ${t.toIntConstName}[value],
  fromDriver: (value) => {
    const member = ${t.fromIntConstName}[value];
    if (member === undefined) {
      throw new Error(\`unmapped ${t.fnConstName} value: \${value}\`);
    }
    return member;
  },
});
`;
}
