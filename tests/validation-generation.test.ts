import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { applyMapping } from "../src/mapping-applier.js";

import { writeFileSync } from "node:fs";

describe("validation generation", () => {
  it("generates Laravel FormRequest with rules", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bb-validate-"));
    const mapping = {
      framework: "laravel",
      rules: {
        "POST /users#createUser": {
          validation: [
            { field: "email", rules: ["required", "email"] },
            { field: "password", rules: ["required", "min:8"] },
          ],
        },
      },
      generatedAt: new Date().toISOString(),
    };

    const mappingPath = path.join(tmp, "mapping.json");
    writeFileSync(mappingPath, JSON.stringify(mapping), "utf8");

    const res = applyMapping({ mappingPath, targetPath: tmp, framework: "laravel", dryRun: false }, false);
    // find generated request file
    const found = res.generatedFiles.find((f) => f.endsWith("Request.php"));
    expect(found).toBeTruthy();
    if (found) {
      const content = fs.readFileSync(found, "utf8");
      expect(content).toContain('"email" => "required|email"');
      expect(content).toContain('"password" => "required|min:8"');
    }

    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
