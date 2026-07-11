// smon-owned generator (Task 7) — walks the `adapter.notify` nodes (Task 6
// declarations in metaobjects/meta.notify.json, vocabulary from Task 5's
// codegen/smon-provider.ts) and emits the DATA half of the notify registry.
//
// use-when:   ALWAYS for smon — this is the only generator that knows how to
//             read adapter.notify nodes into a keyed lookup table.
// emits:      src/generated/notify/registry.data.ts
// customize:  the ADAPTERS shape, the kebab-case key derivation, and
//             missingAdapterConfig's "empty/absent" rule are all owned here.
//
// IMPORTANT — dependency-ordering deviation from the naive sketch (documented
// in the Task 7 brief): the brief's ADAPTERS entries each carry
//   impl: <impl> satisfies NotifyAdapter<Payload[, Digest]>
// importing from "../../notify/impl/<kebab-name>". Those impl modules are
// Task 9's deliverable and DON'T EXIST YET. Emitting an import to them here
// would make the generated file fail `tsc --noEmit` today for zero benefit
// (nothing can consume the impl before Task 9 exists). So this generator
// emits ONLY the pure-data file: NotifyAdapter<A,D>, ADAPTERS (kind +
// payload/template refs + config-key lists — no `impl` field), AdapterName,
// and missingAdapterConfig(). It is complete and correct on its own, fully
// tsc-clean and unit-testable right now.
//
// Task 9 is additive, not corrective: it adds `notify/impl/<name>.ts` per
// adapter, plus a `notify/registry.ts` (hand-authored or a follow-on
// generator) that imports ADAPTERS from here, imports each impl, and wires
// `impl: theImpl satisfies NotifyAdapter<...>` per entry. Nothing produced
// here is a stub Task 9 must delete.

import type { MetaData } from "@metaobjectsdev/metadata";
import { formatTs, GENERATED_HEADER, type Generator } from "@metaobjectsdev/codegen-ts";

const TYPE_ADAPTER = "adapter";
const ADAPTER_SUBTYPE_NOTIFY = "notify";

/** PascalCase model name -> kebab-case registry key (HaPush -> ha-push). */
function toKebabCase(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1-$2")
    .toLowerCase();
}

function stringAttr(node: MetaData, name: string): string | undefined {
  const v = node.attr(name);
  return typeof v === "string" ? v : undefined;
}

function stringArrayAttr(node: MetaData, name: string): string[] {
  const v = node.attr(name);
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

function renderAdapterEntry(node: MetaData): string {
  const key = toKebabCase(node.name);
  const kind = stringAttr(node, "kind");
  if (kind === undefined) {
    throw new Error(`notify-registry: adapter.notify "${node.name}" is missing required @kind.`);
  }
  const payloadRef = stringAttr(node, "payloadRef");
  if (payloadRef === undefined) {
    throw new Error(`notify-registry: adapter.notify "${node.name}" is missing required @payloadRef.`);
  }
  const digestPayloadRef = stringAttr(node, "digestPayloadRef");
  const requiredConfig = stringArrayAttr(node, "requiredConfig");
  const optionalConfig = stringArrayAttr(node, "optionalConfig");

  const lines = [
    `    kind: ${JSON.stringify(kind)},`,
    `    payloadRef: ${JSON.stringify(payloadRef)},`,
    ...(digestPayloadRef !== undefined ? [`    digestPayloadRef: ${JSON.stringify(digestPayloadRef)},`] : []),
    `    requiredConfig: ${JSON.stringify(requiredConfig)},`,
    `    optionalConfig: ${JSON.stringify(optionalConfig)},`,
  ];
  return `  ${JSON.stringify(key)}: {\n${lines.join("\n")}\n  },`;
}

function renderRegistryData(adapters: readonly MetaData[]): string {
  const sorted = [...adapters].sort((a, b) => a.name.localeCompare(b.name));
  const entries = sorted.map(renderAdapterEntry).join("\n");

  return `// ${GENERATED_HEADER} — DO NOT EDIT.
// Source metadata: adapter.notify nodes in metaobjects/meta.notify.json
// Customize the shape by editing codegen/generators/notify-registry.ts.
//
// This is the DATA half of the notify registry only — no adapter
// implementations are wired here. Task 9 adds notify/impl/<name>.ts plus a
// registry.ts that imports ADAPTERS from this file and attaches each impl.
// See this generator's header comment for why.

/** One notification adapter's send contract. \`sendDigest\` is optional —
 *  only adapters declaring a @digestPayloadRef implement it. */
export interface NotifyAdapter<A, D = never> {
  sendAlert(payload: A, cfg: Readonly<Record<string, string>>): Promise<void>;
  sendDigest?(payload: D, cfg: Readonly<Record<string, string>>): Promise<void>;
}

export const ADAPTERS = {
${entries}
} as const;

export type AdapterName = keyof typeof ADAPTERS;

/** requiredConfig keys for \`name\` whose value is absent/empty in \`env\`. */
export function missingAdapterConfig(name: AdapterName, env: NodeJS.ProcessEnv): string[] {
  return ADAPTERS[name].requiredConfig.filter((key) => {
    const value = env[key];
    return value === undefined || value === "";
  });
}
`;
}

export function notifyRegistry(): Generator {
  return {
    name: "notify-registry",
    generate: async (ctx) => {
      const adapters = ctx.loadedRoot.childrenOfSubType(TYPE_ADAPTER, ADAPTER_SUBTYPE_NOTIFY);
      return [
        {
          path: "notify/registry.data.ts",
          content: await formatTs(renderRegistryData(adapters)),
        },
      ];
    },
  };
}
