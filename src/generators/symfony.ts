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

function entityName(operationId: string, tags?: string[]): string {
  if (tags?.length) return toStudly(tags[0]);
  return (
    toStudly(operationId.replace(/^(create|update|delete|get|list|show|fetch|index)_?/i, "")) ||
    toStudly(operationId)
  );
}

// ─── Schema → Symfony Assert constraints ─────────────────────────────────────

function schemaPropertyToAsserts(prop: EndpointSchema["properties"][string], required: boolean): string[] {
  const asserts: string[] = [];

  if (prop.type === "array" && prop.items?.format === "binary") {
    if (required) asserts.push("#[Assert\\NotNull]");
    asserts.push("#[Assert\\All([new Assert\\File(maxSize: '10M')])]");
    return asserts;
  }

  if (prop.format === "binary") {
    if (required) asserts.push("#[Assert\\NotNull]");
    asserts.push("#[Assert\\File(maxSize: '10M')]");
    return asserts;
  }

  if (required) asserts.push("#[Assert\\NotBlank]");
  if (prop.nullable) asserts.push("// nullable");

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
  entity: string,
): string {
  const hasFileUpload = Object.values(endpoint.requestBodySchema?.properties ?? {}).some(
    (p) => p.format === "binary" || (p.type === "array" && p.items?.format === "binary"),
  );
  const hasMultiUpload = Object.values(endpoint.requestBodySchema?.properties ?? {}).some(
    (p) => p.type === "array" && p.items?.format === "binary",
  );
  const hasSingleFileUpload = Object.values(endpoint.requestBodySchema?.properties ?? {}).some(
    (p) => p.format === "binary",
  );

  const isWrite = ["post", "put", "patch"].includes(endpoint.method);
  const isDelete = endpoint.method === "delete";
  const isList = isListEndpoint(endpoint);
  const isShow = isShowEndpoint(endpoint);

  // Param signature
  let dtoParam: string;
  if (hasFileUpload || !dtoClass) {
    dtoParam = "Request $request";
  } else {
    dtoParam = `#[MapRequestPayload] ${dtoClass} $payload`;
  }

  let innerBody = "";

  // Auth
  if (rule?.auth?.length) {
    innerBody += `            // Auth (mapping): ${rule.auth.join(", ")}\n`;
    innerBody += `            // $this->denyAccessUnlessGranted('VIEW', null);\n`;
  } else if (endpoint.security?.length) {
    innerBody += `            // Auth (${endpoint.security.join(", ")}): $user = $this->getUser();\n`;
    innerBody += `            // if (!$user) throw $this->createAccessDeniedException();\n`;
  }

  // Path & query params
  const pathParams = (endpoint.pathParameters ?? [])
    .filter((p) => p.in === "path")
    .map((p) => {
      const phpType = p.schema?.type === "integer" ? "int" : "string";
      return `            // Path: $${p.name} (${phpType})`;
    })
    .join("\n");
  const queryParams = (endpoint.pathParameters ?? [])
    .filter((p) => p.in === "query")
    .map((p) => `            // Query: $request->query->get('${p.name}')${p.required ? "" : " // optional"}`)
    .join("\n");

  if (pathParams) innerBody += pathParams + "\n";
  if (queryParams) innerBody += queryParams + "\n";

  if (isList) {
    innerBody += `            $repository = $this->em->getRepository(${entity}::class);\n`;
    innerBody += `            $qb = $repository->createQueryBuilder('e');\n`;
    innerBody += `            // Add filters: ->where('e.user = :user')->setParameter('user', $this->getUser())\n`;
    innerBody += `            $page = $request->query->getInt('page', 1);\n`;
    innerBody += `            $limit = $request->query->getInt('per_page', 15);\n`;
    innerBody += `            $results = $qb->setFirstResult(($page - 1) * $limit)->setMaxResults($limit)->getQuery()->getResult();\n`;
    innerBody += `            return $this->json($results);\n`;
  } else if (isShow) {
    const idParam = (endpoint.pathParameters ?? []).find((p) => p.in === "path")?.name ?? "id";
    innerBody += `            $entity = $this->em->getRepository(${entity}::class)->find($${idParam});\n`;
    innerBody += `            if (!$entity) { throw $this->createNotFoundException('${entity} not found'); }\n`;
    innerBody += `            return $this->json($entity);\n`;
  } else if (isWrite) {
    innerBody += `            $this->em->beginTransaction();\n`;
    innerBody += `            try {\n`;
    if (endpoint.method === "post") {
      innerBody += `                $entity = new ${entity}();\n`;
    } else {
      const idParam = (endpoint.pathParameters ?? []).find((p) => p.in === "path")?.name ?? "id";
      innerBody += `                $entity = $this->em->getRepository(${entity}::class)->find($${idParam});\n`;
      innerBody += `                if (!$entity) { throw $this->createNotFoundException('${entity} not found'); }\n`;
    }
    if (dtoClass && !hasFileUpload) {
      innerBody += `                // Map DTO to entity: $entity->setTitle($payload->title);\n`;
    } else {
      innerBody += `                // Map request to entity from $request->request->all()\n`;
    }
    innerBody += `                $this->em->persist($entity);\n`;
    innerBody += `                $this->em->flush();\n`;
    innerBody += `                $this->em->commit();\n`;
    innerBody += `                return $this->json($entity, ${endpoint.method === "post" ? "201" : "200"});\n`;
    innerBody += `            } catch (\\Throwable $e) {\n`;
    innerBody += `                $this->em->rollback();\n`;
    innerBody += `                throw $e;\n`;
    innerBody += `            }\n`;
  } else if (isDelete) {
    const idParam = (endpoint.pathParameters ?? []).find((p) => p.in === "path")?.name ?? "id";
    innerBody += `            $entity = $this->em->getRepository(${entity}::class)->find($${idParam});\n`;
    innerBody += `            if (!$entity) { throw $this->createNotFoundException('${entity} not found'); }\n`;
    innerBody += `            $this->em->remove($entity);\n`;
    innerBody += `            $this->em->flush();\n`;
    innerBody += `            return $this->json(null, 204);\n`;
  }

  if (hasSingleFileUpload) innerBody += `            // Single upload: $file = $request->files->get('field'); $file->move($targetDir, $filename);\n`;
  if (hasMultiUpload) innerBody += `            // Multiple uploads: foreach ($request->files->get('photos') as $f) { $f->move($dir, $f->getClientOriginalName()); }\n`;

  if (!isList && !isShow && !isWrite && !isDelete) {
    innerBody += `            return $this->json(['status' => 'ok', 'operation' => '${endpoint.operationId}']);\n`;
  }

  return `    public function __invoke(${dtoParam}): JsonResponse
    {
        try {
${innerBody}        } catch (\\Symfony\\Component\\HttpKernel\\Exception\\NotFoundHttpException $e) {
            return $this->json(['message' => $e->getMessage()], 404);
        } catch (\\Symfony\\Component\\HttpKernel\\Exception\\AccessDeniedHttpException $e) {
            return $this->json(['message' => 'Access denied'], 403);
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
  entity: string,
): string {
  const summaryLine = endpoint.summary ? ` * ${endpoint.summary}\n` : "";
  const descLine = endpoint.description ? ` * ${endpoint.description.replace(/\n/g, "\n * ")}\n` : "";
  const deprecatedLine = endpoint.deprecated ? ` * @deprecated\n` : "";
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
      : "use Symfony\\Component\\HttpFoundation\\Request;\n";

  const entityImport = `use App\\Entity\\${entity};\n`;
  const emImport = `use Doctrine\\ORM\\EntityManagerInterface;\n`;

  const needsRequest = hasFileUpload || !dtoClass || isListEndpoint(endpoint);

  return `<?php

namespace App\\Controller\\Generated;

use Symfony\\Bundle\\FrameworkBundle\\Controller\\AbstractController;
use Symfony\\Component\\HttpFoundation\\JsonResponse;
use Symfony\\Component\\Routing\\Attribute\\Route;
${needsRequest ? "use Symfony\\Component\\HttpFoundation\\Request;\n" : ""}${dtoClass && !hasFileUpload ? `use App\\Dto\\Generated\\${dtoClass};\nuse Symfony\\Component\\HttpKernel\\Attribute\\MapRequestPayload;\n` : ""}${entityImport}${emImport}
class ${className} extends AbstractController
{
    public function __construct(private readonly EntityManagerInterface $em) {}

    /**
${summaryLine}${descLine}${deprecatedLine}     * Auto-generated by BackendBridge.
${mappingHints ? mappingHints + "\n" : ""}     */
    #[Route('${endpoint.path}', name: '${endpoint.operationId}', methods: ['${endpoint.method.toUpperCase()}'])]
${buildControllerBody(endpoint, dtoClass, rule, entity)}
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
    const entity = entityName(endpoint.operationId, endpoint.tags);

    // DTO for write endpoints
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

    // Controller
    const controllerContent = generateControllerClass(className, endpoint, dtoClass, rule, entity);
    const controllerPath = path.join(controllersDir, `${className}.php`);
    fs.writeFileSync(controllerPath, controllerContent, "utf8");
    generatedFiles.push(controllerPath);
  }

  return generatedFiles;
}
