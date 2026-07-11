// matrix notify adapter — Task 9. PUTs an m.room.message via the Matrix client-server API.
// Ports bash `notify_matrix` (~/Development/small-model-skills/monitor/bin/smon) — including
// the fix documented right in its comment ("A good FALLBACK because it rides different infra"):
// this is a PUT (client-server API's send-event endpoint is idempotent-by-txnId PUT, not POST),
// with a per-call unique transaction id and the room id's `:` encoded as `%3A` (NOT full
// percent-encoding of the whole room string):
//
//   room_encoded="$(printf '%s' "$SMON_MATRIX_ROOM" | sed 's/:/%3A/g')"
//   txn="smon-$$-${SECONDS}-${RANDOM}"
//   url="${SMON_MATRIX_URL%/}/_matrix/client/v3/rooms/${room_encoded}/send/m.room.message/${txn}"
//   curl -X PUT "$url" -H "Authorization: Bearer $tok" -H "Content-Type: application/json" \
//     --data '{"msgtype":"m.text","body":"<title>\n<body>"}'
//   # 200 -> ok; anything else -> FAILED
//
// Config-key rename (metaobjects model): bash's SMON_MATRIX_URL became SMON_MATRIX_HOMESERVER
// per the model's adapter.notify Matrix node (metaobjects/meta.notify.json).
//
// Room encoding: `encodeURIComponent` is used instead of a hand-rolled `:`->`%3A` replace, but
// for every real Matrix room id (`!opaque:server.name`) the two are byte-identical — MDN's
// unreserved set for encodeURIComponent leaves `!` (and `.`/`-`/`_`) untouched, same as bash's
// sed leaves it untouched, and both turn `:` into `%3A`. Verified in test/notify.test.ts
// against `!room:example.org` -> `!room%3Aexample.org`.

import type { NotifyAdapter } from "../../generated/notify/registry.data";
import type { AlertPayload, DigestPayload } from "../../generated";
import { formatAlertBody, formatAlertTitle, formatDigestBody, formatDigestTitle } from "../format";
import { requireConfig } from "../config";

export interface MatrixAdapterDeps {
  /** Defaults to the global `fetch`. Inject a fake in tests. */
  fetch?: typeof fetch;
}

function freshTxnId(): string {
  return `smon-${Date.now()}-${crypto.randomUUID()}`;
}

async function put(
  doFetch: typeof fetch,
  cfg: Readonly<Record<string, string>>,
  title: string,
  body: string,
): Promise<void> {
  const homeserver = requireConfig(cfg, "SMON_MATRIX_HOMESERVER").replace(/\/$/, "");
  const token = requireConfig(cfg, "SMON_MATRIX_TOKEN");
  const room = requireConfig(cfg, "SMON_MATRIX_ROOM");
  const roomEncoded = encodeURIComponent(room);
  const txnId = freshTxnId();
  const url = `${homeserver}/_matrix/client/v3/rooms/${roomEncoded}/send/m.room.message/${txnId}`;

  const res = await doFetch(url, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ msgtype: "m.text", body: `${title}\n${body}` }),
  });
  if (res.status !== 200) {
    throw new Error(`matrix FAILED (HTTP ${res.status}): ${title}`);
  }
}

export function createMatrixAdapter(deps: MatrixAdapterDeps = {}): NotifyAdapter<AlertPayload, DigestPayload> {
  const doFetch = deps.fetch ?? fetch;

  return {
    async sendAlert(payload, cfg) {
      await put(doFetch, cfg, formatAlertTitle(payload), formatAlertBody(payload));
    },
    async sendDigest(payload, cfg) {
      await put(doFetch, cfg, formatDigestTitle(payload), formatDigestBody(payload));
    },
  } satisfies NotifyAdapter<AlertPayload, DigestPayload>;
}

/** Default instance (real global `fetch`) — what the wired registry (src/notify/registry.ts) uses. */
export const matrixAdapter = createMatrixAdapter();
