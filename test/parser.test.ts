// Task 8 — verdict parser + probe runner.
//
// parseVerdict is tested against the bash `parse_verdict` reference
// (~/Development/small-model-skills/monitor/bin/smon) case-for-case, including its known
// quirks (see runner.ts's comments) — parity with bash is the point, since Task 12's sweep
// loop will be validated against a 33-case oracle ported from that same bash function.
//
// runProbe is tested against throwaway fixture scripts under a temp `binDir`, never the real
// small-model-skills probes — they're actually installed on this host's PATH (verified via
// `command -v`), so exercising the bare-name PATH-lookup branch here would run real
// diagnostics non-deterministically instead of a controlled fixture.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseVerdict, runProbe } from "../src/probes/runner";

describe("parseVerdict", () => {
  test("well-formed OK line parses to {OK, NOMINAL, prose}", () => {
    expect(parseVerdict("verdict: OK NOMINAL — all clear\n")).toEqual({
      status: "OK",
      tag: "NOMINAL",
      prose: "all clear",
    });
  });

  test("well-formed WARN line", () => {
    expect(
      parseVerdict("verdict: WARN CPU_HOG — one process is using ~104% of a core.\n"),
    ).toEqual({
      status: "WARN",
      tag: "CPU_HOG",
      prose: "one process is using ~104% of a core.",
    });
  });

  test("well-formed FAIL line", () => {
    expect(parseVerdict("verdict: FAIL PROBE_FAILED — could not read /proc/loadavg\n")).toEqual({
      status: "FAIL",
      tag: "PROBE_FAILED",
      prose: "could not read /proc/loadavg",
    });
  });

  test("no verdict line at all -> FAIL/NO_VERDICT", () => {
    expect(parseVerdict("bin: foo\ndescription: bar\nno verdict here\n")).toEqual({
      status: "FAIL",
      tag: "NO_VERDICT",
      prose: "probe emitted no verdict line",
    });
  });

  test("empty stdout -> FAIL/NO_VERDICT", () => {
    expect(parseVerdict("")).toEqual({
      status: "FAIL",
      tag: "NO_VERDICT",
      prose: "probe emitted no verdict line",
    });
  });

  test("junk status is malformed FAIL/BAD_VERDICT, prose embeds the raw line", () => {
    expect(parseVerdict("verdict: MAYBE FOO — x\n")).toEqual({
      status: "FAIL",
      tag: "BAD_VERDICT",
      prose: "unparseable verdict: verdict: MAYBE FOO — x",
    });
  });

  test("a verdict line NOT at column 0 (indented) is invisible — grep is anchored", () => {
    // bash's `grep -m1 '^verdict: '` would not match this line either, so it falls through
    // to NO_VERDICT exactly as if no verdict line were present at all.
    expect(parseVerdict("  verdict: OK NOMINAL — hidden by indentation\n")).toEqual({
      status: "FAIL",
      tag: "NO_VERDICT",
      prose: "probe emitted no verdict line",
    });
  });

  test("multiple verdict lines: the FIRST one wins", () => {
    expect(
      parseVerdict("verdict: WARN FIRST_TAG — first\nverdict: FAIL SECOND_TAG — second\n"),
    ).toEqual({
      status: "WARN",
      tag: "FIRST_TAG",
      prose: "first",
    });
  });

  test("missing tag (em dash lands in the tag slot) -> malformed FAIL/BAD_VERDICT", () => {
    // Two spaces between status and the em dash: awk's field 3 is "—" itself, which bash
    // explicitly checks for (`[ "$V_TAG" = "—" ]`).
    const line = "verdict: OK  — prose text\n";
    expect(parseVerdict(line)).toEqual({
      status: "FAIL",
      tag: "BAD_VERDICT",
      prose: `malformed verdict (missing tag): ${line.trimEnd()}`,
    });
  });

  test("surprising bash quirk: a digit in TAG breaks prose extraction (mirrored deliberately)", () => {
    // The contract's tag grammar (^[A-Z][A-Z0-9_]{1,23}$) permits digits, but bash's own prose
    // sed pattern (`[A-Z_]*`, no digits) can't match through a digit, so sed's substitution
    // fails and the whole raw line falls through as "prose" instead of just the text after the
    // em dash. This is a genuine bug in the bash reference, reproduced here for parity.
    const line = "verdict: OK AB12 — hello world";
    expect(parseVerdict(line)).toEqual({
      status: "OK",
      tag: "AB12",
      prose: line, // NOT "hello world" — matches the bash bug.
    });
  });

  test("the verdict line may be preceded and followed by other probe output", () => {
    const stdout = [
      "bin: /path/to/sys-diag",
      "description: system load/memory/thermal probe",
      "",
      "-- load --",
      "  1m 5m 15m: 0.42 0.51 0.60",
      "verdict: OK NOMINAL — all clear",
      "help[1]: run again after a workload change",
      "",
    ].join("\n");
    expect(parseVerdict(stdout)).toEqual({ status: "OK", tag: "NOMINAL", prose: "all clear" });
  });
});

describe("runProbe", () => {
  let binDir: string;

  beforeAll(async () => {
    binDir = await mkdtemp(join(tmpdir(), "smon-runner-test-"));

    await writeFile(
      join(binDir, "sys-diag"),
      "#!/usr/bin/env bash\necho 'verdict: OK NOMINAL — all clear'\n",
    );
    await chmod(join(binDir, "sys-diag"), 0o755);

    // Blocks in a foreground child (`sleep`) — proves runProbe kills the whole process group,
    // not just the top-level script, within the timeout (a bare SIGTERM to only the script's
    // own PID gets queued behind the sleep and doesn't fire until sleep finishes on its own).
    await writeFile(
      join(binDir, "disk-report"),
      "#!/usr/bin/env bash\nsleep 5\necho 'verdict: OK NOMINAL — should never print'\n",
    );
    await chmod(join(binDir, "disk-report"), 0o755);

    // Exists, but not executable.
    await writeFile(join(binDir, "runaway-hunter"), "#!/usr/bin/env bash\necho nope\n");
    await chmod(join(binDir, "runaway-hunter"), 0o644);
  });

  afterAll(async () => {
    await rm(binDir, { recursive: true, force: true });
  });

  test("runs a probe and parses its verdict", async () => {
    const verdict = await runProbe("sys-diag", { binDir });
    expect(verdict).toEqual({ status: "OK", tag: "NOMINAL", prose: "all clear" });
  });

  test("a hung probe (blocked in a foreground sub-process) -> FAIL/PROBE_TIMEOUT within the timeout", async () => {
    const start = Date.now();
    const verdict = await runProbe("disk-report", { binDir, timeoutMs: 200 });
    const elapsed = Date.now() - start;
    expect(verdict).toEqual({
      status: "FAIL",
      tag: "PROBE_TIMEOUT",
      prose: "probe did not finish within 0.2s",
    });
    // Generous slack, but must be nowhere near the fixture's 5s sleep — proves the whole
    // process group was killed, not just the top-level script left queued behind its child.
    expect(elapsed).toBeLessThan(4000);
  });

  test("missing binary -> FAIL/PROBE_MISSING", async () => {
    const verdict = await runProbe("log-triage", { binDir });
    expect(verdict).toEqual({
      status: "FAIL",
      tag: "PROBE_MISSING",
      prose: `probe 'log-triage' is missing or not executable at ${binDir}`,
    });
  });

  test("non-executable binary -> FAIL/PROBE_MISSING", async () => {
    const verdict = await runProbe("runaway-hunter", { binDir });
    expect(verdict).toEqual({
      status: "FAIL",
      tag: "PROBE_MISSING",
      prose: `probe 'runaway-hunter' is missing or not executable at ${binDir}`,
    });
  });
});
