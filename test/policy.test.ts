// Task 12 — the parity oracle for the pure alert-policy state machine (decide()).
//
// This ports the behavioral oracle from small-model-skills monitor/test/smon-test.sh
// into TypeScript. The bash oracle drives the WHOLE binary (probe -> parse -> POLICY -> notify ->
// state); decide() is only the POLICY core (bash's eval_probe + the quiet-hours gate that lives in
// notify_send/in_quiet_hours). So we port the scenario blocks that exercise POLICY, translating
// each bash `check` into an assertion on decide()'s return, threading the returned `next` state
// into the next call's `prev` exactly as bash threads its on-disk `.state` file across sweeps.
//
// PORTED here (policy — decide()'s job): oracle blocks 1–19, including the 4 mandated bug
// regressions:
//   • 12 — a WARN tag-change must NOT be swallowed (transition resets `alerted`).
//   • 13 & 17 — quiet-hours DEFERS a WARN (pins the sustain counter), never drops it.
//   • 14 & 16 — a never-delivered (quiet-suppressed) WARN must NOT later mis-fire a phantom
//               recovery; a recovery itself ALWAYS bypasses quiet hours.
//   • 15 — a missing probe surfaces as FAIL PROBE_MISSING (fed here as the synthetic verdict the
//          runner would produce; the runner's synthesis is tested in test/parser.test.ts).
//   • 11 — a probe with no verdict line surfaces as FAIL NO_VERDICT (likewise fed synthetically).
//
// DELIBERATELY NOT PORTED (not decide()'s concern — covered elsewhere, listed so coverage is
// auditable and no gap is silent):
//   • 20 — don't-enrich-FAIL: enrichment/CLI body policy -> Task 13 sweep loop + src/enrich.
//   • 21 & 22 — daily digest cadence -> Task 13 sweep loop (maybe_digest).
//   • 23 — digit-bearing TAG prose extraction -> already in test/parser.test.ts (Task 8).
//   • 24 — grammar-violating TAG -> BAD_VERDICT -> already in test/parser.test.ts (Task 8).

import { describe, expect, test } from "bun:test";
import { decide, inQuietHours, type Now } from "../src/domain/policy";
import type { Config } from "../src/config";
import type { ProbeState, Verdict } from "../src/generated";

// A valid ProbeName; generic, carries no host data (public repo).
const PROBE = "sys-diag" as const;

// A fixed injected clock. hour=12 is NOT quiet under the default 23->7 window (overnight wrap:
// quiet iff h>=23 || h<7), matching bash's default run(). Quiet-regime blocks below override the
// window (QS=0 QE=24 => always quiet; QS=0 QE=0 => never quiet), exactly as bash forces it — so
// the specific hour never matters, only the window does.
const NOW: Now = { hour: 12, timestamp: "2026-07-11T12:00:00Z" };

function mkConfig(overrides: Partial<Config> = {}): Config {
  return {
    probes: [PROBE],
    notify: ["stdout"],
    fallbackNotify: [],
    brain: "none",
    claudeBin: "claude",
    stateDir: "/tmp/smon-policy-test/state",
    log: "/tmp/smon-policy-test/smon.log",
    host: "testhost",
    quietStart: 23,
    quietEnd: 7,
    warnSustain: 2,
    probeTimeoutSeconds: 120,
    failRemindSweeps: 0,
    digestHour: null,
    enrichFail: false,
    ...overrides,
  };
}

// bash's read_state fallback "OK NONE 0 0 0" — the state before any real sweep.
function fresh(): ProbeState {
  return {
    probe: PROBE,
    verdict: { status: "OK", tag: "NONE", prose: "" },
    since: "",
    sweepCount: 0,
    alerted: false,
  };
}

function v(status: Verdict["status"], tag: string, prose: string): Verdict {
  return { status, tag, prose };
}

// Always-quiet / never-quiet windows, the way bash forces the quiet regime in the oracle.
const ALWAYS_QUIET = { quietStart: 0, quietEnd: 24 } as const;
const NEVER_QUIET = { quietStart: 0, quietEnd: 0 } as const;

describe("inQuietHours (bash in_quiet_hours parity)", () => {
  test("QS<=QE: quiet iff QS <= h < QE", () => {
    const cfg = mkConfig({ quietStart: 1, quietEnd: 5 });
    expect(inQuietHours(cfg, { ...NOW, hour: 0 })).toBe(false);
    expect(inQuietHours(cfg, { ...NOW, hour: 1 })).toBe(true);
    expect(inQuietHours(cfg, { ...NOW, hour: 4 })).toBe(true);
    expect(inQuietHours(cfg, { ...NOW, hour: 5 })).toBe(false);
  });

  test("overnight wrap (QS>QE): quiet iff h>=QS || h<QE", () => {
    const cfg = mkConfig({ quietStart: 23, quietEnd: 7 });
    expect(inQuietHours(cfg, { ...NOW, hour: 23 })).toBe(true);
    expect(inQuietHours(cfg, { ...NOW, hour: 3 })).toBe(true);
    expect(inQuietHours(cfg, { ...NOW, hour: 7 })).toBe(false);
    expect(inQuietHours(cfg, { ...NOW, hour: 12 })).toBe(false);
  });

  test("QS=0 QE=24 => always quiet; QS=0 QE=0 => never quiet (the oracle's forcing knobs)", () => {
    const always = mkConfig(ALWAYS_QUIET);
    const never = mkConfig(NEVER_QUIET);
    for (let h = 0; h < 24; h++) {
      expect(inQuietHours(always, { ...NOW, hour: h })).toBe(true);
      expect(inQuietHours(never, { ...NOW, hour: h })).toBe(false);
    }
  });
});

describe("oracle 1–8: the core WARN-sustain / FAIL-immediate / recovery lifecycle (sustain=2)", () => {
  const cfg = mkConfig({ warnSustain: 2 });

  test("full lifecycle threads through decide() at bash parity", () => {
    // === 1. OK on first sweep -> silent ===
    let d = decide(fresh(), v("OK", "NOMINAL", "all good"), cfg, NOW);
    expect(d.alert).toBeUndefined();
    expect(d.next.verdict).toEqual(v("OK", "NOMINAL", "all good"));
    expect(d.next.alerted).toBe(false);

    // === 2. OK->WARN (sustain=2): first WARN sweep -> silent (maturing) ===
    d = decide(d.next, v("WARN", "CPU_HOG", "a proc is hot"), cfg, NOW);
    expect(d.alert).toBeUndefined();
    expect(d.next.sweepCount).toBe(1);
    expect(d.next.alerted).toBe(false);

    // === 3. WARN persists: second WARN sweep -> PUSH ===
    d = decide(d.next, v("WARN", "CPU_HOG", "a proc is hot"), cfg, NOW);
    expect(d.alert?.kind).toBe("warn");
    expect(d.alert?.toKey).toBe("WARN/CPU_HOG");
    expect(d.next.alerted).toBe(true);
    expect(d.next.sweepCount).toBe(2);

    // === 4. WARN persists again (already alerted) -> silent ===
    d = decide(d.next, v("WARN", "CPU_HOG", "a proc is hot"), cfg, NOW);
    expect(d.alert).toBeUndefined();
    expect(d.next.alerted).toBe(true); // stays alerted
    expect(d.next.sweepCount).toBe(2); // counters unchanged

    // === 5. WARN->OK recovery (we had alerted) -> PUSH resolved ===
    d = decide(d.next, v("OK", "NOMINAL", "back to normal"), cfg, NOW);
    expect(d.alert?.kind).toBe("recovery");
    expect(d.alert?.fromKey).toBe("WARN/CPU_HOG");
    expect(d.alert?.toKey).toBe("OK/NOMINAL");
    expect(d.next.alerted).toBe(false); // recovery resets alerted

    // === 6. OK->FAIL -> PUSH immediately (no sustain needed) ===
    d = decide(d.next, v("FAIL", "DAEMON_DOWN", "service is down"), cfg, NOW);
    expect(d.alert?.kind).toBe("fail");
    expect(d.alert?.toKey).toBe("FAIL/DAEMON_DOWN");
    expect(d.next.alerted).toBe(true);
    expect(d.next.sweepCount).toBe(0);

    // === 7. FAIL unchanged -> silent (failRemindSweeps=0) ===
    d = decide(d.next, v("FAIL", "DAEMON_DOWN", "service is down"), cfg, NOW);
    expect(d.alert).toBeUndefined();
    expect(d.next.alerted).toBe(true);

    // === 8. FAIL->OK recovery -> PUSH ===
    d = decide(d.next, v("OK", "NOMINAL", "recovered"), cfg, NOW);
    expect(d.alert?.kind).toBe("recovery");
    expect(d.alert?.fromKey).toBe("FAIL/DAEMON_DOWN");
    expect(d.next.alerted).toBe(false);
  });
});

describe("oracle 9: WARN_SUSTAIN=1 -> a single WARN sweep pushes immediately", () => {
  const cfg = mkConfig({ warnSustain: 1 });

  test("sustain=1 WARN fires on its first sweep", () => {
    // seed OK
    let d = decide(fresh(), v("OK", "NOMINAL", "start"), cfg, NOW);
    expect(d.alert).toBeUndefined();
    // WARN -> immediate push
    d = decide(d.next, v("WARN", "DISK_HIGH", "88%"), cfg, NOW);
    expect(d.alert?.kind).toBe("warn");
    expect(d.alert?.toKey).toBe("WARN/DISK_HIGH");
    expect(d.next.alerted).toBe(true);
  });
});

describe("oracle 10: quiet hours -> WARN suppressed, FAIL still pushes", () => {
  const cfg = mkConfig({ warnSustain: 1, ...ALWAYS_QUIET });

  test("WARN is held but a FAIL transition bypasses quiet hours", () => {
    // seed OK (always-quiet window)
    let d = decide(fresh(), v("OK", "NOMINAL", "start"), cfg, NOW);
    expect(d.alert).toBeUndefined();

    // WARN during quiet hours -> suppressed (deferred, not dropped)
    d = decide(d.next, v("WARN", "CPU_HOG", "hot"), cfg, NOW);
    expect(d.alert).toBeUndefined();
    expect(d.next.alerted).toBe(false); // never delivered
    expect(d.next.sweepCount).toBe(cfg.warnSustain); // counter pinned at threshold

    // FAIL during quiet hours -> STILL pushes (FAIL bypasses quiet hours)
    d = decide(d.next, v("FAIL", "DAEMON_DOWN", "down"), cfg, NOW);
    expect(d.alert?.kind).toBe("fail");
    expect(d.alert?.toKey).toBe("FAIL/DAEMON_DOWN");
    expect(d.next.alerted).toBe(true);
  });
});

describe("oracle 11: a probe with NO verdict line -> synthetic FAIL NO_VERDICT alerts", () => {
  // The runner synthesizes {FAIL, NO_VERDICT, ...} when a probe emits no verdict line; that
  // synthesis is tested in test/parser.test.ts. Here we feed decide() that synthetic verdict and
  // assert POLICY alerts on it like any other FAIL transition.
  test("FAIL NO_VERDICT transition fires immediately", () => {
    const cfg = mkConfig();
    const d = decide(
      fresh(),
      v("FAIL", "NO_VERDICT", "probe emitted no verdict line"),
      cfg,
      NOW,
    );
    expect(d.alert?.kind).toBe("fail");
    expect(d.alert?.toKey).toBe("FAIL/NO_VERDICT");
  });
});

describe("oracle 12 (BUG): a WARN tag-change must not be swallowed", () => {
  const cfg = mkConfig({ warnSustain: 2 });

  test("drifting WARN/A -> WARN/B re-matures and pushes B (transition resets alerted)", () => {
    // seed OK
    let d = decide(fresh(), v("OK", "NOMINAL", "start"), cfg, NOW);
    // mature WARN/CPU_HOG to an alert (sweep 1 silent, sweep 2 pushes)
    d = decide(d.next, v("WARN", "CPU_HOG", "hot"), cfg, NOW);
    expect(d.alert).toBeUndefined();
    d = decide(d.next, v("WARN", "CPU_HOG", "hot"), cfg, NOW);
    expect(d.alert?.kind).toBe("warn");
    expect(d.alert?.toKey).toBe("WARN/CPU_HOG");
    expect(d.next.alerted).toBe(true);

    // drift to a DIFFERENT WARN tag: the new state is fresh -> alerted resets, so it must
    // re-mature (not stay swallowed because it inherited CPU_HOG's alerted=1).
    d = decide(d.next, v("WARN", "MEMORY_PRESSURE", "swap"), cfg, NOW);
    expect(d.alert).toBeUndefined(); // tag-change sweep 1 silent (re-maturing)
    expect(d.next.alerted).toBe(false); // <-- the bug fix
    expect(d.next.sweepCount).toBe(1);

    d = decide(d.next, v("WARN", "MEMORY_PRESSURE", "swap"), cfg, NOW);
    expect(d.alert?.kind).toBe("warn"); // MEMORY_PRESSURE pushes (not swallowed)
    expect(d.alert?.toKey).toBe("WARN/MEMORY_PRESSURE");
  });
});

describe("oracle 13 (BUG): quiet-hours DEFERS (does not drop) a WARN", () => {
  test("a WARN suppressed in quiet hours delivers on the next non-quiet sweep", () => {
    const quiet = mkConfig({ warnSustain: 1, ...ALWAYS_QUIET });
    const open = mkConfig({ warnSustain: 1, ...NEVER_QUIET });

    // seed OK (quiet)
    let d = decide(fresh(), v("OK", "NOMINAL", "start"), quiet, NOW);
    // WARN in quiet hours -> held
    d = decide(d.next, v("WARN", "DISK_HIGH", "88%"), quiet, NOW);
    expect(d.alert).toBeUndefined();
    expect(d.next.sweepCount).toBe(quiet.warnSustain); // pinned so it fires immediately later
    expect(d.next.alerted).toBe(false);
    // same WARN now OUTSIDE quiet hours -> must deliver
    d = decide(d.next, v("WARN", "DISK_HIGH", "88%"), open, NOW);
    expect(d.alert?.kind).toBe("warn");
    expect(d.alert?.toKey).toBe("WARN/DISK_HIGH");
  });
});

describe("oracle 14 (BUG): a never-delivered (quiet-dropped) WARN must not mis-fire a recovery", () => {
  const cfg = mkConfig({ warnSustain: 1, ...ALWAYS_QUIET });

  test("WARN suppressed then OK -> no phantom recovery (prevAlerted stayed false)", () => {
    // seed OK (quiet)
    let d = decide(fresh(), v("OK", "NOMINAL", "start"), cfg, NOW);
    // WARN suppressed, never delivered (alerted stays false)
    d = decide(d.next, v("WARN", "CPU_HOG", "hot"), cfg, NOW);
    expect(d.alert).toBeUndefined();
    expect(d.next.alerted).toBe(false);
    // OK: no alerted state to recover from -> silent (no phantom "recovered")
    d = decide(d.next, v("OK", "NOMINAL", "fine"), cfg, NOW);
    expect(d.alert).toBeUndefined();
  });
});

describe("oracle 15 (BUG): a MISSING probe surfaces as FAIL PROBE_MISSING (not silently skipped)", () => {
  // The runner synthesizes {FAIL, PROBE_MISSING, ...} for a missing/unexecutable probe (tested in
  // Task 8's suites). Here we feed that synthetic verdict and assert POLICY alerts on it.
  test("FAIL PROBE_MISSING transition fires immediately", () => {
    const cfg = mkConfig({ warnSustain: 1 });
    const d = decide(
      fresh(),
      v("FAIL", "PROBE_MISSING", "probe is missing or not executable"),
      cfg,
      NOW,
    );
    expect(d.alert?.kind).toBe("fail");
    expect(d.alert?.toKey).toBe("FAIL/PROBE_MISSING");
  });
});

describe("oracle 16 (BUG): a recovery during quiet hours must NOT be dropped", () => {
  test("FAIL (never-quiet) then OK (quiet) still pushes recovery; final state OK/alerted=0", () => {
    const open = mkConfig(NEVER_QUIET);
    const quiet = mkConfig(ALWAYS_QUIET);

    // seed OK (never quiet)
    let d = decide(fresh(), v("OK", "NOMINAL", "start"), open, NOW);
    // FAIL -> alerts
    d = decide(d.next, v("FAIL", "DAEMON_DOWN", "down"), open, NOW);
    expect(d.alert?.kind).toBe("fail");
    expect(d.next.alerted).toBe(true);
    // recovery during quiet hours -> STILL pushes (recovery bypasses quiet)
    d = decide(d.next, v("OK", "NOMINAL", "recovered"), quiet, NOW);
    expect(d.alert?.kind).toBe("recovery");
    expect(d.alert?.fromKey).toBe("FAIL/DAEMON_DOWN");
    // final state: OK NOMINAL, count 0, alerted 0 (recovery resets alerted) — bash asserts "OK NOMINAL 0 0"
    expect(d.next.verdict.status).toBe("OK");
    expect(d.next.verdict.tag).toBe("NOMINAL");
    expect(d.next.sweepCount).toBe(0);
    expect(d.next.alerted).toBe(false);
  });
});

describe("oracle 17: WARN during quiet hours is still deferred (not over-broadened)", () => {
  test("WARN held in quiet hours, delivered once out of quiet hours", () => {
    const quiet = mkConfig({ warnSustain: 1, ...ALWAYS_QUIET });
    const open = mkConfig({ warnSustain: 1, ...NEVER_QUIET });

    let d = decide(fresh(), v("OK", "NOMINAL", "start"), quiet, NOW);
    d = decide(d.next, v("WARN", "CPU_HOG", "hot"), quiet, NOW);
    expect(d.alert).toBeUndefined(); // still deferred (not delivered like FAIL/recovery)
    d = decide(d.next, v("WARN", "CPU_HOG", "hot"), open, NOW);
    expect(d.alert?.kind).toBe("warn");
    expect(d.alert?.toKey).toBe("WARN/CPU_HOG");
  });
});

describe("oracle 18: FAIL re-alert -> a standing FAIL re-pushes every N sweeps", () => {
  const cfg = mkConfig({ failRemindSweeps: 2, ...NEVER_QUIET });

  test("FAIL first push, then silent until the reminder is due after N sweeps", () => {
    // seed OK
    let d = decide(fresh(), v("OK", "NOMINAL", "start"), cfg, NOW);
    // FAIL first push
    d = decide(d.next, v("FAIL", "DAEMON_DOWN", "down"), cfg, NOW);
    expect(d.alert?.kind).toBe("fail");
    expect(d.next.sweepCount).toBe(0);
    // sweep after FAIL: reminder not due yet
    d = decide(d.next, v("FAIL", "DAEMON_DOWN", "down"), cfg, NOW);
    expect(d.alert).toBeUndefined();
    expect(d.next.sweepCount).toBe(1);
    // FAIL reminder re-pushes after N=2 sweeps, then counter resets to 0
    d = decide(d.next, v("FAIL", "DAEMON_DOWN", "down"), cfg, NOW);
    expect(d.alert?.kind).toBe("fail");
    expect(d.next.sweepCount).toBe(0);
  });
});

describe("oracle 19: FAIL re-alert OFF by default (failRemindSweeps=0)", () => {
  const cfg = mkConfig({ failRemindSweeps: 0, ...NEVER_QUIET });

  test("a standing FAIL never re-pushes when reminders are disabled", () => {
    let d = decide(fresh(), v("OK", "NOMINAL", "start"), cfg, NOW);
    d = decide(d.next, v("FAIL", "DAEMON_DOWN", "down"), cfg, NOW); // first push
    expect(d.alert?.kind).toBe("fail");
    d = decide(d.next, v("FAIL", "DAEMON_DOWN", "down"), cfg, NOW);
    expect(d.alert).toBeUndefined(); // no reminder when disabled
    d = decide(d.next, v("FAIL", "DAEMON_DOWN", "down"), cfg, NOW);
    expect(d.alert).toBeUndefined(); // still no reminder when disabled
  });
});

describe("invariant: next.since is always a non-empty string (ProbeStateInsertSchema)", () => {
  test("even an OK/NONE -> OK/NONE unchanged sweep from the fresh default yields non-empty since", () => {
    const cfg = mkConfig();
    // fresh() has since:"" and verdict OK/NONE; feeding OK/NONE again is an *unchanged* sweep, the
    // one path where since would otherwise carry the empty string forward.
    const d = decide(fresh(), v("OK", "NONE", ""), cfg, NOW);
    expect(d.alert).toBeUndefined();
    expect(d.next.since.length).toBeGreaterThan(0);
  });
});
