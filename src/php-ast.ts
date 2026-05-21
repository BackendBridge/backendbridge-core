import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseApiPlatform as parseApiPlatformPhp, parseControllers as parseControllersPhp } from "./php-scripts.generated.js";

export function phpAvailable(): boolean {
  try {
    execFileSync("php", ["-v"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function resolvePhpScript(name: string, embedded: string): string {
  try {
    const candidate = new URL(`../tools/${name}`, import.meta.url).pathname;
    if (candidate && fs.existsSync(candidate)) return candidate;
  } catch {
    // import.meta.url empty in CJS/SEA — fall through to embedded copy
  }
  const tmp = path.join(os.tmpdir(), `bb-${name}`);
  fs.writeFileSync(tmp, embedded, "utf8");
  return tmp;
}

export interface AstEndpoint {
  method: string;
  path: string;
  operationId: string;
  tags?: string[];
  pathParams?: string[];
}

export function parseControllersWithAst(
  framework: "symfony" | "laravel",
  targetPath: string,
): AstEndpoint[] {
  if (!phpAvailable()) return [];
  const scriptPath = resolvePhpScript("parse_controllers.php", parseControllersPhp);
  try {
    const out = execFileSync("php", [scriptPath, framework, targetPath], {
      encoding: "utf8",
      timeout: 30_000,
    });
    const parsed = JSON.parse(out);
    if (parsed && parsed.error) return [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function parsePhpFileForApiPlatform(filePath: string): Array<{ method: string; path: string; operationId: string }> {
  if (!phpAvailable()) {
    throw new Error("php not available");
  }

  const scriptPath = resolvePhpScript("parse_api_platform.php", parseApiPlatformPhp);
  const out = execFileSync("php", [scriptPath, filePath], { encoding: "utf8" });
  try {
    const parsed = JSON.parse(out);
    if (parsed && parsed.error) {
      throw new Error(`PHP AST script error: ${parsed.message || parsed.error}`);
    }
    return parsed;
  } catch {
    throw new Error("Failed to parse PHP AST output");
  }
}
