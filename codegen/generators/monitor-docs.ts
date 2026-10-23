// smon-owned generator (Task 7) — walks the `adapter.notify` + `probe.bash`
// nodes and emits docs/generated/monitoring.md: two tables built straight
// from the model, so the docs can never drift from what's actually declared.
//
// use-when:   ALWAYS for smon — companion doc to notify-registry.ts / probe-roster.ts.
// emits:      docs/generated/monitoring.md — written to the `docs` target (since 1.1.0
//             documentation is a generator; targets.docs.outDir is ./docs), so the
//             path below is relative to that target, not to src/generated.
// customize:  column set/ordering per table is owned here.
//
// PUBLIC-REPO NOTE: only env-KEY NAMES from @requiredConfig / @optionalConfig
// / @configKeys are rendered — never a resolved value. The model itself never
// carries host data (see codegen/smon-provider.ts), so this can't leak any.

import type { MetaData } from "@metaobjectsdev/metadata";
import { GENERATED_HEADER, GENERATED_EDIT_NOTE, type Generator } from "@metaobjectsdev/codegen-ts";

const TYPE_ADAPTER = "adapter";
const ADAPTER_SUBTYPE_NOTIFY = "notify";
const TYPE_PROBE = "probe";
const PROBE_SUBTYPE_BASH = "bash";

function stringAttr(node: MetaData, name: string): string | undefined {
  const v = node.attr(name);
  return typeof v === "string" ? v : undefined;
}

function stringArrayAttr(node: MetaData, name: string): string[] {
  const v = node.attr(name);
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

/** Escape a cell for GFM table syntax (bare `|` breaks column parsing). */
function mdCell(cell: string): string {
  return cell.replace(/\|/g, "\\|");
}

function codeList(values: readonly string[]): string {
  return values.length > 0 ? values.map((v) => `\`${v}\``).join(", ") : "-";
}

function renderAdaptersTable(adapters: readonly MetaData[]): string {
  const rows = [...adapters]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((a) => {
      const kind = stringAttr(a, "kind") ?? "";
      const payloadRef = stringAttr(a, "payloadRef") ?? "";
      const digestPayloadRef = stringAttr(a, "digestPayloadRef");
      const payloads = digestPayloadRef ? `${payloadRef} / ${digestPayloadRef}` : payloadRef;
      const requiredConfig = codeList(stringArrayAttr(a, "requiredConfig"));
      const alertTemplateRef = stringAttr(a, "alertTemplateRef");
      const digestTemplateRef = stringAttr(a, "digestTemplateRef");
      const templates = [alertTemplateRef, digestTemplateRef].filter((t): t is string => t !== undefined);
      const templatesCol = templates.length > 0 ? templates.join(", ") : "-";
      return `| ${mdCell(a.name)} | ${mdCell(kind)} | ${mdCell(payloads)} | ${requiredConfig} | ${templatesCol} |`;
    });

  return ["| Adapter | Kind | Payloads | Required config | Templates |", "|---|---|---|---|---|", ...rows].join("\n");
}

function renderProbesTable(probes: readonly MetaData[]): string {
  const rows = [...probes]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((p) => {
      const script = stringAttr(p, "script") ?? "";
      const tags = codeList(stringArrayAttr(p, "tags"));
      const configKeys = codeList(stringArrayAttr(p, "configKeys"));
      return `| ${mdCell(p.name)} | \`${mdCell(script)}\` | ${tags} | ${configKeys} |`;
    });

  return ["| Probe | Script | Tags | Config keys |", "|---|---|---|---|", ...rows].join("\n");
}

// Relative to the docs target (targets.docs.outDir in metaobjects.config.ts).
const DOCS_OUTPUT_PATH = "generated/monitoring.md";

export function monitorDocs(): Generator {
  return {
    name: "monitor-docs",
    // Documentation target (1.1.0): written under targets.docs.outDir, beside the model pages.
    target: "docs",
    generate: (ctx) => {
      const adapters = ctx.loadedRoot.childrenOfSubType(TYPE_ADAPTER, ADAPTER_SUBTYPE_NOTIFY);
      const probes = ctx.loadedRoot.childrenOfSubType(TYPE_PROBE, PROBE_SUBTYPE_BASH);
      const content = `<!-- ${GENERATED_HEADER} — ${GENERATED_EDIT_NOTE} -->

# Monitoring reference

Generated from \`metaobjects/meta.notify.json\` by \`codegen/generators/monitor-docs.ts\`
(via \`bun run gen\`) — this page cannot drift from the declared model.

## Notify adapters

${renderAdaptersTable(adapters)}

## Probes

${renderProbesTable(probes)}
`;
      return [{ path: DOCS_OUTPUT_PATH, content }];
    },
  };
}
