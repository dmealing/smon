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
  assignment), `@required` (hand presence checks), `@unique` (hand uniqueness),
  `@mutability` (hand write-guards: `readOnly` for a column the DB/replication owns,
  `writeOnce` for one set at create and never changed — hunt hand-written
  "cannot be modified after creation" checks), `@filterable` / `@sortable`
  (hand filter/sort allowlists),
  `@dbColumnType` (hand native-type override), `@example` / `@instruction` (hand prompt
  hints), `@xmlText` (hand XML-text mapping). The `@db.indexed` attr suppresses the
  *`@filterable`-without-index* Loader warning (you assert the column is indexed by other
  means); it is a dotted attr name but canonical JSON still authors it WITH the sigil:
  `"@db.indexed": true`.
- **CALIBRATION — cut subtypes:** `field.byte`, `field.short`, `field.class` are
  non-functional removed stubs. **Do NOT audit for them and never recommend them.**

## Source — `source.rdb`

- **`source.rdb`** (`@table`, `@schema`) — hunt hard-coded physical table/schema names that
  diverge from the default naming the source models, AND any physical table/column/schema
  name spelled as a literal outside its declaration — raw SQL, a hand-written repository, a
  migration script, a body-to-column map (drift signature 11). Every port emits a per-object
  names artifact from the declaration, so a literal is a second source of truth even when it
  agrees with the naming strategy today. A typed ORM handle in its place is correct; on the
  JVM an un-wired names generator is the finding first.
- **`@kind` = `view` / `materializedView`** — hunt hand-written SQL views where an authored
  read-only source belongs. Apply the **view-necessity test** (SKILL.md, drift signature 8): a
  hand-written `CREATE VIEW` (or read-only SQL mirroring a read model) is a CODEGEN CANDIDATE when
  its shape is expressible via `origin.passthrough` / `origin.aggregate` /
  `origin.computed` / `origin.first` + `extends`. Route by shape: an entity's OWN columns plus an
  extra (`SELECT o.*, …`) → an **entity read-view** (#214: a `@role: replica` view beside the
  writable `table`); a subset / renamed / row-filtered exposure → an `object.projection` (row-scope
  with an object-level `@filter`, #207) — so `meta migrate` emits the view DDL. A genuinely
  irreducible body (recursive CTE, window function, set op) belongs in the `source.rdb` `@sql`
  escape (#208), not a hand migration. Only an *undeclared* view is invisible to `meta verify --db`,
  so this is audit-only.
- **`@kind` = `storedProc` / `tableFunction`** (`@parameterRef`) — hunt hand-called procs /
  table functions that a modeled callable source with `@parameterRef` already describes.
- **`@sql`** (read-only `@kind` only; mutually exclusive with `@unmanaged`) — a hand-written SQL
  body the tool REGISTERS, fingerprints, and drift-checks but never authors or parses (#208,
  ADR-0043). The **escape valve for a genuinely irreducible view** origins can't express (recursive
  CTE, window function, set op): carry the body here rather than in a hand-edited migration where it
  goes accidentally unmanaged. Forbids `origin.*` children (two sources of truth); adopt a
  pre-existing view with `meta migrate --allow adopt-view`. Hunt a hand-written irreducible
  `CREATE VIEW` in a migration / `.sql` that should be carried in `@sql`.
- **`@unmanaged`** (any `@kind` incl. `table`; mutually exclusive with `@sql`) — marks a DB object
  whose DDL is owned entirely elsewhere (Flyway / a hand-migration). `meta migrate` never creates,
  drops, or drift-checks it; `verify --db` reports it as external (declared). Hunt an
  externally-owned table/view the metadata silently omits instead of declaring `@unmanaged: true`.
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
- **`identity.secondary`** (keys off `@fields` XOR `@expr` — exactly one, never both; physical
  escapes `@using`/`@where`/`@orders`) — a UNIQUE alternate key (uniqueness is the type — the
  legacy `@unique` attr was removed from it, and the same XOR rule as `index.lookup` applies here
  because ADR-0040 puts uniqueness in the TYPE: a secondary identity IS a unique index);
  hunt hand-rolled unique constraints or raw-SQL partial/functional unique indexes it models.
- **`identity.reference`** (`@references`, `@enforce`) — hunt hand-written FK constraints /
  reference enforcement the reference identity already declares.

## Index — `index.*` (non-unique retrieval)

- **`index.lookup`** (keys off `@fields` XOR `@expr` — exactly one, never both; physical escapes `@using`/`@where`/`@orders`) —
  a NON-unique retrieval index (uniqueness is what distinguishes it from `identity.secondary`);
  hunt hand-created lookup / recency indexes (`CREATE INDEX …`) it models.

## Origin — `origin.*` (derived fields — on projections AND entity read-views)

- **`origin.aggregate`** (`@agg`, `@of`, `@via`, `@filter`) — `@agg`: `count`/`sum`/`avg`/`min`/`max`
  (numeric reduces over `@of`), `any`/`all` (predicate quantifiers over `@filter`; `@of` forbidden),
  `collect` (array rollup of `@of` into an `isArray` field; `@distinct`/`@orderBy` collect-only).
  Any aggregate may be row-scoped with `@filter`. Hunt hand `COUNT`/`SUM`/`AVG`/`EXISTS`/`array_agg`
  subqueries or in-app rollups a derived aggregate field models.
- **`origin.passthrough`** (`@from`, `@via`, `@convert`) — hunt denormalized-by-hand copied fields
  that a passthrough origin pulls across a relationship.
- **`origin.computed`** (`@expr` — a closed `attr.expression` grammar) — hunt a hand-computed derived
  scalar (a formula over other fields) a computed origin models.
- **`origin.first`** (`@of`, `@via`, `@orderBy`, `@filter`; `@orderBy` REQUIRED) — hunt a hand
  argmax-style "one related row's column" projection — a `DISTINCT ON … ORDER BY` or correlated
  `ORDER BY … LIMIT 1` — a first origin models (nullable).
- **`origin.base`** — abstract base.

Distinct from the per-aggregate `@filter` above, an **object-level `@filter` on
`object.projection`** (#207) row-scopes the WHOLE view (outer `WHERE`) — hunt a hand-written
soft-delete / status / type view it models.

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

**A template subtype's axis is DIRECTION** (ADR-0052): `template.prompt` owns everything about
talking to a model — both the request and the reply — while `template.output` renders an
artifact for a person or a file and generates **no parser**.

- **`template.prompt`** (`@payloadRef`, `@textRef`, `@responseRef`, `@responseFormat`,
  `@promptStyle`, `@requiredSlots`, `@requiredTags`, `@maxTokens`, `@maxChars`, `@format`,
  `@model`) — hunt prompt strings assembled inline in services, payloads built ad-hoc,
  token/char budgets enforced by hand, and **hand-written parse-on-receipt**: a prompt
  declaring `@responseRef` owns the inbound half, so the strict parser, the tolerant
  `extract` mapper and the FR-010 output-format fragment are all generated from it.
  (`@promptStyle` — the FR-010 output-format presentation, `guide` / `inline` /
  `exampleOnly` — is on `template.prompt` ONLY; authoring it on `template.output` fails load
  with `ERR_UNKNOWN_ATTR`.)
- **`template.output`** (`@kind` = `document` | `email`; `@textRef`, `@subjectRef`,
  `@htmlBodyRef`, `@textBodyRef`, `@payloadRef`, `@format`, `@maxChars`, `@requiredTags`) —
  **outbound only.** Hunt hand-built document/email rendering the output template + generated
  render helper cover. It parses nothing: a parser here would be reading back text the system
  just rendered and sent.
- **`template.toolcall`** (`@toolName`, `@payloadRef`, `@maxTokens`) — hunt hand-declared LLM
  tool schemas a modeled tool call describes.
- **`template.base`** — abstract base.

## Attr — `attr.*`

- **`attr.properties`** — the sanctioned author key/value escape hatch; hunt ad-hoc metadata
  stuffed into code comments / side-maps that could instead ride the properties bag.
- **`attr.filter`** — hunt hand-maintained preset filter definitions a modeled filter attr
  holds.
- **`attr.class`** — binding facet (`field.class` binding); hunt hand-wired type-binding
  facets. (`attr.base`, `attr.string`, `attr.int`, `attr.long`, `attr.double`, `attr.boolean`
  are the value-type primitives behind typed attrs — not direct audit targets.)
- **Custom-provider extension point** (`attr.properties` is the one-off escape hatch;
  `template.toolcall` is the historical register→extend precedent) — hunt a *recurring,
  closed* variant set hand-coded as parallel modules (channels / providers / export targets)
  that a project-registered subtype with a closed variant discriminator + a small owned
  generator would own. Apply the ADR-0037 ordered test before proposing; advisory (VOCAB
  CANDIDATE); see SKILL.md axis I "New-vocabulary OPPORTUNITY".

## Requirement — `requirement.*` (capability ledger)

The only axis here whose hunt is not "hand-written code the metadata describes" but
**hand-written PROSE that claims something about the code and nothing checks.** Two
subtypes with opposite polarity: `requirement.functional` fails when NOTHING implements it
(existence); `requirement.architectural` fails when something VIOLATES it (universality).

- `requirement.functional` — `@statement`, `@status`, `@level`, `@counterexample` — hunt a
  `CAPABILITIES.md`, a features table in a README, a `docs/status/` tree, or a spreadsheet
  that lists what the system does and how done each item is. Prose goes stale silently; a
  declared requirement is a node the loader resolves and `meta verify` reports on.
- `requirement.architectural` — `@statement`, `@status`, `@counterexample`, optional `@level` —
  hunt a conventions doc, a lint rule with no enforcement, or an ADR whose ruling is
  restated in review comments ("we always do X"). `@level` is optional here on purpose:
  absent keeps the flat object-independent form, present opts into a taxonomy.
- `@implementedBy` — hunt the mapping from "capability" to "the code that provides it"
  living only in someone's head, a wiki table, or a comment. This is the load-bearing
  attribute: it is a REFERENCE the loader resolves, so a rename or deletion that
  invalidates the claim is caught, where prose would not be.
  - **L4 binds an object; L5 binds one MEMBER of it, as a dotted `pkg::Owner.member` path.**
    Mismatches are errors at both levels (`ERR_REQUIREMENT_L5_NOT_MEMBER` /
    `ERR_REQUIREMENT_L4_NOT_OBJECT`) and the fix is to move the entry to the other level,
    not to change the ref. Reach for L5 for a rule about ONE column — the kind currently
    recorded only as a comment above a field.
- `@disposition` (`accepted` / `deferred`) + `@trackedBy` — hunt a known-and-tolerated gap
  recorded as a TODO, or a ticket number in a comment. **ABSENT disposition means UNDECIDED**,
  which is the point: a gap nobody has ruled on reads differently from one deliberately
  accepted.
- **The doc slots behave differently on this node type** — do not audit them by the generic
  rule below. `title` is CHARTERED here (a requirement's `name` is an identifier, so the label
  lives in `title`) and is **rendered** by `meta docs`, heading each entry after its dotted
  path; `summary` is INERT (nothing reads it, and `@statement` is already the required
  one-liner) and `meta verify` warns on one. So an absent `summary` is correct, a populated
  one is the finding, and a populated `title` is correct.
- **CALIBRATION — entirely opt-in and warning-only where it counts.** A project declaring no
  `requirement.*` nodes sees no diagnostics at all, and object coverage ("entities claimed
  by nothing") ships as a WARNING deliberately — a real estate carrying one requirement will
  report most of itself unclaimed on day one. Do NOT score an absent ledger as a defect;
  score the hand-written prose it would replace.

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
  (9 filter operators `eq/ne/gt/gte/lt/lte/in/like/isNull` + sort + `?limit=N&offset=N` + count)
  already provides.
  - **CALIBRATION — per-port codegen gaps:** the core `?filter[field][op]` filter grammar (all
    9 operators + the generated allowlist + `invalid-field` / `invalid-op` / `in`-over-cap 400s)
    is **generated in all five ports** (api-contract corpus, both lanes) — **flag hand-rolled
    filter parsing anywhere.** Only the richer surface (`?search=`, explicit
    `filter[or][N]` / `filter[and][N]` combinators, leading-wildcard gating) is TS-only.
    Output-parser codegen also ships in **all five ports**, keyed on a **responding
    `template.prompt`** (`@responseRef`), never on a `template.output` (ADR-0052) — Java's
    `SpringOutputParserGenerator` *generates* the parser (the Jackson `readValue` lives inside
    that generated file). **Python**
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
