// smon CLI — the runnable entrypoint that wires every module (Tasks 3–12) into a sweep.
//
// This is the integration layer: a faithful TS port of the bash reference's `cli`/sweep
// (~/Development/small-model-skills/monitor/bin/smon). Per sweep, for each configured probe it
//   runProbe (src/probes/runner.ts, SIGKILL-escalating timeout — never unbounded)
//     -> decide (src/domain/policy.ts, the pure alert-policy state machine incl. quiet hours)
//       -> on an alert: build an AlertPayload, enrich PER POLICY (below), dispatch to each
//          enabled adapter via the notify port (with fallback), and ALWAYS persist the state
//          decide() returned — verbatim, regardless of transport outcome.
// It closes every sweep with a heartbeat (kuma) so a dead host is itself detectable, then an
// opt-in daily digest.
//
// PARITY NOTES (where this intentionally maps to, or diverges from, bash — see task-13-report.md):
//  - Enrich policy (bash eval_probe ~273–280, "don't-enrich-FAIL"): keyed on the alert KIND.
//    warn -> enrich; fail -> raw prose unless cfg.enrichFail; recovery -> raw prose. enrich()
//    is garnish: it self-times-out and falls back to prose, and NEVER gates the alert.
//  - Quiet hours: bash gates in notify_send; the TS refactor moved the gate into decide() (policy)
//    for per-probe alerts. The digest + --test-alert paths have no decide() call, so notifySend()
//    below re-applies the SAME WARN-only quiet-hours gate — matching bash, where every notify_send
//    (per-probe, digest, test) runs that gate. For a per-probe alert this is a harmless no-op:
//    decide() only ever emits a WARN alert outside quiet hours, so the gate here never defers one.
//  - State is written verbatim from decide().next (incl. its `alerted`) whether or not a transport
//    succeeded — bash marks a finding alerted on ATTEMPT, never gated on HTTP success. Only quiet
//    hours leaves a WARN unalerted, and decide() already encoded that.
//  - kuma is NOT an alert channel (bash _notify_one returns 0 for it); the per-sweep heartbeat is
//    what pushes to kuma. The notify port no-ops kuma for sendAlert/sendDigest accordingly.
//  - enrich()'s `digest` arg: runProbe (Task 12) returns only a typed Verdict, not the probe's raw
//    stdout that bash passes as the digest — so the digest here is reconstructed from the verdict
//    line. Enrichment is garnish (falls back to prose), so this only affects the model's context,
//    never the decision or delivery.

import {
  appendFileSync,
  closeSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { loadConfig, type Config } from "./config";
import { runProbe as realRunProbe, type RunProbeOptions } from "./probes/runner";
import { decide, inQuietHours, type Now } from "./domain/policy";
import { readState, writeState } from "./domain/state";
import { enrich as realEnrich } from "./enrich/enrich";
import { REGISTRY, missingAdapterConfig } from "./notify/registry";
import { ADAPTERS, type AdapterName } from "./generated/notify/registry.data";
import { PROBES, type ProbeName } from "./generated/probes/roster";
import { formatAlertBody, formatAlertTitle, formatDigestBody } from "./notify/format";
import type {
  AlertPayload,
  AlertPayloadKind,
  DigestPayload,
  DigestPayloadWorstStatus,
  HeartbeatPayload,
  ProbeState,
  Verdict,
} from "./generated";

// --- injection seams --------------------------------------------------------------------------

/** The clock decide() needs (hour + timestamp) PLUS the local calendar date the digest needs for
 *  its once-a-day marker and DigestPayload.date. One injectable clock keeps tests deterministic. */
export interface CliNow extends Now {
  /** Local calendar date `YYYY-MM-DD` (bash `date +%Y-%m-%d`). */
  date: string;
}

/** The alert/digest/heartbeat transport surface, abstracted so tests inject a fake with zero
 *  network. The default (below) wraps the wired REGISTRY and encodes the kuma-is-not-an-alert-
 *  channel rule (bash _notify_one:122). */
export interface NotifyPort {
  sendAlert(name: AdapterName, payload: AlertPayload, env: Readonly<Record<string, string>>): Promise<void>;
  sendDigest(name: AdapterName, payload: DigestPayload, env: Readonly<Record<string, string>>): Promise<void>;
  heartbeat(payload: HeartbeatPayload, env: Readonly<Record<string, string>>): Promise<void>;
}

/** A held single-instance lock; release() must be idempotent and never throw. */
export interface LockHandle {
  release(): void;
}

export interface CliDeps {
  /** Environment source. Default `process.env`. Both the typed Config and the raw per-adapter/
   *  enrich secrets are read from this one object. */
  env?: NodeJS.ProcessEnv;
  /** Injectable clock (default the real local clock). */
  now?: () => CliNow;
  /** Injectable probe runner (default the real SIGKILL-escalating runProbe). Tests inject fakes so
   *  the sweep never spawns a real probe binary. */
  runProbe?: (name: ProbeName, opts: RunProbeOptions) => Promise<Verdict>;
  /** Injectable enrichment (default the real enrich; garnish, self-timing-out). */
  enrich?: typeof realEnrich;
  /** Injectable transport (default wraps REGISTRY). */
  notify?: NotifyPort;
  /** stdout sink (default console.log). */
  write?: (line: string) => void;
  /** stderr sink (default console.error). */
  stderr?: (line: string) => void;
  /** log-file sink (default appends to cfg.log). Injected as a no-op/capture in tests. */
  logLine?: (msg: string) => void;
  /** single-instance lock acquirer (default a real .lock in the state dir). Returns null when
   *  another sweep already holds it. */
  acquireLock?: (stateDir: string) => LockHandle | null;
}

// --- default transport (wraps the wired registry) ---------------------------------------------

const defaultNotifyPort: NotifyPort = {
  async sendAlert(name, payload, env) {
    if (name === "kuma") return; // heartbeat-only — not an alert channel (bash _notify_one:122)
    await REGISTRY[name].impl.sendAlert(payload, env);
  },
  async sendDigest(name, payload, env) {
    if (name === "kuma") return; // no digest sink for kuma
    await REGISTRY[name].impl.sendDigest?.(payload, env);
  },
  async heartbeat(payload, env) {
    // The kuma adapter no-ops when SMON_KUMA_PUSH_URL is unset (bash heartbeat()'s early return),
    // so this is safe to call unconditionally, independent of whether kuma is in SMON_NOTIFY.
    await REGISTRY.kuma.impl.sendAlert(payload, env);
  },
};

// --- default clock ----------------------------------------------------------------------------

function realNow(): CliNow {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return {
    hour: d.getHours(),
    timestamp: String(Math.floor(d.getTime() / 1000)),
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
  };
}

// --- single-instance lock (bash `exec 9>…/.lock; flock -n 9`) ----------------------------------

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM => the process exists but we can't signal it (still "alive" for our purposes);
    // ESRCH => no such process (stale lock).
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

function realAcquireLock(stateDir: string): LockHandle | null {
  const lockPath = join(stateDir, ".lock");
  try {
    mkdirSync(stateDir, { recursive: true });
  } catch {
    // best-effort; the open below will surface any real problem
  }
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = openSync(lockPath, "wx"); // O_CREAT | O_EXCL — atomic "create only if absent"
      try {
        writeFileSync(fd, `${process.pid}\n`);
      } catch {
        // pid write is advisory only
      }
      return {
        release() {
          try {
            closeSync(fd);
          } catch {
            /* already closed */
          }
          try {
            unlinkSync(lockPath);
          } catch {
            /* already gone */
          }
        },
      };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") {
        // Can't lock for some other reason (e.g. permissions) — proceed WITHOUT a lock rather than
        // refusing to run. A best-effort guard shouldn't turn into a hard outage of the monitor.
        return { release() {} };
      }
      // Lock file exists — is its owner still alive?
      let pid = NaN;
      try {
        pid = Number(readFileSync(lockPath, "utf8").trim());
      } catch {
        pid = NaN;
      }
      if (Number.isFinite(pid) && pid > 0 && processAlive(pid)) {
        return null; // genuinely held by a live sweep
      }
      // Stale lock (owner dead / unreadable) — remove and retry once.
      try {
        unlinkSync(lockPath);
      } catch {
        /* someone else may have cleaned it; retry will re-check */
      }
    }
  }
  return null;
}

// --- log-file sink ----------------------------------------------------------------------------

function makeFileLogger(logPath: string): (msg: string) => void {
  try {
    mkdirSync(dirname(logPath), { recursive: true });
  } catch {
    /* best-effort */
  }
  return (msg: string) => {
    try {
      const stamp = new Date().toISOString().replace("T", " ").slice(0, 19);
      appendFileSync(logPath, `${stamp} smon: ${msg}\n`);
    } catch {
      /* logging must never break the sweep */
    }
  };
}

// --- notify dispatch (bash notify_send) -------------------------------------------------------

/** The status the WARN-only quiet-hours gate keys on (bash's `status_for_notify`). */
function notifyStatusForKind(kind: AlertPayloadKind): "OK" | "WARN" | "FAIL" {
  if (kind === "warn") return "WARN";
  if (kind === "fail") return "FAIL";
  return "OK"; // recovery notifies with status OK
}

/**
 * Port of bash `notify_send`: dispatch one alert/digest to every enabled backend, with the WARN-
 * only quiet-hours gate and the primary-failed -> fallback-backends behavior.
 *  - Returns true if the message was ATTEMPTED (dispatched), false if it was deferred by quiet
 *    hours. Callers treat "attempted" as delivered for state purposes (bash's own contract).
 *  - A transport that throws is a failure of THAT backend only; it does not abort the others, and
 *    if any primary failed and a fallback set is configured, the fallback backends are tried too.
 */
async function notifySend(
  cfg: Config,
  now: CliNow,
  logLine: (m: string) => void,
  notifyStatus: "OK" | "WARN" | "FAIL",
  send: (name: AdapterName) => Promise<void>,
): Promise<boolean> {
  if (notifyStatus === "WARN" && inQuietHours(cfg, now)) {
    logLine("notify deferred (quiet hours)");
    return false;
  }
  let anyFailed = false;
  for (const name of cfg.notify) {
    try {
      await send(name);
    } catch (err) {
      anyFailed = true;
      logLine(`notify backend "${name}" failed: ${(err as Error).message}`);
    }
  }
  if (anyFailed && cfg.fallbackNotify.length > 0) {
    logLine(`primary notify failed — trying fallback: ${cfg.fallbackNotify.join(" ")}`);
    for (const name of cfg.fallbackNotify) {
      try {
        await send(name);
      } catch {
        // fallback is a last resort; swallow its failure too (bash `|| true`)
      }
    }
  }
  return true;
}

// --- per-probe alert handling (bash eval_probe's do_alert block) ------------------------------

async function buildAlertBody(
  cfg: Config,
  env: Readonly<Record<string, string>>,
  enrichFn: typeof realEnrich,
  kind: AlertPayloadKind,
  verdict: Verdict,
): Promise<string> {
  // Reconstruct the digest from the verdict line (runProbe returns no raw stdout — see file header).
  const digest = `verdict: ${verdict.status} ${verdict.tag} — ${verdict.prose}`;
  switch (kind) {
    case "warn":
      // WARN is less urgent — enrich it (falls back to prose on any failure/timeout).
      return enrichFn(digest, verdict.prose, env);
    case "fail":
      // FAIL ships raw by default so a critical alert never waits on the model (bash's
      // don't-enrich-FAIL); SMON_ENRICH_FAIL=1 opts back in.
      return cfg.enrichFail ? enrichFn(digest, verdict.prose, env) : verdict.prose;
    case "recovery":
      // Recovery ships raw (bash: body="$V_PROSE").
      return verdict.prose;
  }
}

// --- probe list surfaces (bash has none — new introspection helpers) --------------------------

function listAdapters(env: NodeJS.ProcessEnv, write: (line: string) => void): void {
  const rows = (Object.keys(ADAPTERS) as AdapterName[]).map((name) => {
    const missing = missingAdapterConfig(name, env);
    const status = missing.length === 0 ? "configured" : `missing: ${missing.join(", ")}`;
    return { name, kind: ADAPTERS[name].kind, status };
  });
  const nameW = Math.max(7, ...rows.map((r) => r.name.length));
  const kindW = Math.max(4, ...rows.map((r) => r.kind.length));
  write(`${"ADAPTER".padEnd(nameW)}  ${"KIND".padEnd(kindW)}  STATUS`);
  for (const r of rows) {
    write(`${r.name.padEnd(nameW)}  ${r.kind.padEnd(kindW)}  ${r.status}`);
  }
}

function listProbes(write: (line: string) => void): void {
  const names = Object.keys(PROBES) as ProbeName[];
  const nameW = Math.max(5, ...names.map((n) => n.length));
  write(`${"PROBE".padEnd(nameW)}  TAGS`);
  for (const name of names) {
    write(`${name.padEnd(nameW)}  ${PROBES[name].tags.join(", ")}`);
  }
}

// --- daily digest (bash maybe_digest) ---------------------------------------------------------

function readAllStates(stateDir: string): ProbeState[] {
  let files: string[];
  try {
    files = readdirSync(stateDir).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }
  files.sort();
  const out: ProbeState[] = [];
  for (const f of files) {
    try {
      out.push(JSON.parse(readFileSync(join(stateDir, f), "utf8")) as ProbeState);
    } catch {
      // a corrupt state file is skipped, not fatal (bash's `[ -r "$f" ] || continue` is similar)
    }
  }
  return out;
}

async function maybeDigest(
  cfg: Config,
  now: CliNow,
  dryRun: boolean,
  write: (line: string) => void,
  logLine: (m: string) => void,
  port: NotifyPort,
  env: Readonly<Record<string, string>>,
): Promise<void> {
  if (cfg.digestHour === null) return;
  if (now.hour !== cfg.digestHour) return;
  const markerPath = join(cfg.stateDir, ".digest-sent");
  try {
    if (readFileSync(markerPath, "utf8").trim() === now.date) return; // already sent today
  } catch {
    // no marker yet — fall through and send
  }

  const states = readAllStates(cfg.stateDir);
  let worst: DigestPayloadWorstStatus = "OK";
  let okCount = 0;
  let warnCount = 0;
  let failCount = 0;
  for (const s of states) {
    switch (s.verdict.status) {
      case "FAIL":
        failCount += 1;
        worst = "FAIL";
        break;
      case "WARN":
        warnCount += 1;
        if (worst === "OK") worst = "WARN";
        break;
      default:
        okCount += 1;
    }
  }

  const payload: DigestPayload = {
    host: cfg.host,
    date: now.date,
    worstStatus: worst,
    allOk: failCount === 0 && warnCount === 0,
    okCount,
    warnCount,
    failCount,
    probes: states,
    transitions24h: [], // bash keeps no transition history
  };

  if (dryRun) {
    write(`[DRY DIGEST ${worst}] ${cfg.host} daily digest\n${formatDigestBody(payload)}`);
    return;
  }

  await notifySend(cfg, now, logLine, worst, (name) => port.sendDigest(name, payload, env));
  // bash writes the marker unconditionally in the non-dry-run branch (even if a WARN digest was
  // deferred by quiet hours) — one digest attempt per day.
  try {
    writeFileSync(markerPath, now.date);
  } catch {
    /* best-effort */
  }
}

// --- the sweep --------------------------------------------------------------------------------

async function runSweep(
  cfg: Config,
  deps: Required<Pick<CliDeps, "now" | "runProbe" | "enrich" | "notify">>,
  env: Readonly<Record<string, string>>,
  probes: ProbeName[],
  dryRun: boolean,
  write: (line: string) => void,
  logLine: (m: string) => void,
): Promise<void> {
  const port = deps.notify;
  const summaryParts: string[] = [];

  for (const probe of probes) {
    const verdict = await deps.runProbe(probe, { timeoutMs: cfg.probeTimeoutSeconds * 1000 });
    const prev = readState(cfg.stateDir, probe);
    const now = deps.now();
    const decision = decide(prev, verdict, cfg, now);

    if (decision.alert) {
      const kind = decision.alert.kind;
      const body = await buildAlertBody(cfg, env, deps.enrich, kind, verdict);
      const payload: AlertPayload = { host: cfg.host, probe, verdict, kind, enrichedBody: body };
      const notifyStatus = notifyStatusForKind(kind);

      if (dryRun) {
        write(`[DRY ${notifyStatus}] ${formatAlertTitle(payload)}\n  ${formatAlertBody(payload)}`);
        logLine(`DRY[${kind}] ${probe} ${decision.alert.fromKey} -> ${decision.alert.toKey}`);
      } else {
        await notifySend(cfg, now, logLine, notifyStatus, (name) => port.sendAlert(name, payload, env));
        logLine(`ALERT[${kind}] ${probe} ${decision.alert.fromKey} -> ${decision.alert.toKey}`);
      }
    }

    // Persist decide().next VERBATIM — including its `alerted` — regardless of transport outcome.
    writeState(cfg.stateDir, decision.next);
    summaryParts.push(`${probe}=${verdict.status}`);
  }

  const summary = summaryParts.join(" ");

  // Heartbeat closes the sweep so a dead host is detectable Kuma-side. Never let a heartbeat
  // failure abort the sweep.
  try {
    await port.heartbeat({ status: "up", msg: summary || "swept", pingMs: 0 }, env);
    logLine("heartbeat ok");
  } catch (err) {
    logLine(`heartbeat failed: ${(err as Error).message}`);
  }
  logLine(`sweep done: ${summary || "none"}`);

  await maybeDigest(cfg, deps.now(), dryRun, write, logLine, port, env);

  if (dryRun) write(`sweep: ${summary || "none"}`);
}

// --- --test-alert -----------------------------------------------------------------------------

async function runTestAlert(
  cfg: Config,
  now: CliNow,
  port: NotifyPort,
  env: Readonly<Record<string, string>>,
  logLine: (m: string) => void,
): Promise<void> {
  logLine("test-alert requested");
  const message = "If you can read this, smon's notify path works.";
  const payload: AlertPayload = {
    host: cfg.host,
    probe: "smon",
    verdict: { status: "WARN", tag: "SMON_TEST", prose: message },
    kind: "warn",
    enrichedBody: message,
  };
  await notifySend(cfg, now, logLine, "WARN", (name) => port.sendAlert(name, payload, env));
  try {
    await port.heartbeat({ status: "up", msg: "smon test", pingMs: 0 }, env);
  } catch (err) {
    logLine(`heartbeat failed: ${(err as Error).message}`);
  }
}

// --- arg parsing + top-level orchestration ----------------------------------------------------

const USAGE =
  "usage: smon [--dry-run | --test-alert | --once <probe> | --list-adapters | --list-probes]";

type Mode = "sweep" | "dry-run" | "test-alert" | "once" | "list-adapters" | "list-probes";

/**
 * Run the CLI. Returns the process exit code (0 ok / 1 misconfiguration / 2 bad args), mirroring
 * bash's exit contract. Every side-effecting collaborator is injectable via `deps` so the whole
 * pipeline is exercisable with fake probes + a fake transport and zero real network.
 */
export async function runCli(argv: string[], deps: CliDeps = {}): Promise<number> {
  const env = deps.env ?? process.env;
  const write = deps.write ?? ((line: string) => console.log(line));
  const stderr = deps.stderr ?? ((line: string) => console.error(line));

  // --- parse args (bash ~59–66: exactly one leading verb) ---
  const arg = argv[0] ?? "";
  let mode: Mode = "sweep";
  let onlyProbe = "";
  switch (arg) {
    case "":
      mode = "sweep";
      break;
    case "--dry-run":
      mode = "dry-run";
      break;
    case "--test-alert":
      mode = "test-alert";
      break;
    case "--once":
      mode = "once";
      onlyProbe = argv[1] ?? "";
      if (onlyProbe === "") {
        stderr("usage: smon --once <probe>");
        return 2;
      }
      break;
    case "--list-adapters":
      mode = "list-adapters";
      break;
    case "--list-probes":
      mode = "list-probes";
      break;
    default:
      stderr(USAGE);
      return 2;
  }

  // Introspection surfaces need neither config validation nor the lock — they only read the
  // generated tables (+ env for adapter STATUS, names only, never secret values).
  if (mode === "list-adapters") {
    listAdapters(env, write);
    return 0;
  }
  if (mode === "list-probes") {
    listProbes(write);
    return 0;
  }

  // --- load + validate config (unknown adapter/probe token throws here) ---
  let cfg: Config;
  try {
    cfg = loadConfig(env);
  } catch (err) {
    stderr(`smon: ${(err as Error).message}`);
    return 1;
  }

  const logLine = deps.logLine ?? makeFileLogger(cfg.log);
  const now = deps.now ?? realNow;
  const port = deps.notify ?? defaultNotifyPort;
  const runProbe = deps.runProbe ?? realRunProbe;
  const enrich = deps.enrich ?? realEnrich;
  const envRecord = env as Readonly<Record<string, string>>;

  // --once may target any roster probe, even one not in SMON_PROBES — but it must be in the closed
  // roster (runProbe is typed to ProbeName; an unknown name has no script to run).
  if (mode === "once" && !Object.hasOwn(PROBES, onlyProbe)) {
    stderr(`smon: unknown probe "${onlyProbe}" (valid: ${Object.keys(PROBES).join(", ")})`);
    return 2;
  }

  // --- single-instance lock (cron-overlap guard) ---
  const acquireLock = deps.acquireLock ?? realAcquireLock;
  const lock = acquireLock(cfg.stateDir);
  if (!lock) {
    logLine("another sweep is running; skipping");
    return 0;
  }

  try {
    if (mode === "test-alert") {
      await runTestAlert(cfg, now(), port, envRecord, logLine);
      return 0;
    }

    const probes: ProbeName[] = mode === "once" ? [onlyProbe as ProbeName] : cfg.probes;
    if (probes.length === 0) {
      stderr("smon: no probes configured (set SMON_PROBES)");
      logLine("no probes configured");
      return 1;
    }

    await runSweep(
      cfg,
      { now, runProbe, enrich, notify: port },
      envRecord,
      probes,
      mode === "dry-run",
      write,
      logLine,
    );
    return 0;
  } finally {
    lock.release();
  }
}

// --- auto-run when executed directly (dist/smon.js) -------------------------------------------

async function main(): Promise<void> {
  process.exit(await runCli(process.argv.slice(2)));
}

if (import.meta.main) {
  void main();
}
