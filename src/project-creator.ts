import { spawnSync, execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { checkSetup } from "./setup-checker.js";

export interface CreateResult {
  framework: "laravel" | "symfony";
  projectPath: string;
  success: boolean;
  message: string;
}

function requirePhpAndComposer(): void {
  const status = checkSetup();
  if (!status.php.installed) throw new Error("PHP is not installed. Install PHP 8.2+ before creating a project.");
  if (!status.composer.installed) throw new Error("Composer is not installed. Visit https://getcomposer.org to install.");
}

export function createLaravelProject(name: string, outDir: string): CreateResult {
  requirePhpAndComposer();
  const projectPath = path.resolve(outDir, name);

  if (fs.existsSync(projectPath)) {
    throw new Error(`Directory already exists: ${projectPath}`);
  }

  const status = checkSetup();

  // Prefer `laravel new` (fast), fall back to composer create-project
  let result;
  if (status.laravelInstaller.installed) {
    result = spawnSync("laravel", ["new", name, "--no-interaction"], {
      cwd: path.resolve(outDir),
      stdio: "inherit",
      shell: true,
    });
  } else {
    result = spawnSync(
      "composer",
      ["create-project", "laravel/laravel", name, "--no-interaction", "--prefer-dist"],
      { cwd: path.resolve(outDir), stdio: "inherit", shell: true },
    );
  }

  if (result.status !== 0) {
    throw new Error(`Failed to create Laravel project '${name}'. Check the output above.`);
  }

  return {
    framework: "laravel",
    projectPath,
    success: true,
    message: `Laravel project created at ${projectPath}`,
  };
}

export function createSymfonyProject(
  name: string,
  outDir: string,
  type: "webapp" | "api" | "skeleton" = "api",
): CreateResult {
  requirePhpAndComposer();
  const projectPath = path.resolve(outDir, name);

  if (fs.existsSync(projectPath)) {
    throw new Error(`Directory already exists: ${projectPath}`);
  }

  const status = checkSetup();
  let result;

  if (status.symfonyCli.installed) {
    const flags = type === "webapp" ? ["--webapp"] : ["--no-interaction"];
    result = spawnSync("symfony", ["new", name, ...flags], {
      cwd: path.resolve(outDir),
      stdio: "inherit",
      shell: true,
    });
  } else {
    // Fall back to composer
    const skeleton = type === "webapp" ? "symfony/website-skeleton" : "symfony/skeleton";
    result = spawnSync(
      "composer",
      ["create-project", skeleton, name, "--no-interaction", "--prefer-dist"],
      { cwd: path.resolve(outDir), stdio: "inherit", shell: true },
    );
  }

  if (result.status !== 0) {
    throw new Error(`Failed to create Symfony project '${name}'.`);
  }

  return {
    framework: "symfony",
    projectPath,
    success: true,
    message: `Symfony ${type} project created at ${projectPath}`,
  };
}

export function installLaravelPackages(projectPath: string, packages: string[]): void {
  if (!packages.length) return;
  spawnSync("composer", ["require", ...packages, "--no-interaction"], {
    cwd: projectPath,
    stdio: "inherit",
    shell: true,
  });
}

export function installSymfonyPackages(projectPath: string, packages: string[]): void {
  if (!packages.length) return;
  spawnSync("composer", ["require", ...packages, "--no-interaction"], {
    cwd: projectPath,
    stdio: "inherit",
    shell: true,
  });
}

/** Run `php artisan migrate` inside a Laravel project. */
export function laravelMigrate(projectPath: string): void {
  spawnSync("php", ["artisan", "migrate", "--no-interaction", "--force"], {
    cwd: projectPath,
    stdio: "inherit",
    shell: true,
  });
}

/** Run `php bin/console doctrine:migrations:migrate` inside a Symfony project. */
export function symfonyMigrate(projectPath: string): void {
  spawnSync("php", ["bin/console", "doctrine:migrations:migrate", "--no-interaction"], {
    cwd: projectPath,
    stdio: "inherit",
    shell: true,
  });
}
