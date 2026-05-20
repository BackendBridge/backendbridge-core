import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseOpenApiToContract } from "../src/openapi.js";

describe("parseOpenApiToContract", () => {
  it("parse un contrat OpenAPI yaml", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "backendbridge-openapi-"));
    const openApiPath = path.join(tmpDir, "openapi.yaml");

    fs.writeFileSync(
      openApiPath,
      `openapi: 3.0.3
info:
  title: Demo API
  version: 1.2.0
paths:
  /users:
    get:
      operationId: listUsers
      summary: Liste des utilisateurs
    post:
      summary: Creation utilisateur
`,
      "utf8",
    );

    const contract = parseOpenApiToContract(openApiPath);
    expect(contract.title).toBe("Demo API");
    expect(contract.version).toBe("1.2.0");
    expect(contract.endpoints).toHaveLength(2);
    expect(contract.endpoints[0]?.operationId).toBe("listUsers");
  });
});
