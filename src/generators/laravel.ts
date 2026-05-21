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

function resourceName(operationId: string, tags?: string[]): string {
  // Prefer the first tag as resource name
  if (tags?.length) return toStudly(tags[0]);
  return (
    toStudly(operationId.replace(/^(create|update|delete|get|list|show|fetch|index)_?/i, "")) ||
    toStudly(operationId)
  );
}

function modelName(operationId: string, tags?: string[]): string {
  return resourceName(operationId, tags);
}

// ─── Schema → Laravel validation rules ───────────────────────────────────────

function schemaPropertyToRules(name: string, prop: EndpointSchema["properties"][string], required: boolean): string {
  if (prop.type === "array" && prop.items?.format === "binary") {
    const isImage = /photo|image|avatar|picture|thumbnail|cover/i.test(name);
    const itemMimes = isImage ? "image|mimes:jpg,jpeg,png,gif,webp|max:5120" : "file|mimes:pdf,doc,docx,zip,jpg,jpeg,png|max:10240";
    return [
      `            '${name}' => '${required ? "required" : "nullable"}|array',`,
      `            '${name}.*' => '${itemMimes}',`,
    ].join("\n");
  }

  if (prop.format === "binary") {
    const fileRules: string[] = [required ? "required" : "nullable", "file"];
    const isImage = /photo|image|avatar|picture|thumbnail|cover/i.test(name);
    if (isImage) fileRules.push("image", "mimes:jpg,jpeg,png,gif,webp", "max:5120");
    else fileRules.push("mimes:pdf,doc,docx,xls,xlsx,zip,jpg,jpeg,png", "max:10240");
    return `            '${name}' => '${fileRules.join("|")}',`;
  }

  const rules: string[] = [];
  if (required) rules.push("required"); else rules.push("sometimes");
  if (prop.nullable) rules.push("nullable");

  const type = prop.type ?? "string";
  if (type === "integer") rules.push("integer");
  else if (type === "number") rules.push("numeric");
  else if (type === "boolean") rules.push("boolean");
  else if (type === "array") rules.push("array");
  else rules.push("string");

  if (prop.format === "email") rules.push("email");
  else if (prop.format === "uri") rules.push("url");
  else if (prop.format === "date") rules.push("date");
  else if (prop.format === "date-time") rules.push("date");
  else if (prop.format === "uuid") rules.push("uuid");

  if (prop.minLength !== undefined) rules.push(`min:${prop.minLength}`);
  if (prop.maxLength !== undefined) rules.push(`max:${prop.maxLength}`);
  if (prop.minimum !== undefined) rules.push(`min:${prop.minimum}`);
  if (prop.maximum !== undefined) rules.push(`max:${prop.maximum}`);
  if (prop.enum?.length) rules.push(`in:${prop.enum.join(",")}`);

  return `            '${name}' => '${rules.join("|")}',`;
}

// ─── JsonResource generator ───────────────────────────────────────────────────

function phpTypeForProp(prop: EndpointSchema["properties"][string]): string {
  if (prop.type === "integer") return "int";
  if (prop.type === "number") return "float";
  if (prop.type === "boolean") return "bool";
  if (prop.type === "array") return "array";
  return "string";
}

function generateJsonResource(resourceClass: string, responseSchema?: EndpointSchema): string {
  let fields: string;
  if (responseSchema && Object.keys(responseSchema.properties).length > 0) {
    const lines = Object.entries(responseSchema.properties).map(([field, prop]) => {
      const cast = phpTypeForProp(prop);
      return `            '${field}' => (${cast}) $this->${field},`;
    });
    fields = lines.join("\n");
  } else {
    fields = [
      `            'id'         => $this->id,`,
      `            // Add fields matching your model attributes`,
      `            'created_at' => $this->created_at,`,
      `            'updated_at' => $this->updated_at,`,
    ].join("\n");
  }

  return `<?php

namespace App\\Http\\Resources\\Generated;

use Illuminate\\Http\\Request;
use Illuminate\\Http\\Resources\\Json\\JsonResource;

class ${resourceClass} extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
${fields}
        ];
    }
}
`;
}

// ─── FormRequest generator ────────────────────────────────────────────────────

function generateFormRequestClass(className: string, schema: EndpointSchema, securitySchemes?: string[]): string {
  const rulesLines = Object.entries(schema.properties).map(([field, prop]) => {
    const isRequired = schema.required?.includes(field) ?? false;
    return schemaPropertyToRules(field, prop, isRequired);
  });

  const authHint = securitySchemes?.length
    ? `\n    public function authorize(): bool\n    {\n        // Auth: ${securitySchemes.join(", ")}\n        return auth()->check();\n    }`
    : `\n    public function authorize(): bool\n    {\n        return true;\n    }`;

  return `<?php

namespace App\\Http\\Requests\\Generated;

use Illuminate\\Foundation\\Http\\FormRequest;

class ${className} extends FormRequest
{${authHint}

    public function rules(): array
    {
        return [
${rulesLines.join("\n")}
        ];
    }
}
`;
}

// ─── Controller generator ─────────────────────────────────────────────────────

function buildControllerBody(
  endpoint: EndpointContract,
  formRequestClass: string | null,
  rule: ReturnType<typeof resolveRule>,
  model: string,
  resourceClass: string | null,
): string {
  const hasFileUpload = Object.values(endpoint.requestBodySchema?.properties ?? {}).some(
    (p) => p.format === "binary" || (p.type === "array" && p.items?.format === "binary"),
  );

  const requestParam = formRequestClass ? `${formRequestClass} $request` : `Request $request`;

  const isWrite = ["post", "put", "patch"].includes(endpoint.method);
  const isDelete = endpoint.method === "delete";
  const isList = isListEndpoint(endpoint);
  const isShow = isShowEndpoint(endpoint);

  let innerBody = "";

  // Auth hint from mapping rule OR from OpenAPI security
  if (rule?.auth?.length) {
    innerBody += `            // Auth (mapping): ${rule.auth.join(", ")}\n`;
    innerBody += `            // $this->authorize('view', ${model}::class);\n`;
  } else if (endpoint.security?.length) {
    innerBody += `            // Auth (${endpoint.security.join(", ")}): $user = auth('api')->user();\n`;
    innerBody += `            // if (!$user) return response()->json(['message' => 'Unauthenticated'], 401);\n`;
  }

  // Path & query params
  const pathParams = (endpoint.pathParameters ?? [])
    .filter((p) => p.in === "path")
    .map((p) => `            // Path: $${p.name} (${p.schema?.type ?? "string"})`)
    .join("\n");
  const queryParams = (endpoint.pathParameters ?? [])
    .filter((p) => p.in === "query")
    .map((p) => `            // Query: $request->query('${p.name}')${p.required ? "" : " // optional"}`)
    .join("\n");

  if (pathParams) innerBody += pathParams + "\n";
  if (queryParams) innerBody += queryParams + "\n";

  if (isList) {
    innerBody += `            $items = ${model}::query()\n`;
    innerBody += `                // ->where('user_id', auth()->id()) // scope to current user\n`;
    innerBody += `                ->paginate($request->integer('per_page', 15));\n`;
    innerBody += `            return ${resourceClass ?? model + "Resource"}::collection($items);\n`;
  } else if (isShow) {
    const idParam = (endpoint.pathParameters ?? []).find((p) => p.in === "path")?.name ?? "id";
    innerBody += `            $model = ${model}::findOrFail($${idParam});\n`;
    innerBody += `            return new ${resourceClass ?? model + "Resource"}($model);\n`;
  } else if (isWrite) {
    innerBody += `            $validated = $request->validated();\n`;
    innerBody += `            \\DB::beginTransaction();\n`;
    innerBody += `            try {\n`;
    if (endpoint.method === "post") {
      innerBody += `                $model = ${model}::create($validated);\n`;
    } else {
      const idParam = (endpoint.pathParameters ?? []).find((p) => p.in === "path")?.name ?? "id";
      innerBody += `                $model = ${model}::findOrFail($${idParam});\n`;
      innerBody += `                $model->update($validated);\n`;
    }
    innerBody += `                \\DB::commit();\n`;
    innerBody += `                return new ${resourceClass ?? model + "Resource"}($model);\n`;
    innerBody += `            } catch (\\Throwable $e) {\n`;
    innerBody += `                \\DB::rollBack();\n`;
    innerBody += `                throw $e;\n`;
    innerBody += `            }\n`;
  } else if (isDelete) {
    const idParam = (endpoint.pathParameters ?? []).find((p) => p.in === "path")?.name ?? "id";
    innerBody += `            $model = ${model}::findOrFail($${idParam});\n`;
    innerBody += `            $model->delete();\n`;
    innerBody += `            return response()->json(null, 204);\n`;
  }

  const hasSingleFileUpload = Object.values(endpoint.requestBodySchema?.properties ?? {}).some(
    (p) => p.format === "binary",
  );
  const hasMultiUpload = Object.values(endpoint.requestBodySchema?.properties ?? {}).some(
    (p) => p.type === "array" && p.items?.format === "binary",
  );
  if (hasSingleFileUpload) innerBody += `            // Single upload : $file = $request->file('field'); $path = $file->store('uploads', 'public');\n`;
  if (hasMultiUpload) innerBody += `            // Multiple uploads: foreach ($request->file('photos') as $f) { $f->store('uploads', 'public'); }\n`;

  if (!isList && !isShow && !isWrite && !isDelete) {
    innerBody += `            return response()->json(['status' => 'ok', 'operation' => '${endpoint.operationId}']);\n`;
  }

  return `    public function __invoke(${requestParam}): JsonResponse
    {
        try {
${innerBody}        } catch (\\Illuminate\\Database\\Eloquent\\ModelNotFoundException) {
            return response()->json(['message' => 'Not found'], 404);
        } catch (\\Illuminate\\Validation\\ValidationException $e) {
            return response()->json(['message' => 'Unprocessable', 'errors' => $e->errors()], 422);
        } catch (\\Throwable $e) {
            report($e);
            return response()->json(['message' => 'Server error'], 500);
        }
    }`;
}

function generateControllerClass(
  className: string,
  endpoint: EndpointContract,
  formRequestClass: string | null,
  rule: ReturnType<typeof resolveRule>,
  resourceClass: string | null,
  model: string,
): string {
  const summaryLine = endpoint.summary ? ` * ${endpoint.summary}\n` : "";
  const deprecatedLine = endpoint.deprecated ? ` * @deprecated\n` : "";
  const descLine = endpoint.description ? ` * ${endpoint.description.replace(/\n/g, "\n * ")}\n` : "";
  const mappingHints = [
    rule?.dto ? ` * DTO: ${rule.dto}` : undefined,
    rule?.auth?.length ? ` * Auth: ${rule.auth.join(", ")}` : undefined,
    rule?.notes ? ` * Notes: ${rule.notes}` : undefined,
  ].filter(Boolean).join("\n");

  const requestImport = formRequestClass ? `use App\\Http\\Requests\\Generated\\${formRequestClass};\n` : "";
  const resourceImport = resourceClass ? `use App\\Http\\Resources\\Generated\\${resourceClass};\n` : "";
  const dbImport = ["post", "put", "patch"].includes(endpoint.method) || endpoint.method === "delete"
    ? `use Illuminate\\Support\\Facades\\DB;\n`
    : "";
  const modelImport = `use App\\Models\\${model};\n`;

  return `<?php

namespace App\\Http\\Controllers\\Generated;

use App\\Http\\Controllers\\Controller;
use Illuminate\\Http\\JsonResponse;
${formRequestClass ? "" : "use Illuminate\\Http\\Request;\n"}${requestImport}${resourceImport}${modelImport}${dbImport}
class ${className} extends Controller
{
    /**
${summaryLine}${descLine}${deprecatedLine}     * Auto-generated by BackendBridge.
${mappingHints ? mappingHints + "\n" : ""}     */
${buildControllerBody(endpoint, formRequestClass, rule, model, resourceClass)}
}
`;
}

// ─── Main generator ───────────────────────────────────────────────────────────

export function generateLaravelFromContract(
  contract: ApiContract,
  outPath: string,
  mapping?: MappingDocument,
): string[] {
  const generatedFiles: string[] = [];
  const controllersDir = path.join(outPath, "app", "Http", "Controllers", "Generated");
  const requestsDir = path.join(outPath, "app", "Http", "Requests", "Generated");
  const resourcesDir = path.join(outPath, "app", "Http", "Resources", "Generated");
  const routesDir = path.join(outPath, "routes");

  ensureDir(controllersDir);
  ensureDir(routesDir);

  const routeLines: string[] = [
    "<?php",
    "",
    "use Illuminate\\Support\\Facades\\Route;",
    "",
  ];

  const generatedResources = new Set<string>();

  for (const endpoint of contract.endpoints) {
    const className = `${toStudly(endpoint.operationId)}Controller`;
    const rule = resolveRule(mapping, endpoint.method, endpoint.path, endpoint.operationId);
    const model = modelName(endpoint.operationId, endpoint.tags);

    // FormRequest
    let formRequestClass: string | null = null;
    const bodySchema = endpoint.requestBodySchema;
    if (bodySchema && Object.keys(bodySchema.properties).length > 0 && ["post", "put", "patch"].includes(endpoint.method)) {
      formRequestClass = `${toStudly(endpoint.operationId)}Request`;
      const requestContent = generateFormRequestClass(formRequestClass, bodySchema, endpoint.security);
      const requestPath = path.join(requestsDir, `${formRequestClass}.php`);
      ensureDir(requestsDir);
      fs.writeFileSync(requestPath, requestContent, "utf8");
      generatedFiles.push(requestPath);
    }

    // JsonResource for GET (with real response schema if available)
    let resourceClass: string | null = null;
    if (endpoint.method === "get") {
      const res = resourceName(endpoint.operationId, endpoint.tags);
      resourceClass = `${res}Resource`;
      if (!generatedResources.has(resourceClass)) {
        generatedResources.add(resourceClass);
        ensureDir(resourcesDir);
        const resourceContent = generateJsonResource(resourceClass, endpoint.responseSchema);
        const resourcePath = path.join(resourcesDir, `${resourceClass}.php`);
        fs.writeFileSync(resourcePath, resourceContent, "utf8");
        generatedFiles.push(resourcePath);
      }
    }

    // Controller
    const controllerContent = generateControllerClass(className, endpoint, formRequestClass, rule, resourceClass, model);
    const controllerPath = path.join(controllersDir, `${className}.php`);
    fs.writeFileSync(controllerPath, controllerContent, "utf8");
    generatedFiles.push(controllerPath);

    // Route
    const laravelPath = endpoint.path.replace(/\{(\w+)\}/g, "{$1}");
    const deprecatedComment = endpoint.deprecated ? "// @deprecated\n" : "";
    routeLines.push(
      `${deprecatedComment}Route::${endpoint.method}('${laravelPath}', \\App\\Http\\Controllers\\Generated\\${className}::class);`,
    );
  }

  const routesFilePath = path.join(routesDir, "api.php");
  fs.writeFileSync(routesFilePath, routeLines.join("\n") + "\n", "utf8");
  generatedFiles.push(routesFilePath);

  return generatedFiles;
}
