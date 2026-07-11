// smon-owned generator (Task 7) — walks the `probe.bash` nodes (Task 6
// declarations in metaobjects/meta.notify.json, vocabulary from Task 5's
// codegen/smon-provider.ts) and emits the probe roster.
//
// use-when:   ALWAYS for smon — this is the only generator that knows how to
//             read probe.bash nodes into a keyed lookup table.
// emits:      src/generated/probes/roster.ts
// customize:  the PROBES shape and the registry key (currently the probe's
//             own @script, which this project already authors in kebab-case)
//             are owned here.

import type { MetaData } from "@metaobjectsdev/metadata";
import { formatTs, GENERATED_HEADER, type Generator } from "@metaobjectsdev/codegen-ts";

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

function renderProbeEntry(node: MetaData): { key: string; body: string } {
  const script = stringAttr(node, "script");
  if (script === undefined) {
    throw new Error(`probe-roster: probe.bash "${node.name}" is missing required @script.`);
  }
  const tags = stringArrayAttr(node, "tags");
  const configKeys = stringArrayAttr(node, "configKeys");

  const body = [
    `    script: ${JSON.stringify(script)},`,
    `    tags: ${JSON.stringify(tags)},`,
    `    configKeys: ${JSON.stringify(configKeys)},`,
  ].join("\n");
  return { key: script, body };
}

function renderRoster(probes: readonly MetaData[]): string {
  // Registry key = the probe's own @script (this project already authors it
  // kebab-case, e.g. "sys-diag") — reusing it (rather than re-deriving from
  // the node name) keeps PROBES keys byte-identical to the script filenames.
  const sorted = [...probes].sort((a, b) => a.name.localeCompare(b.name));
  const entries = sorted
    .map(renderProbeEntry)
    .map(({ key, body }) => `  ${JSON.stringify(key)}: {\n${body}\n  },`)
    .join("\n");

  return `// ${GENERATED_HEADER} — DO NOT EDIT.
// Source metadata: probe.bash nodes in metaobjects/meta.notify.json
// Customize the shape by editing codegen/generators/probe-roster.ts.

export const PROBES = {
${entries}
} as const;

export type ProbeName = keyof typeof PROBES;
export type KnownTag = (typeof PROBES)[ProbeName]["tags"][number];
`;
}

export function probeRoster(): Generator {
  return {
    name: "probe-roster",
    generate: async (ctx) => {
      const probes = ctx.loadedRoot.childrenOfSubType(TYPE_PROBE, PROBE_SUBTYPE_BASH);
      return [
        {
          path: "probes/roster.ts",
          content: await formatTs(renderRoster(probes)),
        },
      ];
    },
  };
}
