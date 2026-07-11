// Turns a terse probe verdict into a short, actionable message via a cheap LLM. Enrichment is
// GARNISH: it must never break or hang the alert path. SMON_BRAIN=none skips the model call
// entirely; any other engine failure (spawn error, non-zero exit, empty/unparseable output,
// timeout) falls back to the raw `prose` unchanged. Mirrors bash's `enrich()`:
//   ~/Development/small-model-skills/monitor/bin/smon
//
// Prompt text — why this doesn't use the metaobjects EnrichmentPrompt template: Task 4's
// `EnrichmentPrompt` (templates/prompts/enrichment.mustache, rendered via
// `renderEnrichmentPrompt` in src/generated/prompts.ts) is declared against a `ProbeState`
// payload (probe/verdict.status/verdict.tag/verdict.prose/since/sweepCount/alerted) — richer
// than what `enrich()` receives here (just `digest` + `prose`, matching bash's own two-arg
// `enrich(digest, prose)`). The template has no placeholder for the raw digest text at all, so
// rendering it from this two-string signature would mean either inventing the missing ProbeState
// fields or losing the digest entirely — forcing a fit that doesn't exist. `buildPrompt` below
// therefore reproduces bash's fixed prompt text verbatim instead; the metaobjects template stays
// available (unused by this file) for a future caller that actually holds a full ProbeState.
//
// Timeout safety (non-negotiable): a prior `runProbe` bug (src/probes/runner.ts, task-8) spawned
// a subprocess with a SIGTERM-only timeout that hung forever when the child ignored SIGTERM,
// pegging a CPU core for ~53 minutes. `enrich()` spawns `claude -p` — an external binary this
// code doesn't control — so `runWithTimeout` below reuses runProbe's exact escalation shape:
// SIGTERM the process first (cooperative), then an unconditional SIGKILL backstop after a grace
// period, regardless of whether the child ever reports back; it always resolves. It's a
// deliberate re-implementation rather than an import from runner.ts: runProbe's version is keyed
// to a real OS pid/process group (its own tests spawn real fixture scripts on disk), while this
// one operates on the injected `EnrichProc` abstraction so it's exercisable with a fake "hung"
// process with no real subprocess or OS signals involved (see test/enrich.test.ts) — sharing one
// helper would mean forcing both shapes through a common interface for little real gain.

import { optionalConfig } from "../notify/config";

const ZAI_BASE_URL = "https://api.z.ai/api/anthropic";
const ZAI_MODEL = "glm-5.2";

// bash: `smols_timeout 60 ... claude -p ...` — both the glm and local branches use this same cap.
const DEFAULT_TIMEOUT_MS = 60_000;
// bash has no equivalent (its `timeout` isn't invoked with `-k`); mirrors runProbe's own default.
const DEFAULT_KILL_GRACE_MS = 2000;

/**
 * A handle over a spawned `claude` process, abstracted so tests can inject a fake one without a
 * real subprocess or real OS signals.
 */
export interface EnrichProc {
  /** Resolves once the process exits, with its full stdout and exit code. Should not reject for
   *  a normal non-zero exit — only for a genuine spawn/stream failure. */
  output(): Promise<{ stdout: string; exitCode: number }>;
  /** Send a signal to the process (its whole process group, for the real implementation). Must
   *  never throw. */
  kill(signal: "SIGTERM" | "SIGKILL"): void;
}

export type EnrichSpawn = (
  command: readonly string[],
  env: Readonly<Record<string, string>>,
) => EnrichProc;

function defaultSpawn(command: readonly string[], env: Readonly<Record<string, string>>): EnrichProc {
  const proc = Bun.spawn([...command], {
    env: { ...process.env, ...env },
    stdout: "pipe",
    stderr: "ignore",
    // Own process group (setsid), matching runProbe — lets us signal any children `claude`
    // spawns, not just the top-level binary, on timeout.
    detached: true,
  });
  return {
    async output() {
      const [stdout, exitCode] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
      return { stdout, exitCode };
    },
    kill(signal) {
      try {
        process.kill(-proc.pid, signal);
      } catch {
        // Already gone — nothing to do.
      }
    },
  };
}

export interface EnrichDeps {
  /** Defaults to a real `Bun.spawn`. Inject a fake in tests to avoid a real `claude` binary. */
  spawn?: EnrichSpawn;
  /** Milliseconds before giving up and falling back to `prose`. Defaults to 60s (bash's
   *  `smols_timeout 60`). Override in tests to avoid waiting on the real default. */
  timeoutMs?: number;
  /** Milliseconds to wait after SIGTERM before an unconditional SIGKILL. Defaults to 2000ms.
   *  Override in tests to avoid waiting on the real default. */
  killGraceMs?: number;
}

/** Resolves to `value` after `ms`, exposing a `cancel()` so callers can always clear the timer
 *  (mirrors src/probes/runner.ts's identical helper). */
function delay<T>(ms: number, value: T): { promise: Promise<T>; cancel: () => void } {
  let timer: ReturnType<typeof setTimeout>;
  const promise = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(value), ms);
  });
  return { promise, cancel: () => clearTimeout(timer) };
}

type Outcome =
  | { kind: "finished"; stdout: string; exitCode: number }
  | { kind: "error" }
  | { kind: "timeout" };

/**
 * Runs `proc` to completion or gives up after `timeoutMs`. On timeout: SIGTERM the process first
 * (lets a cooperative `claude` clean up), then races a `killGraceMs` grace period against the
 * process actually finishing; if it hasn't by then, sends an unconditional SIGKILL backstop.
 * Either way, ALWAYS resolves to `{kind: "timeout"}` once the timeout fires — this never waits on
 * the process again afterward, so a `claude` that ignores SIGTERM (or is stuck uninterruptibly)
 * can never keep this — or `enrich()` — waiting.
 */
async function runWithTimeout(proc: EnrichProc, timeoutMs: number, killGraceMs: number): Promise<Outcome> {
  const outputPromise = proc.output();
  // Swallow an eventual rejection from the losing race branch (e.g. a killed process's stdout
  // stream erroring out after we've already moved on) so it never becomes an unhandled rejection.
  outputPromise.catch(() => {});

  const finishedOutcome: Promise<Outcome> = outputPromise.then(
    ({ stdout, exitCode }) => ({ kind: "finished", stdout, exitCode }),
    () => ({ kind: "error" }),
  );
  const { promise: timeoutSignal, cancel: cancelTimeout } = delay<Outcome>(timeoutMs, { kind: "timeout" });

  const first = await Promise.race([finishedOutcome, timeoutSignal]);
  cancelTimeout();
  if (first.kind !== "timeout") return first;

  proc.kill("SIGTERM");

  const { promise: graceSignal, cancel: cancelGrace } = delay(killGraceMs, "grace-expired" as const);
  const survived = await Promise.race([finishedOutcome.then(() => "settled" as const), graceSignal]);
  cancelGrace();

  if (survived === "grace-expired") {
    proc.kill("SIGKILL");
  }

  return { kind: "timeout" };
}

function buildPrompt(digest: string): string {
  // Fixed prompt text — see the file header for why this isn't the metaobjects EnrichmentPrompt
  // template. Verbatim match of bash's `enrich()` prompt.
  return (
    "You are a terse sysadmin assistant. Given this diagnostic output, reply in at most 2 " +
    "sentences: what the problem means and the single first thing to check. No preamble.\n\n" +
    digest
  );
}

/**
 * Enriches a terse verdict `prose` into a short, actionable message via a cheap LLM, given the
 * probe's raw `digest` output. GARNISH ONLY: any failure (bad/missing config, spawn error,
 * non-zero exit, empty or unparseable model output, or timeout) returns `prose` unchanged — this
 * function never throws and never hangs past `timeoutMs` (default 60s).
 *
 * `cfg.SMON_BRAIN` selects the engine:
 *  - "none" (default) — return `prose` immediately, no subprocess spawned at all.
 *  - "glm"  — z.ai's glm-5.2 via `claude -p` routed through z.ai's Anthropic-compatible endpoint
 *             (`ANTHROPIC_BASE_URL`/`ANTHROPIC_AUTH_TOKEN`/`ANTHROPIC_MODEL`, mirroring bash's
 *             exact env). Requires `cfg.SMON_ZAI_KEY`; without it, falls back to `prose` without
 *             spawning (mirrors bash's `[ -n "$key" ]` guard). Deliberate simplification vs.
 *             bash: bash's `enrich()` reads the key itself from a file at `$SMON_ZAI_ENV` at call
 *             time; here the caller (or a config-loading layer) resolves it once and passes it in
 *             via `cfg.SMON_ZAI_KEY` — the same pattern the notify adapters already use for
 *             secrets (e.g. `SMON_HA_TOKEN` in src/notify/impl/ha-push.ts takes the resolved
 *             token directly rather than re-running bash's `SMON_HA_TOKEN_CMD` resolution).
 *  - "local" — local model via `claude -p` with no extra env (mirrors bash's `local` branch,
 *              which likewise sets nothing — it relies on the ambient environment already being
 *              configured, e.g. by the `claude-local` launcher).
 *  - any other value — falls back to `prose` without spawning (matches bash: neither `if` branch
 *    fires, so `$out` stays empty).
 *
 * `cfg.SMON_CLAUDE_BIN` overrides the `claude` binary name/path (default "claude", mirrors bash).
 */
export async function enrich(
  digest: string,
  prose: string,
  cfg: Readonly<Record<string, string>>,
  deps: EnrichDeps = {},
): Promise<string> {
  const brain = optionalConfig(cfg, "SMON_BRAIN", "none");
  if (brain === "none") return prose;
  if (brain !== "glm" && brain !== "local") return prose;

  let env: Record<string, string> = {};
  if (brain === "glm") {
    const key = cfg["SMON_ZAI_KEY"];
    if (!key) return prose;
    env = {
      ANTHROPIC_BASE_URL: ZAI_BASE_URL,
      ANTHROPIC_AUTH_TOKEN: key,
      ANTHROPIC_API_KEY: "",
      ANTHROPIC_MODEL: ZAI_MODEL,
    };
  }

  const claudeBin = optionalConfig(cfg, "SMON_CLAUDE_BIN", "claude");
  const command = [claudeBin, "-p", buildPrompt(digest), "--output-format", "json"];

  const spawn = deps.spawn ?? defaultSpawn;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const killGraceMs = deps.killGraceMs ?? DEFAULT_KILL_GRACE_MS;

  let proc: EnrichProc;
  try {
    proc = spawn(command, env);
  } catch {
    return prose;
  }

  const outcome = await runWithTimeout(proc, timeoutMs, killGraceMs);
  if (outcome.kind !== "finished") return prose;
  if (outcome.exitCode !== 0) return prose;

  let parsed: unknown;
  try {
    parsed = JSON.parse(outcome.stdout);
  } catch {
    return prose;
  }

  const result = (parsed as { result?: unknown } | null)?.result;
  return typeof result === "string" && result.length > 0 ? result : prose;
}
