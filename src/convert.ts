import fs from "node:fs";
import path from "node:path";
import { appendActionLog } from "./action-log.js";
import { defaultCommitMessage, commitGeneratedFiles } from "./commit.js";
import { runExtraction } from "./extract.js";
import { resolveFramework } from "./framework.js";
import { generateLaravelFromContract } from "./generators/laravel.js";
import { generateSymfonyFromContract } from "./generators/symfony.js";
import { loadMappingFile } from "./mapping.js";
import { convertEnvFile } from "./env-converter.js";
import { convertEntitiesToModels } from "./entity-model-converter.js";
import { generateLaravelMigrationFromClasses, generateSqlFromClasses } from "./migration-generator.js";
import { generatePhpUnitSkeleton } from "./phpunit-generator.js";
import { parseOpenApiToContract } from "./openapi.js";
import { generateDockerFiles } from "./docker-generator.js";
import type { ConvertOptions, SupportedFramework } from "./types.js";

function ensureDir(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true });
}

export interface ConvertResult {
  from: SupportedFramework;
  to: SupportedFramework;
  generatedFiles: string[];
  committed: boolean;
  commitMessage?: string;
  warnings: string[];
  dockerized: boolean;
}

export function runConversion(
  options: ConvertOptions,
  shouldCommit: boolean,
  commitMessage?: string,
): ConvertResult {
  const from = resolveFramework(options.from, options.sourcePath);
  const to = options.to;

  if (from === to) {
    throw new Error("La conversion source -> cible doit changer de framework.");
  }

  if (!fs.existsSync(options.openApiPath)) {
    if (!options.extractIfMissing) {
      throw new Error("Fichier OpenAPI introuvable. Fournis --openapi avec un fichier .yaml, .yml ou .json.");
    }

    const extractOutPath = options.extractOutPath ?? options.openApiPath;
    runExtraction(
      {
        from,
        sourcePath: options.sourcePath,
        outPath: extractOutPath,
        dryRun: options.dryRun,
      },
      false,
    );
  }

  ensureDir(options.outPath);

  const contract = parseOpenApiToContract(options.openApiPath);
  const mapping = options.mappingPath ? loadMappingFile(options.mappingPath) : undefined;
  const generatedFiles =
    to === "laravel"
      ? generateLaravelFromContract(contract, options.outPath, mapping)
      : generateSymfonyFromContract(contract, options.outPath, mapping);

  const metadataPath = path.join(options.outPath, ".backendbridge.meta.json");
  const metadata = {
    generatedAt: new Date().toISOString(),
    contractTitle: contract.title,
    contractVersion: contract.version,
    from,
    to,
    targetVersion: options.targetVersion,
    generatedFiles,
  };
  fs.writeFileSync(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
  generatedFiles.push(metadataPath);

  const actionLogFile = appendActionLog(options.sourcePath, "convert", {
    from,
    to,
    openApiPath: options.openApiPath,
    outPath: options.outPath,
    mappingPath: options.mappingPath,
    generatedFiles: generatedFiles.length,
  });
  generatedFiles.push(actionLogFile);

  const warnings: string[] = [];

  // .env conversion
  try {
    const envOut = convertEnvFile({ from, to, sourcePath: options.sourcePath, outPath: options.outPath, outFileName: options.envOutName });
    if (envOut) generatedFiles.push(envOut);
  } catch (e) {
    warnings.push(`[env] ${e instanceof Error ? e.message : String(e)}`);
  }

  // Models / entities from PHP classes (requires `php`)
  try {
    const models = convertEntitiesToModels(options.sourcePath, options.outPath, to);
    generatedFiles.push(...models);
  } catch (e) {
    warnings.push(`[entities] ${e instanceof Error ? e.message : String(e)}`);
  }

  // Migrations
  try {
    const migrationsOut = to === "laravel"
      ? generateLaravelMigrationFromClasses(options.sourcePath, path.join(options.outPath, "database", "migrations"))
      : generateSqlFromClasses(options.sourcePath, path.join(options.outPath, "migrations"));
    generatedFiles.push(...migrationsOut);
  } catch (e) {
    warnings.push(`[migrations] ${e instanceof Error ? e.message : String(e)}`);
  }

  // PHPUnit skeleton
  if (options.withTests) {
    try {
      const phpunitFiles = generatePhpUnitSkeleton(options.outPath);
      generatedFiles.push(...phpunitFiles);
    } catch (e) {
      warnings.push(`[phpunit] ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // Docker files
  let dockerized = false;
  if (options.withDocker) {
    try {
      const dockerFiles = generateDockerFiles(to, options.outPath);
      generatedFiles.push(...dockerFiles.files);
      dockerized = true;
    } catch (e) {
      warnings.push(`[docker] ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (!options.dryRun && shouldCommit) {
    const message = commitMessage ?? defaultCommitMessage(from, to);
    commitGeneratedFiles(generatedFiles, message, options.sourcePath);
    return { from, to, generatedFiles, committed: true, commitMessage: message, warnings, dockerized };
  }

  return { from, to, generatedFiles, committed: false, warnings, dockerized };
}
