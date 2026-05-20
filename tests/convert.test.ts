import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runConversion } from "../src/convert.js";

describe("runConversion", () => {
  it("genere un scaffold Laravel en dry-run", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "backendbridge-convert-"));
    const sourcePath = path.join(tmpDir, "source");
    const outPath = path.join(tmpDir, "out");
    const openApiPath = path.join(tmpDir, "openapi.json");

    fs.mkdirSync(sourcePath, { recursive: true });
    fs.writeFileSync(
      path.join(sourcePath, "composer.json"),
      JSON.stringify({ require: { "symfony/framework-bundle": "^7.0" } }, null, 2),
      "utf8",
    );

    fs.writeFileSync(
      openApiPath,
      JSON.stringify(
        {
          openapi: "3.0.3",
          info: { title: "Bridge Test", version: "1.0.0" },
          paths: {
            "/health": {
              get: {
                operationId: "healthCheck",
              },
            },
          },
        },
        null,
        2,
      ),
      "utf8",
    );

    const result = runConversion(
      {
        from: "auto",
        to: "laravel",
        sourcePath,
        outPath,
        openApiPath,
        dryRun: true,
      },
      false,
    );

    expect(result.from).toBe("symfony");
    expect(result.to).toBe("laravel");
    expect(result.generatedFiles.length).toBeGreaterThan(0);
    expect(fs.existsSync(path.join(outPath, "routes", "api.php"))).toBe(true);
  });
});
