export type SupportedFramework = "symfony" | "laravel";

export interface SchemaProperty {
  type?: string;
  format?: string;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  enum?: string[];
  nullable?: boolean;
  $ref?: string;
  /** For type:array — describes each item (used for multiple file uploads etc.) */
  items?: { type?: string; format?: string };
}

export interface EndpointSchema {
  properties: Record<string, SchemaProperty>;
  required?: string[];
}

export interface PathParameter {
  name: string;
  in: "path" | "query";
  required?: boolean;
  schema?: SchemaProperty;
}

export interface EndpointContract {
  method: string;
  path: string;
  operationId: string;
  summary?: string;
  tags: string[];
  pathParameters?: PathParameter[];
  requestBodySchema?: EndpointSchema;
}

export interface ApiContract {
  title: string;
  version: string;
  endpoints: EndpointContract[];
  /** Resolved component schemas keyed by $ref name */
  componentSchemas?: Record<string, EndpointSchema>;
}

export interface ConvertOptions {
  from: "auto" | SupportedFramework;
  to: SupportedFramework;
  sourcePath: string;
  outPath: string;
  openApiPath: string;
  mappingPath?: string;
  extractIfMissing?: boolean;
  extractOutPath?: string;
  targetVersion?: string;
  dryRun: boolean;
  usePhpAst?: boolean;
  envOutName?: string;
  withTests?: boolean;
  withDocker?: boolean;
  withSeeders?: boolean;
  withMiddleware?: boolean;
  withMailer?: boolean;
  withJobs?: boolean;
}
