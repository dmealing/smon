# Surface review — the axes

The full hunt for each axis of Phase 1b (Partial / Deep path). Each axis runs independently. Work the capability checklist (`capability-checklist.md`) alongside it, and read `calibration.md` before raising a finding.

## Contents
- A. Codegen candidates — API / server routes
- B. Codegen candidates — web / client
- C. Drift hotspot — validators, mappers, runtime models
- D. Prompt pillar
- E. Owned generators and scaffold-and-own
- E2. Capability ledger — `requirement.*`
- F. Drift-gate adoption
- F2. Over-generation — unnecessary generated files
- G. Runtime-contract anti-patterns
- G2. `own*()` accessor discipline
- H. Authoring correctness / ADR conformance
- H2. Wrong native type
- I. Vocabulary hygiene / modernization (advisory)

- [ ] **A. Codegen candidates — API / server routes.** Catalog + classify every handler.
- [ ] **B. Codegen candidates — web / client.** Pages, data layer (hooks, central fetch),
  grids/forms/filters vs `layout.dataGrid` / form generators / filter-allowlist.
- [ ] **C. Drift hotspot — validators, mappers, runtime models.** Hand validators / DTO-mappers /
  dataclasses shadowing a generated shape. Diff field-by-field; the divergence is the bug.
- [ ] **D. Prompt pillar.** Every LLM prompt-construction site (see `prompt-anti-patterns.md`).
- [ ] **E. Owned generators & scaffold-and-own** (see "Owned-codegen & scaffold-and-own assessment" in `SKILL.md`).
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
  the active check in G2).**

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
  abstract + `extends`; `@`-prefixed YAML keys (ADR-0006); DB-type-as-logical-subtype (ADR-0013); per-port
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
  deprecated authoring patterns and recommend the canonical form (see `vocabulary-hygiene.md`).
  Advisory severity — scored as modernization opportunities, **never a failing finding**.
