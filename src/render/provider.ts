// Shared filesystem-backed metaobjects `Provider`, resolving a `group/source` template ref to
// `<repo-root>/templates/group/source.mustache`. Used by BOTH render sites that consume the
// project's templates/ directory at runtime:
//   - src/render/email.ts       — the @kind=email render helpers (emails/*.mustache)
//   - src/enrich/enrich.ts      — the EnrichmentPrompt render (prompts/enrichment.mustache)
// One provider keeps their template resolution identical, and matches the codegen-time drift
// gate (projectProvider(), used by `meta gen`/`meta verify`), which resolves refs against the
// same templates/ root — so runtime and build-time always agree on the same template texts.

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Provider } from "@metaobjectsdev/render";

// templates/ lives at the project root, one level above src/.
const TEMPLATES_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "templates");

/**
 * Resolves a `group/source` ref to `<TEMPLATES_DIR>/group/source.mustache`.
 * Provider.resolve() is synchronous by design (render() is a pure, sync function — see
 * @metaobjectsdev/render), so this uses node:fs's sync API rather than Bun.file() (which is
 * Promise-only). This mirrors the provider shape @metaobjectsdev/cli and @metaobjectsdev/codegen-ts
 * ship internally for their own filesystem-backed resolution — @metaobjectsdev/render itself only
 * ships InMemoryProvider (test-only), so an app consuming templates at runtime supplies its own.
 */
class FilesystemProvider implements Provider {
  constructor(private readonly root: string) {}
  resolve(ref: string): string | undefined {
    const path = join(this.root, `${ref}.mustache`);
    if (!existsSync(path)) return undefined;
    return readFileSync(path, "utf-8");
  }
}

/** The single templates/-backed provider instance shared across the runtime render sites. */
export const templatesProvider: Provider = new FilesystemProvider(TEMPLATES_DIR);
