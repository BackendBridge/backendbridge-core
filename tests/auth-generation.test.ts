import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { applyMapping } from "../src/mapping-applier.js";
import { writeFileSync } from "node:fs";

describe("auth generation", () => {
  it("generates laravel policy when auth rules exist", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bb-auth-"));
    const mapping = {
      framework: "laravel",
      rules: {
        "GET /admin#list": {
          auth: ["role:admin", "permission:manage_users"]
        }
      },
      generatedAt: new Date().toISOString(),
    };

    const mappingPath = path.join(tmp, "mapping.json");
    writeFileSync(mappingPath, JSON.stringify(mapping), "utf8");

    const res = applyMapping({ mappingPath, targetPath: tmp, framework: "laravel", dryRun: false }, false);
    const policy = res.generatedFiles.find((f) => f.includes("Policies") && f.endsWith("Policy.php"));
    expect(policy).toBeTruthy();
    if (policy) {
      const content = fs.readFileSync(policy, "utf8");
      const key = "GET /admin#list";
      const fileName = key.replace(/[^a-zA-Z0-9]+/g, "_").slice(0, 80);
      const expectedClass = `${fileName}Policy`;
      expect(content).toContain(`class ${expectedClass}`);
    }

    fs.rmSync(tmp, { recursive: true, force: true });
  });
});
