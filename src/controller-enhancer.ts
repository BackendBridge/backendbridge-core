/**
 * Controller enhancer — injects translated source logic into generated controllers.
 *
 * After the standard scaffold generation, this module:
 * 1. Calls parse_method_bodies.php to extract source controller method bodies
 * 2. Maps source methods to generated controller files (by HTTP method + resource)
 * 3. Translates the PHP code using logic-translator.ts
 * 4. Replaces the placeholder comments in generated files with the translated logic
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { SupportedFramework } from "./types.js";
import { translatePhpBody, formatTranslatedBlock } from "./logic-translator.js";
import { parseMethodBodies as parseMethodBodiesEmbedded } from "./php-scripts.generated.js";

// ─── HTTP method → typical CRUD method names ──────────────────────────────────

const HTTP_TO_LARAVEL_METHODS: Record<string, string[]> = {
  get:    ["index", "show"],
  post:   ["store", "create"],
  put:    ["update"],
  patch:  ["update"],
  delete: ["destroy", "delete"],
};

const HTTP_TO_SYMFONY_METHODS: Record<string, string[]> = {
  get:    ["index", "show", "list"],
  post:   ["create", "new", "store"],
  put:    ["update", "edit"],
  patch:  ["update", "edit"],
  delete: ["delete", "remove", "destroy"],
};

// ─── PHP extraction ───────────────────────────────────────────────────────────

interface MethodBody {
  file: string;
  class: string;
  method: string;
  params: string[];
  body: string;
}

function resolvePhpScript(name: string, embedded: string): string {
  try {
    const candidate = new URL(`../tools/${name}`, import.meta.url).pathname;
    if (candidate && fs.existsSync(candidate)) return candidate;
  } catch {
    // SEA build — fall through
  }
  const tmp = path.join(os.tmpdir(), `bb-${name}`);
  fs.writeFileSync(tmp, embedded, "utf8");
  return tmp;
}

function extractMethodBodies(
  framework: SupportedFramework,
  sourcePath: string,
): MethodBody[] {
  try {
    const script = resolvePhpScript("parse_method_bodies.php", parseMethodBodiesEmbedded);
    const out = execFileSync("php", [script, framework, sourcePath], {
      encoding: "utf8",
      timeout: 30_000,
    });
    const parsed = JSON.parse(out);
    if (parsed && parsed.error) return [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// ─── Matching logic ───────────────────────────────────────────────────────────

function resourceFromPath(routePath: string): string {
  // /posts → "post", /posts/{id} → "post"
  const seg = routePath.split("/").filter((s) => s && !s.startsWith("{"))[0] ?? "";
  return seg.replace(/s$/, "").toLowerCase();  // naive singularize
}

function findSourceMethod(
  methods: MethodBody[],
  from: SupportedFramework,
  httpMethod: string,
  routePath: string,
  hasPathParam: boolean,
): MethodBody | undefined {
  const resource = resourceFromPath(routePath);

  // Candidate CRUD method names for this HTTP method
  const candidateNames = (from === "laravel" ? HTTP_TO_LARAVEL_METHODS : HTTP_TO_SYMFONY_METHODS)[
    httpMethod.toLowerCase()
  ] ?? [];

  // Narrow: for GET with path param → show; GET without → index/list
  let narrowed = candidateNames;
  if (httpMethod.toLowerCase() === "get") {
    narrowed = hasPathParam ? ["show"] : ["index", "list"];
  }

  // Find controller matching the resource + method
  return methods.find((m) => {
    const classLower = m.class.toLowerCase();
    const classMatchesResource = classLower.includes(resource) || classLower.includes(`${resource}s`);
    const methodMatches = narrowed.includes(m.method.toLowerCase());
    return classMatchesResource && methodMatches;
  });
}

// ─── File injection ───────────────────────────────────────────────────────────

function injectIntoFile(
  filePath: string,
  translatedBlock: string,
  from: SupportedFramework,
): boolean {
  let content = fs.readFileSync(filePath, "utf8");

  // Look for the placeholder try body: "try {\n        // TODO:" or similar
  const todoPattern = /try \{[\s\n]+\/\/ TODO:[^\n]*\n[^}]*?\}/;

  if (!todoPattern.test(content)) return false;

  // Replace the first TODO block with translated logic inside try{}
  content = content.replace(todoPattern, (match) => {
    const tryBrace = "try {";
    const catchIdx = match.lastIndexOf("}");
    const inner = `${tryBrace}\n${translatedBlock}\n        }`;
    return inner;
  });

  fs.writeFileSync(filePath, content, "utf8");
  return true;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export interface EnhancementSummary {
  enhanced: number;
  skipped: number;
  warnings: string[];
}

export function enhanceControllersWithSourceLogic(
  sourcePath: string,
  from: SupportedFramework,
  to: SupportedFramework,
  generatedOutPath: string,
): EnhancementSummary {
  const summary: EnhancementSummary = { enhanced: 0, skipped: 0, warnings: [] };

  // Determine source controller directory
  const sourceCtrlDir = from === "laravel"
    ? path.join(sourcePath, "app", "Http", "Controllers")
    : path.join(sourcePath, "src", "Controller");

  if (!fs.existsSync(sourceCtrlDir)) return summary;

  // Extract source method bodies
  const sourceMethods = extractMethodBodies(from, sourceCtrlDir);
  if (!sourceMethods.length) return summary;

  // Find generated controller directory
  const generatedCtrlDir = to === "laravel"
    ? path.join(generatedOutPath, "app", "Http", "Controllers", "Generated")
    : path.join(generatedOutPath, "src", "Controller", "Generated");

  if (!fs.existsSync(generatedCtrlDir)) return summary;

  // Process each generated controller file
  for (const file of fs.readdirSync(generatedCtrlDir)) {
    if (!file.endsWith("Controller.php")) continue;

    const filePath = path.join(generatedCtrlDir, file);
    const content = fs.readFileSync(filePath, "utf8");

    // Parse the generated file to determine which HTTP method + path it handles
    // Class name pattern: {Method}{Resource}Controller — e.g. GetPostsController
    const classMatch = file.replace("Controller.php", "");
    const httpVerbs = ["Get", "Post", "Put", "Patch", "Delete"];
    const httpVerb = httpVerbs.find((v) => classMatch.startsWith(v));
    if (!httpVerb) { summary.skipped++; continue; }

    const httpMethod = httpVerb.toLowerCase();
    const resourcePart = classMatch.slice(httpVerb.length).toLowerCase(); // "posts", "comments", etc.
    const hasPathParam = content.includes("{id}") || content.includes("$id");

    // Find matching source method
    const sourceMethod = findSourceMethod(
      sourceMethods,
      from,
      httpMethod,
      `/${resourcePart}`,
      hasPathParam,
    );

    if (!sourceMethod || !sourceMethod.body.trim()) {
      summary.skipped++;
      continue;
    }

    // Translate the body
    const translated = translatePhpBody(sourceMethod.body, from, to);
    const block = formatTranslatedBlock(
      sourceMethod.body,
      translated,
      from,
      sourceMethod.method,
    );

    // Inject into generated file
    const injected = injectIntoFile(filePath, block, from);
    if (injected) {
      summary.enhanced++;
      summary.warnings.push(...translated.warnings.map((w) => `[${file}] ${w}`));
    } else {
      summary.skipped++;
    }
  }

  return summary;
}
