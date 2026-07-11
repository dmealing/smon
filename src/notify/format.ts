// Hand-written (not codegen) — shared plain-text formatting for the non-email notify
// adapters (ha-push, matrix, stdout). Mirrors the title/body shapes the bash reference
// composed in `eval_probe`/`maybe_digest` before handing them to `notify_send`/`_notify_one`
// (~/Development/small-model-skills/monitor/bin/smon). The TS port moved title/body
// composition INTO each adapter (AlertPayload/DigestPayload carry no separate title/body
// fields — see src/generated/AlertPayload.ts, DigestPayload.ts), so this module is the one
// place that logic lives, shared by every adapter that needs plain-text framing.
//
// Email is out of scope here: it renders subject/body from the mustache templates via
// src/render/email.ts (renderEmail), which already encodes an equivalent shape
// (templates/emails/alert.subject.mustache, alert.txt.mustache) — see src/notify/impl/email.ts.

import type { AlertPayload, DigestPayload } from "../generated";

const ALERT_KIND_EMOJI: Record<AlertPayload["kind"], string> = {
  fail: "🔴",
  warn: "🟠",
  recovery: "🟢",
};

/**
 * bash `eval_probe`'s per-kind title:
 *   fail:     title="🔴 $SMON_HOST: $V_TAG"
 *   warn:     title="🟠 $SMON_HOST: $V_TAG"
 *   recovery: title="🟢 $SMON_HOST: $probe recovered ($p_tag → OK)"
 */
export function formatAlertTitle(payload: AlertPayload): string {
  const emoji = ALERT_KIND_EMOJI[payload.kind];
  if (payload.kind === "recovery") {
    return `${emoji} ${payload.host}: ${payload.probe} recovered (${payload.verdict.tag} → OK)`;
  }
  return `${emoji} ${payload.host}: ${payload.verdict.tag}`;
}

/**
 * The alert body: `enrichedBody` already carries the final message text (the enriched
 * sentence when enrichment ran, or the raw verdict prose when it didn't/was skipped —
 * see bash `enrich()` and its FAIL-ships-raw-by-default comment). No further formatting.
 */
export function formatAlertBody(payload: AlertPayload): string {
  return payload.enrichedBody;
}

const DIGEST_WORST_EMOJI: Record<DigestPayload["worstStatus"], string> = {
  OK: "🟢",
  WARN: "🟠",
  FAIL: "🔴",
};

/** bash `maybe_digest`'s title: "$emoji $SMON_HOST: daily digest ($worst)". */
export function formatDigestTitle(payload: DigestPayload): string {
  return `${DIGEST_WORST_EMOJI[payload.worstStatus]} ${payload.host}: daily digest (${payload.worstStatus})`;
}

/**
 * bash `maybe_digest`'s body: one "<probe>: <STATUS> <TAG>" line per probe, or
 * "no probe state recorded" when there's nothing (bash: `${line:-no probe state recorded}`).
 */
export function formatDigestBody(payload: DigestPayload): string {
  if (payload.probes.length === 0) return "no probe state recorded";
  return payload.probes.map((p) => `${p.probe}: ${p.verdict.status} ${p.verdict.tag}`).join("\n");
}
