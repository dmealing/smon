---
name: metaobjects-authoring
description: Use when authoring or modifying MetaObjects metadata — fields, entities, relationships, sources, enums, abstracts/inheritance — in YAML or canonical JSON; includes deciding whether and how to register custom vocabulary (new subtypes or attributes via a provider).
---

# Authoring MetaObjects metadata

MetaObjects metadata is the durable spine of your app: typed entity declarations
that drive code generation, runtime behavior, and drift detection. You author it,
the loader reads it, the codegen emits idiomatic per-language code from it. This
skill is the procedure for writing it correctly.

Metadata lives in files under `metaobjects/` at project root, one file per domain
concept (`meta.commerce.json`, `meta.users.yaml`, …). Each file declares a
`package` on its root node. Files in the same `package` with the same object
`name` are merged by the loader.

## Reference files — open only the one your task needs

This file covers what almost every model needs. The topics below live in
`references/` beside it; open one when its row matches what you are doing, not up front.

| File | Open it when |
|---|---|
| `references/adopting-existing-code.md` | working code or a populated schema already exists for what you are modeling |
| `references/choosing-a-shape.md` | no row of "Canonical form for common field needs" fits; you need the full UUID / timestamp / URI / `@autoSet` rule; or you are registering your own vocabulary |
| `references/json-columns.md` | a JSON column beyond the ladder below: coverage per port, `field.map` at runtime, version caveats, bag → native array |
| `references/relationships.md` | a many-to-many link or self-join, or a "rows that reference this one" query |
| `references/read-views-and-projections.md` | an `object.projection`, `origin.*` vocabulary, `@filter` / `@expr`, or an `@sql` / `@unmanaged` view |
| `references/inheritance-tph.md` | several entities are variants of one thing sharing a single table (`@discriminator`) |
| `references/metadata-dependencies.md` | the project builds on another package's metadata (`dependencies`, cross-package `overlay`) |
| `references/requirements.md` | installed only when the project declares `requirement.*` nodes |

## The operating principle: model-first, generate-first

You are not hand-writing an application — you are **declaring the model it is
generated from.** Persistence, data access, validation, APIs, and UI scaffolding are
**derived from metadata, never authored by hand.** Model-first is the default for
*every* capability; hand-writing one of these layers is an exception you must
**justify**, not a convenience you reach for.

**This requires thinking differently.** Imperative code asks *"how do I implement
this endpoint?"* Model-first asks *"what is this resource, and what is true about
it?"* — and lets codegen own the *how*. **Describe WHAT, not HOW.** The metadata is
the source of truth; generated code is a disposable, regenerable artifact — delete
it and `meta gen` restores it identically.

**Why model-first wins even when hand-writing is cheaper this once — and it often
is, this once:**
- **Hand-writing a layer the metadata could own creates a second source of truth for
  one fact.** A field's type, validation, column, route, and form then change in N
  places and must stay consistent forever — not drift *risk*, but two sources of
  truth for one fact, broken by construction.
- **The hand-roll saving is paid once; the consistency tax is paid on every future
  change.** Assume the system will grow — it always does. The metadata amortizes
  toward zero as the model is reused across layers and time; the hand-rolled
  liability compounds with every field, refactor, and language port.
- **One metadata change regenerates persistence + DAO + API + UI consistently** —
  and inherits every future generator improvement. Hand-writing opts out of all of
  it, permanently.

**Before you hand-write anything data-shaped, STOP and find the model.** The moment
you reach for a hand-written query, route, validator, form, relationship, or
aggregate — that is almost always **metadata you have not declared yet.** In order:
1. **Check whether the design already ships.** `meta gen --list --format json`
   carries `kind: "library"` rows — declared design MetaObjects ships, each with a
   `useWhen`. If one matches the capability you are about to declare, opt in and adapt
   rather than author it from scratch: you inherit its entities, its requirements, and
   the rulings recorded with them. The bare name is the core layer (sourceless — no
   tables, no generated code); `<lib>/db` is the separate opt-in that adds the schema.
2. **Search the vocabulary** — `meta types <term>`, or `meta types --all
   <what-it-does>` to search by behavior. There are field subtypes, relationships,
   projections, origins, identities, sources, and attributes you may not know exist.
   Find the construct that models it. Add `--detail` for one construct's valid
   `@attrs`, or `--format json` for the same answer as one machine-readable document
   — that form carries every match (`--limit` never truncates it) with each attr's
   `allowedValues`, so you read the accepted values rather than guessing them.
3. **Declare it and generate** — then *consume* the generated query/type/route;
   never reimplement it alongside.
4. **If the model is right but the generated OUTPUT is wrong, change your generator.**
   Naming, file layout, imports, framework, signatures are generator concerns, not
   reasons to hand-write. The generators are in *your* repo and are yours to edit — a
   standing rule not to change the MetaObjects repo does not reach them; they are a
   different repository. Editing one is ordinary work, not an escalation. (See
   `metaobjects-codegen` → "Your generators are yours".)
5. **Only if no construct can express it** — and you have actually looked —
   hand-write it, wired to generated types. Business algorithms, external
   integrations, and bespoke interactions are legitimately hand-written; CRUD,
   validation, finders, relationships, and derived/aggregate data are not.

Rule of thumb: **if the metadata could describe it, declaring it is never the wrong
call** — even when a one-off hand-write would be faster today.

## Adopting onto an existing codebase — metadata FOLLOWS the code

The principle above is the **greenfield** default. **Adoption reverses the direction:** when
working code or a populated schema already exists for what you are modeling, that code is the
specification, and the metadata's first job is to reproduce it — its native types, column and
table names, nullability, and the types its JSON writers already declare. Tune the generator to
match the code before you change the code, and default to the choice that changes the least
existing code. **Read `references/adopting-existing-code.md` before you model anything in an
adoption.**

## The fused-key encoding (non-negotiable)

Every node is `{ "<type>.<subType>": { <body> } }`. The wrapper key fuses type and
subtype — there is **no** separate `subType` body key.

```json
{ "object.entity": { "name": "User" } }
{ "field.string": { "name": "email", "@required": true } }
{ "field.enum":   { "name": "status", "@values": ["OPEN", "CLOSED"] } }
{ "identity.primary": { "name": "id", "@fields": ["id"] } }
```

A complete entity in canonical JSON:

```json
{
  "metadata.root": {
    "package": "acme::blog",
    "children": [
      {
        "object.entity": {
          "name": "Author",
          "children": [
            { "source.rdb":   { "@table": "authors" } },
            { "field.long":   { "name": "id" } },
            { "field.string": { "name": "name", "@required": true, "@maxLength": 200 } },
            { "field.string": { "name": "bio",  "@maxLength": 2000 } },
            { "identity.primary": { "name": "id", "@fields": ["id"], "@generation": "increment" } }
          ]
        }
      }
    ]
  }
}
```

The same entity in sigil-free YAML:

```yaml
metadata:
  package: acme::blog
  children:
    - object.entity:
        name: Author
        children:
          - source.rdb: { table: authors }
          - field.long:   { name: id }
          - field.string: { name: name, required: true, maxLength: 200 }
          - field.string: { name: bio, maxLength: 2000 }
          - identity.primary: { name: id, fields: id, generation: increment }
```

## Reserved structural keys vs. attributes

There is one closed set of **reserved structural keys**. Everything else is an
attribute.

```
name   package   extends   abstract   overlay   isArray   children   value
```

- In **canonical JSON**: reserved keys are bare (`"name"`, `"extends"`); every
  other key is `@`-prefixed (`"@required"`, `"@maxLength"`, `"@table"`).
- In **YAML**: reserved keys are bare AND attributes are bare too — the desugar
  re-adds the `@` when lowering.
- `@`-prefixing a reserved word (e.g. `"@isArray": true`) is invalid and fails the
  load with `ERR_RESERVED_ATTR`. Use the bare `isArray: true` (YAML) or the `[]`
  key-suffix sugar (`field.long[]: weekIds`).

## Two violation rules — internalize these

1. **Attribute-name uniqueness within a node.** A node body must not declare the
   same attribute name twice. `{ "field.string": { "name": "x", "@maxLength": 10,
   "@maxLength": 20 } }` is malformed.

2. **An inline `@attr` IS an `attr` child — never both.** An inline attribute and
   a child `attr.*` node with the same name are the same slot expressed two ways.
   Declare a given attribute once, in one form. Don't set `@required` inline AND
   also add an `attr.boolean` child named `required` — that's a double-declaration.

## Field subtypes (closed vocabulary)

| Subtype | Stores | Notes |
|---|---|---|
| `field.string` | text | `@maxLength` drives `varchar(N)` |
| `field.int` | 32-bit integer | |
| `field.long` | 64-bit integer | |
| `field.double` | double float | approximate; not for money |
| `field.float` | single-precision float | native double/number (TS has no distinct float); DB `REAL`; not for money |
| `field.boolean` | true/false | |
| `field.date` | calendar date | ISO 8601 `YYYY-MM-DD` on the wire |
| `field.time` | time-of-day | no calendar date; DB `TIME` |
| `field.timestamp` | instant (tz-aware) | ISO 8601 with timezone on the wire; `@localTime: true` for a naive wall-clock value |
| `field.decimal` | exact decimal | `@precision` / `@scale`; lossless money/quantity |
| `field.currency` | integer minor units | see Currency below |
| `field.enum` | string member | `@values` required; see Enum below |
| `field.uuid` | UUID | canonical lowercase hex on the wire |
| `field.object` | embedded value object | `@objectRef` + `@storage`; see below |
| `field.map` | dynamic keys over a TYPED value | one jsonb column; string keys; exactly one of `@valueType` (scalar) / `@objectRef` (value object); `isArray` does not apply. The typed form of "a dict column" — NOT the open bag (see "A JSON column") |

Common field attributes: `@required`, `@maxLength`, `@column` (physical column
name), `@default`, `@filterable`, `@sortable`. On temporal fields
(`field.date`/`field.time`/`field.timestamp`) `@autoSet` stamps the value
automatically (see "Four rules behind those rows" below).

#### What `@required` actually means

`@required: true` is **NOT NULL** (presence). Two consequences that are easy to
get wrong:

1. **On a non-array string it also rejects `""` — but only at the wire tier.**
   Generated *input* validation (the create/patch models behind POST/PATCH)
   rejects the empty string by default; whitespace-only IS accepted. Generated
   in-process read models never enforce this at construction, so reading an
   existing row containing `""` does not throw.
2. **To say "must be provided, but may be empty", author an explicit
   `validator.length` with `@min: 0`.** An explicitly authored `@min` is always
   authoritative over that implicit non-empty floor; the floor applies only when
   no `@min` is authored at all. Dropping `@required` is NOT the way to express
   this — that makes the field optional and loses presence typing.

```jsonc
// must be provided; empty string allowed
{ "field.string": { "name": "note", "@required": true, "children": [
  { "validator.length": { "name": "noteLen", "@min": 0 } }
]}}
```

Arrays are unaffected: `@required` on an array field is presence only.

### Canonical form for common field needs

Reach for these before inventing anything. When no row fits, run the decision procedure in
`references/choosing-a-shape.md` (ADR-0037): ask what the concept *does*, never how it is stored.

| Need | Author it as | Note |
|---|---|---|
| IDs / unique keys / **any UUID column** | `field.uuid` | native UUID type. **NEVER `field.string` + `@dbColumnType: uuid`** — see "Four rules behind those rows" below |
| Money | `field.currency` | integer minor units; never a float |
| Closed set of symbols | `field.enum` | `@values` required |
| Instant / event time (created/updated) | `field.timestamp` + `@autoSet` | instant / tz-aware by default (Postgres `timestamptz`; native `Instant`/`DateTimeOffset`/aware `datetime`); `@autoSet: onCreate` for `createdAt`, `@autoSet: onUpdate` for `updatedAt` — never hand-stamp |
| Naive wall-clock value (store-open time, birthday-with-time) | `field.timestamp` + `@localTime: true` | `timestamp without time zone` — opt out of zone-awareness only for a genuine wall-clock value |
| A list of anything | `isArray: true` | on the base subtype (e.g. `field.string` + `isArray`) — there is **no** array `@dbColumnType` (retired) |
| Long / unbounded text | bare `field.string` | add `@maxLength` only when you want `varchar(N)` |
| Nested structured value | `field.object` | `@objectRef` + `@storage` |
| Dynamic keys over a known value type | `field.map` | `@objectRef` or `@valueType` |
| Open JSON, no reader narrows it | `field.string` + `@dbColumnType: jsonb` | the LAST rung — see "A JSON column" |
| URL / URI | `field.uri` | native `URI`/`Uri`; `text` column; strict absolute-URI validation (add `@lenient: true` to store any string) — a real native type + behavior, so a subtype (not a validated string) |
| IP address | `field.inet` | native IP type; Postgres `inet` column; strict IPv4/IPv6-literal validation (add `@lenient: true` for a plain-string `text` column) |
| Validated plain string (email / hostname) | `field.string` + `@stringFormat` | `@stringFormat: email` or `@stringFormat: hostname` — idiomatic per-port validation; don't hand-write the `validator.regex` |

Four rules behind those rows, in short (full text: `references/choosing-a-shape.md`):
**a UUID is `field.uuid`** — `field.string` + `@dbColumnType: uuid` generates a `String` over a
uuid column and is a smell; **`field.timestamp` is an instant**, and `@localTime: true` is the
opt-out for a wall clock; **`field.uri` / `field.inet` are strict**, and `@lenient: true` stores
any string; **`@autoSet: onCreate` / `onUpdate`** stamps created/updated times, so never set them
by hand.

### Currency

`field.currency` stores money as **integer minor units** (cents for USD, yen for
JPY) — never a float. `@currency` is ISO 4217; `@locale` (on a `view.currency`
child) is BCP 47. The server never formats currency; formatting is client-side.

```json
{ "field.currency": {
    "name": "priceCents", "@currency": "USD", "@required": true,
    "children": [ { "view.currency": { "@locale": "en-US" } } ]
}}
```

### Enum

`field.enum` is string-backed. `@values` is **required**: a non-empty set of
unique members, each matching `^[A-Za-z_][A-Za-z0-9_]*$`. Missing `@values` →
`ERR_MISSING_REQUIRED_ATTR`; a bad member → `ERR_BAD_ATTR_VALUE`.

```json
{ "field.enum": { "name": "status", "@required": true,
    "@values": ["DRAFT", "PUBLISHED", "ARCHIVED"] } }
```

Reuse a constraint set across entities with an abstract `field.enum` + `extends`.

### Embedded value objects — `field.object` + `@storage`

`field.object` embeds another `object` declaration. `@objectRef` names it;
`@storage` controls persistence:

- `flattened` — one DB column per sub-field (`address_street`, `address_city`, …).
  Illegal on array fields.
- `jsonb` — one `jsonb` column.
- `subdocument` (default, back-compat) — single jsonb column.

```json
{ "field.object": { "name": "address", "@objectRef": "Address", "@storage": "flattened" } }
```

**Arrays of value objects** — set `isArray: true` with `@storage: jsonb`. The whole
array lives in **one** jsonb column (a JSON array), never a native `jsonb[]`. The
generated Postgres column is typed `.$type<VO[]>()` and the Zod schema is
`z.array(<VO>InsertSchema)`:

```json
{ "field.object": { "name": "triples", "@objectRef": "Triple",
    "@storage": "jsonb", "isArray": true } }
```

### A JSON column — choose the rung by the type the WRITER already declares

**"Add a jsonb column and cast on read" is the ORM-tutorial reflex, and it is the one column
shape this metamodel exists to replace.** Every other subtype binds a native type in five
languages; `field.string` + `@dbColumnType: jsonb` binds `unknown` / `Any` / `Object` — so every
reader casts, the keys live in N call sites instead of one declaration, and no gate can see it
(`verify --db` sees a jsonb column that matches; `--codegen` sees output that is correct for a
bag). **The cast you write on read is the shape you declined to declare.**

**The test is mechanical and language-agnostic: read the signature of the function that WRITES
the column.** It already names the type — that is the metadata. Take the first rung that fits:

| The writer's type | Author it as | What comes back |
|---|---|---|
| `list[str]` / `string[]` / `List<X>` — plural name, typed elements | the element subtype + `isArray: true` | a native array — **never** a bag holding a list |
| a dataclass / DTO / record / `@Serializable` class — a fixed key set | an **`object.value`** (no identity, no source), then `field.object` + `@objectRef` + `@storage: jsonb` (`isArray: true` for a list of them) | the VO's own type: `.$type<VO>()` + its Zod schema, the Pydantic model (`<VO>Create` on the wire), a Jackson-coded Exposed column, an EF owned type — gated in all five ports |
| `dict[str, X]` / `Record<string, X>` / `Map<String, X>` — dynamic keys, KNOWN value type | **`field.map`** + `@objectRef` (a value object) or `@valueType` (a scalar) | `Record<string, X>` + `z.record(...)` (TS), `dict[str, X]` (Python), `Map<String, X>` over a Jackson jsonb codec (Kotlin), `java.util.Map<String, V>` (Java), `Dictionary<string, V>` over an EF jsonb converter (C#). **Codegen completes on all five ports; the runtime persistence tier does not — see `references/json-columns.md`** |
| `dict[str, Any]` / `JsonNode` / `unknown`, and no reader pins a key | `field.string` + `@dbColumnType: jsonb` | the parsed value, untyped — the deliberate escape hatch |

Only the last row is an open bag, and there it is correct: a pass-through payload, a raw
third-party or LLM response stored verbatim, a column whose shape genuinely differs per row.
**The bag is wrong exactly when the code already knows the shape.** A `*Json`-suffixed name
(`configJson`, `definitionJson`) is admitting there is one. A plural name over a bag (`scopes`,
`participantEmails`) is a list nobody declared. A writer typed `dict[str, Preference]` whose
`Preference` is already an `object.value` in the same repo is one line from the typed rung.

```json
{ "field.string": { "name": "relatedMemoryIds", "isArray": true } }                                // writer: list[str]
{ "field.double": { "name": "vectorScores", "isArray": true } }                                    // writer: list[float]
{ "field.object": { "name": "profile", "@objectRef": "InstructorProfile", "@storage": "jsonb" } }  // writer: a dataclass
{ "field.map":    { "name": "preferences", "@objectRef": "Preference" } }                          // writer: dict[str, Preference]
{ "field.map":    { "name": "sitePages", "@valueType": "string" } }                                // writer: Record<string, string>
{ "field.string": { "name": "rawResponse", "@dbColumnType": "jsonb" } }                            // writer: dict[str, Any], nothing pinned
```

The objections that are not reasons to take the bag, per-port coverage, `field.map` at
runtime, version caveats, and migrating a bag to a native array are in
`references/json-columns.md`.

## YAML sigil-free authoring + the coercion footgun

In YAML, write the fused `type.subType` key with a **map body**, bare reserved
keys, bare attributes. Two house-style rules:

1. **Always write the explicit `type.subType`** (`field.string`, not `field`).
   Defaults change; the explicit form survives registry edits.

2. **Quote any scalar that looks like a boolean, number, date, or null.** YAML
   silently coerces unquoted `yes` / `no` / `on` / `off` to booleans and bare
   `2026-05-25` to a date. The loader's coercion guard rejects a coerced value in
   a slot that declares a different type (`ERR_YAML_COERCION`) — but quoting is how
   you *prevent* the surprise. Enum members are the classic trap:

   ```yaml
   # Rejected — Y and N coerce to booleans
   field.enum: { name: flag, values: [Y, N] }
   # Correct — quote domain-data members
   field.enum: { name: flag, values: ["Y", "N"] }
   ```

The `[]` key-suffix declares an array field: `field.long[]: weekIds` lowers to
`{ "field.long": { "name": "weekIds", "isArray": true } }`.

## Identities

| Subtype | Purpose | Key attrs |
|---|---|---|
| `identity.primary` | the PK field(s) | `@fields`, `@generation` |
| `identity.secondary` | a unique alternate key (always enforces uniqueness — uniqueness is the type, not a `@unique` attr) | `@fields` (or `@expr` for a functional index) |
| `identity.reference` | an inbound FK from this entity to another | `@fields`, `@references`, `@enforce` |

`@generation` on a primary controls value generation (e.g. `increment`).
`@fields` accepts a single string in authoring; it normalizes to an array in
canonical JSON. `@enforce` on a reference (default `true`) controls whether the
backend physically enforces it (a SQL FK constraint); set `false` for a logical
reference for navigation/typing/codegen only. Referential actions
(`@onDelete`/`@onUpdate`) normally live on the `relationship.*` node (see
Relationships below — the subtype carries the default), but `identity.reference`
also registers them as the **explicit per-FK override** (ADR-0047): use them for
a reference-only FK with no relationship, an M:N junction's FK sides (no
relationship ever correlates with a junction FK), or a single FK that must
deviate from its relationship's action. A reference-level action always wins
over the correlated relationship's.

`@references` resolves cross-package by **fully-qualified name**
(`@references: "shared::billing::Account"`), the same rule as `extends`; a bare
name resolves within the current package. The FK target must be an entity with a
single-column primary key (the FK points at that PK); a target with a composite
PK needs the explicit dotted form `@references: "pkg::Target.fieldA,fieldB"`.

**A dangling reference fails the load (0.11.0+).** An unresolved
`identity.reference.@references` raises `ERR_INVALID_REFERENCE` and an unresolved
`relationship.@objectRef` raises `ERR_INVALID_RELATIONSHIP` — the target entity must
exist (previously such references loaded silently). So every `@references` /
`@objectRef` you author must name a real entity.

An `identity.secondary` can index an **expression** instead of plain columns: use
`@expr` (e.g. `"lower(email)"`) in place of `@fields`, optionally with `@using` (the
index method — `gin` / `gist` / `hash`; default `btree`) and `@where` (a partial-index
predicate).

```json
{ "identity.primary":   { "name": "id", "@fields": ["id"], "@generation": "increment" } }
{ "identity.secondary": { "name": "byEmail", "@fields": ["email"] } }
{ "identity.secondary": { "name": "byEmailCI", "@expr": "lower(email)" } }
{ "identity.reference": { "name": "fkAuthor", "@fields": ["authorId"], "@references": "Author", "@enforce": true } }
```

## Indexes (non-unique)

Use `index.lookup` for a **non-unique** DB index added purely for query performance — it
does NOT enforce uniqueness. Choose the right construct by what the constraint IS:

| Need | Construct |
|---|---|
| Unique alternate key (e.g. email, slug) | `identity.secondary` — uniqueness is the type |
| Query-performance index, no uniqueness | `index.lookup` |

**An index keys off EXACTLY ONE of `@fields` or `@expr`.** `@fields` names the indexed
columns; `@expr` is a raw key expression used **instead of** `@fields` (a functional index).
Declaring **neither** — or **both** — is `ERR_INVALID_INDEX`. This applies to
`identity.secondary` as well as `index.lookup`: uniqueness lives in the type, so a unique
index keys itself the same way.

A legacy index declaring both is fixed by `meta upgrade --apply`, which keeps `@expr` (the
index the database actually has). Do not hand-pick the survivor.

The db provider contributes physical-tuning attrs alongside either form: `@orders`
(per-column sort direction), `@using` (access method — `gin`/`gist`/`hash`; default
`btree`), and `@where` (partial-index predicate).

```json
{ "index.lookup": { "name": "byCreatedAt", "@fields": ["createdAt"], "@orders": ["desc"] } }
{ "index.lookup": { "name": "byStatusCreatedAt", "@fields": ["status", "createdAt"] } }
{ "index.lookup": { "name": "byEmailCI", "@expr": "lower(email)" } }
{ "identity.secondary": { "name": "uniqLowerEmail", "@expr": "lower(email)" } }
```

`index.lookup` is a sibling of `identity.*` — declare it as a direct child of an `object.entity`,
at the same level as fields and identities.

## Relationships

A `relationship.*` child is the navigation / ownership side of a link to another
entity; `identity.reference` (above) is the FK-column side. They are the two halves
of one FK. **Choose the subtype by ownership semantics — it decides the default
referential action**, so modeling every FK as `composition` silently arms unintended
`CASCADE` deletes:

| Subtype | Ownership | Default `@onDelete` | Use when |
|---|---|---|---|
| `relationship.composition` | owns the target's lifecycle | `cascade` | children are owned and deleted with the parent |
| `relationship.aggregation` | groups, does NOT own | `set-null` | children outlive the parent; delete nulls the FK |
| `relationship.association` | plain reference, no ownership | `restrict` | you just point at an independent entity |

Common attrs (on any subtype): `@objectRef` (target entity name / FQN),
`@cardinality` (`one` / `many`), and `@onDelete` / `@onUpdate`
(`cascade` / `set-null` / `restrict` / `no-action`). `@onDelete` defaults **per
subtype** as in the table; `@onUpdate` defaults to `cascade` on every subtype.

```json
{ "relationship.composition": { "name": "posts",   "@objectRef": "Post", "@cardinality": "many" } }
{ "relationship.aggregation": { "name": "members", "@objectRef": "User", "@cardinality": "many" } }
{ "relationship.association": { "name": "author",  "@objectRef": "User", "@cardinality": "one" } }
```

**A 1:N declared on both sides: the FK-owning side governs.** The parent-side form
(`Author` → `posts`, `@cardinality: many`) and the child-side form (`Post` → `author`,
`@cardinality: one`) are both supported, and the FK is always derived from the child's
`identity.reference`. When both are declared, the **child's** relationship sets the FK's
actions and the parent's has no effect on the constraint. So a parent `composition` plus a
child `association` gives `ON DELETE RESTRICT`, not cascade, and deleting a parent that has
children is refused. `meta verify` flags that pair (rule `overridden-referential-action`) and
`meta migrate` warns. To get the cascade, put it on the FK itself:
`"@onDelete": "cascade"` on the child's `identity.reference` (it overrides both sides), or
make the child's relationship agree. In TypeScript a parent-side `many` relationship emits
no Drizzle `many()` member; reverse navigation is the generated finder
`find<ChildPlural>By<Fk>` (and its batched `…In`) on the child's queries module.

**Many-to-many and self-joins** use `@through` a junction entity whose two
`identity.reference` children supply the FK sides; see `references/relationships.md`.
Reverse finders (`find<Source>By<FkField>` and the batched `…In`) are **generated** for every
FK, so never hand-write a `WHERE fk = ?` helper.

**Adoption footgun — pin BOTH actions.** `@onDelete` defaults *per subtype* (above)
and `@onUpdate` defaults to `cascade` — but a plain SQL foreign key is `NO ACTION` on
both. If you're adopting an existing database (matching metadata to a live schema),
leaving these implicit makes the metadata declare a referential action the DB doesn't
have — a perpetual `verify --db` drift. Pin **both** explicitly to the DB's real
behavior:

```json
{ "relationship.association": { "name": "author", "@objectRef": "User",
    "@cardinality": "one", "@onDelete": "no-action", "@onUpdate": "no-action" } }
```

## Validators — cross-field rules

Entity-scoped `validator.*` children declare invariants that reference sibling fields
**by name** (the same name-reference pattern as `identity.*`). The backend derives the
enforcement (a CHECK constraint / cross-field assertion) — no raw expression is stored.

| Subtype | Rule | Key attrs |
|---|---|---|
| `validator.comparison` | two fields stand in a relational order (`@left @op @right`) | `@left`, `@op` (`gt`/`gte`/`lt`/`lte`/`ne`/`eq`), `@right` |
| `validator.requiredWhen` | `@field` is required when `@when` equals `@equals` | `@field`, `@when`, `@equals` |
| `validator.presentIff` | `@field` is present **iff** `@when` equals `@equals` (biconditional) | `@field`, `@when`, `@equals` |
| `validator.atLeastOne` | at least one of `@fields` (2+) is present | `@fields` |

```json
{ "validator.comparison":   { "name": "hpInRange", "@left": "currentHp", "@op": "lte", "@right": "maxHp" } }
{ "validator.requiredWhen": { "name": "reasonIfRejected", "@field": "rejectReason", "@when": "status", "@equals": "rejected" } }
{ "validator.presentIff":   { "name": "usedAtWhenUsed", "@field": "usedAt", "@when": "isUsed", "@equals": "true" } }
{ "validator.atLeastOne":   { "name": "emailOrPhone", "@fields": ["email", "phone"] } }
```

These are children of `object.entity`, alongside its fields and identities.

## Sources — `source.rdb` + `@kind`

`source.rdb` declares where an entity's data lives. Read-only-ness derives from
`@kind` (it is NOT a separate subtype):

| `@kind` | Read-only | Default? |
|---|---|---|
| `table` | no | yes (when `@kind` omitted) |
| `view` | yes | – |
| `materializedView` | yes | – |
| `storedProc` | yes | – |
| `tableFunction` | yes | – |

The physical name attr is **kind-matched** — never `@name`: `@table` for a table,
`@view` for a view, `@materializedView`, `@proc` (storedProc), `@function`
(tableFunction). (`@table` on a non-table kind is a pre-1.0 legacy spelling the
canonical serializer rewrites to the kind's alias; author the kind-matched attr
directly.) The physical column name on a field is `@column`. `@schema` namespaces
the DB schema (Postgres default `public`; SQLite rejects non-default values).
Multi-source: multiple `source.rdb` children, each with a `@role`, exactly one
`primary`.

```json
{ "source.rdb": { "@kind": "view", "@view": "v_author", "@schema": "blog" } }
```

**This declaration is the only place a physical name is ever spelled.** Codegen emits a
per-object names artifact from it (`<Entity>Names` — `ProgramNames.fields.createdAt.column`,
`ProgramNames.CreatedAtColumn`, `PROGRAM_CREATED_AT_COLUMN`, per port), the generated table
binding reads that artifact, and hand-written SQL, repositories and migration scripts
reference it — so a consumer never restates `v_author` or `created_at`, and a rename here
propagates. Declare `@column` explicitly whenever the physical name is not the naming
strategy's answer (`callPurpose` → `purpose_code`): nothing downstream can recover that
mapping by derivation, and the constant is what carries it. (See `metaobjects-codegen` →
"Never hand-write a physical name".)

**An entity's PRIMARY source must be writable** (`table`) — read-only kinds are
legal only in non-primary roles.

### A store MetaObjects does not manage — MongoDB, Cassandra, Neo4j, an API

`source.rdb` is the only registered source. A record kept in a document, wide-column or
graph store, or behind a remote API, is an `object.entity` with an `identity.primary` and
**no `source.*` child**: a *sourceless entity*. Do not invent a document or graph source
subtype, or a `@collection` attr: ADR-0007 designs them but registers only `rdb`, so the
loader refuses them. Put
store settings in your own property bag instead: any `@name` whose value is a JSON object is
a registered `attr.properties` bag, for example `"@mongo": { "collection": "orders" }`.

A sourceless entity gets no table, queries, routes or migration. It still gets its wire
contract in every port: the create and PATCH schemas and the filter allowlist. Keep the
`identity.primary`, because it is what makes the record addressable. Without it the object
is a shape only. The data access layer is a generator you own: the procedure is in the
`metaobjects-codegen` skill, `references/any-stack.md`, and on TypeScript
`references/typescript-document-store.md` carries a complete, tested MongoDB repository
generator to copy.

**The database dialect is codegen config, not metadata.** MySQL, Postgres, SQLite and D1
entities are all modeled with `source.rdb`; `dialect` in the codegen config picks the target.
Do not encode the database in the model.

### Derived/computed columns: reach for an ENTITY READ-VIEW first

**Do not default to `object.projection` for a list screen, grid, or "one extra
column" read.** The usual need — an entity's own rows plus a joined display name or a
per-row count, filterable and sortable like any other column — is an **entity
read-view**, not a projection:

```jsonc
{ "object.entity": { "name": "Order", "children": [
  { "source.rdb": { "@kind": "table", "@table": "orders" } },              // writes
  { "source.rdb": { "@kind": "view", "@view": "v_order", "@role": "replica" } },  // reads
  // …the entity's own fields stay as they are — you re-state NOTHING…
  { "field.string": { "name": "customerName", "@filterable": true, "children": [
    { "origin.passthrough": { "@from": "Customer.name" } } ]}},
  { "field.int": { "name": "itemCount", "@filterable": true, "children": [
    { "origin.aggregate": { "@agg": "count", "@of": "OrderItem.id", "@via": "Order.items" } } ]}}
]}}
```

That is the whole change. Writes route to the table (derived fields are excluded from
the write codecs); reads route to the view; `meta migrate` emits the `CREATE VIEW` from
the **same assembly logic** a projection view uses — one emitter, two hosts (FR-024 §7,
#213/#214). Filtering and sorting on `customerName` / `itemCount` work like any other
column because the filter tier runs against the view.

**When you need an independent exposure** — a subset, renamed columns, a row-filtered
view, a versioned or external shape — that is an `object.projection`. It, the `origin.*`
vocabulary, the structured `@filter` / `@expr` shapes and the `@sql` / `@unmanaged` escapes
are in `references/read-views-and-projections.md`.

## Abstracts + `extends` (deferred resolution) + `overlay`

An **abstract** node (`abstract: true`) describes a shape but is never emitted as
a concrete entity. A concrete node references it via `extends:` to inherit its
children + attrs. This is the lightest reuse mechanism — pure data, no codegen
change.

```yaml
- object.entity:
    name: BaseEntity
    abstract: true
    children:
      - field.long: { name: id }
      - field.timestamp: { name: createdAt, required: true }

- object.entity:
    name: Author
    extends: BaseEntity
    children:
      - source.rdb: { table: authors }
      - field.string: { name: name, required: true }
      - identity.primary: { name: id, fields: id }
```

Resolution facts:

- **Deferred.** `extends:` resolves *after all files load* — abstracts can live in
  any file, forward references are fine.
- **Multi-level chains resolve through the whole chain** (`Author extends BaseEntity
  extends Auditable`) — each `extends` is a super-*reference*, so resolution walks the
  full chain (it does not flatten inherited members onto the child; see ADR-0039).
- **Cross-package** refs use the fully-qualified name (`extends: "shared::auditable"`);
  same-package refs use the bare name.
- An unresolved reference fails with `ERR_UNRESOLVED_SUPER`.

`abstract` and `extends` are **structural keys** (bare, no `@`).

**Inherited properties live on the parent** (`extends` is a super-reference, not a flatten).
A generator or provider must read through the resolving accessors, never `own*()` (ADR-0039;
the `metaobjects-codegen` skill has the per-port table).

**`overlay` is a different concept.** `extends:` is an IS-A relationship between
two distinct nodes. `overlay: true` re-opens the *same* named node to amend it
across files (same `package` + same `name` → merged; last-writer-wins on attr
conflicts, structural children accumulate). Use `extends` to share shape between
distinct entities; use `overlay` to split one entity's declaration across files.

**Building on a dependency's metadata** (`dependencies` in `.metaobjects/config.json`):
its nodes load before yours, so `extends` and `overlay: true` work across the boundary. Always
say `overlay: true` on an amendment to a node you do not own. The rules are in
`references/metadata-dependencies.md`.

## Discriminator inheritance (TPH)

Several variants of one thing sharing **one table**: the base `object.entity` declares
`@discriminator` (naming a `field.enum` of subtype tags) and each subtype `extends` it with a
`@discriminatorValue`. Codegen emits per-subtype routes with the discriminator injected and
immutable. Supported in all five ports; the worked example is in `references/inheritance-tph.md`.

## Requirements — capability ledger (opt-in)

**This capability exists whether or not the project uses it yet.** `requirement.functional` and `requirement.architectural` are registered metadata types, declared in `metaobjects/` beside the entities they describe and loaded by the same loader — no side file, no bespoke parser. They record *why* each part of the model exists, so a field with no reason to exist becomes visible as one.

Reach for it when the project needs to answer any of:

- **"Why is this field here?"** — an L5 requirement binds a claim to a specific member. Authoring these exhaustively is what surfaces columns nothing reads and vocabularies nobody documented.
- **"What is broken but known?"** — `@status: partial` plus `@disposition: accepted | deferred`. Absent disposition means *undecided*, and `meta verify` counts those: the gaps nobody has ruled on.
- **"What did we say we would build and have not?"** — `@status: planned` is the one status where a dangling `@implementedBy` is *correct*, because the entry precedes the nodes.
- **"What have we committed to build?"** — `@status: planned`. Its references may dangle, and it never counts toward object coverage.
- **"Which ticket covers this?"** — `@trackedBy`.

Every requirement must be **violable**: if you cannot say what breaking it looks like, it is a description, not a requirement.

If the project declares any `requirement.*` node, `references/requirements.md` is installed with the full authoring rules. If it does not and you are adding the first one, the shape is:

```yaml
- requirement.architectural:
    name: everyStoredRowIsAddressable
    status: live
    statement: Every persisted row declares the identity by which it is addressed.
    counterexample: A row that can be inserted but never pointed at.
    implementedBy: [acme::shop::Order]
```

---

For non-trivial schema design, use `/superpowers:brainstorming` if installed;
otherwise proceed.
