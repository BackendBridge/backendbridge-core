import fs from "node:fs";
import path from "node:path";
import yaml from "js-yaml";
import { z } from "zod";
import type { ApiContract, EndpointContract, EndpointSchema, PathParameter, SchemaProperty, SecurityScheme } from "./types.js";

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
      securitySchemes: z.record(z.string(), z.unknown()).optional(),
    })
    .optional(),
  security: z.array(z.record(z.string(), z.array(z.string()))).optional(),
});

const HTTP_METHODS = new Set(["get", "post", "put", "patch", "delete", "head", "options"]);

function readOpenApiRaw(openApiPath: string): unknown {
  const content = fs.readFileSync(openApiPath, "utf8");
  const ext = path.extname(openApiPath).toLowerCase();
  return ext === ".yaml" || ext === ".yml" ? yaml.load(content) : JSON.parse(content);
}

// ─── Schema resolution ────────────────────────────────────────────────────────

function resolveRef(ref: string, componentSchemas: Record<string, unknown>): unknown {
  if (!ref.startsWith("#/components/schemas/")) return undefined;
  const name = ref.replace("#/components/schemas/", "");
  return componentSchemas[name];
}

function mergeSchemas(schemas: unknown[], componentSchemas: Record<string, unknown>): Record<string, unknown> {
  const merged: Record<string, unknown> = { type: "object", properties: {}, required: [] };
  for (const s of schemas) {
    if (!s || typeof s !== "object") continue;
    const raw = s as Record<string, unknown>;
    const resolved = raw.$ref ? resolveRef(raw.$ref as string, componentSchemas) as Record<string, unknown> ?? raw : raw;
    if (resolved.properties && typeof resolved.properties === "object") {
      merged.properties = { ...(merged.properties as object), ...(resolved.properties as object) };
    }
    if (Array.isArray(resolved.required)) {
      (merged.required as string[]).push(...(resolved.required as string[]));
    }
    for (const key of ["type", "format", "enum", "minimum", "maximum", "minLength", "maxLength", "nullable"] as const) {
      if (resolved[key] !== undefined) merged[key] = resolved[key];
    }
  }
  return merged;
}

function extractSchemaProperties(
  rawSchema: unknown,
  componentSchemas: Record<string, unknown>,
  depth = 0,
): EndpointSchema | undefined {
  if (!rawSchema || typeof rawSchema !== "object" || depth > 10) return undefined;
  const s = rawSchema as Record<string, unknown>;

  // Resolve $ref first
  if (typeof s.$ref === "string") {
    const resolved = resolveRef(s.$ref, componentSchemas);
    if (resolved) return extractSchemaProperties(resolved, componentSchemas, depth + 1);
    return undefined;
  }

  // Handle allOf — merge all sub-schemas
  if (Array.isArray(s.allOf)) {
    const merged = mergeSchemas(s.allOf, componentSchemas);
    return extractSchemaProperties(merged, componentSchemas, depth + 1);
  }

  // Handle anyOf / oneOf — use the first object schema found
  const composite = (s.anyOf ?? s.oneOf) as unknown[] | undefined;
  if (Array.isArray(composite)) {
    for (const sub of composite) {
      const result = extractSchemaProperties(sub, componentSchemas, depth + 1);
      if (result) return result;
    }
    return undefined;
  }

  if (s.type !== "object" && !s.properties) return undefined;

  const rawProps = (s.properties ?? {}) as Record<string, unknown>;
  const requiredList = Array.isArray(s.required) ? (s.required as string[]) : [];
  const properties: Record<string, SchemaProperty> = {};

  for (const [key, val] of Object.entries(rawProps)) {
    if (!val || typeof val !== "object") continue;
    const v = val as Record<string, unknown>;

    // Nested $ref inside a property
    if (typeof v.$ref === "string") {
      const resolved = resolveRef(v.$ref, componentSchemas);
      if (resolved && typeof resolved === "object") {
        const rv = resolved as Record<string, unknown>;
        properties[key] = {
          type: typeof rv.type === "string" ? rv.type : "object",
          $ref: v.$ref,
        };
      }
      continue;
    }

    // Nested allOf/anyOf/oneOf inside a property
    const subComposite = (v.allOf ?? v.anyOf ?? v.oneOf) as unknown[] | undefined;
    if (Array.isArray(subComposite)) {
      const merged = mergeSchemas(subComposite, componentSchemas);
      properties[key] = { type: typeof merged.type === "string" ? merged.type : "object" };
      continue;
    }

    const prop: SchemaProperty = {};
    if (typeof v.type === "string") prop.type = v.type;
    if (typeof v.format === "string") prop.format = v.format;
    if (typeof v.minLength === "number") prop.minLength = v.minLength;
    if (typeof v.maxLength === "number") prop.maxLength = v.maxLength;
    if (typeof v.minimum === "number") prop.minimum = v.minimum;
    if (typeof v.maximum === "number") prop.maximum = v.maximum;
    if (v.nullable === true) prop.nullable = true;
    if (Array.isArray(v.enum)) prop.enum = v.enum as string[];

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

// ─── Response schema extraction ───────────────────────────────────────────────

function extractResponseSchema(
  op: Record<string, unknown>,
  componentSchemas: Record<string, unknown>,
): EndpointSchema | undefined {
  const responses = op.responses as Record<string, unknown> | undefined;
  if (!responses) return undefined;

  // Try 200, then 201, then 2xx
  for (const code of ["200", "201", "2XX", "2xx", "default"]) {
    const resp = responses[code] as Record<string, unknown> | undefined;
    if (!resp) continue;

    // Handle $ref to response component
    let resolved = resp;
    if (typeof resp.$ref === "string") {
      // e.g. #/components/responses/UserResponse — not implemented in schema, skip
      continue;
    }

    const content = resolved.content as Record<string, unknown> | undefined;
    const jsonBody = (content?.["application/json"] ?? content?.["application/hal+json"] ?? content?.["application/ld+json"]) as Record<string, unknown> | undefined;
    if (!jsonBody?.schema) continue;

    // Unwrap common pagination wrappers: { data: [...], meta: {...} }
    const schema = extractSchemaProperties(jsonBody.schema, componentSchemas);
    if (!schema) continue;

    // If response wraps a data array (pagination), dig into items
    const dataField = schema.properties["data"];
    if (dataField?.type === "array" && dataField.items) {
      // Resolve the item schema
      const rawSchema = jsonBody.schema as Record<string, unknown>;
      const rawProps = (rawSchema.properties ?? {}) as Record<string, unknown>;
      const dataRaw = rawProps["data"] as Record<string, unknown> | undefined;
      if (dataRaw?.items) {
        const itemSchema = extractSchemaProperties(dataRaw.items, componentSchemas);
        if (itemSchema) return itemSchema;
      }
    }

    return schema;
  }
  return undefined;
}

// ─── Security schemes ─────────────────────────────────────────────────────────

function parseSecuritySchemes(raw: Record<string, unknown>): Record<string, SecurityScheme> {
  const result: Record<string, SecurityScheme> = {};
  for (const [name, def] of Object.entries(raw)) {
    if (!def || typeof def !== "object") continue;
    const d = def as Record<string, unknown>;
    const type = d.type as string;
    if (!["http", "apiKey", "oauth2", "openIdConnect"].includes(type)) continue;
    result[name] = {
      type: type as SecurityScheme["type"],
      scheme: typeof d.scheme === "string" ? d.scheme : undefined,
      bearerFormat: typeof d.bearerFormat === "string" ? d.bearerFormat : undefined,
      in: typeof d.in === "string" ? d.in : undefined,
      name: typeof d.name === "string" ? d.name : undefined,
    };
  }
  return result;
}

function resolveEndpointSecurity(
  op: Record<string, unknown>,
  globalSecurity: Array<Record<string, unknown>> | undefined,
): string[] {
  const secArr = Array.isArray(op.security) ? op.security as Array<Record<string, unknown>> : globalSecurity;
  if (!secArr) return [];
  return secArr.flatMap((entry) => Object.keys(entry));
}

// ─── Main parser ──────────────────────────────────────────────────────────────

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

  const securitySchemes = parsed.data.components?.securitySchemes
    ? parseSecuritySchemes(parsed.data.components.securitySchemes as Record<string, unknown>)
    : undefined;

  const globalSecurity = parsed.data.security as Array<Record<string, unknown>> | undefined;

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
              schema: param.schema
                ? (extractSchemaProperties(param.schema, rawComponentSchemas) as unknown as SchemaProperty)
                : undefined,
            });
          }
        }
      }

      // Extract requestBody schema (supports allOf/anyOf/oneOf via extractSchemaProperties)
      let requestBodySchema: EndpointSchema | undefined;
      if (op.requestBody && typeof op.requestBody === "object") {
        const rb = op.requestBody as Record<string, unknown>;
        const content = rb.content as Record<string, unknown> | undefined;
        const jsonContent = (content?.["application/json"] ?? content?.["multipart/form-data"]) as Record<string, unknown> | undefined;
        if (jsonContent?.schema) {
          requestBodySchema = extractSchemaProperties(jsonContent.schema, rawComponentSchemas);
        }
      }

      // Extract response schema from 200/201
      const responseSchema = extractResponseSchema(op, rawComponentSchemas);

      // Security
      const security = resolveEndpointSecurity(op, globalSecurity);

      endpoints.push({
        method: normalizedMethod,
        path: routePath,
        operationId,
        summary: typeof op.summary === "string" ? op.summary : undefined,
        description: typeof op.description === "string" ? op.description : undefined,
        tags: Array.isArray(op.tags) ? (op.tags as string[]) : [],
        pathParameters: pathParameters.length ? pathParameters : undefined,
        requestBodySchema,
        responseSchema,
        security: security.length ? security : undefined,
        deprecated: op.deprecated === true,
      });
    }
  }

  return {
    title: parsed.data.info.title,
    version: parsed.data.info.version,
    endpoints,
    componentSchemas: Object.keys(componentSchemas).length ? componentSchemas : undefined,
    securitySchemes,
  };
}
