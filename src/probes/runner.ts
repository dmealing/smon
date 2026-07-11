// The verdict parser + probe runner — the bridge between the small-model-skills bash
// diagnostic probes and typed Verdicts. Mirrors, byte-for-byte, the bash reference:
//   ~/Development/small-model-skills/monitor/bin/smon's `parse_verdict` function and the
//   probe-exec block of `eval_probe`.
// Contract: ~/Development/small-model-skills/docs/verdict-contract.md.
//
// Pure TypeScript runtime glue for Task 12's sweep loop — no metaobjects machinery here.

import type { Verdict, VerdictStatus } from "../generated";
import { PROBES, type ProbeName } from "../generated/probes/roster";

const VERDICT_PREFIX = "verdict: ";

// Mirrors bash's `sed 's/^verdict: [A-Z]* [A-Z_]* — //'`.
//
// NOTE (surprising bash behavior, reproduced deliberately): the tag portion of this pattern
// only allows [A-Z_] — no digits — even though the public tag grammar
// (`^[A-Z][A-Z0-9_]{1,23}$`, verdict-contract.md §3) permits them. If a real tag ever contains
// a digit, this pattern fails to match anywhere in the line, and — matching sed's `s///`
// leaving a non-matching line untouched — the "prose" falls back to the ENTIRE raw verdict
// line instead of just the text after the em dash. That's a genuine bug in the bash reference,
// not a design choice. It's mirrored here for byte-for-byte parity with the bash oracle (none
// of the current roster's tags contain digits, so it's latent today).
const PROSE_PATTERN = /^verdict: [A-Z]* [A-Z_]* — (.*)$/;

function isVerdictStatus(value: string): value is VerdictStatus {
  return value === "OK" || value === "WARN" || value === "FAIL";
}

/**
 * Parse a probe's full stdout into a Verdict. Mirrors bash `parse_verdict` exactly:
 *  - `grep -m1 '^verdict: '` — the FIRST line starting at column 0 with "verdict: " wins. A
 *    verdict line that isn't at column 0 (indented, or preceded by other text on that line) is
 *    invisible to this parser, same as bash's anchored grep — it falls through to NO_VERDICT
 *    (or to a later matching line, if any).
 *  - no such line             -> FAIL/NO_VERDICT, prose "probe emitted no verdict line".
 *  - STATUS not OK|WARN|FAIL  -> FAIL/BAD_VERDICT, prose "unparseable verdict: <line>".
 *  - TAG empty or literally "—" (awk's 3rd field lands on the em dash when the tag is missing,
 *    e.g. "verdict: OK — prose") -> FAIL/BAD_VERDICT, prose "malformed verdict (missing tag): <line>".
 *  - otherwise                -> the parsed {status, tag, prose}.
 *
 * Note bash's tag handling is looser than the published grammar: anything non-empty and not
 * "—" is accepted as TAG verbatim (no regex validation against `^[A-Z][A-Z0-9_]{1,23}$`). That
 * is mirrored here too — this parser does not reject a malformed-but-non-empty tag.
 */
export function parseVerdict(stdout: string): Verdict {
  const vline = stdout.split("\n").find((line) => line.startsWith(VERDICT_PREFIX));
  if (vline === undefined) {
    return { status: "FAIL", tag: "NO_VERDICT", prose: "probe emitted no verdict line" };
  }

  // awk field splitting: runs of whitespace, ignoring leading/trailing whitespace.
  const fields = vline.trim().split(/\s+/);
  const status = fields[1] ?? "";
  const tag = fields[2] ?? "";
  const proseMatch = vline.match(PROSE_PATTERN);
  const prose = proseMatch ? (proseMatch[1] ?? "") : vline;

  if (!isVerdictStatus(status)) {
    return { status: "FAIL", tag: "BAD_VERDICT", prose: `unparseable verdict: ${vline}` };
  }
  if (tag === "" || tag === "—") {
    return { status: "FAIL", tag: "BAD_VERDICT", prose: `malformed verdict (missing tag): ${vline}` };
  }
  return { status, tag, prose };
}

// bash: `: "${SMON_PROBE_TIMEOUT:=120}"` — seconds; defense against a hung probe.
const DEFAULT_PROBE_TIMEOUT_SECONDS = 120;

function defaultTimeoutMs(): number {
  const raw = process.env.SMON_PROBE_TIMEOUT;
  if (raw === undefined || raw === "") return DEFAULT_PROBE_TIMEOUT_SECONDS * 1000;
  const seconds = Number(raw);
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : DEFAULT_PROBE_TIMEOUT_SECONDS * 1000;
}

// bash `smols_is_timeout`: 124 (GNU/coreutils `timeout`), 137 (128+SIGKILL), 143 (128+SIGTERM).
// verdict-contract.md §5 says a consumer that wraps probes with its own timeout (as we do here)
// should treat these as a synthetic FAIL — exactly what runProbe does below.
function isTimeoutExitCode(code: number): boolean {
  return code === 124 || code === 137 || code === 143;
}

export interface RunProbeOptions {
  /** Milliseconds before treating the probe as PROBE_TIMEOUT. Defaults to `SMON_PROBE_TIMEOUT`
   *  (seconds, matching the bash reference's env var) or 120s. Override in tests to avoid
   *  waiting on the real default. */
  timeoutMs?: number;
  /** Resolve the probe's script from this directory instead of a bare-name PATH lookup.
   *  Production callers omit this — probes are installed on PATH (unlike the bash reference,
   *  which always execs a fixed `$PROBE_BIN/$probe` path). Tests point this at a fixture
   *  directory so `runProbe` is exercisable without the real small-model-skills probes
   *  installed. */
  binDir?: string;
}

function trySpawn(command: string) {
  try {
    return Bun.spawn([command], { stdout: "pipe", stderr: "ignore", detached: true });
  } catch {
    return undefined;
  }
}

/**
 * Run one roster probe and turn its outcome into a Verdict. Mirrors bash `eval_probe`'s
 * probe-exec block:
 *  - missing/non-executable binary -> FAIL/PROBE_MISSING (synthetic; the probe never ran).
 *  - killed by the timeout          -> FAIL/PROBE_TIMEOUT (synthetic).
 *  - otherwise                      -> `parseVerdict(stdout)`.
 *
 * The probe is spawned in its own process group (`detached: true`, i.e. `setsid()`), and on
 * timeout the WHOLE group is signalled, not just the direct child. This matters: a bash-script
 * probe that blocks in a foreground sub-process (e.g. its own `sleep`/`find`/`du`) absorbs a
 * plain SIGTERM sent only to itself but leaves it queued until that sub-process finishes on its
 * own — verified empirically while building this (see task-8-report.md). GNU coreutils
 * `timeout`, which the bash reference uses, avoids this by killing the whole process group by
 * default; group-killing here reproduces that reliability rather than the bug.
 */
export async function runProbe(name: ProbeName, opts: RunProbeOptions = {}): Promise<Verdict> {
  const { script } = PROBES[name];
  const timeoutMs = opts.timeoutMs ?? defaultTimeoutMs();
  const command = opts.binDir ? `${opts.binDir}/${script}` : script;

  const proc = trySpawn(command);
  if (!proc) {
    const where = opts.binDir ? ` at ${opts.binDir}` : "";
    return {
      status: "FAIL",
      tag: "PROBE_MISSING",
      prose: `probe '${name}' is missing or not executable${where}`,
    };
  }

  const timer = setTimeout(() => {
    try {
      process.kill(-proc.pid, "SIGTERM");
    } catch {
      // Already gone between the timer firing and the kill — nothing to do.
    }
  }, timeoutMs);

  try {
    const [stdout, exitCode] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
    if (isTimeoutExitCode(exitCode)) {
      return {
        status: "FAIL",
        tag: "PROBE_TIMEOUT",
        prose: `probe did not finish within ${timeoutMs / 1000}s`,
      };
    }
    return parseVerdict(stdout);
  } finally {
    clearTimeout(timer);
  }
}
