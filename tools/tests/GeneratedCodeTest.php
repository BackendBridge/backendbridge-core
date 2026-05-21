<?php

declare(strict_types=1);

use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

final class GeneratedCodeTest extends TestCase
{
    private static function generatedRoot(): string
    {
        $root = getenv('BACKENDBRIDGE_GENERATED_ROOT');
        if (!is_string($root) || $root === '') {
            throw new RuntimeException('BACKENDBRIDGE_GENERATED_ROOT is not configured.');
        }

        $realPath = realpath($root);
        return $realPath !== false ? $realPath : $root;
    }

    #[DataProvider('providePhpFiles')]
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

    public static function providePhpFiles(): array
    {
        try {
            $root = self::generatedRoot();
        } catch (RuntimeException) {
            return [];
        }

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

            $files[$pathName] = [$pathName];
        }

        return $files;
    }
}
