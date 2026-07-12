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

import { renderAlertEmail } from "../generated/AlertEmail.render";
import { renderDigestEmail } from "../generated/DigestEmail.render";
import type { AlertPayload, DigestPayload } from "../generated";
import { templatesProvider } from "./provider";

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

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
      const doc = renderAlertEmail(payload as AlertPayload, templatesProvider);
      return { subject: doc.subject, html: doc.htmlBody, text: doc.textBody ?? "" };
    }
    case "DigestEmail": {
      const doc = renderDigestEmail(payload as DigestPayload, templatesProvider);
      return { subject: doc.subject, html: doc.htmlBody, text: doc.textBody ?? "" };
    }
    default:
      throw new Error(`renderEmail: unknown email template "${name}"`);
  }
}
