// The verdict parser + probe runner — the bridge between the small-model-skills bash
// diagnostic probes and typed Verdicts. Loosely follows the bash reference:
//   ~/Development/small-model-skills/monitor/bin/smon's `parse_verdict` function and the
//   probe-exec block of `eval_probe`.
// Contract: ~/Development/small-model-skills/docs/verdict-contract.md.
//
// Pure TypeScript runtime glue for Task 12's sweep loop — no metaobjects machinery here.
//
// DELIBERATE DIVERGENCE FROM BASH (owner-approved): the bash reference has two latent parsing
// bugs (see VERDICT_LINE_PATTERN below). smon is the source of truth for CORRECTNESS against
// the published contract, not for byte-for-byte parity with bash's bugs, so both are fixed here
// even though the bash script still has them.

import type { Verdict, VerdictStatus } from "../generated";
import { PROBES, type ProbeName } from "../generated/probes/roster";

const VERDICT_PREFIX = "verdict: ";

// The one correct pattern for a well-formed verdict line, straight from the published grammar
// (verdict-contract.md §1 and §3): `verdict: <STATUS> <TAG> — <prose>` where STATUS is one of
// OK|WARN|FAIL and TAG matches `^[A-Z][A-Z0-9_]{1,23}$` (starts with a letter, 2-24 chars total,
// digits legal). The separator is a literal " — " (space, em dash U+2014, space).
//
// Bash's reference implementation gets this wrong two ways that smon fixes rather than mirrors:
//  1. Its prose-stripping sed pattern is `s/^verdict: [A-Z]* [A-Z_]* — //` — the tag portion
//     excludes digits, so a real tag containing one (e.g. `DISK90`) makes the whole substitution
//     fail to match anywhere in the line, and since sed's `s///` leaves a non-matching line
//     untouched, the "prose" falls back to the entire raw verdict line instead of just the text
//     after the em dash.
//  2. Bash's tag check only rejects an empty tag or a tag that is literally the em dash itself
//     (awk's field 3 landing on the separator when the tag is missing) — anything else,
//     including lowercase or out-of-length garbage, is accepted verbatim as TAG with no grammar
//     validation at all.
// smon parses status/tag/prose with a single regex built from the real grammar, and treats any
// verdict line that doesn't match it (valid STATUS but a TAG that fails the grammar) as
// malformed — the same FAIL/BAD_VERDICT shape already used for an invalid STATUS.
const VERDICT_LINE_PATTERN = /^verdict: (OK|WARN|FAIL) ([A-Z][A-Z0-9_]{1,23}) — (.*)$/;

function isVerdictStatus(value: string): value is VerdictStatus {
  return value === "OK" || value === "WARN" || value === "FAIL";
}

/**
 * Parse a probe's full stdout into a Verdict.
 *  - `grep -m1 '^verdict: '`-equivalent: the FIRST line starting at column 0 with "verdict: "
 *    wins. A verdict line that isn't at column 0 (indented, or preceded by other text on that
 *    line) is invisible to this parser — it falls through to NO_VERDICT (or to a later matching
 *    line, if any). This column-0 anchoring matches bash's `grep -m1 '^verdict: '` and is
 *    correct, not a bug.
 *  - no such line                   -> FAIL/NO_VERDICT, prose "probe emitted no verdict line".
 *  - line matches the full grammar  -> the parsed {status, tag, prose}; prose is exactly the
 *    text after the em dash (a tag with digits, e.g. `DISK90`, parses fine — see above).
 *  - STATUS not OK|WARN|FAIL        -> FAIL/BAD_VERDICT, prose "unparseable verdict: <line>".
 *  - TAG empty or literally "—" (awk's 3rd field lands on the em dash when the tag is missing,
 *    e.g. "verdict: OK — prose") -> FAIL/BAD_VERDICT, prose "malformed verdict (missing tag): <line>".
 *  - STATUS valid but TAG doesn't match `^[A-Z][A-Z0-9_]{1,23}$` (lowercase, too short/long,
 *    leading digit, etc.), or the line otherwise doesn't fit the contract shape -> FAIL/BAD_VERDICT,
 *    prose "unparseable verdict: <line>" (same shape as an invalid STATUS — both mean "this line
 *    doesn't parse as a verdict", so both get the same treatment).
 */
export function parseVerdict(stdout: string): Verdict {
  const vline = stdout.split("\n").find((line) => line.startsWith(VERDICT_PREFIX));
  if (vline === undefined) {
    return { status: "FAIL", tag: "NO_VERDICT", prose: "probe emitted no verdict line" };
  }

  const match = vline.match(VERDICT_LINE_PATTERN);
  if (match) {
    const status = match[1] ?? "";
    const tag = match[2] ?? "";
    const prose = match[3] ?? "";
    return { status: status as VerdictStatus, tag, prose };
  }

  // Didn't fit the full contract shape. awk-style field splitting to figure out *why*, so the
  // two malformed cases (invalid STATUS vs. missing TAG) keep their existing, distinct prose.
  const fields = vline.trim().split(/\s+/);
  const status = fields[1] ?? "";
  if (!isVerdictStatus(status)) {
    return { status: "FAIL", tag: "BAD_VERDICT", prose: `unparseable verdict: ${vline}` };
  }

  const tag = fields[2] ?? "";
  if (tag === "" || tag === "—") {
    return { status: "FAIL", tag: "BAD_VERDICT", prose: `malformed verdict (missing tag): ${vline}` };
  }

  // Valid STATUS, non-empty tag, but the line still didn't match the full grammar — the TAG
  // fails `^[A-Z][A-Z0-9_]{1,23}$` (lowercase, wrong length, leading digit, ...) or the
  // separator isn't exactly " — ". Malformed — reuse the same FAIL/BAD_VERDICT shape as an
  // invalid STATUS so both malformed cases are consistent.
  return { status: "FAIL", tag: "BAD_VERDICT", prose: `unparseable verdict: ${vline}` };
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
