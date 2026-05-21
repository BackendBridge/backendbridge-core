import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runPipeline } from "../src/pipeline.js";

describe("runPipeline", () => {
  it("execute un plan extract puis convert en dry-run", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "backendbridge-pipeline-"));
    const sourcePath = path.join(tmpDir, "source");
    const routesPath = path.join(sourcePath, "routes");

    fs.mkdirSync(routesPath, { recursive: true });
    fs.writeFileSync(
      path.join(sourcePath, "composer.json"),
      JSON.stringify({ require: { "laravel/framework": "^11.0" } }, null, 2),
      "utf8",
    );
    fs.writeFileSync(
      path.join(routesPath, "api.php"),
      "<?php\nRoute::get('/health', [HealthController::class, 'index']);\n",
      "utf8",
    );

    const planPath = path.join(tmpDir, "pipeline.yaml");
    fs.writeFileSync(
      planPath,
      `version: 1
actions:
  - type: extract
    from: auto
    source: ./source
    out: ./contract.yaml
  - type: convert
    from: auto
    to: symfony
    source: ./source
    openapi: ./contract.yaml
    out: ./generated
`,
      "utf8",
    );

    const result = runPipeline(planPath, false, true);

    expect(result.actions).toBe(2);
    expect(result.summaries).toHaveLength(2);
    expect(fs.existsSync(path.join(tmpDir, "contract.yaml"))).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, "generated", ".backendbridge.meta.json"))).toBe(true);
  });
});
