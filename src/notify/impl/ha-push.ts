// ha-push notify adapter — Task 9. POSTs a Home Assistant `notify.<service>` push. Ports
// bash `notify_ha` (~/Development/small-model-skills/monitor/bin/smon):
//
//   url="${SMON_HA_URL%/}/api/services/notify/${SMON_HA_TARGET#notify.}"
//   curl -X POST "$url" -H "Authorization: Bearer $tok" -H "Content-Type: application/json" \
//     --data '{"title":..., "message":...}'
//   # 200 -> ok (return 0); anything else -> FAILED (return 1)
//
// Config-key rename (metaobjects model, not a deviation from THIS task): the model's
// adapter.notify HaPush node (metaobjects/meta.notify.json) declares @requiredConfig
// ["SMON_HA_URL","SMON_HA_TOKEN","SMON_HA_DEVICE"] — bash's SMON_HA_TARGET became
// SMON_HA_DEVICE. The `${...#notify.}` prefix-strip is preserved verbatim below so a value
// carried over unchanged from an old bash config (e.g. "notify.mobile_app_x") still resolves
// to the same URL.

import type { NotifyAdapter } from "../../generated/notify/registry.data";
import type { AlertPayload, DigestPayload } from "../../generated";
import { formatAlertBody, formatAlertTitle, formatDigestBody, formatDigestTitle } from "../format";
import { requireConfig } from "../config";

export interface HaPushAdapterDeps {
  /** Defaults to the global `fetch`. Inject a fake in tests. */
  fetch?: typeof fetch;
}

function stripNotifyPrefix(device: string): string {
  return device.startsWith("notify.") ? device.slice("notify.".length) : device;
}

async function post(
  doFetch: typeof fetch,
  cfg: Readonly<Record<string, string>>,
  title: string,
  message: string,
): Promise<void> {
  const baseUrl = requireConfig(cfg, "SMON_HA_URL").replace(/\/$/, "");
  const token = requireConfig(cfg, "SMON_HA_TOKEN");
  const device = requireConfig(cfg, "SMON_HA_DEVICE");
  const target = stripNotifyPrefix(device);
  const url = `${baseUrl}/api/services/notify/${target}`;

  const res = await doFetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ title, message }),
  });
  if (res.status !== 200) {
    throw new Error(`ha-push FAILED (HTTP ${res.status}): ${title}`);
  }
}

export function createHaPushAdapter(deps: HaPushAdapterDeps = {}): NotifyAdapter<AlertPayload, DigestPayload> {
  const doFetch = deps.fetch ?? fetch;

  return {
    async sendAlert(payload, cfg) {
      await post(doFetch, cfg, formatAlertTitle(payload), formatAlertBody(payload));
    },
    async sendDigest(payload, cfg) {
      await post(doFetch, cfg, formatDigestTitle(payload), formatDigestBody(payload));
    },
  } satisfies NotifyAdapter<AlertPayload, DigestPayload>;
}

/** Default instance (real global `fetch`) — what the wired registry (src/notify/registry.ts) uses. */
export const haPushAdapter = createHaPushAdapter();
