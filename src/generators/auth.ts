import fs from "node:fs";
import path from "node:path";

function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
}

export function generateLaravelPolicy(targetRoot: string, baseName: string, authRules: string[]): string {
  const className = `${baseName}Policy`;
  const target = path.join(targetRoot, "app", "Policies", `${className}.php`);
  ensureDir(path.dirname(target));

  const methods: string[] = [];
  const operations = ["view", "create", "update", "delete"];
  for (const op of operations) {
    methods.push(`    public function ${op}(User $user, $model): bool\n    {\n        // TODO: implement ${op} check\n        return true;\n    }\n`);
  }

  const content = `<?php

namespace App\\Policies;

use App\\Models\\User;

class ${className}
{
${methods.join("\n")}
}
`;

  fs.writeFileSync(target, content, "utf8");
  return target;
}

export function generateSymfonyVoter(targetRoot: string, baseName: string, authRules: string[]): string {
  const className = `${baseName}Voter`;
  const target = path.join(targetRoot, "src", "Security", `${className}.php`);
  ensureDir(path.dirname(target));

  const content = `<?php

namespace App\\Security;

use Symfony\\Component\\Security\\Core\\Authentication\\Token\\TokenInterface;
use Symfony\\Component\\Security\\Core\\Authorization\\Voter\\Voter;

class ${className} extends Voter
{
    protected function supports(string $attribute, $subject): bool
    {
        return in_array($attribute, ['VIEW', 'CREATE', 'EDIT', 'DELETE']);
    }

    protected function voteOnAttribute(string $attribute, $subject, TokenInterface $token): bool
    {
        $user = $token->getUser();

        // TODO: implement checks based on mapping auth rules
        return true;
    }
}
`;

  fs.writeFileSync(target, content, "utf8");
  return target;
}
