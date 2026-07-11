import { test, expect } from "bun:test";
import type { Verdict, DigestPayload } from "../src/generated";

test("generated VO types exist and shape is right", () => {
  const v: Verdict = { status: "WARN", tag: "CPU_HOG", prose: "x" };
  const d: DigestPayload = {
    host: "h",
    date: "d",
    worstStatus: "OK",
    allOk: true,
    okCount: 1,
    warnCount: 0,
    failCount: 0,
    probes: [],
    transitions24h: [],
  };
  expect(v.status).toBe("WARN");
  expect(d.allOk).toBe(true);
});
