export type SupportedFramework = "symfony" | "laravel";

export interface EndpointContract {
  method: string;
  path: string;
  operationId: string;
  summary?: string;
  tags: string[];
}

export interface ApiContract {
  title: string;
  version: string;
  endpoints: EndpointContract[];
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
}
