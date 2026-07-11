// kuma notify adapter — Task 9. GETs an Uptime Kuma push-monitor URL. Ports bash `heartbeat`
// (~/Development/small-model-skills/monitor/bin/smon):
//
//   [ -n "$SMON_KUMA_PUSH_URL" ] || return 0    # not configured -> silent no-op, not a failure
//   curl "${SMON_KUMA_PUSH_URL}?status=up&msg=$(printf '%s' "$msg" | jq -sRr @uri)"
//   # 200 -> ok; anything else -> FAILED (bash doesn't act on this, just logs)
//
// kuma is heartbeat-only (no digest — see @digestPayloadRef absent on the model's Kuma node in
// metaobjects/meta.notify.json), hence `NotifyAdapter<HeartbeatPayload>` with no second
// type param, and no `sendDigest` below.
//
// DEVIATION: bash's heartbeat() is called unconditionally once per sweep and always hardcodes
// `status=up` (it just means "smon itself is alive", independent of what the sweep found).
// The TS port's HeartbeatPayload models `status` as a required "up"|"down" enum field instead
// of a hardcoded literal, so this adapter sources the query param FROM `payload.status` rather
// than hardcoding "up". For the normal per-sweep heartbeat call this still produces exactly
// `status=up` (byte-identical to bash), but it also lets a future caller signal `status=down`
// through the same typed contract instead of needing a second, bespoke transport.

import type { NotifyAdapter } from "../../generated/notify/registry.data";
import type { HeartbeatPayload } from "../../generated";

export interface KumaAdapterDeps {
  /** Defaults to the global `fetch`. Inject a fake in tests. */
  fetch?: typeof fetch;
}

export function createKumaAdapter(deps: KumaAdapterDeps = {}): NotifyAdapter<HeartbeatPayload> {
  const doFetch = deps.fetch ?? fetch;

  return {
    async sendAlert(payload, cfg) {
      const pushUrl = cfg["SMON_KUMA_PUSH_URL"];
      if (pushUrl === undefined || pushUrl === "") return; // not configured -> silent no-op

      const url = `${pushUrl}?status=${payload.status}&msg=${encodeURIComponent(payload.msg)}`;
      const res = await doFetch(url);
      if (res.status !== 200) {
        throw new Error(`kuma heartbeat FAILED (HTTP ${res.status})`);
      }
    },
  } satisfies NotifyAdapter<HeartbeatPayload>;
}

/** Default instance (real global `fetch`) — what the wired registry (src/notify/registry.ts) uses. */
export const kumaAdapter = createKumaAdapter();
