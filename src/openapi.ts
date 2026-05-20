import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { z } from "zod";
import type { ApiContract } from "./types.js";

const OpenApiSchema = z.object({
  openapi: z.string().optional(),
  info: z
    .object({
      title: z.string().default("API"),
      version: z.string().default("1.0.0"),
    })
    .default({ title: "API", version: "1.0.0" }),
  paths: z.record(z.string(), z.record(z.string(), z.unknown())).default({}),
});

const HTTP_METHODS = new Set([
  "get",
  "post",
  "put",
  "patch",
  "delete",
  "head",
  "options",
]);

function readOpenApiRaw(openApiPath: string): unknown {
  const content = fs.readFileSync(openApiPath, "utf8");
  const ext = path.extname(openApiPath).toLowerCase();
  if (ext === ".yaml" || ext === ".yml") {
    return yaml.load(content);
  }
  return JSON.parse(content);
}

export function parseOpenApiToContract(openApiPath: string): ApiContract {
  const parsed = OpenApiSchema.safeParse(readOpenApiRaw(openApiPath));
  if (!parsed.success) {
    throw new Error(`Fichier OpenAPI invalide: ${parsed.error.message}`);
  }

  const endpoints: ApiContract["endpoints"] = [];
  for (const [routePath, methods] of Object.entries(parsed.data.paths)) {
    for (const [method, operation] of Object.entries(methods)) {
      const normalizedMethod = method.toLowerCase();
      if (!HTTP_METHODS.has(normalizedMethod)) {
        continue;
      }

      const operationObject = (operation ?? {}) as {
        operationId?: string;
        summary?: string;
        tags?: string[];
      };

      const operationId =
        operationObject.operationId ??
        `${normalizedMethod}_${routePath.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "")}`;

      endpoints.push({
        method: normalizedMethod,
        path: routePath,
        operationId,
        summary: operationObject.summary,
        tags: operationObject.tags ?? [],
      });
    }
  }

  return {
    title: parsed.data.info.title,
    version: parsed.data.info.version,
    endpoints,
  };
}
