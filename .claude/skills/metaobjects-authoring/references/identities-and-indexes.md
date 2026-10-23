# Identities and indexes

## Contents
- Identities
- Indexes (non-unique)

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
the Relationships section of `SKILL.md` — the subtype carries the default), but `identity.reference`
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
