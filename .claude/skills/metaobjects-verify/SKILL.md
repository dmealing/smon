---
name: metaobjects-verify
description: Use when verifying MetaObjects — drift checks (verify --db/--codegen/--templates), schema migrations, and interpreting conformance/test failures.
---

# MetaObjects verify + migrations

The third pillar: **drift detection.** MetaObjects treats metadata as the source of
truth and generated code + DB schema + prompts as derived. `verify` is the
cross-cutting discipline that catches divergence; schema migration is the build-time
pipeline that brings the database into line with metadata. This skill is the
procedure for running both and reading the failures.

## The drift sources

Drift is any place where a derived artifact has fallen out of sync with the
metadata that should define it. The ones a developer must actively guard:

- **DB-vs-metadata** — the live database schema has diverged from the metadata
  (a column the metadata no longer declares, a missing index, a type mismatch). A
  **modeled projection's** view body is compared too — a changed `CREATE VIEW` emits
  a `replace-view`. For a genuinely irreducible view body (recursive CTE, window
  function, set operation) that `origin.*` can't express, use the `source.rdb`
  `@sql` escape: a hand-written body the tool still registers, fingerprints, and
  drift-checks — emitted verbatim instead of synthesized (adopt a pre-existing
  hand-written view once with `meta migrate --allow adopt-view`). For a DB object
  — view **or table** — owned entirely elsewhere (Flyway, a hand-migration,
  another app's schema), mark it `@unmanaged: true`; `meta migrate` never
  touches it and `verify --db` reports it as *external (declared)* rather than
  silently. `@sql` and `@unmanaged` are mutually exclusive on one source. But a
  hand-authored view carrying **neither** marker is *unmanaged by omission*
  (reported as informational, never failed, never dropped) — so an **undeclared**
  hand-written view standing in for an expressible `object.projection` is the one
  drift class `verify --db` can't catch; the `metaobjects-audit` skill is the only
  gate that sees it. See `references/migration.md` → "DDL-ownership escape
  valves (`@sql` / `@unmanaged`) — #208" for the full contract.
- **Generated-vs-metadata (codegen)** — committed generated code no longer matches
  what the current metadata would emit (someone edited a `@generated` file, or
  forgot to regenerate after changing metadata).
- **Prompt-vs-payload (templates)** — a template references a `{{field}}` that
  isn't on its `@payloadRef` payload VO (a renamed source field silently degrading
  a prompt).

Two more are caught structurally rather than by a command: **generated-edited**
(the `@generated` header + three-way merge surface hand-edits at code review) and
**migration-vs-metadata** (migrations are emitted *from* metadata diffs, so they
can't drift by construction).

## Before any of this: the metadata has to LOAD — `meta upgrade` for retired vocabulary

`verify` cannot report drift in a model it could not read. The registry is sealed
(ADR-0023), so a retired name has **no deprecation shim** — it is a load error, and
the run stops before the first drift check. Retirements that bite an existing estate:
`@readOnly` → `@mutability` and `origin.collection` → `origin.aggregate @agg: collect`
(0.24.0); `@violation` → `@counterexample`, plus `@verifiedBy`, `@supersededBy` and
`@status: abandoned | superseded` on `requirement.*` (0.24.0, FR-038); and an index key
declaring **both** `@fields` and `@expr`, refused since 0.24.1.

```
meta upgrade            # previews every rewrite; writes nothing
meta upgrade --apply    # makes them
```

Node-only, because it edits the metadata documents every port shares — a Java, Python
or C# project runs `npx meta upgrade` against its own sources. Canonical JSON and YAML
alike. It rewrites from the same table the loader's errors are generated from, fixes
only what has one correct answer, and **refuses the rest with a non-zero exit** so a
pipeline cannot record a partial migration as done. See
`references/requirements.md` for what it refuses on a ledger and why.

## Run `meta verify` before you call a build done

Make a bare `meta verify` the last step before you consider any MetaObjects work
finished — not only in CI. Besides the drift checks below, a bare `verify` (and
every `meta gen`) runs an **advisory anti-pattern pass**: it scans your authored
source and flags where you hand-rolled something the metadata could model, naming
the construct that replaces it — a hand-written aggregate (`AVG`/`reduce`-sum →
`origin.aggregate` on an `object.projection`), money as a float (`* 100`/`toFixed`
→ `field.currency`), a `CHECK (... IN ...)` value set (→ `field.enum`). It is
advisory (never fails the build), but each line is the fix: when you see one, model
it and call the generated query/field instead of keeping the hand-rolled version.
This is the most common way a build ends up *declaring* a projection yet still
hand-aggregating in a route — verify catches exactly that.

**Read the whole report, not the first twenty lines.** Text output caps each
advisory section at 20 lines and then says how many it held back; raise it with
`--limit <n>` or remove it with `--limit all`. You are on a pipe, so your default
format is already TOON: `meta verify` puts one machine-readable document on stdout
carrying every gate's verdict, every anti-pattern finding and every requirement
diagnostic — **uncapped** — with narration on stderr. `--format json` if you want
JSON. A pass that did not run reports `status: "skipped"` and why, so an empty list
always means "found nothing", never "never looked"; what the payload does not carry
is named in its own `notRepresented[]`.

**A bare `verify` is a partial check, not the full gate.** The Node/C# default runs
only `--templates`; Java/Python's bare default runs only `--codegen` — either way,
paired with the advisory anti-pattern pass above, never all three subverbs. Treat a
bare run as a smoke test: the real done-check is running the subverbs your project
uses explicitly — `verify --codegen`, and, where a DB exists, `verify --db <url>`.

## Requirements are checked on every run

If this project declares `requirement.functional` / `requirement.architectural` nodes, read
`references/requirements.md`: requirements are metadata, so they are checked on **every**
`meta verify` — there is no subverb — and the severity of a broken link depends on the
requirement's `@status`, which is the part that surprises people reading a failure.

## The `verify` subverbs

`verify` has three drift checks. Run them in CI.

- **`--db`** — schema drift. Introspects the live database and fails if it has
  diverged from metadata. This is a **schema concern, so it is the Node toolchain's
  job regardless of your server language** (see migrations below). The JVM ports
  have no schema surface of their own — ADR-0015 Decision 2 removed the old
  dev/test auto-create validator (OMDB is pure data-access) — so a JVM, Python, or
  C# project's dev/test databases are provisioned the same way production is: by
  applying the Node-emitted SQL. The Node `verify --db` is the only DB-vs-metadata
  gate, for every port.

- **`--codegen`** — regeneration drift. Re-runs generation and diffs the result
  against the committed generated files; a non-empty diff means someone edited
  generated code or skipped a regen. Wire it into CI so a stale `@generated` file
  fails the build.

- **`--templates`** — prompt/payload drift. For every `template.prompt` /
  `template.output`, resolves the text, parses each `{{...}}` reference, and fails
  if any reference isn't on the payload VO. This is the build-time gate for the
  prompt-construction pillar.

**Only `--db` is Node-universal.** `--codegen` / `--templates` run through each
port's own build tool, not the Node `meta`:

| Port | Codegen drift | Template drift | Schema drift |
|---|---|---|---|
| TS | `meta verify --codegen` | `meta verify --templates` | `meta verify --db <url>` |
| Java / Kotlin | `mvn metaobjects:verify -Dmeta.verify.mode=codegen` | `mvn metaobjects:verify -Dmeta.verify.mode=templates` | Node `meta verify --db` only |
| C# | `dotnet meta verify --codegen` | `dotnet meta verify --templates` | Node `meta verify --db` only |
| Python | `metaobjects verify --codegen` | `metaobjects verify --templates` | Node `meta verify --db` only |

Every non-TS port's `verify` rejects `--db` outright (exit 2, "schema verify is the
migrate engine") — schema drift always runs through the Node `meta verify --db`,
per the shared-migration-engine doctrine below.

A clean run is silent; a failure names the entity/template, the drifted artifact,
and (for templates) the missing reference. **Bias toward trusting the tool** — a
verify failure almost always means the metadata changed and a derived artifact
didn't follow.

## What `verify` can't catch — semantic mismodeling (add a CI ratchet lint)

The three subverbs check that derived artifacts *match the metadata*. They do **not**
check that the metadata *models the right thing* — so a semantically wrong metadata
choice that is internally consistent passes clean. The canonical case: a UUID column
modeled **`field.string` + `@dbColumnType: uuid`**. The generated property is a `String`,
the DB column is genuinely `uuid`, so **`verify --db` passes** while every consumer coerces
`String↔UUID` and the native type is wrong throughout the code (see `metaobjects-authoring`
→ the UUID smell). No drift subverb can see it, because nothing has drifted — the model
itself is wrong.

For semantic invariants like this, add a **project-local CI ratchet lint** over the
metadata sources — a grep-level gate is enough:

```
# fail the build if any field.string carries @dbColumnType: uuid (a UUID-column-as-string smell).
# Illustrative — tune the matcher to your source format (canonical JSON vs sigil-free YAML) and
# tighten to per-node scope if a coarse co-occurrence match is too broad for your files.
! grep -rEzl '"field\.string"[^}]*"@dbColumnType"[^}]*"uuid"' metaobjects/
```

Make it a **ratchet**: it can't go green until the last offending field is migrated to
`field.uuid`, so it doubles as the migration's completion criterion **and** a permanent
backstop against reintroducing the smell. The same pattern generalizes to any semantic
metadata rule your project wants enforced that `verify` structurally can't express.

The other invariant worth a ratchet is **no physical name as a literal**. A table or
column string in hand-written code is a second spelling of a declared fact, and nothing
in `verify` compares your code to the schema — `--codegen` diffs generated files against
a fresh regen, `--db` diffs the database against the metadata. Neither reads the
repository you wrote. Build the alternation from the metadata's own `@table` / `@view` /
`@column` values and fail on any hit outside generated output:

```
# fail the build if a declared physical name is spelled in hand-written source.
# Illustrative — generate the alternation from your metadata, scope it to the
# directories you hand-write. A typed ORM handle never matches this; a literal does.
! grep -rEn '"(orders|created_at|purpose_code)"' src/ --exclude-dir=generated
```

Generated output is already covered upstream — every port's generators reference the
names artifact instead of embedding the literal — so this ratchet is only ever about your
code. The remedy for a hit is the `<Entity>Names` constant (`metaobjects-runtime-ui`).

## Schema migrations are the shared TypeScript engine — for every port

This is the load-bearing architectural fact (ADR-0015): **schema migrations are
owned by one shared TypeScript engine, regardless of your server language.** The
Node `meta migrate` and `meta verify --db` are the migration + live-DB-drift
toolchain for TS, Java, Kotlin, C#, and Python alike.

What this means in practice:

- The Node `meta` CLI emits the migration SQL (diffing metadata → DDL) and applies
  it. You point it at the same database your server connects to:

  ```
  meta migrate --from-db --db postgresql://... --dialect postgres --slug init --apply
                                                      # first migration on a brand-new database
  meta migrate --dialect postgres --slug add-user-shipping          # everyday: emit migration SQL
  meta migrate --dialect postgres --slug add-user-shipping --apply --db postgresql://...
                                                      # ...and apply it
  meta migrate --dialect postgres --slug add-user-shipping --dry-run   # preview without writing
  ```

  Always pass `--dialect` — it selects the diff pipeline, not just the SQL flavor.
  It is *required* on the offline path and on `baseline`; with `--db` the CLI can
  auto-detect it from the URL scheme, but being explicit keeps the two paths
  reading the same. Do **not** run `meta migrate baseline` on a database that does
  not exist yet; see `references/migration.md`.

- Dialects: `postgres` (default), `sqlite`, and `d1` (Cloudflare D1, TS-only).
- The JVM and Python ports have **no** migration command of their own — their
  former migrate goals/modules were removed, and (ADR-0015 Decision 2) the JVM
  runtime's own dev/test schema auto-create path
  (`MetaClassDBValidatorService` + the drivers' DDL) was removed too: OMDB is
  pure data-access. Every port's schema — dev, test, and production alike — is
  always the Node migrate engine's output.

So even in a Java or Python or C# project, schema migration and `verify --db` run
through the Node `meta` tool. The per-port `gen`/codegen tooling stays native to
the language; only schema crosses to Node.

## Never hand-edit the live database — apply schema only through the tool

The live schema is a derived artifact, exactly like generated code. **Do not mutate a running
database by hand** — no `psql`/console `ALTER TABLE` / `CREATE` / `DROP`, not to preview a column, not
to patch a mismatch, not to "just unblock" a boot. It is the single most common way a database ends up
in a state no migration can reproduce:

- The column now exists but no migration recorded it, so the next `meta migrate` tries to add it
  again and dies on `column ... already exists` — or worse, silently diverges and the drift only
  surfaces days later.
- "I'll just add it real quick so I can see it in the tool" is the exact rationalization to catch. It
  doesn't *feel* like a schema change, so it skips the metadata-first check — but it is one.

Apply every schema change the same way: change the metadata, then let `meta migrate` (or, for a
project still driving its own migrator, a migration authored *to match* the regenerated schema) apply
it. Want to see a new column in a tool or an app? Apply the migration and re-read — never reach for
`psql`.

**Make `meta verify --db` a done-check, not just a CI gate.** Run it after any work that touched the
database or the schema-shaping metadata, before you consider the task finished — it introspects the
live DB against the metadata and fails on exactly this drift (a hand-added column, a missing index, a
mismatched type), catching a manual poke immediately instead of at the next boot.

## Interpreting conformance / test failures

MetaObjects' behavior is pinned by cross-port **conformance corpora** (metamodel,
render, persistence, API-contract, verify). When a test or conformance fixture
fails:

- A **loader** failure cites an `ERR_*` code (e.g. `ERR_RESERVED_ATTR`,
  `ERR_UNRESOLVED_SUPER`, `ERR_MISSING_REQUIRED_ATTR`, `ERR_BAD_ATTR_VALUE`,
  `ERR_YAML_COERCION`) — fix the metadata, not the loader.
- A **render/verify** failure means the rendered bytes or the template-drift
  result diverged from the pinned expectation — usually a payload/text mismatch.
- A **persistence / API-contract** failure means a query result row or an HTTP
  response shape diverged from the cross-port expectation — treat a deviation as a
  bug in the code under test, not in the corpus.

The corpus is the contract: when output disagrees with a fixture, the output is
what's wrong.

---

For the migration tooling read `references/migration.md`.
