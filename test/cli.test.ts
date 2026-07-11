// Task 13 — CLI surfaces + sweep-loop behavior, driven end-to-end through runCli() with every
// side-effecting collaborator injected: a FAKE probe runner (no real probe binary is ever
// spawned), a FAKE NotifyPort (no network/SMTP), a fixed clock, a no-op lock, and a temp state
// dir. Public-repo hygiene: host is "example-host", tokens are "fake-*" — never real infra.
//
// These tests are the executable proof of the bash-parity contract the sweep loop must hold:
// enrich-per-kind (don't-enrich-FAIL), dry-run prints instead of sends, transport failure ->
// fallback backends, quiet-hours WARN suppression, recovery clears `alerted`, state is persisted
// verbatim regardless of transport, heartbeat + opt-in digest at sweep end, and the flock guard.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli, type CliDeps, type CliNow, type LockHandle, type NotifyPort } from "../src/cli";
import type { AlertPayload, DigestPayload, HeartbeatPayload, ProbeState, Verdict } from "../src/generated";
import type { ProbeName } from "../src/generated/probes/roster";

// --- fakes ------------------------------------------------------------------------------------

function fixedNow(over: Partial<CliNow> = {}): () => CliNow {
  return () => ({ hour: 12, timestamp: "1700000000", date: "2026-01-01", ...over });
}

const noopLock = (): LockHandle => ({ release() {} });

function recordingPort() {
  const alerts: { name: string; payload: AlertPayload }[] = [];
  const digests: { name: string; payload: DigestPayload }[] = [];
  const heartbeats: HeartbeatPayload[] = [];
  const failAlertOn = new Set<string>();
  const port: NotifyPort = {
    async sendAlert(name, payload) {
      if (failAlertOn.has(name)) throw new Error(`${name} transport down`);
      alerts.push({ name, payload });
    },
    async sendDigest(name, payload) {
      digests.push({ name, payload });
    },
    async heartbeat(payload) {
      heartbeats.push(payload);
    },
  };
  return { port, alerts, digests, heartbeats, failAlertOn };
}

/** A fake probe runner: returns the canned verdict for a probe, defaulting to OK/NOMINAL. */
function fakeProbes(verdicts: Partial<Record<string, Verdict>>) {
  return async (name: ProbeName): Promise<Verdict> =>
    verdicts[name] ?? { status: "OK", tag: "NOMINAL", prose: "all nominal" };
}

const FAIL: Verdict = { status: "FAIL", tag: "DISK_CRITICAL", prose: "disk 98% full" };
const WARN: Verdict = { status: "WARN", tag: "CPU_HOG", prose: "sustained high load" };
const OK: Verdict = { status: "OK", tag: "NOMINAL", prose: "recovered" };

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "smon-cli-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function baseEnv(over: Record<string, string> = {}): NodeJS.ProcessEnv {
  return {
    SMON_HOST: "example-host",
    SMON_STATE_DIR: dir,
    SMON_LOG: join(dir, "smon.log"),
    SMON_NOTIFY: "stdout",
    ...over,
  };
}

/** Capture stdout lines and give a no-op logger + no-op lock, leaving probe/port/now to the test. */
function harness(over: Partial<CliDeps> = {}) {
  const out: string[] = [];
  const deps: CliDeps = {
    write: (l) => out.push(l),
    stderr: (l) => out.push(l),
    logLine: () => {},
    acquireLock: noopLock,
    now: fixedNow(),
    ...over,
  };
  return { out, deps };
}

function readStateFile(probe: string): ProbeState {
  return JSON.parse(readFileSync(join(dir, `${probe}.json`), "utf8")) as ProbeState;
}

// --- list surfaces ----------------------------------------------------------------------------

describe("--list-adapters", () => {
  test("shows all 5 adapters with a STATUS column, and never prints secret VALUES", async () => {
    const { out, deps } = harness({
      env: baseEnv({ SMON_HA_TOKEN: "super-secret-token", SMON_HA_URL: "x", SMON_HA_DEVICE: "d" }),
    });
    const code = await runCli(["--list-adapters"], deps);
    const text = out.join("\n");

    expect(code).toBe(0);
    for (const name of ["email", "ha-push", "kuma", "matrix", "stdout"]) {
      expect(text).toContain(name);
    }
    expect(text).toContain("stdout"); // stdout needs no config
    expect(text).toMatch(/stdout\s+stdout\s+configured/);
    // ha-push now has all 3 keys -> configured; the token VALUE must never appear.
    expect(text).not.toContain("super-secret-token");
    // an unconfigured adapter names its MISSING keys (names only).
    expect(text).toContain("missing: SMON_EMAIL_TO");
  });
});

describe("--list-probes", () => {
  test("lists every roster probe", async () => {
    const { out, deps } = harness();
    const code = await runCli(["--list-probes"], deps);
    const text = out.join("\n");
    expect(code).toBe(0);
    for (const p of [
      "sys-diag",
      "disk-report",
      "log-triage",
      "runaway-hunter",
      "smart-health",
      "docker-hygiene",
      "ollama-doctor",
    ]) {
      expect(text).toContain(p);
    }
  });
});

// --- dry-run ----------------------------------------------------------------------------------

describe("--dry-run", () => {
  test("prints the alert instead of sending it, and still advances state", async () => {
    const { port, alerts, heartbeats } = recordingPort();
    const { out, deps } = harness({
      env: baseEnv({ SMON_PROBES: "disk-report" }),
      notify: port,
      runProbe: fakeProbes({ "disk-report": FAIL }),
    });

    const code = await runCli(["--dry-run"], deps);
    const text = out.join("\n");

    expect(code).toBe(0);
    expect(text).toContain("[DRY FAIL]");
    expect(text).toContain("example-host: DISK_CRITICAL");
    expect(text).toContain("disk 98% full");
    expect(text).toContain("sweep: disk-report=FAIL");
    // nothing was actually dispatched...
    expect(alerts).toHaveLength(0);
    // ...but bash still runs the heartbeat and still writes state in dry-run.
    expect(heartbeats).toHaveLength(1);
    expect(readStateFile("disk-report").alerted).toBe(true);
  });
});

// --- real dispatch + enrich policy (bash eval_probe ~273–280) ---------------------------------

describe("sweep dispatch + enrich-per-kind policy", () => {
  test("FAIL ships raw (not enriched) by default and dispatches to each enabled backend", async () => {
    const { port, alerts } = recordingPort();
    const enrichCalls: { digest: string; prose: string }[] = [];
    const { deps } = harness({
      env: baseEnv({ SMON_PROBES: "disk-report" }),
      notify: port,
      runProbe: fakeProbes({ "disk-report": FAIL }),
      enrich: async (digest, prose) => {
        enrichCalls.push({ digest, prose });
        return `ENRICHED:${prose}`;
      },
    });

    const code = await runCli([], deps);
    expect(code).toBe(0);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.name).toBe("stdout");
    expect(alerts[0]!.payload.kind).toBe("fail");
    // FAIL is NOT enriched by default — body is the raw prose, and enrich() was never called.
    expect(alerts[0]!.payload.enrichedBody).toBe("disk 98% full");
    expect(enrichCalls).toHaveLength(0);
    expect(readStateFile("disk-report").alerted).toBe(true);
  });

  test("SMON_ENRICH_FAIL=1 opts FAIL into enrichment", async () => {
    const { port, alerts } = recordingPort();
    const enrichCalls: unknown[] = [];
    const { deps } = harness({
      env: baseEnv({ SMON_PROBES: "disk-report", SMON_ENRICH_FAIL: "1" }),
      notify: port,
      runProbe: fakeProbes({ "disk-report": FAIL }),
      enrich: async (_digest, prose) => {
        enrichCalls.push(prose);
        return `ENRICHED:${prose}`;
      },
    });
    await runCli([], deps);
    expect(enrichCalls).toHaveLength(1);
    expect(alerts[0]!.payload.enrichedBody).toBe("ENRICHED:disk 98% full");
  });

  test("WARN is enriched, and the digest passed to enrich carries the verdict line", async () => {
    const { port, alerts } = recordingPort();
    let seenDigest = "";
    const { deps } = harness({
      env: baseEnv({ SMON_PROBES: "sys-diag", SMON_WARN_SUSTAIN: "1" }),
      notify: port,
      runProbe: fakeProbes({ "sys-diag": WARN }),
      enrich: async (digest, prose) => {
        seenDigest = digest;
        return `ENRICHED:${prose}`;
      },
    });
    await runCli([], deps);
    expect(alerts[0]!.payload.kind).toBe("warn");
    expect(alerts[0]!.payload.enrichedBody).toBe("ENRICHED:sustained high load");
    expect(seenDigest).toContain("verdict: WARN CPU_HOG");
  });
});

// --- fallback (bash notify_send SMON_FALLBACK_NOTIFY) -----------------------------------------

describe("fallback notify", () => {
  test("when a primary backend's transport fails, the fallback backends are tried", async () => {
    const { port, alerts, failAlertOn } = recordingPort();
    failAlertOn.add("ha-push"); // primary transport is down (the infra we monitor)
    const { deps } = harness({
      env: baseEnv({ SMON_PROBES: "disk-report", SMON_NOTIFY: "ha-push", SMON_FALLBACK_NOTIFY: "stdout" }),
      notify: port,
      runProbe: fakeProbes({ "disk-report": FAIL }),
    });

    const code = await runCli([], deps);
    expect(code).toBe(0);
    // ha-push threw; stdout got the alert via the fallback path.
    expect(alerts.map((a) => a.name)).toEqual(["stdout"]);
    // state is still marked alerted — bash marks on ATTEMPT, never gated on transport success.
    expect(readStateFile("disk-report").alerted).toBe(true);
  });
});

// --- recovery (bash: alert only for a condition we'd alerted on; clears `alerted`) -------------

describe("recovery", () => {
  test("a FAIL that returns to OK emits a recovery (status OK) and clears alerted", async () => {
    const shared = recordingPort();
    // sweep 1: FAIL -> alerted
    await runCli(
      [],
      harness({
        env: baseEnv({ SMON_PROBES: "disk-report" }),
        notify: shared.port,
        runProbe: fakeProbes({ "disk-report": FAIL }),
      }).deps,
    );
    expect(readStateFile("disk-report").alerted).toBe(true);

    // sweep 2: OK -> recovery
    await runCli(
      [],
      harness({
        env: baseEnv({ SMON_PROBES: "disk-report" }),
        notify: shared.port,
        runProbe: fakeProbes({ "disk-report": OK }),
      }).deps,
    );

    const recovery = shared.alerts.find((a) => a.payload.kind === "recovery");
    expect(recovery).toBeDefined();
    expect(recovery!.payload.verdict.status).toBe("OK");
    expect(readStateFile("disk-report").alerted).toBe(false);
  });
});

// --- quiet hours (WARN deferrable; handled in decide()) ---------------------------------------

describe("quiet hours", () => {
  test("a maturing WARN in quiet hours is suppressed: no dispatch, left unalerted", async () => {
    const { port, alerts } = recordingPort();
    const { deps } = harness({
      // always-quiet regime (QS=0, QE=24) + sustain=1 so the WARN would otherwise fire immediately
      env: baseEnv({
        SMON_PROBES: "sys-diag",
        SMON_WARN_SUSTAIN: "1",
        SMON_QUIET_START: "0",
        SMON_QUIET_END: "24",
      }),
      notify: port,
      runProbe: fakeProbes({ "sys-diag": WARN }),
      now: fixedNow({ hour: 3 }),
    });

    const code = await runCli([], deps);
    expect(code).toBe(0);
    expect(alerts).toHaveLength(0); // suppressed
    expect(readStateFile("sys-diag").alerted).toBe(false);
  });
});

// --- --test-alert -----------------------------------------------------------------------------

describe("--test-alert", () => {
  test("sends one synthetic WARN alert through the backends, then a heartbeat", async () => {
    const { port, alerts, heartbeats } = recordingPort();
    const { deps } = harness({ env: baseEnv(), notify: port });
    const code = await runCli(["--test-alert"], deps);
    expect(code).toBe(0);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]!.payload.kind).toBe("warn");
    expect(alerts[0]!.payload.enrichedBody).toContain("notify path works");
    expect(heartbeats).toHaveLength(1);
  });
});

// --- heartbeat + digest -----------------------------------------------------------------------

describe("sweep-end heartbeat", () => {
  test("pushes a heartbeat carrying the per-probe summary", async () => {
    const { port, heartbeats } = recordingPort();
    const { deps } = harness({
      env: baseEnv({ SMON_PROBES: "disk-report sys-diag" }),
      notify: port,
      runProbe: fakeProbes({ "disk-report": OK, "sys-diag": OK }),
    });
    await runCli([], deps);
    expect(heartbeats).toHaveLength(1);
    expect(heartbeats[0]!.status).toBe("up");
    expect(heartbeats[0]!.msg).toContain("disk-report=OK");
    expect(heartbeats[0]!.msg).toContain("sys-diag=OK");
  });
});

describe("daily digest (opt-in via SMON_DIGEST_HOUR)", () => {
  test("dry-run prints a digest when the hour matches", async () => {
    const { port } = recordingPort();
    const { out, deps } = harness({
      env: baseEnv({ SMON_PROBES: "disk-report", SMON_DIGEST_HOUR: "12" }),
      notify: port,
      runProbe: fakeProbes({ "disk-report": OK }),
      now: fixedNow({ hour: 12 }),
    });
    await runCli(["--dry-run"], deps);
    const text = out.join("\n");
    expect(text).toContain("[DRY DIGEST OK]");
    expect(text).toContain("disk-report: OK NOMINAL");
  });

  test("real digest dispatches sendDigest to each backend and writes the once-a-day marker", async () => {
    const { port, digests } = recordingPort();
    const { deps } = harness({
      env: baseEnv({ SMON_PROBES: "disk-report", SMON_DIGEST_HOUR: "12" }),
      notify: port,
      runProbe: fakeProbes({ "disk-report": WARN }),
      now: fixedNow({ hour: 12 }),
    });
    await runCli([], deps);
    expect(digests).toHaveLength(1);
    expect(digests[0]!.payload.worstStatus).toBe("WARN");
    expect(readFileSync(join(dir, ".digest-sent"), "utf8").trim()).toBe("2026-01-01");
  });

  test("off when the hour doesn't match", async () => {
    const { port, digests } = recordingPort();
    const { deps } = harness({
      env: baseEnv({ SMON_PROBES: "disk-report", SMON_DIGEST_HOUR: "3" }),
      notify: port,
      runProbe: fakeProbes({ "disk-report": OK }),
      now: fixedNow({ hour: 12 }),
    });
    await runCli([], deps);
    expect(digests).toHaveLength(0);
  });
});

// --- single-instance lock + arg errors --------------------------------------------------------

describe("single-instance lock", () => {
  test("a contended lock skips the sweep and exits 0 without running probes", async () => {
    const { port, alerts, heartbeats } = recordingPort();
    let probeRan = false;
    const { deps } = harness({
      env: baseEnv({ SMON_PROBES: "disk-report" }),
      notify: port,
      runProbe: async () => {
        probeRan = true;
        return FAIL;
      },
      acquireLock: () => null, // another sweep already holds it
    });
    const code = await runCli([], deps);
    expect(code).toBe(0);
    expect(probeRan).toBe(false);
    expect(alerts).toHaveLength(0);
    expect(heartbeats).toHaveLength(0);
  });
});

describe("arg + config errors", () => {
  test("unknown flag -> usage, exit 2", async () => {
    const { deps } = harness();
    expect(await runCli(["--bogus"], deps)).toBe(2);
  });
  test("--once with no probe -> exit 2", async () => {
    const { deps } = harness();
    expect(await runCli(["--once"], deps)).toBe(2);
  });
  test("--once with an unknown probe -> exit 2", async () => {
    const { deps } = harness({ env: baseEnv() });
    expect(await runCli(["--once", "not-a-probe"], deps)).toBe(2);
  });
  test("--once runs a single probe through the pipeline", async () => {
    const { port, alerts } = recordingPort();
    const { deps } = harness({
      env: baseEnv(),
      notify: port,
      runProbe: fakeProbes({ "sys-diag": FAIL }),
    });
    const code = await runCli(["--once", "sys-diag"], deps);
    expect(code).toBe(0);
    expect(alerts.map((a) => a.payload.probe)).toEqual(["sys-diag"]);
  });
  test("an unknown SMON_NOTIFY token is a hard misconfig, exit 1", async () => {
    const { deps } = harness({ env: baseEnv({ SMON_NOTIFY: "nope" }) });
    expect(await runCli([], deps)).toBe(1);
  });
  test("whitespace-only SMON_PROBES -> no probes configured, exit 1", async () => {
    const { deps } = harness({ env: baseEnv({ SMON_PROBES: " " }) });
    expect(await runCli([], deps)).toBe(1);
  });
});
