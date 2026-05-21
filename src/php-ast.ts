import { execFileSync } from "node:child_process";
import fs from "node:fs";

export function phpAvailable(): boolean {
  try {
    execFileSync("php", ["-v"], { stdio: "ignore" });
    return true;
  } catch (err) {
    return false;
  }
}

export function parsePhpFileForApiPlatform(filePath: string): Array<{ method: string; path: string; operationId: string }> {
  if (!phpAvailable()) {
    throw new Error("php not available");
  }

  const scriptPath = new URL("../tools/parse_api_platform.php", import.meta.url).pathname;
  const out = execFileSync("php", [scriptPath, filePath], { encoding: "utf8" });
  try {
    const parsed = JSON.parse(out);
    if (parsed && parsed.error) {
      throw new Error(`PHP AST script error: ${parsed.message || parsed.error}`);
    }
    return parsed;
  } catch (err) {
    throw new Error("Failed to parse PHP AST output");
  }
}
