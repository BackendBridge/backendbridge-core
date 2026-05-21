import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runConversion } from "../src/convert.js";
import { runMappingExport } from "../src/mapping.js";

describe("mapping export/import usage", () => {
  it("exporte un mapping puis l'applique en conversion", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "backendbridge-mapping-"));
    const sourcePath = path.join(tmpDir, "source");
    const openApiPath = path.join(tmpDir, "contract.yaml");
    const mappingPath = path.join(tmpDir, "mapping.json");
    const outPath = path.join(tmpDir, "generated");

    fs.mkdirSync(path.join(sourcePath, "routes"), { recursive: true });
    fs.mkdirSync(path.join(sourcePath, "app", "Http", "Requests"), { recursive: true });
    fs.writeFileSync(
      path.join(sourcePath, "composer.json"),
      JSON.stringify({ require: { "laravel/framework": "^11.0" } }, null, 2),
      "utf8",
    );
    fs.writeFileSync(
      path.join(sourcePath, "routes", "api.php"),
      "<?php\nRoute::post('/orders', [OrderController::class, 'store']);\n",
      "utf8",
    );
    fs.writeFileSync(path.join(sourcePath, "app", "Http", "Requests", "OrderRequest.php"), "<?php", "utf8");

    const exported = runMappingExport(
      {
        from: "auto",
        sourcePath,
        openApiPath,
        outPath: mappingPath,
        dryRun: true,
      },
      false,
    );

    expect(exported.rules).toBeGreaterThan(0);
    expect(fs.existsSync(mappingPath)).toBe(true);

    const converted = runConversion(
      {
        from: "laravel",
        to: "symfony",
        sourcePath,
        outPath,
        openApiPath,
        mappingPath,
        dryRun: true,
      },
      false,
    );

    expect(converted.generatedFiles.length).toBeGreaterThan(0);
    const generatedController = fs
      .readdirSync(path.join(outPath, "src", "Controller", "Generated"))
      .find((name) => name.endsWith("Controller.php"));
    expect(generatedController).toBeTruthy();

    const raw = fs.readFileSync(
      path.join(outPath, "src", "Controller", "Generated", generatedController as string),
      "utf8",
    );
    expect(raw).toContain("Validation:");
    expect(raw).toContain("Auth:");
  });
});
