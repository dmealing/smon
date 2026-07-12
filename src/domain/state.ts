// Per-probe alert-policy state, persisted as JSON -- the TS replacement for bash's
// space-separated `$SMON_STATE_DIR/<probe>.state` file (`read_state`/`write_state` in
// the bash reference — small-model-skills monitor/bin/smon). Consumed by Task 12's decide() and Task
// 13's sweep loop.
//
// Bash's on-disk shape is 5 positional fields: "status tag pending_since sweep_count alerted"
// (no prose -- it's re-derived from the probe's own output each sweep, not persisted). Here the
// same information lives in a typed ProbeState (src/generated/ProbeState.ts, modeled in Task 3):
// {probe, verdict: {status, tag, prose}, since, sweepCount, alerted}. The fresh default when no
// state file exists yet mirrors bash's fallback string "OK NONE 0 0 0":
// {status:"OK", tag:"NONE", prose:""}, since:"", sweepCount:0, alerted:false.
//
// Synchronous I/O throughout (matches the given readState/writeState signatures, which return
// ProbeState/void rather than a Promise) -- consistent with bash's own synchronous
// cat/redirect model and keeps Task 12/13 callers simple.
//
// Scope note: readState only special-cases a MISSING file (-> fresh default), matching the brief
// exactly. A file that exists but contains corrupt/malformed JSON is allowed to throw from
// JSON.parse -- this mirrors bash's own read_state, which has no validation of a `.state` file's
// contents either (garbage in, garbage out was already bash's behavior).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ProbeState } from "../generated";
import type { ProbeName } from "../generated/probes/roster";

function stateFile(dir: string, probe: string): string {
  return join(dir, `${probe}.json`);
}

function freshState(probe: ProbeName): ProbeState {
  return {
    probe,
    verdict: { status: "OK", tag: "NONE", prose: "" },
    since: "",
    sweepCount: 0,
    alerted: false,
  };
}

/**
 * Reads `probe`'s persisted state from `dir`. Returns a fresh default state (matching bash's
 * `read_state` fallback "OK NONE 0 0 0") when the file doesn't exist yet -- a probe that has
 * never swept (or whose state dir doesn't exist yet) has no history to compare against.
 */
export function readState(dir: string, probe: ProbeName): ProbeState {
  const file = stateFile(dir, probe);
  if (!existsSync(file)) return freshState(probe);
  return JSON.parse(readFileSync(file, "utf8")) as ProbeState;
}

/**
 * Persists `state` to `dir`, keyed by `state.probe` (mirrors bash's `write_state`). Creates
 * `dir` if it doesn't exist yet (mirrors bash's `mkdir -p "$SMON_STATE_DIR"` at startup).
 */
export function writeState(dir: string, state: ProbeState): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(stateFile(dir, state.probe), `${JSON.stringify(state, null, 2)}\n`, "utf8");
}
