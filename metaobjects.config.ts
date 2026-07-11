import { defineConfig } from "@metaobjectsdev/cli";
// Owned codegen generators (ADR-0034 scaffold-and-own). `meta init` copied these
// reference templates into ./codegen/generators/ — they are YOURS to edit, and
// `meta gen` runs from these local copies, not from the package. Read each file's
// header doc-block for what it emits and how to customize it.
import { entityFile } from "./codegen/generators/entity";
import { queriesFile } from "./codegen/generators/queries";
import { routesFile } from "./codegen/generators/routes";
import { barrel } from "./codegen/generators/barrel";
// Stock (non-owned) generators consumed directly from the package — these wrap
// the render engine for template.prompt / template.output nodes and don't need
// per-project customization, so they aren't scaffold-and-own like the ones above.
import { promptRender, renderHelper } from "@metaobjectsdev/codegen-ts/generators";
// smon's own metamodel vocabulary (Task 5) — adapter.notify + probe.bash.
import { smonMonitorTypes } from "./codegen/smon-provider";

export default defineConfig({
  outDir:    "src/generated",
  extStyle:  "none",
  dbImport:  "../db",
  dialect:   "sqlite",
  apiPrefix: "",     // set to "/api" if your routes mount under /api
  providers: [smonMonitorTypes],
  generators: [
    entityFile(),
    queriesFile(),
    routesFile(),
    barrel(),
    promptRender(),
    renderHelper(),
  ],
  docs: {
    outDir:   "./docs",        // model + api surfaces both land here (run: meta docs)
    layout:   "flat",          // or "package" for multi-package models
    surfaces: ["model", "api"],
  },
});
