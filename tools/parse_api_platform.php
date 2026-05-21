<?php
// Robust PHP helper using nikic/php-parser to extract ApiPlatform operations.
// Requires: run `composer install` in the tools/ directory first.
// Usage: php parse_api_platform.php /path/to/FileOrDir.php

$cwd = __DIR__;
$autoload = $cwd . '/vendor/autoload.php';
if (!file_exists($autoload)) {
    echo json_encode(["error" => "composer_autoload_missing", "message" => "Run 'composer install' in tools/ directory to install nikic/php-parser."]);
    exit(0);
}

require $autoload;

use PhpParser\ParserFactory;
use PhpParser\Node;
use PhpParser\NodeTraverser;
use PhpParser\NodeVisitorAbstract;

if ($argc < 2) {
    echo json_encode([]);
    exit(0);
}

$path = $argv[1];

$files = [];
if (is_dir($path)) {
    $it = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($path));
    foreach ($it as $f) {
        if ($f->isFile() && strtolower($f->getExtension()) === 'php') $files[] = $f->getPathname();
    }
} else if (is_file($path)) {
    $files[] = $path;
} else {
    echo json_encode([]);
    exit(0);
}

$parser = (new ParserFactory())->create(ParserFactory::PREFER_PHP7);
$results = [];

foreach ($files as $file) {
    $code = @file_get_contents($file);
    if ($code === false) continue;
    try {
        $ast = $parser->parse($code);
    } catch (\PhpParser\Error $e) {
        continue;
    }

    $traverser = new NodeTraverser();
    $visitor = new class($file, $results) extends NodeVisitorAbstract {
        private $file;
        public $resultsRef;
        public function __construct($file, &$results) {
            $this->file = $file;
            $this->resultsRef = &$results;
        }

        private function recordOp($method, $path, $opName) {
            $this->resultsRef[] = [
                'method' => strtolower($method),
                'path' => $path,
                'operationId' => $opName ?: strtolower($method) . '_' . preg_replace('/[^a-z0-9_]+/i', '_', basename($this->file)),
            ];
        }

        public function enterNode(Node $node) {
            // Look for attribute usages like #[Get(uriTemplate: "/...")]
            if ($node instanceof Node\Stmt\Class_) {
                foreach ($node->attrGroups as $ag) {
                    foreach ($ag->attrs as $attr) {
                        $name = $attr->name->toString();
                        if (stripos($name, 'ApiResource') !== false) {
                            // check args for 'operations' => array of new Get/Post
                            foreach ($attr->args as $arg) {
                                if ($arg->name && $arg->name->toString() === 'operations' && $arg->value instanceof Node\Expr\Array_) {
                                    foreach ($arg->value->items as $item) {
                                        if ($item && $item->value instanceof Node\Expr\New_) {
                                            $classNode = $item->value->class;
                                            $short = is_object($classNode) ? $classNode->toString() : (string)$classNode;
                                            $method = $this->guessMethodFromName($short);
                                            $path = $this->findUriInArgs($item->value->args) ?: '/resource';
                                            $this->recordOp($method, $path, null);
                                        }
                                    }
                                }
                            }
                        }
                        // Attributes directly named Get/Post on class
                        if (preg_match('/Get|Post|Put|Patch|Delete/i', $name)) {
                            $method = $this->guessMethodFromName($name);
                            $path = $this->findUriInArgs($attr->args) ?: '/resource';
                            $this->recordOp($method, $path, null);
                        }
                    }
                }
            }

            // New expressions like new Get(...)
            if ($node instanceof Node\Expr\New_) {
                $classNode = $node->class;
                $short = is_object($classNode) ? $classNode->toString() : (string)$classNode;
                if (preg_match('/Get|Post|Put|Patch|Delete/i', $short)) {
                    $method = $this->guessMethodFromName($short);
                    $path = $this->findUriInArgs($node->args) ?: '/resource';
                    $this->recordOp($method, $path, null);
                }
            }
        }

        private function guessMethodFromName($name) {
            $n = strtolower($name);
            if (strpos($n, 'post') !== false) return 'post';
            if (strpos($n, 'put') !== false) return 'put';
            if (strpos($n, 'patch') !== false) return 'patch';
            if (strpos($n, 'delete') !== false) return 'delete';
            return 'get';
        }

        private function findUriInArgs($args) {
            foreach ($args as $a) {
                if ($a->name && $a->name->toString() === 'uriTemplate') {
                    if ($a->value instanceof Node\Scalar\String_) return $a->value->value;
                }
                // support first string arg
                if (!$a->name && $a->value instanceof Node\Scalar\String_) return $a->value->value;
            }
            return null;
        }
    };

    $traverser->addVisitor($visitor);
    $traverser->traverse($ast ?: []);
    // merge results collected by visitor
    if (!empty($visitor->resultsRef)) {
        foreach ($visitor->resultsRef as $r) $results[] = $r;
    }
}

echo json_encode($results);

?>
