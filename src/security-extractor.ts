import fs from "node:fs";
import path from "node:path";
import type { SupportedFramework } from "./types.js";
import { generateLaravelPolicy, generateSymfonyVoter } from "./generators/auth.js";

function walkPhp(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const results: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) results.push(...walkPhp(full));
    else if (entry.name.endsWith(".php")) results.push(full);
  }
  return results;
}

interface ExtractedAuthRule {
  resource: string;
  roles: string[];
  attributes: string[];
}

// ─── Symfony Voter extraction ─────────────────────────────────────────────────

function extractFromSymfonyVoters(sourcePath: string): ExtractedAuthRule[] {
  const voterDir = path.join(sourcePath, "src", "Security");
  const results: ExtractedAuthRule[] = [];

  for (const file of walkPhp(voterDir)) {
    const content = fs.readFileSync(file, "utf8");
    if (!content.includes("extends Voter")) continue;

    const className = path.basename(file, ".php");
    const resource = className.replace(/Voter$/, "");
    if (!resource) continue;

    // Extract ATTRIBUTES constant values: 'VIEW', 'CREATE', 'EDIT', 'DELETE'
    const attrMatch = content.match(/ATTRIBUTES\s*=\s*\[([^\]]+)\]/);
    const attributes: string[] = [];
    if (attrMatch) {
      for (const [, val] of attrMatch[1].matchAll(/['"]([\w]+)['"]/g)) {
        attributes.push(val.toLowerCase());
      }
    }
    if (!attributes.length) attributes.push("view", "create", "edit", "delete");

    // Extract role checks: isGranted('ROLE_ADMIN')
    const roles: string[] = [];
    for (const [, role] of content.matchAll(/ROLE_([A-Z_]+)/g)) {
      roles.push(`role:${role.toLowerCase()}`);
    }

    results.push({ resource, roles: [...new Set(roles)], attributes });
  }

  return results;
}

// ─── Laravel Policy extraction ────────────────────────────────────────────────

function extractFromLaravelPolicies(sourcePath: string): ExtractedAuthRule[] {
  const policyDir = path.join(sourcePath, "app", "Policies");
  const results: ExtractedAuthRule[] = [];

  for (const file of walkPhp(policyDir)) {
    const content = fs.readFileSync(file, "utf8");
    if (!content.includes("class ") || !content.includes("Policy")) continue;

    const className = path.basename(file, ".php");
    const resource = className.replace(/Policy$/, "");
    if (!resource) continue;

    // Extract public methods (policy actions)
    const attributes: string[] = [];
    for (const [, method] of content.matchAll(/public\s+function\s+(\w+)\s*\(/g)) {
      if (!["before", "__construct"].includes(method)) attributes.push(method);
    }

    // Extract role checks: hasRole('admin'), hasAnyRole(['admin'])
    const roles: string[] = [];
    for (const [, role] of content.matchAll(/hasRole\(['"]([\w]+)['"]\)/g)) {
      roles.push(`role:${role.toLowerCase()}`);
    }
    for (const [, roleList] of content.matchAll(/hasAnyRole\(\[([^\]]+)\]\)/g)) {
      for (const [, role] of roleList.matchAll(/['"]([\w]+)['"]/g)) {
        roles.push(`role:${role.toLowerCase()}`);
      }
    }
    if (!roles.length && content.includes("$user")) roles.push("auth");

    results.push({ resource, roles: [...new Set(roles)], attributes });
  }

  return results;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function generateSecurityFromSource(
  sourcePath: string,
  from: SupportedFramework,
  targetPath: string,
  to: SupportedFramework,
): string[] {
  const rules =
    from === "symfony"
      ? extractFromSymfonyVoters(sourcePath)
      : extractFromLaravelPolicies(sourcePath);

  if (!rules.length) return [];

  const generated: string[] = [];

  for (const rule of rules) {
    const authRules = rule.roles.length ? rule.roles : ["auth"];
    try {
      const file =
        to === "laravel"
          ? generateLaravelPolicy(targetPath, rule.resource, authRules)
          : generateSymfonyVoter(targetPath, rule.resource, authRules);
      generated.push(file);
    } catch {
      // skip if generation fails for a specific resource
    }
  }

  return generated;
}

export function hasSecurityInSource(sourcePath: string, from: SupportedFramework): boolean {
  const dir =
    from === "symfony"
      ? path.join(sourcePath, "src", "Security")
      : path.join(sourcePath, "app", "Policies");
  if (!fs.existsSync(dir)) return false;
  return walkPhp(dir).length > 0;
}
