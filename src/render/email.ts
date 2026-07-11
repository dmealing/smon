// Thin, hand-written wrapper over the generated `@kind=email` render helpers.
//
// `template.output` codegen (the `renderHelper()` generator wired into
// metaobjects.config.ts) already emits a typed `render<Name>(payload, provider):
// EmailDocument` per email template, with the mustache<->payload drift check
// baked in as the `verify:` literal — see src/generated/AlertEmail.render.ts and
// src/generated/DigestEmail.render.ts. This module supplies the two things
// codegen doesn't: a runtime Provider that resolves `group/source` refs against
// this project's templates/ directory, and a name-keyed dispatcher matching the
// shape callers want ({subject, html, text} instead of the engine's {subject,
// htmlBody, textBody}).

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Provider } from "@metaobjectsdev/render";
import { renderAlertEmail } from "../generated/AlertEmail.render";
import { renderDigestEmail } from "../generated/DigestEmail.render";
import type { AlertPayload, DigestPayload } from "../generated";

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

// templates/ lives at the project root, one level above src/ — the same place
// the codegen-time drift gate (projectProvider(), used by renderHelper() when
// `meta gen` runs) resolves refs, so the runtime provider and the build-time
// gate always agree on the same template texts.
const TEMPLATES_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "templates");

/**
 * Resolves a `group/source` ref to `<TEMPLATES_DIR>/group/source.mustache`.
 * Provider.resolve() is synchronous by design (render() is a pure, sync
 * function — see @metaobjectsdev/render), so this uses node:fs's sync API
 * rather than Bun.file() (which is Promise-only). This mirrors the provider
 * shape @metaobjectsdev/cli and @metaobjectsdev/codegen-ts ship internally for
 * their own filesystem-backed resolution — @metaobjectsdev/render itself only
 * ships InMemoryProvider (test-only), so an app consuming @kind=email
 * templates at runtime is expected to supply its own filesystem provider.
 */
class FilesystemProvider implements Provider {
  constructor(private readonly root: string) {}
  resolve(ref: string): string | undefined {
    const path = join(this.root, `${ref}.mustache`);
    if (!existsSync(path)) return undefined;
    return readFileSync(path, "utf-8");
  }
}

const provider: Provider = new FilesystemProvider(TEMPLATES_DIR);

type EmailTemplateName = "AlertEmail" | "DigestEmail";

/**
 * Render a `@kind=email` template.output by name against a typed payload,
 * returning {subject, html, text}. Dispatches to the generated per-template
 * render helper (renderAlertEmail / renderDigestEmail) — those are the
 * drift-checked source of truth; this function only adapts their EmailDocument
 * shape and supplies the runtime Provider.
 */
export async function renderEmail(name: string, payload: unknown): Promise<RenderedEmail> {
  switch (name as EmailTemplateName) {
    case "AlertEmail": {
      const doc = renderAlertEmail(payload as AlertPayload, provider);
      return { subject: doc.subject, html: doc.htmlBody, text: doc.textBody ?? "" };
    }
    case "DigestEmail": {
      const doc = renderDigestEmail(payload as DigestPayload, provider);
      return { subject: doc.subject, html: doc.htmlBody, text: doc.textBody ?? "" };
    }
    default:
      throw new Error(`renderEmail: unknown email template "${name}"`);
  }
}
