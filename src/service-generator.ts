import fs from "node:fs";
import path from "node:path";
import type { SupportedFramework } from "./types.js";

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

function walkPhp(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) results.push(...walkPhp(full));
    else if (entry.name.endsWith(".php")) results.push(full);
  }
  return results;
}

// ─── Extraction ───────────────────────────────────────────────────────────────

const SERVICE_PATTERN =
  /(?:private|protected|public)\s+(?:readonly\s+)?(\w+(?:Service|Repository|Manager|Handler|Resolver|Facade|Provider))\s+\$\w+/g;

export interface DetectedService {
  className: string;
  usedIn: string[];
}

function scanControllers(sourcePath: string, from: SupportedFramework): DetectedService[] {
  const dirs =
    from === "laravel"
      ? [path.join(sourcePath, "app", "Http", "Controllers")]
      : [path.join(sourcePath, "src", "Controller")];

  const map = new Map<string, Set<string>>();

  for (const dir of dirs) {
    for (const file of walkPhp(dir)) {
      const content = fs.readFileSync(file, "utf8");
      const controllerName = path.basename(file, ".php");
      for (const [, cls] of content.matchAll(SERVICE_PATTERN)) {
        if (!map.has(cls)) map.set(cls, new Set());
        map.get(cls)!.add(controllerName);
      }
    }
  }

  return [...map.entries()].map(([className, usedIn]) => ({
    className,
    usedIn: [...usedIn],
  }));
}

// ─── Laravel service stub ─────────────────────────────────────────────────────

function laravelServiceStub(className: string): string {
  const isRepo = className.endsWith("Repository");
  const isHandler = className.endsWith("Handler");
  const base = className.replace(/(Service|Repository|Manager|Handler|Resolver|Provider)$/, "");

  const methods = isRepo
    ? `    public function all(): \\Illuminate\\Database\\Eloquent\\Collection
    {
        // TODO: implement — e.g. return ${base}::all();
    }

    public function find(int|string $id): ?\\Illuminate\\Database\\Eloquent\\Model
    {
        // TODO: implement — e.g. return ${base}::find($id);
    }

    public function create(array $data): \\Illuminate\\Database\\Eloquent\\Model
    {
        // TODO: implement — e.g. return ${base}::create($data);
    }

    public function update(int|string $id, array $data): bool
    {
        // TODO: implement
        return false;
    }

    public function delete(int|string $id): bool
    {
        // TODO: implement
        return false;
    }`
    : isHandler
    ? `    public function handle(mixed $command): mixed
    {
        // TODO: implement command handling logic
        return null;
    }`
    : `    public function handle(array $data = []): mixed
    {
        // TODO: implement business logic
        return null;
    }`;

  return `<?php

namespace App\\Services;

class ${className}
{
${methods}
}
`;
}

// ─── Symfony service stub ─────────────────────────────────────────────────────

function symfonyServiceStub(className: string): string {
  const isRepo = className.endsWith("Repository");
  const isHandler = className.endsWith("Handler");
  const base = className.replace(/(Service|Repository|Manager|Handler|Resolver|Provider)$/, "");

  const methods = isRepo
    ? `    public function findAll(): array
    {
        // TODO: implement — e.g. return $this->entityManager->getRepository(${base}::class)->findAll();
        return [];
    }

    public function find(int|string $id): mixed
    {
        // TODO: implement
        return null;
    }

    public function save(object $entity, bool $flush = true): void
    {
        // TODO: implement — $this->entityManager->persist($entity); if ($flush) $this->entityManager->flush();
    }

    public function remove(object $entity, bool $flush = true): void
    {
        // TODO: implement — $this->entityManager->remove($entity); if ($flush) $this->entityManager->flush();
    }`
    : isHandler
    ? `    public function __invoke(mixed $message): void
    {
        // TODO: implement message handling logic
    }`
    : `    public function execute(array $data = []): mixed
    {
        // TODO: implement business logic
        return null;
    }`;

  return `<?php

namespace App\\Service;

class ${className}
{
${methods}
}
`;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function extractServicesFromSource(
  sourcePath: string,
  from: SupportedFramework,
): DetectedService[] {
  try {
    return scanControllers(sourcePath, from);
  } catch {
    return [];
  }
}

export function generateLaravelServices(
  services: DetectedService[],
  outPath: string,
): string[] {
  if (!services.length) return [];
  const dir = path.join(outPath, "app", "Services");
  ensureDir(dir);
  const generated: string[] = [];

  for (const svc of services) {
    const file = path.join(dir, `${svc.className}.php`);
    fs.writeFileSync(file, laravelServiceStub(svc.className), "utf8");
    generated.push(file);
  }

  return generated;
}

export function generateSymfonyServices(
  services: DetectedService[],
  outPath: string,
): string[] {
  if (!services.length) return [];
  const dir = path.join(outPath, "src", "Service");
  ensureDir(dir);
  const generated: string[] = [];

  for (const svc of services) {
    const file = path.join(dir, `${svc.className}.php`);
    fs.writeFileSync(file, symfonyServiceStub(svc.className), "utf8");
    generated.push(file);
  }

  return generated;
}
