# Calibration — port gaps and non-defects (do NOT flag these as adopter fault)

## Contents
- Filter-operator route codegen
- Output-parser codegen
- Python
- C#
- Cut subtypes
- TypeScript / web-only vocabulary
- Planned, not shipped
- Cross-port version-number skew
- Stale upstream prose

- **Filter-operator route codegen — the baseline grammar ships in all five ports.** The
  `?filter[field][op]=value` grammar (all 9 operators `eq/ne/gt/gte/lt/lte/in/like/isNull`,
  implicit-AND across params, the generated `<Entity>FilterAllowlist` + `invalid-field` /
  `invalid-op` / `in`-over-cap 400s) is **generated in every port** (Java `SpringControllerGenerator`,
  C# `RoutesGenerator`, Python `router_generator`, Kotlin `KotlinSpringControllerGenerator`, TS) —
  gated by the api-contract corpus in BOTH lanes. **Flag hand-rolled filter parsing anywhere.**
  Only the *richer* surface is genuinely **TS-only**: free-text `?search=`, the explicit
  `filter[or][N]` / `filter[and][N]` nested boolean combinators (+ their nesting-depth cap), and
  leading-wildcard gating — do NOT flag the absence of those in a non-TS port.
- **Output-parser codegen** ships in **all five ports** — Java's `SpringOutputParserGenerator`
  *generates* the `<Name>Parser` (the Jackson `readValue` lives inside that generated file). A
  hand-rolled parser in a **non-generated** file where a **responding `template.prompt`**
  (`@responseRef`) exists IS a finding. Per ADR-0052 a `template.output` emits no parser.
- **Python** still hand-wires the FastAPI router + repository impl around a generated
  `APIRouter`; relationship / non-`table` source-kind / `field.object flattened` codegen is partial.
- **C#** has no ObjectManager runtime tier (EF Core is the runtime) — hand services over the generated `DbContext` are expected.
- **Cut subtypes** — `field.byte` / `field.short` / `field.class` are removed; never recommend them.
- **TS/web-only** — `view.*` widget subtypes load in every port but are consumed only by TS/web; only `view.base` / `view.currency` are cross-port-gated.
- **Planned, not shipped** — `api.*` / `operation.*` / `binding.*` (FR-024) and MCP exposure of declared prompts/tools are not yet in the registry; their absence is not an adopter defect.
- **Cross-port version-NUMBER skew is by design** — TS/C#/Python `0.x` vs Java/Kotlin `7.x` Maven is correct; never flag the *number lines* differing. But that is exactly why you can't eyeball cross-language drift: compare **`metamodelVersion`** (Phase 0 cross-language consistency item), not the package numbers. A `metamodelVersion` MISMATCH across ports *is* a finding; so is a port lagging its ecosystem's latest release. Also flag *intra-port* drift (mixed versions within one port, or a runtime package in `devDependencies`).
- **Stale upstream prose** — "hand-write the Spring controller" (Java/Kotlin) is out of date; trust `meta gen --list`, not stale prose.
