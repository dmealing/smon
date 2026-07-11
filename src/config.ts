// env -> typed Config (SMON_* knobs), mirroring the config block at the top of
// ~/Development/small-model-skills/monitor/bin/smon (lines ~35-55). Every knob gets the same
// default bash applies via `: "${VAR:=default}"` (undefined OR empty string -> default, which is
// exactly src/notify/config.ts's optionalConfig rule -- reused below rather than reimplemented).
//
// The one behavior bash does NOT have: SMON_NOTIFY / SMON_PROBES / SMON_FALLBACK_NOTIFY are
// validated against the real generated closed registries (AdapterName from
// src/generated/notify/registry.data.ts, ProbeName from src/generated/probes/roster.ts) instead
// of being trusted as free text. An unknown token throws immediately at startup, naming the bad
// token and the valid set -- bash would instead silently carry a dead notify backend (an alert
// channel that's configured but never fires) or a probe name that never matches anything to run.
// That silent-typo failure mode is the whole point of this module.
//
// Deliberately EXCLUDED from Config: per-adapter secrets/URLs (SMON_HA_URL, SMON_HA_TOKEN,
// SMON_HA_DEVICE, SMON_KUMA_PUSH_URL, SMON_MATRIX_HOMESERVER/_TOKEN/_ROOM, SMON_EMAIL_TO,
// SMON_SMTP_CMD -- see ADAPTERS[name].requiredConfig/optionalConfig in registry.data.ts for the
// full list) and the enrichment secret SMON_ZAI_KEY. Those are read directly from a raw env
// record by the notify adapters (src/notify/impl/*.ts, via requireConfig/optionalConfig) and by
// enrich() (src/enrich/enrich.ts) at send/enrich time -- this typed, validated layer only covers
// the knobs that decide sweep TIMING/SELECTION, not per-channel secrets.
//
// Also excluded: bash's SMON_CONFIG (the path to a host config file that bash `.` sources before
// applying defaults). loadConfig has no file-loading step of its own -- it reads directly from
// the `env` passed in by the caller (typically `process.env`); any file-sourcing happens, if at
// all, before that object is built.

import { hostname, homedir } from "node:os";
import { join } from "node:path";
import { optionalConfig } from "./notify/config";
import { ADAPTERS, type AdapterName } from "./generated/notify/registry.data";
import { PROBES, type ProbeName } from "./generated/probes/roster";

export interface Config {
  /** bash `SMON_PROBES`, default "sys-diag disk-report log-triage runaway-hunter". */
  probes: ProbeName[];
  /** bash `SMON_NOTIFY`, default "stdout". */
  notify: AdapterName[];
  /** bash `SMON_FALLBACK_NOTIFY` -- backends tried only when a primary notify transport fails,
   *  default none (empty). */
  fallbackNotify: AdapterName[];
  /** bash `SMON_BRAIN` (glm | local | none), default "none". An unrecognized value is coerced to
   *  "none" rather than rejected -- see the field's assignment below for why. */
  brain: "none" | "glm" | "local";
  /** bash `SMON_CLAUDE_BIN`, default "claude". */
  claudeBin: string;
  /** bash `SMON_STATE_DIR`, default `$HOME/.local/state/smon`. */
  stateDir: string;
  /** bash `SMON_LOG`, default `$HOME/logs/smon.log`. */
  log: string;
  /** bash `SMON_HOST`, default the short hostname. See computeDefaultHost() for why this doesn't
   *  shell out to `hostname -s` the way bash does. */
  host: string;
  /** bash `SMON_QUIET_START`, default 23 (hour, 0-23). */
  quietStart: number;
  /** bash `SMON_QUIET_END`, default 7 (hour, 0-23). */
  quietEnd: number;
  /** bash `SMON_WARN_SUSTAIN`, default 2 -- consecutive sweeps a WARN must persist before it's
   *  first pushed. */
  warnSustain: number;
  /** bash `SMON_PROBE_TIMEOUT`, default 120 (seconds) -- defense against a hung probe. */
  probeTimeoutSeconds: number;
  /** bash `SMON_FAIL_REMIND_SWEEPS`, default 0 -- re-push a still-standing FAIL every N sweeps;
   *  0 means never remind. */
  failRemindSweeps: number;
  /** bash `SMON_DIGEST_HOUR` -- hour (0-23) to push a once-daily status digest; `null` means off
   *  (bash's blank/unset). */
  digestHour: number | null;
  /** bash `SMON_ENRICH_FAIL` -- "1" also enrich FAIL messages via the model; anything else (bash's
   *  default "0") ships FAIL raw so a critical alert never waits on the model. Default false. */
  enrichFail: boolean;
}

const DEFAULT_PROBES = "sys-diag disk-report log-triage runaway-hunter";

// bash splits SMON_PROBES / SMON_NOTIFY / SMON_FALLBACK_NOTIFY by shell word-splitting (spaces
// only, via `for x in $VAR`). Commas are also accepted here -- a harmless superset that's
// friendlier for a one-line env var and matches this task's brief ("space/comma-separated").
function splitList(raw: string): string[] {
  return raw
    .split(/[\s,]+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
}

function parseAdapterList(envKey: string, raw: string): AdapterName[] {
  const valid = Object.keys(ADAPTERS) as AdapterName[];
  return splitList(raw).map((token) => {
    if (!Object.hasOwn(ADAPTERS, token)) {
      throw new Error(`${envKey}: unknown notify adapter "${token}" (valid: ${valid.join(", ")})`);
    }
    return token as AdapterName;
  });
}

function parseProbeList(envKey: string, raw: string): ProbeName[] {
  const valid = Object.keys(PROBES) as ProbeName[];
  return splitList(raw).map((token) => {
    if (!Object.hasOwn(PROBES, token)) {
      throw new Error(`${envKey}: unknown probe "${token}" (valid: ${valid.join(", ")})`);
    }
    return token as ProbeName;
  });
}

// bash env vars are always strings; a knob like SMON_WARN_SUSTAIN="abc" would make bash's own
// `[ -ge ]` integer comparisons error out at runtime. Mirrors src/probes/runner.ts's existing
// numeric-env-var idiom (defaultTimeoutMs/defaultKillGraceMs): an unparseable value falls back to
// the default rather than propagating NaN into the policy state machine. This is NOT one of the
// closed-registry validations above -- it never throws.
function parseNumber(raw: string, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

// bash: blank/unset SMON_DIGEST_HOUR means "digest off"; any other value is compared against the
// current hour. Mirrors parseNumber's fallback-not-throw behavior for a genuinely garbage value.
function parseDigestHour(raw: string): number | null {
  if (raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

// bash: `: "${SMON_HOST:=$(hostname -s 2>/dev/null || hostname 2>/dev/null || echo host)}"`.
// Ported as `os.hostname()` truncated to its first label instead of shelling out to `hostname -s`
// -- loadConfig is otherwise pure/synchronous with no subprocess spawns, and reproducing a shell
// command this cheap to replicate directly isn't worth adding one just for parity with bash's
// implementation detail (the OBSERVABLE default, a short hostname, is the same either way).
function computeDefaultHost(): string {
  const short = hostname().split(".")[0];
  return short && short.length > 0 ? short : "host";
}

export function loadConfig(env: NodeJS.ProcessEnv): Config {
  // optionalConfig's signature is Readonly<Record<string, string>>; NodeJS.ProcessEnv's index
  // signature is `string | undefined` (see src/notify/config.ts's header comment on
  // noUncheckedIndexedAccess), so it isn't structurally assignable without this cast. Runtime
  // behavior is identical either way -- optionalConfig only ever reads `cfg[key]`.
  const raw = env as Readonly<Record<string, string>>;
  const get = (key: string, fallback: string) => optionalConfig(raw, key, fallback);

  const brainRaw = get("SMON_BRAIN", "none");

  return {
    probes: parseProbeList("SMON_PROBES", get("SMON_PROBES", DEFAULT_PROBES)),
    notify: parseAdapterList("SMON_NOTIFY", get("SMON_NOTIFY", "stdout")),
    fallbackNotify: parseAdapterList("SMON_FALLBACK_NOTIFY", get("SMON_FALLBACK_NOTIFY", "")),
    // Any value other than "glm"/"local" is coerced to "none" rather than thrown, matching bash's
    // enrich(): its case/if-elif chain treats an unrecognized SMON_BRAIN identically to "none"
    // (no model spawned, raw prose returned) -- there is no bash behavior to diverge from here,
    // so this is a silent normalization, not one of the closed-registry validations above.
    brain: brainRaw === "glm" || brainRaw === "local" ? brainRaw : "none",
    claudeBin: get("SMON_CLAUDE_BIN", "claude"),
    stateDir: get("SMON_STATE_DIR", join(homedir(), ".local", "state", "smon")),
    log: get("SMON_LOG", join(homedir(), "logs", "smon.log")),
    host: get("SMON_HOST", computeDefaultHost()),
    quietStart: parseNumber(get("SMON_QUIET_START", "23"), 23),
    quietEnd: parseNumber(get("SMON_QUIET_END", "7"), 7),
    warnSustain: parseNumber(get("SMON_WARN_SUSTAIN", "2"), 2),
    probeTimeoutSeconds: parseNumber(get("SMON_PROBE_TIMEOUT", "120"), 120),
    failRemindSweeps: parseNumber(get("SMON_FAIL_REMIND_SWEEPS", "0"), 0),
    digestHour: parseDigestHour(get("SMON_DIGEST_HOUR", "")),
    enrichFail: get("SMON_ENRICH_FAIL", "0") === "1",
  };
}
