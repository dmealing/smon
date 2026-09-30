# Building on a metadata dependency

> Part of the `metaobjects-authoring` skill. Read it when the project declares `dependencies` in `.metaobjects/config.json`, or you extend or overlay a node from another package's snapshot.

**Extending and overlaying a metadata dependency's nodes is the expected way to
build on a shared model.** A project may declare `dependencies` in
`.metaobjects/config.json` and `meta deps sync` a publisher's metadata into a
committed snapshot — that snapshot loads BEFORE your own files, so a foreign
abstract resolves via `extends` and a foreign node re-opens via `overlay: true`
exactly like a local one. Two rules are specific to that boundary:

- **Say `overlay: true` on every amendment to a node you don't own.** Within one
  project the parser merges a same-`(type, package::name)` redeclaration whether
  or not it carries the flag; only the flagged form fails loudly
  (`ERR_OVERLAY_NO_TARGET`) when the target is gone. Skip the flag on a
  dependency's node and its removal upstream silently becomes a new, disconnected
  local object instead of a build failure — always flag a contribution to a node
  you did not declare.
- **A brand-new top-level node declared into a dependency's package is refused**,
  not silently excluded: `ERR_DEPENDENCY_PACKAGE_NOT_OWNED`, naming the object,
  the package, and the fix (declare it in your own package and `extends` the
  dependency's node, or give it that node's exact name with `overlay: true` if you
  meant to amend it). A *local node in your own package* is unaffected — this
  refusal fires only for a package a dependency owns.

What fails when upstream changes (a node removed/renamed, a member's shape
changed) is the loader's existing errors, unchanged — see
`docs/features/metadata-dependencies.md` for the full table and what `meta deps
sync`/`verify --deps` check that the loader cannot.
