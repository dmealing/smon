// smon-monitor-types — the smon-specific metamodel vocabulary (Task 5).
//
// Registers two brand-new downstream types (NOT extensions of an existing core
// type, unlike the `template.toolcall` recipe example — these have no core
// analogue):
//
//   - adapter.notify — a notification-adapter declaration (push/heartbeat/chat/
//     email/stdout) with payload + template cross-references.
//   - probe.bash     — a bash-script probe declaration with a tag roster.
//
// IMPORTANT — a real API constraint this provider works around: `metadata.root`
// (registered by `metaobjects-core-types`) only admits `object`/`field`/
// `validator`/`template` as direct children (its own childRules are a CLOSED
// set of exactly those four types). Since `adapter` and `probe` are brand-new
// top-level types (not subtypes of an existing whitelisted type), authoring
// `adapter.notify` / `probe.bash` as top-level siblings of `object.value` /
// `template.output` (this project's flat authoring convention — see
// metaobjects/meta.monitor.json) would otherwise fail `meta verify`'s
// strict-by-default load with ERR_CHILD_NOT_ALLOWED. This provider fixes that
// by `registry.extend`-ing metadata.root's childRules to also admit `adapter`
// and `probe`. See docs/recipes/extending-metaobjects-with-providers.md and
// docs/features/extending-with-providers.md (the `registry.extend` half) in
// the metaobjects repo.
//
// Cross-node template-ref validation (@alertTemplateRef/@digestTemplateRef →
// template.output @kind=email with a matching @payloadRef) is done by hand in
// the `validate` hook by walking `node.root()` — the loader's built-in
// `references` mechanism (ValidationContext.symbols.resolveObject) only
// indexes `object.*` top-level nodes (see validation-registry.ts
// SymbolTableImpl.build), so it can never resolve a `template.output` target.
// `payloadRef`/`digestPayloadRef` → object.value DOES use the built-in
// `references` mechanism, since those targets are object nodes and the
// SymbolTable indexes them for free.

import {
  type MetaDataTypeProvider,
  type ChildRule,
  MetaData,
  TYPE_METADATA,
  SUBTYPE_ROOT,
  TYPE_OBJECT,
  OBJECT_SUBTYPE_VALUE,
  ATTR_SUBTYPE_STRING,
  CHILD_RULE_WILDCARD,
  TypeId,
} from "@metaobjectsdev/metadata";

const TYPE_ADAPTER = "adapter";
const ADAPTER_SUBTYPE_NOTIFY = "notify";
const TYPE_PROBE = "probe";
const PROBE_SUBTYPE_BASH = "bash";

const ADAPTER_KINDS = ["push", "heartbeat", "chat", "email", "stdout"] as const;
const ADAPTER_KIND_EMAIL = "email";

// Tag grammar: one leading letter, then 1-23 more [A-Z0-9_] chars (2-24 total).
const TAG_GRAMMAR = /^[A-Z][A-Z0-9_]{1,23}$/;

const ROOT_KEY = `${TYPE_METADATA}.${SUBTYPE_ROOT}`;

// Concrete node classes — MetaData itself is abstract (mirrors the widget.gauge
// conformance proof in @metaobjectsdev/metadata's own test suite: a downstream
// type needs no special runtime behavior beyond MetaData, just a name to `new`).
class MetaAdapterNotify extends MetaData {}
class MetaProbeBash extends MetaData {}

function wildcard(childType: string): ChildRule {
  return { childType, childSubType: CHILD_RULE_WILDCARD, childName: CHILD_RULE_WILDCARD };
}

/**
 * Best-effort lookup of a top-level `template.output` node by bare name,
 * walking up to the tree root. Mirrors this project's flat authoring
 * convention (adapters and templates are declared as siblings directly under
 * `metadata.root`) rather than the generic `SymbolTable`, which only indexes
 * `object.*` nodes and can never resolve a `template.*` ref.
 */
function findTemplateOutputByName(node: MetaData, ref: string): MetaData | undefined {
  return node
    .root()
    .childrenOfSubType("template", "output")
    .find((t) => t.name === ref);
}

/**
 * smon-monitor-types — the vocabulary for Task 6's adapter declarations + probe
 * roster and Task 7's registry codegen.
 */
export const smonMonitorTypes: MetaDataTypeProvider = {
  id: "smon-monitor-types",
  dependencies: ["metaobjects-core-types"],
  description:
    "smon monitor vocabulary: adapter.notify (notification-adapter declarations: " +
    "push/heartbeat/chat/email/stdout) + probe.bash (bash-script probe declarations " +
    "with a tag roster).",
  registerTypes(registry) {
    registry.register({
      typeId: new TypeId(TYPE_ADAPTER, ADAPTER_SUBTYPE_NOTIFY),
      description:
        "A notification-adapter declaration: how one alert/digest sink (push, " +
        "heartbeat, chat, email, stdout) is fed and rendered.",
      factory: (typeId, name) => new MetaAdapterNotify(typeId, name),
      childRules: [],
      parents: [ROOT_KEY],
      references: [
        {
          attr: "payloadRef",
          targetType: TYPE_OBJECT,
          targetSubType: OBJECT_SUBTYPE_VALUE,
          errorCode: "ERR_SMON_PAYLOAD_REF_UNRESOLVED",
        },
        {
          attr: "digestPayloadRef",
          targetType: TYPE_OBJECT,
          targetSubType: OBJECT_SUBTYPE_VALUE,
          errorCode: "ERR_SMON_DIGEST_PAYLOAD_REF_UNRESOLVED",
        },
      ],
      attributes: [
        {
          name: "kind",
          valueType: ATTR_SUBTYPE_STRING,
          required: true,
          allowedValues: ADAPTER_KINDS,
          description: "The adapter's sink kind — closed enum: push|heartbeat|chat|email|stdout.",
        },
        {
          name: "payloadRef",
          valueType: ATTR_SUBTYPE_STRING,
          required: true,
          description: "Reference to the object.value payload this adapter's alert renders against.",
        },
        {
          name: "digestPayloadRef",
          valueType: ATTR_SUBTYPE_STRING,
          required: false,
          description: "Reference to the object.value payload this adapter's digest renders against.",
        },
        {
          name: "alertTemplateRef",
          valueType: ATTR_SUBTYPE_STRING,
          required: false,
          description:
            "Reference to the template.output (@kind=email) this adapter uses to render an alert.",
        },
        {
          name: "digestTemplateRef",
          valueType: ATTR_SUBTYPE_STRING,
          required: false,
          description:
            "Reference to the template.output (@kind=email) this adapter uses to render a digest.",
        },
        {
          name: "requiredConfig",
          valueType: ATTR_SUBTYPE_STRING,
          isArray: true,
          required: false,
          description: "Config keys this adapter cannot function without.",
        },
        {
          name: "optionalConfig",
          valueType: ATTR_SUBTYPE_STRING,
          isArray: true,
          required: false,
          description: "Config keys this adapter honors if present but doesn't require.",
        },
      ],
      validate: (node, ctx) => {
        const kind = node.attr("kind");

        if (kind === ADAPTER_KIND_EMAIL) {
          const alertTemplateRef = node.attr("alertTemplateRef");
          if (typeof alertTemplateRef !== "string" || alertTemplateRef === "") {
            ctx.error(
              "ERR_SMON_EMAIL_TEMPLATE_REQUIRED",
              node,
              `adapter.notify "${node.name}" has @kind="email" but declares no @alertTemplateRef.`,
            );
          }
        }

        // Best-effort cross-node check: each declared template ref must resolve
        // to a template.output @kind=email whose own @payloadRef matches this
        // adapter's corresponding payload ref (@alertTemplateRef <-> @payloadRef,
        // @digestTemplateRef <-> @digestPayloadRef).
        const templateChecks: ReadonlyArray<readonly [refAttr: string, payloadAttr: string]> = [
          ["alertTemplateRef", "payloadRef"],
          ["digestTemplateRef", "digestPayloadRef"],
        ];
        for (const [refAttr, payloadAttr] of templateChecks) {
          const ref = node.attr(refAttr);
          if (typeof ref !== "string" || ref === "") continue;

          const target = findTemplateOutputByName(node, ref);
          if (!target) {
            ctx.error(
              "ERR_SMON_TEMPLATE_REF_UNRESOLVED",
              node,
              `adapter.notify "${node.name}" @${refAttr} "${ref}" does not resolve to a template.output node.`,
            );
            continue;
          }
          if (target.attr("kind") !== ADAPTER_KIND_EMAIL) {
            ctx.error(
              "ERR_SMON_TEMPLATE_REF_NOT_EMAIL",
              node,
              `adapter.notify "${node.name}" @${refAttr} "${ref}" resolves to template.output ` +
                `"${target.name}", which is not @kind="email".`,
            );
            continue;
          }
          const wantPayload = node.attr(payloadAttr);
          const gotPayload = target.attr("payloadRef");
          if (typeof wantPayload === "string" && wantPayload !== "" && gotPayload !== wantPayload) {
            ctx.error(
              "ERR_SMON_TEMPLATE_PAYLOAD_MISMATCH",
              node,
              `adapter.notify "${node.name}" @${refAttr} "${ref}" has @payloadRef ` +
                `"${String(gotPayload)}", which does not match this adapter's @${payloadAttr} "${wantPayload}".`,
            );
          }
        }
      },
    });

    registry.register({
      typeId: new TypeId(TYPE_PROBE, PROBE_SUBTYPE_BASH),
      description: "A bash-script probe declaration: the script to run + its tag roster.",
      factory: (typeId, name) => new MetaProbeBash(typeId, name),
      childRules: [],
      parents: [ROOT_KEY],
      attributes: [
        {
          name: "script",
          valueType: ATTR_SUBTYPE_STRING,
          required: true,
          description: "Path (or name) of the bash script this probe runs.",
        },
        {
          name: "tags",
          valueType: ATTR_SUBTYPE_STRING,
          isArray: true,
          required: true,
          description: `This probe's tag roster. Each tag must match ${TAG_GRAMMAR}.`,
        },
        {
          name: "configKeys",
          valueType: ATTR_SUBTYPE_STRING,
          isArray: true,
          required: false,
          description: "Config keys this probe reads.",
        },
      ],
      validate: (node, ctx) => {
        const tags = node.attr("tags");
        if (!Array.isArray(tags)) return;
        for (const tag of tags) {
          if (typeof tag === "string" && !TAG_GRAMMAR.test(tag)) {
            ctx.error(
              "ERR_SMON_TAG_GRAMMAR",
              node,
              `probe.bash "${node.name}" tag "${tag}" does not match ${TAG_GRAMMAR}.`,
            );
          }
        }
      },
    });

    // metadata.root's own childRules are a CLOSED set of exactly
    // [object, field, validator, template] (see core-types.ts). Extend it so
    // `adapter.notify` / `probe.bash` can be declared as top-level siblings —
    // this project's existing flat authoring convention (meta.monitor.json).
    registry.extend(TYPE_METADATA, SUBTYPE_ROOT, {
      childRules: [wildcard(TYPE_ADAPTER), wildcard(TYPE_PROBE)],
    });
  },
};
