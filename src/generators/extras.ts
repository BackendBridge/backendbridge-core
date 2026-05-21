import fs from "node:fs";
import path from "node:path";
import type { ApiContract } from "../types.js";
import { toStudly, ensureDir } from "../utils.js";

// ─── Resource inference ───────────────────────────────────────────────────────

function inferResources(contract: ApiContract): Array<{ name: string; hasCreate: boolean; hasUpdate: boolean; hasDelete: boolean }> {
  const map = new Map<string, { name: string; hasCreate: boolean; hasUpdate: boolean; hasDelete: boolean }>();
  for (const ep of contract.endpoints) {
    const name = ep.tags?.[0] ? toStudly(ep.tags[0]) : toStudly(ep.operationId);
    if (!name) continue;
    if (!map.has(name)) map.set(name, { name, hasCreate: false, hasUpdate: false, hasDelete: false });
    const g = map.get(name)!;
    if (ep.method === "post") g.hasCreate = true;
    if (ep.method === "put" || ep.method === "patch") g.hasUpdate = true;
    if (ep.method === "delete") g.hasDelete = true;
  }
  return [...map.values()];
}

// ─── Symfony EventSubscriber ──────────────────────────────────────────────────

function symfonyEventSubscriberClass(resource: string, hasCreate: boolean, hasUpdate: boolean, hasDelete: boolean): string {
  const imports: string[] = [];
  const subscriptions: string[] = [];
  const methods: string[] = [];

  if (hasCreate) {
    imports.push(`use App\\Event\\Generated\\${resource}CreatedEvent;`);
    subscriptions.push(`            ${resource}CreatedEvent::class => 'on${resource}Created',`);
    methods.push(`    public function on${resource}Created(${resource}CreatedEvent $event): void\n    {\n        // TODO: react to ${resource} created (id: $event->resourceId)\n    }`);
  }
  if (hasUpdate) {
    imports.push(`use App\\Event\\Generated\\${resource}UpdatedEvent;`);
    subscriptions.push(`            ${resource}UpdatedEvent::class => 'on${resource}Updated',`);
    methods.push(`    public function on${resource}Updated(${resource}UpdatedEvent $event): void\n    {\n        // TODO: react to ${resource} updated (id: $event->resourceId)\n    }`);
  }
  if (hasDelete) {
    imports.push(`use App\\Event\\Generated\\${resource}DeletedEvent;`);
    subscriptions.push(`            ${resource}DeletedEvent::class => 'on${resource}Deleted',`);
    methods.push(`    public function on${resource}Deleted(${resource}DeletedEvent $event): void\n    {\n        // TODO: react to ${resource} deleted (id: $event->resourceId)\n    }`);
  }

  const importsBlock = imports.length ? imports.join("\n") + "\n" : "";
  const subscriptionsBlock = subscriptions.join("\n");
  const methodsBlock = methods.join("\n\n");

  return `<?php

namespace App\\EventSubscriber\\Generated;

${importsBlock}use Symfony\\Component\\EventDispatcher\\EventSubscriberInterface;

class ${resource}EventSubscriber implements EventSubscriberInterface
{
    public static function getSubscribedEvents(): array
    {
        return [
${subscriptionsBlock}
        ];
    }

${methodsBlock}
}
`;
}

export function generateSymfonyEventSubscribers(contract: ApiContract, outPath: string): string[] {
  const resources = inferResources(contract);
  const generated: string[] = [];
  const dir = path.join(outPath, "src", "EventSubscriber", "Generated");
  ensureDir(dir);

  for (const r of resources) {
    if (!r.hasCreate && !r.hasUpdate && !r.hasDelete) continue;
    const filePath = path.join(dir, `${r.name}EventSubscriber.php`);
    fs.writeFileSync(filePath, symfonyEventSubscriberClass(r.name, r.hasCreate, r.hasUpdate, r.hasDelete), "utf8");
    generated.push(filePath);
  }

  return generated;
}

// ─── Laravel Guard ────────────────────────────────────────────────────────────

function laravelApiTokenGuard(): string {
  return `<?php

namespace App\\Guards\\Generated;

use Illuminate\\Auth\\GuardHelpers;
use Illuminate\\Contracts\\Auth\\Guard;
use Illuminate\\Contracts\\Auth\\UserProvider;
use Illuminate\\Http\\Request;

class ApiTokenGuard implements Guard
{
    use GuardHelpers;

    public function __construct(
        UserProvider $provider,
        private readonly Request $request,
        private readonly string $inputKey = 'api_token',
        private readonly string $storageKey = 'api_token',
    ) {
        $this->provider = $provider;
    }

    public function user(): mixed
    {
        if ($this->user !== null) {
            return $this->user;
        }

        $token = $this->getTokenForRequest();
        if (!empty($token)) {
            $this->user = $this->provider->retrieveByCredentials([$this->storageKey => $token]);
        }

        return $this->user;
    }

    public function validate(array $credentials = []): bool
    {
        return !empty($credentials[$this->inputKey])
            && $this->provider->retrieveByCredentials($credentials) !== null;
    }

    private function getTokenForRequest(): ?string
    {
        return $this->request->bearerToken()
            ?? $this->request->query($this->inputKey)
            ?? $this->request->input($this->inputKey);
    }
}
`;
}

function laravelGuardServiceProvider(): string {
  return `<?php

namespace App\\Providers;

use Illuminate\\Support\\Facades\\Auth;
use Illuminate\\Support\\ServiceProvider;
use App\\Guards\\Generated\\ApiTokenGuard;

class GuardServiceProvider extends ServiceProvider
{
    public function boot(): void
    {
        Auth::extend('api-token', function ($app, $name, array $config) {
            return new ApiTokenGuard(
                Auth::createUserProvider($config['provider']),
                $app['request'],
            );
        });
    }
}
`;
}

function laravelAuthConfigHint(): string {
  return `<?php

/**
 * Auth configuration hints — generated by BackendBridge.
 * Merge into config/auth.php
 */

return [
    // Add to 'guards' array:
    'guards' => [
        'api' => [
            'driver'   => 'api-token',  // registered in GuardServiceProvider
            'provider' => 'users',
        ],
    ],

    // Register GuardServiceProvider in config/app.php → 'providers':
    // App\\Providers\\GuardServiceProvider::class,
];
`;
}

export function generateLaravelGuard(outPath: string): string[] {
  const generated: string[] = [];

  const guardDir = path.join(outPath, "app", "Guards", "Generated");
  const providerDir = path.join(outPath, "app", "Providers");
  const configDir = path.join(outPath, "config");

  ensureDir(guardDir);
  ensureDir(providerDir);
  ensureDir(configDir);

  const guardPath = path.join(guardDir, "ApiTokenGuard.php");
  fs.writeFileSync(guardPath, laravelApiTokenGuard(), "utf8");
  generated.push(guardPath);

  const providerPath = path.join(providerDir, "GuardServiceProvider.php");
  fs.writeFileSync(providerPath, laravelGuardServiceProvider(), "utf8");
  generated.push(providerPath);

  const configPath = path.join(configDir, "auth.generated.php");
  fs.writeFileSync(configPath, laravelAuthConfigHint(), "utf8");
  generated.push(configPath);

  return generated;
}

// ─── Laravel ServiceProvider ──────────────────────────────────────────────────

function laravelGeneratedServiceProvider(resources: string[]): string {
  const binds = resources
    .map((r) => `        // $this->app->bind(${r}Contract::class, ${r}Impl::class);`)
    .join("\n");

  return `<?php

namespace App\\Providers\\Generated;

use Illuminate\\Support\\ServiceProvider;

class GeneratedServiceProvider extends ServiceProvider
{
    /** @var array<string, string> */
    public array $bindings = [];

    public function register(): void
    {
${binds}
    }

    public function boot(): void
    {
        // TODO: boot logic — macros, observers, event listeners, etc.
    }
}
`;
}

export function generateLaravelServiceProvider(contract: ApiContract, outPath: string): string[] {
  const resources = inferResources(contract).map((r) => r.name);
  const dir = path.join(outPath, "app", "Providers", "Generated");
  ensureDir(dir);

  const filePath = path.join(dir, "GeneratedServiceProvider.php");
  fs.writeFileSync(filePath, laravelGeneratedServiceProvider(resources), "utf8");
  return [filePath];
}

// ─── Laravel ResourceCollection ───────────────────────────────────────────────

function laravelResourceCollection(resource: string): string {
  return `<?php

namespace App\\Http\\Resources\\Generated;

use Illuminate\\Http\\Request;
use Illuminate\\Http\\Resources\\Json\\ResourceCollection;

class ${resource}Collection extends ResourceCollection
{
    public string $collects = ${resource}Resource::class;

    /** @return array<string, mixed> */
    public function toArray(Request $request): array
    {
        return [
            'data' => $this->collection,
            'meta' => [
                'total'        => $this->total(),
                'per_page'     => $this->perPage(),
                'current_page' => $this->currentPage(),
                'last_page'    => $this->lastPage(),
            ],
            'links' => [
                'first' => $this->url(1),
                'last'  => $this->url($this->lastPage()),
                'prev'  => $this->previousPageUrl(),
                'next'  => $this->nextPageUrl(),
            ],
        ];
    }
}
`;
}

export function generateLaravelResourceCollections(contract: ApiContract, outPath: string): string[] {
  const resources = inferResources(contract).map((r) => r.name);
  const generated: string[] = [];
  const dir = path.join(outPath, "app", "Http", "Resources", "Generated");
  ensureDir(dir);

  for (const resource of resources) {
    const filePath = path.join(dir, `${resource}Collection.php`);
    fs.writeFileSync(filePath, laravelResourceCollection(resource), "utf8");
    generated.push(filePath);
  }

  return generated;
}
