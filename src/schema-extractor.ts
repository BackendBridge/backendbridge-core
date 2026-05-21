import fs from "node:fs";
import path from "node:path";

export interface JsonSchemaProperty {
  type: string;
  format?: string;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  enum?: string[];
  nullable?: boolean;
  description?: string;
}

export interface ExtractedSchema {
  properties: Record<string, JsonSchemaProperty>;
  required: string[];
  description?: string;
}

// ─── Laravel ────────────────────────────────────────────────────────────────

function laravelRulesToJsonSchema(rules: Record<string, string[]>): ExtractedSchema {
  const properties: Record<string, JsonSchemaProperty> = {};
  const required: string[] = [];

  for (const [field, ruleList] of Object.entries(rules)) {
    const prop: JsonSchemaProperty = { type: "string" };

    if (ruleList.includes("required")) required.push(field);
    if (ruleList.includes("nullable")) prop.nullable = true;

    if (ruleList.includes("integer") || ruleList.includes("int")) prop.type = "integer";
    else if (ruleList.includes("numeric") || ruleList.includes("decimal")) prop.type = "number";
    else if (ruleList.includes("boolean") || ruleList.includes("bool")) prop.type = "boolean";
    else if (ruleList.includes("array")) prop.type = "array";
    else if (ruleList.includes("email")) {
      prop.type = "string";
      prop.format = "email";
    } else if (ruleList.includes("url")) {
      prop.type = "string";
      prop.format = "uri";
    } else if (ruleList.includes("date") || ruleList.includes("date_format")) {
      prop.type = "string";
      prop.format = "date";
    } else if (ruleList.includes("uuid")) {
      prop.type = "string";
      prop.format = "uuid";
    }

    for (const rule of ruleList) {
      const minMatch = /^min:(\d+)$/.exec(rule);
      const maxMatch = /^max:(\d+)$/.exec(rule);
      const inMatch = /^in:(.+)$/.exec(rule);
      if (minMatch) {
        if (prop.type === "integer" || prop.type === "number") prop.minimum = Number(minMatch[1]);
        else prop.minLength = Number(minMatch[1]);
      }
      if (maxMatch) {
        if (prop.type === "integer" || prop.type === "number") prop.maximum = Number(maxMatch[1]);
        else prop.maxLength = Number(maxMatch[1]);
      }
      if (inMatch) prop.enum = inMatch[1].split(",").map((v) => v.trim());
    }

    properties[field] = prop;
  }

  return { properties, required };
}

function parseRulesArray(body: string): Record<string, string[]> {
  const rules: Record<string, string[]> = {};
  // match 'field' => 'rule1|rule2' or 'field' => ['rule1', 'rule2']
  const entryRegex = /['\"]([^'\"]+)['\"\s]*=>\s*(?:'([^']*)'|"([^"]*)"|\[([^\]]*)\])/g;
  let m: RegExpExecArray | null;
  while ((m = entryRegex.exec(body)) !== null) {
    const field = m[1];
    const pipeStr = m[2] ?? m[3];
    const arrayStr = m[4];
    if (pipeStr !== undefined) {
      rules[field] = pipeStr.split("|").map((r) => r.trim()).filter(Boolean);
    } else if (arrayStr !== undefined) {
      const itemRegex = /['\"]([^'\"]+)['\"]|([a-zA-Z_:]+)/g;
      const items: string[] = [];
      let im: RegExpExecArray | null;
      while ((im = itemRegex.exec(arrayStr)) !== null) {
        items.push(im[1] ?? im[2]);
      }
      rules[field] = items.filter(Boolean);
    }
  }
  return rules;
}

export interface LaravelFormRequest {
  className: string;
  filePath: string;
  schema: ExtractedSchema;
}

export function extractLaravelFormRequests(sourcePath: string): LaravelFormRequest[] {
  const requestsDir = path.join(sourcePath, "app", "Http", "Requests");
  if (!fs.existsSync(requestsDir)) return [];

  const results: LaravelFormRequest[] = [];
  for (const file of fs.readdirSync(requestsDir)) {
    if (!file.endsWith(".php")) continue;
    const filePath = path.join(requestsDir, file);
    const content = fs.readFileSync(filePath, "utf8");

    // extract class name
    const classMatch = /class\s+(\w+)/.exec(content);
    if (!classMatch) continue;
    const className = classMatch[1];

    // extract rules() method body
    const rulesMatch = /function\s+rules\s*\(\s*\)\s*(?::\s*array\s*)?\{([^}]*(?:\{[^}]*\}[^}]*)*)\}/s.exec(content);
    if (!rulesMatch) continue;

    const rulesBody = rulesMatch[1];
    const returnMatch = /return\s*(\[[^\]]*(?:\[[^\]]*\][^\]]*)*\])/s.exec(rulesBody);
    if (!returnMatch) continue;

    const parsed = parseRulesArray(returnMatch[1]);
    results.push({ className, filePath, schema: laravelRulesToJsonSchema(parsed) });
  }
  return results;
}

// ─── Symfony ─────────────────────────────────────────────────────────────────

const ASSERT_TO_SCHEMA: Record<string, (arg?: string) => Partial<JsonSchemaProperty>> = {
  NotBlank: () => ({}),
  Email: () => ({ type: "string", format: "email" }),
  Url: () => ({ type: "string", format: "uri" }),
  Uuid: () => ({ type: "string", format: "uuid" }),
  Date: () => ({ type: "string", format: "date" }),
  DateTime: () => ({ type: "string", format: "date-time" }),
  Positive: () => ({ type: "number", minimum: 1 }),
  PositiveOrZero: () => ({ type: "number", minimum: 0 }),
  Negative: () => ({ type: "number", maximum: -1 }),
  Length: (arg) => {
    const min = /min\s*:\s*(\d+)/.exec(arg ?? "")?.[1];
    const max = /max\s*:\s*(\d+)/.exec(arg ?? "")?.[1];
    return {
      ...(min ? { minLength: Number(min) } : {}),
      ...(max ? { maxLength: Number(max) } : {}),
    };
  },
  Range: (arg) => {
    const min = /min\s*:\s*(\d+)/.exec(arg ?? "")?.[1];
    const max = /max\s*:\s*(\d+)/.exec(arg ?? "")?.[1];
    return {
      type: "number",
      ...(min ? { minimum: Number(min) } : {}),
      ...(max ? { maximum: Number(max) } : {}),
    };
  },
  Choice: (arg) => {
    const choices = /choices\s*:\s*\[([^\]]*)\]/.exec(arg ?? "")?.[1];
    if (!choices) return {};
    return { enum: choices.split(",").map((c) => c.trim().replace(/['"]/g, "")) };
  },
};

function parseSymfonyAsserts(annotations: string): Partial<JsonSchemaProperty> {
  let merged: Partial<JsonSchemaProperty> = {};
  const assertRegex = /#\[Assert\\(\w+)(?:\(([^)]*)\))?\]|@Assert\\(\w+)(?:\(([^)]*)\))?/g;
  let m: RegExpExecArray | null;
  while ((m = assertRegex.exec(annotations)) !== null) {
    const name = m[1] ?? m[3];
    const args = m[2] ?? m[4] ?? "";
    const handler = ASSERT_TO_SCHEMA[name];
    if (handler) merged = { ...merged, ...handler(args) };
  }
  return merged;
}

export interface SymfonyDtoSchema {
  className: string;
  filePath: string;
  schema: ExtractedSchema;
}

export function extractSymfonyDtoSchemas(sourcePath: string): SymfonyDtoSchema[] {
  const scanDirs = [
    path.join(sourcePath, "src", "Dto"),
    path.join(sourcePath, "src", "Request"),
    path.join(sourcePath, "src", "Form"),
  ];
  const results: SymfonyDtoSchema[] = [];

  for (const dir of scanDirs) {
    if (!fs.existsSync(dir)) continue;
    for (const file of fs.readdirSync(dir)) {
      if (!file.endsWith(".php")) continue;
      const filePath = path.join(dir, file);
      const content = fs.readFileSync(filePath, "utf8");

      const classMatch = /class\s+(\w+)/.exec(content);
      if (!classMatch) continue;
      const className = classMatch[1];

      const properties: Record<string, JsonSchemaProperty> = {};
      const required: string[] = [];

      // match property blocks: block of Assert annotations followed by property declaration
      const propBlockRegex = /((?:#\[Assert\\[^\n]+\n|@Assert\\[^\n]+\n)+)\s*(?:public|protected|private)\s+(?:\??\w+\s+)?\$(\w+)/g;
      let pm: RegExpExecArray | null;
      while ((pm = propBlockRegex.exec(content)) !== null) {
        const assertBlock = pm[1];
        const propName = pm[2];
        const schema = parseSymfonyAsserts(assertBlock);
        const isRequired = assertBlock.includes("NotBlank");
        const prop: JsonSchemaProperty = { type: schema.type ?? "string", ...schema };
        properties[propName] = prop;
        if (isRequired) required.push(propName);
      }

      if (Object.keys(properties).length > 0) {
        results.push({ className, filePath, schema: { properties, required } });
      }
    }
  }
  return results;
}

// ─── Controller method → FormRequest hint ───────────────────────────────────

export function matchRequestToOperation(
  operationId: string,
  formRequests: LaravelFormRequest[],
): LaravelFormRequest | undefined {
  const lower = operationId.toLowerCase();
  return formRequests.find((fr) => {
    const cn = fr.className.toLowerCase().replace("request", "");
    return lower.includes(cn) || cn.includes(lower.replace(/^(post|put|patch|get|delete)_/, "").split("_")[0] ?? "");
  });
}
