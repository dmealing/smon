import { test, expect } from "bun:test";
import { renderEmail } from "../src/render/email";

test("digest email renders byte-stable HTML", async () => {
  const payload = {
    host: "example-host",
    date: "2026-01-01",
    worstStatus: "WARN",
    allOk: false,
    okCount: 3,
    warnCount: 1,
    failCount: 0,
    probes: [
      {
        probe: "disk-report",
        verdict: { status: "WARN", tag: "DISK_HIGH", prose: "88%" },
        since: "",
        sweepCount: 2,
        alerted: true,
      },
    ],
    transitions24h: [],
  };
  const out = await renderEmail("DigestEmail", payload);
  expect(out.subject).toContain("WARN");
  expect(out.html).toMatchSnapshot();
});
