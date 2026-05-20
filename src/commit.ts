import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const CONVENTIONAL_COMMIT_REGEX =
  /^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)\([a-z0-9._-]+\):\s.+$/;

function findGitRoot(startPath: string): string | null {
  let current = path.resolve(startPath);

  while (true) {
    const gitPath = path.join(current, ".git");
    if (fs.existsSync(gitPath)) {
      return current;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

export function validateCommitMessage(message: string): void {
  if (!CONVENTIONAL_COMMIT_REGEX.test(message)) {
    throw new Error(
      "Message de commit invalide. Format attendu: feat(scope): description ou fix(scope): description",
    );
  }
}

export function commitGeneratedFiles(files: string[], message: string, cwd: string): void {
  validateCommitMessage(message);

  const gitRoot = findGitRoot(cwd);
  if (!gitRoot) {
    throw new Error("Aucun depot Git detecte pour creer un commit.");
  }

  const relativeFiles = files.map((file) => path.relative(gitRoot, file));

  execFileSync("git", ["add", ...relativeFiles], {
    cwd: gitRoot,
    stdio: "inherit",
  });

  execFileSync("git", ["commit", "-m", message], {
    cwd: gitRoot,
    stdio: "inherit",
  });
}

export function defaultCommitMessage(from: string, to: string): string {
  return `feat(bridge): convert ${from} api to ${to} scaffolding`;
}
