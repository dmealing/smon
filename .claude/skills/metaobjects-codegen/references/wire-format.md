# The JSON a generated API writes: the `wire` setting

> Part of the `metaobjects-codegen` skill. Read it before you change how a generated API writes a decimal or a null value-object member, before you hand-edit a JSON converter or annotation in generated code, and before you upgrade a project that serves a live API.

**The rule: each port writes what its language's standard serializer writes.** A C# API writes
JSON the way System.Text.Json does, a Java API the way Jackson does, a Python API the way
Pydantic does. Identical output across ports is something a project opts into. The cross-port
conformance corpora pin that opt-in form in their own config. They never decide a default, so do
not "fix" a port to match another one, or to match the corpus.

## Contents
- The setting
- What each port writes
- Choosing a form
- What it never changes
- Upgrading, and drift

## The setting

`wire` in `.metaobjects/config.json`, beside `naming`. Every port's codegen reads it from the
loaded root; there is no CLI flag and no generator argument.

```json
{ "schema_version": 1, "wire": { "decimals": "native", "nullMembers": "native" } }
```

- `decimals`: `native` (default) or `string`, the canonical string (`"12.5"`, zero `"0"`, no
  exponent, no trailing zeros).
- `nullMembers`: `native` (default), `emit` or `omit`. It covers the members of an
  `object.value` only. A top-level entity field that is null is always written as `null`.
- An absent block or key means `native`. An unknown key or value is refused when the config is
  read. There is no `"number"` value: in C#, Java and Kotlin `native` already is a number.

## What each port writes

| Port | `decimals: native` | `decimals: string` | `nullMembers: native` | `emit` | `omit` |
|---|---|---|---|---|---|
| C# | JSON number, scale kept (`12.50`) | `"12.5"` | `null`, key present | same as native | left out |
| Java | JSON number, as the host's Jackson writes a `BigDecimal` (`12.50`, `1E-7`) | `"12.5"` | `null`, key present | same as native | left out |
| Kotlin | same as Java | `"12.5"` | `null`, key present | same as native | left out |
| Python | string, `str(Decimal)` (`"12.50"`, `"1E-7"`) | `"12.5"` | as stored | every declared member, `null` when unset | left out |
| TypeScript | string as the driver returns it (`"12.50"`; 15 significant digits on SQLite and D1) | `"12.5"` | as stored | every declared member, `null` when unset | left out |

How it shows in generated code:

- **C#.** `native`: `[DecimalWire.Number]`, or `[DecimalWire.Number(p, s)]` with `@precision`.
  `string`: the `DecimalWire` string converters, or `[DecimalWire.Declared(p, s)]`. `omit`
  adds `[JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]` to each nullable
  value-object member.
- **Java and Kotlin.** `string` adds the canonical decimal serializer; `omit` adds
  `@JsonInclude(NON_NULL)` to each value-object type. `native` adds neither, so the host's
  `ObjectMapper` decides.
- **Python and TypeScript.** The generated routes write each response through the port's wire
  helper with the setting baked in.

## Choosing a form

- **Keep the default** for an API whose clients already exist, or are written in the same
  language as the server. It is what a developer of that language expects to see.
- **Choose `"decimals": "string"`** when clients in several languages share one contract, or a
  browser client must read a decimal exactly. `JSON.parse` turns a JSON number into a double
  before any code sees it. This is the form 1.1.0 and 1.1.1 wrote.
- **Choose `"nullMembers": "omit"` or `"emit"`** when every port must agree on whether a null
  member appears. `emit` is the one that changes Python and TypeScript output; in the JVM ports
  and C# it is what `native` already writes.

Change the setting, then regenerate and commit. Do not hand-edit the converter or annotation in a
generated file to get a different form: a regen puts it back, and `verify --codegen` fails on it.

## What it never changes

Input. In every mode a decimal in a request body is a string in the JSON-number grammar or a JSON
number, read exactly; garbage, and a value past `@scale` or `@precision`, is `400 validation`,
never rounded; a filter operand is compared exactly and a bad one is `400 invalid_filter_value`.
The generated input converters stay in every mode.

## Upgrading, and drift

- From 1.0.x, upgrade to 1.1.2 or later. With no setting, C#, Java and Kotlin keep their 1.0.x
  output. In TypeScript, a decimal keeps its scale (`"12.50"`). Python changed; see the next bullet.
- In Python this is a change, not a no-op. A 1.0.x router wrote a decimal as a JSON number, a float
  that can lose digits (`12.5`). The 1.1.2 default writes a string, Pydantic's `str(Decimal)`, which
  is the Python-normal form (`"12.50"` for a decimal stored at scale 2). There is no float option, by
  decision. Update a Python client that read the number to read the string. `"decimals": "string"`
  gives the canonical `"12.5"` form that 1.1.0 and 1.1.1 wrote.
- A project already on 1.1.0 or 1.1.1 whose clients now expect strings and omitted members
  declares `"wire": { "decimals": "string", "nullMembers": "omit" }` before it moves to 1.1.2.
- Every port's codegen drift gate (`meta verify --codegen`, `dotnet meta verify --codegen`,
  `mvn metaobjects:verify`, `metaobjects verify`) names the `wire` block that reproduces
  committed output generated under another setting. When it does, declare that block; do not regenerate.

Full table and detail: `docs/features/api-contract.md`, "The wire setting"; the decision is
ADR-0019 Amendment 2.
