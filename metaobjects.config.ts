import { defineConfig } from "@metaobjectsdev/cli";
// Owned codegen generators (ADR-0034 scaffold-and-own). `meta init` copied these
// reference templates into ./codegen/generators/ — they are YOURS to edit, and
// `meta gen` runs from these local copies, not from the package. Read each file's
// header doc-block for what it emits and how to customize it.
import { entityFile } from "./codegen/generators/entity";
import { barrel } from "./codegen/generators/barrel";
// Stock (non-owned) generators consumed directly from the package.
//   promptRender / renderHelper — wrap the render engine for template.prompt /
//     template.output nodes; no per-project customization wanted.
//   namesFile — the <Entity>Names artifact (the physical table/column names spelled
//     ONCE, referenced everywhere else). It emits ZERO files here and that is correct,
//     not a misconfiguration: every object smon declares is a sourceless object.value,
//     so the project has no physical database names to spell. It is wired anyway so the
//     artifact appears by itself the day an object gains a source.rdb, rather than being
//     the thing nobody remembers to add. (Since 1.0.x `meta gen` reports it on every run
//     as "1 wired generator(s) matched nothing and wrote no file: names" — expected here.)
import { promptRender, renderHelper, namesFile } from "@metaobjectsdev/codegen-ts/generators";
// smon's own metamodel vocabulary (Task 5) — adapter.notify + probe.bash.
import { smonMonitorTypes } from "./codegen/smon-provider";
// smon's own codegen (Task 7) — walks adapter.notify / probe.bash nodes and
// emits the notify registry (data half — see notify-registry.ts header for
// why impls aren't wired here yet), the probe roster, and the drift-free
// monitoring docs page.
import { notifyRegistry } from "./codegen/generators/notify-registry";
import { probeRoster } from "./codegen/generators/probe-roster";
import { monitorDocs } from "./codegen/generators/monitor-docs";

export default defineConfig({
  outDir:    "src/generated",
  extStyle:  "none",
  // No dbImport/dialect. Both used to be REQUIRED by the config type even for a project
  // with no database, and this file carried two lies ("../db", "sqlite") to satisfy it.
  // Since 0.24.3 each is demanded at the point of USE — by the generator that emits an
  // import of it — so a model that generates no database code declares neither.
  providers: [smonMonitorTypes],
  generators: [
    // Import the HTTP-adapter types from the published package, not an owned copy under
    // codegen/runtime/ (none is ejected here) — matters once an object gains a source.rdb.
    entityFile({ runtimeImport: "@metaobjectsdev/runtime-ts" }),
    namesFile(),
    barrel(),
    promptRender(),
    renderHelper(),
    notifyRegistry(),
    probeRoster(),
    monitorDocs(),
  ],
  docs: {
    outDir:   "./docs",        // every surface lands here (run: bun run docs)
    layout:   "flat",          // or "package" for multi-package models
    // "agent" is the 1.0 surface .metaobjects/AGENTS.md tells a reader to consult before
    // touching a tier. It currently emits NOTHING for smon — its three pages describe a
    // physical schema, a generated UI and a requirement ledger, and smon has none of the
    // three, so by the surface's own "an empty page is no file" rule no agent/ directory
    // appears. Declared so it starts working on its own if that ever changes.
    surfaces: ["model", "api", "agent"],
  },
});
