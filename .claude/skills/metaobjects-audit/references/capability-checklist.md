# MetaObjects capability checklist (registry-grounded)

The **exhaustive** list of every modelable MetaObjects capability, each with its one-line
audit hunt: *"find a hand-written shape the metadata already describes."* Every
`type.subtype` and every `@`-prefixed attribute named here is verbatim from the cross-port vocabulary in
`fixtures/registry-conformance/expected-registry.json` (the
`agent-context-capability-grounding.test.ts` guard fails the build if a line claims a token
the registry lacks). Work this checklist on every axis so coverage is exhaustive; respect
the **inline calibration flags** so a per-port gap is never scored as the adopter's fault.

How to use a line: the capability is what the metamodel can express; the hunt is the
hand-written second-source-of-truth that should have been derived from it. Found one →
classify it (using the classification scheme in `SKILL.md`) and route the cutover to the right sibling skill.

---

## Object — `object.*`

- **`object.entity`** (`@discriminator` / `@discriminatorValue` for STI/TPH) — hunt
  hand-written entity classes, DTOs, and repositories whose field list duplicates a modeled
  entity; hand-rolled single-table-inheritance / type-discriminator switches that
  `@discriminator`+`@discriminatorValue` already model.
- **`object.value`** — hunt hand-authored request / command / payload value objects (no
  identity, no source) that restate a modeled `value` shape.
- **`object.projection`** — hunt hand-written read-model DTOs and the SQL views behind them
  that a derived read-only projection (extends + origin-derived fields) already describes.
- **`object.base`** — abstract base; hunt copy-pasted shared field blocks that should be an
  abstract base + `extends` (see cross-cutting).

## Field — `field.*`

- **`field.string`** (`@maxLength`) — hunt hand-validated string-length checks the field
  models.
- **`field.int` / `field.long` / `field.double` / `field.float`** — hunt ad-hoc numeric
  columns / parsing the subtype already types.
- **`field.decimal`** (`@precision` / `@scale`) — hunt money or quantity stored as `float`/
  `double` (lossy); the decimal subtype carries exact precision/scale.
- **`field.boolean`** — hunt int-or-string flags standing in for a boolean.
- **`field.currency`** (`@currency`, + `view.currency` `@locale`) — hunt money as float,
  hand `*100` / `/100` minor-unit math, or server-side `Intl.NumberFormat`; storage is
  integer minor units, formatting is client-side.
- **`field.date` / `field.time` / `field.timestamp`** (`@autoSet`) — hunt hand-stamped
  `createdAt` / `updatedAt` assignments and ad-hoc temporal parsing; `@autoSet` stamps them.
- **`field.enum`** (`@values`) — hunt hand-written TS unions, language `enum`s, or DB
  `CHECK ... IN (...)` lists that restate a modeled enum's members.
- **`field.uuid`** — hunt UUIDs typed as bare strings / hand-validated.
- **`field.object`** (`@objectRef`, `@storage`) — hunt hand-flattened owned columns or
  hand-rolled jsonb (de)serialization the `@storage` mode (`flattened`/`jsonb`/`subdocument`)
  already drives.
- **`field.map`** (`@valueType`) — hunt ad-hoc open-keyed key/value bags stuffed into a jsonb
  column by hand.
- **Common field attrs** — `@column` (hand column-name mapping), `@default` (hand default
  assignment), `@required` (hand presence checks), `@unique` (hand uniqueness), `@readOnly`
  (hand write-guards), `@filterable` / `@sortable` (hand filter/sort allowlists),
  `@dbColumnType` (hand native-type override), `@example` / `@instruction` (hand prompt
  hints), `@xmlText` (hand XML-text mapping). Indexed-without-filter suppression is the
  `db.indexed` attr (cite without the `@` sigil — it is a dotted attr name).
- **CALIBRATION — cut subtypes:** `field.byte`, `field.short`, `field.class` are
  non-functional removed stubs. **Do NOT audit for them and never recommend them.**

## Source — `source.rdb`

- **`source.rdb`** (`@table`, `@schema`) — hunt hard-coded physical table/schema names that
  diverge from the default naming the source models.
- **`@kind` = `view` / `materializedView`** — hunt hand-written SQL views where an authored
  projection source (read-only `@kind`) belongs.
- **`@kind` = `storedProc` / `tableFunction`** (`@parameterRef`) — hunt hand-called procs /
  table functions that a modeled callable source with `@parameterRef` already describes.
- **`@role` = `primary`** (multi-source write-through) — hunt manual CQRS / write-through
  wiring; exactly one `primary` source per object models it.
- **`source.base`** — abstract source base (no audit target of its own).

## Relationship — `relationship.*`

- **1:N / N:1** (`@cardinality`, `@objectRef`) — hunt hand-written FK joins and type-unsafe
  finders the cardinality + target reference already model.
- **M:N** (`@through`) — hunt hand junction-table queries where `@through` + the junction's
  two `identity.reference` children generate the traversal.
- **Self-join** (`@symmetric`, `@sourceRefField`) — hunt hand-coded self-join / graph queries
  that an undirected (`@symmetric`) or directed (`@sourceRefField`) self-relationship models.
- **Referential actions** (`@onDelete`, `@onUpdate`) — hunt app-code cascade/null-out logic
  the relationship's referential actions express.
- **`relationship.association` / `relationship.aggregation` / `relationship.composition`** —
  hunt ownership/lifecycle semantics (delete-with-parent, shared vs owned) coded by hand
  instead of by the relationship subtype.
- **`relationship.base`** — abstract base.

## Identity — `identity.*`

- **`identity.primary`** (`@generation`) — hunt hand-assigned primary keys / ID generation
  the primary identity's `@generation` strategy models.
- **`identity.secondary`** (`@fields`; physical escapes `@using`/`@expr`/`@where`/`@orders`) — a
  UNIQUE alternate key (uniqueness is the type — the legacy `@unique` attr was removed from it);
  hunt hand-rolled unique constraints or raw-SQL partial/functional unique indexes it models.
- **`identity.reference`** (`@references`, `@enforce`) — hunt hand-written FK constraints /
  reference enforcement the reference identity already declares.

## Index — `index.*` (non-unique retrieval)

- **`index.lookup`** (`@fields` required; physical escapes `@using`/`@expr`/`@where`/`@orders`) —
  a NON-unique retrieval index (uniqueness is what distinguishes it from `identity.secondary`);
  hunt hand-created lookup / recency indexes (`CREATE INDEX …`) it models.

## Origin — `origin.*` (projection-field derivation)

- **`origin.aggregate`** (`@agg`, `@of`, `@via`) — hunt hand `COUNT` / `SUM` / `AVG`
  subqueries or in-app rollups a derived aggregate field models.
- **`origin.passthrough`** (`@from`, `@via`) — hunt denormalized-by-hand copied fields that a
  passthrough origin pulls across a relationship.
- **`origin.collection`** (`@via`) — hunt hand-assembled child-collection loading a collection
  origin derives.
- **`origin.base`** — abstract base.

## Validator — `validator.*`

- **`validator.required` / `validator.length` / `validator.numeric` / `validator.array` /
  `validator.regex`** — hunt hand field-level validation (presence, length, numeric range,
  array bounds, `@pattern` regex) the validator subtypes model.
- **Cross-field validators** — `validator.comparison` (`@left`/`@op`/`@right`, e.g.
  "end ≥ start"), `validator.atLeastOne` (one-of-N present), `validator.requiredWhen`
  (conditional-required), `validator.presentIff` (mutual presence). Hunt these as hand-coded
  multi-field rules — they ARE modelable (see the Semantic-constraint ratification section in
  `SKILL.md` to decide what belongs in shared metadata vs port-local).
- **`validator.base`** — abstract base.

## View / Layout — `view.*`, `layout.*`

- **`view.currency`** (`@locale`) — hunt hand-passed currency locale / `Intl.NumberFormat`
  options the currency view models. **Cross-port-gated** (with `view.base`).
- **`layout.dataGrid`** (`@columns`, `@defaultSortField`, `@defaultSortOrder`, `@pageSize`) —
  hunt hand-written grid column definitions + data hooks a data-grid layout generates.
- **CALIBRATION — TS/web-only:** the `view.*` widget subtypes exist only for TS/web consumers
  and are NOT in the cross-port registry — `view.text`, `view.textarea`, `view.date`,
  `view.month`, `view.hotlink`, `view.dropdown`, `view.radio`, `view.checkbox`, `view.number`,
  `view.password`, `view.hidden`, `view.web`. **Audit these only for TS adopters.** Only
  `view.base` / `view.currency` are cross-port-gated.

## Template — `template.*` (prompt pillar)

- **`template.prompt`** (`@payloadRef`, `@textRef`, `@responseRef`, `@requiredSlots`,
  `@maxTokens`, `@maxChars`, `@format`, `@model`, `@promptStyle`) — hunt prompt strings
  assembled inline in services, payloads built ad-hoc, output parsing without a typed
  `@responseRef`, or token/char budgets enforced by hand.
- **`template.output`** (`@kind` = `document` | `email`; `@subjectRef`, `@htmlBodyRef`,
  `@textBodyRef`) — hunt hand-built document/email rendering + hand-written
  parse-on-receipt the output template + generated render helper/parser cover.
- **`template.toolcall`** (`@toolName`, `@payloadRef`) — hunt hand-declared LLM tool schemas
  a modeled tool call describes.
- **`template.base`** — abstract base.

## Attr — `attr.*`

- **`attr.properties`** — the sanctioned author key/value escape hatch; hunt ad-hoc metadata
  stuffed into code comments / side-maps that could instead ride the properties bag.
- **`attr.filter`** — hunt hand-maintained preset filter definitions a modeled filter attr
  holds.
- **`attr.class`** — binding facet (`field.class` binding); hunt hand-wired type-binding
  facets. (`attr.base`, `attr.string`, `attr.int`, `attr.long`, `attr.double`, `attr.boolean`
  are the value-type primitives behind typed attrs — not direct audit targets.)

## Common documentation attrs (any node)

- `@description`, `@title`, `@summary`, `@notes`, `@deprecated`, `@replacedBy`, `@seeAlso`,
  `@aliases` — hunt weak/absent generated docs and deprecation tracked only in code comments;
  these doc attrs flow into JSDoc / XML-doc / Postgres `COMMENT` / Mermaid doc-gen, and
  `@deprecated` / `@replacedBy` model lifecycle the codebase tracks by hand. (`@notes` is the
  internal-only rationale slot — never emitted to user-facing doc-gen.)

## Cross-cutting

- **`extends`** (any depth, cross-package `::`) — hunt copy-pasted base-entity field blocks
  that should be an abstract base inherited via `extends` (the inheritance mechanism;
  `origin.*` never inherits).
- **Filter + sort + pagination REST layer** — hunt hand-written query parsing, `LIMIT`/
  `OFFSET` pagination, total-count queries, and filter/sort handling the generated CRUD layer
  (8 filter operators + sort + `?limit=N&offset=N` + count) already provides.
  - **CALIBRATION — per-port codegen gaps:** filter-operator route codegen is full only in
    **TS**; Java / Kotlin / C# / Python generate pagination/sort/count but **defer filter
    ops** — do NOT flag hand-added filter handling there. Output-parser codegen ships
    TS/C#/Python/Kotlin; **Java hand-writes** the Jackson parse (acceptable). **Python**
    still hand-wires the FastAPI router around a generated `APIRouter` (relationship /
    non-`table` source-kind / flattened-object codegen is partial). **C#** has no
    ObjectManager runtime tier (EF Core *is* the runtime) — hand services over the generated
    `DbContext` are expected.
- **Single-source config** — `apiPrefix` (URL prefix wired into routes + hooks) and
  `columnNamingStrategy` (snake_case / literal / kebab-case) and per-target output dirs:
  hunt these values hard-coded in multiple places instead of resolved from config.
- **CALIBRATION — planned, not yet shipped:** the declared-API surface (`api.base`,
  `api.operational`, `operation.query`, `operation.command`, `binding.rest`) and MCP exposure
  of declared prompts/tools are **not yet in the registry** — their absence is not an adopter
  defect; do NOT audit for them.
- **CALIBRATION — cross-port version skew is by design:** TS/C#/Python on the `0.x` line vs
  Java/Kotlin on the `7.x` Maven line is correct — **never flag it.** Flag only *intra-port*
  version drift (mixed package versions within one port, or a runtime package in
  `devDependencies`). Trust the port docs + `meta gen --list`, not stale upstream prose
  (e.g. the out-of-date "hand-write the Spring controller" note — controllers ARE generated).
