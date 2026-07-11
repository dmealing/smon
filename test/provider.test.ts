// smon-monitor-types provider — proof that adapter.notify + probe.bash validate
// themselves purely by being registered (same pattern as the widget.gauge
// conformance proof in @metaobjectsdev/metadata's own test suite).
//
// Loads with `strict: true` — the same mode `meta verify` uses by default
// (ADR-0023, #96) — so these assertions match real CLI behavior, not just the
// loader's lax default.

import { describe, it, expect } from "bun:test";
import {
  MetaDataLoader,
  InMemoryStringSource,
  composeRegistry,
  coreProviders,
} from "@metaobjectsdev/metadata";
import { smonMonitorTypes } from "../codegen/smon-provider";

function freshRegistry() {
  return composeRegistry([...coreProviders, smonMonitorTypes]);
}

function codesOf(errors: readonly unknown[]): (string | undefined)[] {
  return errors.map((e) => (e as { code?: string }).code);
}

async function load(children: string) {
  const source = `{
    "metadata.root": {
      "package": "smon-test",
      "children": [ ${children} ]
    }
  }`;
  const loader = new MetaDataLoader({ registry: freshRegistry(), strict: true });
  return loader.load([new InMemoryStringSource(source, { id: "t.json", format: "json" })]);
}

// Shared fixtures: two payload VOs + two email templates, mirroring this
// project's real metaobjects/meta.monitor.json (AlertPayload/AlertEmail,
// DigestPayload/DigestEmail).
const PAYLOADS_AND_TEMPLATES = `
  { "object.value": { "name": "AlertPayload", "children": [
      { "field.string": { "name": "host", "@required": true } }
  ]}},
  { "object.value": { "name": "DigestPayload", "children": [
      { "field.string": { "name": "host", "@required": true } }
  ]}},
  { "template.output": { "name": "AlertEmail", "@kind": "email", "@payloadRef": "AlertPayload",
      "@subjectRef": "emails/alert.subject", "@htmlBodyRef": "emails/alert.html" } },
  { "template.output": { "name": "DigestEmail", "@kind": "email", "@payloadRef": "DigestPayload",
      "@subjectRef": "emails/digest.subject", "@htmlBodyRef": "emails/digest.html" } }
`;

describe("smon-monitor-types provider", () => {
  it("registers adapter.notify + probe.bash as top-level siblings of object/template", async () => {
    const { errors } = await load(`
      ${PAYLOADS_AND_TEMPLATES},
      { "adapter.notify": {
          "name": "EmailAdapter",
          "@kind": "email",
          "@payloadRef": "AlertPayload",
          "@digestPayloadRef": "DigestPayload",
          "@alertTemplateRef": "AlertEmail",
          "@digestTemplateRef": "DigestEmail"
      }},
      { "probe.bash": {
          "name": "DiskProbe",
          "@script": "check-disk.sh",
          "@tags": ["DISK", "CAPACITY"]
      }}
    `);
    // Not ERR_CHILD_NOT_ALLOWED, ERR_UNKNOWN_ATTR, ERR_UNKNOWN_TYPE/SUBTYPE, or
    // any ERR_SMON_* — a fully-wired declaration resolves clean.
    const codes = codesOf(errors);
    expect(codes).toEqual([]);
  });

  it("a stdout adapter needs no template refs and resolves cleanly", async () => {
    const { errors } = await load(`
      { "object.value": { "name": "AlertPayload", "children": [
          { "field.string": { "name": "host", "@required": true } }
      ]}},
      { "adapter.notify": {
          "name": "StdoutAdapter",
          "@kind": "stdout",
          "@payloadRef": "AlertPayload"
      }}
    `);
    expect(codesOf(errors)).toEqual([]);
  });

  it("an email adapter with no @alertTemplateRef reports ERR_SMON_EMAIL_TEMPLATE_REQUIRED", async () => {
    const { errors } = await load(`
      ${PAYLOADS_AND_TEMPLATES},
      { "adapter.notify": {
          "name": "EmailAdapterNoTemplate",
          "@kind": "email",
          "@payloadRef": "AlertPayload"
      }}
    `);
    expect(codesOf(errors)).toContain("ERR_SMON_EMAIL_TEMPLATE_REQUIRED");
  });

  it("a probe.bash with a bad tag reports ERR_SMON_TAG_GRAMMAR", async () => {
    const { errors } = await load(`
      { "probe.bash": {
          "name": "DiskProbe",
          "@script": "check-disk.sh",
          "@tags": ["disk", "OK_TAG"]
      }}
    `);
    expect(codesOf(errors)).toContain("ERR_SMON_TAG_GRAMMAR");
  });

  it("an adapter whose @payloadRef doesn't resolve to an object.value reports ERR_SMON_PAYLOAD_REF_UNRESOLVED", async () => {
    const { errors } = await load(`
      { "adapter.notify": {
          "name": "BrokenAdapter",
          "@kind": "push",
          "@payloadRef": "NoSuchPayload"
      }}
    `);
    expect(codesOf(errors)).toContain("ERR_SMON_PAYLOAD_REF_UNRESOLVED");
  });

  it("an @alertTemplateRef that doesn't resolve to a template.output reports ERR_SMON_TEMPLATE_REF_UNRESOLVED", async () => {
    const { errors } = await load(`
      { "object.value": { "name": "AlertPayload", "children": [
          { "field.string": { "name": "host", "@required": true } }
      ]}},
      { "adapter.notify": {
          "name": "BrokenTemplateAdapter",
          "@kind": "email",
          "@payloadRef": "AlertPayload",
          "@alertTemplateRef": "NoSuchTemplate"
      }}
    `);
    expect(codesOf(errors)).toContain("ERR_SMON_TEMPLATE_REF_UNRESOLVED");
  });

  it("an @alertTemplateRef whose template.output @payloadRef mismatches reports ERR_SMON_TEMPLATE_PAYLOAD_MISMATCH", async () => {
    const { errors } = await load(`
      ${PAYLOADS_AND_TEMPLATES},
      { "adapter.notify": {
          "name": "MismatchedAdapter",
          "@kind": "email",
          "@payloadRef": "DigestPayload",
          "@alertTemplateRef": "AlertEmail"
      }}
    `);
    expect(codesOf(errors)).toContain("ERR_SMON_TEMPLATE_PAYLOAD_MISMATCH");
  });
});
