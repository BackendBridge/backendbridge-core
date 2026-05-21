import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { runExtraction } from "../src/extract.js";
import { runConversion } from "../src/convert.js";

const fixturesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "fixtures/laravel-mini");

describe("e2e: Laravel → Symfony conversion", () => {
  let tmpDir: string;
  let openApiPath: string;
  let outPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bb-e2e-l2s-"));
    openApiPath = path.join(tmpDir, "openapi.json");
    outPath = path.join(tmpDir, "symfony-out");
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("extracts routes + FormRequest schemas from Laravel fixture", () => {
    const result = runExtraction(
      { from: "laravel", sourcePath: fixturesDir, outPath: openApiPath, dryRun: true },
      false,
    );

    expect(result.from).toBe("laravel");
    expect(result.endpoints).toBeGreaterThanOrEqual(8); // 5 users + 3 orders

    const doc = JSON.parse(fs.readFileSync(openApiPath, "utf8"));

    // Routes present
    expect(doc.paths["/users"]).toBeDefined();
    expect(doc.paths["/users/{id}"]).toBeDefined();
    expect(doc.paths["/orders"]).toBeDefined();
    expect(doc.paths["/orders/{id}"]).toBeDefined();

    // Path parameters declared
    expect(doc.paths["/users/{id}"].get.parameters).toBeDefined();
    expect(doc.paths["/users/{id}"].get.parameters[0].name).toBe("id");
    expect(doc.paths["/users/{id}"].get.parameters[0].in).toBe("path");

    // POST /users has a requestBody
    expect(doc.paths["/users"].post.requestBody).toBeDefined();

    // POST /orders has a requestBody
    expect(doc.paths["/orders"].post.requestBody).toBeDefined();

    // FormRequest schemas extracted into components
    expect(doc.components?.schemas).toBeDefined();
  });

  it("generates valid Symfony scaffold with controllers and DTOs", () => {
    // Extract first
    runExtraction(
      { from: "laravel", sourcePath: fixturesDir, outPath: openApiPath, dryRun: true },
      false,
    );

    // Convert to Symfony
    const result = runConversion(
      {
        from: "laravel",
        to: "symfony",
        sourcePath: fixturesDir,
        outPath,
        openApiPath,
        dryRun: true,
      },
      false,
    );

    expect(result.from).toBe("laravel");
    expect(result.to).toBe("symfony");
    expect(result.generatedFiles.length).toBeGreaterThan(0);

    // Controllers generated
    const controllersDir = path.join(outPath, "src", "Controller", "Generated");
    expect(fs.existsSync(controllersDir)).toBe(true);
    const controllers = fs.readdirSync(controllersDir).filter((f) => f.endsWith(".php"));
    expect(controllers.length).toBeGreaterThanOrEqual(8);

    // Each controller contains valid PHP class declaration
    for (const ctrl of controllers) {
      const content = fs.readFileSync(path.join(controllersDir, ctrl), "utf8");
      expect(content).toContain("<?php");
      expect(content).toContain("class ");
      expect(content).toContain("extends AbstractController");
      expect(content).toContain("#[Route(");
    }

    // DTOs generated for POST endpoints
    const dtoDir = path.join(outPath, "src", "Dto", "Generated");
    expect(fs.existsSync(dtoDir)).toBe(true);
    const dtos = fs.readdirSync(dtoDir).filter((f) => f.endsWith(".php"));
    expect(dtos.length).toBeGreaterThanOrEqual(1);

    // DTO has Assert constraints
    const dtoContent = fs.readFileSync(path.join(dtoDir, dtos[0]), "utf8");
    expect(dtoContent).toContain("<?php");
    expect(dtoContent).toContain("Assert");

    // Metadata file written
    expect(fs.existsSync(path.join(outPath, ".backendbridge.meta.json"))).toBe(true);

    // Core conversion must not produce fatal errors (only optional steps may warn)
    const fatalWarnings = result.warnings.filter((w) => !w.startsWith("[entities]") && !w.startsWith("[migrations]") && !w.startsWith("[env]"));
    expect(fatalWarnings.length).toBe(0);
  });
});
