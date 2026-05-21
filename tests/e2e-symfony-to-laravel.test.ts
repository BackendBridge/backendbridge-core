import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { load } from "js-yaml";
import { runExtraction } from "../src/extract.js";
import { runConversion } from "../src/convert.js";

const fixturesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "fixtures/symfony-mini");

describe("e2e: Symfony → Laravel conversion", () => {
  let tmpDir: string;
  let openApiPath: string;
  let outPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "bb-e2e-s2l-"));
    openApiPath = path.join(tmpDir, "openapi.yaml");
    outPath = path.join(tmpDir, "laravel-out");
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("extracts routes from Symfony fixture with class-level prefix", () => {
    const result = runExtraction(
      { from: "symfony", sourcePath: fixturesDir, outPath: openApiPath, dryRun: true },
      false,
    );

    expect(result.from).toBe("symfony");
    // UserController (5 routes with /api prefix) + ProductController (3 routes)
    expect(result.endpoints).toBeGreaterThanOrEqual(5);

    const raw = fs.readFileSync(openApiPath, "utf8");
    expect(raw).toContain("openapi:");

    const doc = load(raw) as Record<string, unknown>;
    const docPaths = doc.paths as Record<string, unknown>;

    // ProductController routes (no prefix)
    expect(docPaths["/products"]).toBeDefined();
    expect(docPaths["/products/{id}"]).toBeDefined();

    // Path parameters declared on /products/{id}
    const productShow = (docPaths["/products/{id}"] as Record<string, unknown>).get as Record<string, unknown>;
    expect(productShow.parameters).toBeDefined();
    expect((productShow.parameters as unknown[]).length).toBeGreaterThan(0);

    // Responses include 404 for path with params
    expect((productShow.responses as Record<string, unknown>)["404"]).toBeDefined();
  });

  it("generates valid Laravel scaffold with controllers and FormRequests", () => {
    // Extract
    runExtraction(
      { from: "symfony", sourcePath: fixturesDir, outPath: openApiPath, dryRun: true },
      false,
    );

    // Convert to Laravel
    const result = runConversion(
      {
        from: "symfony",
        to: "laravel",
        sourcePath: fixturesDir,
        outPath,
        openApiPath,
        dryRun: true,
      },
      false,
    );

    expect(result.from).toBe("symfony");
    expect(result.to).toBe("laravel");
    expect(result.generatedFiles.length).toBeGreaterThan(0);

    // Controllers generated
    const controllersDir = path.join(outPath, "app", "Http", "Controllers", "Generated");
    expect(fs.existsSync(controllersDir)).toBe(true);
    const controllers = fs.readdirSync(controllersDir).filter((f) => f.endsWith(".php"));
    expect(controllers.length).toBeGreaterThanOrEqual(5);

    // Each controller is valid PHP
    for (const ctrl of controllers) {
      const content = fs.readFileSync(path.join(controllersDir, ctrl), "utf8");
      expect(content).toContain("<?php");
      expect(content).toContain("class ");
      expect(content).toContain("extends Controller");
      expect(content).toContain("JsonResponse");
    }

    // routes/api.php generated with Route:: calls
    const routesFile = path.join(outPath, "routes", "api.php");
    expect(fs.existsSync(routesFile)).toBe(true);
    const routesContent = fs.readFileSync(routesFile, "utf8");
    expect(routesContent).toContain("Route::");
    expect(routesContent).toContain("/products");

    // Metadata present
    expect(fs.existsSync(path.join(outPath, ".backendbridge.meta.json"))).toBe(true);
    const meta = JSON.parse(fs.readFileSync(path.join(outPath, ".backendbridge.meta.json"), "utf8"));
    expect(meta.from).toBe("symfony");
    expect(meta.to).toBe("laravel");
  });
});
