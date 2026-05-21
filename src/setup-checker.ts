import { execSync, spawnSync } from "node:child_process";
import os from "node:os";

export interface ToolStatus {
  installed: boolean;
  version?: string;
}

export interface SetupStatus {
  php: ToolStatus;
  composer: ToolStatus;
  laravelInstaller: ToolStatus;
  symfonyCli: ToolStatus;
  node: ToolStatus;
}

function runCommand(cmd: string): string | null {
  try {
    return execSync(cmd, { stdio: "pipe", encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

export function checkSetup(): SetupStatus {
  const phpOut = runCommand("php --version");
  const composerOut = runCommand("composer --version");
  const laravelOut = runCommand("laravel --version") ?? runCommand("laravel");
  const symfonyOut = runCommand("symfony version");
  const nodeOut = runCommand("node --version");

  return {
    php: {
      installed: phpOut !== null,
      version: phpOut?.split("\n")[0]?.match(/PHP (\S+)/)?.[1],
    },
    composer: {
      installed: composerOut !== null,
      version: composerOut?.match(/Composer version (\S+)/)?.[1],
    },
    laravelInstaller: {
      installed: laravelOut !== null,
      version: laravelOut?.match(/Laravel Installer (\S+)/)?.[1],
    },
    symfonyCli: {
      installed: symfonyOut !== null,
      version: symfonyOut?.match(/Symfony CLI version (\S+)/)?.[1] ?? symfonyOut?.split("\n")[0] ?? undefined,
    },
    node: {
      installed: nodeOut !== null,
      version: nodeOut?.replace("v", ""),
    },
  };
}

export function installLaravelInstaller(): boolean {
  const result = spawnSync("composer", ["global", "require", "laravel/installer"], {
    stdio: "inherit",
    shell: true,
  });
  return result.status === 0;
}

export function getSymfonyCliInstallInstructions(): string {
  const platform = os.platform();
  if (platform === "win32") {
    return "Download from https://symfony.com/download (Scoop: scoop install symfony-cli)";
  }
  if (platform === "darwin") {
    return "brew install symfony-cli/tap/symfony-cli  OR  curl -sS https://get.symfony.com/cli/installer | bash";
  }
  return "curl -sS https://get.symfony.com/cli/installer | bash  # then add ~/.symfony5/bin to PATH";
}

export function formatSetupReport(status: SetupStatus): string {
  const icon = (ok: boolean) => (ok ? "✓" : "✗");
  const lines = [
    `  ${icon(status.node.installed)} Node.js     ${status.node.version ?? "not found"}`,
    `  ${icon(status.php.installed)} PHP         ${status.php.version ?? "not found"}`,
    `  ${icon(status.composer.installed)} Composer    ${status.composer.version ?? "not found"}`,
    `  ${icon(status.laravelInstaller.installed)} Laravel CLI ${status.laravelInstaller.version ?? "not found"}`,
    `  ${icon(status.symfonyCli.installed)} Symfony CLI ${status.symfonyCli.version ?? "not found"}`,
  ];
  return lines.join("\n");
}
