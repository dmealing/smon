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

| Subtype | Use | Extra attrs |
|---|---|---|
| `template.prompt` | LLM-targeted | `@maxTokens`, `@requiredSlots`, `@model` |
| `template.output` | email / docs / config / export | (generic only) |

Both carry the generic attrs:

| Attr | Required | Purpose |
|---|---|---|
| `@payloadRef` | yes | the `object.value` declaring the payload shape |
| `@textRef` | yes | the 2-layer logical text reference `group/source`, resolved by a provider |
| `@format` | no | `text` (default) / `html` / `xml` / `csv` / `json` / `markdown` / `spreadsheet` — drives the escaper |
| `@maxChars` | no | build-time size budget |

## The payload is an `object.value` projection

The payload is **not** an entity — it's an `object.value` whose every field carries
an `origin.*` child saying where its value comes from. Three origin subtypes:

| Origin | Behavior |
|---|---|
| `origin.passthrough @from "Entity.field"` | payload property matches the source field |
| `origin.aggregate @agg <count\|sum\|avg\|min\|max>` | `count`→long, `avg`→double, others match source |
| `origin.collection @via "Parent.rel"` | a list of a nested payload, assembled from a relationship |

Declaring the payload as a projection is what makes payload bloat visible: adding a
field to the prompt is a diff on the `object.value`, and a renamed source field
breaks the build instead of silently degrading the prompt.

```json
{
  "metadata.root": {
    "package": "acme::blog",
    "children": [
      {
        "object.value": {
          "name": "WelcomePayload",
          "children": [
            { "field.string": { "name": "displayName",
              "children": [ { "origin.passthrough": { "@from": "Author.name" } } ] } },
            { "field.long": { "name": "postCount",
              "children": [ { "origin.aggregate": { "@agg": "count", "@of": "Post.id", "@via": "Author.posts" } } ] } },
            { "field.object": { "name": "posts", "@objectRef": "PostSummary",
              "children": [ { "origin.collection": { "@via": "Author.posts" } } ] } }
          ]
        }
      },
      {
        "object.value": {
          "name": "PostSummary",
          "children": [
            { "field.string": { "name": "title",
              "children": [ { "origin.passthrough": { "@from": "Post.title" } } ] } }
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
and `template.output` nodes the same way.

## `template.output` also generates a parser-on-receipt

For every `template.output`, codegen emits a **typed parser** that turns an LLM/raw
response back into the `@payloadRef` value-object — the reverse direction, reusing
the same payload VO (no new authoring). Each port emits it idiomatically: a
throw-on-invalid parse plus, where the language has the precedent, a Result-style
"safe" variant that doesn't throw. The parser file is a companion to the payload-VO
file; `verify` catches payload-VO ↔ parser drift at build time too.

The three-step consumer pattern is identical everywhere: render the prompt → call
your LLM client → parse the response with the generated parser.

---

For this project's server-language parser specifics, read every `references/*.md` file in this skill's directory (one per server language in this project's stack).
