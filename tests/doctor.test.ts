import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runDoctor } from "../src/doctor.js";

describe("runDoctor", () => {
  it("audite un projet Symfony ApiPlatform", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "backendbridge-doctor-"));
    const sourcePath = path.join(tmpDir, "source");
    const reportPath = path.join(tmpDir, "doctor.json");

    fs.mkdirSync(path.join(sourcePath, "src", "Entity"), { recursive: true });
    fs.writeFileSync(
      path.join(sourcePath, "composer.json"),
      JSON.stringify(
        {
          require: {
            "symfony/framework-bundle": "^7.0",
            "api-platform/core": "^4.0",
          },
        },
        null,
        2,
      ),
      "utf8",
    );
    fs.writeFileSync(
      path.join(sourcePath, "src", "Entity", "Book.php"),
      "<?php\nuse ApiPlatform\\Metadata\\ApiResource;\n#[ApiResource]\nclass Book {}\n",
      "utf8",
    );

    const result = runDoctor(sourcePath, "auto", reportPath, true, false);
    expect(result.framework).toBe("symfony");
    expect(result.apiPlatformDetected).toBe(true);
    expect(result.reportPath).toBe(reportPath);
    expect(fs.existsSync(reportPath)).toBe(true);
  });
});
