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
import { generateLaravelSeedersAndFactories, generateSymfonyFixtures } from "./seeder-factory-generator.js";
import { generateLaravelMiddleware, generateSymfonyMiddleware } from "./middleware-generator.js";
import { generateLaravelMailer, generateSymfonyMailer } from "./mailer-generator.js";
import { generateLaravelJobsEventsNotifications, generateSymfonyJobsEventsNotifications } from "./job-event-notification-generator.js";
import { generateLaravelPolicy, generateSymfonyVoter } from "./generators/auth.js";
import { toStudly } from "./utils.js";
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

  // Seeders + Factories / Fixtures
  if (options.withSeeders) {
    try {
      const seederFiles = to === "laravel"
        ? generateLaravelSeedersAndFactories(contract, options.outPath)
        : generateSymfonyFixtures(contract, options.outPath);
      generatedFiles.push(...seederFiles);
    } catch (e) {
      warnings.push(`[seeders] ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // Middleware
  if (options.withMiddleware) {
    try {
      const mwFiles = to === "laravel"
        ? generateLaravelMiddleware(options.outPath)
        : generateSymfonyMiddleware(options.outPath);
      generatedFiles.push(...mwFiles);
    } catch (e) {
      warnings.push(`[middleware] ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // Mailer
  if (options.withMailer) {
    try {
      const mailerFiles = to === "laravel"
        ? generateLaravelMailer(options.outPath)
        : generateSymfonyMailer(options.outPath);
      generatedFiles.push(...mailerFiles);
    } catch (e) {
      warnings.push(`[mailer] ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // Jobs + Events + Notifications
  if (options.withJobs) {
    try {
      const jobFiles = to === "laravel"
        ? generateLaravelJobsEventsNotifications(contract, options.outPath)
        : generateSymfonyJobsEventsNotifications(contract, options.outPath);
      generatedFiles.push(...jobFiles);
    } catch (e) {
      warnings.push(`[jobs] ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // Auth: Policies (Laravel) or Voters (Symfony) from mapping auth rules
  if (options.withAuth && mapping) {
    try {
      const resourcesSeen = new Set<string>();
      for (const ep of contract.endpoints) {
        const resource = ep.tags?.[0] ? toStudly(ep.tags[0]) : toStudly(ep.operationId);
        if (!resource || resourcesSeen.has(resource)) continue;
        resourcesSeen.add(resource);
        // Collect auth rules from matching mapping entries
        const authRules: string[] = [];
        for (const [key, rule] of Object.entries(mapping.rules)) {
          if (rule.auth?.length && key.toLowerCase().includes(resource.toLowerCase())) {
            authRules.push(...(rule.auth as string[]));
          }
        }
        if (authRules.length === 0) authRules.push("auth");
        const authFile = to === "laravel"
          ? generateLaravelPolicy(options.outPath, resource, authRules)
          : generateSymfonyVoter(options.outPath, resource, authRules);
        generatedFiles.push(authFile);
      }
    } catch (e) {
      warnings.push(`[auth] ${e instanceof Error ? e.message : String(e)}`);
    }
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
