import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { appendActionLog } from "./action-log.js";
import { commitGeneratedFiles } from "./commit.js";
import { resolveFramework } from "./framework.js";
import { parseOpenApiToContract } from "./openapi.js";
import { runExtraction } from "./extract.js";
import type { ApiContract, SupportedFramework } from "./types.js";

const ValidationItem = z.union([
  z.string(),
  z.object({ field: z.string(), rules: z.array(z.string()).default([]) }),
]);

const AuthItem = z.union([
  z.string(),
  z.object({ role: z.string(), condition: z.string().optional() }),
]);

const MappingRuleSchema = z.object({
  dto: z.string().optional(),
  validation: z.array(ValidationItem).default([]),
  auth: z.array(AuthItem).default([]),
  notes: z.string().optional(),
});

export const MappingSchema = z.object({
  version: z.number().default(1),
  framework: z.enum(["symfony", "laravel", "mixed"]).default("mixed"),
  generatedAt: z.string(),
  rules: z.record(z.string(), MappingRuleSchema),
});

export type MappingDocument = z.infer<typeof MappingSchema>;

function discoverDtoCandidates(sourcePath: string, from: SupportedFramework): string[] {
  const candidates: string[] = [];
  const folders =
    from === "laravel"
      ? ["app/DTO", "app/Data", "app/Http/Requests"]
      : ["src/Dto", "src/DTO", "src/Request", "src/Form"];

  for (const folder of folders) {
    const fullPath = path.join(sourcePath, folder);
    if (!fs.existsSync(fullPath)) {
      continue;
    }

    const stack = [fullPath];
    while (stack.length) {
      const current = stack.pop();
      if (!current) {
        continue;
      }

      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        const entryPath = path.join(current, entry.name);
        if (entry.isDirectory()) {
          stack.push(entryPath);
          continue;
        }

        if (entry.name.endsWith(".php")) {
          candidates.push(entryPath);
        }
      }
    }
  }

  return candidates;
}

function findBestDto(endpointPath: string, dtoCandidates: string[]): string | undefined {
  const slug = endpointPath.replace(/[^a-zA-Z0-9]+/g, " ").trim();
  if (!slug) {
    return undefined;
  }

  const words = slug
    .split(/\s+/)
    .map((w) => w.toLowerCase())
    .filter(Boolean);

  for (const candidate of dtoCandidates) {
    const fileName = path.basename(candidate).toLowerCase();
    if (words.some((word) => fileName.includes(word))) {
      return candidate;
    }
  }

  return dtoCandidates[0];
}

function detectValidationHints(from: SupportedFramework): string[] {
  return from === "laravel"
    ? ["FormRequest", "Validator", "rules()"]
    : ["Symfony Validator", "Constraint", "validation.yaml"];
}

function detectAuthHints(from: SupportedFramework): string[] {
  return from === "laravel"
    ? ["auth:sanctum", "policies", "gates"]
    : ["security.yaml", "voter", "is_granted"];
}

export function loadMappingFile(mappingPath: string): MappingDocument {
  const raw = JSON.parse(fs.readFileSync(mappingPath, "utf8")) as unknown;
  const parsed = MappingSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(`Mapping metier invalide: ${parsed.error.message}`);
  }
  return parsed.data;
}

export function mappingKey(method: string, endpointPath: string, operationId: string): string {
  return `${method.toUpperCase()} ${endpointPath}#${operationId}`;
}

export function resolveRule(
  mapping: MappingDocument | undefined,
  method: string,
  endpointPath: string,
  operationId: string,
): z.infer<typeof MappingRuleSchema> | undefined {
  if (!mapping) {
    return undefined;
  }

  const byMethodPathOp = mapping.rules[mappingKey(method, endpointPath, operationId)];
  if (byMethodPathOp) {
    return byMethodPathOp;
  }

  const byOperationId = mapping.rules[operationId];
  if (byOperationId) {
    return byOperationId;
  }

  return undefined;
}

export function buildMappingFromContract(
  contract: ApiContract,
  from: SupportedFramework,
  sourcePath: string,
): MappingDocument {
  const dtoCandidates = discoverDtoCandidates(sourcePath, from);
  const rules: MappingDocument["rules"] = {};

  for (const endpoint of contract.endpoints) {
    const dto = findBestDto(endpoint.path, dtoCandidates);
    rules[mappingKey(endpoint.method, endpoint.path, endpoint.operationId)] = {
      dto,
      validation: detectValidationHints(from),
      auth: detectAuthHints(from),
      notes: "Ajuster ce mapping pour une conversion metier plus precise.",
    };
  }

  return {
    version: 1,
    framework: from,
    generatedAt: new Date().toISOString(),
    rules,
  };
}

export interface ExportMappingOptions {
  from: "auto" | SupportedFramework;
  sourcePath: string;
  openApiPath: string;
  outPath: string;
  dryRun: boolean;
}

export interface ExportMappingResult {
  from: SupportedFramework;
  outPath: string;
  rules: number;
  generatedFiles: string[];
  committed: boolean;
  commitMessage?: string;
}

export interface ImportMappingResult {
  targetPath: string;
  generatedFiles: string[];
  committed: boolean;
  commitMessage?: string;
}

export function runMappingExport(
  options: ExportMappingOptions,
  shouldCommit: boolean,
  commitMessage?: string,
): ExportMappingResult {
  const from = resolveFramework(options.from, options.sourcePath);

  if (!fs.existsSync(options.openApiPath)) {
    runExtraction(
      {
        from,
        sourcePath: options.sourcePath,
        outPath: options.openApiPath,
        dryRun: options.dryRun,
      },
      false,
    );
  }

  const contract = parseOpenApiToContract(options.openApiPath);
  const mapping = buildMappingFromContract(contract, from, options.sourcePath);

  fs.mkdirSync(path.dirname(options.outPath), { recursive: true });
  fs.writeFileSync(options.outPath, `${JSON.stringify(mapping, null, 2)}\n`, "utf8");

  const generatedFiles = [options.outPath];
  const actionLogFile = appendActionLog(options.sourcePath, "mapping-export", {
    from,
    openApiPath: options.openApiPath,
    outPath: options.outPath,
    rules: Object.keys(mapping.rules).length,
  });
  generatedFiles.push(actionLogFile);

  if (!options.dryRun && shouldCommit) {
    const message = commitMessage ?? `feat(bridge): export mapping from ${from} api`;
    commitGeneratedFiles(generatedFiles, message, options.sourcePath);
    return {
      from,
      outPath: options.outPath,
      rules: Object.keys(mapping.rules).length,
      generatedFiles,
      committed: true,
      commitMessage: message,
    };
  }

  return {
    from,
    outPath: options.outPath,
    rules: Object.keys(mapping.rules).length,
    generatedFiles,
    committed: false,
  };
}

export function runMappingImport(
  sourcePath: string,
  mappingPath: string,
  targetPath: string,
  dryRun: boolean,
  shouldCommit: boolean,
  commitMessage?: string,
): ImportMappingResult {
  const mapping = loadMappingFile(mappingPath);

  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  fs.writeFileSync(targetPath, `${JSON.stringify(mapping, null, 2)}\n`, "utf8");

  const generatedFiles = [targetPath];
  const actionLogFile = appendActionLog(sourcePath, "mapping-import", {
    mappingPath,
    targetPath,
    rules: Object.keys(mapping.rules).length,
  });
  generatedFiles.push(actionLogFile);

  if (!dryRun && shouldCommit) {
    const message = commitMessage ?? "feat(bridge): import business mapping file";
    commitGeneratedFiles(generatedFiles, message, sourcePath);
    return {
      targetPath,
      generatedFiles,
      committed: true,
      commitMessage: message,
    };
  }

  return {
    targetPath,
    generatedFiles,
    committed: false,
  };
}
