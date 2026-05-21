<?php
// Parse PHP classes and properties using nikic/php-parser
// Usage: php parse_php_classes.php /path/to/file-or-dir.php

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

        public function enterNode(Node $node) {
            if ($node instanceof Node\Stmt\Class_) {
                $className = ($node->namespacedName ? $node->namespacedName->toString() : null) ?? ($node->name ? $node->name->toString() : basename($this->file));
                $props = [];
                foreach ($node->getProperties() as $p) {
                    foreach ($p->props as $pd) {
                            $name = $pd->name->toString();
                            $type = null;
                            $relation = null;
                            if ($p->type) {
                                $type = is_object($p->type) ? $p->type->toString() : (string)$p->type;
                            } else {
                                // try phpdoc
                                $doc = $p->getDocComment();
                                if ($doc) {
                                    if (preg_match('/@var\s+([A-Za-z0-9_\\\[\]]+)/', $doc->getText(), $m)) {
                                        $type = $m[1];
                                    }
                                    // detect ORM relation annotations in docblock
                                    if (preg_match('/@ORM\\\\(ManyToOne|OneToMany|OneToOne|ManyToMany)\\(([^)]*)\)/', $doc->getText(), $rm)) {
                                        $relType = $rm[1];
                                        $args = $rm[2];
                                        $target = null; $mappedBy = null; $inversedBy = null;
                                        if (preg_match('/targetEntity\s*=\s*"?\\?([A-Za-z0-9_\\\\]+)"?/', $args, $t)) $target = $t[1];
                                        if (preg_match('/mappedBy\s*=\s*"?([A-Za-z0-9_]+)"?/', $args, $m2)) $mappedBy = $m2[1];
                                        if (preg_match('/inversedBy\s*=\s*"?([A-Za-z0-9_]+)"?/', $args, $m3)) $inversedBy = $m3[1];
                                        $cascade = null; $orphanRemoval = null;
                                        if (preg_match('/cascade\s*=\s*\{([^}]*)\}/', $args, $c)) {
                                            $items = array_map('trim', explode(',', $c[1]));
                                            $items = array_map(function($s){ return trim($s, " \"'"); }, $items);
                                            $cascade = $items;
                                        } else if (preg_match('/cascade\s*=\s*(\w+)/', $args, $c2)) {
                                            $cascade = [trim($c2[1], " \"'")];
                                        }
                                        if (preg_match('/orphanRemoval\s*=\s*(true|false)/i', $args, $or)) {
                                            $orphanRemoval = strtolower($or[1]) === 'true';
                                        }
                                        $relation = ['type'=>$relType, 'target'=>$target, 'mappedBy'=>$mappedBy, 'inversedBy'=>$inversedBy, 'cascade'=>$cascade, 'orphanRemoval'=>$orphanRemoval];
                                    }
                                    // detect Column metadata
                                    if (preg_match('/@ORM\\\\Column\(([^)]*)\)/', $doc->getText(), $cm)) {
                                        $colArgs = $cm[1];
                                        $colType = null; $colLength = null; $colNullable = false; $colUnique = false; $colDefault = null; $colIndex = false;
                                        if (preg_match('/type\s*=\s*"?([a-zA-Z0-9_]+)"?/', $colArgs, $t)) $colType = $t[1];
                                        if (preg_match('/length\s*=\s*([0-9]+)/', $colArgs, $l)) $colLength = intval($l[1]);
                                        if (preg_match('/nullable\s*=\s*(true|false)/i', $colArgs, $n)) $colNullable = strtolower($n[1]) === 'true';
                                        if (preg_match('/unique\s*=\s*(true|false)/i', $colArgs, $u)) $colUnique = strtolower($u[1]) === 'true';
                                        // options default patterns: options={"default"=...} or options={"default":"..."}
                                        if (preg_match('/default\s*[:=]\s*"([^"]*)"/', $colArgs, $d1)) $colDefault = $d1[1];
                                        else if (preg_match('/default\s*[:=]\s*([^,\)\s]+)/', $colArgs, $d2)) $colDefault = $d2[1];
                                        // simple index detection
                                        if (preg_match('/@ORM\\\\Index\(/', $doc->getText()) || preg_match('/@index/i', $doc->getText())) $colIndex = true;
                                        $column = ['type'=>$colType, 'length'=>$colLength, 'nullable'=>$colNullable, 'unique'=>$colUnique, 'default'=>$colDefault, 'index'=>$colIndex];
                                    } else {
                                        $column = null;
                                    }
                                }
                            else {
                                $column = null;
                            }
                            }
                            // also check PHP 8 attributes on the property
                            if (!$relation && !empty($p->attrGroups)) {
                                foreach ($p->attrGroups as $ag) {
                                    foreach ($ag->attrs as $attr) {
                                        $nameStr = is_object($attr->name) ? $attr->name->toString() : (string)$attr->name;
                                        if (preg_match('/ManyToOne|OneToMany|OneToOne|ManyToMany/i', $nameStr, $mm)) {
                                            $relType = $mm[0];
                                            // get args
                                            $argsText = '';
                                            foreach ($attr->args as $a) {
                                                if ($a->name) {
                                                    $argsText .= $a->name->toString() . '=';
                                                }
                                                if ($a->value instanceof Node\Scalar\String_) $argsText .= $a->value->value . ',';
                                            }
                                            $target = null; $mappedBy = null; $inversedBy = null;
                                            if (preg_match('/targetEntity=.*?([A-Za-z0-9_\\\\]+)/', $argsText, $t)) $target = $t[1];
                                            $relation = ['type'=>$relType, 'target'=>$target, 'mappedBy'=>$mappedBy, 'inversedBy'=>$inversedBy];
                                        }
                                    }
                                }
                            }
                            $props[] = ['name' => $name, 'type' => $type, 'relation' => $relation, 'column' => isset($column) ? $column : null];
                        }
                }
                $this->resultsRef[] = ['file' => $this->file, 'class' => $className, 'properties' => $props];
            }
        }
    };

    $traverser->addVisitor($visitor);
    $traverser->traverse($ast ?: []);
    if (!empty($visitor->resultsRef)) {
        foreach ($visitor->resultsRef as $r) $results[] = $r;
    }
}

echo json_encode($results);

?>