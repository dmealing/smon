// Task 13 — drift-gate tests. These prove the metaobjects model is self-defending: an author who
// mutates the model in a way that breaks the payload<->template<->adapter<->probe contract is
// stopped by `meta gen` / `meta verify` with a NON-ZERO exit, instead of silently shipping a stale
// or broken shape.
//
// SAFETY (non-negotiable): every scenario mutates a TEMPORARY COPY of the repo in an OS temp dir
// and runs `meta` in a subprocess against that copy. The real committed model + generated files are
// NEVER touched. node_modules is symlinked (not copied) so the copy is cheap.
//
// WHICH COMMAND CATCHES WHICH DRIFT (grep-verified against codegen/smon-provider.ts + the
// render-helper `verify:` literal in src/generated/*.render.ts):
//   - `@kind=email` mustache {{field}} <-> payload drift is SKIPPED by `meta verify --templates`
//     (that gate only checks template.prompt drift). It is caught at `meta GEN` time by the
//     render-helper's baked-in `verify:` field list -> ERR_VAR_NOT_ON_PAYLOAD. So the "rename a
//     payload field" scenario (S1) asserts `meta gen` fails.
//   - The smon provider's own validate hooks (ERR_SMON_EMAIL_TEMPLATE_REQUIRED, ERR_SMON_TAG_GRAMMAR)
//     and the built-in reference resolver (ERR_SMON_PAYLOAD_REF_UNRESOLVED) fire when the model is
//     LOADED, which both `meta verify` and `meta gen` do — S2/S3/S4 assert `meta verify` fails.
//
// NOTE on assertions: for a provider-validate / reference load failure, the CLI surfaces the error
// MESSAGE (not the raw ERR_SMON_* code) on the "failed to load metadata: …" line. Each message maps
// 1:1 to exactly one code (noted per-scenario), and the code itself is unit-tested directly in
// test/provider.test.ts. So here we assert non-zero exit + the message that uniquely identifies the
// code. S1's code (ERR_VAR_NOT_ON_PAYLOAD) IS printed verbatim by the render-helper gate, so S1
// asserts the code string directly.

import { afterEach, describe, expect, test } from "bun:test";
import { cpSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const REPO = join(import.meta.dir, "..");
const EXCLUDE = new Set(["node_modules", ".git", "dist"]);

const created: string[] = [];
afterEach(() => {
  while (created.length > 0) {
    const dir = created.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

/** A throwaway copy of the repo (minus node_modules/.git/dist) with node_modules symlinked back. */
function makeTempRepo(): string {
  const tmp = mkdtempSync(join(tmpdir(), "smon-drift-"));
  created.push(tmp);
  cpSync(REPO, tmp, {
    recursive: true,
    filter: (src) => {
      if (src === REPO) return true;
      const top = src.slice(REPO.length + 1).split("/")[0]!;
      return !EXCLUDE.has(top);
    },
  });
  symlinkSync(join(REPO, "node_modules"), join(tmp, "node_modules"));
  return tmp;
}

/** In-place string replacement in a temp-copy file, GUARDED so a no-op replace (target text not
 *  found) fails loudly — otherwise a scenario could silently not mutate and produce a false pass. */
function mutate(tmp: string, relPath: string, from: string, to: string): void {
  const path = join(tmp, relPath);
  const before = readFileSync(path, "utf8");
  expect(before).toContain(from); // the drift target must actually exist
  writeFileSync(path, before.replace(from, to));
}

function runMeta(tmp: string, args: string[]): { code: number | null; output: string } {
  const proc = Bun.spawnSync(["node", join(tmp, "node_modules", ".bin", "meta"), ...args], {
    cwd: tmp,
    stdout: "pipe",
    stderr: "pipe",
  });
  return { code: proc.exitCode, output: `${proc.stdout.toString()}${proc.stderr.toString()}` };
}

const T = 30_000; // generous per-scenario cap; each subprocess is well under 1s

describe("drift gate — the model is self-defending", () => {
  // Guard against false-positive drift tests: an UNMUTATED copy must pass both gates, so any
  // failure below is caused by the mutation, not by the temp-copy harness itself.
  test(
    "S0 (sanity): an unmutated copy passes both `meta gen` and `meta verify`",
    () => {
      const tmp = makeTempRepo();
      const gen = runMeta(tmp, ["gen", "--dry-run"]);
      expect(gen.code).toBe(0);
      const verify = runMeta(tmp, ["verify", "--prompts", "templates"]);
      expect(verify.code).toBe(0);
    },
    T,
  );

  // S1 — rename an AlertPayload field. The email templates still reference the OLD name
  // ({{enrichedBody}}), so the render-helper's field-list gate fails at GEN.  -> ERR_VAR_NOT_ON_PAYLOAD
  test(
    "S1: renaming an AlertPayload field fails `meta gen` with ERR_VAR_NOT_ON_PAYLOAD",
    () => {
      const tmp = makeTempRepo();
      mutate(tmp, "metaobjects/meta.monitor.json", '"name": "enrichedBody"', '"name": "enrichedBodyRenamed"');
      const { code, output } = runMeta(tmp, ["gen"]);
      expect(code).not.toBe(0);
      expect(output).toContain("ERR_VAR_NOT_ON_PAYLOAD");
      expect(output).toContain("enrichedBody");
    },
    T,
  );

  // S2 — an @kind=email adapter with no @alertTemplateRef.  provider validate hook -> ERR_SMON_EMAIL_TEMPLATE_REQUIRED
  test(
    "S2: an email adapter missing its @alertTemplateRef fails `meta verify` (ERR_SMON_EMAIL_TEMPLATE_REQUIRED)",
    () => {
      const tmp = makeTempRepo();
      mutate(tmp, "metaobjects/meta.notify.json", '"@alertTemplateRef": "AlertEmail",', "");
      const { code, output } = runMeta(tmp, ["verify", "--prompts", "templates"]);
      expect(code).not.toBe(0);
      // message emitted by ctx.error("ERR_SMON_EMAIL_TEMPLATE_REQUIRED", …) in codegen/smon-provider.ts
      expect(output).toContain('declares no @alertTemplateRef');
    },
    T,
  );

  // S3 — an illegal probe tag (lowercase).  provider validate hook -> ERR_SMON_TAG_GRAMMAR
  test(
    "S3: an illegal probe tag fails `meta verify` (ERR_SMON_TAG_GRAMMAR)",
    () => {
      const tmp = makeTempRepo();
      // SysDiag's roster: turn a valid tag lowercase so it violates ^[A-Z][A-Z0-9_]{1,23}$
      mutate(tmp, "metaobjects/meta.notify.json", '"NOMINAL", "PROBE_FAILED"]', '"nominal", "PROBE_FAILED"]');
      const { code, output } = runMeta(tmp, ["verify", "--prompts", "templates"]);
      expect(code).not.toBe(0);
      // message emitted by ctx.error("ERR_SMON_TAG_GRAMMAR", …); it names the bad tag + the grammar
      expect(output).toContain("does not match");
      expect(output).toContain("nominal");
    },
    T,
  );

  // S4 — an adapter @payloadRef pointing at a VO that doesn't exist (e.g. the payload was renamed
  // but the adapter wasn't updated).  built-in reference resolver -> ERR_SMON_PAYLOAD_REF_UNRESOLVED
  test(
    "S4: an adapter @payloadRef that doesn't resolve fails `meta verify` (ERR_SMON_PAYLOAD_REF_UNRESOLVED)",
    () => {
      const tmp = makeTempRepo();
      // HaPush is the first "@payloadRef": "AlertPayload" in meta.notify.json.
      mutate(tmp, "metaobjects/meta.notify.json", '"@payloadRef": "AlertPayload"', '"@payloadRef": "NoSuchPayload"');
      const { code, output } = runMeta(tmp, ["verify", "--prompts", "templates"]);
      expect(code).not.toBe(0);
      // message emitted for references[{attr:"payloadRef", errorCode:"ERR_SMON_PAYLOAD_REF_UNRESOLVED"}]
      expect(output).toContain("does not resolve to an object");
    },
    T,
  );
});
