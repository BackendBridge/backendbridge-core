import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runExtraction } from "../src/extract.js";

describe("runExtraction", () => {
  it("extrait un OpenAPI depuis des routes Laravel", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "backendbridge-extract-laravel-"));
    const sourcePath = path.join(tmpDir, "source");
    const outPath = path.join(tmpDir, "openapi.yaml");

    fs.mkdirSync(path.join(sourcePath, "routes"), { recursive: true });
    fs.writeFileSync(
      path.join(sourcePath, "composer.json"),
      JSON.stringify({ require: { "laravel/framework": "^11.0" } }, null, 2),
      "utf8",
    );
    fs.writeFileSync(
      path.join(sourcePath, "routes", "api.php"),
      "<?php\nRoute::get('/users', [UserController::class, 'index']);\nRoute::post('/users', [UserController::class, 'store']);\n",
      "utf8",
    );

    const result = runExtraction(
      {
        from: "auto",
        sourcePath,
        outPath,
        dryRun: true,
      },
      false,
    );

    expect(result.from).toBe("laravel");
    expect(result.endpoints).toBe(2);
    expect(fs.existsSync(outPath)).toBe(true);

    const openApi = fs.readFileSync(outPath, "utf8");
    expect(openApi).toContain("/users");
  });

  it("extrait un OpenAPI depuis des attributs Symfony", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "backendbridge-extract-symfony-"));
    const sourcePath = path.join(tmpDir, "source");
    const outPath = path.join(tmpDir, "openapi.json");

    fs.mkdirSync(path.join(sourcePath, "src", "Controller"), { recursive: true });
    fs.writeFileSync(
      path.join(sourcePath, "composer.json"),
      JSON.stringify({ require: { "symfony/framework-bundle": "^7.0" } }, null, 2),
      "utf8",
    );
    fs.writeFileSync(
      path.join(sourcePath, "src", "Controller", "UserController.php"),
      "<?php\nnamespace App\\Controller;\nuse Symfony\\Component\\Routing\\Annotation\\Route;\nclass UserController {\n#[Route('/users', name: 'users_index', methods: ['GET'])]\npublic function index() {}\n}\n",
      "utf8",
    );

    const result = runExtraction(
      {
        from: "auto",
        sourcePath,
        outPath,
        dryRun: true,
      },
      false,
    );

    expect(result.from).toBe("symfony");
    expect(result.endpoints).toBe(1);
    expect(fs.existsSync(outPath)).toBe(true);

    const openApi = JSON.parse(fs.readFileSync(outPath, "utf8")) as { paths?: Record<string, unknown> };
    expect(openApi.paths?.["/users"]).toBeTruthy();
  });
});
