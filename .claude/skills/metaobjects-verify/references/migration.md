# Schema migrations — the shared TypeScript engine (every port)

Schema migration is owned by **one shared TypeScript engine** regardless of your
server language (ADR-0015). The Node `meta` CLI (`@metaobjectsdev/cli`, on top of
`@metaobjectsdev/migrate-ts`) is the migration + live-DB-drift toolchain for **TS,
Java, Kotlin, C#, and Python alike**. The non-TS ports have **no** migration command
of their own — their former migrate goals/modules were removed. A JVM service may
auto-create dev/test tables at startup for convenience, but production schema is
always the Node migrate engine's output.

So even in a Java / Python / C# / Kotlin project you run `meta migrate` and
`meta verify --db` through Node. Only schema crosses to Node; per-port `gen`/codegen
stays native to the language.

## Install (Node, dev-only)

```bash
npm install --save-dev @metaobjectsdev/cli @metaobjectsdev/migrate-ts
```

You point the tool at the **same database your server connects to** — its
connection is independent of your runtime tier.

## Output format

`meta migrate` (and the CLI generally) is TTY-aware: when stdout is a terminal it
emits human-readable text; when piped to an agent or CI system it defaults to TOON
(a compact, unambiguous machine-readable format). Override with `--format`:

```bash
meta migrate ... --format toon   # TOON (machine-readable, the pipe/agent default)
meta migrate ... --format json   # JSON
meta migrate ... --format text   # human-readable text (the TTY default)
```

Structured errors and next-step hints are also emitted on stdout (not stderr) in the
active format, so callers can parse them without scraping stderr.

## The workflow

### Fresh database: baseline first

The default `meta migrate` path is **offline** — it diffs metadata against a
committed schema snapshot rather than the live DB. On a fresh database there is no
snapshot yet; run the `baseline` step once before the first migration generate:

```bash
meta migrate baseline --dialect sqlite     # seed snapshot from metadata (no DB needed)
meta migrate baseline --dialect postgres   # same for Postgres
meta migrate baseline --from-db --db postgresql://... --dialect postgres
                                           # alternative: seed from live DB (for existing schemas)
```

`baseline` writes a reference snapshot to `.metaobjects/migrations/` and exits
without emitting any SQL. After this, `meta migrate --dialect <d> --slug <name>`
operates offline against that snapshot.

If you run `meta migrate` before baselining, the CLI surfaces a structured
next-step hint pointing to the exact `baseline` command.

### Generating a migration

1. **Generate a migration** by diffing metadata vs the prior state (the live DB or a
   committed snapshot). The engine emits paired `up.sql` + `down.sql`:

   ```bash
   meta migrate --db postgresql://...               # emit up.sql + down.sql
   meta migrate --db postgresql://... --slug initial # name the migration
   meta migrate --dry-run                            # preview without writing
   ```

2. **Review the SQL.** Read the emitted `up.sql` (forward) and `down.sql`
   (rollback) before applying. Destructive changes (drop column / drop table) are
   opt-in — the engine blocks them unless explicitly allowed, and routes ambiguous
   rename-vs-drop+add decisions through a prompt rather than guessing.

3. **Apply** the pending migrations against the DB; migration history is tracked in
   a ledger table:

   ```bash
   meta migrate --db postgresql://... --apply       # run pending up.sql
   meta migrate --db postgresql://... --rollback     # run down.sql for the last migration
   ```

## Dialects

- `postgres` (default) — native `ALTER`s.
- `sqlite` (libsql / Turso) — native `ALTER`s where supported (≥ 3.35), bundling
  recreate-and-copy per table when a change needs it.
- `d1` (Cloudflare D1) — **TS-only**; targets D1 via the wrangler CLI, writes
  Wrangler's native `migrations/<seq>_<slug>.sql` layout. Pass `--dialect d1`.

## Live-DB drift: `meta verify --db`

`meta verify --db` introspects the live database and fails if its schema has
diverged from the metadata (a column the metadata no longer declares, a missing
index, a type mismatch). This is the **authoritative** DB-vs-metadata gate for every
port — wire it into CI. On the JVM ports a runtime startup validator can catch
generated-table drift at app boot as a complementary check, but the gate that owns
DB drift is the Node `meta verify --db`.

A clean run is silent; a failure names the drifted table/column. Bias toward
trusting the tool — a drift failure almost always means the metadata changed and the
DB didn't follow.

## Index modeling (Postgres)

Two index types, distinguished by uniqueness (ADR-0040) — both carry the same
physical-shape escapes contributed by the db provider:

- **`identity.secondary`** — a UNIQUE alternate key (uniqueness is the type; the legacy
  `@unique` attr was removed from it).
- **`index.lookup`** — a NON-unique retrieval index (`@fields` required).

Shared physical escapes:

- `@orders` — per-key sort direction, positional to `@fields` (`["asc", "desc"]`).
  Omit for all-ascending; drives `DESC`-ordered index keys (e.g. a recency index).
- `@where` — a partial-index predicate (raw SQL, e.g. `"delivered_at IS NULL"`),
  emitted as `WHERE (<pred>)`. The index then covers only matching rows.
- `@using` / `@expr` — index method and functional-expression escapes.

A non-unique recency index is `index.lookup`:

```json
{ "index.lookup": { "@fields": ["userId", "createdAt"],
    "@orders": ["asc", "desc"], "@where": "archived_at IS NULL" } }
```

## Adopting an existing database (non-destructive)

`meta verify --db` / `meta migrate` can reach **zero drift** against a hand-built
schema without a rewrite:

- **`meta migrate --from-db`** reverse-engineers a baseline from the live DB so the
  first diff is empty.
- **Auto schema-scope** — the diff manages only the schemas the metadata *declares*
  (via `source.rdb @schema`); tables in undeclared schemas belong to another owner
  and are left untouched. This is what lets several apps share one database, each
  owning its own schema, with a clean per-owner `verify --db` and no manual ignore
  lists. A downstream app that extends the toolkit's DB declares its own `@schema`,
  models only its tables, and runs its own migrate/verify against that scope.
- **`identity.reference @constraintName`** pins a foreign-key constraint name so the
  metadata can match an existing DB's naming convention without a destructive
  rename.

## Not yet shipped

Triggers, generated columns, exclusion + CHECK constraints, MySQL, and data
migrations (column-type changes needing data transformation error out with a hint).
(Partial + descending **indexes** *are* supported — see Index modeling above.)
