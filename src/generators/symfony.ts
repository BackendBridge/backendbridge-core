import fs from "node:fs";
import path from "node:path";
import { resolveRule, type MappingDocument } from "../mapping.js";
import type { ApiContract, EndpointContract, EndpointSchema } from "../types.js";
import { toStudly, ensureDir } from "../utils.js";

// ─── Schema → Symfony Assert constraints ─────────────────────────────────────

function schemaPropertyToAsserts(prop: EndpointSchema["properties"][string], required: boolean): string[] {
  const asserts: string[] = [];
  if (required) asserts.push("#[Assert\\NotBlank]");
  if (prop.nullable) asserts.push("// nullable");

  const type = prop.type ?? "string";
  if (prop.format === "email") asserts.push("#[Assert\\Email]");
  else if (prop.format === "uri") asserts.push("#[Assert\\Url]");
  else if (prop.format === "uuid") asserts.push("#[Assert\\Uuid]");
  else if (prop.format === "date") asserts.push("#[Assert\\Date]");
  else if (prop.format === "date-time") asserts.push("#[Assert\\DateTime]");

  const lengthArgs: string[] = [];
  if (prop.minLength !== undefined) lengthArgs.push(`min: ${prop.minLength}`);
  if (prop.maxLength !== undefined) lengthArgs.push(`max: ${prop.maxLength}`);
  if (lengthArgs.length) asserts.push(`#[Assert\\Length(${lengthArgs.join(", ")})]`);

  const rangeArgs: string[] = [];
  if (prop.minimum !== undefined) rangeArgs.push(`min: ${prop.minimum}`);
  if (prop.maximum !== undefined) rangeArgs.push(`max: ${prop.maximum}`);
  if (rangeArgs.length) asserts.push(`#[Assert\\Range(${rangeArgs.join(", ")})]`);

  if (prop.enum?.length) {
    const choices = prop.enum.map((v) => `'${v}'`).join(", ");
    asserts.push(`#[Assert\\Choice(choices: [${choices}])]`);
  }

  return asserts;
}

function phpTypeFromSchema(prop: EndpointSchema["properties"][string], required: boolean): string {
  const nullable = !required || prop.nullable ? "?" : "";
  const type = prop.type ?? "string";
  if (type === "integer") return `${nullable}int`;
  if (type === "number") return `${nullable}float`;
  if (type === "boolean") return `${nullable}bool`;
  if (type === "array") return `${nullable}array`;
  return `${nullable}string`;
}

function generateDtoClass(className: string, schema: EndpointSchema): string {
  const properties: string[] = [];

  for (const [field, prop] of Object.entries(schema.properties)) {
    const isRequired = schema.required?.includes(field) ?? false;
    const asserts = schemaPropertyToAsserts(prop, isRequired);
    const phpType = phpTypeFromSchema(prop, isRequired);
    const defaultVal = !isRequired || prop.nullable ? " = null" : "";

    for (const assert of asserts) {
      properties.push(`    ${assert}`);
    }
    properties.push(`    public ${phpType} $${field}${defaultVal};`);
    properties.push("");
  }

  return `<?php

namespace App\\Dto\\Generated;

use Symfony\\Component\\Validator\\Constraints as Assert;

class ${className}
{
${properties.join("\n")}
}
`;
}

// ─── Controller generator ─────────────────────────────────────────────────────

function buildControllerBody(
  endpoint: EndpointContract,
  dtoClass: string | null,
  rule: ReturnType<typeof resolveRule>,
): string {
  const authHint = rule?.auth?.length
    ? `        // Auth: ${rule.auth.join(", ")}\n        // $this->denyAccessUnlessGranted('VIEW', $resource);\n`
    : "";

  const pathParams = (endpoint.pathParameters ?? [])
    .filter((p) => p.in === "path")
    .map((p) => {
      const phpType = p.schema?.type === "integer" ? "int" : "string";
      return `        // Path param: $${p.name} (${phpType})`;
    })
    .join("\n");

  const dtoParam = dtoClass ? `#[MapRequestPayload] ${dtoClass} $payload` : "";
  const methodSig = `public function __invoke(${dtoParam}): JsonResponse`;

  return `    ${methodSig}
    {
${authHint}${pathParams ? pathParams + "\n" : ""}
        return $this->json([
            'status' => 'ok',
            'operation' => '${endpoint.operationId}',
        ]);
    }`;
}

function generateControllerClass(
  className: string,
  endpoint: EndpointContract,
  dtoClass: string | null,
  rule: ReturnType<typeof resolveRule>,
): string {
  const methodName = toStudly(endpoint.method.toLowerCase()) + toStudly(endpoint.operationId);
  const summaryLine = endpoint.summary ? ` * ${endpoint.summary}\n` : "";
  const mappingHints = [
    rule?.dto ? ` * DTO: ${rule.dto}` : undefined,
    rule?.validation?.length ? ` * Validation: ${rule.validation.join(", ")}` : undefined,
    rule?.auth?.length ? ` * Auth: ${rule.auth.join(", ")}` : undefined,
    rule?.notes ? ` * Notes: ${rule.notes}` : undefined,
  ].filter(Boolean).join("\n");

  const dtoImport = dtoClass
    ? `use App\\Dto\\Generated\\${dtoClass};\nuse Symfony\\Component\\HttpKernel\\Attribute\\MapRequestPayload;\n`
    : "";

  return `<?php

namespace App\\Controller\\Generated;

use Symfony\\Bundle\\FrameworkBundle\\Controller\\AbstractController;
use Symfony\\Component\\HttpFoundation\\JsonResponse;
use Symfony\\Component\\Routing\\Attribute\\Route;
${dtoImport}
class ${className} extends AbstractController
{
    /**
${summaryLine}     * Auto-generated by BackendBridge.
${mappingHints ? mappingHints + "\n" : ""}     */
    #[Route('${endpoint.path}', name: '${endpoint.operationId}', methods: ['${endpoint.method.toUpperCase()}'])]
${buildControllerBody(endpoint, dtoClass, rule)}
}
`;
}

// ─── Main generator ───────────────────────────────────────────────────────────

export function generateSymfonyFromContract(
  contract: ApiContract,
  outPath: string,
  mapping?: MappingDocument,
): string[] {
  const generatedFiles: string[] = [];
  const controllersDir = path.join(outPath, "src", "Controller", "Generated");
  const dtoDir = path.join(outPath, "src", "Dto", "Generated");

  ensureDir(controllersDir);

  for (const endpoint of contract.endpoints) {
    const className = `${toStudly(endpoint.operationId)}Controller`;
    const rule = resolveRule(mapping, endpoint.method, endpoint.path, endpoint.operationId);

    // Generate DTO if there is a requestBody schema
    let dtoClass: string | null = null;
    const bodySchema = endpoint.requestBodySchema;
    if (bodySchema && Object.keys(bodySchema.properties).length > 0 && ["post", "put", "patch"].includes(endpoint.method)) {
      dtoClass = `${toStudly(endpoint.operationId)}Dto`;
      const dtoContent = generateDtoClass(dtoClass, bodySchema);
      const dtoPath = path.join(dtoDir, `${dtoClass}.php`);
      ensureDir(dtoDir);
      fs.writeFileSync(dtoPath, dtoContent, "utf8");
      generatedFiles.push(dtoPath);
    }

    // Generate controller
    const controllerContent = generateControllerClass(className, endpoint, dtoClass, rule);
    const controllerPath = path.join(controllersDir, `${className}.php`);
    fs.writeFileSync(controllerPath, controllerContent, "utf8");
    generatedFiles.push(controllerPath);
  }

  return generatedFiles;
}
