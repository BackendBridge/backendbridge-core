/**
 * BackendBridge Intermediate Representation (IR) — v1
 *
 * The IR is the canonical, framework-agnostic description of an API extracted
 * from a Symfony or Laravel project. Generators consume the IR to produce
 * target-framework code; it can be saved as JSON and reused without re-parsing.
 *
 * Lifecycle:
 *   PHP source → (extract) → OpenAPI → (parse) → ApiContract → (enrich) → IR → (generate) → PHP output
 */

import type { ApiContract, SupportedFramework } from "./types.js";

export const IR_VERSION = 1 as const;

// ─── IR types ─────────────────────────────────────────────────────────────────

export interface IRField {
  name: string;
  type: string;
  required: boolean;
  nullable: boolean;
  validation?: string[];
  format?: string;
  enum?: string[];
}

export interface IRRelation {
  type: "hasMany" | "belongsTo" | "hasOne" | "manyToMany";
  target: string;
  through?: string;
}

export interface IRResource {
  name: string;
  tableName: string;
  fields: IRField[];
  relations: IRRelation[];
}

export interface IRRoute {
  method: string;
  path: string;
  operationId: string;
  resource?: string;
  tags: string[];
  summary?: string;
  deprecated?: boolean;
  security?: string[];
  requestSchema?: Record<string, IRField>;
  responseSchema?: Record<string, IRField>;
}

export interface IRService {
  name: string;
  methods: string[];
  usedBy: string[];
}

export interface IRAuthRule {
  resource: string;
  roles: string[];
  attributes: string[];
}

export interface IREvent {
  name: string;
  resource: string;
  action: "created" | "updated" | "deleted";
}

export interface IRCommand {
  name: string;
  resource: string;
  signature: string;
}

export interface IntermediateRepresentation {
  /** Schema version — increment when breaking changes are made to the IR shape */
  version: typeof IR_VERSION;
  meta: {
    extractedFrom?: SupportedFramework;
    extractedAt: string;
    title: string;
    apiVersion: string;
    sourceVersion?: string;
  };
  resources: IRResource[];
  routes: IRRoute[];
  services: IRService[];
  auth: IRAuthRule[];
  events: IREvent[];
  commands: IRCommand[];
}

// ─── ApiContract → IR ─────────────────────────────────────────────────────────

function toSnake(name: string): string {
  return name
    .replace(/([A-Z])/g, "_$1")
    .toLowerCase()
    .replace(/^_/, "")
    .replace(/[^a-z0-9]+/g, "_");
}

function schemaToFields(
  props: Record<string, { type?: string; format?: string; enum?: string[]; nullable?: boolean }>,
  required: string[] = [],
): IRField[] {
  return Object.entries(props).map(([name, schema]) => ({
    name,
    type: schema.type ?? "string",
    format: schema.format,
    enum: schema.enum,
    required: required.includes(name),
    nullable: schema.nullable ?? false,
  }));
}

export function contractToIR(
  contract: ApiContract,
  from?: SupportedFramework,
): IntermediateRepresentation {
  // Collect unique resources from endpoint tags
  const resourcesSeen = new Map<string, IRResource>();
  const routesSeen: IRRoute[] = [];
  const eventsSeen: IREvent[] = [];
  const commandsSeen: IRCommand[] = [];

  for (const ep of contract.endpoints) {
    const resourceName = ep.tags?.[0] ?? "Resource";

    if (!resourcesSeen.has(resourceName)) {
      resourcesSeen.set(resourceName, {
        name: resourceName,
        tableName: `${toSnake(resourceName)}s`,
        fields: ep.responseSchema
          ? schemaToFields(ep.responseSchema.properties, ep.responseSchema.required)
          : [],
        relations: [],
      });
    }

    const route: IRRoute = {
      method: ep.method,
      path: ep.path,
      operationId: ep.operationId,
      resource: resourceName,
      tags: ep.tags,
      summary: ep.summary,
      deprecated: ep.deprecated,
      security: ep.security,
      requestSchema: ep.requestBodySchema
        ? Object.fromEntries(
            schemaToFields(ep.requestBodySchema.properties, ep.requestBodySchema.required)
              .map((f) => [f.name, f]),
          )
        : undefined,
      responseSchema: ep.responseSchema
        ? Object.fromEntries(
            schemaToFields(ep.responseSchema.properties, ep.responseSchema.required)
              .map((f) => [f.name, f]),
          )
        : undefined,
    };
    routesSeen.push(route);

    // Infer events from CUD operations
    const method = ep.method.toLowerCase();
    if (method === "post")   eventsSeen.push({ name: `${resourceName}CreatedEvent`, resource: resourceName, action: "created" });
    if (method === "put" || method === "patch") eventsSeen.push({ name: `${resourceName}UpdatedEvent`, resource: resourceName, action: "updated" });
    if (method === "delete") eventsSeen.push({ name: `${resourceName}DeletedEvent`, resource: resourceName, action: "deleted" });

    // Infer commands
    if (!commandsSeen.find((c) => c.resource === resourceName)) {
      commandsSeen.push({
        name: `Process${resourceName}Command`,
        resource: resourceName,
        signature: `${toSnake(resourceName)}:process`,
      });
    }
  }

  return {
    version: IR_VERSION,
    meta: {
      extractedFrom: from,
      extractedAt: new Date().toISOString(),
      title: contract.title,
      apiVersion: contract.version,
    },
    resources: [...resourcesSeen.values()],
    routes: routesSeen,
    services: [],
    auth: [],
    events: [...new Map(eventsSeen.map((e) => [e.name, e])).values()],
    commands: commandsSeen,
  };
}
