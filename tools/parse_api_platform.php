<?php
// Simple PHP helper that scans a PHP file for ApiPlatform operations using token_get_all and regex.
// Usage: php parse_api_platform.php /path/to/File.php

if ($argc < 2) {
    echo json_encode([]);
    exit(0);
}

$path = $argv[1];
if (!file_exists($path)) {
    echo json_encode([]);
    exit(0);
}

$content = file_get_contents($path);
$tokens = token_get_all($content);

// naive: find uriTemplate occurrences and 'new' usages for Get/Post/etc.
$results = [];

// find declared uriTemplate values
preg_match_all('/uriTemplate:\s*[\"\']([^\"\']+)[\"\']/', $content, $uriMatches);
$declared = $uriMatches[1] ?? [];

// find new Get/Post/Put/Patch/Delete occurrences
if (preg_match_all('/new\s+([A-Za-z0-9_\\\\]+)\s*\(([^)]*)\)/', $content, $matches, PREG_SET_ORDER)) {
    foreach ($matches as $m) {
        $class = $m[1];
        $args = $m[2];
        $short = preg_replace('/.*\\\\/', '', $class);
        $op = strtoupper($short);
        $method = 'get';
        if (stripos($short, 'post') !== false) $method = 'post';
        if (stripos($short, 'put') !== false) $method = 'put';
        if (stripos($short, 'patch') !== false) $method = 'patch';
        if (stripos($short, 'delete') !== false) $method = 'delete';

        if (preg_match('/uriTemplate:\s*["\']([^"\']+)["\']/', $args, $u)) {
            $pathstr = $u[1];
        } else {
            $pathstr = $declared[0] ?? '/resource';
        }

        $results[] = [
            'method' => $method,
            'path' => $pathstr,
            'operationId' => strtolower($method) . '_' . strtolower(preg_replace('/[^a-zA-Z0-9]+/', '_', basename($path, '.php')) ) . '_' . preg_replace('/[^a-zA-Z0-9]+/', '_', $pathstr),
        ];
    }
}

// also check attribute-like patterns #[Get(...)]
if (preg_match_all('/#\[([^\]]*Get[^\]]*)\]/i', $content, $attrMatches, PREG_SET_ORDER)) {
    foreach ($attrMatches as $am) {
        if (preg_match('/uriTemplate:\s*["\']([^"\']+)["\']/', $am[1], $u)) {
            $p = $u[1];
        } else {
            $p = $declared[0] ?? '/resource';
        }
        $results[] = ['method' => 'get', 'path' => $p, 'operationId' => 'get_' . strtolower(basename($path, '.php')) . '_' . preg_replace('/[^a-zA-Z0-9]+/', '_', $p)];
    }
}

echo json_encode($results);

?>
