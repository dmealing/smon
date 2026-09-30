# Dependency metadata and shared models

> Part of the `metaobjects-codegen` skill. Read it when the project declares `dependencies`, or publishes metadata for another project to consume.

## A dependency's metadata is load-only by default — codegen excludes it

A project may declare `dependencies` in `.metaobjects/config.json` and `meta deps
sync` a publisher's metadata into a committed snapshot (TypeScript + Python,
Phase 1a). That snapshot's nodes load so your own model can resolve against them
(`extends`, `overlay: true`, plain FQN references) — but codegen (and `verify
--codegen`, and the requirements ledger's denominator) **excludes them by
default**. A node is "imported" when its metadata *package* is one a dependency
owns; an imported node is generated only when your own `scope.include` names that
package **literally** (`acme::common::**` or `acme::common::Address` name
`acme::common`; a bare `acme::**` or `**` do not — they match the package's nodes,
which is weaker than naming it). Naming the package in `scope.include` (and, if
you own its tables, `migrate.scope`) is how a consumer takes over a shared model —
the "I instantiate this metadata myself" case, no separate mode needed.

Running `meta gen <Name>` (or a Python `entities: [...]`) on a name that resolves
to nothing but excluded imports is refused by name (exit 2) rather than silently
generating nothing — the message names the dependency and the `scope.include` fix.

## Publishing a shared model: `sharedModelFile()`

The other side of the same feature: `@metaobjectsdev/codegen-ts` ships
`sharedModelFile({ name, include, exclude?, files?, version?, target? })`, a
generator a publisher wires to select a subset of its own metadata (by the same
scope-pattern grammar as `scope`) and emit it as one canonical-JSON artifact +
manifest — the thing a consumer's `meta deps sync` copies. It closure-checks the
selection (every reference from a selected node must resolve to another selected
node, or the build fails naming the pair) and re-loads the emitted artifact with
core providers only, so a Phase 1a export needing non-core vocabulary fails at
publish time. It is registered and shows up in `meta gen --list` like any other
generator — but **it is deliberately not offered by `meta eject --list`** (unlike
the four ADR-0034 scaffold-and-own generators). The artifact is a contract whose
bytes a cross-port corpus pins and whose hash consumers verify; a user-owned,
editable copy would invite an artifact that silently stops matching what
consumers expect. Only TypeScript can run it in Phase 1a. **Phase 1a is TypeScript and Python
only, full stop** — TypeScript and Python are the only two ports that can
*consume* a dependency at all today, and only the TypeScript toolchain can
*publish* one; Java, Kotlin, and C# do not read `dependencies` yet (Phase 2).
Full detail: `docs/features/metadata-dependencies.md`.
