# Relationships — many-to-many and reverse navigation

> Part of the `metaobjects-authoring` skill. Read it for an M:N link, a self-join, or before writing any "find the rows that reference this one" query.

## Many-to-many (FR-018)

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

## Reverse navigation is generated (ADR-0038)

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
