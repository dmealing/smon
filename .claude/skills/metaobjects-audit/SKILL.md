---
name: metaobjects-audit
description: Use when assessing how well a project has adopted MetaObjects — greenfield first-pass or deep double-check; produces a scored, prioritized adoption-audit report covering codegen, runtime, drift-gates, and prompts.
---

# MetaObjects adoption audit

**Thesis.** Typed metadata is the durable spine; generated code is the disposable
artifact. Hand-writing a layer the metadata could own creates a second source of
truth for one fact — it will drift. This audit hunts those second sources of truth
and proposes folding them into the spine — where the generator code plus its generated output
and added metadata is fewer lines than the hand-written code it replaces, more of that shape
are coming, or silent drift is the risk. A one-off layer
that fails that cost test is acceptable, not a defect.

**Boundary — read-only.** Deliverables: `.metaobjects/adoption-audit.json` (machine-readable
findings) + a rendered Markdown report. The audit **never edits code, never authors
metadata** — `metadata_sketch` per finding is a read-only proposal for human review.
Actual cutovers run through the existing skills mapped per finding tier (§ Bridge).

## Reference files — open the one your task needs

| File | Open it when |
|---|---|
| `references/calibration.md` | Before raising any finding: it lists the port gaps and non-defects that are never the adopter's fault. |
| `references/surface-review-axes.md` | Working any axis (A–I) of Phase 1b. |
| `references/capability-checklist.md` | On every axis: the exhaustive list of what the metamodel can express, one hunt per capability. |
| `references/drift-signatures.md` | Hunting hand-written second sources of truth (validators, mappers, comments, views, JSON bags). |
| `references/prompt-anti-patterns.md` | Axis D: the project builds text sent to an LLM or parses a reply. |
| `references/vocabulary-hygiene.md` | Axis I: retired or deprecated authoring forms, custom vocabulary, vocabulary opportunities. |
| `references/requirements.md` | Axis E2: the project declares `requirement.*` nodes. |
| `references/typescript.md`, `java.md`, `kotlin.md`, `csharp.md`, `python.md` | The server port the project uses (only the ports in the project's stack are installed). |

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
- **Calibrate before flagging** — `references/calibration.md` lists what is never the adopter's fault.
- **Verify the DB artifact, not just the types** — the contract may claim a column the view DDL dropped.
- **Don't let one bespoke action block generating the entity** — generate CRUD; mount the custom action alongside.
- **Consumption ≠ a dist copy across versions** — bump + rebuild lockstep and install.

## Phase 0 — Triage (fast, mechanical)

- [ ] MetaObjects present? (`metaobjects/` dir, metadata sources, `@metaobjectsdev/*` /
  `com.metaobjects:*` / `metaobjects` / `MetaObjects.*` deps).
- [ ] Count metadata source lines + all `@generated` / `DO NOT EDIT` files repo-wide.
- [ ] **Owned-generators check:** which generators does the project own at
  `codegen/generators/*` (via `meta eject`, or `meta init` on a CLI before 1.0.4), and
  which does it import from `@metaobjectsdev/codegen-ts/generators`? Both are supported
  from 1.1. Two findings to look for. **An unmodified owned copy** is duplication that
  falls behind the reference: `meta eject --list --format text` marks each copy, and one
  marked `identical to the reference` should be replaced by the package import. That is
  the only mark that proves a copy unmodified. `same content as the reference, your
  formatting` and `DIFFERS` with `0 line(s) of your own` rule out added or edited lines,
  not removed or reordered ones: confirm those from the file's history
  (`git log -p -- codegen/generators/<name>.ts` shows no edit after the eject) first, and
  report a copy you cannot confirm as "possibly customized: check its history", not as a
  copy to drop. For `entity`,
  `routes` and `routes-hono` that holds only when every `codegen/runtime/` file the copy
  reaches is also marked identical: an edited adapter is a customization, and such a copy
  is not a finding. Those runtime rows appear only with `--format text` (or as the
  `runtimeCopy` array inside the row's `source` object in `meta gen --list --format
  json`); a listing with no runtime rows is not evidence that the adapter is unmodified. **An import of `entityFile` /
  `queriesFile` / `routesFile` / `barrel` on a 1.0.x install** fails to load, because 1.0
  removed those four and 1.1 restored them: there it is an upgrade blocker, fixed by
  upgrading to 1.1 or by ejecting. Importing anything from that subpath is otherwise
  correct and is never a finding by itself.
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
healthy = multi-× (example: ~4.7k spine → ~15.7k generated ≈ 3.3×). **Never report a
generated-share or leverage figure alone, and never as a target:** pair it with the **net
hand-written line change**, a figure to report and not the cost test (hand-written lines
removed minus generator and metadata lines added). A share can rise while total hand-written
code grows.

**Coverage matrix:** per entity/projection/value — query helpers? view? routes? UI?
The gap between "modeled + query helpers" and "has view + route + UI" is the headline
lopsidedness.

**Surface review — 8 axes (independently runnable).**
Work the full `references/capability-checklist.md` on every axis. Check calibration
guards (`references/calibration.md`) before raising a finding. **Verify, don't assume** — read the
code behind a grep hit; a "duplicate" validator's *divergence* is the finding.

Axes (the full hunt for each is in `references/surface-review-axes.md` — open it before working an axis):

- **A.** Codegen candidates — API / server routes · **B.** Codegen candidates — web / client
- **C.** Drift hotspot — validators, mappers, runtime models · **D.** Prompt pillar
- **E.** Owned generators and scaffold-and-own · **E2.** Capability ledger (`requirement.*`, opt-in)
- **F.** Drift-gate adoption · **F2.** Over-generation (codegen waste)
- **G.** Runtime-contract anti-patterns · **G2.** `own*()` accessor discipline (a correctness defect, not advisory)
- **H.** Authoring correctness / ADR conformance · **H2.** Wrong native type (`field.string` + `@dbColumnType: uuid`)
- **I.** Vocabulary hygiene / modernization (advisory, never a failing finding)

**Phase 4 — Synthesize** into the tiered roadmap and populate both artifacts.

---

## Classification scheme (every surface; classify on codegen AND runtime)

| Class | Meaning | Action |
|---|---|---|
| **GENERATED** | Driven by metadata (regenerable). | Confirm it regenerates clean. |
| **OWNED-GENERATOR** | `codegen/generators/*` file the project owns. | Confirm clean regen; flag drift from reference template. |
| **CODEGEN CANDIDATE (high)** | Standard CRUD/list/form over a modeled or modelable entity. | Author the view + generate; parity-gate. |
| **CODEGEN CANDIDATE (partial)** | Generatable data layer, bespoke presentation. | Generate data layer; keep viz hand-written. |
| **DYNAMIC-RUNTIME CANDIDATE** | Behavior that could be metadata-driven at runtime. | Assess runtime-metadata feasibility. |
| **ACCEPTABLE (one-off)** | A hand-written layer the metadata could own, but an owned generator for it would cost more lines than it replaces, no more instances are expected, and nothing drifts silently (it reads typed generated properties). | Report as acceptable. Not a defect, not a recommendation to generate. Re-class if it recurs or drift appears. |
| **BESPOKE (keep)** | Genuine custom: irreducible SQL (recursive CTEs, window functions, set ops — NOT plain count/sum/avg rollups, which are `origin.aggregate` on a projection), graph, SSE, auth, search, viz. | Leave hand-written — still import generated types. |
| **VOCAB CANDIDATE (advisory)** | A recurring, closed hand-coded pattern (parallel integration modules / an ad-hoc string discriminator) that project-registered vocabulary — a custom subtype/attr via a provider — plus a small owned generator would own. | Propose the provider + `metadata_sketch`; apply the ADR-0037 ordered test; advisory only. |

**Gold-standard exception.** A hand-written component that *derives* from generated metadata
cannot drift — flag as good. A "bespoke" component hardcoding a shape metadata knows is a
hidden candidate. **Stub trap:** demo-data routes have nothing to replace — classify
"candidate (future) — not DB-backed".

---

## Owned-codegen & scaffold-and-own assessment

- A config may import `entityFile` / `queriesFile` / `routesFile` / `barrel` from
  `@metaobjectsdev/codegen-ts/generators` or from owned `codegen/generators/*`. Both are
  supported from 1.1, and the import is the right choice for a generator the project does
  not change. The import is a blocker only on a 1.0.x install, where those four do not
  resolve: recommend upgrading to 1.1, or `meta eject <name>` if the project has to stay
  on 1.0.x. On 1.1 the finding is the reverse case, an owned copy proven unmodified by
  the Phase 0 owned-generators check: recommend the package import. Importing any other
  generator from that subpath is correct and is not a finding.
- Audit owned generators: (a) regenerate clean? (b) drifted from reference templates —
  intentional (good) vs stale/accidental (missed upstream fix)? (c) hand-rolling a walk
  that a declarative `scope` + `outputPattern` could replace? (d) bespoke shape better as
  a `templateGenerator` than a forked generator?
- **Authoring ladder:** built-in fits → import it as shipped · close → **eject it and
  customize the copy**
  · new shape → **author a declarative template-spec / custom generator from the metadata**
  · genuinely un-modelable → hand-write (still import the generated types).
- **Generator-gap check:** missing generators that block the biggest wins? Recommend per gap:
  own + customize / author a template-spec / fix upstream / stopgap. **Cost-test every
  recommendation to generate** (`metaobjects-codegen` → `references/owning-generators.md`): an
  owned generator is worth it only if generator + output is smaller than the code it replaces,
  more instances are expected, or drift protection is the point. A layer that fails is
  ACCEPTABLE, and an owned generator larger than the code it replaced is itself a finding.
  A general-shape generator belongs in the library, not in each app.
- **Verify the DB artifact, not just the types** — computed view columns may appear in the
  contract but be dropped from the view DDL; the contract may lie.
- **An *undeclared* hand-authored DB view is invisible to `meta verify --db`.** A view that is
  neither modeled nor carried in the `source.rdb` `@sql` / `@unmanaged` escapes is *unmanaged*
  (informational only — never actionable drift, never auto-dropped), so a hand-written view
  standing in for an expressible `object.projection` / entity read-view can never be outsourced
  to the drift gate; hunt it here (drift signature 8 in `references/drift-signatures.md`). Once carried in `@sql` (#208) it IS
  registered, fingerprinted, and drift-checked — no longer audit-only.
- **Version skew:** check *actually-resolved* package versions, not declared; consuming a fix
  requires a coordinated lockstep bump, not a source-file copy.

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
