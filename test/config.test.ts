// Task 11 — env -> typed Config, the "silent-typo killer". Mirrors the config block at the top
// of the bash reference (small-model-skills monitor/bin/smon, lines ~35-55): every SMON_* knob gets
// the same default bash applies via `: "${VAR:=default}"` (undefined OR empty string -> default,
// exactly src/notify/config.ts's optionalConfig rule). The one behavior bash does NOT have:
// SMON_NOTIFY/SMON_PROBES/SMON_FALLBACK_NOTIFY are validated against the real generated closed
// registries (AdapterName, ProbeName) instead of being trusted as free text -- an unknown token
// throws immediately instead of silently becoming a dead notify backend or a probe that never
// runs.
//
// No host data here: SMON_STATE_DIR/SMON_LOG/SMON_HOST defaults are host-dependent (derived from
// os.homedir()/os.hostname()), so expectations are computed the same way at test time instead of
// hardcoding this machine's real home path or hostname.

import { describe, expect, test } from "bun:test";
import { homedir, hostname } from "node:os";
import { join } from "node:path";
import { loadConfig } from "../src/config";

function expectedDefaultHost(): string {
  const short = hostname().split(".")[0];
  return short && short.length > 0 ? short : "host";
}

describe("loadConfig defaults (mirrors bash's `: \"${VAR:=default}\"` block)", () => {
  test("empty env -> bash's exact defaults", () => {
    const cfg = loadConfig({});
    expect(cfg.probes).toEqual(["sys-diag", "disk-report", "log-triage", "runaway-hunter"]);
    expect(cfg.notify).toEqual(["stdout"]);
    expect(cfg.fallbackNotify).toEqual([]);
    expect(cfg.brain).toBe("none");
    expect(cfg.claudeBin).toBe("claude");
    expect(cfg.stateDir).toBe(join(homedir(), ".local", "state", "smon"));
    expect(cfg.log).toBe(join(homedir(), "logs", "smon.log"));
    expect(cfg.host).toBe(expectedDefaultHost());
    expect(cfg.quietStart).toBe(23);
    expect(cfg.quietEnd).toBe(7);
    expect(cfg.warnSustain).toBe(2);
    expect(cfg.probeTimeoutSeconds).toBe(120);
    expect(cfg.failRemindSweeps).toBe(0);
    expect(cfg.digestHour).toBeNull();
    expect(cfg.enrichFail).toBe(false);
  });

  test("an explicitly empty string is treated the same as unset (bash's := semantics)", () => {
    const cfg = loadConfig({ SMON_NOTIFY: "", SMON_WARN_SUSTAIN: "" });
    expect(cfg.notify).toEqual(["stdout"]);
    expect(cfg.warnSustain).toBe(2);
  });
});

describe("loadConfig — closed-registry validation (the silent-typo killer)", () => {
  test("unknown SMON_NOTIFY token throws, naming the bad token and the valid set", () => {
    expect(() => loadConfig({ SMON_NOTIFY: "mattrix" })).toThrow(/mattrix/);
    expect(() => loadConfig({ SMON_NOTIFY: "mattrix" })).toThrow(/stdout/); // valid set mentioned
  });

  test("a misspelled probe throws", () => {
    expect(() => loadConfig({ SMON_PROBES: "sys-diagg" })).toThrow(/sys-diagg/);
  });

  test("one bad token among good ones still throws (no silent partial-accept)", () => {
    expect(() => loadConfig({ SMON_NOTIFY: "stdout kuuma" })).toThrow(/kuuma/);
  });

  test("an unknown SMON_FALLBACK_NOTIFY token throws too", () => {
    expect(() => loadConfig({ SMON_FALLBACK_NOTIFY: "bogus" })).toThrow(/bogus/);
  });

  test("valid multi-token SMON_NOTIFY parses every adapter, space-separated", () => {
    const cfg = loadConfig({ SMON_NOTIFY: "ha-push kuma stdout" });
    expect(cfg.notify).toEqual(["ha-push", "kuma", "stdout"]);
  });

  test("comma-separated (and mixed comma/space) SMON_NOTIFY also parses", () => {
    expect(loadConfig({ SMON_NOTIFY: "ha-push,kuma,stdout" }).notify).toEqual([
      "ha-push",
      "kuma",
      "stdout",
    ]);
    expect(loadConfig({ SMON_NOTIFY: "ha-push, kuma  stdout" }).notify).toEqual([
      "ha-push",
      "kuma",
      "stdout",
    ]);
  });

  test("valid multi-probe SMON_PROBES parses every probe", () => {
    const cfg = loadConfig({ SMON_PROBES: "smart-health ollama-doctor docker-hygiene" });
    expect(cfg.probes).toEqual(["smart-health", "ollama-doctor", "docker-hygiene"]);
  });

  test("SMON_FALLBACK_NOTIFY accepts a valid adapter list", () => {
    expect(loadConfig({ SMON_FALLBACK_NOTIFY: "stdout" }).fallbackNotify).toEqual(["stdout"]);
  });
});

describe("loadConfig — knob parsing", () => {
  test("overrides every knob from env", () => {
    const cfg = loadConfig({
      SMON_PROBES: "sys-diag",
      SMON_NOTIFY: "stdout",
      SMON_FALLBACK_NOTIFY: "stdout",
      SMON_BRAIN: "glm",
      SMON_CLAUDE_BIN: "/opt/bin/claude",
      SMON_STATE_DIR: "/var/lib/smon-state",
      SMON_LOG: "/var/log/smon.log",
      SMON_HOST: "example-host",
      SMON_QUIET_START: "22",
      SMON_QUIET_END: "6",
      SMON_WARN_SUSTAIN: "3",
      SMON_PROBE_TIMEOUT: "90",
      SMON_FAIL_REMIND_SWEEPS: "12",
      SMON_DIGEST_HOUR: "9",
      SMON_ENRICH_FAIL: "1",
    });
    expect(cfg).toEqual({
      probes: ["sys-diag"],
      notify: ["stdout"],
      fallbackNotify: ["stdout"],
      brain: "glm",
      claudeBin: "/opt/bin/claude",
      stateDir: "/var/lib/smon-state",
      log: "/var/log/smon.log",
      host: "example-host",
      quietStart: 22,
      quietEnd: 6,
      warnSustain: 3,
      probeTimeoutSeconds: 90,
      failRemindSweeps: 12,
      digestHour: 9,
      enrichFail: true,
    });
  });

  test("SMON_BRAIN=local is accepted", () => {
    expect(loadConfig({ SMON_BRAIN: "local" }).brain).toBe("local");
  });

  test("an unrecognized SMON_BRAIN value falls back to 'none' (matches bash's enrich(), which " +
    "treats any value other than glm/local identically to none -- no throw)", () => {
    expect(loadConfig({ SMON_BRAIN: "bogus-engine" }).brain).toBe("none");
  });

  test("SMON_ENRICH_FAIL only '1' means true; anything else (bash's != 1) means false", () => {
    expect(loadConfig({ SMON_ENRICH_FAIL: "1" }).enrichFail).toBe(true);
    expect(loadConfig({ SMON_ENRICH_FAIL: "0" }).enrichFail).toBe(false);
    expect(loadConfig({ SMON_ENRICH_FAIL: "yes" }).enrichFail).toBe(false);
    expect(loadConfig({}).enrichFail).toBe(false);
  });

  test("SMON_DIGEST_HOUR blank means off (null); a numeric hour is parsed", () => {
    expect(loadConfig({}).digestHour).toBeNull();
    expect(loadConfig({ SMON_DIGEST_HOUR: "" }).digestHour).toBeNull();
    expect(loadConfig({ SMON_DIGEST_HOUR: "0" }).digestHour).toBe(0);
    expect(loadConfig({ SMON_DIGEST_HOUR: "17" }).digestHour).toBe(17);
  });

  test("a non-numeric numeric knob falls back to its default rather than propagating NaN", () => {
    expect(loadConfig({ SMON_WARN_SUSTAIN: "not-a-number" }).warnSustain).toBe(2);
    expect(loadConfig({ SMON_QUIET_START: "late" }).quietStart).toBe(23);
    expect(loadConfig({ SMON_DIGEST_HOUR: "noon" }).digestHour).toBeNull();
  });
});

describe("loadConfig — no host-data leakage", () => {
  test("Config never embeds a hardcoded personal path or hostname literal from this file", () => {
    // Defaults are derived (os.homedir()/os.hostname()), not string-literal-baked -- this test
    // exists to document that expectation, not to inspect the source text itself.
    const cfg = loadConfig({});
    expect(cfg.stateDir.startsWith(homedir())).toBe(true);
  });
});
