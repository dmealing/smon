# Adopting onto an existing codebase — metadata FOLLOWS the code

> Part of the `metaobjects-authoring` skill. Read it when working code or a populated schema already exists for what you are modeling.

The skill's operating principle is the **greenfield** default: declare the model, generate the
code. **Adoption reverses the direction.** When you are introducing MetaObjects into
a project that already has **working code and/or a live database** — a migration, not
a fresh start — the existing code and schema are the specification, and the metadata's
first job is to **reproduce them**. You are documenting a reality that already runs, not
redefining it. (The metadata is still the durable spine *going forward*; only the
*direction of fit on the way in* changes. Once adopted, the greenfield rules resume.)

**The observable predicate:** does working code or a populated schema already exist for
what you're modeling? If yes, you are in adoption mode and these rules apply.

**Author metadata to match what the code ALREADY IS — not what you'd design fresh.**
Read the existing code and schema *first*, then model to reproduce them:
- The **native types the code uses** are the spec — model `field.uuid` when the code
  uses `UUID`, `field.decimal` when it uses `BigDecimal`, etc. **That rule does not stop
  at scalars: the signature of the function that WRITES a JSON column is the spec for
  that column too.** `list[str]` is the element subtype + `isArray`; a dataclass / DTO /
  record is an `object.value` behind `field.object @storage: jsonb`; `dict[str, X]` with
  a known `X` is `field.map`; only a `dict[str, Any]` that no reader narrows is the
  `field.string` + `@dbColumnType: jsonb` bag (the ladder under "A JSON column" in the skill).
  Reproducing the *column* (jsonb) while discarding the *type the code already declares*
  is the `UUID`-as-`String` mistake in another coat — invisible to `verify --db`, paid on
  every read as a cast, and it satisfies "change the least existing code" only because
  the cast is already there. Do **not** pick a metadata shape whose generated type
  differs from the type already in use (that is the exact mistake that turned a `UUID`
  column into a `String` and forced coercions across hundreds of fields — see the UUID
  rule in `choosing-a-shape.md`).
- The existing **column names, table names, nullability, and field shapes** are the
  spec — carry them over (`@column`, `@table`, `@required`, `@maxLength`) so the
  generated schema matches the live one and `verify --db` is clean.

**Customize the CODEGEN to match the existing code before you change the existing code.**
If generated output doesn't match the code's shape (naming, file layout, imports,
signatures), **tune the generator/template/config to reproduce it** — naming strategy
first, then the generator or the template. **Which lever you have depends on the port,
so establish that before planning:** on TypeScript and the JVM you can own a generator
outright (TS scaffolds copies into your repo; the JVM loads your class from the project
classpath), while on C# and Python the generator registry is closed and a **Mustache
template** is the customization path — a real one, with `scope` and `outputPattern`
doing the walk and the file naming. The `metaobjects-codegen` skill has the per-port
matrix and defines `outputPattern`; read it before concluding a shape is unreachable.
**Whichever lever you get, it is yours to edit.** A standing instruction not to
change the MetaObjects repo says nothing about your own generators or templates —
reading it as though it did is how an adoption ends up hand-written, and it is the most
common way this step is skipped. Editing a generator or a template here is ordinary
adoption work: not an escalation, not a hack, and nothing to ask permission for. Reshaping working call sites to satisfy the
generator's defaults is the *last* resort, not the first.

**Minimize churn to code the generator is not replacing.** The ONLY existing code that
should change is the hand-written layer codegen now **owns** (the hand-rolled
CRUD/DTO/validator/mapper you're deleting) — parity-gate it, then delete it; that is the
point of adopting. Everything else — call sites, business logic, adjacent modules —
stays untouched. **If a metadata choice would force a wide edit across code the
generator isn't replacing, treat that as a signal the metadata is modeling the wrong
thing** and re-check it against the code, rather than editing the code to fit the
metadata.

**When a modeling choice is genuinely ambiguous, ask — don't pick the churnier option.**
If two metadata shapes both fit the existing code and they imply different amounts of
existing-code change, surface the tradeoff to the user rather than choosing silently.
**Default to the choice that changes the least existing code.**

Do NOT: change metadata, regenerate, and then work through the resulting compile/type
errors in the existing code as if they were bugs. On an adoption those "errors" are the
metadata failing to match the code — fix the *metadata* (or the codegen customization),
not the code.
