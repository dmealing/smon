// Task 11 — per-probe alert-policy state, persisted as JSON. Replaces bash's space-separated
// `$SMON_STATE_DIR/<probe>.state` file (`read_state`/`write_state` in
// small-model-skills monitor/bin/smon): "status tag pending_since sweep_count
// alerted", no prose. Here the same info lives in a typed ProbeState (src/generated/ProbeState.ts):
// {probe, verdict: {status, tag, prose}, since, sweepCount, alerted}.
//
// Uses a real temp directory (node:fs/promises mkdtemp) per test, mirroring test/parser.test.ts's
// pattern for filesystem-touching tests -- no host paths, no shared state between tests.

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readState, writeState } from "../src/domain/state";
import type { ProbeState } from "../src/generated";

let dirs: string[] = [];

async function freshDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "smon-state-test-"));
  dirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
  dirs = [];
});

describe("readState", () => {
  test("no state file yet -> fresh default state (bash's read_state fallback 'OK NONE 0 0 0')", async () => {
    const dir = await freshDir();
    expect(readState(dir, "sys-diag")).toEqual({
      probe: "sys-diag",
      verdict: { status: "OK", tag: "NONE", prose: "" },
      since: "",
      sweepCount: 0,
      alerted: false,
    });
  });

  test("the state directory itself not existing also falls back to the default (no throw)", async () => {
    const dir = join(await freshDir(), "does", "not", "exist", "yet");
    expect(readState(dir, "disk-report").probe).toBe("disk-report");
    expect(readState(dir, "disk-report").verdict.status).toBe("OK");
  });
});

describe("writeState / readState round trip", () => {
  test("round trip is lossless for a WARN state", async () => {
    const dir = await freshDir();
    const state: ProbeState = {
      probe: "disk-report",
      verdict: { status: "WARN", tag: "DISK_HIGH", prose: "88% full" },
      since: "2026-07-11T08:00:00Z",
      sweepCount: 3,
      alerted: true,
    };
    writeState(dir, state);
    expect(readState(dir, "disk-report")).toEqual(state);
  });

  test("round trip is lossless for a FAIL state with alerted=false", async () => {
    const dir = await freshDir();
    const state: ProbeState = {
      probe: "runaway-hunter",
      verdict: { status: "FAIL", tag: "PROBE_TIMEOUT", prose: "probe did not finish within 120s" },
      since: "",
      sweepCount: 0,
      alerted: false,
    };
    writeState(dir, state);
    expect(readState(dir, "runaway-hunter")).toEqual(state);
  });

  test("writeState creates the state directory if it doesn't exist yet (mirrors bash's mkdir -p)", async () => {
    const base = await freshDir();
    const dir = join(base, "nested", "state", "dir");
    expect(existsSync(dir)).toBe(false);
    const state: ProbeState = {
      probe: "smart-health",
      verdict: { status: "OK", tag: "NOMINAL", prose: "all clear" },
      since: "",
      sweepCount: 0,
      alerted: false,
    };
    writeState(dir, state);
    expect(existsSync(dir)).toBe(true);
    expect(readState(dir, "smart-health")).toEqual(state);
  });

  test("writing a second probe's state doesn't disturb the first's file", async () => {
    const dir = await freshDir();
    const a: ProbeState = {
      probe: "sys-diag",
      verdict: { status: "OK", tag: "NOMINAL", prose: "fine" },
      since: "",
      sweepCount: 0,
      alerted: false,
    };
    const b: ProbeState = {
      probe: "log-triage",
      verdict: { status: "FAIL", tag: "LOG_ERRORS", prose: "found errors" },
      since: "2026-07-11T09:00:00Z",
      sweepCount: 1,
      alerted: true,
    };
    writeState(dir, a);
    writeState(dir, b);
    expect(readState(dir, "sys-diag")).toEqual(a);
    expect(readState(dir, "log-triage")).toEqual(b);
  });

  test("state is persisted as JSON on disk (not bash's space-separated .state format)", async () => {
    const dir = await freshDir();
    const state: ProbeState = {
      probe: "ollama-doctor",
      verdict: { status: "OK", tag: "HEALTHY", prose: "" },
      since: "",
      sweepCount: 0,
      alerted: false,
    };
    writeState(dir, state);
    const raw = readFileSync(join(dir, "ollama-doctor.json"), "utf8");
    expect(() => JSON.parse(raw)).not.toThrow();
    expect(JSON.parse(raw)).toEqual(state);
  });
});
