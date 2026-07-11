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
  (a column the metadata no longer declares, a missing index, a type mismatch).
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

## The `verify` subverbs

`verify` has three drift checks. Run them in CI.

- **`--db`** — schema drift. Introspects the live database and fails if it has
  diverged from metadata. This is a **schema concern, so it is the Node toolchain's
  job regardless of your server language** (see migrations below). On the JVM ports
  a runtime startup validator *can* catch generated-table drift at app boot as an
  optional complementary check (if your project wires one), but the authoritative
  DB-vs-metadata gate is the Node `verify --db`.

- **`--codegen`** — regeneration drift. Re-runs generation and diffs the result
  against the committed generated files; a non-empty diff means someone edited
  generated code or skipped a regen. Wire it into CI so a stale `@generated` file
  fails the build.

- **`--templates`** — prompt/payload drift. For every `template.prompt` /
  `template.output`, resolves the text, parses each `{{...}}` reference, and fails
  if any reference isn't on the payload VO. This is the build-time gate for the
  prompt-construction pillar.

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

## Schema migrations are the shared TypeScript engine — for every port

This is the load-bearing architectural fact (ADR-0015): **schema migrations are
owned by one shared TypeScript engine, regardless of your server language.** The
Node `meta migrate` and `meta verify --db` are the migration + live-DB-drift
toolchain for TS, Java, Kotlin, C#, and Python alike.

What this means in practice:

- The Node `meta` CLI emits the migration SQL (diffing metadata → DDL) and applies
  it. You point it at the same database your server connects to:

  ```
  meta migrate --db postgresql://... --slug initial   # emit migration SQL
  meta migrate --db postgresql://... --apply          # apply pending migrations
  meta migrate --dry-run                              # preview without writing
  ```

- Dialects: `postgres` (default), `sqlite`, and `d1` (Cloudflare D1, TS-only).
- The JVM and Python ports have **no** migration command of their own — their
  former migrate goals/modules were removed. A JVM service may auto-create
  dev/test tables at startup for convenience, but production schema is always the
  Node migrate engine's output.

So even in a Java or Python or C# project, schema migration and `verify --db` run
through the Node `meta` tool. The per-port `gen`/codegen tooling stays native to
the language; only schema crosses to Node.

## Never hand-edit the live database — apply schema only through the tool

The live schema is a derived artifact, exactly like generated code. **Do not mutate a running
database by hand** — no `psql`/console `ALTER TABLE` / `CREATE` / `DROP`, not to preview a column, not
to patch a mismatch, not to "just unblock" a boot. It is the single most common way a database ends up
in a state no migration can reproduce:

- The column now exists but no migration recorded it, so the next `meta migrate` (or a JVM app's
  boot-time migrator) tries to add it again and dies on `column ... already exists` — or worse,
  silently diverges and the drift only surfaces days later.
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
  `ERR_UNKNOWN_EXTENDS`, `ERR_MISSING_REQUIRED_ATTR`, `ERR_BAD_ATTR_VALUE`,
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
