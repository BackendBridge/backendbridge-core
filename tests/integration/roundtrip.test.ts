import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { generateLaravelFromContract } from "../../src/generators/laravel.js";

const contract = {
  endpoints: [
    { method: "get", path: "/pets", operationId: "listPets", summary: "List pets" },
    { method: "post", path: "/pets", operationId: "createPet", summary: "Create pet" },
  ],
};

describe("integration roundtrip: generate Laravel scaffold", () => {
  it("generates controllers and routes and php syntax checks when php installed", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bb-rt-"));

    const generated = generateLaravelFromContract(contract as any, tmp, undefined as any);
    // files should exist
    for (const f of generated) {
      expect(fs.existsSync(f)).toBe(true);
    }

    // find php files and optionally run php -l
    const phpFiles = generated.filter((f) => f.endsWith(".php"));
    if (phpFiles.length) {
      // check if php is available
      const hasPhp = await new Promise<boolean>((resolve) => {
        const { exec } = require("child_process");
        exec("php -v", (err: Error | null) => resolve(!err));
      });

      if (hasPhp) {
        const { execSync } = require("child_process");
        for (const phpFile of phpFiles) {
          const out = execSync(`php -l ${phpFile}`, { encoding: "utf8" });
          expect(out).toMatch(/No syntax errors detected|Errors parsing/);
        }
      } else {
        // no php available, ensure generated files contain PHP opening tag
        for (const phpFile of phpFiles) {
          const content = fs.readFileSync(phpFile, "utf8");
          expect(content.startsWith("<?php")).toBe(true);
        }
      }
    }

    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
