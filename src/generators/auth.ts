import fs from "node:fs";
import path from "node:path";

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

// ─── Rule parser ──────────────────────────────────────────────────────────────

interface ParsedAuthRule {
  requiresAuth: boolean;
  roles: string[];          // ["admin", "editor"]
  conditions: string[];     // ["isOwner", "isVerified"]
  sanctum: boolean;
  passport: boolean;
}

function parseAuthRules(authRules: string[]): ParsedAuthRule {
  const roles: string[] = [];
  const conditions: string[] = [];
  let requiresAuth = authRules.length > 0;
  let sanctum = false;
  let passport = false;

  for (const rule of authRules) {
    const r = typeof rule === "object" ? JSON.stringify(rule) : String(rule);

    if (/sanctum/i.test(r)) sanctum = true;
    if (/passport/i.test(r)) passport = true;

    // role:admin, ROLE_ADMIN, roles:admin|editor
    const roleMatch = /(?:role[s]?[:=]\s*|ROLE_)(\w+(?:[|,]\w+)*)/i.exec(r);
    if (roleMatch) {
      roles.push(...roleMatch[1].split(/[|,]/).map((s) => s.trim().toLowerCase()));
    } else if (/admin/i.test(r)) {
      roles.push("admin");
    }

    // isOwner, owned_by, owner, condition
    if (/owner|isOwner|owned/i.test(r)) conditions.push("isOwner");
    if (/verified|isVerified/i.test(r)) conditions.push("isVerified");
    if (/active|isActive/i.test(r)) conditions.push("isActive");
  }

  return { requiresAuth, roles: [...new Set(roles)], conditions: [...new Set(conditions)], sanctum, passport };
}

// ─── Laravel Policy ───────────────────────────────────────────────────────────

function laravelRoleCheck(roles: string[]): string {
  if (!roles.length) return "";
  if (roles.length === 1) return `\n        if (!$user->hasRole('${roles[0]}')) { return false; }`;
  const list = roles.map((r) => `'${r}'`).join(", ");
  return `\n        if (!$user->hasAnyRole([${list}])) { return false; }`;
}

function laravelConditionCheck(conditions: string[]): string {
  return conditions.map((c) => {
    if (c === "isOwner") return `\n        if ($model && $user->id !== $model->user_id) { return false; }`;
    if (c === "isVerified") return `\n        if (!$user->hasVerifiedEmail()) { return false; }`;
    if (c === "isActive") return `\n        if (!$user->is_active) { return false; }`;
    return "";
  }).join("");
}

function laravelPolicyMethod(
  op: string,
  hasModel: boolean,
  parsed: ParsedAuthRule,
  modelClass: string,
): string {
  const modelParam = hasModel ? `, ${modelClass} $model` : "";
  const roleCheck = laravelRoleCheck(parsed.roles);
  const condCheck = laravelConditionCheck(parsed.conditions);

  // Skip condition checks for create (no model instance)
  const condPart = hasModel ? condCheck : "";

  return `    public function ${op}(User $user${modelParam}): bool
    {${roleCheck}${condPart}
        return true;
    }`;
}

export function generateLaravelPolicy(targetRoot: string, baseName: string, authRules: string[]): string {
  const className = `${baseName}Policy`;
  const modelClass = baseName;
  const target = path.join(targetRoot, "app", "Policies", `${className}.php`);
  ensureDir(path.dirname(target));

  const parsed = parseAuthRules(authRules);
  const modelImport = `use App\\Models\\${modelClass};\n`;

  const methods = [
    laravelPolicyMethod("viewAny", false, parsed, modelClass),
    laravelPolicyMethod("view",    true,  parsed, modelClass),
    laravelPolicyMethod("create",  false, parsed, modelClass),
    laravelPolicyMethod("update",  true,  parsed, modelClass),
    laravelPolicyMethod("delete",  true,  parsed, modelClass),
    laravelPolicyMethod("restore", true,  parsed, modelClass),
    laravelPolicyMethod("forceDelete", true, parsed, modelClass),
  ].join("\n\n");

  const middlewareHint = parsed.sanctum
    ? "    // Apply middleware: Route::middleware('auth:sanctum')->group(...);\n\n"
    : parsed.passport
      ? "    // Apply middleware: Route::middleware('auth:api')->group(...);\n\n"
      : "";

  const content = `<?php

namespace App\\Policies;

use App\\Models\\User;
${modelImport}
class ${className}
{
${middlewareHint}${methods}
}
`;

  fs.writeFileSync(target, content, "utf8");
  return target;
}

// ─── Symfony Voter ────────────────────────────────────────────────────────────

function symfonyRoleCheck(roles: string[]): string {
  if (!roles.length) return "";
  const roleConst = roles.map((r) => `'ROLE_${r.toUpperCase()}'`).join(", ");
  return `\n            if (!$this->security->isGranted([${roleConst}])) { return false; }`;
}

function symfonyConditionCheck(conditions: string[]): string {
  return conditions.map((c) => {
    if (c === "isOwner") return `\n            if ($subject && method_exists($subject, 'getOwner') && $subject->getOwner() !== $user) { return false; }`;
    if (c === "isVerified") return `\n            if (!$user->isVerified()) { return false; }`;
    if (c === "isActive") return `\n            if (!$user->isActive()) { return false; }`;
    return "";
  }).join("");
}

export function generateSymfonyVoter(targetRoot: string, baseName: string, authRules: string[]): string {
  const className = `${baseName}Voter`;
  const target = path.join(targetRoot, "src", "Security", `${className}.php`);
  ensureDir(path.dirname(target));

  const parsed = parseAuthRules(authRules);
  const attributes = ["VIEW", "CREATE", "EDIT", "DELETE"];
  const roleCheck = symfonyRoleCheck(parsed.roles);
  const condCheck = symfonyConditionCheck(parsed.conditions);

  const cases = attributes.map((attr) => {
    const withCond = attr !== "CREATE" ? condCheck : "";
    return `            case '${attr}':${roleCheck}${withCond}\n                return true;`;
  }).join("\n");

  const jwtHint = parsed.sanctum || authRules.some((r) => /jwt/i.test(String(r)))
    ? "    // Requires lexik/jwt-authentication-bundle — security.yaml: pattern: ^/api, stateless: true\n\n"
    : "";

  const content = `<?php

namespace App\\Security;

use Symfony\\Bundle\\SecurityBundle\\Security;
use Symfony\\Component\\Security\\Core\\Authentication\\Token\\TokenInterface;
use Symfony\\Component\\Security\\Core\\Authorization\\Voter\\Voter;
use Symfony\\Component\\Security\\Core\\User\\UserInterface;

class ${className} extends Voter
{
${jwtHint}    private const ATTRIBUTES = ['VIEW', 'CREATE', 'EDIT', 'DELETE'];

    public function __construct(private readonly Security $security) {}

    protected function supports(string $attribute, mixed $subject): bool
    {
        return in_array($attribute, self::ATTRIBUTES, true);
    }

    protected function voteOnAttribute(string $attribute, mixed $subject, TokenInterface $token): bool
    {
        $user = $token->getUser();
        if (!$user instanceof UserInterface) { return false; }

        switch ($attribute) {
${cases}
        }

        return false;
    }
}
`;

  fs.writeFileSync(target, content, "utf8");
  return target;
}
