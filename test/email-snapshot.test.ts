import { test, expect } from "bun:test";
import { renderEmail } from "../src/render/email";

test("recovery alert email subject shows the FAILING tag, not the new OK verdict's tag", async () => {
  const payload = {
    host: "example-host",
    probe: "disk-report",
    verdict: { status: "OK", tag: "NOMINAL", prose: "back to normal" },
    kind: "recovery",
    enrichedBody: "back to normal",
    fromTag: "DISK_CRITICAL",
  };
  const out = await renderEmail("AlertEmail", payload);
  expect(out.subject).toContain("recovered (DISK_CRITICAL → OK)");
  expect(out.subject).not.toContain("NOMINAL");
});

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
