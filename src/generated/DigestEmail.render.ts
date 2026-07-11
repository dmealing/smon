import { render } from "@metaobjectsdev/render";
import type { Provider, EmailDocument } from "@metaobjectsdev/render";
import type { DigestPayload } from "./DigestPayload.js";

/**
 * Render the DigestEmail email (subject + html body + text body) from a
 * typed DigestPayload payload. Wraps the render() engine; the payload field tree is
 * baked in so render()'s runtime drift check matches the build-time gate.
 */
export function renderDigestEmail(payload: DigestPayload, provider: Provider): EmailDocument {
  return {
    subject: render({ ref: "emails/digest.subject", payload, format: "text", provider, verify: [{"name":"host"},{"name":"date"},{"name":"worstStatus"},{"name":"allOk"},{"name":"okCount"},{"name":"warnCount"},{"name":"failCount"},{"name":"probes","fields":[{"name":"probe"},{"name":"verdict","fields":[{"name":"status"},{"name":"tag"},{"name":"prose"}]},{"name":"since"},{"name":"sweepCount"},{"name":"alerted"}]},{"name":"transitions24h","fields":[{"name":"time"},{"name":"probe"},{"name":"fromKey"},{"name":"toKey"},{"name":"kind"}]}] }),
    htmlBody: render({ ref: "emails/digest.html", payload, format: "html", provider, verify: [{"name":"host"},{"name":"date"},{"name":"worstStatus"},{"name":"allOk"},{"name":"okCount"},{"name":"warnCount"},{"name":"failCount"},{"name":"probes","fields":[{"name":"probe"},{"name":"verdict","fields":[{"name":"status"},{"name":"tag"},{"name":"prose"}]},{"name":"since"},{"name":"sweepCount"},{"name":"alerted"}]},{"name":"transitions24h","fields":[{"name":"time"},{"name":"probe"},{"name":"fromKey"},{"name":"toKey"},{"name":"kind"}]}] }),
    textBody: render({ ref: "emails/digest.txt", payload, format: "text", provider, verify: [{"name":"host"},{"name":"date"},{"name":"worstStatus"},{"name":"allOk"},{"name":"okCount"},{"name":"warnCount"},{"name":"failCount"},{"name":"probes","fields":[{"name":"probe"},{"name":"verdict","fields":[{"name":"status"},{"name":"tag"},{"name":"prose"}]},{"name":"since"},{"name":"sweepCount"},{"name":"alerted"}]},{"name":"transitions24h","fields":[{"name":"time"},{"name":"probe"},{"name":"fromKey"},{"name":"toKey"},{"name":"kind"}]}] }),
  };
}
