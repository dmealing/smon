// Task 10 — LLM enrichment with fallback-to-raw. Mirrors bash `enrich()`
// (small-model-skills monitor/bin/smon): SMON_BRAIN selects the engine (none/glm/
// local); ANY failure (bad config, spawn error, non-zero exit, empty/unparseable output, timeout)
// falls back to the raw verdict prose — enrich() never throws. The injected `spawn` dependency
// stands in for the real `claude` binary so these tests need neither network access nor a real
// `claude` install — see src/enrich/enrich.ts's EnrichSpawn/EnrichProc for the injection shape.
//
// The hang-guard test is this function's own incident regression, mirroring src/probes/runner.ts's
// runProbe/task-8 hang incident: a process whose output() never resolves must still make enrich()
// resolve to the raw prose within its (small, test-injected) timeout, with a real SIGKILL
// escalation — bounded here so a regression fails fast instead of hanging the whole suite.

import { describe, expect, test } from "bun:test";
import { enrich, type EnrichProc, type EnrichSpawn } from "../src/enrich/enrich";

const DIGEST = "bin: /path/to/disk-report\nverdict: WARN DISK_HIGH — 88% full\n";
const PROSE = "88% full";

function jsonProc(body: unknown, exitCode = 0): EnrichProc {
  return {
    async output() {
      return { stdout: JSON.stringify(body), exitCode };
    },
    kill() {},
  };
}

function rawProc(stdout: string, exitCode = 0): EnrichProc {
  return {
    async output() {
      return { stdout, exitCode };
    },
    kill() {},
  };
}

interface RecordedCall {
  command: readonly string[];
  env: Readonly<Record<string, string>>;
}

function recordingSpawn(proc: EnrichProc): { spawn: EnrichSpawn; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const spawn: EnrichSpawn = (command, env) => {
    calls.push({ command, env });
    return proc;
  };
  return { spawn, calls };
}

describe("enrich", () => {
  test("SMON_BRAIN=none returns prose unchanged and spawns nothing", async () => {
    const { spawn, calls } = recordingSpawn(jsonProc({ result: "should never be used" }));
    const out = await enrich(DIGEST, PROSE, { SMON_BRAIN: "none" }, { spawn });
    expect(out).toBe(PROSE);
    expect(calls).toHaveLength(0);
  });

  test("no SMON_BRAIN set defaults to none (matches bash's SMON_BRAIN:=none)", async () => {
    const { spawn, calls } = recordingSpawn(jsonProc({ result: "should never be used" }));
    const out = await enrich(DIGEST, PROSE, {}, { spawn });
    expect(out).toBe(PROSE);
    expect(calls).toHaveLength(0);
  });

  test("SMON_BRAIN=local: valid {result} JSON returns the enriched text", async () => {
    const { spawn, calls } = recordingSpawn(jsonProc({ result: "Disk is nearly full; check df -h." }));
    const out = await enrich(DIGEST, PROSE, { SMON_BRAIN: "local" }, { spawn });
    expect(out).toBe("Disk is nearly full; check df -h.");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.command[0]).toBe("claude");
    expect(calls[0]!.command).toContain("-p");
    expect(calls[0]!.command).toContain("--output-format");
    expect(calls[0]!.command).toContain("json");
    expect(calls[0]!.command.join(" ")).toContain(DIGEST);
    // local mode adds no extra env, matching bash's `local` branch (relies on ambient env)
    expect(calls[0]!.env).toEqual({});
  });

  test("SMON_BRAIN=glm: routes to z.ai with the exact bash env vars", async () => {
    const { spawn, calls } = recordingSpawn(jsonProc({ result: "enriched via glm" }));
    const out = await enrich(DIGEST, PROSE, { SMON_BRAIN: "glm", SMON_ZAI_KEY: "fake-zai-key" }, { spawn });
    expect(out).toBe("enriched via glm");
    expect(calls[0]!.env).toEqual({
      ANTHROPIC_BASE_URL: "https://api.z.ai/api/anthropic",
      ANTHROPIC_AUTH_TOKEN: "fake-zai-key",
      ANTHROPIC_API_KEY: "",
      ANTHROPIC_MODEL: "glm-5.2",
    });
  });

  test("SMON_BRAIN=glm without SMON_ZAI_KEY falls back to prose without spawning", async () => {
    const { spawn, calls } = recordingSpawn(jsonProc({ result: "should never be used" }));
    const out = await enrich(DIGEST, PROSE, { SMON_BRAIN: "glm" }, { spawn });
    expect(out).toBe(PROSE);
    expect(calls).toHaveLength(0);
  });

  test("unrecognized SMON_BRAIN value falls back to prose without spawning", async () => {
    const { spawn, calls } = recordingSpawn(jsonProc({ result: "should never be used" }));
    const out = await enrich(DIGEST, PROSE, { SMON_BRAIN: "bogus" }, { spawn });
    expect(out).toBe(PROSE);
    expect(calls).toHaveLength(0);
  });

  test("spawn throwing synchronously falls back to prose", async () => {
    const spawn: EnrichSpawn = () => {
      throw new Error("spawn failed: claude not found");
    };
    const out = await enrich(DIGEST, PROSE, { SMON_BRAIN: "local" }, { spawn });
    expect(out).toBe(PROSE);
  });

  test("non-zero exit code falls back to prose", async () => {
    const { spawn } = recordingSpawn(jsonProc({ result: "ignored" }, 1));
    const out = await enrich(DIGEST, PROSE, { SMON_BRAIN: "local" }, { spawn });
    expect(out).toBe(PROSE);
  });

  test("empty .result falls back to prose", async () => {
    const { spawn } = recordingSpawn(jsonProc({ result: "" }));
    const out = await enrich(DIGEST, PROSE, { SMON_BRAIN: "local" }, { spawn });
    expect(out).toBe(PROSE);
  });

  test("missing .result key falls back to prose", async () => {
    const { spawn } = recordingSpawn(jsonProc({ notResult: "x" }));
    const out = await enrich(DIGEST, PROSE, { SMON_BRAIN: "local" }, { spawn });
    expect(out).toBe(PROSE);
  });

  test("non-JSON stdout falls back to prose", async () => {
    const { spawn } = recordingSpawn(rawProc("not json at all"));
    const out = await enrich(DIGEST, PROSE, { SMON_BRAIN: "local" }, { spawn });
    expect(out).toBe(PROSE);
  });

  // Incident-guard test: a `claude` process that never returns (hung child, ignores SIGTERM)
  // must not hang enrich() past its timeout, and must be forcibly killed rather than just
  // abandoned. Uses small injected timeoutMs/killGraceMs so this test itself stays bounded.
  test("a hung process falls back to prose after the timeout and is SIGKILLed", async () => {
    const kills: ("SIGTERM" | "SIGKILL")[] = [];
    const hungProc: EnrichProc = {
      output(): Promise<{ stdout: string; exitCode: number }> {
        // Never resolves — simulates a `claude` subprocess that never returns.
        return new Promise(() => {});
      },
      kill(signal) {
        kills.push(signal);
      },
    };
    const spawn: EnrichSpawn = () => hungProc;

    const start = Date.now();
    const out = await enrich(DIGEST, PROSE, { SMON_BRAIN: "local" }, { spawn, timeoutMs: 50, killGraceMs: 30 });
    const elapsed = Date.now() - start;

    expect(out).toBe(PROSE);
    expect(elapsed).toBeLessThan(2000); // resolved promptly — proves it isn't waiting on the real 60s default
    expect(kills).toEqual(["SIGTERM", "SIGKILL"]);
  });
});
