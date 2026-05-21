import fs from "node:fs";
import path from "node:path";
import { appendActionLog } from "./action-log.js";
import { commitGeneratedFiles } from "./commit.js";
import { detectFramework, resolveFramework } from "./framework.js";
import type { SupportedFramework } from "./types.js";

export interface DoctorIssue {
  level: "info" | "warning" | "error";
  code: string;
  message: string;
}

export interface DoctorResult {
  framework: SupportedFramework;
  apiPlatformDetected: boolean;
  routesDetected: number;
  issues: DoctorIssue[];
  reportPath?: string;
  committed: boolean;
  commitMessage?: string;
}

function countMatches(input: string, regex: RegExp): number {
  const matches = input.match(regex);
  return matches ? matches.length : 0;
}

function readIfExists(filePath: string): string {
  if (!fs.existsSync(filePath)) {
    return "";
  }
  return fs.readFileSync(filePath, "utf8");
}

function scanPhpFiles(basePath: string): string[] {
  if (!fs.existsSync(basePath)) {
    return [];
  }

  const files: string[] = [];
  const stack = [basePath];

  while (stack.length) {
    const current = stack.pop();
    if (!current) {
      continue;
    }

    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const fullPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
        continue;
      }
      if (entry.name.endsWith(".php")) {
        files.push(fullPath);
      }
    }
  }

  return files;
}

export function runDoctor(
  sourcePath: string,
  from: "auto" | SupportedFramework,
  reportPath?: string,
  dryRun = false,
  shouldCommit = false,
  commitMessage?: string,
): DoctorResult {
  const framework = resolveFramework(from, sourcePath);
  const issues: DoctorIssue[] = [];
  const composerPath = path.join(sourcePath, "composer.json");
  const composerRaw = readIfExists(composerPath);

  if (!composerRaw) {
    throw new Error("composer.json introuvable: impossible d'auditer le projet source.");
  }

  const composer = JSON.parse(composerRaw) as {
    require?: Record<string, string>;
  };

  const dependencies = Object.keys(composer.require ?? {});
  const apiPlatformDetected = dependencies.includes("api-platform/core");

  if (apiPlatformDetected) {
    issues.push({
      level: "info",
      code: "APIP-001",
      message: "ApiPlatform detecte: extraction des operations metadata activee.",
    });
  } else {
    issues.push({
      level: "warning",
      code: "APIP-002",
      message: "ApiPlatform non detecte: mode extraction routes/controllers classique.",
    });
  }

  let routesDetected = 0;

  if (framework === "laravel") {
    const routeFiles = [path.join(sourcePath, "routes", "api.php"), path.join(sourcePath, "routes", "web.php")];
    for (const routeFile of routeFiles) {
      const raw = readIfExists(routeFile);
      routesDetected += countMatches(raw, /Route::(get|post|put|patch|delete|head|options)\(/g);
    }

    if (!readIfExists(path.join(sourcePath, "routes", "api.php"))) {
      issues.push({
        level: "error",
        code: "LAR-ROUTE-404",
        message: "routes/api.php introuvable.",
      });
    }
  }

  if (framework === "symfony") {
    const phpFiles = scanPhpFiles(path.join(sourcePath, "src"));
    for (const phpFile of phpFiles) {
      const raw = readIfExists(phpFile);
      routesDetected += countMatches(raw, /#\[Route\(/g) + countMatches(raw, /@Route\(/g);
      if (apiPlatformDetected) {
        routesDetected += countMatches(raw, /#\[ApiResource\(/g);
        routesDetected += countMatches(raw, /#\[(Get|Post|Put|Patch|Delete)\(/g);
      }
    }
  }

  if (!routesDetected) {
    issues.push({
      level: "error",
      code: "REST-000",
      message: "Aucune route REST detectee.",
    });
  } else if (routesDetected < 5) {
    issues.push({
      level: "warning",
      code: "REST-LOW",
      message: `Seulement ${routesDetected} routes detectees. Verifier la couverture fonctionnelle.`,
    });
  } else {
    issues.push({
      level: "info",
      code: "REST-OK",
      message: `${routesDetected} routes/operations detectees.`,
    });
  }

  if (detectFramework(sourcePath) !== framework) {
    issues.push({
      level: "warning",
      code: "FW-MISMATCH",
      message: "Le framework detecte differe de l'option --from fournie.",
    });
  }

  const result: DoctorResult = {
    framework,
    apiPlatformDetected,
    routesDetected,
    issues,
    committed: false,
  };

  if (!reportPath) {
    return result;
  }

  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");

  const generatedFiles = [reportPath];
  const actionLog = appendActionLog(sourcePath, "doctor", {
    framework,
    apiPlatformDetected,
    routesDetected,
    reportPath,
  });
  generatedFiles.push(actionLog);

  if (!dryRun && shouldCommit) {
    const message = commitMessage ?? "chore(doctor): audit source api compatibility";
    commitGeneratedFiles(generatedFiles, message, sourcePath);
    result.committed = true;
    result.commitMessage = message;
  }

  result.reportPath = reportPath;
  return result;
}
