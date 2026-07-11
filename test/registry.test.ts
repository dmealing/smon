// Task 7 — proves the generated notify registry (data half) and probe roster
// match the model in metaobjects/meta.notify.json. Run `bun run gen` before
// `bun test` so these generated modules exist / are current.
//
// registry.data.ts (not registry.ts) is the import target deliberately: the
// full registry.ts (impl-wired) is Task 9's deliverable — see
// codegen/generators/notify-registry.ts's header comment for why.

import { test, expect } from "bun:test";
import { ADAPTERS, missingAdapterConfig } from "../src/generated/notify/registry.data";
import { PROBES } from "../src/generated/probes/roster";

test("ADAPTERS carries each declared adapter.notify's kind", () => {
  expect(ADAPTERS["email"].kind).toBe("email");
  expect(ADAPTERS["ha-push"].kind).toBe("push");
  expect(ADAPTERS["kuma"].kind).toBe("heartbeat");
  expect(ADAPTERS["matrix"].kind).toBe("chat");
  expect(ADAPTERS["stdout"].kind).toBe("stdout");
});

test("missingAdapterConfig reports absent required keys", () => {
  expect(missingAdapterConfig("kuma", {})).toEqual(["SMON_KUMA_PUSH_URL"]);
});

test("missingAdapterConfig treats an empty-string value as missing too", () => {
  expect(missingAdapterConfig("kuma", { SMON_KUMA_PUSH_URL: "" })).toEqual(["SMON_KUMA_PUSH_URL"]);
});

test("missingAdapterConfig returns [] once every required key is set", () => {
  expect(missingAdapterConfig("kuma", { SMON_KUMA_PUSH_URL: "https://kuma.example/push" })).toEqual([]);
});

test("PROBES carries each declared probe.bash's tag roster", () => {
  expect(PROBES["sys-diag"].tags).toContain("CPU_HOG");
  expect(PROBES["sys-diag"].script).toBe("sys-diag");
  expect(PROBES["disk-report"].tags).toContain("DISK_CRITICAL");
});
