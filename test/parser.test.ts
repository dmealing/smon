// Task 8 — verdict parser + probe runner.
//
// parseVerdict is tested against the published contract (verdict-contract.md), not against the
// bash `parse_verdict` reference's bugs. smon deliberately diverges from bash on two points
// (see runner.ts's VERDICT_LINE_PATTERN comment): digits are legal in TAG (both for parsing and
// for prose extraction), and a TAG that doesn't match the grammar `^[A-Z][A-Z0-9_]{1,23}$` is
// rejected as malformed rather than accepted verbatim.
//
// runProbe is tested against throwaway fixture scripts under a temp `binDir`, never the real
// small-model-skills probes — they're actually installed on this host's PATH (verified via
// `command -v`), so exercising the bare-name PATH-lookup branch here would run real
// diagnostics non-deterministically instead of a controlled fixture.

import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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

  test("a digit in TAG parses correctly (deliberate divergence from a bash bug)", () => {
    // The contract's tag grammar (^[A-Z][A-Z0-9_]{1,23}$) permits digits. Bash's own prose sed
    // pattern (`[A-Z_]*`, no digits) can't match through a digit, so its substitution fails and
    // the whole raw line falls through as "prose" instead of just the text after the em dash —
    // a genuine bug in the bash reference. smon fixes it: prose is correctly extracted.
    expect(parseVerdict("verdict: OK DISK90 — 90% full")).toEqual({
      status: "OK",
      tag: "DISK90",
      prose: "90% full",
    });
  });

  test("a lowercase/garbage TAG is malformed FAIL/BAD_VERDICT, not accepted verbatim", () => {
    // Bash accepts any non-empty, non-em-dash tag verbatim, with no grammar validation. smon
    // enforces the published grammar instead — a lowercase tag is malformed, not "foo".
    const line = "verdict: OK foo — x";
    expect(parseVerdict(line)).toEqual({
      status: "FAIL",
      tag: "BAD_VERDICT",
      prose: `unparseable verdict: ${line}`,
    });
  });

  test("a single-character TAG is malformed — grammar requires 2-24 chars", () => {
    const line = "verdict: OK A — x";
    expect(parseVerdict(line)).toEqual({
      status: "FAIL",
      tag: "BAD_VERDICT",
      prose: `unparseable verdict: ${line}`,
    });
  });

  test("a valid 2-character TAG parses fine", () => {
    expect(parseVerdict("verdict: OK OK — x")).toEqual({
      status: "OK",
      tag: "OK",
      prose: "x",
    });
    expect(parseVerdict("verdict: WARN HI — x")).toEqual({
      status: "WARN",
      tag: "HI",
      prose: "x",
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
  // Pid-file paths for any long-lived, SIGTERM-trapping fixture a test spawns. Populated by the
  // test itself (the fixture writes its own pid to this file before installing the trap), and
  // swept unconditionally in afterEach below — an independent backstop that does NOT trust
  // runProbe to have done its job, so a regression in runProbe's SIGKILL escalation can't leak
  // the fixture process out of the test suite.
  const spawnedFixturePidFiles: string[] = [];

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

  afterEach(async () => {
    // Independent backstop, unconditional: force-kill any fixture pid a test tracked, whether
    // or not runProbe's own SIGKILL escalation succeeded, and whether or not the test itself
    // threw/timed out. Negated pid first (the fixture is spawned via `setsid`, so its own pid
    // doubles as its process-group id — same target runProbe signals), then the plain pid as a
    // fallback. Both are swallowed on ESRCH (already dead) or any other error.
    for (const pidFile of spawnedFixturePidFiles) {
      try {
        const pid = Number((await readFile(pidFile, "utf8")).trim());
        if (Number.isInteger(pid) && pid > 0) {
          try {
            process.kill(-pid, "SIGKILL");
          } catch {}
          try {
            process.kill(pid, "SIGKILL");
          } catch {}
        }
      } catch {
        // No pid file (fixture never started, or already cleaned up) — nothing to do.
      }
    }
    spawnedFixturePidFiles.length = 0;
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

  // Task 8 incident regression: a probe that traps/ignores SIGTERM makes
  // `proc.exited` never resolve, so the OLD runProbe (bare SIGTERM, then `await proc.exited`)
  // hung forever — a `bun test` run once pegged a CPU core for ~53 minutes this way. The timeout
  // guard must be unconditional: SIGTERM first, then an escalating SIGKILL backstop, and
  // `runProbe` must resolve either way instead of depending on the child ever cooperating.
  test("a probe that traps SIGTERM is force-killed via SIGKILL; runProbe still resolves to FAIL/PROBE_TIMEOUT", async () => {
    // Use the unused "smart-health" roster entry as this fixture's name — its `script` field
    // ("smart-health") is what runProbe resolves to `${binDir}/smart-health`, so the fixture
    // file must live at that exact path.
    const pidFile = join(binDir, "smart-health.pid");
    // Track this fixture's pid file so the afterEach backstop above can independently force-kill
    // it — regardless of whether runProbe's own SIGKILL escalation works — so a regression here
    // can't leak the fixture out of this test.
    spawnedFixturePidFiles.push(pidFile);
    // Writes its own pid before installing the trap, so the test can independently verify the
    // real OS process is dead afterward (the leak check) without relying on runProbe's return
    // value alone. `setsid`-spawned (detached:true), so this script's own pid is also its
    // process-group id — matching what runProbe negates when it signals the group.
    await writeFile(
      join(binDir, "smart-health"),
      `#!/usr/bin/env bash\necho $$ > "${pidFile}"\ntrap "" SIGTERM\nsleep 30\n`,
    );
    await chmod(join(binDir, "smart-health"), 0o755);

    // Hard test-level guard: if the fix regresses back to hanging on an uncooperative proc.exited,
    // fail the test promptly instead of hanging the whole suite for 30s+.
    let hangGuardTimer!: ReturnType<typeof setTimeout>;
    const hangGuard = new Promise<never>((_, reject) => {
      hangGuardTimer = setTimeout(
        () => reject(new Error("runProbe did not resolve — timeout handling is hanging again")),
        5000,
      );
    });

    // Clear the hang-guard timer as soon as the race settles (whichever side wins) so it never
    // dangles past this test — cosmetic, but there's no reason to leave a live timer behind.
    const verdict = await Promise.race([
      runProbe("smart-health", { binDir, timeoutMs: 300, killGraceMs: 300 }),
      hangGuard,
    ]).finally(() => clearTimeout(hangGuardTimer));

    expect(verdict).toEqual({
      status: "FAIL",
      tag: "PROBE_TIMEOUT",
      prose: "probe did not finish within 0.3s",
    });

    // Leak check: the trapped process must actually be dead (SIGKILL landed), not merely
    // abandoned as an orphan still holding a CPU core / sleeping for its full 30s.
    const pid = Number((await readFile(pidFile, "utf8")).trim());
    expect(Number.isInteger(pid) && pid > 0).toBe(true);

    const isAlive = () => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    };

    const deadline = Date.now() + 2000;
    while (isAlive() && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    expect(isAlive()).toBe(false);
  });
});
