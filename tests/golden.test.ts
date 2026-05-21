/**
 * Golden tests — fixture input → generated output comparison.
 *
 * These tests protect against regressions by verifying that the generated
 * scaffold matches a set of invariants (structure, key content) rather than
 * exact byte-for-byte snapshots (which would be brittle to whitespace changes).
 *
 * Fixtures live in tests/fixtures/. Each fixture is a minimal PHP project
 * that exercises a specific extraction + generation path.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { parseOpenApiToContract } from "../src/openapi.js";
import { runExtraction } from "../src/extract.js";
import { generateLaravelFromContract } from "../src/generators/laravel.js";
import { generateSymfonyFromContract } from "../src/generators/symfony.js";
import { contractToIR } from "../src/ir.js";

const FIXTURES = path.resolve(import.meta.dirname, "fixtures");

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "bb-golden-"));
}

function phpLint(files: string[]): void {
  for (const f of files.filter((f) => f.endsWith(".php"))) {
    execFileSync("php", ["-l", f], { stdio: "pipe" });
  }
}

// ─── Fixture: Symfony Blog → Laravel ─────────────────────────────────────────

describe("Golden: symfony-blog fixture → Laravel scaffold", () => {
  const fixture = path.join(FIXTURES, "symfony-blog");
  let outDir: string;
  let openApiPath: string;
  let generated: string[];

  beforeAll(() => {
    outDir = tmpDir();
    openApiPath = path.join(outDir, "openapi.yaml");

    // Extract OpenAPI from fixture
    runExtraction(
      { from: "symfony", sourcePath: fixture, outPath: openApiPath, dryRun: false },
      false,
    );

    const contract = parseOpenApiToContract(openApiPath);
    generated = generateLaravelFromContract(contract, outDir);
  });

  afterAll(() => fs.rmSync(outDir, { recursive: true, force: true }));

  it("extracts at least 5 endpoints from the fixture controllers", () => {
    const contract = parseOpenApiToContract(openApiPath);
    expect(contract.endpoints.length).toBeGreaterThanOrEqual(5);
  });

  it("generates at least one controller in Controllers/Generated/", () => {
    expect(generated.some((f) => f.includes("Controllers") && f.endsWith("Controller.php"))).toBe(true);
  });

  it("generates controllers for posts AND comments resources", () => {
    const ctrls = generated.filter((f) => f.includes("Controllers") && f.endsWith("Controller.php"));
    const names = ctrls.map((f) => path.basename(f).toLowerCase());
    expect(names.some((n) => n.includes("post"))).toBe(true);
    expect(names.some((n) => n.includes("comment"))).toBe(true);
  });

  it("generates routes/api.php", () => {
    expect(generated.some((f) => f.endsWith("api.php"))).toBe(true);
  });

  it("a GET-list controller has paginate hint", () => {
    const listCtrl = generated.find(
      (f) => f.includes("Controllers") && f.endsWith("Controller.php") &&
             fs.readFileSync(f, "utf8").includes("paginate"),
    );
    expect(listCtrl).toBeTruthy();
  });

  it("controllers have try/catch error handling", () => {
    const ctrl = generated.find(
      (f) => f.includes("Controllers") && f.endsWith("Controller.php"),
    )!;
    const content = fs.readFileSync(ctrl, "utf8");
    expect(content).toContain("try {");
    expect(content).toContain("catch (");
  });

  it("all generated PHP files pass php -l", () => {
    phpLint(generated);
  });
});

// ─── Fixture: Laravel Blog → Symfony ─────────────────────────────────────────

describe("Golden: laravel-blog fixture → Symfony scaffold", () => {
  const fixture = path.join(FIXTURES, "laravel-blog");
  let outDir: string;
  let openApiPath: string;
  let generated: string[];

  beforeAll(() => {
    outDir = tmpDir();
    openApiPath = path.join(outDir, "openapi.yaml");

    runExtraction(
      { from: "laravel", sourcePath: fixture, outPath: openApiPath, dryRun: false },
      false,
    );

    const contract = parseOpenApiToContract(openApiPath);
    generated = generateSymfonyFromContract(contract, outDir);
  });

  afterAll(() => fs.rmSync(outDir, { recursive: true, force: true }));

  it("extracts routes from api.php (Route::apiResource + explicit)", () => {
    const contract = parseOpenApiToContract(openApiPath);
    expect(contract.endpoints.length).toBeGreaterThanOrEqual(5);
    const paths = contract.endpoints.map((e) => e.path);
    expect(paths.some((p) => p.startsWith("/posts"))).toBe(true);
    expect(paths.some((p) => p.startsWith("/comments"))).toBe(true);
  });

  it("generates at least one controller", () => {
    expect(generated.some((f) => f.includes("Controller") && f.endsWith("Controller.php"))).toBe(true);
  });

  it("a controller has try/catch", () => {
    const ctrl = generated.find(
      (f) => f.includes("Controller") && f.endsWith("Controller.php"),
    )!;
    expect(fs.readFileSync(ctrl, "utf8")).toContain("try {");
  });

  it("all generated PHP files pass php -l", () => {
    phpLint(generated);
  });
});

// ─── IR shape tests ───────────────────────────────────────────────────────────

describe("IR schema — contractToIR", () => {
  const fixture = path.join(FIXTURES, "symfony-blog");
  let outDir: string;
  let openApiPath: string;

  beforeAll(() => {
    outDir = tmpDir();
    openApiPath = path.join(outDir, "openapi.yaml");
    runExtraction(
      { from: "symfony", sourcePath: fixture, outPath: openApiPath, dryRun: false },
      false,
    );
  });

  afterAll(() => fs.rmSync(outDir, { recursive: true, force: true }));

  it("IR has version 1", () => {
    const contract = parseOpenApiToContract(openApiPath);
    const ir = contractToIR(contract, "symfony");
    expect(ir.version).toBe(1);
  });

  it("IR has non-empty resources and routes", () => {
    const contract = parseOpenApiToContract(openApiPath);
    const ir = contractToIR(contract, "symfony");
    expect(ir.resources.length).toBeGreaterThan(0);
    expect(ir.routes.length).toBeGreaterThan(0);
  });

  it("IR infers events for CUD operations", () => {
    const contract = parseOpenApiToContract(openApiPath);
    const ir = contractToIR(contract, "symfony");
    expect(ir.events.some((e) => e.action === "created")).toBe(true);
    expect(ir.events.some((e) => e.action === "deleted")).toBe(true);
  });

  it("IR infers one command per resource", () => {
    const contract = parseOpenApiToContract(openApiPath);
    const ir = contractToIR(contract, "symfony");
    expect(ir.commands.length).toBeGreaterThan(0);
    expect(ir.commands[0].signature).toMatch(/:\w+/);
  });

  it("IR meta has extractedFrom and title", () => {
    const contract = parseOpenApiToContract(openApiPath);
    const ir = contractToIR(contract, "symfony");
    expect(ir.meta.extractedFrom).toBe("symfony");
    expect(ir.meta.title).toBeTruthy();
  });
});
