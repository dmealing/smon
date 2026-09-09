---
name: metaobjects-prompts
description: Use when declaring or using MetaObjects prompt construction — template.prompt/template.output, typed payload projections, provider-resolved text, deterministic render, prompt-drift verify, and parser-on-receipt.
---

# MetaObjects prompt construction

The fourth pillar: **a prompt is code, not a string scattered across services.**
Declare a prompt's payload as a typed projection (payload bloat becomes a diff),
keep its text external and provider-resolved, and render it deterministically —
snapshot-testable, cache-stable, and drift-checked at build time. The same
machinery renders any text artifact: emails, exports, docs, `llms.txt`.

This skill is port-agnostic. The exact render/parse API for *this* project's server
language lives in a reference fragment (pointed to at the bottom).

## The two template subtypes

A **template** is a typed pair: a logical reference to external text + a payload
value-object declaring exactly what data the text expects.

A template subtype's axis is **DIRECTION** — which way the text travels, not what it
is about (ADR-0052).

| Subtype | Direction | Use | Extra attrs |
|---|---|---|---|
| `template.prompt` | outbound, and optionally inbound | LLM-targeted | `@maxTokens`, `@requiredSlots`, `@requiredTags`, `@model`, `@responseRef`, `@responseFormat`, `@promptStyle` |
| `template.output` | outbound ONLY | email / docs / config / export | `@kind: document \| email` (default `document`), `@requiredTags`; `@kind: email` adds `@subjectRef` / `@htmlBodyRef` / `@textBodyRef` |

Both carry the generic attrs:

| Attr | Required | Purpose |
|---|---|---|
| `@payloadRef` | yes | the `object.value` — or sourceless `object.projection` (#210) — declaring the payload shape |
| `@textRef` | yes for `template.prompt` and a `template.output @kind: document` (the default) — a `template.output @kind: email` carries **no** `@textRef`; it uses `@subjectRef` + `@htmlBodyRef` (+ optional `@textBodyRef`) instead | the 2-layer logical text reference `group/source`, resolved by a provider |
| `@format` | no | `text` (default) / `html` / `xml` / `csv` / `json` / `markdown` / `spreadsheet` — drives the escaper |
| `@maxChars` | no | build-time size budget |

`template.output @kind: email` renders a structured `EmailDocument` (subject + HTML
body + optional plain-text body) instead of one string — the TS render helper emits
an `EmailDocument`-returning function for it (see the `render-example-email`
conformance fixture). `@requiredTags` names output tags the rendered text must contain
(`verify` checks it) on both subtypes.

**The INBOUND half belongs to `template.prompt` alone.** `@responseRef` names the
response shape (an `object.value` or sourceless `object.projection`, #210) a model's
reply is parsed into, and its PRESENCE is what asks for the whole inbound tier: the
response record, the response-format fragment, the parser-on-receipt and the tolerant
extractor. `@responseFormat` (`json` default / `xml`, ADR-0053) is the syntax of that
REPLY; `@promptStyle` (`guide` / `inline` / `exampleOnly`, FR-010) selects how the
fragment presents the shape.

> **`@format` and `@responseFormat` are different facts.** `@format` is the syntax of
> the BODY you render; `@responseFormat` is the syntax of the answer you expect. A
> plain-text prompt asking for a JSON object is the common case. Putting `@promptStyle`
> or `@responseFormat` on a `template.output` is a LOAD ERROR — an output renders a
> document and nothing reads a reply to it.

A third, structurally different subtype is also registered core vocabulary:
**`template.toolcall`** (`@toolName` + `@payloadRef`, ADR-0011) — a vendor-agnostic
LLM tool-call envelope with no renderable text body (the body IS the
`@payloadRef`-typed output schema, so it does not carry the generic `@textRef`/
`@format` attrs above). The vocabulary exists today; MCP exposure of declared
prompts/tools is roadmap, not shipped — don't promise it.

## The payload is a shape you declare — an `object.value`, or a sourceless `object.projection`

The payload is **not** an entity — it's a declared shape whose fields ARE the
prompt's typed surface: an `object.value` (caller-supplied fields;
`origin.passthrough` only — FR-015 parameter lineage), or a **sourceless
`object.projection`** (#210 — no `source.*` child, own or inherited) when fields
derive by assembly. Every port's payload codegen is
**declared-type-authoritative (#270)**: a field's generated type comes only from its
declared `field.<subType>` + `isArray` + `@objectRef`, and a nested payload is a
declared `field.object @objectRef` to another `object.value` (`isArray: true` for a
list — nested targets stay value-only, loader-enforced). The caller supplies the
field values at render time. An `origin.*` child on a payload field is IGNORED for
typing — and the assembly origins (`aggregate` / `computed` /
`first`) are ILLEGAL on an `object.value` host (`ERR_SUBTYPE_RULE_VIOLATION`, #210):
an origin-derived payload lives on the sourceless projection, which `@payloadRef`
accepts. Projections generally are covered by the `metaobjects-authoring` skill and
`docs/features/source-kinds.md`, not here.

Declaring the payload shape is what makes payload bloat visible: adding a field to
the prompt is a diff on the declared shape, and `verify` catches template/payload
drift at build time instead of letting a prompt silently degrade.

```json
{
  "metadata.root": {
    "package": "acme::blog",
    "children": [
      {
        "object.value": {
          "name": "WelcomePayload",
          "children": [
            { "field.string": { "name": "displayName" } },
            { "field.long": { "name": "postCount" } },
            { "field.object": { "name": "posts", "@objectRef": "PostSummary",
              "isArray": true } }
          ]
        }
      },
      {
        "object.value": {
          "name": "PostSummary",
          "children": [
            { "field.string": { "name": "title" } }
          ]
        }
      },
      {
        "template.prompt": {
          "name": "WelcomePrompt",
          "@payloadRef": "WelcomePayload",
          "@textRef": "lobby/welcome",
          "@format": "xml",
          "@maxTokens": 500
        }
      }
    ]
  }
}
```

## Prompt text is external + provider-resolved (never inlined)

`@textRef` is a 2-layer logical reference `group/source` (folder/file,
table/key, collection/document). The prompt text itself **never lives in
metadata** — at runtime a configured **provider** resolves the reference to the
actual Mustache text:

- a filesystem provider (L1 = folder, L2 = file) — the dev default;
- an in-memory provider (a string map) — tests;
- a classpath/resource provider on the JVM;
- or a consumer-supplied provider (RDB / vector store / …).

Locale, A/B, dynamic, and evolutionary prompt variants all live behind the
provider seam without touching metadata.

## `render()` is deterministic + byte-stable

Rendering is a pure function: `(payload VO, resolved text) → string`. Same inputs,
byte-identical output — across runs and across every language port. That stability
is what protects **exact-prefix prompt-cache hits**: a stray whitespace change can't
silently break a cache prefix because the output doesn't drift. Determinism rules
the engine enforces:

- arrays only for iteration (no object-key iteration);
- no locale/number/date formatting in the engine — pre-format on the payload;
- pinned trailing-newline + Mustache standalone-tag whitespace;
- `@format` drives an engine-owned escaper (CSV/spreadsheet escapers neutralize a
  leading `= + - @ \t \r` per the OWASP CSV-injection guard).

For the `xml`-format example above with payload `{ displayName: "Ada", postCount:
12, posts: [{title:"Hello"}, {title:"Mustache"}] }`, every port renders the same
bytes. You render the prompt, call your LLM client (provider-agnostic — codegen
emits no provider-side schema), then parse the response.

## Conditional content: data and flags, never branched prose

When a prompt's wording varies along some dimension — audience, tier, mode,
locale, entitlement, a domain variant — do NOT branch the prose in code and
concatenate strings. Branching prompt text in a service is the anti-pattern this
pillar exists to remove: it scatters the same distinction across call sites, each
re-encoded and free to drift, and none of it snapshot-tested. The variation
belongs in exactly two places, with a third for the rare genuine divergence:

- **Vocabulary as payload data.** The words and values that differ become typed
  payload fields, pre-computed once from the varying dimension — a noun, a label,
  a set of verbs (a list), an example. The template stays single and references
  `{{term}}` / `{{#items}}…{{/items}}`. The prose *structure* is identical across
  variants; only the data differs, so there is nothing to branch.
- **Presence as boolean flags.** When a whole block exists-or-not for a variant,
  gate it with a section flag the payload sets: `{{#showBlock}}…{{/showBlock}}`.
  Reserve flags for entire blocks — never mid-sentence word swaps, which are
  vocabulary.
- **Variant text only when prose truly diverges.** If a section's wording — not
  just its vocabulary — genuinely differs, select a per-variant text through the
  provider seam (a `@textRef` variant, or an included partial) so the shared
  prose still lives in one place. Expect to need this rarely.

A single resolver maps the varying dimension to that payload (the flags + the
vocabulary), so the distinction is defined ONCE and every template that depends
on it stays consistent.

```
// WRONG — prose branched and concatenated in a service:
if (tier.isPremium()) sb.append("Your plan includes priority support.");
else                  sb.append("Upgrade any time for priority support.");
```
```mustache
{{! RIGHT — text in the template; the variant is data + a flag }}
{{supportLine}}
{{#isPremium}}(Priority queue enabled.){{/isPremium}}
```

This stays deterministic and golden-testable per variant: render the template
against each value of the dimension and snapshot every variant.

## `verify` fails the build on prompt-drift

For every template, the verify step resolves the text, parses each `{{...}}`
reference, and checks it exists on the payload VO. If the text references
`{{authorName}}` but the payload only has `displayName`, **the build fails.** This
is the prompt-vs-payload drift gate — run it in CI. It walks both `template.prompt`
and `template.output` nodes the same way (both RENDER; only the direction of what comes
back differs).

## A RESPONDING `template.prompt` generates a parser-on-receipt

For every `template.prompt` declaring `@responseRef`, codegen emits a **typed parser**
that turns a model's reply back into that shape. It binds `@responseRef`, never
`@payloadRef` — `@payloadRef` types the request the prompt renders outbound, and the
question and the answer are usually different shapes. Each port emits the parser
idiomatically: a throw-on-invalid parse plus, where the language has the precedent, a
Result-style "safe" variant that doesn't throw.

**A `template.output` gets no parser, ever.** Nothing reads a reply to a document. (Before
ADR-0052 it did, with no format filter at all — so an `@format: markdown` document got a
generated `JSON.parse` over rendered prose.)

The strict tier is JSON-only: an `@responseFormat: xml` reply gets the tolerant extract
and nothing strict, because strict all-or-nothing semantics layered over a REPAIRING XML
reader would raise or accept based on how much repair happened.

The three-step consumer pattern is identical everywhere: render the prompt → call
your LLM client → parse the reply with the generated parser.

## A RESPONDING `template.prompt` generates the response-format fragment (FR-010)

For every `template.prompt` whose `@responseRef` resolves, codegen additionally emits a
`render<Name>Format(...)`-shaped function backed by the render engine's output-format
renderer — the "produce your answer like this" instruction fragment you splice into the
prompt text so the model returns exactly the shape the parser above expects. The gate is
`@responseRef` PRESENCE, not a format value: the old `@format ∈ {json,xml}` gate read the
syntax of the OUTBOUND body to decide whether to instruct the model about the syntax of
its REPLY, so a text-bodied prompt asking for a JSON answer got no fragment at all.
`@responseFormat` selects which syntax the fragment teaches; the fragment and the
extractor agree on the same root name.

`@promptStyle` on the `template.prompt` controls the fragment's presentation
(default `guide`):

| `@promptStyle` | Presentation |
|---|---|
| `guide` (default) | a prose field list ("Fill in each field…") followed by an example skeleton |
| `inline` | a single skeleton whose field values are inline placeholders / enum choices |
| `exampleOnly` | just a filled example skeleton, nothing else |

Guidance is **never** emitted as code comments — models routinely ignore comments,
so the instruction has to live in the rendered text itself.

The fragment is **baked directly from the payload's field tree at codegen time**
(not hand-authored Mustache text), so it cannot itself drift out of sync with the
payload the way a hand-written `@textRef` can — regenerating it after a payload
change is the gate. The JVM render module (Java, shared by Kotlin) additionally
exposes a field-presence check, `Verify.checkOutputPrompt(fragment,
requiredFieldNames)`, for asserting a *rendered instance* of the fragment actually
names every required field — useful in a test of the renderer output itself,
distinct from the `{{field}}`-vs-payload drift check `verify` runs on hand-authored
template text. Check the language reference for whether this project's port ships
the equivalent.

---

For this project's server-language parser + output-format-fragment specifics, read
every `references/*.md` file in this skill's directory (one per server language in
this project's stack).
