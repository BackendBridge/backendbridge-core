import fs from "node:fs";
import path from "node:path";
import { dump } from "js-yaml";
import { appendActionLog } from "./action-log.js";
import { commitGeneratedFiles } from "./commit.js";
import { resolveFramework } from "./framework.js";
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

interface ExtractEndpoint {
  method: string;
  path: string;
  operationId: string;
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
  if (inputPath.startsWith("/")) {
    return inputPath;
  }
  return `/${inputPath}`;
}

function uniqueByMethodPath(endpoints: ExtractEndpoint[]): ExtractEndpoint[] {
  const map = new Map<string, ExtractEndpoint>();
  for (const endpoint of endpoints) {
    map.set(`${endpoint.method}:${endpoint.path}`, endpoint);
  }
  return [...map.values()];
}

function extractFromLaravel(sourcePath: string): ExtractEndpoint[] {
  const routesDir = path.join(sourcePath, "routes");
  const candidates = [path.join(routesDir, "api.php"), path.join(routesDir, "web.php")];
  const endpoints: ExtractEndpoint[] = [];

  for (const filePath of candidates) {
    if (!fs.existsSync(filePath)) {
      continue;
    }

    const content = fs.readFileSync(filePath, "utf8");
    const routeRegex = /Route::(get|post|put|patch|delete|head|options)\(\s*['\"]([^'\"]+)['\"]/gi;

    let match: RegExpExecArray | null;
    while ((match = routeRegex.exec(content)) !== null) {
      const method = match[1]?.toLowerCase();
      const routePath = match[2];
      if (!method || !routePath) {
        continue;
      }
      endpoints.push({
        method,
        path: normalizePath(routePath),
        operationId: `${method}_${routePath.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "")}`,
      });
    }
  }

  return uniqueByMethodPath(endpoints);
}

// helper to import PHP AST parser wrapper lazily
function awaitImportPhpAst() {
  // We keep this synchronous-looking by returning the module sync if present, else throw
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    return require("./php-ast.js");
  } catch (err) {
    throw new Error("PHP AST parser not available");
  }
}

function extractFromSymfony(sourcePath: string): ExtractEndpoint[] {
  const controllersDir = path.join(sourcePath, "src", "Controller");
  if (!fs.existsSync(controllersDir)) {
    return [];
  }

  const endpoints: ExtractEndpoint[] = [];
  const phpFiles = walkFiles(controllersDir).filter((file) => file.endsWith(".php"));

  for (const filePath of phpFiles) {
    const content = fs.readFileSync(filePath, "utf8");

    const attributeRegex =
      /#\[Route\(\s*['\"]([^'\"]+)['\"][^\)]*?(?:name:\s*['\"]([^'\"]+)['\"])?[^\)]*?(?:methods:\s*\[([^\]]+)\])?[^\)]*\)\]/g;

    let attributeMatch: RegExpExecArray | null;
    while ((attributeMatch = attributeRegex.exec(content)) !== null) {
      const routePath = attributeMatch[1];
      const routeName = attributeMatch[2];
      const methodsRaw = attributeMatch[3] ?? "'GET'";
      const methods = methodsRaw
        .split(",")
        .map((value) => value.replace(/[\s'\"]/g, "").toLowerCase())
        .filter((value) => HTTP_METHODS.includes(value));

      for (const method of methods.length ? methods : ["get"]) {
        endpoints.push({
          method,
          path: normalizePath(routePath),
          operationId:
            routeName ?? `${method}_${routePath.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "")}`,
        });
      }
    }

    const annotationRegex =
      /@Route\(\s*['\"]([^'\"]+)['\"][^\)]*?(?:name\s*=\s*['\"]([^'\"]+)['\"])?[^\)]*?(?:methods\s*=\s*\{([^\}]+)\})?[^\)]*\)/g;

    let annotationMatch: RegExpExecArray | null;
    while ((annotationMatch = annotationRegex.exec(content)) !== null) {
      const routePath = annotationMatch[1];
      const routeName = annotationMatch[2];
      const methodsRaw = annotationMatch[3] ?? "\"GET\"";
      const methods = methodsRaw
        .split(",")
        .map((value) => value.replace(/[\s'\"]/g, "").toLowerCase())
        .filter((value) => HTTP_METHODS.includes(value));

      for (const method of methods.length ? methods : ["get"]) {
        endpoints.push({
          method,
          path: normalizePath(routePath),
          operationId:
            routeName ?? `${method}_${routePath.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "")}`,
        });
      }
    }
  }

  return uniqueByMethodPath(endpoints);
}

function extractApiPlatformFromSymfony(sourcePath: string, usePhpAst = false): ExtractEndpoint[] {
  const scanRoots = [path.join(sourcePath, "src", "Entity"), path.join(sourcePath, "src", "ApiResource")];
  const endpoints: ExtractEndpoint[] = [];

  for (const scanRoot of scanRoots) {
    if (!fs.existsSync(scanRoot)) {
      continue;
    }

    const phpFiles = walkFiles(scanRoot).filter((file) => file.endsWith(".php"));
    for (const filePath of phpFiles) {
      const content = fs.readFileSync(filePath, "utf8");
      if (!content.includes("ApiResource")) {
        continue;
      }

      // If requested and `php` is available, try using PHP-based AST parser for more robust detection
      if (usePhpAst) {
        try {
          // require dynamic module to avoid adding dependency when not used
          const { parsePhpFileForApiPlatform } = awaitImportPhpAst();
          const phpResults = parsePhpFileForApiPlatform(filePath);
          for (const r of phpResults) {
            endpoints.push(r as ExtractEndpoint);
          }
          continue;
        } catch (err) {
          // fallback to regex-based detection
        }
      }

      const className = path.basename(filePath, ".php");
      const basePath = `/${className.toLowerCase()}s`;

      const uriTemplateRegex = /uriTemplate:\s*['\"]([^'\"]+)['\"]/g;
      // match attribute usages like #[Get(...)] or namespaced attributes
      const operationRegex = /#\[[^\]]*(GetCollection|Get|Post|Put|Patch|Delete)\s*\(([^\)]*)\)/g;
      let hasExplicitOperation = false;

      const declaredPaths: string[] = [];
      let uriMatch: RegExpExecArray | null;
      while ((uriMatch = uriTemplateRegex.exec(content)) !== null) {
        const tpl = uriMatch[1];
        if (tpl) {
          declaredPaths.push(normalizePath(tpl));
        }
      }

      let operationMatch: RegExpExecArray | null;
      while ((operationMatch = operationRegex.exec(content)) !== null) {
        hasExplicitOperation = true;
        const op = operationMatch[1];
        const opArgs = operationMatch[2] ?? "";

        let method = "get";
        if (op === "GetCollection" || op === "Get") method = "get";
        if (op === "Post") method = "post";
        if (op === "Put") method = "put";
        if (op === "Patch") method = "patch";
        if (op === "Delete") method = "delete";

        const uriFromOpMatch = /uriTemplate:\s*['\"]([^'\"]+)['\"]/.exec(opArgs);
        const routePath = normalizePath(uriFromOpMatch?.[1] ?? declaredPaths[0] ?? basePath);

        endpoints.push({
          method,
          path: routePath,
          operationId: `${method}_${className.toLowerCase()}_${routePath.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "")}`,
        });
      }

      // also detect usages like new Get(...), possibly inside itemOperations/collectionOperations arrays
      const newOpRegex = /new\s+(?:[A-Za-z0-9_\\\\]+\\\\)?(GetCollection|Get|Post|Put|Patch|Delete)\s*\(([^\)]*)\)/g;
      let newOpMatch: RegExpExecArray | null;
      while ((newOpMatch = newOpRegex.exec(content)) !== null) {
        hasExplicitOperation = true;
        const op = newOpMatch[1];
        const opArgs = newOpMatch[2] ?? "";

        let method = "get";
        if (op === "GetCollection" || op === "Get") method = "get";
        if (op === "Post") method = "post";
        if (op === "Put") method = "put";
        if (op === "Patch") method = "patch";
        if (op === "Delete") method = "delete";

        const uriFromOpMatch = /uriTemplate:\s*['\"]([^'\"]+)['\"]/.exec(opArgs);
        const routePath = normalizePath(uriFromOpMatch?.[1] ?? declaredPaths[0] ?? basePath);

        endpoints.push({
          method,
          path: routePath,
          operationId: `${method}_${className.toLowerCase()}_${routePath.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "")}`,
        });
      }

      // detect collectionOperations/itemOperations blocks with inline new Get/Post definitions
      const opsBlockRegex = /(collectionOperations|itemOperations)\s*:\s*\[([^\]]+)\]/g;
      let opsBlockMatch: RegExpExecArray | null;
      while ((opsBlockMatch = opsBlockRegex.exec(content)) !== null) {
        const block = opsBlockMatch[2];
        let innerMatch: RegExpExecArray | null;
        while ((innerMatch = newOpRegex.exec(block)) !== null) {
          hasExplicitOperation = true;
          const op = innerMatch[1];
          const opArgs = innerMatch[2] ?? "";
          let method = "get";
          if (op === "GetCollection" || op === "Get") method = "get";
          if (op === "Post") method = "post";
          if (op === "Put") method = "put";
          if (op === "Patch") method = "patch";
          if (op === "Delete") method = "delete";

          const uriFromOpMatch = /uriTemplate:\s*['\"]([^'\"]+)['\"]/.exec(opArgs);
          const routePath = normalizePath(uriFromOpMatch?.[1] ?? declaredPaths[0] ?? basePath);

          endpoints.push({
            method,
            path: routePath,
            operationId: `${method}_${className.toLowerCase()}_${routePath.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "")}`,
          });
        }
      }
      if (!hasExplicitOperation) {
        endpoints.push({
          method: "get",
          path: basePath,
          operationId: `get_${className.toLowerCase()}_collection`,
        });
        endpoints.push({
          method: "get",
          path: `${basePath}/{id}`,
          operationId: `get_${className.toLowerCase()}_item`,
        });
        endpoints.push({
          method: "post",
          path: basePath,
          operationId: `post_${className.toLowerCase()}_item`,
        });
        endpoints.push({
          method: "patch",
          path: `${basePath}/{id}`,
          operationId: `patch_${className.toLowerCase()}_item`,
        });
        endpoints.push({
          method: "delete",
          path: `${basePath}/{id}`,
          operationId: `delete_${className.toLowerCase()}_item`,
        });
      }
    }
  }

  return uniqueByMethodPath(endpoints);
}

function buildOpenApiDocument(
  framework: SupportedFramework,
  endpoints: ExtractEndpoint[],
  title: string,
  version: string,
): Record<string, unknown> {
  const paths: Record<string, Record<string, Record<string, unknown>>> = {};

  for (const endpoint of endpoints) {
    paths[endpoint.path] ??= {};
    paths[endpoint.path][endpoint.method] = {
      operationId: endpoint.operationId,
      summary: `Extracted from ${framework}`,
      tags: [framework],
      responses: {
        "200": {
          description: "Success",
        },
      },
    };
  }

  return {
    openapi: "3.0.3",
    info: {
      title,
      version,
    },
    paths,
  };
}

function writeOpenApiFile(outPath: string, document: Record<string, unknown>): void {
  const outDir = path.dirname(outPath);
  fs.mkdirSync(outDir, { recursive: true });

  const ext = path.extname(outPath).toLowerCase();
  if (ext === ".yaml" || ext === ".yml") {
    fs.writeFileSync(outPath, `${dump(document, { noRefs: true })}`, "utf8");
    return;
  }

  fs.writeFileSync(outPath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
}

export function defaultExtractCommitMessage(from: SupportedFramework): string {
  return `feat(bridge): extract openapi contract from ${from}`;
}

export function runExtraction(
  options: ExtractOptions,
  shouldCommit: boolean,
  commitMessage?: string,
): ExtractResult {
  const from = resolveFramework(options.from, options.sourcePath);
  const endpoints =
    from === "laravel"
      ? extractFromLaravel(options.sourcePath)
      : uniqueByMethodPath([
          ...extractFromSymfony(options.sourcePath),
          ...extractApiPlatformFromSymfony(options.sourcePath, Boolean(options.usePhpAst)),
        ]);

  if (!endpoints.length) {
    throw new Error("Aucun endpoint detecte. Verifie les routes et controllers du projet source.");
  }

  const title = options.title ?? `Extracted ${from} API`;
  const version = options.version ?? "1.0.0";
  const doc = buildOpenApiDocument(from, endpoints, title, version);

  writeOpenApiFile(options.outPath, doc);

  const generatedFiles = [options.outPath];
  const actionLogFile = appendActionLog(options.sourcePath, "extract", {
    from,
    outPath: options.outPath,
    endpoints: endpoints.length,
  });
  generatedFiles.push(actionLogFile);

  if (!options.dryRun && shouldCommit) {
    const message = commitMessage ?? defaultExtractCommitMessage(from);
    commitGeneratedFiles(generatedFiles, message, options.sourcePath);
    return {
      from,
      outPath: options.outPath,
      endpoints: endpoints.length,
      generatedFiles,
      committed: true,
      commitMessage: message,
    };
  }

  return {
    from,
    outPath: options.outPath,
    endpoints: endpoints.length,
    generatedFiles,
    committed: false,
  };
}
