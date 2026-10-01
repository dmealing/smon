# TypeScript parser-on-receipt

For every RESPONDING `template.prompt` in your metadata — one declaring
`@responseRef` — the `outputParser()` generator (from
`@metaobjectsdev/codegen-ts/generators`) emits a **typed parser** that validates a
model's reply against that shape. ADR-0052: the tier binds `@responseRef`, never
`@payloadRef` (which types the request the prompt renders outbound), and a
`template.output` gets no parser at all. This is the receive side; codegen emits **no**
provider/LLM-call layer — you compose the call yourself.

## Contents
- Wire the generator
- What it emits
- The response-format prompt fragment (FR-010)
- The three-step consumer pattern
- Recommended LLM caller (bring-your-own)
- Drift gate
- See which fields a template consumes

## Wire the generator

```ts
// metaobjects.config.ts
import { defineConfig } from "@metaobjectsdev/cli";
// `meta init` scaffolds ./codegen/generators/ EMPTY (ADR-0034 Amendment 2). The entity
// generators arrive by `meta eject entity queries barrel`, which copies each into that
// directory as a file you own and prints the import to add — these three lines. They
// have no package import: the old `@metaobjectsdev/codegen-ts/generators` re-export of
// them was removed at 1.0. The parser's reply type is the @responseRef value object's
// own interface, which `entity` emits, so `entity` has to be in the run.
import { entityFile } from "./codegen/generators/entity.js";
import { queriesFile } from "./codegen/generators/queries.js";
import { barrel } from "./codegen/generators/barrel.js";
// promptRender / outputParser can be imported from the package (below) OR owned:
// `meta eject prompt-render output-parser` copies them into ./codegen/generators/ the
// same way. Either way the render and parse ENGINES they call stay in the package.
import { promptRender, outputParser } from "@metaobjectsdev/codegen-ts/generators";

export default defineConfig({
  outDir: "src/generated",
  generators: [
    entityFile(), queriesFile(), barrel(),
    promptRender(),    // render<Name>() per template.prompt (the send side)
    outputParser(),    // parse*/safeParse* per responding template.prompt (the receive side)
  ],
});
```

`outputParser({ outDir: "src/generated/outputs", target: "default" })` are the
options.

## What it emits

Per responding `template.prompt` (say named `NpcReview`, `@responseRef:
"NpcResponse"`), `meta gen` writes `NpcReview.response.ts` with a Zod schema + a dual
API, named after the TEMPLATE. The strict tier is JSON-only — an `@responseFormat: xml`
reply gets the tolerant `extract` and no `parse`/`safeParse`:

```ts
import { z } from "zod";
import type { NpcResponse } from "./NpcResponse.js";   // the value object's own interface (entityFile)

const NpcReviewSchema = z.object({
  name: z.string(),
  level: z.number().int(),
  role: z.enum(["tank", "healer", "dps"]),   // field.enum → its declared members
  notes: z.string().optional(),              // not @required → .optional()
});

export type NpcReviewValidationError = z.ZodError;

/** Throws ZodError on bad input. */
export function parseNpcReview(text: string): NpcResponse { /* ... */ }

/** Result-style; never throws. */
export function safeParseNpcReview(text: string):
  | { success: true; data: NpcResponse }
  | { success: false; error: NpcReviewValidationError } { /* ... */ }
```

The dual API mirrors Zod's idiomatic shape: `parse*` throws a `ZodError`,
`safeParse*` returns a discriminated union. Both return the `@responseRef` value
object's OWN interface — the one `entityFile()` declares in `NpcResponse.ts` (ADR-0056)
— so the parser declares no type of its own. `parse*` / `safeParse*` expect the reply to
BE the JSON document; a raw chat reply — `Sure!` followed by a fenced JSON block — fails
them with `invalid JSON: Unexpected token 'S'…`. For a raw reply the same file exports the
tolerant tier:

```ts
import { extractLenientNpcReviewWithLoader } from "./generated/NpcReview.response.js";
import { MetaDataLoader } from "@metaobjectsdev/metadata";
import { orThrow } from "@metaobjectsdev/render";

const { root } = await MetaDataLoader.fromDirectory("./metaobjects"); // load once at startup
const result = extractLenientNpcReviewWithLoader(root, reply);    // strips prose + fences
result.report;              // per field: recovered / defaulted / lost / malformed
const npc = orThrow(result); // opt-in: throws ExtractError if a @required field was lost
```

It reads the live metadata, so it takes a loaded `MetaRoot`; there is no text-only
`extractLenientNpcReview(text)`. A bad reply never throws — it is classified in `report`
and `data` holds what was recovered (every field of the `<Vo>Extracted` mirror is
nullable). It throws only when `root` does not declare the response value object, which is
a setup error.

Wiring the `extractor` generator as well adds `<Name>.extractor.ts` with two more entry
points over the same call: `extract<Name>(root, text)` returns the strict response type and
throws when a `@required` field is lost or malformed, and `extractLenient<Name>(root, text)`
re-exports the tolerant call above. `extractLenient<Name>WithLoader` itself is exported
only from `<Name>.response.ts`.

Field-type → Zod mapping: `field.string` → `z.string()`; `field.int`/`long`/`currency`
→ `z.number().int()`; `field.double`/`float` → `z.number()`; `field.boolean` →
`z.boolean()`; `field.enum` → `z.enum([...])` over its declared `@values`;
`field.uuid` → `z.string().uuid()`; `field.decimal` and the temporal subtypes →
`z.string()` (their JSON wire form); `field.object` (with `@objectRef`) → a nested
`z.object({...})`; `isArray: true` → wrapped in `z.array(...)`; a field that is not
`@required` → `.optional()`. Only a subtype outside that set, or a self-referencing
`@objectRef`, falls through to `z.unknown()`.

## The response-format prompt fragment (FR-010)

For every responding `template.prompt`, the `outputPrompt()` generator (same import
path, `@metaobjectsdev/codegen-ts/generators`) emits a
`<PromptName>.responseFormat.ts` exporting `render<PromptName>Format(overrides?)` —
backed by the render engine's `renderOutputFormat()`. This is the "produce your
answer like this" fragment you splice into the prompt text so the model returns the
shape the parser above expects:

```ts
// metaobjects.config.ts — the same owned entity trio as above, plus outputPrompt
import { entityFile } from "./codegen/generators/entity.js";
import { queriesFile } from "./codegen/generators/queries.js";
import { barrel } from "./codegen/generators/barrel.js";
import { promptRender, outputParser, outputPrompt } from "@metaobjectsdev/codegen-ts/generators";

export default defineConfig({
  outDir: "src/generated",
  generators: [
    entityFile(), queriesFile(), barrel(),
    promptRender(), outputParser(), outputPrompt(),
  ],
});
```

`@promptStyle` on the `template.prompt` (`guide` default / `inline` / `exampleOnly`)
controls the fragment's presentation: `guide` is a prose field list + example
skeleton, `inline` is one skeleton with inline placeholders/enum choices,
`exampleOnly` is just the filled skeleton. Guidance is never emitted as comments —
models ignore them. Skipped for `template.output` and for any prompt whose
`@responseRef` doesn't resolve — the same skip contract as `outputParser()`. There is NO
format gate: the old `@format ∈ {json,xml}` test read the syntax of the outbound BODY to
decide whether to describe the REPLY. `@responseFormat` selects which syntax the fragment
teaches. The baked spec's root name matches the response shape, so the fragment and the
parser's `extract()` agree on the same root.

## The three-step consumer pattern

Render the prompt → call your LLM client (provider-agnostic; nothing is generated
here) → parse the response with the generated parser:

```ts
// Node-only subpath: the package ROOT stays browser-safe, so the filesystem provider
// lives on `@metaobjectsdev/render/providers`. `lobby/welcome` → ./prompts/lobby/welcome.mustache.
import { FilesystemProvider } from "@metaobjectsdev/render/providers";
import { renderNpcReview } from "./generated/prompts";
import { parseNpcReview, safeParseNpcReview } from "./generated/NpcReview.response";

const textProvider = new FilesystemProvider("./prompts");
const promptText  = renderNpcReview(payload, textProvider);
const llmResponse = await myLlmProvider.call(promptText);   // YOUR code — no generated provider

// Throwing path:
const npc = parseNpcReview(llmResponse);

// Result-style:
const r = safeParseNpcReview(llmResponse);
if (!r.success) log.warn("malformed LLM payload", r.error);
else handle(r.data);
```

## Recommended LLM caller (bring-your-own)

MetaObjects generates **no** provider/LLM-call layer and never will — the call is a
commodity the ecosystem already solves, and a maintained vendor wrapper would just
chase SDK churn (ADR-0024). You bring the caller; MetaObjects owns the typed
render → parse → record. For the call step, plug the idiomatic library into the
one-method `LlmClient` seam from `@metaobjectsdev/ai-runtime`:

```ts
import { generateText } from "ai";              // Vercel AI SDK — recommended
import { anthropic } from "@ai-sdk/anthropic";
import type { LlmClient } from "@metaobjectsdev/ai-runtime";

export const llm: LlmClient = {
  async complete({ prompt, model, system }) {
    const { text } = await generateText({ model: anthropic(model), system, prompt });
    return { body: text };  // also map usage/model/finishReason from the result → cost + token columns
  },
};
```

**Recommended: the Vercel AI SDK (`ai`)** — provider-agnostic (`generateText` /
`generateObject` over Anthropic / OpenAI / Google / …), first-class structured
output, the de-facto TS standard. Single-provider apps can implement `complete`
directly over `@anthropic-ai/sdk` / `openai`; heavy chains can use LangChain.js —
the seam is one method either way.

With a client in hand, the generated `record<Entity>` helper (the `trace-helper`
generator) and `@metaobjectsdev/ai-runtime`'s `callLlm` do render → call → **typed
trace persist** in one call, recording request/response as typed value objects in
your own DB. The parser above is the standalone receive side if you don't want the
recorder.

## Drift gate

`meta verify` walks every template's `@payloadRef` resolution and fails the build
(exit 1) if a reference can't be resolved. A `@responseRef` that does not resolve to a
value-object (or sourceless projection) is caught one layer earlier — it is a LOAD
error in every port. The emitted parser imports `zod`;
it's usually already a dependency (Drizzle / `runtime-ts` lean on it), else
`npm i zod`.

## See which fields a template consumes

Run `meta docs` to emit the model surface to `./docs` — one page per
`template.*` at `docs/<Template>.md`. Each template page has a
`## Template source` section that shows the Mustache source with every `{{var}}`
linked to that field's doc page (`docs/<Owner>.md#field-<name>`), plus a variables
table — so you can see exactly which payload fields a template reads. Those links are
build-time drift-gated against the render `verify()` engine, so a link can't claim a
field that `verify()` would reject. (`meta docs` is the single door for all docs —
it's a command, not a `meta gen` generator; the model surface here lands in `./docs`,
the SDK/API surface under `./docs/api`.)
