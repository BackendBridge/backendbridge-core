import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

interface ReleaseOptions {
  projectPath: string;
  bump?: "patch" | "minor" | "major" | "prerelease";
  version?: string;
  changelogPath: string;
  publish: boolean;
  dryRun: boolean;
}

export interface ReleaseResult {
  previousVersion: string;
  nextVersion: string;
  changelogPath: string;
  published: boolean;
  committed: boolean;
}

function parseVersion(version: string): [number, number, number] {
  const [maj, min, pat] = version.split(".").map((n) => Number.parseInt(n, 10));
  if ([maj, min, pat].some((n) => Number.isNaN(n) || n < 0)) {
    throw new Error(`Version semver invalide: ${version}`);
  }
  return [maj, min, pat];
}

function bumpVersion(current: string, bump: NonNullable<ReleaseOptions["bump"]>): string {
  const [maj, min, pat] = parseVersion(current);
  if (bump === "major") {
    return `${maj + 1}.0.0`;
  }
  if (bump === "minor") {
    return `${maj}.${min + 1}.0`;
  }
  if (bump === "patch") {
    return `${maj}.${min}.${pat + 1}`;
  }
  return `${maj}.${min}.${pat + 1}-rc.0`;
}

function readPackageJson(projectPath: string): Record<string, unknown> {
  const packagePath = path.join(projectPath, "package.json");
  if (!fs.existsSync(packagePath)) {
    throw new Error("package.json introuvable.");
  }
  return JSON.parse(fs.readFileSync(packagePath, "utf8")) as Record<string, unknown>;
}

function writePackageJson(projectPath: string, data: Record<string, unknown>): void {
  fs.writeFileSync(path.join(projectPath, "package.json"), `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function generateChangelog(projectPath: string, version: string): string {
  let logs = "";
  try {
    logs = execFileSync("git", ["log", "--pretty=format:%s", "-n", "200"], {
      cwd: projectPath,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    logs = "";
  }

  const lines = logs
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const sections: Record<string, string[]> = {
    feat: [],
    fix: [],
    docs: [],
    chore: [],
    other: [],
  };

  for (const line of lines) {
    if (line.startsWith("feat(")) {
      sections.feat.push(line);
      continue;
    }
    if (line.startsWith("fix(")) {
      sections.fix.push(line);
      continue;
    }
    if (line.startsWith("docs(")) {
      sections.docs.push(line);
      continue;
    }
    if (line.startsWith("chore(")) {
      sections.chore.push(line);
      continue;
    }
    sections.other.push(line);
  }

  const today = new Date().toISOString().slice(0, 10);
  const out: string[] = [`## v${version} - ${today}`, ""];

  const map: Array<[string, string[]]> = [
    ["Features", sections.feat],
    ["Fixes", sections.fix],
    ["Docs", sections.docs],
    ["Chores", sections.chore],
    ["Other", sections.other],
  ];

  for (const [title, items] of map) {
    if (!items.length) {
      continue;
    }
    out.push(`### ${title}`);
    for (const item of items.slice(0, 20)) {
      out.push(`- ${item}`);
    }
    out.push("");
  }

  return out.join("\n");
}

export function runRelease(options: ReleaseOptions): ReleaseResult {
  const pkg = readPackageJson(options.projectPath);
  const previousVersion = String(pkg.version ?? "0.1.0");
  const nextVersion = options.version ?? bumpVersion(previousVersion, options.bump ?? "patch");

  pkg.version = nextVersion;
  writePackageJson(options.projectPath, pkg);

  const releaseNotes = generateChangelog(options.projectPath, nextVersion);
  fs.mkdirSync(path.dirname(options.changelogPath), { recursive: true });

  const existing = fs.existsSync(options.changelogPath)
    ? fs.readFileSync(options.changelogPath, "utf8")
    : "";
  fs.writeFileSync(options.changelogPath, `${releaseNotes}\n${existing}`, "utf8");

  let committed = false;
  if (!options.dryRun) {
    execFileSync("git", ["add", "package.json", path.relative(options.projectPath, options.changelogPath)], {
      cwd: options.projectPath,
      stdio: "inherit",
    });
    execFileSync("git", ["commit", "-m", `chore(release): v${nextVersion}`], {
      cwd: options.projectPath,
      stdio: "inherit",
    });
    execFileSync("git", ["tag", `v${nextVersion}`], { cwd: options.projectPath, stdio: "inherit" });
    committed = true;
  }

  let published = false;
  if (options.publish && !options.dryRun) {
    execFileSync("npm", ["publish"], {
      cwd: options.projectPath,
      stdio: "inherit",
    });
    published = true;
  }

  return {
    previousVersion,
    nextVersion,
    changelogPath: options.changelogPath,
    published,
    committed,
  };
}
