import fs from "node:fs";
import path from "node:path";
import { ensureDir } from "./utils.js";

// ─── Laravel ─────────────────────────────────────────────────────────────────

function laravelJwtMiddleware(): string {
  return `<?php

namespace App\\Http\\Middleware;

use Closure;
use Illuminate\\Http\\Request;
use Illuminate\\Support\\Facades\\Auth;
use Symfony\\Component\\HttpFoundation\\Response;

/**
 * JWT / Sanctum authentication guard.
 * Swap the guard name ('api', 'sanctum', ...) to match your setup.
 */
class AuthenticateApi
{
    public function handle(Request $request, Closure $next, string $guard = 'api'): Response
    {
        if (!Auth::guard($guard)->check()) {
            return response()->json(['message' => 'Unauthenticated.'], 401);
        }

        return $next($request);
    }
}
`;
}

function laravelThrottleMiddleware(): string {
  return `<?php

namespace App\\Http\\Middleware;

use Closure;
use Illuminate\\Cache\\RateLimiting\\Limit;
use Illuminate\\Http\\Request;
use Illuminate\\Support\\Facades\\RateLimiter;
use Symfony\\Component\\HttpFoundation\\Response;

/**
 * Custom throttle middleware. Register in bootstrap/app.php or Kernel.php.
 * Default: 60 requests per minute per IP.
 */
class ThrottleApi
{
    public function handle(Request $request, Closure $next, int $maxAttempts = 60, int $decayMinutes = 1): Response
    {
        $key = $request->ip() . '|' . $request->route()?->getName();

        if (RateLimiter::tooManyAttempts($key, $maxAttempts)) {
            $seconds = RateLimiter::availableIn($key);
            return response()->json([
                'message' => 'Too Many Requests.',
                'retry_after' => $seconds,
            ], 429);
        }

        RateLimiter::hit($key, $decayMinutes * 60);
        return $next($request);
    }
}
`;
}

function laravelCorsMiddleware(): string {
  return `<?php

namespace App\\Http\\Middleware;

use Closure;
use Illuminate\\Http\\Request;
use Symfony\\Component\\HttpFoundation\\Response;

/**
 * CORS middleware. For production use fruitcake/laravel-cors or the built-in Sanctum CORS.
 */
class Cors
{
    public function handle(Request $request, Closure $next): Response
    {
        $response = $next($request);
        $response->headers->set('Access-Control-Allow-Origin', '*');
        $response->headers->set('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
        $response->headers->set('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');

        if ($request->isMethod('OPTIONS')) {
            return response('', 204)->withHeaders($response->headers->all());
        }

        return $response;
    }
}
`;
}

// ─── Symfony ─────────────────────────────────────────────────────────────────

function symfonyJwtSubscriber(): string {
  return `<?php

namespace App\\EventSubscriber;

use Symfony\\Component\\EventDispatcher\\EventSubscriberInterface;
use Symfony\\Component\\HttpFoundation\\JsonResponse;
use Symfony\\Component\\HttpKernel\\Event\\RequestEvent;
use Symfony\\Component\\HttpKernel\\KernelEvents;
use Symfony\\Component\\Security\\Core\\Authentication\\Token\\Storage\\TokenStorageInterface;

/**
 * JWT auth subscriber. With lexik/jwt-authentication-bundle this is handled
 * automatically — this stub is for custom guards or pre-authentication checks.
 *
 * Register: services.yaml → App\\EventSubscriber\\JwtAuthSubscriber: ~
 */
class JwtAuthSubscriber implements EventSubscriberInterface
{
    public function __construct(
        private readonly TokenStorageInterface $tokenStorage,
    ) {}

    public static function getSubscribedEvents(): array
    {
        return [
            KernelEvents::REQUEST => ['onKernelRequest', 8],
        ];
    }

    public function onKernelRequest(RequestEvent $event): void
    {
        if (!$event->isMainRequest()) {
            return;
        }

        $request = $event->getRequest();
        $token = $this->tokenStorage->getToken();

        // Example: require authentication on /api/* routes
        if (str_starts_with($request->getPathInfo(), '/api/') && $token === null) {
            $event->setResponse(new JsonResponse(['message' => 'Unauthenticated.'], 401));
        }
    }
}
`;
}

function symfonyThrottleSubscriber(): string {
  return `<?php

namespace App\\EventSubscriber;

use Symfony\\Component\\EventDispatcher\\EventSubscriberInterface;
use Symfony\\Component\\HttpFoundation\\JsonResponse;
use Symfony\\Component\\HttpKernel\\Event\\RequestEvent;
use Symfony\\Component\\HttpKernel\\KernelEvents;
use Symfony\\Component\\RateLimiter\\RateLimiterFactory;

/**
 * API rate-limiting subscriber.
 * Requires symfony/rate-limiter: composer require symfony/rate-limiter
 * Configure a limiter named 'api' in config/packages/rate_limiter.yaml.
 */
class ThrottleSubscriber implements EventSubscriberInterface
{
    public function __construct(
        private readonly RateLimiterFactory $apiLimiter,
    ) {}

    public static function getSubscribedEvents(): array
    {
        return [KernelEvents::REQUEST => 'onKernelRequest'];
    }

    public function onKernelRequest(RequestEvent $event): void
    {
        if (!$event->isMainRequest()) return;

        $request = $event->getRequest();
        if (!str_starts_with($request->getPathInfo(), '/api/')) return;

        $limiter = $this->apiLimiter->create($request->getClientIp());
        $limit = $limiter->consume(1);

        if (!$limit->isAccepted()) {
            $event->setResponse(new JsonResponse(['message' => 'Too Many Requests.'], 429));
        }
    }
}
`;
}

function symfonyRateLimiterConfig(): string {
  return `# config/packages/rate_limiter.yaml
# Requires: composer require symfony/rate-limiter
framework:
    rate_limiter:
        api:
            policy: 'sliding_window'
            limit: 60
            interval: '1 minute'
`;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function generateLaravelMiddleware(outPath: string): string[] {
  const dir = path.join(outPath, "app", "Http", "Middleware");
  ensureDir(dir);

  const files: string[] = [];
  const write = (name: string, content: string) => {
    const p = path.join(dir, name);
    fs.writeFileSync(p, content, "utf8");
    files.push(p);
  };

  write("AuthenticateApi.php", laravelJwtMiddleware());
  write("ThrottleApi.php", laravelThrottleMiddleware());
  write("Cors.php", laravelCorsMiddleware());

  return files;
}

export function generateSymfonyMiddleware(outPath: string): string[] {
  const subscriberDir = path.join(outPath, "src", "EventSubscriber");
  const configDir = path.join(outPath, "config", "packages");
  ensureDir(subscriberDir);
  ensureDir(configDir);

  const files: string[] = [];
  const write = (p: string, content: string) => { fs.writeFileSync(p, content, "utf8"); files.push(p); };

  write(path.join(subscriberDir, "JwtAuthSubscriber.php"), symfonyJwtSubscriber());
  write(path.join(subscriberDir, "ThrottleSubscriber.php"), symfonyThrottleSubscriber());
  write(path.join(configDir, "rate_limiter.yaml"), symfonyRateLimiterConfig());

  return files;
}
