import { render } from "@metaobjectsdev/render";
import type { Provider, EmailDocument } from "@metaobjectsdev/render";
import type { AlertPayload } from "./AlertPayload.js";

/**
 * Render the AlertEmail email (subject + html body + text body) from a
 * typed AlertPayload payload. Wraps the render() engine; the payload field tree is
 * baked in so render()'s runtime drift check matches the build-time gate.
 */
export function renderAlertEmail(payload: AlertPayload, provider: Provider): EmailDocument {
  return {
    subject: render({ ref: "emails/alert.subject", payload, format: "text", provider, verify: [{"name":"host"},{"name":"probe"},{"name":"verdict","fields":[{"name":"status"},{"name":"tag"},{"name":"prose"}]},{"name":"kind"},{"name":"enrichedBody"},{"name":"fromTag"}] }),
    htmlBody: render({ ref: "emails/alert.html", payload, format: "html", provider, verify: [{"name":"host"},{"name":"probe"},{"name":"verdict","fields":[{"name":"status"},{"name":"tag"},{"name":"prose"}]},{"name":"kind"},{"name":"enrichedBody"},{"name":"fromTag"}] }),
    textBody: render({ ref: "emails/alert.txt", payload, format: "text", provider, verify: [{"name":"host"},{"name":"probe"},{"name":"verdict","fields":[{"name":"status"},{"name":"tag"},{"name":"prose"}]},{"name":"kind"},{"name":"enrichedBody"},{"name":"fromTag"}] }),
  };
}
