import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { dump, load as yamlLoad } from "js-yaml";
import { appendActionLog } from "./action-log.js";
import { commitGeneratedFiles } from "./commit.js";
import { resolveFramework } from "./framework.js";
import { parsePhpFileForApiPlatform } from "./php-ast.js";
import { extractLaravelFormRequests, extractSymfonyDtoSchemas, matchRequestToOperation } from "./schema-extractor.js";
import type { SupportedFramework } from "./types.js";

interface ExtractOptions {
  from: "auto" | SupportedFramework;
  sourcePath: string;
  outPath: string;
  title?: string;
  version?: string;
  dryRun: boolean;
  usePhpAst?: boolean;
}

interface ExtractQueryParam {
  name: string;
  required: boolean;
  type: string;
  description?: string;
}

interface ExtractEndpoint {
  method: string;
  path: string;
  operationId: string;
  summary?: string;
  tags?: string[];
  pathParams?: string[];
  queryParams?: ExtractQueryParam[];
}

export interface ExtractResult {
  from: SupportedFramework;
  outPath: string;
  endpoints: number;
  generatedFiles: string[];
  committed: boolean;
  commitMessage?: string;
}

const HTTP_METHODS = ["get", "post", "put", "patch", "delete", "head", "options"];

// Laravel resource routes: method + relative path + operationId suffix
const RESOURCE_ROUTES: Array<{ method: string; suffix: string; opSuffix: string; hasId: boolean }> = [
  { method: "get",    suffix: "",          opSuffix: "index",   hasId: false },
  { method: "post",   suffix: "",          opSuffix: "store",   hasId: false },
  { method: "get",    suffix: "/{id}",     opSuffix: "show",    hasId: true  },
  { method: "put",    suffix: "/{id}",     opSuffix: "update",  hasId: true  },
  { method: "patch",  suffix: "/{id}",     opSuffix: "update",  hasId: true  },
  { method: "delete", suffix: "/{id}",     opSuffix: "destroy", hasId: true  },
];

const API_RESOURCE_ROUTES = RESOURCE_ROUTES; // apiResource omits create/edit (web-only)

function walkFiles(basePath: string, result: string[] = []): string[] {
  for (const entry of fs.readdirSync(basePath, { withFileTypes: true })) {
    const fullPath = path.join(basePath, entry.name);
    if (entry.isDirectory()) {
      walkFiles(fullPath, result);
      continue;
    }
    result.push(fullPath);
  }
  return result;
}

function normalizePath(inputPath: string): string {
  return inputPath.startsWith("/") ? inputPath : `/${inputPath}`;
}

function pathParamsFrom(routePath: string): string[] {
  return [...routePath.matchAll(/\{(\w+)\??}/g)].map((m) => m[1]);
}

function normalizePathParams(routePath: string): string {
  // Laravel uses {param?} for optional — convert to {param} for OpenAPI
  return routePath.replace(/\{(\w+)\?\}/g, "{$1}");
}

function tagFromPath(routePath: string, fallback: string): string {
  const seg = routePath.split("/").filter(Boolean).find((s) => !s.startsWith("{"));
  return seg ? seg.charAt(0).toUpperCase() + seg.slice(1) : fallback;
}

function uniqueByMethodPath(endpoints: ExtractEndpoint[]): ExtractEndpoint[] {
  const map = new Map<string, ExtractEndpoint>();
  for (const ep of endpoints) {
    map.set(`${ep.method}:${ep.path}`, ep);
  }
  return [...map.values()];
}

// ─── Laravel ─────────────────────────────────────────────────────────────────

function extractFromLaravel(sourcePath: string): ExtractEndpoint[] {
  const routesDir = path.join(sourcePath, "routes");
  const candidates = [
    path.join(routesDir, "api.php"),
    path.join(routesDir, "web.php"),
  ];
  const endpoints: ExtractEndpoint[] = [];

  for (const filePath of candidates) {
    if (!fs.existsSync(filePath)) continue;
    const content = fs.readFileSync(filePath, "utf8");

    // Standard method routes: Route::get('/path', ...)
    const routeRegex = /Route::(get|post|put|patch|delete|head|options)\(\s*['\"]([^'\"]+)['\"](?:[^,)]*,\s*['\"]?([A-Za-z0-9_\\@:]+)['\"]?)?/gi;
    let m: RegExpExecArray | null;
    while ((m = routeRegex.exec(content)) !== null) {
      const method = m[1].toLowerCase();
      const rawPath = normalizePath(normalizePathParams(m[2]));
      const controller = m[3];
      const tag = tagFromPath(rawPath, "Api");
      const queryParams = extractQueryParamsFromPhp(content);
      endpoints.push({
        method,
        path: rawPath,
        operationId: `${method}_${rawPath.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "")}`,
        summary: controller ? `${method.toUpperCase()} ${rawPath}` : undefined,
        tags: [tag],
        pathParams: pathParamsFrom(rawPath),
        queryParams: queryParams.length && method === "get" ? queryParams : undefined,
      });
    }

    // Route::resource('resource', Controller::class)
    const resourceRegex = /Route::(?:api)?[Rr]esource\(\s*['\"]([^'\"]+)['\"](?:[^,)]*,\s*([A-Za-z0-9_\\]+)(?:::class)?)?/g;
    while ((m = resourceRegex.exec(content)) !== null) {
      const resourceName = m[1];
      const basePath = normalizePath(resourceName);
      const tag = tagFromPath(basePath, resourceName);
      const isApi = content.slice(m.index, m.index + 20).toLowerCase().includes("apiresource");
      const routes = isApi ? API_RESOURCE_ROUTES : RESOURCE_ROUTES;

      for (const r of routes) {
        const fullPath = `${basePath}${r.suffix}`;
        endpoints.push({
          method: r.method,
          path: fullPath,
          operationId: `${resourceName.replace(/\//g, "_")}_${r.opSuffix}`,
          summary: `${r.opSuffix.charAt(0).toUpperCase() + r.opSuffix.slice(1)} ${tag}`,
          tags: [tag],
          pathParams: r.hasId ? ["id"] : [],
        });
      }
    }

    // Route::group / Route::prefix chaining — extract grouped routes
    const groupedRegex = /->(?:prefix|group)\(\s*['\"]([^'\"]+)['\"][^;]*?Route::(get|post|put|patch|delete)\(\s*['\"]([^'\"]+)['\"](?:[^,)]*,\s*['\"]?([A-Za-z0-9_\\@:]+)['\"]?)?/gi;
    while ((m = groupedRegex.exec(content)) !== null) {
      const prefix = m[1];
      const method = m[2].toLowerCase();
      const rawPath = normalizePath(normalizePathParams(`${prefix}/${m[3]}`));
      const tag = tagFromPath(rawPath, prefix);
      endpoints.push({
        method,
        path: rawPath,
        operationId: `${method}_${rawPath.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "")}`,
        tags: [tag],
        pathParams: pathParamsFrom(rawPath),
      });
    }
  }

  return uniqueByMethodPath(endpoints);
}

// ─── Symfony ─────────────────────────────────────────────────────────────────

function controllerToTag(filePath: string): string {
  const base = path.basename(filePath, ".php").replace(/Controller$/, "");
  return base || "Api";
}

function extractFromSymfony(sourcePath: string): ExtractEndpoint[] {
  const controllersDir = path.join(sourcePath, "src", "Controller");
  if (!fs.existsSync(controllersDir)) return [];

  const endpoints: ExtractEndpoint[] = [];
  const phpFiles = walkFiles(controllersDir).filter((f) => f.endsWith(".php"));

  for (const filePath of phpFiles) {
    const content = fs.readFileSync(filePath, "utf8");
    const tag = controllerToTag(filePath);

    // Class-level prefix: #[Route('/prefix')] placed directly before `class ClassName`
    const classPrefixMatch = /#\[Route\(\s*['\"]([^'\"]+)['\"][^\)]*\)\]\s*(?:#\[[^\]]*\]\s*)*class\s+\w/ms.exec(content);
    const classPrefix = classPrefixMatch ? classPrefixMatch[1].replace(/\/$/, "") : "";

    // PHP 8 attribute routes: #[Route('/path', name: 'name', methods: ['GET'])]
    const attributeRegex =
      /#\[Route\(\s*['\"]([^'\"]+)['\"][^\)]*?(?:name:\s*['\"]([^'\"]+)['\"])?[^\)]*?(?:methods:\s*\[([^\]]+)\])?[^\)]*\)\]/g;
    let m: RegExpExecArray | null;
    while ((m = attributeRegex.exec(content)) !== null) {
      const rawPath = normalizePath(normalizePathParams(classPrefix + m[1]));
      const routeName = m[2];
      const methodsRaw = m[3] ?? "'GET'";
      const methods = methodsRaw
        .split(",")
        .map((v) => v.replace(/[\s'"]/g, "").toLowerCase())
        .filter((v) => HTTP_METHODS.includes(v));

      for (const method of methods.length ? methods : ["get"]) {
        endpoints.push({
          method,
          path: rawPath,
          operationId: routeName ?? `${method}_${rawPath.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "")}`,
          tags: [tag],
          pathParams: pathParamsFrom(rawPath),
        });
      }
    }

    // Doctrine annotation routes: @Route('/path', name="name", methods={"GET"})
    const annotationRegex =
      /@Route\(\s*['\"]([^'\"]+)['\"][^\)]*?(?:name\s*=\s*['\"]([^'\"]+)['\"])?[^\)]*?(?:methods\s*=\s*\{([^\}]+)\})?[^\)]*\)/g;
    while ((m = annotationRegex.exec(content)) !== null) {
      const rawPath = normalizePath(normalizePathParams(classPrefix + m[1]));
      const routeName = m[2];
      const methodsRaw = m[3] ?? '"GET"';
      const methods = methodsRaw
        .split(",")
        .map((v) => v.replace(/[\s'"]/g, "").toLowerCase())
        .filter((v) => HTTP_METHODS.includes(v));

      const queryParams = extractQueryParamsFromPhp(content);
      for (const method of methods.length ? methods : ["get"]) {
        endpoints.push({
          method,
          path: rawPath,
          operationId: routeName ?? `${method}_${rawPath.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "")}`,
          tags: [tag],
          pathParams: pathParamsFrom(rawPath),
          queryParams: queryParams.length ? queryParams : undefined,
        });
      }
    }
  }

  return uniqueByMethodPath(endpoints);
}

// ─── Symfony YAML routes ─────────────────────────────────────────────────────

function extractFromSymfonyYaml(sourcePath: string): ExtractEndpoint[] {
  const candidateFiles: string[] = [];
  const routesDir = path.join(sourcePath, "config", "routes");
  const rootRoutes = path.join(sourcePath, "config", "routes.yaml");

  if (fs.existsSync(rootRoutes)) candidateFiles.push(rootRoutes);
  if (fs.existsSync(routesDir)) {
    for (const f of fs.readdirSync(routesDir)) {
      if (f.endsWith(".yaml") || f.endsWith(".yml")) {
        candidateFiles.push(path.join(routesDir, f));
      }
    }
  }

  const endpoints: ExtractEndpoint[] = [];

  for (const filePath of candidateFiles) {
    let raw: unknown;
    try {
      raw = yamlLoad(fs.readFileSync(filePath, "utf8"));
    } catch {
      continue;
    }
    if (!raw || typeof raw !== "object") continue;

    for (const [routeName, def] of Object.entries(raw as Record<string, unknown>)) {
      if (!def || typeof def !== "object") continue;
      const d = def as Record<string, unknown>;

      // Skip resource imports (type: attribute/annotation)
      if (d.type || d.resource) continue;

      const routePath = typeof d.path === "string" ? normalizePath(normalizePathParams(d.path)) : null;
      if (!routePath) continue;

      const rawMethods = Array.isArray(d.methods)
        ? (d.methods as string[]).map((m) => m.toLowerCase())
        : typeof d.methods === "string"
          ? [d.methods.toLowerCase()]
          : ["get"];

      const validMethods = rawMethods.filter((m) => HTTP_METHODS.includes(m));
      const tag = tagFromPath(routePath, "Api");

      for (const method of validMethods.length ? validMethods : ["get"]) {
        endpoints.push({
          method,
          path: routePath,
          operationId: routeName,
          tags: [tag],
          pathParams: pathParamsFrom(routePath),
        });
      }
    }
  }

  return uniqueByMethodPath(endpoints);
}

// ─── Query parameter extraction ───────────────────────────────────────────────

function extractQueryParamsFromPhp(content: string): ExtractQueryParam[] {
  const params: ExtractQueryParam[] = [];
  const seen = new Set<string>();

  // $request->query->get('name') / ->getInt('name') / ->getString('name')
  const queryGetRegex = /\$request->query->(get|getInt|getString|getBoolean|getBag|has|filter)\(\s*['"](\w+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = queryGetRegex.exec(content)) !== null) {
    const method = m[1];
    const name = m[2];
    if (seen.has(name)) continue;
    seen.add(name);
    const type = method === "getInt" ? "integer" : method === "getBoolean" ? "boolean" : "string";
    params.push({ name, required: false, type });
  }

  // $request->query('name') — Laravel style in routes
  const laravelQueryRegex = /\$request->(?:query|input)\(\s*['"](\w+)['"]/g;
  while ((m = laravelQueryRegex.exec(content)) !== null) {
    const name = m[1];
    if (seen.has(name)) continue;
    seen.add(name);
    params.push({ name, required: false, type: "string" });
  }

  // @QueryParam or #[QueryParam] annotations (NelmioApiDocBundle, etc.)
  const queryParamAttrRegex = /#\[QueryParam\([^)]*name:\s*['"](\w+)['"][^)]*(?:requirements:\s*['"]([\w|]+)['"])?[^)]*(?:nullable:\s*(true|false))?/gi;
  while ((m = queryParamAttrRegex.exec(content)) !== null) {
    const name = m[1];
    const nullable = m[3] !== "false";
    if (seen.has(name)) continue;
    seen.add(name);
    params.push({ name, required: !nullable, type: "string" });
  }

  return params;
}

// ─── ApiPlatform ─────────────────────────────────────────────────────────────

function extractApiPlatformFromSymfony(sourcePath: string, usePhpAst = false): ExtractEndpoint[] {
  const scanRoots = [
    path.join(sourcePath, "src", "Entity"),
    path.join(sourcePath, "src", "ApiResource"),
  ];
  const endpoints: ExtractEndpoint[] = [];

  const apiPlatformMethodMap: Record<string, string> = {
    GetCollection: "get", Get: "get", Post: "post",
    Put: "put", Patch: "patch", Delete: "delete",
  };

  for (const scanRoot of scanRoots) {
    if (!fs.existsSync(scanRoot)) continue;

    for (const filePath of walkFiles(scanRoot).filter((f) => f.endsWith(".php"))) {
      const content = fs.readFileSync(filePath, "utf8");
      if (!content.includes("ApiResource")) continue;

      if (usePhpAst) {
        try {
          for (const r of parsePhpFileForApiPlatform(filePath)) {
            endpoints.push({ ...(r as ExtractEndpoint), pathParams: pathParamsFrom(r.path) });
          }
          continue;
        } catch {
          // fallback
        }
      }

      const className = path.basename(filePath, ".php");
      const tag = className;
      const basePath = `/${className.toLowerCase()}s`;

      const declaredPaths: string[] = [];
      for (const [, tpl] of content.matchAll(/uriTemplate:\s*['\"]([^'\"]+)['\"]/) ?? []) {
        declaredPaths.push(normalizePath(tpl));
      }

      let hasExplicit = false;
      const opRegex =
        /#\[[^\]]*(GetCollection|Get|Post|Put|Patch|Delete)\s*\(([^\)]*)\)|new\s+(?:[A-Za-z0-9_\\\\]+\\)?(GetCollection|Get|Post|Put|Patch|Delete)\s*\(([^\)]*)\)/g;
      let m: RegExpExecArray | null;
      while ((m = opRegex.exec(content)) !== null) {
        hasExplicit = true;
        const op = (m[1] ?? m[3]) as string;
        const args = m[2] ?? m[4] ?? "";
        const method = apiPlatformMethodMap[op] ?? "get";
        const uriMatch = /uriTemplate:\s*['\"]([^'\"]+)['\"]/.exec(args);
        const routePath = normalizePath(uriMatch?.[1] ?? declaredPaths[0] ?? basePath);
        endpoints.push({
          method,
          path: routePath,
          operationId: `${method}_${className.toLowerCase()}_${routePath.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "")}`,
          tags: [tag],
          pathParams: pathParamsFrom(routePath),
        });
      }

      if (!hasExplicit) {
        for (const [method, opSuffix, suffix] of [
          ["get",    "collection", ""],
          ["post",   "item",       ""],
          ["get",    "item",       "/{id}"],
          ["patch",  "item",       "/{id}"],
          ["delete", "item",       "/{id}"],
        ] as const) {
          endpoints.push({
            method,
            path: `${basePath}${suffix}`,
            operationId: `${method}_${className.toLowerCase()}_${opSuffix}`,
            tags: [tag],
            pathParams: suffix ? ["id"] : [],
          });
        }
      }
    }
  }

  return uniqueByMethodPath(endpoints);
}

// ─── OpenAPI document builder ─────────────────────────────────────────────────

function needsRequestBody(method: string): boolean {
  return ["post", "put", "patch"].includes(method);
}

function buildOpenApiDocument(
  framework: SupportedFramework,
  endpoints: ExtractEndpoint[],
  title: string,
  version: string,
  schemas: {
    laravelRequests?: ReturnType<typeof extractLaravelFormRequests>;
    symfonyDtos?: ReturnType<typeof extractSymfonyDtoSchemas>;
  } = {},
): Record<string, unknown> {
  const paths: Record<string, Record<string, unknown>> = {};
  const componentSchemas: Record<string, unknown> = {};

  for (const ep of endpoints) {
    paths[ep.path] ??= {};

    // Path parameters + query parameters
    const parameters: unknown[] = [
      ...(ep.pathParams ?? []).map((p) => ({
        name: p,
        in: "path",
        required: true,
        schema: { type: /id$/i.test(p) ? "integer" : "string" },
        description: p,
      })),
      ...(ep.queryParams ?? []).map((q) => ({
        name: q.name,
        in: "query",
        required: q.required,
        schema: { type: q.type },
        description: q.description ?? q.name,
      })),
    ];

    // Request body: match a FormRequest or DTO schema if available
    let requestBody: unknown;
    if (needsRequestBody(ep.method)) {
      let bodySchema: unknown = { type: "object" };

      if (framework === "laravel" && schemas.laravelRequests) {
        const matched = matchRequestToOperation(ep.operationId, schemas.laravelRequests);
        if (matched && Object.keys(matched.schema.properties).length > 0) {
          const schemaName = matched.className;
          componentSchemas[schemaName] = {
            type: "object",
            properties: matched.schema.properties,
            required: matched.schema.required.length ? matched.schema.required : undefined,
          };
          bodySchema = { $ref: `#/components/schemas/${schemaName}` };
        }
      }

      if (framework === "symfony" && schemas.symfonyDtos) {
        const lower = ep.operationId.toLowerCase();
        const matched = schemas.symfonyDtos.find((d) =>
          lower.includes(d.className.toLowerCase().replace(/dto|request/i, ""))
        );
        if (matched && Object.keys(matched.schema.properties).length > 0) {
          const schemaName = matched.className;
          componentSchemas[schemaName] = {
            type: "object",
            properties: matched.schema.properties,
            required: matched.schema.required.length ? matched.schema.required : undefined,
          };
          bodySchema = { $ref: `#/components/schemas/${schemaName}` };
        }
      }

      requestBody = {
        required: true,
        content: { "application/json": { schema: bodySchema } },
      };
    }

    // Responses
    const responses: Record<string, unknown> = {
      "200": {
        description: ep.method === "post" ? "Created" : "Success",
        content: { "application/json": { schema: { type: "object" } } },
      },
    };
    if (ep.method === "post") responses["201"] = responses["200"];
    if (needsRequestBody(ep.method)) responses["422"] = { description: "Validation error" };
    if (ep.pathParams?.length) responses["404"] = { description: "Not found" };

    paths[ep.path][ep.method] = {
      operationId: ep.operationId,
      summary: ep.summary ?? `${ep.method.toUpperCase()} ${ep.path}`,
      tags: ep.tags ?? [framework],
      ...(parameters.length ? { parameters } : {}),
      ...(requestBody ? { requestBody } : {}),
      responses,
    };
  }

  const doc: Record<string, unknown> = {
    openapi: "3.0.3",
    info: { title, version },
    paths,
  };

  if (Object.keys(componentSchemas).length > 0) {
    doc.components = { schemas: componentSchemas };
  }

  return doc;
}

function writeOpenApiFile(outPath: string, document: Record<string, unknown>): void {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const ext = path.extname(outPath).toLowerCase();
  if (ext === ".yaml" || ext === ".yml") {
    fs.writeFileSync(outPath, dump(document, { noRefs: true }), "utf8");
  } else {
    fs.writeFileSync(outPath, JSON.stringify(document, null, 2) + "\n", "utf8");
  }
}

export function defaultExtractCommitMessage(from: SupportedFramework): string {
  return `feat(bridge): extract openapi contract from ${from}`;
}

function phpAvailable(): boolean {
  try {
    execFileSync("php", ["--version"], { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

export function runExtraction(
  options: ExtractOptions,
  shouldCommit: boolean,
  commitMessage?: string,
): ExtractResult {
  const from = resolveFramework(options.from, options.sourcePath);

  // Use PHP AST when explicitly requested OR when php binary is available (better accuracy)
  const useAst = options.usePhpAst === true || (options.usePhpAst !== false && phpAvailable());

  const rawEndpoints =
    from === "laravel"
      ? extractFromLaravel(options.sourcePath)
      : uniqueByMethodPath([
          ...extractFromSymfony(options.sourcePath),
          ...extractFromSymfonyYaml(options.sourcePath),
          ...extractApiPlatformFromSymfony(options.sourcePath, useAst),
        ]);

  if (!rawEndpoints.length) {
    throw new Error("Aucun endpoint detecte. Verifie les routes et controllers du projet source.");
  }

  // Extract validation schemas from source
  const laravelRequests = from === "laravel" ? extractLaravelFormRequests(options.sourcePath) : [];
  const symfonyDtos = from === "symfony" ? extractSymfonyDtoSchemas(options.sourcePath) : [];

  const title = options.title ?? `Extracted ${from} API`;
  const version = options.version ?? "1.0.0";
  const doc = buildOpenApiDocument(from, rawEndpoints, title, version, { laravelRequests, symfonyDtos });

  writeOpenApiFile(options.outPath, doc);

  const generatedFiles = [options.outPath];
  const actionLogFile = appendActionLog(options.sourcePath, "extract", {
    from,
    outPath: options.outPath,
    endpoints: rawEndpoints.length,
    schemasExtracted: laravelRequests.length + symfonyDtos.length,
  });
  generatedFiles.push(actionLogFile);

  if (!options.dryRun && shouldCommit) {
    const message = commitMessage ?? defaultExtractCommitMessage(from);
    commitGeneratedFiles(generatedFiles, message, options.sourcePath);
    return { from, outPath: options.outPath, endpoints: rawEndpoints.length, generatedFiles, committed: true, commitMessage: message };
  }

  return { from, outPath: options.outPath, endpoints: rawEndpoints.length, generatedFiles, committed: false };
}
