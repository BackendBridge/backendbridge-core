<?php
// Parse Symfony controllers and Laravel route files using nikic/php-parser.
// Returns JSON array of { method, path, operationId, tags, pathParams }.
// Usage:
//   php parse_controllers.php symfony /path/to/src/Controller
//   php parse_controllers.php laravel /path/to/routes/api.php

$cwd = __DIR__;
$autoload = $cwd . '/vendor/autoload.php';
if (!file_exists($autoload)) {
    echo json_encode(["error" => "composer_autoload_missing"]);
    exit(0);
}

require $autoload;

use PhpParser\ParserFactory;
use PhpParser\Node;
use PhpParser\NodeTraverser;
use PhpParser\NodeVisitorAbstract;

if ($argc < 3) {
    echo json_encode([]);
    exit(0);
}

$framework = strtolower($argv[1]);
$targetPath = $argv[2];

$parser = (new ParserFactory())->create(ParserFactory::PREFER_PHP7);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function normalizePath(string $p): string {
    return str_starts_with($p, '/') ? $p : '/' . $p;
}

function pathParamsFrom(string $path): array {
    preg_match_all('/\{(\w+)\??\}/', $path, $m);
    return $m[1];
}

function tagFromPath(string $path, string $fallback): string {
    $segs = array_filter(explode('/', $path), fn($s) => $s !== '' && !str_starts_with($s, '{'));
    $first = reset($segs);
    return $first ? ucfirst($first) : $fallback;
}

function collectFiles(string $path): array {
    if (is_file($path)) return [$path];
    if (!is_dir($path)) return [];
    $result = [];
    $it = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($path));
    foreach ($it as $f) {
        if ($f->isFile() && strtolower($f->getExtension()) === 'php') $result[] = $f->getPathname();
    }
    return $result;
}

function getAttrArgs(Node\Attribute $attr): array {
    $args = [];
    foreach ($attr->args as $arg) {
        $key = $arg->name ? $arg->name->toString() : null;
        $val = null;
        if ($arg->value instanceof Node\Scalar\String_) {
            $val = $arg->value->value;
        } elseif ($arg->value instanceof Node\Expr\Array_) {
            $items = [];
            foreach ($arg->value->items as $item) {
                if ($item && $item->value instanceof Node\Scalar\String_) {
                    $items[] = $item->value->value;
                }
            }
            $val = $items;
        } elseif ($arg->value instanceof Node\Expr\ClassConstFetch) {
            $val = $arg->value->name instanceof Node\Identifier
                ? $arg->value->name->toString()
                : null;
        }
        if ($key !== null) {
            $args[$key] = $val;
        } elseif ($val !== null) {
            $args[] = $val;
        }
    }
    return $args;
}

// ─── Symfony controller extraction ───────────────────────────────────────────

function extractSymfony(string $path, $parser): array {
    $endpoints = [];
    foreach (collectFiles($path) as $file) {
        if (!str_contains($file, 'Controller')) continue;
        $code = @file_get_contents($file);
        if (!$code) continue;
        try { $ast = $parser->parse($code); } catch (\PhpParser\Error $e) { continue; }
        if (!$ast) continue;

        // Find class-level Route prefix
        $classPrefix = '';
        $classTag    = 'Api';
        foreach ($ast as $node) {
            if (!($node instanceof Node\Stmt\Namespace_)) continue;
            foreach ($node->stmts as $stmt) {
                if (!($stmt instanceof Node\Stmt\Class_)) continue;

                // Class-level #[Route] prefix
                foreach ($stmt->attrGroups as $ag) {
                    foreach ($ag->attrs as $attr) {
                        if (!in_array($attr->name->toString(), ['Route', 'Symfony\\Component\\Routing\\Attribute\\Route'])) continue;
                        $args = getAttrArgs($attr);
                        $classPrefix = $args['path'] ?? $args[0] ?? '';
                        $classTag    = tagFromPath($classPrefix ?: '/api', basename($file, 'Controller.php'));
                    }
                }

                // Method-level #[Route]
                foreach ($stmt->getMethods() as $method) {
                    if ($method->isAbstract() || !$method->isPublic()) continue;
                    foreach ($method->attrGroups as $ag) {
                        foreach ($ag->attrs as $attr) {
                            if (!in_array($attr->name->toString(), ['Route', 'Symfony\\Component\\Routing\\Attribute\\Route'])) continue;
                            $args    = getAttrArgs($attr);
                            $subPath = $args['path'] ?? $args[0] ?? '';
                            $name    = $args['name'] ?? null;
                            $methods = (array)($args['methods'] ?? ['GET']);
                            $full    = normalizePath(rtrim($classPrefix, '/') . '/' . ltrim($subPath, '/'));
                            $full    = preg_replace('#/+#', '/', $full);
                            foreach ($methods as $m) {
                                $m = strtolower($m);
                                $endpoints[] = [
                                    'method'      => $m,
                                    'path'        => $full,
                                    'operationId' => $name ?? "{$m}_" . preg_replace('/[^a-z0-9]+/', '_', trim($full, '/')),
                                    'tags'        => [$classTag],
                                    'pathParams'  => pathParamsFrom($full),
                                ];
                            }
                        }
                    }
                }
            }
        }
    }
    return $endpoints;
}

// ─── Laravel route file extraction ───────────────────────────────────────────

function extractLaravel(string $path, $parser): array {
    $endpoints = [];
    $files = is_dir($path)
        ? array_merge(
            is_file("$path/api.php")   ? ["$path/api.php"] : [],
            is_file("$path/web.php")   ? ["$path/web.php"] : [],
            collectFiles($path)
          )
        : [$path];

    foreach (array_unique($files) as $file) {
        if (!file_exists($file)) continue;
        $code = @file_get_contents($file);
        if (!$code) continue;
        try { $ast = $parser->parse($code); } catch (\PhpParser\Error $e) { continue; }
        if (!$ast) continue;

        $traverser = new NodeTraverser();
        $visitor   = new class($endpoints) extends NodeVisitorAbstract {
            public array $endpoints;
            public function __construct(array &$endpoints) { $this->endpoints = &$endpoints; }

            private function getString(Node\Expr $node): ?string {
                return $node instanceof Node\Scalar\String_ ? $node->value : null;
            }

            public function enterNode(Node $node) {
                if (!($node instanceof Node\Expr\StaticCall)) return;
                if (!($node->class instanceof Node\Name) || $node->class->toString() !== 'Route') return;
                $method = strtolower($node->name instanceof Node\Identifier ? $node->name->toString() : '');

                $httpMethods = ['get','post','put','patch','delete','head','options'];
                if (in_array($method, $httpMethods) && isset($node->args[0])) {
                    $rawPath = $this->getString($node->args[0]->value);
                    if (!$rawPath) return;
                    $path = '/' . ltrim($rawPath, '/');
                    $tag  = tagFromPath($path, 'Api');
                    $this->endpoints[] = [
                        'method'      => $method,
                        'path'        => $path,
                        'operationId' => "{$method}_" . preg_replace('/[^a-z0-9]+/', '_', trim($path, '/')),
                        'tags'        => [$tag],
                        'pathParams'  => pathParamsFrom($path),
                    ];
                } elseif (in_array($method, ['resource', 'apiresource']) && isset($node->args[0])) {
                    $rawRes = $this->getString($node->args[0]->value);
                    if (!$rawRes) return;
                    $base = '/' . ltrim($rawRes, '/');
                    $tag  = tagFromPath($base, ucfirst($rawRes));
                    $routes = [
                        ['get',    $base,           "index_{$rawRes}"],
                        ['post',   $base,           "store_{$rawRes}"],
                        ['get',    "$base/{id}",    "show_{$rawRes}"],
                        ['put',    "$base/{id}",    "update_{$rawRes}"],
                        ['delete', "$base/{id}",    "destroy_{$rawRes}"],
                    ];
                    foreach ($routes as [$m, $p, $opId]) {
                        $this->endpoints[] = [
                            'method'      => $m,
                            'path'        => $p,
                            'operationId' => $opId,
                            'tags'        => [$tag],
                            'pathParams'  => pathParamsFrom($p),
                        ];
                    }
                }
            }
        };
        $traverser->addVisitor($visitor);
        $traverser->traverse($ast);
    }
    return $endpoints;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

$results = match($framework) {
    'symfony' => extractSymfony($targetPath, $parser),
    'laravel' => extractLaravel($targetPath, $parser),
    default   => [],
};

// Deduplicate by method+path
$seen = [];
$dedup = [];
foreach ($results as $r) {
    $key = $r['method'] . ':' . $r['path'];
    if (!isset($seen[$key])) {
        $seen[$key] = true;
        $dedup[] = $r;
    }
}

echo json_encode($dedup, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
