import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runRelease } from "../src/release.js";

describe("runRelease", () => {
  it("prepare une release en dry-run", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "backendbridge-release-"));
    const changelogPath = path.join(tmpDir, "CHANGELOG.md");

    fs.writeFileSync(
      path.join(tmpDir, "package.json"),
      JSON.stringify({ name: "demo", version: "1.2.3" }, null, 2),
      "utf8",
    );

    const result = runRelease({
      projectPath: tmpDir,
      bump: "minor",
      changelogPath,
      publish: false,
      dryRun: true,
    });

    expect(result.previousVersion).toBe("1.2.3");
    expect(result.nextVersion).toBe("1.3.0");
    expect(result.committed).toBe(false);
    expect(result.published).toBe(false);
    expect(fs.existsSync(changelogPath)).toBe(true);
  });
});
