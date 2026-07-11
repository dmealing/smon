# smon

[![CI](https://github.com/dmealing/smon/actions/workflows/ci.yml/badge.svg)](https://github.com/dmealing/smon/actions/workflows/ci.yml)

`smon` is a system monitor rewritten from a collection of bash scripts into a typed
TypeScript project. Its domain model — probes, verdicts, alert payloads, email
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

### Add a notify backend in one declaration

Every notify adapter — email, a push service, a chat webhook, a heartbeat sink — starts
as a single `adapter.notify` node in `metaobjects/meta.notify.json`. For example, this
is the entire declaration behind the `Matrix` chat adapter:

```json
{
  "adapter.notify": {
    "name": "Matrix",
    "@kind": "chat",
    "@payloadRef": "AlertPayload",
    "@digestPayloadRef": "DigestPayload",
    "@requiredConfig": ["SMON_MATRIX_HOMESERVER", "SMON_MATRIX_TOKEN", "SMON_MATRIX_ROOM"]
  }
}
```

Adding a new one is the same shape — declare the adapter's `@kind`, which payload(s) it
sends, and which env vars it needs, then run `bun run gen`:

- **Validators check it.** `meta verify` / `meta gen` enforce that `@payloadRef` (and
  `@digestPayloadRef`, for adapters that also send the daily digest) resolves to a real
  `object.value`, and — for `@kind: "email"` — that `@alertTemplateRef`/
  `@digestTemplateRef` point at a `template.output @kind=email` whose mustache
  variables actually exist on the payload (`ERR_SMON_TEMPLATE_PAYLOAD_MISMATCH` /
  `ERR_VAR_NOT_ON_PAYLOAD`). A typo or a mismatched payload fails codegen, not
  production.
- **Codegen emits the typed registry.** `src/generated/notify/registry.data.ts` gains a
  new `ADAPTERS[name]` entry (kind, payload/template refs, required/optional config
  keys) and `missingAdapterConfig()` picks it up automatically — that's what powers
  `smon --list-adapters`' STATUS column.
- **Codegen emits the docs.** `docs/generated/monitoring.md`'s adapter table gets a new
  row, generated from the same metadata — the reference docs can't drift from the model.

The one hand-written step is the transport itself: add `src/notify/impl/<name>.ts`
satisfying `NotifyAdapter<Payload[, Digest]>` and wire it into `src/notify/registry.ts`.
The `satisfies` pin against the *generated* payload type means that if the payload's
shape ever changes, the new adapter's implementation fails to typecheck instead of
silently shipping a stale shape.

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

## Development

Install dependencies:

```bash
bun install
```

Generate code from the metadata model (regenerates `src/generated/*` and
`docs/generated/*`):

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

Build a standalone CLI bundle (`dist/smon.js`, targeting node runtime semantics):

```bash
bun run build
```

All four commands are the exact sequence [CI](.github/workflows/ci.yml) runs on every
push and pull request — see that workflow's header comment for why `gen` (with a
clean-tree assertion) and `verify` are both required rather than redundant.

## Usage

`smon` is invoked with at most one verb. With no arguments it runs a full sweep
(configured probes → policy decision → notify dispatch → state persistence →
heartbeat):

```bash
node dist/smon.js                    # run a sweep
node dist/smon.js --dry-run          # sweep, but skip notify dispatch/state writes
node dist/smon.js --once <probe>     # run a single probe by name, outside the roster
node dist/smon.js --test-alert       # fire a synthetic alert through every configured adapter
node dist/smon.js --list-adapters    # introspect the notify adapter registry
node dist/smon.js --list-probes      # introspect the probe roster
```

Configuration is entirely environment-driven (`SMON_PROBES`, `SMON_NOTIFY`, per-adapter
secrets, quiet hours, etc.) — see `src/config.ts` for the full, typed list of knobs and
their defaults; a missing/misspelled adapter or probe name in `SMON_*` fails config
loading immediately rather than silently no-opping.

`--list-adapters` and `--list-probes` are introspection surfaces generated straight from
the metadata model (no bash equivalent) — useful for checking what a given environment
actually has configured before it runs:

```
$ node dist/smon.js --list-adapters
ADAPTER  KIND       STATUS
email    email      missing: SMON_EMAIL_TO
ha-push  push       missing: SMON_HA_URL, SMON_HA_TOKEN, SMON_HA_DEVICE
kuma     heartbeat  missing: SMON_KUMA_PUSH_URL
matrix   chat       missing: SMON_MATRIX_HOMESERVER, SMON_MATRIX_TOKEN, SMON_MATRIX_ROOM
stdout   stdout     configured

$ node dist/smon.js --list-probes
PROBE           TAGS
disk-report     DISK_CRITICAL, DISK_HIGH, NOMINAL, PROBE_FAILED
docker-hygiene  CLEAN, DAEMON_DOWN, NO_DOCKER, RECLAIMABLE
log-triage      FAILED_SERVICES, LOG_ERRORS, NOMINAL
...
```

The same two tables, generated from the same metadata, are published as reference docs:

- **Generated monitoring reference:** [`docs/generated/monitoring.md`](docs/generated/monitoring.md)

## Status

The domain model (probes, verdicts, alert/digest payloads, email templates, notify
adapters), the parser/runner, the alert-policy state machine, notify adapter
implementations, LLM enrichment, config/state handling, and the CLI are implemented and
covered by the parity-oracle test suite (bash-behavior-equivalence cases plus regression
cases for bugs found along the way). Deployment tooling (installing `dist/smon.js` on a
host, per-host configuration, and retiring the legacy bash implementation it's ported
from) is out of scope for this repository and tracked separately.
