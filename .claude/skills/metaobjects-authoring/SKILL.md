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
1. **Search the vocabulary** — `meta types <term>`, or `meta types --all
   <what-it-does>` to search by behavior. There are field subtypes, relationships,
   projections, origins, identities, sources, and attributes you may not know exist.
   Find the construct that models it. Add `--detail` for one construct's valid
   `@attrs`, or `--format json` for the same answer as one machine-readable document
   — that form carries every match (`--limit` never truncates it) with each attr's
   `allowedValues`, so you read the accepted values rather than guessing them.
2. **Declare it and generate** — then *consume* the generated query/type/route;
   never reimplement it alongside.
3. **If the model is right but the generated OUTPUT is wrong, change your generator.**
   Naming, file layout, imports, framework, signatures are generator concerns, not
   reasons to hand-write. The generators are in *your* repo and are yours to edit — a
   standing rule not to change the MetaObjects repo does not reach them; they are a
   different repository. Editing one is ordinary work, not an escalation. (See
   `metaobjects-codegen` → "Your generators are yours".)
4. **Only if no construct can express it** — and you have actually looked —
   hand-write it, wired to generated types. Business algorithms, external
   integrations, and bespoke interactions are legitimately hand-written; CRUD,
   validation, finders, relationships, and derived/aggregate data are not.

Rule of thumb: **if the metadata could describe it, declaring it is never the wrong
call** — even when a one-off hand-write would be faster today.

## Adopting onto an existing codebase — metadata FOLLOWS the code

The principle above is the **greenfield** default: declare the model, generate the
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
  uses `UUID`, `field.decimal` when it uses `BigDecimal`, etc. Do **not** pick a
  metadata shape whose generated type differs from the type already in use (that is the
  exact mistake that turned a `UUID` column into a `String` and forced coercions across
  hundreds of fields — see the UUID rule below).
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
| `field.map` | open-keyed map | one jsonb column; string keys; `@valueType` (scalar subtype) XOR `@objectRef` (value object); `isArray` does not apply |

Common field attributes: `@required`, `@maxLength`, `@column` (physical column
name), `@default`, `@filterable`, `@sortable`. On temporal fields
(`field.date`/`field.time`/`field.timestamp`) `@autoSet` stamps the value
automatically — see the `@autoSet` callout under Timestamps below.

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

### Choosing the right shape — the general decision procedure (ADR-0037)

This procedure decides the shape of **any** concept entering the metamodel — a
field need today, or new vocabulary you register as a custom provider. It is not a
lookup table of specific answers; it is the routing an LLM re-derives on its own
for a concept it has never seen.

**Ask what the concept *does*, never how it stores.** The guiding question is
**semantic behavior, not surface storage**: never ask *"is X a string / a number /
a date?"* — ask *"what does X **do**? Does it have its own native type, behavior,
or attributes (a **thing** → subtype)? Is it a structural variant of an existing
thing (a **kind**)? Or does it just modify, validate, or configure an existing type
(an **attribute**)?"* Shape follows behavior. Don't be misled by tools (JSON
Schema, Zod) that call everything a "string format" — they only do so because
JS/JSON has no native types; MetaObjects binds metadata→native types across five
languages, so the call is behavioral.

Run the steps **in order; the first that matches decides:**

| # | Test | If yes → | Examples (existing vocab) |
|---|---|---|---|
| 0 | **Derivable** from the existing subtype + attrs (`isArray`, `@maxLength`) + structure (`identity.reference`, relationships) + naming? | **derive it in codegen — add NOTHING** | `text[]` ← `field.string` + `isArray`; `varchar(n)` ← `@maxLength`; FK columns ← `identity.reference` |
| 1 | **Physical-only** — pure DB-storage detail, native type *and* meaning unchanged? | narrow **`@dbColumnType`** escape hatch (sparingly; not a logical type) | open JSON bag → `field.string` + `@dbColumnType: jsonb` |
| 2a | Its **own thing** — has its own native type, **or** its own behavior, **or** its own attributes? | **SUBTYPE** (the extension point — owns custom codegen, validation, child attrs) | `field.uuid` (native UUID), `field.currency` (minor-unit money behavior), `field.decimal` (exact) |
| 2b | A **structural variant within** a subtype that already earned 2a — same native type/behavior, different generated *shape*? | **`@kind`** (the one chartered structural-variant axis) | `source.rdb @kind`: table/view/materializedView/storedProc/tableFunction; `template.output @kind`: document/email |
| 2c | Otherwise it **modifies / validates / configures** an existing type | **ATTRIBUTE** (boolean flag · closed enum · validation · config) | `@localTime` (boolean exception-flag); `@maxLength`/`@precision`/`@scale` (config) |

**Reading step 2 (the load-bearing split):**
- **2a — subtype** is the metamodel's *extension point*: the only shape that owns
  custom logic. Litmus: *"would I plausibly want to attach behavior or extra
  attributes to this later?"* If yes → subtype. A value that merely *serializes* as
  a string is still a subtype if the **concept** has a native type or behavior of
  its own. (General rule, stated abstractly so it survives un-built vocab: *a
  concept with a native type or its own behavior becomes a subtype; a plain string
  that just needs validating becomes a validation attribute.*)
- **2b — `@kind`** is reserved for variants *inside* a subtype that earned its place
  by 2a. `@kind` on a plain `field.string` is wrong: a plain string isn't a
  behavioral subtype, so there's nothing for the kinds to be *kinds of*. Never let
  `@kind` become a catch-all discriminator.
- **2c — attribute** shape follows what it is: a **boolean exception-flag** whose
  common case is *absent* (`@localTime` — never a default-true opt-out); a **closed
  set** → enum attr with `allowedValues`; a **validation constraint** that narrows a
  value without changing its type (the thing stays a plain `<base>`, there's no
  behavior to own — else it would be 2a); a **config value** (sizing, precision,
  locale) → a typed attr (`@precision`/`@scale`).

**Two corollaries that break ties:**
- **Self-documentation over economy.** Prefer a specific named attribute
  (`@localTime`, `@unique`) over folding several concerns into one generic attr. A
  name should tell you what it does without a per-type lookup. The *primary*
  universal discriminator is already `type.subType` — don't invent a second one.
- **Same concept → same attr name; never same-name / different meaning.** If an attr
  name already means something else on another type, give the new one a distinct
  name rather than overload it.

This procedure is authority-backed: **ADR-0037** is the source of truth, sequencing
ADR-0013 (physical vs logical), ADR-0023 (derive, don't invent), and ADR-0001
(build-time native binding).

Canonical form for common field needs — reach for these before inventing anything:

| Need | Author it as | Note |
|---|---|---|
| IDs / unique keys / **any UUID column** | `field.uuid` | native UUID type. **NEVER `field.string` + `@dbColumnType: uuid`** — see the smell callout below |
| Money | `field.currency` | integer minor units; never a float |
| Closed set of symbols | `field.enum` | `@values` required |
| Instant / event time (created/updated) | `field.timestamp` + `@autoSet` | instant / tz-aware by default (Postgres `timestamptz`; native `Instant`/`DateTimeOffset`/aware `datetime`); `@autoSet: onCreate` for `createdAt`, `@autoSet: onUpdate` for `updatedAt` — never hand-stamp |
| Naive wall-clock value (store-open time, birthday-with-time) | `field.timestamp` + `@localTime: true` | `timestamp without time zone` — opt out of zone-awareness only for a genuine wall-clock value |
| A list of anything | `isArray: true` | on the base subtype (e.g. `field.string` + `isArray`) — there is **no** array `@dbColumnType` (retired) |
| Long / unbounded text | bare `field.string` | add `@maxLength` only when you want `varchar(N)` |
| Nested structured value | `field.object` | `@objectRef` + `@storage` |
| Open JSON bag (no fixed shape) | `field.string` + `@dbColumnType: jsonb` | logical type stays string; column is jsonb |
| URL / URI | `field.uri` | native `URI`/`Uri`; `text` column; strict absolute-URI validation (add `@lenient: true` to store any string) — a real native type + behavior, so a subtype (not a validated string) |
| IP address | `field.inet` | native IP type; Postgres `inet` column; strict IPv4/IPv6-literal validation (add `@lenient: true` for a plain-string `text` column) |
| Validated plain string (email / hostname) | `field.string` + `@stringFormat` | `@stringFormat: email` or `@stringFormat: hostname` — idiomatic per-port validation; don't hand-write the `validator.regex` |

**UUID columns are `field.uuid` — `field.string` + `@dbColumnType: uuid` is a forbidden smell.**
A UUID column is modeled with the **`field.uuid`** subtype (native `UUID` / `Guid` /
`uuid.UUID`, canonical lowercase-hex on the wire). Do **not** reach for `field.string` +
`@dbColumnType: uuid`: that pairing makes the *DB column* a uuid but generates a **`String`
property in code**, so every consumer must coerce `String ↔ UUID` at every boundary. It reads
"correct" because `verify --db` passes (the column really is uuid) — the defect is invisible to
the schema gate and only shows up as wrong native types rippling through the code. Left in a
`BaseEntity`, it is inherited by every `id`/`tenantId`/FK — hundreds of fields across a repo, a
staged multi-PR migration to undo. So:

```json
{ "field.uuid": { "name": "id" } }                                  // ✅ native UUID
{ "field.string": { "name": "id", "@dbColumnType": "uuid" } }       // ❌ generates String over a uuid column
```

The `field.string` + `@dbColumnType: uuid` form is legitimate **only** in the genuinely rare
case where your code truly wants a *string-typed* value stored in a uuid column (you handle the
uuid as text everywhere and never as a native UUID). That is an explicit, justified exception —
not a default, and never the way to model an identifier. When adopting an existing schema whose
code already uses `UUID`, `field.uuid` is the match-the-code choice (see "Adopting onto an
existing codebase" above).

**Timestamps — instant by default, `@localTime` for naive wall-clock (ADR-0036 Wave 2).**
`field.timestamp` is **instant / timezone-aware by default** (Postgres `timestamptz`;
native `Instant` / `DateTimeOffset` / aware `datetime`) — use it for created/updated/event
times. Add **`@localTime: true`** only for a genuine naive wall-clock value (a store-open
time, a birthday-with-time, a recurring local schedule) → `timestamp without time zone`.
Never use `@dbColumnType: timestamp_with_tz` — it is **retired**; timezone-awareness now
lives in `field.timestamp` (instant by default) + the `@localTime` naive opt-out.

```json
{ "field.timestamp": { "name": "createdAt", "@required": true } }
{ "field.timestamp": { "name": "opensAt", "@localTime": true } }
```

**URIs / IPs — strict by default, `@lenient` to store any string (#234).** `field.uri` is a
strict **absolute, scheme-bearing URI** (`https://a.com`, `mailto:a@b`; a scheme-less
`example.com` or a bare `/path` is rejected) and `field.inet` is a strict **IPv4/IPv6 literal**
(no hostnames, no CIDR). When a field must hold a *not-necessarily-well-formed* value — an
LLM-emitted citation URL, a user-supplied host that might be a name — add **`@lenient: true`**:
codegen then binds a plain string (no URL/IP validator) and a `field.inet @lenient` uses a plain
`text` column instead of the native `inet` type (so a value the native column would reject at
INSERT round-trips unchanged). Strict is the default; `@lenient` is the deliberate opt-out (never
default-true — the same shape as `@localTime`). **Toggling `@lenient` on an existing `field.inet`
is schema-affecting** (`inet` ⇄ `text`), so it shows up as an `ALTER` on the next `meta migrate`.

```json
{ "field.uri":  { "name": "homepage" } }                       // strict — must be an absolute URL
{ "field.uri":  { "name": "citationUrl", "@lenient": true } }  // any string (LLM-emitted, may be malformed)
{ "field.inet": { "name": "sourceIp" } }                       // strict — IPv4/IPv6 literal only
{ "field.inet": { "name": "reportedHost", "@lenient": true } } // any string; text column
```

**`@autoSet` — let the runtime stamp created/updated times; never hand-set them.**
`@autoSet` is registered on the temporal subtypes (`field.date` / `field.time` /
`field.timestamp`) and takes **`onCreate`** (stamp on insert) or **`onUpdate`**
(stamp on every write). This is the model-first way to express audit timestamps —
declare it and the generated write path stamps the column, so you never hand-write
`createdAt = now()` in application code (the exact hand-stamping anti-pattern). A
`@required` field carrying `@autoSet: onCreate` is correctly *optional* on POST (the
server supplies it).

```json
{ "field.timestamp": { "name": "createdAt", "@autoSet": "onCreate", "@required": true } }
{ "field.timestamp": { "name": "updatedAt", "@autoSet": "onUpdate" } }
```

**String-shaped natives & validated strings (ADR-0036 Wave 3).** A URL/URI is its own
native type with URL behavior → **`field.uri`** (subtype, step 2a), not a validated
string. An IP address likewise → **`field.inet`**. An email or hostname is a *plain
string that just needs validating* (native type stays `string`) → **`field.string` +
`@stringFormat: email`/`hostname`** (validation attribute, step 2c) — let the per-port
codegen emit the idiomatic check; don't hand-write a `validator.regex` for it.

```json
{ "field.uri":    { "name": "homepage" } }
{ "field.inet":   { "name": "lastLoginIp" } }
{ "field.string": { "name": "email", "@stringFormat": "email", "@required": true } }
```

**Reverse navigation is generated for you (ADR-0038) — don't hand-write reverse queries.**
The natural question *"find all the rows that reference this one"* (every `Scene` a
`GameSession` points at, every `Message` naming a `User`) is **codegen, not authoring**.
For each FK, the *referenced* entity's query surface gains explicit finders derived from
the relationship + `identity.reference` metadata — idiomatic per port (a Spring repository
finder, an EF query method, a Python query function, a TS query function):

- `find<Source>By<FkField>(id)` — one indexed `WHERE <fk> = ?` lookup.
- `find<Source>By<FkField>In(ids)` — the batched variant, one `WHERE <fk> IN (…)` for the
  many-parent case (no N+1).

They are **performant by construction** (a single indexed query, no lazy collections /
proxies / N+1 surprises) and **framework-free** (a plain function over the query layer —
runs without MetaObjects). When an entity has **two FKs to the same target**, you get **two
distinct finders** automatically — named by the FK field, unique by construction. There is
**no attribute to author** for this — reverse navigation is a *codegen feature, not a
metamodel attribute*: you declare the FK once via `identity.reference`, and the reverse
finders fall out of codegen. So never hand-roll a `findByParentId` / `WHERE fk = ?` helper —
consume the generated finder.

### Extending the metamodel — custom providers, and the downstream lifecycle

The same ordered procedure above governs new vocabulary you register — apply it
mechanically before registering anything. A would-be subtype that differs from an
existing one only by a *property* is an **attribute**, not a subtype (a "short
string" isn't a new field subtype — that is `@maxLength`); a plain string that merely
needs validating is a **validation attribute**, not a subtype (its native type is
still `string`, and there's no behavior to own); a concept with its own native type
or behavior is a **subtype**, and structural variants *within* such a subtype are
`@kind`. Every new first-class element also requires a registered provider + a
`registry-conformance` fixture (ADR-0023 strict provenance), and closed enums
(including any `@kind` value-set) carry `allowedValues` in the gate (ADR-0036).
ADR-0037 is the authority.

**Converge before inventing.** Search the shipped vocabulary first (`meta types
<term>`) and check the roadmap — if core already models (or plans) the concept, model
yours in a fold-in-friendly shape. The type names `api`, `operation`, `surface`, and
`binding` are chartered for planned core vocabulary — never claim one for a
project-local type (a later core release would force a breaking rename).

**Design rules for downstream vocabulary that ages well.** Keep the node protocol-
and address-free — the subtype names the *concept*; transport/protocol is a closed
`@kind` variant *within* the subtype (as `source.rdb` puts table/view behind
`@kind`), never the subtype axis, and endpoints/addresses never enter metadata.
Declare config as the *names* of required keys (values stay in env/config) and
generate a fail-closed check. Reference typed payloads instead of inlining shapes.

**Lifecycle.** Register with explicit provider wiring — never loosen `strict` to
free-ride ad-hoc attrs. When core later ships the concept your provider shrinks from
`register` to `extend` (the `template.toolcall` precedent). A second independent
consumer wanting the same concept is a consumer→core promotion candidate (ADR-0011) —
open an upstream issue rather than adding core vocabulary yourself. Full guidance:
`docs/features/downstream-metadata-decisions.md`.

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

**Opaque jsonb (no value object)** — when the payload has no fixed shape (freeform
config, passthrough metadata, an open-keyed map), do NOT use `field.object` (it
requires `@objectRef`, and a partial VO would let the generated Zod strip unknown
keys → data loss). Model it as a `field.string` with the physical-type override
`@dbColumnType: jsonb` — the logical type stays string-bound, the column is jsonb:

```json
{ "field.string": { "name": "metadata", "@dbColumnType": "jsonb" } }
```

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

Legacy metadata declaring both used to load, with `@fields` **silently discarded**. If you
meet one, `meta upgrade --apply` drops `@fields` — do not hand-pick the survivor: the index
in the database is the expression one, so keeping `@expr` reproduces it and keeping
`@fields` would emit a migration against live data.

The db provider contributes physical-tuning attrs alongside either form: `@orders`
(per-column sort direction), `@using` (access method — `gin`/`gist`/`hash`; default
`btree`), and `@where` (partial-index predicate).

```json
{ "index.lookup": { "name": "byCreatedAt", "@fields": ["createdAt"], "@orders": ["desc"] } }
{ "index.lookup": { "name": "byStatusCreatedAt", "@fields": ["status", "createdAt"] } }
{ "index.lookup": { "name": "byEmailCI", "@expr": "lower(email)" } }
{ "identity.secondary": { "name": "uniqLowerEmail", "@expr": "lower(email)" } }
```

> **Do not write `@fields` and `@expr` together.** It reads as "index this column, by this
> expression", but the expression is the whole key — the `@fields` list was silently
> discarded. It is now refused rather than half-honoured.

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

**Many-to-many (FR-018) — `@through` a junction entity.** Model an M:N link with
`@cardinality: "many"` + `@objectRef` (the target) + **`@through`** (the junction
entity). The junction MUST declare **two `identity.reference` children**, one per FK
side; the relationship's FK fields are **derived** from those references — never
restated. Two optional attrs handle self-joins:

- `@sourceRefField` — names the source-side FK field on the junction, disambiguating a
  **directed** self-join (e.g. `follows`, where both references point at `User`).
- `@symmetric: true` — marks an **undirected** self-join (union-on-read). Valid only
  when `@objectRef` is the declaring entity itself, and **mutually exclusive** with
  `@sourceRefField`.

(Any relationship subtype carries the M:N attrs; the conformance fixtures author them
on `relationship.association`.)

```json
{ "relationship.association": {
    "name": "tags", "@cardinality": "many",
    "@objectRef": "Tag", "@through": "PostTag" } }
```

The `PostTag` junction supplies the FK direction via its two references:

```json
{ "object.entity": { "name": "PostTag", "children": [
    { "field.long": { "name": "id" } },
    { "field.long": { "name": "postId" } },
    { "field.long": { "name": "tagId" } },
    { "identity.primary":   { "name": "id", "@fields": "id" } },
    { "identity.reference": { "name": "postRef", "@fields": "postId", "@references": "Post" } },
    { "identity.reference": { "name": "tagRef",  "@fields": "tagId",  "@references": "Tag" } }
] } }
```

A junction's FK actions are declared on its `identity.reference` children
directly (`"@onDelete": "cascade"` on `postRef`/`tagRef` above) — the M:N
relationship's `@objectRef` names the far side, never the junction, so no
relationship ever correlates with a junction FK (ADR-0047).

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

**Reach for a projection only when one of these is true** (from
`docs/features/source-kinds.md`, which carries the full decision table):

| Entity read-view | Projection |
|---|---|
| extras sit over the entity's **own** table | an independent **exposure contract** |
| same trust domain — a new entity field showing up in the view is correct | a subset, **renamed** columns, versioned, or external consumers |
| the base is still INSERTable and is the record of truth | keyless, multi-base, proc-backed, all-derived, or borrowed identity |

Two things genuinely force a projection: **renamed base columns** (a field carries one
`@column` per paradigm) and **row-filtered views** (soft-delete / `WHERE status='active'`
— an entity read-view exposes the whole entity; only a projection carries a row-scope
`@filter`, #207).

Choosing a projection when a read-view would do costs a second URL, a second type, a
second identity declaration, and re-stating every passthrough column — for no gain.

> Historical note for anyone porting older advice: before 0.17.0 (2026-07-18) an entity
> hosting a derived field silently produced no view and read the wrong table, so a
> projection genuinely WAS the only way to get a grid with a derived column. That is
> fixed; guidance written before then is stale.

A derived read model that IS an independent exposure is an **`object.projection`**
(FR-024): its fields `extends` entity fields (`extends: "Author.id"` — dotted
child traversal, package only on the root segment) and/or carry `origin.*`
children (`passthrough` / `aggregate` / `computed` / `first`)
declaring assembly; its identity passes through via `extends` (`identity.primary:
{ name: id, extends: "Author.id" }`); it is read-only by construction and the
declared field set IS the exposure (fail-closed). Give it a read-only `source.rdb`
`@kind: view` child (`source.rdb: { kind: view, view: v_author }`) — codegen keys
projection detection + view DDL off that read-only source, so without it `meta gen`
emits nothing for the projection.

**The borrowed key may be ANY unique key — including a composite, and including the
entity's `identity.secondary`.** The single-field `extends: "Author.id"` above is the
common case, not the limit. Both of these are legal:

```yaml
# Composite primary → composite primary. @fields is COMPUTED from the local
# pass-through fields, so it is optional here (declare it and it must agree).
- identity.primary: { name: pk, extends: "Order.pk" }      # Order.pk = [tenant, ref]

# A read model keyed on the entity's BUSINESS key, never surfacing its surrogate id.
# Account has both: identity.primary pk (auto-increment id) AND identity.secondary
# byCode (tenant + code). The view exposes tenant + code and borrows byCode.
- identity.primary: { name: pk, extends: "Account.byCode" }
```

The rule is **uniqueness, not nomination**: ADR-0040 put uniqueness in the type, so
`identity.primary` and `identity.secondary` are both unique keys and either can back a
projection's key. `identity.reference` cannot — a foreign key is not unique, so
`identity.primary extends: "Account.ownerRef"` is `ERR_EXTENDS_TARGET_MISMATCH`.

Key correspondence still holds in every case: every field named by the borrowed identity's
`@fields` needs a local field `extends`-ing that entity field, or the load fails with
`ERR_IDENTITY_KEY_MISMATCH` — the identity cannot claim a pass-through the fields do not
make.

**A CONCRETE projection declares its OWN source — never inherits one.** A
projection may `extends` another projection to reuse shape, but the child must
declare its own `source.rdb`; inheriting the parent's is
`ERR_PROJECTION_INHERITED_SOURCE`. `extends` only ADDS fields, so an inherited view
cannot provide the child's extra columns, and two objects would claim one physical
view with different exposures. The sanctioned pattern is an **abstract, sourceless**
projection base carrying shared shape, with each concrete projection declaring its
own view — so a versioned successor (`CustomersV2 extends CustomersV1`) declares
`v_customers_v2` rather than silently sharing V1's view. (Same rule JPA gets from
`@MappedSuperclass` and Django documents as the `db_table`-on-abstract trap; ADR-0028
amendment 2026-08-06.)

**Origin vocabulary (#195).** `origin.aggregate @agg` takes `count`/`sum`/`avg`/`min`/`max`
(numeric reduces over `@of`), `any`/`all` (predicate quantifiers over a `@filter`; `@of`
forbidden; empty set → `any=false`, `all=true`), and `collect` (an array rollup
into an `isArray` field, with optional `@distinct` / `@orderBy`). **`collect` is the one
`@agg` where `@of` is OPTIONAL (#335):** name a column with `@of` to collect scalars, or
omit `@of` on a `field.object @objectRef` to collect each related row as that declared
value object — a **whole-object rollup**, lowered to `jsonb_agg(jsonb_build_object(…))`
on Postgres. The whole-object form requires an explicit `@via`, refuses `@distinct` (it is
a no-op whenever the value object carries the primary key), and requires every value-object
member to match a field on the `@via` **terminal** entity by name, with the same subtype
and array-ness. The declared value object IS the exposure: a field the entity has and the
value object omits is not projected. Any aggregate may be
row-scoped with `@filter`. `origin.computed` carries a closed structured `@expr` tree (a
derived scalar). `origin.first` picks one related row's column (`@of`) along `@via`,
ordered by a **required `@orderBy`** (`["field:asc|desc", …]`, with the PK as tie-break) —
the ordering is what makes `origin.first` express "latest / earliest X"; it may be
row-scoped with `@filter` and is nullable. A field carrying any `origin.*` is derived ⇒
read-only.

`@expr` and `@filter` are **structured objects, not SQL strings** — guessing a string
body fails the load:

- **`@expr`** (on `origin.computed`) is a closed operation tree; a string body is a load
  error (`ERR_BAD_ATTR_VALUE`):
  ```json
  { "origin.computed": { "@expr": { "op": "isNotNull", "arg": { "field": "payloadJson" } } } }
  ```
- **`@filter`** (on `origin.aggregate` / `origin.first`, and object-level on a projection)
  is an `attr.filter` object — a field→predicate map. A bare value is `eq` shorthand; an
  operator map spells the op:
  ```json
  { "origin.aggregate": { "@agg": "any", "@via": "Session.turns", "@filter": { "success": false } } }
  { "@filter": { "status": { "ne": "archived" } } }
  ```

**Projection row-scope `@filter` (#207).** An object-level `@filter` on `object.projection`
(the same `attr.filter` object shown above) scopes the WHOLE view's rows — it lowers to
the view's outer `WHERE`. This is the metadata-managed way to author a soft-delete /
status / type view without hand-writing SQL. It may reference **only declared,
non-aggregate-derived** projection fields: naming an undeclared field fails the load
(`ERR_BAD_ATTR_FILTER`), and so does naming a field whose value comes from an
`origin.aggregate`.

```json
{ "object.projection": { "name": "ActiveOrders",
    "@filter": { "status": { "ne": "archived" } }, "children": [ … ] } }
```

**The `CREATE VIEW` body is generated from those `origin.*` children by the Node
`meta migrate` — never hand-author view SQL for a shape origins can express** (an unmodeled
view is *unmanaged*, so `meta verify --db` can't even catch the drift). For a genuinely
irreducible body (recursive CTE, window function, set operation) that origins can't express,
carry it in the `source.rdb` **`@sql`** escape (#208, ADR-0043) — a hand-written body the
tool registers, fingerprints, and drift-checks (adopt a pre-existing view with
`meta migrate --allow adopt-view`) — rather than a hand-edited migration file where it goes
accidentally unmanaged. For a DB object owned entirely elsewhere (Flyway), mark its source
**`@unmanaged: true`** (view or table); migrate/verify then never touch it.

**`@sql` fail-closed rules — an `@sql` body is a *second* source of truth, so the loader
walls it off (#208).** Author an `@sql` source under these constraints or the load fails:

- `@sql` is legal **only on a read-only `@kind`** (view / materializedView / storedProc /
  tableFunction) — never on a writable `@kind: table` (`ERR_SQL_BODY_ON_WRITABLE_KIND`).
- **No `origin.*`-bearing field may live under an `@sql` host** — the body already *is*
  the derivation, so an origin alongside it is a double-declaration
  (`ERR_ORIGIN_UNDER_SQL_BODY`). If you add an `@sql` body to a projection, **move its
  derived fields out** (into plain declared fields the body computes) rather than keeping
  their `origin.*` children.
- The object-level `@filter` (#207) is **mutually exclusive with `@sql`** (same error) —
  fold the predicate into the `@sql` body's own `WHERE`.
- `@sql` and `@unmanaged` are **mutually exclusive** (`ERR_SQL_BODY_WITH_UNMANAGED`); an
  empty/whitespace `@sql` is rejected (`ERR_BAD_ATTR_VALUE`).
- Under **`@unmanaged`**, an `origin.*`-bearing field only **warns** (the marker acts on
  nothing, so a documented-but-unacted-on lineage is benign) — the asymmetry with `@sql`
  is deliberate.
- Today `meta migrate` **lowers `@sql` only on `@kind: view`**; on matview / storedProc /
  tableFunction it is registered but not yet migrate-managed (mark those `@unmanaged`).

**A `passthrough` field must match its `@from` source's type.** A passthrough
forwards the source value unchanged, so the projection field's `field.<subType>`
and array-ness must be identical to the source field's — a `field.uuid` source
declared as `field.string` on the projection fails load with
`ERR_PASSTHROUGH_TYPE_MISMATCH` (this is exactly the mismodeling that leaves a
view `String`-typed over a `uuid` column and forces hand-written coercion).
Declare the source's type. If the type genuinely must differ on purpose, set
`@convert: true` on the `origin.passthrough` to acknowledge it — an
acknowledgement only, it does **not** generate a cast (you own any coercion).
Nullability may differ (an outer-join view legitimately widens `NOT NULL` →
nullable) — only subType + array-ness are checked.

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
  full chain (it does not flatten inherited members onto the child; see ADR-0039 below).
- **Cross-package** refs use the fully-qualified name (`extends: "shared::auditable"`);
  same-package refs use the bare name.
- An unresolved reference fails with `ERR_UNRESOLVED_SUPER`.

`abstract` and `extends` are **structural keys** (bare, no `@`).

**Extends-inherited properties are real — consume metadata through the resolving
accessors (ADR-0039).** If you write a custom generator or a metamodel provider that
reads this metadata, a concrete field/entity's inherited attributes and members live
on the parent it `extends`, not on the node itself (extends is a super-*reference*, not
a flatten). Always read a property or iterate a member set via the **resolving/effective**
accessor (TS `attr()`/`children()`/`fields()`, Python `attrs().get()`), **never an
`own*()` accessor** — an own-only read silently drops everything inherited via `extends`
and corrupts the generated code. See the `metaobjects-codegen` skill for the full
per-port mapping.

**`overlay` is a different concept.** `extends:` is an IS-A relationship between
two distinct nodes. `overlay: true` re-opens the *same* named node to amend it
across files (same `package` + same `name` → merged; last-writer-wins on attr
conflicts, structural children accumulate). Use `extends` to share shape between
distinct entities; use `overlay` to split one entity's declaration across files.

## Discriminator inheritance (TPH)

When several concrete entities are variants of one thing and should share a
**single table** (table-per-hierarchy / single-table inheritance), model it with a
**discriminator** rather than one table per variant:

- The **base** `object.entity` declares `@discriminator` naming a discriminator
  field — typically a `field.enum` whose `@values` are the subtype tags.
- Each concrete **subtype** `extends` the base and declares `@discriminatorValue`
  (one of those enum members).

All subtypes persist to the base's single table (subtype-only columns fold in
nullable). You author only the metadata; codegen emits the polymorphic surface —
per-subtype routes at `/<base>/<discriminatorValue lowercased>` where create
**injects** the discriminator from the URL, reads/updates/deletes are **scoped** to
the subtype (cross-subtype → 404), and the discriminator is **immutable**.
Supported + conformance-gated in all five ports (the repo's
`docs/features/abstracts-and-inheritance.md` has the full example and per-port
mapping).

```yaml
- object.entity:
    name: Auth                      # TPH base — owns the single `auths` table
    discriminator: type
    children:
      - source.rdb: { table: auths }
      - field.long: { name: id }
      - field.enum: { name: type, values: ["Bridge", "Copay"] }
      - identity.primary: { fields: id }

- object.entity:
    name: BridgeAuth                # subtype — folded into `auths`, tagged type="Bridge"
    extends: Auth
    discriminatorValue: Bridge
    children:
      - field.int: { name: quantity, required: true }
```

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
