import fs from "node:fs";
import path from "node:path";
import { loadMappingFile } from "./mapping.js";
import { appendActionLog } from "./action-log.js";
import { commitGeneratedFiles } from "./commit.js";
import type { MappingDocument } from "./mapping.js";

export interface ApplyMappingOptions {
  mappingPath: string;
  targetPath: string; // project root where to apply stubs
  framework: "symfony" | "laravel" | "auto";
  dryRun: boolean;
}

export interface ApplyMappingResult {
  applied: number;
  generatedFiles: string[];
  committed: boolean;
  commitMessage?: string;
}

function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeStub(filePath: string, content: string) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, content, "utf8");
}

function makeLaravelRequestStub(dtoPath: string | undefined, rule: unknown) {
  const dtoNote = dtoPath ? `// DTO candidate: ${dtoPath}\n` : "";
  return `<?php

namespace App\\Http\\Requests;

use Illuminate\\Foundation\\Http\\FormRequest;

class GeneratedRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        // Validation hints:\n${JSON.stringify((rule as any)?.validation ?? [], null, 2)}
        return [
            // add rules here
        ];
    }
}
`;
}

function makeSymfonyRequestStub(dtoPath: string | undefined, rule: unknown) {
  const dtoNote = dtoPath ? `// DTO candidate: ${dtoPath}\n` : "";
  return `<?php

namespace App\\Request;

use Symfony\\Component\\Validator\\Constraints as Assert;

class GeneratedRequest
{
    // Validation hints:\n${JSON.stringify((rule as any)?.validation ?? [], null, 2)}

    // Add properties and constraints here
}
`;
}

export function applyMapping(
  options: ApplyMappingOptions,
  shouldCommit: boolean,
  commitMessage?: string,
): ApplyMappingResult {
  let mapping: MappingDocument;
  try {
    mapping = loadMappingFile(options.mappingPath) as MappingDocument;
  } catch (err) {
    // fallback: try raw JSON parse (useful for tests or lenient inputs)
    const raw = fs.readFileSync(options.mappingPath, "utf8");
    try {
      mapping = JSON.parse(raw) as unknown as MappingDocument;
    } catch (e) {
      throw err; // rethrow original validation error
    }
  }
  const generatedFiles: string[] = [];

  const framework = options.framework === "auto" ? mapping.framework ?? "mixed" : options.framework;

  for (const [key, rule] of Object.entries(mapping.rules)) {
    // key format: "METHOD /path#operationId" or operationId
    const fileName = key.replace(/[^a-zA-Z0-9]+/g, "_").slice(0, 80);
    if (framework === "laravel") {
      const target = path.join(options.targetPath, "app", "Http", "Requests", `${fileName}Request.php`);
      const content = makeLaravelRequestStub(rule.dto, rule);
      if (!options.dryRun) writeStub(target, content);
      generatedFiles.push(target);
      continue;
    }

    // symfony or mixed
    const target = path.join(options.targetPath, "src", "Request", `${fileName}Request.php`);
    const content = makeSymfonyRequestStub(rule.dto, rule);
    if (!options.dryRun) writeStub(target, content);
    generatedFiles.push(target);
  }

  let actionLog: string;
  if (options.dryRun) {
    actionLog = path.join(options.targetPath, ".backendbridge", "actions.log");
    // don't write in dry-run, but include path in generatedFiles for reporting
  } else {
    actionLog = appendActionLog(options.targetPath, "apply-mapping", {
      mapping: options.mappingPath,
      count: Object.keys(mapping.rules).length,
    });
  }
  generatedFiles.push(actionLog);

  if (!options.dryRun && shouldCommit) {
    commitGeneratedFiles(generatedFiles, commitMessage ?? "feat(mapping): apply business mapping stubs", options.targetPath);
    return {
      applied: Object.keys(mapping.rules).length,
      generatedFiles,
      committed: true,
      commitMessage: commitMessage ?? "feat(mapping): apply business mapping stubs",
    };
  }

  return {
    applied: Object.keys(mapping.rules).length,
    generatedFiles,
    committed: false,
  };
}
