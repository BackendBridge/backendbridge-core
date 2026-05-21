import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "bb-utils-test-"));
}

// ─── config-converter ─────────────────────────────────────────────────────────

import { convertSecurityConfig } from "../src/config-converter.js";

describe("config-converter — Symfony → Laravel security", () => {
  let tmp: string;
  beforeEach(() => { tmp = tmpDir(); });
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it("converts security.yaml firewalls and providers to Laravel auth.php", () => {
    const input = path.join(tmp, "security.yaml");
    fs.writeFileSync(input, `
security:
  firewalls:
    main:
      provider: app_users
  providers:
    app_users:
      entity:
        class: App\\Entity\\User
`.trim(), "utf8");

    const out = path.join(tmp, "config", "auth.php");
    const result = convertSecurityConfig(input, out, "symfony");

    expect(result).toBe(out);
    expect(fs.existsSync(out)).toBe(true);
    const content = fs.readFileSync(out, "utf8");
    expect(content).toContain("<?php");
    expect(content).toContain("'guards'");
    expect(content).toContain("'providers'");
    expect(content).toContain("eloquent");
  });

  it("throws if input file does not exist", () => {
    expect(() =>
      convertSecurityConfig(path.join(tmp, "nope.yaml"), path.join(tmp, "out.php"), "symfony")
    ).toThrow("Input not found");
  });

  it("throws for unsupported direction laravel→symfony", () => {
    const input = path.join(tmp, "auth.php");
    fs.writeFileSync(input, "<?php return [];", "utf8");
    expect(() =>
      convertSecurityConfig(input, path.join(tmp, "out.yaml"), "laravel")
    ).toThrow();
  });
});

// ─── env-converter ────────────────────────────────────────────────────────────

import { convertEnvFile } from "../src/env-converter.js";

describe("env-converter — Laravel ↔ Symfony .env", () => {
  let tmp: string;
  beforeEach(() => { tmp = tmpDir(); });
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it("converts Laravel .env to Symfony DATABASE_URL", () => {
    const src = path.join(tmp, "src");
    fs.mkdirSync(src);
    fs.writeFileSync(path.join(src, ".env"), [
      "APP_NAME=TestApp",
      "DB_CONNECTION=mysql",
      "DB_HOST=127.0.0.1",
      "DB_PORT=3306",
      "DB_DATABASE=mydb",
      "DB_USERNAME=root",
      "DB_PASSWORD=secret",
    ].join("\n"), "utf8");

    const out = path.join(tmp, "out");
    fs.mkdirSync(out);
    const result = convertEnvFile({ from: "laravel", to: "symfony", sourcePath: src, outPath: out });

    expect(result).toBeTruthy();
    const content = fs.readFileSync(result!, "utf8");
    expect(content).toContain("DATABASE_URL");
    expect(content).toContain("mysql://");
    expect(content).toContain("mydb");
  });

  it("converts Symfony .env to Laravel DB_ variables", () => {
    const src = path.join(tmp, "src");
    fs.mkdirSync(src);
    fs.writeFileSync(path.join(src, ".env"), [
      "APP_ENV=prod",
      "DATABASE_URL=mysql://root:secret@127.0.0.1:3306/mydb",
    ].join("\n"), "utf8");

    const out = path.join(tmp, "out");
    fs.mkdirSync(out);
    const result = convertEnvFile({ from: "symfony", to: "laravel", sourcePath: src, outPath: out });

    expect(result).toBeTruthy();
    const content = fs.readFileSync(result!, "utf8");
    expect(content).toContain("DB_CONNECTION=mysql");
    expect(content).toContain("DB_HOST=127.0.0.1");
    expect(content).toContain("DB_DATABASE=mydb");
  });

  it("returns undefined when no .env file exists in source", () => {
    const src = path.join(tmp, "empty-src");
    fs.mkdirSync(src);
    const out = path.join(tmp, "out");
    fs.mkdirSync(out);
    const result = convertEnvFile({ from: "laravel", to: "symfony", sourcePath: src, outPath: out });
    expect(result).toBeUndefined();
  });
});

// ─── phpunit-generator ────────────────────────────────────────────────────────

import { generatePhpUnitSkeleton } from "../src/phpunit-generator.js";

describe("phpunit-generator", () => {
  let tmp: string;
  beforeEach(() => { tmp = tmpDir(); });
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it("generates phpunit.xml.dist and a test file", () => {
    const files = generatePhpUnitSkeleton(tmp);
    expect(files.length).toBeGreaterThan(0);
    const xmlFile = files.find((f) => f.endsWith(".xml") || f.endsWith(".xml.dist"));
    expect(xmlFile).toBeTruthy();
    const testFile = files.find((f) => f.endsWith("Test.php"));
    expect(testFile).toBeTruthy();
  });

  it("generated phpunit.xml.dist contains <phpunit> root element", () => {
    const files = generatePhpUnitSkeleton(tmp);
    const xml = files.find((f) => f.endsWith(".xml") || f.endsWith(".xml.dist"))!;
    const content = fs.readFileSync(xml, "utf8");
    expect(content).toContain("<phpunit");
  });

  it("generated test file contains TestCase", () => {
    const files = generatePhpUnitSkeleton(tmp);
    const test = files.find((f) => f.endsWith("Test.php"))!;
    const content = fs.readFileSync(test, "utf8");
    expect(content).toContain("TestCase");
  });
});

// ─── schema-extractor ─────────────────────────────────────────────────────────

import { extractLaravelFormRequests, extractSymfonyDtoSchemas } from "../src/schema-extractor.js";

describe("schema-extractor — Laravel FormRequests", () => {
  let tmp: string;
  beforeEach(() => { tmp = tmpDir(); });
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it("extracts validation rules from a Laravel FormRequest file", () => {
    const requestDir = path.join(tmp, "app", "Http", "Requests");
    fs.mkdirSync(requestDir, { recursive: true });
    fs.writeFileSync(path.join(requestDir, "StorePostRequest.php"), `<?php
namespace App\\Http\\Requests;
use Illuminate\\Foundation\\Http\\FormRequest;
class StorePostRequest extends FormRequest {
    public function rules(): array {
        return [
            'title' => 'required|string|min:3|max:255',
            'email' => 'required|email',
            'age'   => 'nullable|integer|min:18',
        ];
    }
}
`, "utf8");

    const result = extractLaravelFormRequests(tmp);
    expect(result.length).toBeGreaterThan(0);
    const schema = result[0].schema;
    expect(schema.properties).toHaveProperty("title");
    expect(schema.properties["title"].type).toBe("string");
    expect(schema.required).toContain("title");
    expect(schema.required).toContain("email");
    expect(schema.properties["age"]?.nullable).toBe(true);
  });
});

describe("schema-extractor — Symfony DTOs", () => {
  let tmp: string;
  beforeEach(() => { tmp = tmpDir(); });
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it("extracts Assert constraints from a Symfony DTO file", () => {
    const dtoDir = path.join(tmp, "src", "Dto");
    fs.mkdirSync(dtoDir, { recursive: true });
    fs.writeFileSync(path.join(dtoDir, "CreatePostDto.php"), `<?php
namespace App\\Dto;
use Symfony\\Component\\Validator\\Constraints as Assert;
class CreatePostDto {
    #[Assert\\NotBlank]
    #[Assert\\Length(min: 3, max: 255)]
    public ?string $title = null;

    #[Assert\\Email]
    public ?string $email = null;

    #[Assert\\Range(min: 1)]
    public ?int $age = null;
}
`, "utf8");

    const result = extractSymfonyDtoSchemas(tmp);
    expect(result.length).toBeGreaterThan(0);
    const schema = result[0].schema;
    expect(schema.properties).toHaveProperty("title");
    expect(schema.required).toContain("title");
    expect(schema.properties["email"]?.format).toBe("email");
  });
});
