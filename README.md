# smon

`smon` is a system monitor being rewritten from a collection of bash scripts into a
typed TypeScript project. Its domain model — probes, verdicts, alert payloads, email
templates, and notification adapters — is declared as typed metadata using the
[MetaObjects](https://github.com/metaobjectsdev) toolchain, and the runtime code
(schemas, types, generated glue) is generated from that model rather than hand-written.

## Why metadata-first

Instead of scattering the shape of a "probe result" or "alert" across bash variables,
ad-hoc JSON, and string templates, `smon` declares each concept once as metadata under
`metaobjects/`. Code generation (`meta gen`) turns that declaration into typed TypeScript
— entities, validators, and supporting glue — so the domain model and the code that
implements it can never silently drift apart. `meta verify` checks that generated output
still matches the metadata, catching drift before it ships.

## Verdict contract

`smon` consumes the public verdict contract published in the
[`small-model-skills`](https://github.com/dmealing/small-model-skills) project:

- **Verdict contract:** https://github.com/dmealing/small-model-skills/blob/main/docs/verdict-contract.md

Probes in `smon` emit verdicts that conform to this shared contract, so other tools that
speak the same contract can consume `smon`'s output without bespoke glue.

## Adapter / extensibility showcase

A goal of this rewrite is to make `smon` a small showcase of adapter-style
extensibility: a probe emits a verdict; a notify adapter turns a verdict into an
outbound action (email, chat message, webhook, etc.). New probes and new notify
adapters should be addable independently, without touching each other, by adding new
metadata and regenerating.

## Project layout

- `metaobjects/` — the typed metadata that describes `smon`'s domain (probes,
  verdicts, alert payloads, email templates, notify adapters). This is the durable
  source of truth.
- `codegen/generators/` — the codegen generators that turn metadata into TypeScript.
  Scaffolded by `meta init` and owned by this repo (see the header comment in each
  generator file).
- `src/` — hand-written application code (probes, adapters, CLI entrypoint) plus
  generated output.
- `metaobjects.config.ts` — codegen configuration (output directory, generators,
  docs settings).

## Running

Install dependencies:

```bash
bun install
```

Generate code from the metadata model:

```bash
bun run gen
```

Check that generated code hasn't drifted from the metadata:

```bash
bun run verify
```

Run tests:

```bash
bun test
```

Build a standalone CLI binary:

```bash
bun run build
```

## Status

This repository currently holds the toolchain scaffold only — no domain model has
been authored yet. Probes, verdicts, alert payloads, and notify adapters will be
added as metadata in follow-up work.
