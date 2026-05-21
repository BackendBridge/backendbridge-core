import fs from "node:fs";
import path from "node:path";
import { resolveRule, type MappingDocument } from "../mapping.js";
import type { ApiContract, EndpointContract, EndpointSchema } from "../types.js";
import { toStudly, ensureDir } from "../utils.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isListEndpoint(endpoint: EndpointContract): boolean {
  return endpoint.method === "get" && !/\{[^}]+\}$/.test(endpoint.path.trimEnd());
}

function isShowEndpoint(endpoint: EndpointContract): boolean {
  return endpoint.method === "get" && /\{[^}]+\}/.test(endpoint.path);
}

function entityName(operationId: string): string {
  return toStudly(operationId.replace(/^(get|list|show|fetch|index)_?/i, "")) || toStudly(operationId);
}

// ─── Schema → Symfony Assert constraints ─────────────────────────────────────

function schemaPropertyToAsserts(prop: EndpointSchema["properties"][string], required: boolean): string[] {
  const asserts: string[] = [];

  // Multiple file uploads: type:array, items.format:binary
  if (prop.type === "array" && prop.items?.format === "binary") {
    if (required) asserts.push("#[Assert\\NotNull]");
    asserts.push("#[Assert\\All([new Assert\\File(maxSize: '10M')])]");
    return asserts;
  }

  // Single file upload
  if (prop.format === "binary") {
    if (required) asserts.push("#[Assert\\NotNull]");
    asserts.push("#[Assert\\File(maxSize: '10M')]");
    return asserts;
  }

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
  if (prop.type === "array" && prop.items?.format === "binary") return `${nullable}array`;
  if (prop.format === "binary") return `${nullable}UploadedFile`;
  const type = prop.type ?? "string";
  if (type === "integer") return `${nullable}int`;
  if (type === "number") return `${nullable}float`;
  if (type === "boolean") return `${nullable}bool`;
  if (type === "array") return `${nullable}array`;
  return `${nullable}string`;
}

function generateDtoClass(className: string, schema: EndpointSchema): string {
  const properties: string[] = [];
  const hasFileField = Object.values(schema.properties).some((p) => p.format === "binary");

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

  const fileImport = hasFileField
    ? "use Symfony\\Component\\HttpFoundation\\File\\UploadedFile;\n"
    : "";

  return `<?php

namespace App\\Dto\\Generated;

use Symfony\\Component\\Validator\\Constraints as Assert;
${fileImport}
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
    ? `            // Auth: ${rule.auth.join(", ")}\n            // $this->denyAccessUnlessGranted('VIEW', $resource);\n`
    : "";

  const hasFileUpload = Object.values(endpoint.requestBodySchema?.properties ?? {}).some(
    (p) => p.format === "binary" || (p.type === "array" && p.items?.format === "binary"),
  );

  const pathParams = (endpoint.pathParameters ?? [])
    .filter((p) => p.in === "path")
    .map((p) => {
      const phpType = p.schema?.type === "integer" ? "int" : "string";
      return `            // Path param: $${p.name} (${phpType})`;
    })
    .join("\n");

  const isWrite = ["post", "put", "patch"].includes(endpoint.method);
  const isDelete = endpoint.method === "delete";
  const isList = isListEndpoint(endpoint);
  const isShow = isShowEndpoint(endpoint);
  const entity = entityName(endpoint.operationId);

  const hasMultiUpload = Object.values(endpoint.requestBodySchema?.properties ?? {}).some(
    (p) => p.type === "array" && p.items?.format === "binary",
  );

  // MapRequestPayload doesn't handle file uploads — fall back to Request for those cases
  let dtoParam: string;
  if (hasFileUpload || !dtoClass) {
    dtoParam = "Request $request";
  } else {
    dtoParam = `#[MapRequestPayload] ${dtoClass} $payload`;
  }

  let innerBody = "";
  if (authHint) innerBody += authHint;
  if (pathParams) innerBody += pathParams + "\n";

  if (isList) {
    innerBody += `            // List with pagination (requires knplabs/knp-paginator-bundle)\n`;
    innerBody += `            // $query = $em->getRepository(${entity}::class)->createQueryBuilder('e')->getQuery();\n`;
    innerBody += `            // $pagination = $paginator->paginate($query, $request->query->getInt('page', 1), 15);\n`;
    innerBody += `            // return $this->json($pagination);\n`;
  } else if (isShow) {
    innerBody += `            // $entity = $em->getRepository(${entity}::class)->find($id);\n`;
    innerBody += `            // if (!$entity) { throw $this->createNotFoundException('${entity} not found'); }\n`;
    innerBody += `            // return $this->json($entity);\n`;
  } else if (isWrite) {
    innerBody += `            // $em->beginTransaction();\n`;
    innerBody += `            // try {\n`;
    innerBody += `            //     $entity = new ${entity}();\n`;
    innerBody += `            //     // TODO: map $payload properties to $entity\n`;
    innerBody += `            //     $em->persist($entity);\n`;
    innerBody += `            //     $em->flush();\n`;
    innerBody += `            //     $em->commit();\n`;
    innerBody += `            //     return $this->json($entity, ${endpoint.method === "post" ? "201" : "200"});\n`;
    innerBody += `            // } catch (\\Throwable $e) { $em->rollback(); throw $e; }\n`;
    innerBody += `            // Inject: private EntityManagerInterface $em\n`;
  } else if (isDelete) {
    innerBody += `            // $entity = $em->getRepository(${entity}::class)->find($id);\n`;
    innerBody += `            // if (!$entity) { throw $this->createNotFoundException('${entity} not found'); }\n`;
    innerBody += `            // $em->remove($entity); $em->flush();\n`;
    innerBody += `            // return $this->json(null, 204);\n`;
  }

  if (hasFileUpload && !hasMultiUpload) {
    innerBody += `            // Single upload : $file = $request->files->get('field'); $file->move($targetDir, $filename);\n`;
  }
  if (hasMultiUpload) {
    innerBody += `            // Multiple uploads: foreach ($request->files->get('photos') as $f) { $f->move($dir, $f->getClientOriginalName()); }\n`;
  }

  innerBody += `\n`;
  innerBody += `            // Session : $session = $request->getSession(); $session->get('key') / set('key', val) / remove('key')\n`;
  innerBody += `            // Cookie  : $response->headers->setCookie(new Cookie('name', 'value', time() + 3600));\n`;
  innerBody += `            // JWT     : $user = $this->getUser(); // requires lexik/jwt-authentication-bundle\n`;
  innerBody += `\n`;
  innerBody += `            return $this->json(['status' => 'ok', 'operation' => '${endpoint.operationId}']);`;

  return `    public function __invoke(${dtoParam}): JsonResponse
    {
        try {
${innerBody}
        } catch (\\Symfony\\Component\\HttpKernel\\Exception\\NotFoundHttpException $e) {
            return $this->json(['message' => $e->getMessage()], 404);
        } catch (\\Symfony\\Component\\Validator\\Exception\\ValidationFailedException $e) {
            return $this->json(['message' => 'Validation failed', 'errors' => (string) $e->getViolations()], 422);
        } catch (\\Throwable $e) {
            return $this->json(['message' => 'Server error'], 500);
        }
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

  const hasFileUpload = Object.values(endpoint.requestBodySchema?.properties ?? {}).some(
    (p) => p.format === "binary" || (p.type === "array" && p.items?.format === "binary"),
  );

  const dtoImport = dtoClass && !hasFileUpload
    ? `use App\\Dto\\Generated\\${dtoClass};\nuse Symfony\\Component\\HttpKernel\\Attribute\\MapRequestPayload;\n`
    : hasFileUpload
      ? "use Symfony\\Component\\HttpFoundation\\Request;\n"
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
