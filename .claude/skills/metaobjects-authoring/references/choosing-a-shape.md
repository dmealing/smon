# Choosing the right shape — the decision procedure, and subtype rules in detail

> Part of the `metaobjects-authoring` skill. Read it when no row of the skill's "Canonical form for common field needs" table fits, when you need the full rule behind a row (UUID, timestamps, URIs/IPs, `@autoSet`, validated strings), or when you are registering vocabulary of your own.

## The decision procedure (ADR-0037)

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

## Subtype rules in detail

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
existing codebase" (`adopting-existing-code.md`).

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

## Extending the metamodel — custom providers, and the downstream lifecycle

The decision procedure at the top of this file governs new vocabulary you register — apply it
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
