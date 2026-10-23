# Abstracts, `extends` and `overlay`

## Contents
- Abstracts + `extends` (deferred resolution) + `overlay`

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
  same-package refs use the bare name. A bare name looks in the declaring file's own
  package, then at the root, and never binds an object in another package. `::Name`
  names a root-level object even when the package has one of the same name; `..::Name`
  names one in the parent package. The forms mean the same in YAML and JSON (ADR-0059),
  and a loaded or exported model carries every reference fully qualified.
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
