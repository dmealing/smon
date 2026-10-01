# Never hand-write a physical name — the generator emits them

> Part of the `metaobjects-codegen` skill. Read it before you write a table, column, schema or index name as a string anywhere in code.

A table name, a column name, a schema — these are declared in metadata and derived by the
same resolver the migration and the runtime use. A string literal for one is a magic string
that no compiler checks and no gate catches, and it goes wrong silently: `@column` is
free-form, so a field named `callPurpose` may map to a column named `purpose_code`, which is
neither the field name nor any transformation of it. A consumer deriving the column as
`to_snake_case(<the field's name>)` gets that case wrong and never finds out.

Every port emits a per-object names artifact. Reference it:

```ts
import { ProgramNames } from "./generated/Program.names.js";

ProgramNames.name                          // "Program"        — the OBJECT's name
ProgramNames.sources.primary.table         // "programs"       — physical table
ProgramNames.sources.primary.kind          // "table"          — table | view | proc | …
ProgramNames.fields.createdAt.name         // "createdAt"      — logical / wire name
ProgramNames.fields.createdAt.column       // "created_at"     — physical column
ProgramNames.indexes.ix_prog_owner.index   // "ix_prog_owner"  — database index name
```

The artifact mirrors the metadata tree: every node carries its own `type`, `subType` and
`name`, and a physical name sits under the key that says **what kind of database object it
is**. A view is `sources.primary.view`, a stored proc `sources.primary.proc`, and a
write-through entity's read view `sources.replica.view` — so `sources.replica.table` is a
compile error rather than a wrong answer. There is no `readOnly`: it was derived from
`kind`, never declared, so ask `kind`.

The artifact is per-object and the shape is per-language; the guarantee is the same
everywhere — **each physical name is spelled once, and generated code references it**:

| Port | Artifact | Reads as |
|---|---|---|
| TypeScript | `<Entity>.names.ts` | `ProgramNames.fields.createdAt.column` |
| C# | `<Entity>Names.g.cs` | `ProgramNames.CreatedAtColumn` |
| Java | `<Entity>Names.java` | `ProgramNames.CREATED_AT_COLUMN` |
| Kotlin | `<Entity>Names.kt` | `ProgramNames.CREATED_AT_COLUMN` |
| Python | `<entity_snake>_names.py` | `PROGRAM_CREATED_AT_COLUMN` |

**Check that it is actually wired before you reference it — on ALL FIVE ports a project
emits none until it asks for it.** ADR-0034 Amendment 2 made codegen opt-in everywhere: no
port ships a default suite, so there is no port on which upgrading the package starts
emitting this artifact. "Wired" is the only fact there is.

| Port | Where the selection is declared | An existing project upgrading gets it? |
|---|---|---|
| C# | `--generators <names>` on `dotnet meta gen` — required, no default | **No** — name `names` |
| Python | `--generators <names>` on `metaobjects gen` — required, no default | **No** — name `names` |
| TypeScript | `metaobjects.config.ts` `generators: [...]` — the complete list | **No** — add `namesFile()` |
| Java / Kotlin | the pom's `<generators>` — the complete list | **No** — add `SpringNamesGenerator` / `KotlinNamesGenerator` |

`meta init` scaffolds `generators: []` and an empty `codegen/generators/`, so even a
project *initialized* at 1.0 has to choose this one — the scaffold is deliberately not a
default by another name. To wire it into a TS project:

```ts
import { namesFile } from "./codegen/generators/names.js";   // after `meta eject names`
export default defineConfig({ generators: [entityFile(), queriesFile(), namesFile(), barrel()] });
```

`meta eject names` copies the owned generator in; `namesFile` is also importable from
`@metaobjectsdev/codegen-ts/generators` if you would rather not own it. Once it is present,
the entity generator and the Exposed / Drizzle table bindings switch to referencing the
constants instead of embedding the physical names a second time — so wiring it changes
generated output, and that diff is the point.

**It follows `extends`.** An object that extends another does not restate what it
inherits: C# and Java use real class inheritance (`class CopayAuthNames extends
AuthNames`), TypeScript spreads (`...AuthNames.fields`), and Kotlin and Python re-export
the parent's constants by reference. An abstract base a persisted object extends gets an
artifact of its own — columns only, no table name, because it has none. So if you are
reading a subtype's artifact and its table name is not there, it is on the base, which is
where it belongs.

**Where generated code consumes it, and where it does not.** TypeScript, C# and Kotlin
bind an ORM (Drizzle, EF Core, Exposed) and so must spell physical names — their generated
code references these constants, and a cross-port gate proves no generated file spells one
literally. **Java and Python generate no SQL at all**: their DTOs and models carry logical
names, and persistence is the repository interface/`Protocol` you implement. There the
artifact exists *for your code*, which is the only place a physical name appears.

Two categories stay literal, deliberately, and the gate pins them as such rather than
exempting them:

- a **flattened value-object column** (`@storage: flattened`) is a composite —
  `<owner field column>_<member column>` — belonging to no single field of either object,
  so there is no one constant to reference;
- a **write-through entity's replica view name**: the artifact holds the object's PRIMARY
  source's name (its table), and a write-through entity has two physical names.

**But prefer a typed handle where one exists — this rule has a real limit.** If the ORM
gives you a type-checked object for the same thing, use that. Replacing a Drizzle column
object (`programs.createdAt`, checked against the schema at compile time) with a string
constant makes the code **worse**: it trades an error the compiler catches for one the
database raises at runtime. The constants are for the places with no typed handle — raw
SQL, migration scripts, log lines, an external system's column mapping, a port whose
generated model carries no persistence binding at all.

The rule is *don't invent the string*, not *replace every name with a constant*.
