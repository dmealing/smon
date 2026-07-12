// stdout notify adapter — Task 9. Always succeeds; prints the alert/digest for local/dry-run
// visibility. Ports bash `_notify_one`'s stdout case
// (small-model-skills monitor/bin/smon):
//   stdout) printf '[smon %s] %s\n  %s\n' "$status" "$title" "$body"; return 0 ;;
// and `maybe_digest`'s DRY_RUN print for the digest shape. `@requiredConfig`/`@optionalConfig`
// are both empty (see metaobjects/meta.notify.json's Stdout node) — cfg is unused.

import type { NotifyAdapter } from "../../generated/notify/registry.data";
import type { AlertPayload, DigestPayload } from "../../generated";
import { formatAlertBody, formatAlertTitle, formatDigestBody, formatDigestTitle } from "../format";

export interface StdoutAdapterDeps {
  /** Where a formatted line goes. Defaults to `console.log`. Inject to capture in tests. */
  write?: (line: string) => void;
}

export function createStdoutAdapter(deps: StdoutAdapterDeps = {}): NotifyAdapter<AlertPayload, DigestPayload> {
  const write = deps.write ?? ((line: string) => console.log(line));

  return {
    async sendAlert(payload) {
      write(`[smon ${payload.verdict.status}] ${formatAlertTitle(payload)}\n  ${formatAlertBody(payload)}`);
    },
    async sendDigest(payload) {
      write(`[smon ${payload.worstStatus}] ${formatDigestTitle(payload)}\n  ${formatDigestBody(payload)}`);
    },
  } satisfies NotifyAdapter<AlertPayload, DigestPayload>;
}

/** Default instance (real `console.log`) — what the wired registry (src/notify/registry.ts) uses. */
export const stdoutAdapter = createStdoutAdapter();
