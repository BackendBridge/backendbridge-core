import fs from "node:fs";
import path from "node:path";
import type { ApiContract } from "../types.js";
import { toStudly, ensureDir } from "../utils.js";

function inferResources(contract: ApiContract): string[] {
  const seen = new Set<string>();
  for (const ep of contract.endpoints) {
    const name = ep.tags?.[0] ? toStudly(ep.tags[0]) : toStudly(ep.operationId);
    if (name) seen.add(name);
  }
  return [...seen];
}

function symfonyRepositoryClass(resource: string): string {
  return `<?php

namespace App\\Repository\\Generated;

use App\\Entity\\${resource};
use Doctrine\\Bundle\\DoctrineBundle\\Repository\\ServiceEntityRepository;
use Doctrine\\Persistence\\ManagerRegistry;

/**
 * @extends ServiceEntityRepository<${resource}>
 */
class ${resource}Repository extends ServiceEntityRepository
{
    public function __construct(ManagerRegistry $registry)
    {
        parent::__construct($registry, ${resource}::class);
    }

    public function findAllPaginated(int $page = 1, int $limit = 15): array
    {
        return $this->createQueryBuilder('e')
            ->setFirstResult(($page - 1) * $limit)
            ->setMaxResults($limit)
            ->getQuery()
            ->getResult();
    }

    public function findByFilters(array $filters = []): array
    {
        $qb = $this->createQueryBuilder('e');
        // TODO: add filter conditions based on $filters keys
        return $qb->getQuery()->getResult();
    }

    public function countAll(): int
    {
        return (int) $this->createQueryBuilder('e')
            ->select('COUNT(e.id)')
            ->getQuery()
            ->getSingleScalarResult();
    }
}
`;
}

function laravelRepositoryInterface(resource: string): string {
  return `<?php

namespace App\\Repositories\\Generated\\Contracts;

interface ${resource}RepositoryInterface
{
    public function all(int $perPage = 15): mixed;
    public function find(int $id): mixed;
    public function create(array $data): mixed;
    public function update(int $id, array $data): mixed;
    public function delete(int $id): bool;
}
`;
}

function laravelRepositoryClass(resource: string): string {
  return `<?php

namespace App\\Repositories\\Generated;

use App\\Models\\${resource};
use App\\Repositories\\Generated\\Contracts\\${resource}RepositoryInterface;

class ${resource}Repository implements ${resource}RepositoryInterface
{
    public function __construct(private readonly ${resource} $model) {}

    public function all(int $perPage = 15): mixed
    {
        return $this->model->query()->paginate($perPage);
    }

    public function find(int $id): mixed
    {
        return $this->model->findOrFail($id);
    }

    public function create(array $data): mixed
    {
        return $this->model->create($data);
    }

    public function update(int $id, array $data): mixed
    {
        $record = $this->model->findOrFail($id);
        $record->update($data);
        return $record->fresh();
    }

    public function delete(int $id): bool
    {
        return (bool) $this->model->findOrFail($id)->delete();
    }
}
`;
}

function laravelRepositoryServiceProvider(resources: string[]): string {
  const bindings = resources
    .map((r) => `        $this->app->bind(\n            \\App\\Repositories\\Generated\\Contracts\\${r}RepositoryInterface::class,\n            \\App\\Repositories\\Generated\\${r}Repository::class,\n        );`)
    .join("\n\n");

  return `<?php

namespace App\\Providers;

use Illuminate\\Support\\ServiceProvider;

class RepositoryServiceProvider extends ServiceProvider
{
    public function register(): void
    {
${bindings}
    }
}
`;
}

export function generateSymfonyRepositories(contract: ApiContract, outPath: string): string[] {
  const resources = inferResources(contract);
  const generated: string[] = [];
  const repoDir = path.join(outPath, "src", "Repository", "Generated");
  ensureDir(repoDir);

  for (const resource of resources) {
    const filePath = path.join(repoDir, `${resource}Repository.php`);
    fs.writeFileSync(filePath, symfonyRepositoryClass(resource), "utf8");
    generated.push(filePath);
  }

  return generated;
}

export function generateLaravelRepositories(contract: ApiContract, outPath: string): string[] {
  const resources = inferResources(contract);
  const generated: string[] = [];

  const implDir = path.join(outPath, "app", "Repositories", "Generated");
  const contractDir = path.join(implDir, "Contracts");
  const providerDir = path.join(outPath, "app", "Providers");

  ensureDir(implDir);
  ensureDir(contractDir);
  ensureDir(providerDir);

  for (const resource of resources) {
    const ifPath = path.join(contractDir, `${resource}RepositoryInterface.php`);
    fs.writeFileSync(ifPath, laravelRepositoryInterface(resource), "utf8");
    generated.push(ifPath);

    const implPath = path.join(implDir, `${resource}Repository.php`);
    fs.writeFileSync(implPath, laravelRepositoryClass(resource), "utf8");
    generated.push(implPath);
  }

  const providerPath = path.join(providerDir, "RepositoryServiceProvider.php");
  fs.writeFileSync(providerPath, laravelRepositoryServiceProvider(resources), "utf8");
  generated.push(providerPath);

  return generated;
}
