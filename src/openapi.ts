import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { z } from "zod";
import type { ApiContract, EndpointContract, EndpointSchema, PathParameter, SchemaProperty } from "./types.js";

const SchemaPropertyZ: z.ZodType<unknown> = z.record(z.string(), z.unknown());

const OpenApiSchema = z.object({
  openapi: z.string().optional(),
  info: z
    .object({
      title: z.string().default("API"),
      version: z.string().default("1.0.0"),
    })
    .default({ title: "API", version: "1.0.0" }),
  paths: z.record(z.string(), z.record(z.string(), z.unknown())).default({}),
  components: z
    .object({
      schemas: z.record(z.string(), z.unknown()).optional(),
    })
    .optional(),
});

const HTTP_METHODS = new Set(["get", "post", "put", "patch", "delete", "head", "options"]);

function readOpenApiRaw(openApiPath: string): unknown {
  const content = fs.readFileSync(openApiPath, "utf8");
  const ext = path.extname(openApiPath).toLowerCase();
  return ext === ".yaml" || ext === ".yml" ? yaml.load(content) : JSON.parse(content);
}

function extractSchemaProperties(rawSchema: unknown, componentSchemas?: Record<string, unknown>): EndpointSchema | undefined {
  if (!rawSchema || typeof rawSchema !== "object") return undefined;
  const s = rawSchema as Record<string, unknown>;

  // Resolve $ref
  if (s.$ref && typeof s.$ref === "string") {
    const refName = (s.$ref as string).replace("#/components/schemas/", "");
    const resolved = componentSchemas?.[refName];
    if (resolved) return extractSchemaProperties(resolved, componentSchemas);
    return undefined;
  }

  if (s.type !== "object" && !s.properties) return undefined;

  const rawProps = (s.properties ?? {}) as Record<string, unknown>;
  const requiredList = Array.isArray(s.required) ? (s.required as string[]) : [];
  const properties: Record<string, SchemaProperty> = {};

  for (const [key, val] of Object.entries(rawProps)) {
    if (!val || typeof val !== "object") continue;
    const v = val as Record<string, unknown>;
    const prop: SchemaProperty = {};
    if (typeof v.type === "string") prop.type = v.type;
    if (typeof v.format === "string") prop.format = v.format;
    if (typeof v.minLength === "number") prop.minLength = v.minLength;
    if (typeof v.maxLength === "number") prop.maxLength = v.maxLength;
    if (typeof v.minimum === "number") prop.minimum = v.minimum;
    if (typeof v.maximum === "number") prop.maximum = v.maximum;
    if (v.nullable === true) prop.nullable = true;
    if (Array.isArray(v.enum)) prop.enum = v.enum as string[];
    if (typeof v.$ref === "string") prop.$ref = v.$ref;
    // Propagate array items (needed for multiple file uploads and typed arrays)
    if (v.type === "array" && v.items && typeof v.items === "object") {
      const it = v.items as Record<string, unknown>;
      prop.items = {
        type: typeof it.type === "string" ? it.type : undefined,
        format: typeof it.format === "string" ? it.format : undefined,
      };
    }
    properties[key] = prop;
  }

  return { properties, required: requiredList };
}

export function parseOpenApiToContract(openApiPath: string): ApiContract {
  const parsed = OpenApiSchema.safeParse(readOpenApiRaw(openApiPath));
  if (!parsed.success) {
    throw new Error(`Fichier OpenAPI invalide: ${parsed.error.message}`);
  }

  const rawComponentSchemas = parsed.data.components?.schemas ?? {};
  const componentSchemas: Record<string, EndpointSchema> = {};
  for (const [name, raw] of Object.entries(rawComponentSchemas)) {
    const schema = extractSchemaProperties(raw, rawComponentSchemas);
    if (schema) componentSchemas[name] = schema;
  }

  const endpoints: EndpointContract[] = [];

  for (const [routePath, methods] of Object.entries(parsed.data.paths)) {
    for (const [method, operation] of Object.entries(methods)) {
      const normalizedMethod = method.toLowerCase();
      if (!HTTP_METHODS.has(normalizedMethod)) continue;

      const op = (operation ?? {}) as Record<string, unknown>;

      const operationId =
        typeof op.operationId === "string"
          ? op.operationId
          : `${normalizedMethod}_${routePath.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "")}`;

      // Extract path & query parameters
      const pathParameters: PathParameter[] = [];
      if (Array.isArray(op.parameters)) {
        for (const p of op.parameters) {
          if (!p || typeof p !== "object") continue;
          const param = p as Record<string, unknown>;
          if (param.in === "path" || param.in === "query") {
            pathParameters.push({
              name: String(param.name ?? ""),
              in: param.in as "path" | "query",
              required: Boolean(param.required ?? param.in === "path"),
              schema: param.schema ? extractSchemaProperties(param.schema, rawComponentSchemas) as unknown as SchemaProperty : undefined,
            });
          }
        }
      }

      // Extract requestBody schema
      let requestBodySchema: EndpointSchema | undefined;
      if (op.requestBody && typeof op.requestBody === "object") {
        const rb = op.requestBody as Record<string, unknown>;
        const content = rb.content as Record<string, unknown> | undefined;
        const jsonContent = content?.["application/json"] as Record<string, unknown> | undefined;
        if (jsonContent?.schema) {
          requestBodySchema = extractSchemaProperties(jsonContent.schema, rawComponentSchemas);
        }
      }

      endpoints.push({
        method: normalizedMethod,
        path: routePath,
        operationId,
        summary: typeof op.summary === "string" ? op.summary : undefined,
        tags: Array.isArray(op.tags) ? op.tags as string[] : [],
        pathParameters: pathParameters.length ? pathParameters : undefined,
        requestBodySchema,
      });
    }
  }

  return {
    title: parsed.data.info.title,
    version: parsed.data.info.version,
    endpoints,
    componentSchemas: Object.keys(componentSchemas).length ? componentSchemas : undefined,
  };
}
