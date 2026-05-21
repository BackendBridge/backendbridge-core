<?php
// Extract controller method bodies using nikic/php-parser.
// Returns JSON array: [{file, class, method, params, body, startLine, endLine}]
// Usage:
//   php parse_method_bodies.php symfony /path/to/src/Controller
//   php parse_method_bodies.php laravel /path/to/app/Http/Controllers

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
use PhpParser\PrettyPrinter\Standard as PrettyPrinter;

if ($argc < 3) {
    echo json_encode([]);
    exit(0);
}

$framework = strtolower($argv[1]);
$targetPath = $argv[2];

$parser  = (new ParserFactory())->create(ParserFactory::PREFER_PHP7);
$printer = new PrettyPrinter();

function collectPhpFiles(string $path): array {
    if (!file_exists($path)) return [];
    if (is_file($path)) return [$path];
    $it = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($path));
    $files = [];
    foreach ($it as $f) {
        if ($f->isFile() && strtolower($f->getExtension()) === 'php') $files[] = $f->getPathname();
    }
    return $files;
}

function getTypeHint(?\PhpParser\Node $type): string {
    if ($type === null) return '';
    if ($type instanceof Node\Name) return $type->toString();
    if ($type instanceof Node\Identifier) return $type->toString();
    if ($type instanceof Node\NullableType) return '?' . getTypeHint($type->type);
    if ($type instanceof Node\UnionType) return implode('|', array_map('getTypeHint', $type->types));
    return '';
}

$results = [];

$dirs = match($framework) {
    'symfony' => [$targetPath],
    'laravel' => [$targetPath],
    default   => [$targetPath],
};

foreach ($dirs as $dir) {
    foreach (collectPhpFiles($dir) as $file) {
        // Only process controller files
        $basename = basename($file, '.php');
        if ($framework === 'symfony' && !str_ends_with($basename, 'Controller')) continue;
        if ($framework === 'laravel' && !str_ends_with($basename, 'Controller')) continue;

        $code = @file_get_contents($file);
        if (!$code) continue;
        try {
            $ast = $parser->parse($code);
        } catch (\PhpParser\Error $e) {
            continue;
        }
        if (!$ast) continue;

        $lines = explode("\n", $code);

        // Walk AST for class methods
        $traverser = new NodeTraverser();
        $visitor = new class($basename, $file, $lines, $printer, $results) extends NodeVisitorAbstract {
            private string $className;
            private string $file;
            private array $lines;
            private PrettyPrinter $printer;
            public array $results;
            private ?string $currentClass = null;

            public function __construct(string $cls, string $file, array $lines, PrettyPrinter $printer, array &$results) {
                $this->className = $cls;
                $this->file = $file;
                $this->lines = $lines;
                $this->printer = $printer;
                $this->results = &$results;
            }

            public function enterNode(Node $node) {
                if ($node instanceof Node\Stmt\Class_) {
                    $this->currentClass = $node->name?->toString() ?? $this->className;
                }
                if ($node instanceof Node\Stmt\ClassMethod && $this->currentClass) {
                    $methodName = $node->name->toString();
                    // Skip magic methods and non-public methods
                    if (str_starts_with($methodName, '__') || !$node->isPublic()) return;

                    // Extract params
                    $params = [];
                    foreach ($node->params as $param) {
                        $type = getTypeHint($param->type);
                        $paramName = '$' . ($param->var instanceof Node\Expr\Variable ? $param->var->name : '');
                        $params[] = ($type ? "$type " : '') . $paramName;
                    }

                    // Extract body as source text
                    $body = '';
                    if ($node->stmts !== null) {
                        $startLine = $node->getStartLine();
                        $endLine   = $node->getEndLine();
                        // Get raw source lines for the method body (between braces)
                        $bodyLines = array_slice($this->lines, $startLine, $endLine - $startLine - 1);
                        $body = implode("\n", $bodyLines);
                        // Clean up: remove excessive leading whitespace keeping relative indentation
                        $indentLen = PHP_INT_MAX;
                        foreach (array_filter($bodyLines, 'strlen') as $line) {
                            $trimmed = ltrim($line);
                            if ($trimmed === '') continue;
                            $indentLen = min($indentLen, strlen($line) - strlen($trimmed));
                        }
                        if ($indentLen < PHP_INT_MAX) {
                            $bodyLines = array_map(fn($l) => substr($l, min($indentLen, strlen($l))), $bodyLines);
                        }
                        $body = implode("\n", $bodyLines);
                    }

                    $this->results[] = [
                        'file'      => $this->file,
                        'class'     => $this->currentClass,
                        'method'    => $methodName,
                        'params'    => $params,
                        'body'      => $body,
                        'startLine' => $node->getStartLine(),
                        'endLine'   => $node->getEndLine(),
                    ];
                }
            }

            public function leaveNode(Node $node) {
                if ($node instanceof Node\Stmt\Class_) {
                    $this->currentClass = null;
                }
            }
        };
        $traverser->addVisitor($visitor);
        $traverser->traverse($ast);
    }
}

echo json_encode($results, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
