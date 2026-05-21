import fs from "node:fs";
import path from "node:path";

function ensureDir(dirPath: string): void {
  fs.mkdirSync(dirPath, { recursive: true });
}

function testFileContent(rootExpression: string): string {
  return `<?php

declare(strict_types=1);

use PHPUnit\\Framework\\TestCase;

final class GeneratedCodeTest extends TestCase
{
    private function generatedRoot(): string
    {
        $root = ${rootExpression};
        if (!is_string($root) || $root === '') {
            throw new RuntimeException('Generated root directory is not configured.');
        }

        $realPath = realpath($root);
        return $realPath !== false ? $realPath : $root;
    }

    /**
     * @dataProvider providePhpFiles
     */
    public function testGeneratedPhpFilesHaveValidSyntax(string $filePath): void
    {
        $command = escapeshellarg(PHP_BINARY) . ' -l ' . escapeshellarg($filePath);
        $output = [];
        $exitCode = 0;
        exec($command, $output, $exitCode);

        $this->assertSame(0, $exitCode, implode(PHP_EOL, $output));
        $this->assertNotEmpty($output);
        $this->assertStringContainsString('No syntax errors detected', implode(PHP_EOL, $output));
    }

    public function providePhpFiles(): array
    {
        $root = $this->generatedRoot();
        if (!is_dir($root)) {
            return [];
        }

        $files = [];
        $iterator = new RecursiveIteratorIterator(
            new RecursiveDirectoryIterator($root, FilesystemIterator::SKIP_DOTS)
        );

        foreach ($iterator as $fileInfo) {
            if (!$fileInfo->isFile()) {
                continue;
            }

            if (strtolower($fileInfo->getExtension()) !== 'php') {
                continue;
            }

            $pathName = $fileInfo->getPathname();
            if (str_contains($pathName, DIRECTORY_SEPARATOR . 'vendor' . DIRECTORY_SEPARATOR)) {
                continue;
            }

            $files[] = [$pathName];
        }

        return $files;
    }
}
`;
}

function phpunitXmlContent(rootRelativePath: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<phpunit bootstrap="vendor/autoload.php" colors="true" cacheResult="false">
  <testsuites>
    <testsuite name="BackendBridge Generated Code">
      <directory>tests</directory>
    </testsuite>
  </testsuites>
  <php>
    <env name="BACKENDBRIDGE_GENERATED_ROOT" value="${rootRelativePath}" />
  </php>
</phpunit>
`;
}

export function generatePhpUnitSkeleton(outPath: string, rootExpression?: string): string[] {
  const generatedFiles: string[] = [];
  const testsDir = path.join(outPath, "tests");
  ensureDir(testsDir);

  const testFile = path.join(testsDir, "GeneratedCodeTest.php");
  fs.writeFileSync(testFile, testFileContent(rootExpression ?? "getenv('BACKENDBRIDGE_GENERATED_ROOT') ?: dirname(__DIR__)"), "utf8");
  generatedFiles.push(testFile);

  const phpunitXml = path.join(outPath, "phpunit.xml.dist");
  fs.writeFileSync(phpunitXml, phpunitXmlContent("."), "utf8");
  generatedFiles.push(phpunitXml);

  return generatedFiles;
}