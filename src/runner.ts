import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import fs from "node:fs";
import { checkSetup } from "./setup-checker.js";

export interface RunOptions {
  laravelPath?: string;
  symfonyPath?: string;
  laravelPort?: number;
  symfonyPort?: number;
}

function prefix(tag: string, color: string): string {
  return `\x1b[${color}m[${tag}]\x1b[0m `;
}

function pipeWithPrefix(proc: ChildProcess, tag: string, color: string): void {
  const pre = prefix(tag, "1;36"); // cyan bold for Laravel
  proc.stdout?.on("data", (chunk: Buffer) => {
    process.stdout.write(pre + chunk.toString().replace(/\n/g, `\n${pre}`).trimEnd() + "\n");
  });
  proc.stderr?.on("data", (chunk: Buffer) => {
    process.stderr.write(`\x1b[33m[${tag}]\x1b[0m ${chunk.toString()}`);
  });
}

function spawnLaravel(projectPath: string, port: number): ChildProcess {
  const artisan = path.join(projectPath, "artisan");
  if (!fs.existsSync(artisan)) {
    throw new Error(`Not a Laravel project (no artisan found): ${projectPath}`);
  }
  const proc = spawn("php", ["artisan", "serve", `--host=127.0.0.1`, `--port=${port}`], {
    cwd: projectPath,
    stdio: ["ignore", "pipe", "pipe"],
  });
  pipeWithPrefix(proc, `Laravel :${port}`, "1;36");
  return proc;
}

function spawnSymfony(projectPath: string, port: number): ChildProcess {
  const status = checkSetup();
  const publicDir = path.join(projectPath, "public");

  let cmd: string;
  let args: string[];

  if (status.symfonyCli.installed) {
    cmd = "symfony";
    args = ["serve", `--port=${port}`, "--no-tls"];
  } else if (fs.existsSync(publicDir)) {
    cmd = "php";
    args = ["-S", `127.0.0.1:${port}`, "-t", "public"];
  } else {
    throw new Error(`Not a Symfony project (no public/ dir found): ${projectPath}`);
  }

  const proc = spawn(cmd, args, {
    cwd: projectPath,
    stdio: ["ignore", "pipe", "pipe"],
  });
  pipeWithPrefix(proc, `Symfony :${port}`, "1;35");
  return proc;
}

export function runServers(opts: RunOptions): void {
  const laravelPort = opts.laravelPort ?? 8000;
  const symfonyPort = opts.symfonyPort ?? 8001;

  const procs: ChildProcess[] = [];

  if (opts.laravelPath) {
    const lp = path.resolve(opts.laravelPath);
    console.log(`\x1b[1;36m● Starting Laravel\x1b[0m  ${lp}  → http://127.0.0.1:${laravelPort}`);
    procs.push(spawnLaravel(lp, laravelPort));
  }

  if (opts.symfonyPath) {
    const sp = path.resolve(opts.symfonyPath);
    console.log(`\x1b[1;35m● Starting Symfony\x1b[0m  ${sp}  → http://127.0.0.1:${symfonyPort}`);
    procs.push(spawnSymfony(sp, symfonyPort));
  }

  if (!procs.length) {
    throw new Error("Specify at least --laravel or --symfony.");
  }

  console.log("\nPress Ctrl+C to stop all servers.\n");

  const cleanup = () => {
    for (const p of procs) {
      try { p.kill("SIGTERM"); } catch { /* already dead */ }
    }
    process.exit(0);
  };

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  for (const p of procs) {
    p.on("exit", (code) => {
      if (code !== null && code !== 0) {
        console.error(`\x1b[31mA server exited with code ${code}. Stopping all.\x1b[0m`);
        cleanup();
      }
    });
  }
}
