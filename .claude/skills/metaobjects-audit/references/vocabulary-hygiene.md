# Vocabulary hygiene / modernization (axis I — advisory)

## Contents
- Already-retired / deprecated forms
- Custom-provider vocabulary
- Hand-rolled reverse-query repository methods
- New-vocabulary opportunity (the inverse hunt)

Per ADR-0037, vocabulary expansion follows ONE ordered test (derivable → derive;
physical-only → `@dbColumnType`; logical: different native type → subtype, same kind +
modifier → attribute). This axis surfaces authoring that predates or contradicts that
framework. **All findings here are advisory** — modernization opportunities scored as
such, surfaced in the roadmap, but **non-failing** (the code works; the form is dated).

**Already-retired / deprecated forms → recommend the canonical form:**

- `@dbColumnType: uuid_array` / `@dbColumnType: text_array` (a physical array column
  type) → **`isArray: true`** on the base subtype. Array-ness is logical and derivable;
  the array column type is retired.
- The `@kind: text` hack (forcing text via a kind override) → **bare `field.string`**
  (text is the default; no override needed).
- `@dbColumnType: uuid_array` was covered above. **`field.string` + `@dbColumnType: uuid`
  is NOT advisory — it is a real mismodeling finding (see axis H).** It generates a `String`
  where the code uses/wants a native `UUID`, forcing `String↔UUID` coercions at every
  boundary; `verify --db` passes (the column really is uuid), so the schema gate can't see it.
  The genuine string-over-uuid-column case (code truly handles the value as text) is the ONE
  legitimate use and must be explicitly justified — otherwise recommend **`field.uuid`**.
- `@dbColumnType: timestamp_with_tz` (ADR-0036 Wave 2) → **drop it.** `field.timestamp` is
  instant / timezone-aware **by default** now; the `timestamp_with_tz` column-type override
  is **retired**. Timezone-awareness lives in `field.timestamp` + the `@localTime` opt-out.
- A bare `field.timestamp` that is **semantically a wall-clock value** (a store-open time, a
  birthday-with-time, a recurring local schedule) → recommend **`@localTime: true`** (naive
  `timestamp without time zone`), or confirm it is genuinely meant to be an instant. Default
  `field.timestamp` is an instant; only flag when the field's meaning is clearly wall-clock.
- A `validator.regex` (or a plain `field.string`) validating an **email** shape → recommend
  **`@stringFormat: email`** on the `field.string` (ADR-0036 Wave 3). The native type stays
  `string`; the per-port codegen emits the idiomatic email check — don't hand-roll the regex.
- A `field.string` that **holds a URL / URI** → recommend **`field.uri`** (native `URI`/`Uri`,
  URL validation) — a distinct native type + behavior is a subtype, not a validated string.
- A `field.string` that **holds an IP address** → recommend **`field.inet`** (native IP type;
  Postgres `inet` column).

**Custom-provider vocabulary (adopters who register their own types/attrs):** check
new/custom vocab against the ADR-0037 procedure (advisory) — e.g. *a custom subtype
that differs from an existing one only by a property should be an attribute, not a
subtype*; an email/hostname string-validation is an **attribute** (`@stringFormat`,
native type unchanged), while a URL or IP is a **native type** (`field.uri` /
`field.inet`, a subtype). Recommend re-shaping against the ordered test.

**Hand-rolled reverse-query repository methods (ADR-0038) → recommend the generated reverse
FK finder.** Reverse navigation — *"find all the rows that reference this one"* — is now
codegen. Flag a hand-written reverse-query method (a `findByParentId` / `findBy<Parent>`
repository finder, or a manual `WHERE fk = ?` query helper — exactly what a JVM adopter
hand-writes in its `SceneRepository`) and recommend the **generated reverse FK finder**
instead: codegen now emits `find<Source>By<FkField>` plus a batched `…In(ids)` variant from
the FK metadata, idiomatic per port (Spring repository finder / EF query method / Python or
TS query function). It is **performant** (one indexed query, no N+1) and **framework-free**
(no lazy collections / proxies). When an entity has two FKs to the same target, the codegen
emits two distinct finders (named by the FK field) automatically — no annotation needed; the
reverse finder is a **codegen feature, not an attribute** (there is no reverse-nav `@`-attr
to author). Advisory severity — a modernization opportunity, not a failing finding.

**New-vocabulary OPPORTUNITY (the inverse hunt — advisory).** The checks above audit
custom vocabulary the adopter *already* registered; this one hunts where the app
**should** register vocabulary but hand-coded the pattern instead. Smells
(grep-then-verify; require a *recurring, closed* set — never flag a one-off):
- **N parallel hand-written integration modules** sharing a payload shape and a config
  pattern (a closed set of channels / providers / export targets, each a near-copy with
  a different transport) → candidate for ONE project-registered subtype whose variants
  sit behind a closed structural-variant discriminator (the `source.rdb` `@kind`
  pattern), plus a small owned generator emitting the per-variant wiring.
- **An ad-hoc string discriminator steering code switches** — a string column whose
  values select per-variant behavior/config scattered across the codebase. If the values
  are just a closed symbol set, that is `field.enum` (`@values`), NOT new vocabulary. It
  earns a subtype only when the discriminated concept **owns behavior or attributes of
  its own** (ADR-0037 step 2a).
- **A provider-shaped pattern re-implemented per instance** — repeated registration /
  config blocks restating a shape one declared node per instance could carry, with codegen
  emitting the repetition.
- **A downstream integration modeled entirely in code** (an outbound webhook / notifier /
  queue publisher / tool wiring beyond `template.toolcall`) where registered vocabulary +
  a small generator would own the payload wiring, the names-only fail-closed config check,
  and drift detection.

Run the **ADR-0037 ordered test** before proposing: derivable → derive; differs from an
existing subtype only by a property → an attribute; a plain validated value → an
attribute; one-off author-supplied properties → the `attr.properties` bag. Only a concept
with its own behavior/attributes earns a subtype, and transport/protocol is never the
subtype axis (keep the node protocol- and address-free; variants behind the discriminator).
**Converge before inventing** — check shipped vocabulary AND the planned/chartered names
(see `calibration.md`, "Planned, not shipped"); never claim a chartered name for a project-local
type. **Recommendation:** propose a project-registered provider (explicit loader wiring,
ADR-0023 — never a loosened `strict` free-ride), a `metadata_sketch` of the node, and the
owned generator that retires the duplication; a second independent consumer needing the
same concept is a consumer→core promotion candidate (ADR-0011 — file an upstream issue).
**Verdict: VOCAB CANDIDATE (advisory)** — a modeling opportunity, never a failing finding,
never a tier gate; bias to under-flagging (the >15% false-positive kill criterion applies
with full force). Full guidance: `docs/features/downstream-metadata-decisions.md`.
