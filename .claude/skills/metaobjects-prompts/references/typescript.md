# TypeScript parser-on-receipt

For every `template.output` in your metadata, the `outputParser()` generator (from
`@metaobjectsdev/codegen-ts/generators`) emits a **typed parser** that validates an
LLM/raw response against the template's `@payloadRef` payload value-object. This is
the receive side; codegen emits **no** provider/LLM-call layer — you compose the
call yourself.

## Contents
- Wire the generator
- What it emits
- The three-step consumer pattern
- Recommended LLM caller (bring-your-own)
- Drift gate
- See which fields a template consumes

## Wire the generator

```ts
// metaobjects.config.ts
import { defineConfig } from "@metaobjectsdev/cli";
import { entityFile, queriesFile, barrel, promptRender, outputParser } from "@metaobjectsdev/codegen-ts/generators";

export default defineConfig({
  outDir: "src/generated",
  generators: [
    entityFile(), queriesFile(), barrel(),
    promptRender(),    // render<Name>() per template.prompt (the send side)
    outputParser(),    // parse*/safeParse* per template.output (the receive side)
  ],
});
```

`outputParser({ outDir: "src/generated/outputs", target: "default" })` are the
options.

## What it emits

Per `template.output` (say named `NpcResponseOutput`, `@payloadRef:
"NpcResponsePayload"`), `meta gen` writes a self-contained `NpcResponseOutput.output.ts`
with a Zod schema + a dual API:

```ts
import { z } from "zod";

const NpcResponseOutputSchema = z.object({
  name: z.string(),
  level: z.number().int(),
  role: z.unknown(),   // field.enum is not value-constrained in the strict parser → z.unknown()
});

export type NpcResponseOutputData = z.infer<typeof NpcResponseOutputSchema>;
export type NpcResponseOutputValidationError = z.ZodError;

/** Throws ZodError on bad input. */
export function parseNpcResponseOutput(text: string): NpcResponseOutputData { /* ... */ }

/** Result-style; never throws. */
export function safeParseNpcResponseOutput(text: string):
  | { success: true; data: NpcResponseOutputData }
  | { success: false; error: NpcResponseOutputValidationError } { /* ... */ }
```

The dual API mirrors Zod's idiomatic shape: `parse*` throws a `ZodError`,
`safeParse*` returns a discriminated union. The emitted `<Name>Data` type is
structurally identical to the `promptRender()` payload VO, so you can pass values
between the render and parse sides interchangeably.

Field-type → Zod mapping: `field.string` → `z.string()`; `field.int`/`long`/`short`/`byte`
→ `z.number().int()`; `field.double`/`float` → `z.number()`; `field.boolean` →
`z.boolean()`; `field.object` (with `@objectRef`) → a nested `z.object({...})`;
`isArray: true` → wrapped in `z.array(...)`. Any subtype outside this scalar set —
including `field.enum` — falls through to `z.unknown()` in the strict
`parse*`/`safeParse*` schema (the value-constrained `z.enum([...])` form is emitted
in the entity insert/update schemas, not in this output parser; the lenient extract
path carries the enum-as-string handling).

## The three-step consumer pattern

Render the prompt → call your LLM client (provider-agnostic; nothing is generated
here) → parse the response with the generated parser:

```ts
import { renderNpcPrompt } from "./generated/prompts";
import { parseNpcResponseOutput, safeParseNpcResponseOutput } from "./generated/NpcResponseOutput.output";

const promptText  = renderNpcPrompt(payload, textProvider);
const llmResponse = await myLlmProvider.call(promptText);   // YOUR code — no generated provider

// Throwing path:
const npc = parseNpcResponseOutput(llmResponse);

// Result-style:
const r = safeParseNpcResponseOutput(llmResponse);
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

`meta verify` walks every `template.output`'s `@payloadRef` resolution and fails the
build (exit 1, `(output)`-prefixed diagnostic) if a reference can't be resolved —
catching payload-VO ↔ parser drift at build time. The emitted parser imports `zod`;
it's usually already a dependency (Drizzle / `runtime-ts` lean on it), else
`npm i zod`.

## See which fields a template consumes

Run `meta docs` to emit the model surface to `./docs` — one page per
`template.output` at `docs/<Template>.md`. Each template page has a
`## Template source` section that shows the Mustache source with every `{{var}}`
linked to that field's doc page (`docs/<Owner>.md#field-<name>`), plus a variables
table — so you can see exactly which payload fields a template reads. Those links are
build-time drift-gated against the render `verify()` engine, so a link can't claim a
field that `verify()` would reject. (`meta docs` is the single door for all docs —
it's a command, not a `meta gen` generator; the model surface here lands in `./docs`,
the SDK/API surface under `./docs/api`.)
