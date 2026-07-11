// Task 9 — notify adapter implementations. Every transport (fetch/exec) is injected via each
// impl's `create*Adapter(deps)` factory so these tests exercise the exact request shape with
// zero real network/SMTP. Public-repo hygiene: all hosts/rooms/emails below are placeholders
// (ha.example / !room:example.org / to@example.com) — never real infra.
//
// Bash reference for the HTTP shapes: ~/Development/small-model-skills/monitor/bin/smon
// (notify_ha, notify_matrix, heartbeat, _notify_one). See each impl file's header for the
// specific deviations (config-key renames already fixed by the metaobjects model, and the
// notify.-prefix strip / colon-only room encoding carried over verbatim from bash).

import { describe, test, expect, mock } from "bun:test";
import { createStdoutAdapter } from "../src/notify/impl/stdout";
import { createHaPushAdapter } from "../src/notify/impl/ha-push";
import { createKumaAdapter } from "../src/notify/impl/kuma";
import { createMatrixAdapter } from "../src/notify/impl/matrix";
import { createEmailAdapter } from "../src/notify/impl/email";
import type { AlertPayload, DigestPayload, HeartbeatPayload } from "../src/generated";
import type { RenderedEmail } from "../src/render/email";

const ALERT: AlertPayload = {
  host: "test-host",
  probe: "disk-report",
  verdict: { status: "FAIL", tag: "DISK_CRITICAL", prose: "98% full" },
  kind: "fail",
  enrichedBody: "Disk is critically full on /.",
};

const WARN_ALERT: AlertPayload = {
  host: "test-host",
  probe: "sys-diag",
  verdict: { status: "WARN", tag: "CPU_HOG", prose: "sustained high load" },
  kind: "warn",
  enrichedBody: "Load has been high for a while.",
};

const RECOVERY_ALERT: AlertPayload = {
  host: "test-host",
  probe: "sys-diag",
  verdict: { status: "OK", tag: "NOMINAL", prose: "back to normal" },
  kind: "recovery",
  enrichedBody: "back to normal",
};

const DIGEST: DigestPayload = {
  host: "test-host",
  date: "2026-01-01",
  worstStatus: "WARN",
  allOk: false,
  okCount: 3,
  warnCount: 1,
  failCount: 0,
  probes: [
    {
      probe: "disk-report",
      verdict: { status: "WARN", tag: "DISK_HIGH", prose: "88% full" },
      since: "2026-01-01T00:00:00Z",
      sweepCount: 2,
      alerted: true,
    },
  ],
  transitions24h: [],
};

const HEARTBEAT_UP: HeartbeatPayload = { status: "up", msg: "sys-diag=OK disk-report=WARN", pingMs: 42 };
const HEARTBEAT_DOWN: HeartbeatPayload = { status: "down", msg: "no probes ran", pingMs: 0 };

function fakeFetch(status: number) {
  const calls: { url: string; init: RequestInit | undefined }[] = [];
  const fn = mock(async (input: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return new Response(null, { status });
  });
  return { fn, calls };
}

describe("stdout adapter", () => {
  test("sendAlert always succeeds and prints the alert", async () => {
    const lines: string[] = [];
    const adapter = createStdoutAdapter({ write: (line) => lines.push(line) });
    await adapter.sendAlert(ALERT, {});
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("test-host");
    expect(lines[0]).toContain("DISK_CRITICAL");
    expect(lines[0]).toContain("Disk is critically full on /.");
  });

  test("sendAlert formats fail/warn/recovery titles distinctly", async () => {
    const lines: string[] = [];
    const adapter = createStdoutAdapter({ write: (line) => lines.push(line) });
    await adapter.sendAlert(ALERT, {});
    await adapter.sendAlert(WARN_ALERT, {});
    await adapter.sendAlert(RECOVERY_ALERT, {});
    expect(lines[0]).toContain("🔴");
    expect(lines[1]).toContain("🟠");
    expect(lines[2]).toContain("🟢");
    expect(lines[2]).toContain("recovered");
  });

  test("sendDigest prints a per-probe summary", async () => {
    const lines: string[] = [];
    const adapter = createStdoutAdapter({ write: (line) => lines.push(line) });
    await adapter.sendDigest?.(DIGEST, {});
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("daily digest");
    expect(lines[0]).toContain("disk-report: WARN DISK_HIGH");
  });

  test("defaults to console.log when no writer injected", async () => {
    const adapter = createStdoutAdapter();
    await expect(adapter.sendAlert(ALERT, {})).resolves.toBeUndefined();
  });
});

describe("ha-push adapter", () => {
  const cfg = {
    SMON_HA_URL: "https://ha.example:8123/",
    SMON_HA_TOKEN: "fake-token",
    SMON_HA_DEVICE: "mobile_app_test",
  };

  test("POSTs to /api/services/notify/<device> with Bearer auth and {title,message} JSON", async () => {
    const { fn, calls } = fakeFetch(200);
    const adapter = createHaPushAdapter({ fetch: fn as unknown as typeof fetch });
    await adapter.sendAlert(ALERT, cfg);

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://ha.example:8123/api/services/notify/mobile_app_test");
    expect(calls[0]!.init?.method).toBe("POST");
    const headers = new Headers(calls[0]!.init?.headers);
    expect(headers.get("authorization")).toBe("Bearer fake-token");
    expect(headers.get("content-type")).toBe("application/json");
    const body = JSON.parse(calls[0]!.init?.body as string);
    expect(body).toEqual({
      title: "🔴 test-host: DISK_CRITICAL",
      message: "Disk is critically full on /.",
    });
  });

  test("strips a leading 'notify.' prefix from SMON_HA_DEVICE, matching bash's ${SMON_HA_TARGET#notify.}", async () => {
    const { fn, calls } = fakeFetch(200);
    const adapter = createHaPushAdapter({ fetch: fn as unknown as typeof fetch });
    await adapter.sendAlert(ALERT, { ...cfg, SMON_HA_DEVICE: "notify.mobile_app_test" });
    expect(calls[0]!.url).toBe("https://ha.example:8123/api/services/notify/mobile_app_test");
  });

  test("sendDigest posts the digest title/body", async () => {
    const { fn, calls } = fakeFetch(200);
    const adapter = createHaPushAdapter({ fetch: fn as unknown as typeof fetch });
    await adapter.sendDigest?.(DIGEST, cfg);
    const body = JSON.parse(calls[0]!.init?.body as string);
    expect(body.title).toContain("daily digest");
    expect(body.message).toContain("disk-report: WARN DISK_HIGH");
  });

  test("a non-200 response is a transport failure", async () => {
    const { fn } = fakeFetch(500);
    const adapter = createHaPushAdapter({ fetch: fn as unknown as typeof fetch });
    await expect(adapter.sendAlert(ALERT, cfg)).rejects.toThrow();
  });

  test("missing required config throws without calling fetch", async () => {
    const { fn, calls } = fakeFetch(200);
    const adapter = createHaPushAdapter({ fetch: fn as unknown as typeof fetch });
    await expect(adapter.sendAlert(ALERT, {})).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });
});

describe("matrix adapter", () => {
  const cfg = {
    SMON_MATRIX_HOMESERVER: "https://matrix.example:8008/",
    SMON_MATRIX_TOKEN: "fake-matrix-token",
    SMON_MATRIX_ROOM: "!room:example.org",
  };

  test("PUTs to .../rooms/<url-encoded room>/send/m.room.message/<txnId> (colon -> %3A only)", async () => {
    const { fn, calls } = fakeFetch(200);
    const adapter = createMatrixAdapter({ fetch: fn as unknown as typeof fetch });
    await adapter.sendAlert(ALERT, cfg);

    expect(calls).toHaveLength(1);
    const url = calls[0]!.url;
    expect(url).toStartWith(
      "https://matrix.example:8008/_matrix/client/v3/rooms/!room%3Aexample.org/send/m.room.message/",
    );
    expect(calls[0]!.init?.method).toBe("PUT");
    const headers = new Headers(calls[0]!.init?.headers);
    expect(headers.get("authorization")).toBe("Bearer fake-matrix-token");
    const body = JSON.parse(calls[0]!.init?.body as string);
    expect(body).toEqual({
      msgtype: "m.text",
      body: "🔴 test-host: DISK_CRITICAL\nDisk is critically full on /.",
    });
  });

  test("uses a fresh txnId per call", async () => {
    const { fn, calls } = fakeFetch(200);
    const adapter = createMatrixAdapter({ fetch: fn as unknown as typeof fetch });
    await adapter.sendAlert(ALERT, cfg);
    await adapter.sendAlert(ALERT, cfg);
    const txn = (url: string) => url.split("/send/m.room.message/")[1];
    expect(txn(calls[0]!.url)).not.toBe(txn(calls[1]!.url));
  });

  test("sendDigest PUTs the digest title/body", async () => {
    const { fn, calls } = fakeFetch(200);
    const adapter = createMatrixAdapter({ fetch: fn as unknown as typeof fetch });
    await adapter.sendDigest?.(DIGEST, cfg);
    const body = JSON.parse(calls[0]!.init?.body as string);
    expect(body.body).toContain("daily digest");
    expect(body.body).toContain("disk-report: WARN DISK_HIGH");
  });

  test("a non-200 response is a transport failure", async () => {
    const { fn } = fakeFetch(403);
    const adapter = createMatrixAdapter({ fetch: fn as unknown as typeof fetch });
    await expect(adapter.sendAlert(ALERT, cfg)).rejects.toThrow();
  });

  test("missing required config throws without calling fetch", async () => {
    const { fn, calls } = fakeFetch(200);
    const adapter = createMatrixAdapter({ fetch: fn as unknown as typeof fetch });
    await expect(adapter.sendAlert(ALERT, {})).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });
});

describe("kuma adapter", () => {
  const cfg = { SMON_KUMA_PUSH_URL: "https://kuma.example/api/push/faketoken" };

  test("GETs the push URL with status + URL-encoded msg", async () => {
    const { fn, calls } = fakeFetch(200);
    const adapter = createKumaAdapter({ fetch: fn as unknown as typeof fetch });
    await adapter.sendAlert(HEARTBEAT_UP, cfg);

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(
      "https://kuma.example/api/push/faketoken?status=up&msg=sys-diag%3DOK%20disk-report%3DWARN",
    );
    expect(calls[0]!.init?.method ?? "GET").toBe("GET");
  });

  test("sources the status query param from payload.status (not hardcoded 'up')", async () => {
    const { fn, calls } = fakeFetch(200);
    const adapter = createKumaAdapter({ fetch: fn as unknown as typeof fetch });
    await adapter.sendAlert(HEARTBEAT_DOWN, cfg);
    expect(calls[0]!.url).toContain("status=down");
  });

  test("a non-200 response is a transport failure", async () => {
    const { fn } = fakeFetch(500);
    const adapter = createKumaAdapter({ fetch: fn as unknown as typeof fetch });
    await expect(adapter.sendAlert(HEARTBEAT_UP, cfg)).rejects.toThrow();
  });

  test("an empty push URL is a silent no-op success (matches bash heartbeat()'s early return)", async () => {
    const { fn, calls } = fakeFetch(200);
    const adapter = createKumaAdapter({ fetch: fn as unknown as typeof fetch });
    await expect(adapter.sendAlert(HEARTBEAT_UP, {})).resolves.toBeUndefined();
    expect(calls).toHaveLength(0);
  });

  test("has no sendDigest — kuma is heartbeat-only", () => {
    const adapter = createKumaAdapter();
    expect(adapter.sendDigest).toBeUndefined();
  });
});

describe("email adapter", () => {
  const cfg = { SMON_EMAIL_TO: "to@example.com" };
  const rendered: RenderedEmail = {
    subject: "[smon] test-host alert",
    html: "<p>Disk is critically full on /.</p>",
    text: "Disk is critically full on /.",
  };

  test("sendAlert renders AlertEmail then pipes a MIME message to the injected smtp exec", async () => {
    const renderCalls: { name: string; payload: unknown }[] = [];
    const execCalls: { command: string; input: string }[] = [];
    const adapter = createEmailAdapter({
      renderEmail: async (name, payload) => {
        renderCalls.push({ name, payload });
        return rendered;
      },
      exec: async (command, input) => {
        execCalls.push({ command, input });
        return { code: 0 };
      },
    });

    await adapter.sendAlert(ALERT, cfg);

    expect(renderCalls).toEqual([{ name: "AlertEmail", payload: ALERT }]);
    expect(execCalls).toHaveLength(1);
    expect(execCalls[0]!.command).toBe("msmtp -t"); // default SMON_SMTP_CMD
    expect(execCalls[0]!.input).toContain("To: to@example.com");
    expect(execCalls[0]!.input).toContain("Subject: [smon] test-host alert");
    expect(execCalls[0]!.input).toContain("Disk is critically full on /.");
    expect(execCalls[0]!.input).toContain("<p>Disk is critically full on /.</p>");
  });

  test("sendDigest renders DigestEmail", async () => {
    const renderCalls: { name: string; payload: unknown }[] = [];
    const adapter = createEmailAdapter({
      renderEmail: async (name, payload) => {
        renderCalls.push({ name, payload });
        return rendered;
      },
      exec: async () => ({ code: 0 }),
    });
    await adapter.sendDigest?.(DIGEST, cfg);
    expect(renderCalls).toEqual([{ name: "DigestEmail", payload: DIGEST }]);
  });

  test("honors SMON_SMTP_CMD override", async () => {
    const execCalls: string[] = [];
    const adapter = createEmailAdapter({
      renderEmail: async () => rendered,
      exec: async (command) => {
        execCalls.push(command);
        return { code: 0 };
      },
    });
    await adapter.sendAlert(ALERT, { ...cfg, SMON_SMTP_CMD: "sendmail -t" });
    expect(execCalls).toEqual(["sendmail -t"]);
  });

  test("a non-zero exec exit code is a transport failure", async () => {
    const adapter = createEmailAdapter({
      renderEmail: async () => rendered,
      exec: async () => ({ code: 1, stderr: "connection refused" }),
    });
    await expect(adapter.sendAlert(ALERT, cfg)).rejects.toThrow();
  });

  test("missing SMON_EMAIL_TO throws without rendering or exec'ing", async () => {
    const renderCalls: unknown[] = [];
    const execCalls: unknown[] = [];
    const adapter = createEmailAdapter({
      renderEmail: async (name, payload) => {
        renderCalls.push({ name, payload });
        return rendered;
      },
      exec: async (command, input) => {
        execCalls.push({ command, input });
        return { code: 0 };
      },
    });
    await expect(adapter.sendAlert(ALERT, {})).rejects.toThrow();
    expect(renderCalls).toHaveLength(0);
    expect(execCalls).toHaveLength(0);
  });
});
