// Task 12 — the pure alert-policy state machine. This is the parity core: a straight port of
// bash `eval_probe` (the transition/sustain/re-alert/recovery logic) PLUS the quiet-hours gate
// that in bash lives in the notify layer (`notify_send` + `in_quiet_hours`) but is POLICY, so it
// moves here. Reference: the bash reference (small-model-skills monitor/bin/smon).
//
// decide() is PURE: no I/O, no wall-clock read, no host data, no enrichment. Everything it needs
// comes from its arguments — the previous ProbeState, the current Verdict, the timing/threshold
// Config, and an injected `now` (the current hour for quiet-hours, and a timestamp string for the
// `since` field). Keeping the clock injected is what makes the oracle in test/policy.test.ts
// deterministic. The Task 13 sweep loop supplies the real `now`, persists `next`, and — when an
// alert is returned — builds the host-specific AlertPayload/Transition and enriches it. decide()
// itself never touches per-host, per-channel, or secret concerns; it emits only the pure verdict
// (`kind`) plus the minimal transition keys the loop needs to assemble a Transition.

import type { Config } from "../config";
import type { ProbeState, TransitionKind, Verdict } from "../generated";

/** The injected clock. Pure by construction — decide() reads no real time itself. */
export interface Now {
  /** Current local hour 0–23 (bash `date +%-H`), used only to evaluate quiet hours. */
  hour: number;
  /** Timestamp string recorded into ProbeState.since on a transition/OK (bash `date +%s`). Any
   *  non-empty string; decide() stores it verbatim and never parses it. */
  timestamp: string;
}

/** The pure transition data decide() emits when an alert fires. The sweep loop (Task 13) turns
 *  this into a Transition/AlertPayload; decide() deliberately stops at these host-free fields. */
export interface AlertDecision {
  kind: TransitionKind; // "fail" | "warn" | "recovery"
  fromKey: string; // prev state key "STATUS/TAG"
  toKey: string; // new state key "STATUS/TAG"
}

export interface Decision {
  next: ProbeState;
  alert?: AlertDecision;
}

/**
 * Quiet-hours predicate — a direct port of bash `in_quiet_hours`.
 * If quietStart <= quietEnd: quiet iff quietStart <= h < quietEnd.
 * Otherwise (overnight wrap): quiet iff h >= quietStart || h < quietEnd.
 * The oracle forces the regime with QS=0 QE=24 (always quiet) or QS=0 QE=0 (never quiet).
 */
export function inQuietHours(cfg: Config, now: Now): boolean {
  const h = now.hour;
  if (cfg.quietStart <= cfg.quietEnd) {
    return h >= cfg.quietStart && h < cfg.quietEnd;
  }
  return h >= cfg.quietStart || h < cfg.quietEnd;
}

/**
 * The alert-policy state machine. Given the previous persisted state and the current verdict,
 * returns the next state plus (optionally) the alert to emit. Pure port of bash `eval_probe` +
 * the `notify_send`/`in_quiet_hours` quiet-hours gate.
 */
export function decide(prev: ProbeState, verdict: Verdict, cfg: Config, now: Now): Decision {
  const keyNow = `${verdict.status}/${verdict.tag}`;
  const keyPrev = `${prev.verdict.status}/${prev.verdict.tag}`;
  // Capture the alerted flag of the state we're LEAVING before any reset — recovery depends on it.
  const prevAlerted = prev.alerted;

  let sweepCount = prev.sweepCount;
  let since = prev.since;
  let alerted = prev.alerted;
  let doAlert = false;
  let kind: TransitionKind | undefined;

  if (keyNow === keyPrev) {
    // --- unchanged state ---
    if (verdict.status === "WARN" && !prev.alerted) {
      // WARN still maturing toward its sustain threshold.
      sweepCount += 1;
      if (sweepCount >= cfg.warnSustain) {
        doAlert = true;
        kind = "warn";
      }
    } else if (verdict.status === "FAIL" && prev.alerted && cfg.failRemindSweeps > 0) {
      // A still-standing FAIL: re-remind every failRemindSweeps sweeps.
      sweepCount += 1;
      if (sweepCount >= cfg.failRemindSweeps) {
        doAlert = true;
        kind = "fail";
        sweepCount = 0;
      }
    }
    // else: no alert; counters and `since` carry over from prev unchanged.
  } else {
    // --- transition (status OR tag changed) ---
    // The new state is a fresh condition that has not been alerted. Resetting here is the
    // WARN/tagA -> WARN/tagB "not swallowed" fix: otherwise B inherits A's alerted=1 and, being
    // "unchanged" next sweep, never matures/pushes.
    alerted = false;
    if (verdict.status === "FAIL") {
      doAlert = true;
      kind = "fail";
      sweepCount = 0; // counts sweeps toward the next reminder
      since = now.timestamp;
    } else if (verdict.status === "WARN") {
      since = now.timestamp;
      sweepCount = 1;
      if (cfg.warnSustain <= 1) {
        doAlert = true;
        kind = "warn";
      }
    } else {
      // OK — recovery only if we had alerted on the state we just left.
      if (prevAlerted) {
        doAlert = true;
        kind = "recovery";
      }
      sweepCount = 0;
      since = now.timestamp;
    }
  }

  // --- quiet-hours + alerted resolution (bash notify_send) ---
  // Only a WARN is deferrable; FAIL and recovery ALWAYS bypass quiet hours.
  let newAlerted = alerted;
  let alert: AlertDecision | undefined;
  if (doAlert && kind) {
    if (kind === "warn" && inQuietHours(cfg, now)) {
      // Suppress — defer, don't drop. Pin the counter at the sustain threshold so it fires
      // immediately on the first non-quiet sweep, and leave alerted=false so a never-delivered
      // WARN can't later mis-fire a phantom recovery.
      sweepCount = cfg.warnSustain;
    } else {
      alert = { kind, fromKey: keyPrev, toKey: keyNow };
      newAlerted = kind === "recovery" ? false : true;
    }
  }

  // ProbeStateInsertSchema forbids an empty `since`. On a transition/OK it's already now-derived;
  // on unchanged sweeps it carries prev.since — which is only ever empty on an OK/NONE->OK/NONE
  // sweep from the fresh default (a no-op that never alerts and whose `since` no policy reads).
  // Substituting now.timestamp there keeps the invariant without altering any decision.
  if (since.length === 0) since = now.timestamp;

  const next: ProbeState = {
    probe: prev.probe,
    verdict,
    since,
    sweepCount,
    alerted: newAlerted,
  };
  return alert ? { next, alert } : { next };
}
