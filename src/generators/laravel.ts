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

function resourceName(operationId: string): string {
  return toStudly(operationId.replace(/^(get|list|show|fetch|index)_?/i, "")) || toStudly(operationId);
}

// ─── Schema → Laravel validation rules ───────────────────────────────────────

function schemaPropertyToRules(name: string, prop: EndpointSchema["properties"][string], required: boolean): string {
  // Multiple file uploads: type:array, items.format:binary
  if (prop.type === "array" && prop.items?.format === "binary") {
    const isImage = /photo|image|avatar|picture|thumbnail|cover/i.test(name);
    const itemMimes = isImage ? "image|mimes:jpg,jpeg,png,gif,webp|max:5120" : "file|mimes:pdf,doc,docx,zip,jpg,jpeg,png|max:10240";
    return [
      `            '${name}' => '${required ? "required" : "nullable"}|array',`,
      `            '${name}.*' => '${itemMimes}',`,
    ].join("\n");
  }

  // Single file upload
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
  else if (prop.format === "uuid") rules.push("uuid");

  if (prop.minLength !== undefined) rules.push(`min:${prop.minLength}`);
  if (prop.maxLength !== undefined) rules.push(`max:${prop.maxLength}`);
  if (prop.minimum !== undefined) rules.push(`min:${prop.minimum}`);
  if (prop.maximum !== undefined) rules.push(`max:${prop.maximum}`);
  if (prop.enum?.length) rules.push(`in:${prop.enum.join(",")}`);

  return `            '${name}' => '${rules.join("|")}',`;
}

// ─── JsonResource generator ───────────────────────────────────────────────────

function generateJsonResource(resourceClass: string): string {
  return `<?php

namespace App\\Http\\Resources\\Generated;

use Illuminate\\Http\\Request;
use Illuminate\\Http\\Resources\\Json\\JsonResource;

class ${resourceClass} extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id'         => $this->id,
            // TODO: map all model attributes here
            'created_at' => $this->created_at,
            'updated_at' => $this->updated_at,
        ];
    }
}
`;
}

// ─── FormRequest generator ────────────────────────────────────────────────────

function generateFormRequestClass(
  className: string,
  schema: EndpointSchema,
): string {
  const rulesLines = Object.entries(schema.properties).map(([field, prop]) => {
    const isRequired = schema.required?.includes(field) ?? false;
    return schemaPropertyToRules(field, prop, isRequired);
  });

  return `<?php

namespace App\\Http\\Requests\\Generated;

use Illuminate\\Foundation\\Http\\FormRequest;

class ${className} extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

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

function buildControllerBody(endpoint: EndpointContract, formRequestClass: string | null, rule: ReturnType<typeof resolveRule>): string {
  const authHint = rule?.auth?.length
    ? `            // Auth: ${rule.auth.join(", ")}\n            // $this->authorize('view', $model);\n`
    : "";

  const hasFileUpload = Object.values(endpoint.requestBodySchema?.properties ?? {}).some(
    (p) => p.format === "binary" || (p.type === "array" && p.items?.format === "binary"),
  );

  const requestParam = formRequestClass
    ? `${formRequestClass} $request`
    : `Request $request`;

  const pathParams = (endpoint.pathParameters ?? [])
    .filter((p) => p.in === "path")
    .map((p) => `            // Path param: $${p.name} (${p.schema?.type ?? "string"})`)
    .join("\n");

  const isWrite = ["post", "put", "patch"].includes(endpoint.method);
  const isDelete = endpoint.method === "delete";
  const isList = isListEndpoint(endpoint);
  const isShow = isShowEndpoint(endpoint);
  const res = resourceName(endpoint.operationId);

  let innerBody = "";

  if (authHint) innerBody += authHint;
  if (pathParams) innerBody += pathParams + "\n";

  if (isList) {
    innerBody += `            // Pagination\n`;
    innerBody += `            // $items = MyModel::query()->paginate(15);\n`;
    innerBody += `            // return ${res}Resource::collection($items);\n`;
  } else if (isShow) {
    innerBody += `            // $model = MyModel::findOrFail($id); // throws ModelNotFoundException → 404\n`;
    innerBody += `            // return new ${res}Resource($model);\n`;
  } else if (isWrite) {
    innerBody += `            // $validated = $request->validated();\n`;
    innerBody += `            // \\DB::beginTransaction();\n`;
    innerBody += `            // try {\n`;
    innerBody += `            //     $model = MyModel::create($validated);\n`;
    innerBody += `            //     \\DB::commit();\n`;
    innerBody += `            //     return new ${res}Resource($model);\n`;
    innerBody += `            // } catch (\\Throwable $e) { \\DB::rollBack(); throw $e; }\n`;
  } else if (isDelete) {
    innerBody += `            // $model = MyModel::findOrFail($id);\n`;
    innerBody += `            // $model->delete();\n`;
  }

  const hasMultiUpload = Object.values(endpoint.requestBodySchema?.properties ?? {}).some(
    (p) => p.type === "array" && p.items?.format === "binary",
  );
  if (hasFileUpload && !hasMultiUpload) {
    innerBody += `            // Single upload : $file = $request->file('field'); $path = $file->store('uploads', 'public');\n`;
  }
  if (hasMultiUpload) {
    innerBody += `            // Multiple uploads: foreach ($request->file('photos') as $f) { $f->store('uploads', 'public'); }\n`;
  }

  innerBody += `\n`;
  innerBody += `            // Session : $request->session()->get('key') / ->put('key', value) / ->forget('key')\n`;
  innerBody += `            // Cookie  : $request->cookie('name') / Cookie::queue('name', 'value', $minutes)\n`;
  innerBody += `            // JWT     : $user = auth('api')->user(); // requires laravel/sanctum or tymondesigns/jwt-auth\n`;
  innerBody += `\n`;
  innerBody += `            return response()->json(['status' => 'ok', 'operation' => '${endpoint.operationId}']);`;

  return `    public function __invoke(${requestParam}): JsonResponse
    {
        try {
${innerBody}
        } catch (\\Illuminate\\Database\\Eloquent\\ModelNotFoundException) {
            return response()->json(['message' => 'Not found'], 404);
        } catch (\\Illuminate\\Validation\\ValidationException $e) {
            return response()->json(['message' => 'Validation failed', 'errors' => $e->errors()], 422);
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
): string {
  const summaryLine = endpoint.summary ? ` * ${endpoint.summary}\n` : "";
  const mappingHints = [
    rule?.dto ? ` * DTO: ${rule.dto}` : undefined,
    rule?.validation?.length ? ` * Validation: ${rule.validation.join(", ")}` : undefined,
    rule?.auth?.length ? ` * Auth: ${rule.auth.join(", ")}` : undefined,
    rule?.notes ? ` * Notes: ${rule.notes}` : undefined,
  ].filter(Boolean).join("\n");

  const requestImport = formRequestClass
    ? `use App\\Http\\Requests\\Generated\\${formRequestClass};\n`
    : "";
  const resourceImport = resourceClass
    ? `use App\\Http\\Resources\\Generated\\${resourceClass};\n`
    : "";
  const dbImport = ["post", "put", "patch"].includes(endpoint.method)
    ? `use Illuminate\\Support\\Facades\\DB;\n`
    : "";

  return `<?php

namespace App\\Http\\Controllers\\Generated;

use App\\Http\\Controllers\\Controller;
use Illuminate\\Http\\JsonResponse;
${formRequestClass ? "" : "use Illuminate\\Http\\Request;\n"}${requestImport}${resourceImport}${dbImport}
class ${className} extends Controller
{
    /**
${summaryLine}     * Auto-generated by BackendBridge.
${mappingHints ? mappingHints + "\n" : ""}     */
${buildControllerBody(endpoint, formRequestClass, rule)}
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

    // Generate FormRequest if there is a requestBody schema
    let formRequestClass: string | null = null;
    const bodySchema = endpoint.requestBodySchema;
    if (bodySchema && Object.keys(bodySchema.properties).length > 0 && ["post", "put", "patch"].includes(endpoint.method)) {
      formRequestClass = `${toStudly(endpoint.operationId)}Request`;
      const requestContent = generateFormRequestClass(formRequestClass, bodySchema);
      const requestPath = path.join(requestsDir, `${formRequestClass}.php`);
      ensureDir(requestsDir);
      fs.writeFileSync(requestPath, requestContent, "utf8");
      generatedFiles.push(requestPath);
    }

    // Generate JsonResource for GET endpoints (deduplicated by resource name)
    let resourceClass: string | null = null;
    if (endpoint.method === "get") {
      const res = resourceName(endpoint.operationId);
      resourceClass = `${res}Resource`;
      if (!generatedResources.has(resourceClass)) {
        generatedResources.add(resourceClass);
        ensureDir(resourcesDir);
        const resourceContent = generateJsonResource(resourceClass);
        const resourcePath = path.join(resourcesDir, `${resourceClass}.php`);
        fs.writeFileSync(resourcePath, resourceContent, "utf8");
        generatedFiles.push(resourcePath);
      }
    }

    // Generate controller
    const controllerContent = generateControllerClass(className, endpoint, formRequestClass, rule, resourceClass);
    const controllerPath = path.join(controllersDir, `${className}.php`);
    fs.writeFileSync(controllerPath, controllerContent, "utf8");
    generatedFiles.push(controllerPath);

    // Route line with path params converted to Laravel syntax
    const laravelPath = endpoint.path.replace(/\{(\w+)\}/g, "{$1}");
    routeLines.push(
      `Route::${endpoint.method}('${laravelPath}', \\App\\Http\\Controllers\\Generated\\${className}::class);`,
    );
  }

  const routesFilePath = path.join(routesDir, "api.php");
  fs.writeFileSync(routesFilePath, routeLines.join("\n") + "\n", "utf8");
  generatedFiles.push(routesFilePath);

  return generatedFiles;
}
