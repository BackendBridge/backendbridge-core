import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { applyMapping } from "../src/mapping-applier.js";

// small helper to create a mapping file structure similar to mapping.load expected shape
import { writeFileSync } from "node:fs";

describe("mapping-applier", () => {
  it("should generate stubs for mapping rules (dry-run)", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bb-test-"));
    const mapping = {
      framework: "laravel",
      rules: {
        "GET /users#getUsers": { validation: [{ field: "name", rules: ["required"] }] },
        "POST /users#createUser": { validation: [{ field: "email", rules: ["required", "email"] }] },
      },
    };

    const mappingPath = path.join(tmp, "mapping.json");
    writeFileSync(mappingPath, JSON.stringify(mapping), "utf8");

    const res = applyMapping({ mappingPath, targetPath: tmp, framework: "laravel", dryRun: true }, false);

    expect(res.applied).toBe(2);
    expect(Array.isArray(res.generatedFiles)).toBeTruthy();

    // no files written in dry-run
    for (const f of res.generatedFiles) {
      expect(fs.existsSync(f)).toBe(false);
    }

    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
