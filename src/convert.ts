import fs from "node:fs";
import path from "node:path";
import { defaultCommitMessage, commitGeneratedFiles } from "./commit.js";
import { resolveFramework } from "./framework.js";
import { generateLaravelFromContract } from "./generators/laravel.js";
import { generateSymfonyFromContract } from "./generators/symfony.js";
import { parseOpenApiToContract } from "./openapi.js";
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
    throw new Error("Fichier OpenAPI introuvable. Fournis --openapi avec un fichier .yaml, .yml ou .json.");
  }

  ensureDir(options.outPath);

  const contract = parseOpenApiToContract(options.openApiPath);
  const generatedFiles =
    to === "laravel"
      ? generateLaravelFromContract(contract, options.outPath)
      : generateSymfonyFromContract(contract, options.outPath);

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

  if (!options.dryRun && shouldCommit) {
    const message = commitMessage ?? defaultCommitMessage(from, to);
    commitGeneratedFiles(generatedFiles, message, options.sourcePath);
    return {
      from,
      to,
      generatedFiles,
      committed: true,
      commitMessage: message,
    };
  }

  return {
    from,
    to,
    generatedFiles,
    committed: false,
  };
}
