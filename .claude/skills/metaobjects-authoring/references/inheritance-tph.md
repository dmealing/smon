# Discriminator inheritance (TPH)

> Part of the `metaobjects-authoring` skill. Read it when several entities are variants of one thing sharing a single table.

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
