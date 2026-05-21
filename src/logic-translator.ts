import type { SupportedFramework } from "./types.js";

export interface TranslationResult {
  code: string;
  warnings: string[];
  translatedCount: number;
}

// ─── Rule definition ──────────────────────────────────────────────────────────

interface Rule {
  pattern: RegExp;
  replacement: string | ((...args: string[]) => string);
  warning?: string;
}

// ─── Laravel → Symfony ────────────────────────────────────────────────────────

const LARAVEL_TO_SYMFONY: Rule[] = [
  // Responses
  { pattern: /return response\(\)->json\(([^,)]+),\s*(\d+)\)/g,  replacement: "return \$this->json($1, $2)" },
  { pattern: /return response\(\)->json\(([^)]+)\)/g,             replacement: "return \$this->json($1)" },
  { pattern: /return response\(\)->noContent\(\)/g,               replacement: "return new Response(null, 204)" },

  // Auth
  { pattern: /auth\(\)->user\(\)/g,   replacement: "\$this->getUser()" },
  { pattern: /auth\(\)->check\(\)/g,  replacement: "\$this->getUser() !== null" },
  { pattern: /auth\(\)->id\(\)/g,     replacement: "\$this->getUser()?->getId()" },
  { pattern: /auth\(\)->logout\(\)/g, replacement: "// logout handled by Symfony Security firewall" },

  // Request
  { pattern: /\$request->all\(\)/g,                replacement: "\$request->request->all()" },
  { pattern: /\$request->input\('([^']+)'\)/g,     replacement: "\$request->get('$1')" },
  { pattern: /\$request->get\('([^']+)'\)/g,       replacement: "\$request->get('$1')" },
  { pattern: /\$request->only\(\[([^\]]+)\]\)/g,   replacement: "\$request->request->only([$1])" },
  { pattern: /\$request->except\(\[([^\]]+)\]\)/g, replacement: "\$request->request->except([$1])" },
  { pattern: /\$request->has\('([^']+)'\)/g,       replacement: "\$request->request->has('$1')" },
  { pattern: /\$request->validate\(\[/g,            replacement: "// TODO: use #[Assert\\\\...] on DTO instead of inline validate\n        // validate([", warning: "request->validate() → use Symfony DTO with #[Assert\\...] constraints" },

  // Eloquent → Doctrine
  { pattern: /(\w+)::all\(\)/g,           replacement: "\$this->entityManager->getRepository($1::class)->findAll()" },
  { pattern: /(\w+)::find\(([^)]+)\)/g,   replacement: "\$this->entityManager->getRepository($1::class)->find($2)" },
  { pattern: /(\w+)::findOrFail\(([^)]+)\)/g, replacement: "\$this->entityManager->getRepository($1::class)->find($2) ?? throw \$this->createNotFoundException()", warning: "findOrFail() → find() + createNotFoundException()" },
  { pattern: /(\w+)::create\(([^)]+)\)/g, replacement: "// TODO: new $1(); setters; \$em->persist(); \$em->flush()", warning: "::create() → Doctrine persist + flush" },
  { pattern: /(\w+)::paginate\((\d+)\)/g, replacement: "// TODO: use Doctrine Paginator — \$this->paginator->paginate(\$query, \$page, $2)", warning: "paginate() → Doctrine Paginator (add knplabs/knp-paginator-bundle)" },
  { pattern: /(\w+)::where\(/g,           replacement: "\$this->entityManager->createQueryBuilder()->select('e')->from($1::class, 'e')->where(", warning: "::where() → Doctrine QueryBuilder" },

  // Instance operations
  { pattern: /\$(\w+)->update\(([^)]+)\)/g, replacement: "// TODO: setters on \$$1 then \$this->entityManager->flush()", warning: "->update() → Doctrine setters + flush()" },
  { pattern: /\$(\w+)->save\(\)/g,           replacement: "\$this->entityManager->persist(\$$1);\n        \$this->entityManager->flush()" },
  { pattern: /\$(\w+)->delete\(\)/g,         replacement: "\$this->entityManager->remove(\$$1);\n        \$this->entityManager->flush()" },

  // DB facade
  { pattern: /DB::beginTransaction\(\)/g, replacement: "\$this->entityManager->beginTransaction()" },
  { pattern: /DB::commit\(\)/g,            replacement: "\$this->entityManager->commit()" },
  { pattern: /DB::rollBack\(\)/g,          replacement: "\$this->entityManager->rollback()" },
  { pattern: /DB::table\('([^']+)'\)/g,    replacement: "// TODO: use Doctrine DQL or QueryBuilder for table '$1'", warning: "DB::table() → use Doctrine DQL" },

  // Logging
  { pattern: /Log::info\(([^)]+)\)/g,    replacement: "\$this->logger->info($1)" },
  { pattern: /Log::error\(([^)]+)\)/g,   replacement: "\$this->logger->error($1)" },
  { pattern: /Log::warning\(([^)]+)\)/g, replacement: "\$this->logger->warning($1)" },
  { pattern: /Log::debug\(([^)]+)\)/g,   replacement: "\$this->logger->debug($1)" },

  // Cache
  { pattern: /Cache::get\('([^']+)'\)/g, replacement: "\$this->cache->getItem('$1')->get()", warning: "Cache::get() → Symfony Cache (inject CacheInterface)" },
  { pattern: /Cache::put\('([^']+)',\s*([^,]+),\s*([^)]+)\)/g, replacement: "\$item = \$this->cache->getItem('$1'); \$item->set($2); \$item->expiresAfter($3); \$this->cache->save(\$item)", warning: "Cache::put() → Symfony Cache save()" },

  // Queue / Events
  { pattern: /dispatch\(new ([^(]+)\(([^)]*)\)\)/g, replacement: "\$this->messageBus->dispatch(new $1($2))" },
  { pattern: /event\(new ([^(]+)\(([^)]*)\)\)/g,    replacement: "\$this->eventDispatcher->dispatch(new $1($2))" },

  // Mail
  { pattern: /Mail::to\(([^)]+)\)->send\(new ([^(]+)\(([^)]*)\)\)/g, replacement: "\$this->mailer->send((new \$email)->to($1))", warning: "Mail::to()->send() → Symfony Mailer (inject MailerInterface)" },
];

// ─── Symfony → Laravel ────────────────────────────────────────────────────────

const SYMFONY_TO_LARAVEL: Rule[] = [
  // Responses
  { pattern: /return \$this->json\(([^,)]+),\s*(\d+)\)/g, replacement: "return response()->json($1, $2)" },
  { pattern: /return \$this->json\(([^)]+)\)/g,            replacement: "return response()->json($1)" },
  { pattern: /return new Response\(null,\s*204\)/g,        replacement: "return response()->noContent()" },
  { pattern: /return new JsonResponse\(([^,)]+),\s*(\d+)\)/g, replacement: "return response()->json($1, $2)" },

  // Auth
  { pattern: /\$this->getUser\(\)/g,   replacement: "auth()->user()" },
  { pattern: /\$this->denyAccessUnlessGranted\('([^']+)'\)/g, replacement: "\$this->authorize('$1')", warning: "denyAccessUnlessGranted() → authorize() (configure Gate/Policy)" },

  // Request
  { pattern: /\$request->request->all\(\)/g,         replacement: "\$request->all()" },
  { pattern: /\$request->get\('([^']+)'\)/g,          replacement: "\$request->input('$1')" },
  { pattern: /\$request->query->get\('([^']+)'\)/g,   replacement: "\$request->query('$1')" },
  { pattern: /\$request->files->get\('([^']+)'\)/g,   replacement: "\$request->file('$1')" },

  // Doctrine → Eloquent
  { pattern: /\$this->entityManager->getRepository\((\w+)::class\)->findAll\(\)/g, replacement: "$1::all()" },
  { pattern: /\$this->entityManager->getRepository\((\w+)::class\)->find\(([^)]+)\)/g, replacement: "$1::find($2)" },
  { pattern: /\$this->entityManager->getRepository\((\w+)::class\)->findOneBy\(\[([^\]]+)\]\)/g, replacement: "$1::where($2)->first()", warning: "findOneBy() → Eloquent where()->first()" },
  { pattern: /\$this->entityManager->persist\(\$(\w+)\);\s*\n?\s*\$this->entityManager->flush\(\)/g, replacement: "\$$1->save()" },
  { pattern: /\$this->entityManager->remove\(\$(\w+)\);\s*\n?\s*\$this->entityManager->flush\(\)/g,  replacement: "\$$1->delete()" },
  { pattern: /\$this->entityManager->flush\(\)/g,    replacement: "// \$model->save() (called above)", warning: "flush() → call ->save() on model instead" },
  { pattern: /\$this->entityManager->beginTransaction\(\)/g, replacement: "DB::beginTransaction()" },
  { pattern: /\$this->entityManager->commit\(\)/g,    replacement: "DB::commit()" },
  { pattern: /\$this->entityManager->rollback\(\)/g,  replacement: "DB::rollBack()" },

  // QueryBuilder
  { pattern: /\$this->createQueryBuilder\('(\w+)'\)/g, replacement: "// TODO: use Eloquent query builder", warning: "Doctrine QueryBuilder → Eloquent Model::query()" },

  // Logging
  { pattern: /\$this->logger->info\(([^)]+)\)/g,    replacement: "Log::info($1)" },
  { pattern: /\$this->logger->error\(([^)]+)\)/g,   replacement: "Log::error($1)" },
  { pattern: /\$this->logger->warning\(([^)]+)\)/g, replacement: "Log::warning($1)" },
  { pattern: /\$this->logger->debug\(([^)]+)\)/g,   replacement: "Log::debug($1)" },

  // Cache
  { pattern: /\$this->cache->getItem\('([^']+)'\)->get\(\)/g, replacement: "Cache::get('$1')", warning: "Symfony Cache → Laravel Cache facade" },

  // Messenger / Events
  { pattern: /\$this->messageBus->dispatch\(new ([^(]+)\(([^)]*)\)\)/g, replacement: "dispatch(new $1($2))" },
  { pattern: /\$this->eventDispatcher->dispatch\(new ([^(]+)\(([^)]*)\)\)/g, replacement: "event(new $1($2))" },

  // Exceptions
  { pattern: /throw \$this->createNotFoundException\(([^)]*)\)/g, replacement: "abort(404, $1)" },
  { pattern: /throw \$this->createAccessDeniedException\(([^)]*)\)/g, replacement: "abort(403, $1)" },
];

// ─── Public API ───────────────────────────────────────────────────────────────

export function translatePhpBody(
  body: string,
  from: SupportedFramework,
  to: SupportedFramework,
): TranslationResult {
  if (from === to) return { code: body, warnings: [], translatedCount: 0 };

  const rules = from === "laravel" ? LARAVEL_TO_SYMFONY : SYMFONY_TO_LARAVEL;
  const warnings: string[] = [];
  let translatedCount = 0;
  let code = body;

  for (const rule of rules) {
    const before = code;
    if (typeof rule.replacement === "string") {
      code = code.replace(rule.pattern, rule.replacement as string);
    } else {
      code = code.replace(rule.pattern, (...args) => (rule.replacement as Function)(...args));
    }
    if (code !== before) {
      translatedCount++;
      if (rule.warning) warnings.push(rule.warning);
    }
    // Reset lastIndex for global regexes
    rule.pattern.lastIndex = 0;
  }

  return { code, warnings, translatedCount };
}

export function formatTranslatedBlock(
  originalBody: string,
  translated: TranslationResult,
  from: SupportedFramework,
  methodName: string,
): string {
  const hasChanges = translated.translatedCount > 0;

  const warningLines = translated.warnings.length
    ? translated.warnings.map((w) => `        // ⚠  ${w}`).join("\n") + "\n"
    : "";

  const sourceComment = [
    `        // ┌─ [BackendBridge] Auto-translated from ${from} — ${methodName}()`,
    ...originalBody.split("\n").map((l) => `        // │  ${l}`),
    `        // └─ end source`,
  ].join("\n");

  if (hasChanges) {
    return `${sourceComment}\n${warningLines}${translated.code}`;
  }

  // No translation happened — include original as comment only
  return `${sourceComment}\n        // TODO: translate the above ${from} code to target framework`;
}
