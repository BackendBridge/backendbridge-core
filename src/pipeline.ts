import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { z } from "zod";
import { runConversion } from "./convert.js";
import { runExtraction } from "./extract.js";
import type { SupportedFramework } from "./types.js";

const ExtractActionSchema = z.object({
  type: z.literal("extract"),
  from: z.enum(["auto", "symfony", "laravel"]).default("auto"),
  source: z.string(),
  out: z.string(),
  title: z.string().optional(),
  version: z.string().optional(),
  commit: z.string().optional(),
});

const ConvertActionSchema = z.object({
  type: z.literal("convert"),
  from: z.enum(["auto", "symfony", "laravel"]).default("auto"),
  to: z.enum(["symfony", "laravel"]),
  source: z.string(),
  out: z.string(),
  openapi: z.string(),
  mapping: z.string().optional(),
  targetVersion: z.string().optional(),
  extractIfMissing: z.boolean().optional(),
  extractOut: z.string().optional(),
  commit: z.string().optional(),
});

const PipelineSchema = z.object({
  version: z.number().default(1),
  actions: z.array(z.union([ExtractActionSchema, ConvertActionSchema])).min(1),
});

interface RunPipelineResult {
  actions: number;
  summaries: string[];
}

function readPlan(planPath: string): unknown {
  const content = fs.readFileSync(planPath, "utf8");
  const ext = path.extname(planPath).toLowerCase();
  if (ext === ".yaml" || ext === ".yml") {
    return yaml.load(content);
  }
  return JSON.parse(content);
}

function resolveFromPlan(baseDir: string, maybeRelative: string): string {
  if (path.isAbsolute(maybeRelative)) {
    return maybeRelative;
  }
  return path.resolve(baseDir, maybeRelative);
}

export function runPipeline(
  planPath: string,
  shouldCommit: boolean,
  dryRun: boolean,
): RunPipelineResult {
  const absolutePlanPath = path.resolve(planPath);
  const planDir = path.dirname(absolutePlanPath);
  const parsed = PipelineSchema.safeParse(readPlan(absolutePlanPath));

  if (!parsed.success) {
    throw new Error(`Pipeline invalide: ${parsed.error.message}`);
  }

  const summaries: string[] = [];

  for (const action of parsed.data.actions) {
    if (action.type === "extract") {
      const result = runExtraction(
        {
          from: action.from,
          sourcePath: resolveFromPlan(planDir, action.source),
          outPath: resolveFromPlan(planDir, action.out),
          title: action.title,
          version: action.version,
          dryRun,
        },
        shouldCommit,
        action.commit,
      );

      summaries.push(`extract ${result.from} endpoints=${result.endpoints}`);
      continue;
    }

    const result = runConversion(
      {
        from: action.from,
        to: action.to as SupportedFramework,
        sourcePath: resolveFromPlan(planDir, action.source),
        outPath: resolveFromPlan(planDir, action.out),
        openApiPath: resolveFromPlan(planDir, action.openapi),
        mappingPath: action.mapping ? resolveFromPlan(planDir, action.mapping) : undefined,
        targetVersion: action.targetVersion,
        extractIfMissing: action.extractIfMissing,
        extractOutPath: action.extractOut ? resolveFromPlan(planDir, action.extractOut) : undefined,
        dryRun,
      },
      shouldCommit,
      action.commit,
    );

    summaries.push(`convert ${result.from}->${result.to} files=${result.generatedFiles.length}`);
  }

  return {
    actions: parsed.data.actions.length,
    summaries,
  };
}
