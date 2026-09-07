---
name: metaobjects-audit
description: Use when assessing how well a project has adopted MetaObjects — greenfield first-pass or deep double-check; produces a scored, prioritized adoption-audit report covering codegen, runtime, drift-gates, and prompts.
---

# MetaObjects adoption audit

**Thesis.** Typed metadata is the durable spine; generated code is the disposable
artifact. Hand-writing a layer the metadata could own creates a second source of
truth for one fact — it will drift. This audit hunts those second sources of truth
and proposes folding them into the spine.

**Boundary — read-only.** Deliverables: `.metaobjects/adoption-audit.json` (machine-readable
findings) + a rendered Markdown report. The audit **never edits code, never authors
metadata** — `metadata_sketch` per finding is a read-only proposal for human review.
Actual cutovers run through the existing skills mapped per finding tier (§ Bridge).

---

## Phase 0 — Triage (fast, mechanical)

- [ ] MetaObjects present? (`metaobjects/` dir, metadata sources, `@metaobjectsdev/*` /
  `com.metaobjects:*` / `metaobjects` / `MetaObjects.*` deps).
- [ ] Count metadata source lines + all `@generated` / `DO NOT EDIT` files repo-wide.
- [ ] **Owned-generators check:** does the project own generators at `codegen/generators/*`
  (scaffold-and-own via `meta init`), or still import `entityFile` / `queriesFile` /
  `routesFile` / `barrel` from `@metaobjectsdev/codegen-ts/generators`? Those four were
  REMOVED at 1.0, so an import of them is an upgrade blocker, not just a style finding.
  **Match the four NAMES, never the subpath alone** — that subpath is the supported home of
  the non-ownable generators (`promptRender`, `outputParser`, `routesFileHono`, …), so
  flagging a hit on the path convicts a correct project.
- [ ] **Cross-language version consistency (silent-drift check).** If the project uses MetaObjects in more than one language (e.g. a TS web client + a Java/Python/C# backend), enumerate EVERY MetaObjects package across ALL ecosystems (npm `@metaobjectsdev/*`, Maven `com.metaobjects:*`, PyPI `metaobjects`, NuGet `MetaObjects.*`) and record each version. **The version-number LINES differ by ecosystem (npm/PyPI/NuGet `0.x`/`1.x` vs Maven `7.x`/`8.x`), so you CANNOT eyeball drift** — a `0.12` next to a `7.7` looks fine but can be badly out of sync. Compare the **`metamodelVersion`** each port reports (the shared spec version on the registry manifest): a mismatch is real cross-language drift and a **finding** — the ports disagree on vocabulary/wire behavior. Also flag any port not on the latest release for its ecosystem. (This is a known real-world failure mode: newest backend, stale client, invisible because the numbers differ.)
- [ ] Classify: **Greenfield** (none/minimal) · **Partial** · **Deep** → choose path below.

---

## Phase 1a — Greenfield path

- [ ] **Shape inventory.** Catalog modelable shapes: entities/tables, DTOs, validation
  schemas, routes, UI lists/forms, prompt sites.
- [ ] **Pick wedge:** one real entity (single-column PK, standard CRUD) to model first.
- [ ] **From-zero roadmap:** `meta init` → model the wedge → `meta gen` the data layer →
  author a projection view → expand to routes/UI → add prompt pillar where LLM calls exist.
  Owning the generators from day 1 is part of the roadmap.

## Phase 1b — Partial / Deep path

**Census:** generated output line/file counts + metadata/owned-generator lines.
Compute **leverage ratio** = `generated_lines / (metadata_lines + generator_lines)`;
healthy = multi-× (example: ~4.7k spine → ~15.7k generated ≈ 3.3×).

**Coverage matrix:** per entity/projection/value — query helpers? view? routes? UI?
The gap between "modeled + query helpers" and "has view + route + UI" is the headline
lopsidedness.

**Surface review — 8 axes (independently runnable).**
Work the full `references/capability-checklist.md` on every axis. Check calibration
guards (§ Calibration) before raising a finding. **Verify, don't assume** — read the
code behind a grep hit; a "duplicate" validator's *divergence* is the finding.

- [ ] **A. Codegen candidates — API / server routes.** Catalog + classify every handler.
- [ ] **B. Codegen candidates — web / client.** Pages, data layer (hooks, central fetch),
  grids/forms/filters vs `layout.dataGrid` / form generators / filter-allowlist.
- [ ] **C. Drift hotspot — validators, mappers, runtime models.** Hand validators / DTO-mappers /
  dataclasses shadowing a generated shape. Diff field-by-field; the divergence is the bug.
- [ ] **D. Prompt pillar.** Every LLM prompt-construction site (see § Prompt anti-patterns).
- [ ] **E. Owned generators & scaffold-and-own** (see § Owned-codegen assessment).
- [ ] **E2. Capability ledger — `requirement.*`** (see `references/requirements.md` and the
  Requirement axis of the capability checklist). The one axis whose hunt is hand-written
  PROSE rather than hand-written code: a `CAPABILITIES.md`, a README features table, a
  conventions doc, a known-and-tolerated gap recorded as a TODO, or a rule that exists only
  as a comment above the field it governs. Prose goes stale in silence; `@implementedBy` is
  a reference the loader resolves, so a rename that invalidates the claim is caught.
  **Entirely opt-in — an absent ledger is NOT a defect** (object coverage is a warning by
  design, and a real estate reports most of itself unclaimed on day one). Score the prose
  it would replace, and prefer ONE concrete claim an author can check over a
  whole-estate migration.
  **First establish the estate LOADS.** An older ledger fails the load outright, so
  `meta verify` never runs and everything in `references/requirements.md` is unavailable:
  `@violation` and `@verifiedBy` were retired in **0.24.0** (no deprecation shim — ADR-0023
  seals the registry); an index key declaring both `@fields` and `@expr` is refused since
  **0.24.1**; and **0.24.2** turned `@status: abandoned | superseded` into **`retired`**. Run
  **`meta upgrade`** (previews by default; `--apply` writes) before auditing, and audit the
  upgraded tree. It rewrites only what has one correct answer and **refuses the rest, exiting
  non-zero** — a refusal is itself a finding, naming the entries whose disposition nobody
  recorded.
  **Then audit the `retired` entries specifically.** They are where the ledger earns its
  keep — agents proposing a retired capability's rebuild is the one failure this mechanism
  has controlled evidence against — and they are also where it decays quietly. Check that
  each `@statement` reads as a PROHIBITION rather than a diary entry ("X is never done",
  not "we used to do X"), and that `@counterexample` describes the REVIVAL. A retired entry
  whose statement narrates history is invisible to the reader it exists to stop.
- [ ] **F. Drift-gate adoption.** Is `meta verify` wired into CI / pre-commit? Which
  subverbs (`--codegen` / `--templates` / `--db`)? Committed-codegen freshness gate?
  Advisories heeded? Routine `--no-verify` bypass? Loader `ERR_*` / warnings addressed?
  Parse the stable `code` field, not message text (ADR-0009).
  **Is any advisory half switched OFF?** A gate can be wired, green, and muted. The
  requirements authoring lint is advisory and mutable — `--no-requirement-lint` or
  `META_NO_REQUIREMENT_LINT=1` silences it while the gate above it still runs and can still
  exit 1, so a green pipeline says nothing about the seven `WARN_REQUIREMENT_*` authoring
  checks. Grep CI config and scripts for both spellings. Muted is not automatically a defect —
  a project that made a deliberate call is fine — but it moves those checks back onto the
  auditor (see `references/requirements.md`), so **say which it is** rather than reporting the
  ledger as lint-clean.
  **Coverage completeness — "wired" is not "covers it all."** A gate can be present
  yet blind to a whole artifact class. Confirm each subverb actually covers what the
  project HAS: (a) **templates** — `verify --templates` on a CLI before the #193 fix
  SKIPS `template.output @kind=email` and does not body-check a document
  `template.output`'s mustache, so a `{{field}}` that drifted from the payload sails
  through; a project with email/output templates that relies on `verify` alone (no
  `meta gen` + `git diff --exit-code`, and no CLI past the fix) can ship broken —
  **finding**; (b) **codegen** — committed generated code needs `--codegen` (or
  gen+no-diff), else hand-edits/regeneration drift silently; (c) **schema** — `--db`
  (Node `meta` only) for DB drift. Flag a gate that is WIRED BUT INCOMPLETE for the
  artifacts present, and recommend the specific missing coverage.
- [ ] **F2. Over-generation — unnecessary generated files (codegen WASTE).**
  Generated code is disposable, but that is NOT license to generate what nothing
  consumes. Every generated file is a merge/review/maintenance surface and inflates
  the leverage ratio falsely. Hunt OVER-generation (the inverse of A/B's
  under-generation):
  - **Dead generated files** — an `@generated` file that NOTHING imports or
    references repo-wide (grep the emitted symbol / module path for importers):
    delete it and stop generating it.
  - **Artifacts an entity doesn't need** — REST routes / TanStack grids / forms /
    hooks emitted for an entity that has no such surface. The remedy is the
    generator's own `filter` option (`routesFile({ filter: (e) => e.name !== "Audit" })`,
    `tanstackQuery({ filter })`), which is ANDed with the generator's built-in gates
    and so can only NARROW what emits; a grid additionally needs a `layout.dataGrid`
    on the entity at all. Flag the unused artifact and name the filter that would
    suppress it. **Never recommend an `@emit*` attribute** — `@emitRoutes`,
    `@emitTanstack`, `@emitForm`, `@emitGrid` and `@emitAngular` were never
    registered vocabulary, so they passed `meta gen` (open load) and FAILED
    `meta verify` (strict). A project carrying one is a **finding**, not an opt-out:
    report it and route to `meta upgrade --apply` plus the generator config above.
  - **Generators wired but unconsumed** — a generator in `metaobjects.config.ts`
    `generators: [...]` (or the per-port equivalent) whose whole output class no
    code imports: drop the generator rather than generate into the void.
  - **Wrong target / duplicate output** — the same logical artifact emitted to two
    places (a mis-set per-target `outDir`), one of which is orphaned.
  Recommend generating ONLY what is consumed — decide per generator: drop the ones
  whose whole output class nothing imports, and narrow the ones that over-emit with
  their `filter`. A smaller, fully-consumed generated surface beats a large one with
  dead files (which also make the leverage ratio lie; discount them from the census).
- [ ] **G. Runtime-contract anti-patterns.** Module-global `db` vs context-as-parameter
  (ADR-0008); wire-canonicalization in the query path vs native in-process return types
  (ADR-0019); runtime reflection to resolve a type from FQN vs generated static imports /
  FQN registry (ADR-0001 / 0017); process-global registry vs per-loader (ADR-0014); code
  that **mutates the loaded metadata tree** (read-only after load); JVM/Kotlin missing
  startup validator; writes not routed to the `@role: primary` source; **`own*()`
  accessor reads of effective properties / own-only member iteration (ADR-0039 — see
  the active check below).**

- [ ] **G2. `own*()` accessor discipline (ADR-0039 — CORRECTNESS DEFECT, not advisory).**
  In any custom generator, metamodel provider, or runtime path (NOT the sanctioned cases
  below), **flag every read of a field/node's effective property, or own-only member
  iteration, done through an own-only accessor** — it silently drops everything inherited
  via `extends` (a super-reference, not a flatten), corrupting codegen and runtime. This
  is exactly the class of bug that broke Kotlin's array-type derivation (a concrete field
  inheriting an array flag from an abstract parent generated a scalar) and, per the audit,
  is latent cross-port. Grep for the own-only accessors and verify each hit:
  - **TS:** `ownAttr(`, `ownChildren(`, `ownFields(`, a raw `isArray` field flag read →
    should be `attr(` / `children()` / `fields()` unless emitting a subclass's own members.
  - **Python:** `own_children(`, `own_fields(`, and the **inverted** bare `attr(` (Python
    `attr()` is OWN; the resolving form is `attrs().get(`) → flag `attr(` used to read an
    effective value.
  - **Java / Kotlin:** `getMetaAttr(name, false)` (the `,false` own overload), own-only
    child walks (e.g. an own-only `filterIsInstance<…>()` source lookup that emits nothing
    for an entity inheriting its source).
  - **C#:** a native `IsArray` flag read, `OwnChildren()`, own attr reads.

  **Sanctioned (do NOT flag):** (a) a generator emitting a generated **subclass** that
  iterates `ownFields()` so inherited members aren't re-emitted (the generated base
  declares them — the `class Sub extends Base` / TPH pattern); (b) the own-mode canonical
  serializer + overlay-merge + super-resolution walks (library-internal); (c) the single
  deliberately-own attribute `@dbColumnType` (a physical column-type override, never
  inherited). Any own read that carries a comment naming one of these cases is fine; an
  uncommented own read of an effective property is the defect.
- [ ] **H. Authoring-correctness / ADR-conformance (deep).** Invented/unregistered
  `@`-attrs or post-bootstrap registration (ADR-0023 — custom attrs belong in a registered
  provider or `attr.properties`); retired source-v2 forms (`source.dbTable` / `@name` /
  `@dbColumn` → use `source.rdb` + `@kind` + `@table` / `@column` + `@role`, ADR-0007/0018);
  taxonomy impurity (entity over read-only primary source; read model that should be
  `object.projection`; `value` carrying identity/source, ADR-0028); copy-pasted base-field
  blocks — or the same-named field re-declared across objects (drift signature 10) — instead of
  abstract + `extends`; `@`-prefixed YAML keys (ADR-0006); relative refs
  in committed canonical JSON (ADR-0032); DB-type-as-logical-subtype (ADR-0013); per-port
  migration engine where schema is Node-`meta`-owned (ADR-0015).

- [ ] **H2. Wrong native type — `field.<x>` + `@dbColumnType` that hides the real type
  (CORRECTNESS-ADJACENT finding, NOT advisory axis-I).** The headline instance is a **UUID
  column modeled `field.string` + `@dbColumnType: uuid`**: the DB column is uuid but the
  generated property is a **`String`**, so the code coerces `String↔UUID` at every boundary
  and the native type is wrong everywhere the field is used. `verify --db` **cannot** catch it
  (the column type matches), so it hides in plain sight. When it sits in a shared
  `BaseEntity`/`BaseAuditedEntity`, **every inheriting `id`/`tenantId`/FK is wrong** — count the
  blast radius (grep every `field.string` paired with `@dbColumnType: uuid`; it is often
  hundreds of fields). This is a **real finding**, not a modernization nudge: recommend
  `field.uuid` and flag it as a **staged migration** (re-typing `id`/FK ripples through
  repositories, finders, and call sites) — tier by blast radius, not buried as advisory. The
  ONLY non-finding is a field the code genuinely handles as a *string* over a uuid column
  (explicitly justified). Report the total pair count so the migration has a completion
  criterion (see the CI ratchet gate in `metaobjects-verify`).

- [ ] **I. Vocabulary hygiene / modernization (ADVISORY).** Flag already-retired or
  deprecated authoring patterns and recommend the canonical form (see § Vocabulary
  hygiene). Advisory severity — scored as modernization opportunities, **never a
  failing finding**.

**Phase 4 — Synthesize** into the tiered roadmap and populate both artifacts.

---

## Vocabulary hygiene / modernization (axis I — ADVISORY)

Per ADR-0037, vocabulary expansion follows ONE ordered test (derivable → derive;
physical-only → `@dbColumnType`; logical: different native type → subtype, same kind +
modifier → attribute). This axis surfaces authoring that predates or contradicts that
framework. **All findings here are advisory** — modernization opportunities scored as
such, surfaced in the roadmap, but **non-failing** (the code works; the form is dated).

**Already-retired / deprecated forms → recommend the canonical form:**

- `@dbColumnType: uuid_array` / `@dbColumnType: text_array` (a physical array column
  type) → **`isArray: true`** on the base subtype. Array-ness is logical and derivable;
  the array column type is retired.
- The `@kind: text` hack (forcing text via a kind override) → **bare `field.string`**
  (text is the default; no override needed).
- `@dbColumnType: uuid_array` was covered above. **`field.string` + `@dbColumnType: uuid`
  is NOT advisory — it is a real mismodeling finding (see axis H).** It generates a `String`
  where the code uses/wants a native `UUID`, forcing `String↔UUID` coercions at every
  boundary; `verify --db` passes (the column really is uuid), so the schema gate can't see it.
  The genuine string-over-uuid-column case (code truly handles the value as text) is the ONE
  legitimate use and must be explicitly justified — otherwise recommend **`field.uuid`**.
- `@dbColumnType: timestamp_with_tz` (ADR-0036 Wave 2) → **drop it.** `field.timestamp` is
  instant / timezone-aware **by default** now; the `timestamp_with_tz` column-type override
  is **retired**. Timezone-awareness lives in `field.timestamp` + the `@localTime` opt-out.
- A bare `field.timestamp` that is **semantically a wall-clock value** (a store-open time, a
  birthday-with-time, a recurring local schedule) → recommend **`@localTime: true`** (naive
  `timestamp without time zone`), or confirm it is genuinely meant to be an instant. Default
  `field.timestamp` is an instant; only flag when the field's meaning is clearly wall-clock.
- A `validator.regex` (or a plain `field.string`) validating an **email** shape → recommend
  **`@stringFormat: email`** on the `field.string` (ADR-0036 Wave 3). The native type stays
  `string`; the per-port codegen emits the idiomatic email check — don't hand-roll the regex.
- A `field.string` that **holds a URL / URI** → recommend **`field.uri`** (native `URI`/`Uri`,
  URL validation) — a distinct native type + behavior is a subtype, not a validated string.
- A `field.string` that **holds an IP address** → recommend **`field.inet`** (native IP type;
  Postgres `inet` column).

**Custom-provider vocabulary (adopters who register their own types/attrs):** check
new/custom vocab against the ADR-0037 procedure (advisory) — e.g. *a custom subtype
that differs from an existing one only by a property should be an attribute, not a
subtype*; an email/hostname string-validation is an **attribute** (`@stringFormat`,
native type unchanged), while a URL or IP is a **native type** (`field.uri` /
`field.inet`, a subtype). Recommend re-shaping against the ordered test.

**Hand-rolled reverse-query repository methods (ADR-0038) → recommend the generated reverse
FK finder.** Reverse navigation — *"find all the rows that reference this one"* — is now
codegen. Flag a hand-written reverse-query method (a `findByParentId` / `findBy<Parent>`
repository finder, or a manual `WHERE fk = ?` query helper — exactly what a JVM adopter
hand-writes in its `SceneRepository`) and recommend the **generated reverse FK finder**
instead: codegen now emits `find<Source>By<FkField>` plus a batched `…In(ids)` variant from
the FK metadata, idiomatic per port (Spring repository finder / EF query method / Python or
TS query function). It is **performant** (one indexed query, no N+1) and **framework-free**
(no lazy collections / proxies). When an entity has two FKs to the same target, the codegen
emits two distinct finders (named by the FK field) automatically — no annotation needed; the
reverse finder is a **codegen feature, not an attribute** (there is no reverse-nav `@`-attr
to author). Advisory severity — a modernization opportunity, not a failing finding.

**New-vocabulary OPPORTUNITY (the inverse hunt — advisory).** The checks above audit
custom vocabulary the adopter *already* registered; this one hunts where the app
**should** register vocabulary but hand-coded the pattern instead. Smells
(grep-then-verify; require a *recurring, closed* set — never flag a one-off):
- **N parallel hand-written integration modules** sharing a payload shape and a config
  pattern (a closed set of channels / providers / export targets, each a near-copy with
  a different transport) → candidate for ONE project-registered subtype whose variants
  sit behind a closed structural-variant discriminator (the `source.rdb` `@kind`
  pattern), plus a small owned generator emitting the per-variant wiring.
- **An ad-hoc string discriminator steering code switches** — a string column whose
  values select per-variant behavior/config scattered across the codebase. If the values
  are just a closed symbol set, that is `field.enum` (`@values`), NOT new vocabulary. It
  earns a subtype only when the discriminated concept **owns behavior or attributes of
  its own** (ADR-0037 step 2a).
- **A provider-shaped pattern re-implemented per instance** — repeated registration /
  config blocks restating a shape one declared node per instance could carry, with codegen
  emitting the repetition.
- **A downstream integration modeled entirely in code** (an outbound webhook / notifier /
  queue publisher / tool wiring beyond `template.toolcall`) where registered vocabulary +
  a small generator would own the payload wiring, the names-only fail-closed config check,
  and drift detection.

Run the **ADR-0037 ordered test** before proposing: derivable → derive; differs from an
existing subtype only by a property → an attribute; a plain validated value → an
attribute; one-off author-supplied properties → the `attr.properties` bag. Only a concept
with its own behavior/attributes earns a subtype, and transport/protocol is never the
subtype axis (keep the node protocol- and address-free; variants behind the discriminator).
**Converge before inventing** — check shipped vocabulary AND the planned/chartered names
(see CALIBRATION "planned, not shipped"); never claim a chartered name for a project-local
type. **Recommendation:** propose a project-registered provider (explicit loader wiring,
ADR-0023 — never a loosened `strict` free-ride), a `metadata_sketch` of the node, and the
owned generator that retires the duplication; a second independent consumer needing the
same concept is a consumer→core promotion candidate (ADR-0011 — file an upstream issue).
**Verdict: VOCAB CANDIDATE (advisory)** — a modeling opportunity, never a failing finding,
never a tier gate; bias to under-flagging (the >15% false-positive kill criterion applies
with full force). Full guidance: `docs/features/downstream-metadata-decisions.md`.

---

## Classification scheme (every surface; classify on codegen AND runtime)

| Class | Meaning | Action |
|---|---|---|
| **GENERATED** | Driven by metadata (regenerable). | Confirm it regenerates clean. |
| **OWNED-GENERATOR** | `codegen/generators/*` file the project owns. | Confirm clean regen; flag drift from reference template. |
| **CODEGEN CANDIDATE (high)** | Standard CRUD/list/form over a modeled or modelable entity. | Author the view + generate; parity-gate. |
| **CODEGEN CANDIDATE (partial)** | Generatable data layer, bespoke presentation. | Generate data layer; keep viz hand-written. |
| **DYNAMIC-RUNTIME CANDIDATE** | Behavior that could be metadata-driven at runtime. | Assess runtime-metadata feasibility. |
| **BESPOKE (keep)** | Genuine custom: irreducible SQL (recursive CTEs, window functions, set ops — NOT plain count/sum/avg rollups, which are `origin.aggregate` on a projection), graph, SSE, auth, search, viz. | Leave hand-written — still import generated types. |
| **VOCAB CANDIDATE (advisory)** | A recurring, closed hand-coded pattern (parallel integration modules / an ad-hoc string discriminator) that project-registered vocabulary — a custom subtype/attr via a provider — plus a small owned generator would own. | Propose the provider + `metadata_sketch`; apply the ADR-0037 ordered test; advisory only. |

**Gold-standard exception.** A hand-written component that *derives* from generated metadata
cannot drift — flag as good. A "bespoke" component hardcoding a shape metadata knows is a
hidden candidate. **Stub trap:** demo-data routes have nothing to replace — classify
"candidate (future) — not DB-backed".

---

## Drift signatures (highest-value; grep-then-verify)

Per finding: `file:line` → what → generated-equivalent exists? → recommendation.

1. **Hand validators shadowing a generated schema** — diff field-by-field; divergence is the bug.
2. **Field-by-field serialize / deserialize / DTO↔model / row mappers** — silently drops a field when metadata grows one.
3. **camelCase↔snake_case / body↔column maps** maintained beside a generated view that already renames.
4. **Drift-admitting comments** — grep: `"keep in sync with"` / `"mirrors the"` / `"matching the"`.
5. **Runtime schema patching** (`ALTER TABLE … ADD COLUMN IF NOT EXISTS`, `_ensure_schema()`) — N schema owners.
6. **N declarations of one shape** — same entity as Drizzle table + Zod schema + Pydantic model + hand dataclass; target is 1 + N generated.
7. **`own*()` accessor read of an effective property** (ADR-0039) — `ownAttr` / `ownFields` / `own_children` / bare Python `attr(` / `getMetaAttr(name, false)` / native `IsArray` used to read a value or iterate members outside the sanctioned subclass-emit / own-serializer / `@dbColumnType` cases → silently drops `extends`-inherited values. A **correctness defect** (axis G2), not advisory.
8. **Hand-written `CREATE VIEW` / read-only SQL standing in for a projection or entity read-view (view-necessity test).** Grep migrations, checked-in `.sql`, and repository/query code for `CREATE [OR REPLACE] [MATERIALIZED] VIEW`, and for hand-rolled read-only queries that mirror a read model — a pure-`SELECT` repository/service method with joins or `GROUP BY` feeding a DTO, or a raw-SQL escape (`db.execute(sql…)`, `FromSqlRaw`, a JPA @Query with hand-written SQL). For each, run the **necessity test** — can origins express this shape? A column is derivable when it is (a) a base-entity or relationship-joined column → `origin.passthrough` (`@from` / `@via`), (b) a count/sum/avg/min/max over related rows → `origin.aggregate` (`@agg` / `@of` / `@via`), or an `EXISTS` / `array_agg` → `origin.aggregate` `any` / `all` / `collect` — any of them optionally row-scoped with `@filter`, (d) a computed scalar / **non-aggregate expression column** → `origin.computed` (`@expr`, #195), (e) one related row's column picked by an ordering — an **argmax / `DISTINCT ON … ORDER BY` / correlated `ORDER BY … LIMIT 1`** → `origin.first` (`@of` / `@via` / `@orderBy`, #195), or (f) a column borrowed via `extends` — and the joins follow declared relationships / `identity.reference` FKs.
   - **Entity-shaped (`SELECT own.* + derived`) → an entity read-view, NOT a projection (#214).** The single most common legacy view is an entity's OWN columns plus a joined/derived extra (`SELECT o.*, c.name AS customer_name`). This is the `Order` **entity with a read route**, not an exposure contract — route it to an **entity read-view**: keep the writable `@role: primary` `@kind: table` source and add a **non-primary `@role: replica` `@kind: view`** source, declaring only the *extra* as a derived `origin.*` field on the entity (the own field set already covers `o.*`). Reads route to the replica view, writes to the table. Reach for a **projection** instead only when the view renames base columns or **row-filters** (`WHERE status='active'`, soft-delete) — the latter is a projection with an object-level `@filter` (#207) that lowers to the outer `WHERE`.
   - **Exposure contract, expressible → CODEGEN CANDIDATE (high):** a subset / renamed / versioned / multi-base read model → convert to an `object.projection` with a read-only `source.rdb` `@kind: view` child, let `meta migrate` emit the `CREATE VIEW`, and consume the generated read-only query — the hand-written view is a second source of truth for a derivable shape. Parity-gate: the generated view returns row-identical results before the hand-written SQL is deleted.
   - **Not expressible → carry it in `@sql` or `@unmanaged`, never a hand-edited migration (#208, ADR-0043).** When a NAMED irreducible construct blocks origin authoring — recursive CTE, window function / `OVER`, `UNION` / `INTERSECT` / `EXCEPT`, lateral join — the body still belongs in the metadata: carry the hand-written SQL in the `source.rdb` **`@sql`** escape — a read-only-`@kind` body the tool REGISTERS, fingerprints, and drift-checks (adopt a pre-existing view with `meta migrate --allow adopt-view`); `@sql` forbids `origin.*` children (two sources of truth). A DB object whose DDL is owned **entirely elsewhere** (Flyway / a hand-migration) → mark its source **`@unmanaged: true`** (legal on any `@kind` incl. `table`); `meta migrate` never creates/drops/drift-checks it and `verify --db` reports it as external. `@sql` and `@unmanaged` are mutually exclusive. **Only a view left *undeclared*** — neither modeled, nor `@sql`, nor `@unmanaged` — is truly *unmanaged*, invisible to `meta verify --db`, so this audit is the only gate that sees it. "It's an aggregation" is NOT an irreducibility justification (plain count/sum/avg/min/max rollups are `origin.aggregate`); nor is a `DISTINCT ON` pick-one-row (`origin.first`) or a non-aggregate expression column (`origin.computed`).
9. **A closed variant-set hand-modeled per instance** — N sibling modules / classes / config blocks, one per channel / provider / target, sharing a payload + config shape and diverging only by transport. Grep for sibling-file families and switch-on-a-string dispatch; verify the set is closed and recurring (never a one-off). → axis I "New-vocabulary OPPORTUNITY" (VOCAB CANDIDATE, advisory).
10. **N declarations of one FIELD across objects (same-name-field census)** — the field-level sibling of signature 6. Census field names across `object.*` nodes (`grep -rn 'name: <field>'` the metadata dir); a name recurring in ≥2 objects where a canonical owner exists — one whose name the field embeds (`<owner><Field>`: `wizardId` → `Wizard.id`, `orderTotal` → `Order.total`) or whose type+constraints it matches — is provenance loss → `extends: Owner.field` (dotted child targets, ADR-0029). **VERIFY by diffing the copies' attrs: a `@maxLength` / `@required` / validator divergence across them is drift already shipping — cite it.** Evidence multiplier: `extends` already used elsewhere in the repo raises confidence. Do NOT flag: generic names on unrelated concepts (`id` / `name` / `status` with no owner-embedding name and no matching constraints); required per-node attrs a loader forces (e.g. `payloadRef` / `format` on sibling `template.prompt` nodes — a product constraint, not a copy).
11. **A physical table / column / schema name spelled as a literal outside its metadata declaration** — in a hand-written repository, raw SQL, a migration script, a log line, or a hand-maintained body-to-column map. Every port emits a per-object names artifact (`<Entity>Names` / `<entity_snake>_names.py`) from the declaration, so a literal is a second spelling of the same fact; and because the physical column is free-form, deriving it from the field name is a guess that fails silently. **No verify subverb sees this** — `--codegen` diffs generated files, `--db` compares schema to metadata — so this audit is the only gate. Remedy: reference the constant — but **check the artifact is emitted at all before scoring the literals, because on THREE of five ports an existing project emits none**. C# and Python have a real default suite and get it by upgrading; TypeScript's `generators: [...]` and the JVM's `<generators>` are each the COMPLETE list, so `meta init` scaffolding `namesFile()` covers only a project initialized at 1.0 and upgrading the package never edits a config written earlier. Where no artifact exists, the un-wired generator is the FIRST finding and the first remedy (`namesFile()` on TS after `meta eject names`; `SpringNamesGenerator` / `KotlinNamesGenerator` in the pom) — score the literals under it rather than as N independent findings, since one config line fixes the cause and generated code stops embedding the names too. **Do NOT flag:** a typed ORM handle in its place (a Drizzle column object, an Exposed `Column`, an EF property — replacing one with a string is a regression); a physical name inside a `source.rdb` hand-written SQL body (a metadata document cannot import a constant, which is why that body is fingerprinted); a flattened value-object composite column (it belongs to no single field of either object); a write-through entity's replica view name (the artifact holds the PRIMARY source's); a relationship-synthesized foreign-key column (derived, never declared). A hand-written repository that imports `<Entity>Names` is the gold standard — call it out as good.

---

## Owned-codegen & scaffold-and-own assessment

- If config imports `entityFile` / `queriesFile` / `routesFile` / `barrel` from
  `@metaobjectsdev/codegen-ts/generators` instead of owned `codegen/generators/*`,
  recommend the scaffold-and-own migration (`meta init`, or `meta eject <name>`) — on 1.0+
  those four no longer resolve. Importing the non-ownable generators from that subpath is
  correct and is not a finding.
- Audit owned generators: (a) regenerate clean? (b) drifted from reference templates —
  intentional (good) vs stale/accidental (missed upstream fix)? (c) hand-rolling a walk
  that a declarative `scope` + `outputPattern` could replace? (d) bespoke shape better as
  a `templateGenerator` than a forked generator?
- **Authoring ladder:** built-in fits → use it · close → **own + customize** (the default)
  · new shape → **author a declarative template-spec / custom generator from the metadata**
  · genuinely un-modelable → hand-write (still import the generated types).
- **Generator-gap check:** missing generators that block the biggest wins? Recommend per gap:
  own + customize / author a template-spec / fix upstream / stopgap.
- **Verify the DB artifact, not just the types** — computed view columns may appear in the
  contract but be dropped from the view DDL; the contract may lie.
- **An *undeclared* hand-authored DB view is invisible to `meta verify --db`.** A view that is
  neither modeled nor carried in the `source.rdb` `@sql` / `@unmanaged` escapes is *unmanaged*
  (informational only — never actionable drift, never auto-dropped), so a hand-written view
  standing in for an expressible `object.projection` / entity read-view can never be outsourced
  to the drift gate; hunt it here (drift signature 8, below). Once carried in `@sql` (#208) it IS
  registered, fingerprinted, and drift-checked — no longer audit-only.
- **Version skew:** check *actually-resolved* package versions, not declared; consuming a fix
  requires a coordinated lockstep bump, not a source-file copy.

---

## Prompt anti-patterns (hunt per site; classify: fully-modeled / partial / fully-inline)

- Inline prompt strings (triple-quoted / template-literal constants in service code).
- Untyped payloads (`str.format(**dict)` / f-strings / ad-hoc dicts) — payload should be a declared
  shape: an `object.value` (caller-supplied fields; `origin.passthrough` only — FR-015 parameter
  lineage) or, when fields derive by `aggregate` / `computed` / `first`, a
  **sourceless `object.projection`** carrying those origins (#210 — assembly origins on an
  `object.value` fail load with `ERR_SUBTYPE_RULE_VIOLATION`; `@payloadRef` accepts the sourceless
  projection).
- Silent-degradation hack (`try/except KeyError` or `?? ''` around formatting) — flag every instance.
- Hand-rolled output parsing (regex / XML / ad-hoc JSON) vs a declared **responding
  `template.prompt`** (one carrying `@responseRef`) + generated `parse*` / `safeParse*` /
  `extract*` parser — **generated in all five ports** (Java's generated `<Name>Parser` owns
  the Jackson `readValue`); flag a hand-rolled parser in a **non-generated** file where a
  responding `template.prompt` exists. ADR-0052: a `template.output` is outbound only and
  generates no parser, so it is not the node to look for here.
- Engine-side formatting breaking byte-identical render (prompt-cache exact-prefix hits
  depend on byte-stability).
- `template.toolcall` candidates: LLM tool schemas hand-defined per call vs modeled
  `toolcall @toolName/@payloadRef`.
- `@responseRef` + AI-trace: hand-parsed responses with no typed response shape; note that
  `voRequest` / `voResponse` jsonb columns must be authored `field.object` — the loader
  must not mutate the tree; vendor SDK client + pricing are BYO (ADR-0024).
- No `meta verify --templates` gate; no declared `@maxChars` / `@maxTokens` budget.
- **Template-text duplication.** Hash every external template file (`md5sum` the template dir) and diff within groups sharing a `payloadRef`. A byte-identical cluster, or N≥3 templates sharing an identical skeleton with only slot lines differing, is ONE prompt maintained N times — a wording fix must be applied N times and WILL be missed. Recommend a shared `{{> group/partial }}` include (the render engine inlines partials recursively) or one template + payload-carried variant fields. Do NOT flag: the per-node `payloadRef` / `@format` repetition across `template.prompt` nodes (loader-forced, not a copy); templates meant to diverge independently — require N≥3 and structural identity before flagging.

---

## Semantic-constraint ratification (prevents over-modeling)

When folding hand validators into metadata, apply human judgment per constraint.
A constraint enters **shared metadata** only if it is a **true cross-language domain
invariant**; a one-consumer preference stays in a thin local refinement layer.

Cross-field rules **are** modelable (`comparison` / `atLeastOne` / `requiredWhen` /
`presentIff`); ratification decides *which* belong in shared metadata. Output a
**ratification table**: KEEP-IN-METADATA / LOCAL-REFINEMENT / DROP + rationale —
human-approved, never applied silently. Distinguish `required` from has-a-safe-default
(`@default` often fixes the over-requiring bug). A core attr ripples cross-port; for a
one-consumer need, read it codegen-locally.

---

## Scoring & maturity model — three surfaces (no single global score; bands not decimals)

1. **Headline MATURITY TIER** — Greenfield → Partial → Deep → Exemplary; worst-of with
   prerequisite gating (a missing pillar can't be averaged away); rendered with **the single
   next unmet check** ("you're Partial; the next rung needs `verify` in CI").
2. **Per-pillar breakdown (never rolled into one number)** — `pillar | tier | top gap` over
   codegen / runtime / drift-gate / prompts. This is the core deliverable.
3. **Binary CI drift gate** — prominent and separate: **"Is `meta verify` drift detection
   wired into CI?"** It is binary because the risk is binary.

Coarse bands only (none / some / most / all). Worst-of within a pillar. On re-run, grade
the delta. Lead with gaps, not the grade.

**Vocabulary hygiene (axis I) is advisory** — it surfaces as modernization
opportunities in the roadmap, scored as such, and **never gates a tier or fails the
audit.** Dated-but-working vocabulary is a quality nudge, not a defect.

---

## Report

**Two artifacts:** `.metaobjects/adoption-audit.json` + rendered Markdown.

**Markdown sections (lead with Scorecard):** 0. Scorecard (tier + pillar table + CI gate) ·
1. Triage + census · 2. Coverage matrix · 3. Per-surface classification tables · 4. Drift
findings (active bugs first) · 5. Owned-codegen + generator gaps · 6. Drift-gate adoption ·
7. Runtime-contract + authoring-correctness (axes G+H) · 8. Semantic-constraint ratification ·
9. Prompt-pillar assessment · 10. Prioritized roadmap: Tier 1 drift kill → Tier 2 existing
generators → Tier 3 new generators/projections → Tier 4 dynamic-runtime/prompts/cross-port.
Each roadmap item: LOC retired, prerequisite, **parity-gate before deleting hand-written code**.

**Each finding in `.metaobjects/adoption-audit.json`:**

| Field | Content |
|---|---|
| `id` | stable kebab id (e.g. `handwritten-crud-route`, `manual-zod-validator`) |
| `title` | "you hand-wrote X that metadata can generate / model" |
| `pillar` | `codegen` / `runtime` / `drift` / `prompt` |
| `surface` | `entity` / `route` / `validator` / `repository` / `dto` / `hooks` / `prompt` / `migration` |
| `capability` | the capability-checklist capability this maps to (e.g. `field.currency`, `relationship.@through`) |
| `locations[]` | exact `file:line` spans |
| `impact` | LOC eliminated + N call-sites + drift-risk (high/med/low) |
| `effort` | `trivial` / `small` / `medium` / `large` |
| `confidence` | bias to under-flagging (false-positive rate >15% is a kill criterion) |
| `metadata_sketch` | metadata you'd author to replace it — **read-only proposal only; never applied** |
| `next_command` | the exact command / skill that performs the cutover (see bridge below) |
| `parity_gate` | the specific check proving behavior-equivalence |
| `tier` | 1–4 |

Within each tier, sort by impact ÷ effort (quick wins first). Tier 1 leads.

### Audit → action bridge

The audit never edits code. Pattern: **dry-run → review the diff → apply**.

- Propose metadata → `metaobjects-authoring` + brainstorming flow (human reviews).
- Generate → `meta gen`; **`meta gen --dry-run`** is the review-the-diff step → skill:
  `metaobjects-codegen`.
- Prove parity → **`meta verify --codegen`** is the drift gate → skill: `metaobjects-verify`.
- Routes / runtime / web → skill: `metaobjects-runtime-ui`.
- Prompts → skill: `metaobjects-prompts`.
- Cut over **one surface at a time, one commit each**.
- A separate guided-cutover skill (not this one) reads `adoption-audit.json` and walks
  findings one tier/surface at a time with human approval at each step.

---

## Guardrails

- **Adoption direction — metadata follows the code.** This is a brownfield project: existing
  code and the live schema are the spec. Every `metadata_sketch` must **reproduce the code's
  existing native types, names, and nullability** (model `field.uuid` where the code uses
  `UUID`, carry over `@column`/`@table`/`@required`) and every cutover must **minimize churn to
  code the generator is not replacing** — customize the codegen to match the existing shape
  before proposing edits to working call sites. A sketch that would re-type or rename working
  code the generator isn't replacing is modeling the wrong thing; when a choice is ambiguous,
  flag it for the human rather than proposing the churnier option. (Full doctrine:
  `metaobjects-authoring` → "Adopting onto an existing codebase".)
- **Parity-gate every cutover** — prove behavior-equivalent before deleting hand-written code; generated schemas are often looser.
- **Verify, don't assume** — read the code behind a grep hit.
- **Verify the DB artifact, not just the types** — the contract may claim a column the view DDL dropped.
- **Don't let one bespoke action block generating the entity** — generate CRUD; mount the custom action alongside.
- **Consumption ≠ a dist copy across versions** — bump + rebuild lockstep and install.

---

## Calibration — port gaps & non-defects (do NOT flag these as adopter fault)

- **Filter-operator route codegen — the CORE grammar ships in all five ports.** The
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
- **TS/web-only** — `view.*` widget subtypes exist only for TS/web consumers; only `view.base` / `view.currency` are cross-port-gated.
- **Planned, not shipped** — `api.*` / `operation.*` / `binding.*` (FR-024) and MCP exposure of declared prompts/tools are not yet in the registry; their absence is not an adopter defect.
- **Cross-port version-NUMBER skew is by design** — TS/C#/Python `0.x` vs Java/Kotlin `7.x` Maven is correct; never flag the *number lines* differing. But that is exactly why you can't eyeball cross-language drift: compare **`metamodelVersion`** (Phase 0 cross-language consistency item), not the package numbers. A `metamodelVersion` MISMATCH across ports *is* a finding; so is a port lagging its ecosystem's latest release. Also flag *intra-port* drift (mixed versions within one port, or a runtime package in `devDependencies`).
- **Stale upstream prose** — "hand-write the Spring controller" (Java/Kotlin) is out of date; trust `meta gen --list`, not stale prose.

---

For this project's port specifics and the exhaustive capability checklist, read every `references/*.md` in this skill's directory.
