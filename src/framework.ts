import fs from "node:fs";
import path from "node:path";
import type { SupportedFramework } from "./types.js";

interface ComposerManifest {
  require?: Record<string, string>;
}

export function detectFramework(projectPath: string): SupportedFramework | null {
  const composerPath = path.join(projectPath, "composer.json");
  if (!fs.existsSync(composerPath)) {
    return null;
  }

  try {
    const composer = JSON.parse(fs.readFileSync(composerPath, "utf8")) as ComposerManifest;
    const dependencies = Object.keys(composer.require ?? {});

    if (dependencies.includes("laravel/framework")) {
      return "laravel";
    }

    if (dependencies.some((dep) => dep.startsWith("symfony/"))) {
      return "symfony";
    }
  } catch {
    return null;
  }

  return null;
}

export function resolveFramework(
  from: "auto" | SupportedFramework,
  sourcePath: string,
): SupportedFramework {
  if (from !== "auto") {
    return from;
  }

  const detected = detectFramework(sourcePath);
  if (!detected) {
    throw new Error(
      "Impossible de detecter automatiquement le framework source. Utilise --from symfony ou --from laravel.",
    );
  }

  return detected;
}
