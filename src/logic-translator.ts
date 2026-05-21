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

  // Eloquent static finders
  { pattern: /(\w+)::all\(\)/g,               replacement: "\$this->entityManager->getRepository($1::class)->findAll()" },
  { pattern: /(\w+)::find\(([^)]+)\)/g,       replacement: "\$this->entityManager->getRepository($1::class)->find($2)" },
  { pattern: /(\w+)::findOrFail\(([^)]+)\)/g, replacement: "\$this->entityManager->getRepository($1::class)->find($2) ?? throw \$this->createNotFoundException()", warning: "findOrFail() → find() + createNotFoundException()" },
  { pattern: /(\w+)::firstOrCreate\(([^)]+)\)/g, replacement: "// TODO: \$repo->findOneBy($2) ?? (new $1() then persist+flush)", warning: "::firstOrCreate() → Doctrine findOneBy() then new+persist if null" },
  { pattern: /(\w+)::create\(([^)]+)\)/g,     replacement: "// TODO: new $1(); setters; \$em->persist(); \$em->flush()", warning: "::create() → Doctrine persist + flush" },
  { pattern: /(\w+)::paginate\((\d+)\)/g,     replacement: "// TODO: use Doctrine Paginator — \$this->paginator->paginate(\$query, \$page, $2)", warning: "paginate() → Doctrine Paginator (add knplabs/knp-paginator-bundle)" },

  // Eloquent static aggregates
  { pattern: /(\w+)::count\(\)/g, replacement: "\$this->entityManager->createQueryBuilder()->select('COUNT(e.id)')->from($1::class, 'e')->getQuery()->getSingleScalarResult()", warning: "::count() → Doctrine getSingleScalarResult()" },
  { pattern: /(\w+)::sum\('([^']+)'\)/g, replacement: "\$this->entityManager->createQueryBuilder()->select('SUM(e.$2)')->from($1::class, 'e')->getQuery()->getSingleScalarResult()", warning: "::sum() → Doctrine getSingleScalarResult()" },
  { pattern: /(\w+)::avg\('([^']+)'\)/g, replacement: "\$this->entityManager->createQueryBuilder()->select('AVG(e.$2)')->from($1::class, 'e')->getQuery()->getSingleScalarResult()", warning: "::avg() → Doctrine getSingleScalarResult()" },
  { pattern: /(\w+)::max\('([^']+)'\)/g, replacement: "\$this->entityManager->createQueryBuilder()->select('MAX(e.$2)')->from($1::class, 'e')->getQuery()->getSingleScalarResult()", warning: "::max() → Doctrine getSingleScalarResult()" },
  { pattern: /(\w+)::min\('([^']+)'\)/g, replacement: "\$this->entityManager->createQueryBuilder()->select('MIN(e.$2)')->from($1::class, 'e')->getQuery()->getSingleScalarResult()", warning: "::min() → Doctrine getSingleScalarResult()" },

  // Eloquent query builder (::where starts a chain)
  { pattern: /(\w+)::where\(/g, replacement: "\$this->entityManager->createQueryBuilder()->select('e')->from($1::class, 'e')->where(", warning: "::where() → Doctrine QueryBuilder" },

  // Query chain methods (appear after ::where() or chained)
  { pattern: /->orWhere\('([^']+)',\s*([^)]+)\)/g,         replacement: "->orWhere(\"e.$1 = :$1\")->setParameter('$1', $2)" },
  { pattern: /->whereIn\('([^']+)',\s*([^)]+)\)/g,         replacement: "->andWhere('e.$1 IN (:$1s)')->setParameter('$1s', $2)", warning: "->whereIn() → Doctrine IN(:param)" },
  { pattern: /->whereBetween\('([^']+)',\s*\[([^\]]+)\]\)/g, replacement: "->andWhere('e.$1 BETWEEN :min AND :max')->setParameter('min', /* lower */)->setParameter('max', /* upper */)", warning: "->whereBetween() → Doctrine BETWEEN" },
  { pattern: /->whereNull\('([^']+)'\)/g,                  replacement: "->andWhere('e.$1 IS NULL')" },
  { pattern: /->whereNotNull\('([^']+)'\)/g,               replacement: "->andWhere('e.$1 IS NOT NULL')" },
  { pattern: /->orderBy\('([^']+)',\s*'([^']+)'\)/g,       replacement: "->orderBy('e.$1', '$2')" },
  { pattern: /->orderByDesc\('([^']+)'\)/g,                replacement: "->orderBy('e.$1', 'DESC')" },
  { pattern: /->latest\(\)/g,                              replacement: "->orderBy('e.createdAt', 'DESC')", warning: "->latest() → orderBy createdAt DESC" },
  { pattern: /->oldest\(\)/g,                              replacement: "->orderBy('e.createdAt', 'ASC')",  warning: "->oldest() → orderBy createdAt ASC" },
  { pattern: /->limit\(([^)]+)\)/g,                        replacement: "->setMaxResults($1)" },
  { pattern: /->offset\(([^)]+)\)/g,                       replacement: "->setFirstResult($1)" },
  { pattern: /->skip\(([^)]+)\)/g,                         replacement: "->setFirstResult($1)" },
  { pattern: /->take\(([^)]+)\)/g,                         replacement: "->setMaxResults($1)" },
  { pattern: /->groupBy\('([^']+)'\)/g,                    replacement: "->groupBy('e.$1')" },
  { pattern: /->having\('([^']+)',\s*([^)]+)\)/g,          replacement: "->having('e.$1', $2)" },

  // Query terminal methods (QueryBuilder result fetching)
  { pattern: /->firstOrFail\(\)/g, replacement: "->getQuery()->getOneOrNullResult() ?? throw \$this->createNotFoundException()", warning: "->firstOrFail() → getOneOrNullResult() + createNotFoundException()" },
  { pattern: /->first\(\)/g,       replacement: "->getQuery()->getOneOrNullResult()", warning: "->first() → Doctrine getOneOrNullResult()" },
  { pattern: /->get\(\)/g,         replacement: "->getQuery()->getResult()", warning: "->get() → Doctrine getQuery()->getResult()" },
  { pattern: /->exists\(\)/g,      replacement: "->getQuery()->getOneOrNullResult() !== null", warning: "->exists() → check getOneOrNullResult() !== null" },
  { pattern: /->doesntExist\(\)/g, replacement: "->getQuery()->getOneOrNullResult() === null" },
  { pattern: /->count\(\)/g,       replacement: "->select('COUNT(e.id)')->getQuery()->getSingleScalarResult()", warning: "->count() → Doctrine getSingleScalarResult()" },
  { pattern: /->sum\('([^']+)'\)/g, replacement: "->select('SUM(e.$1)')->getQuery()->getSingleScalarResult()", warning: "->sum() → Doctrine getSingleScalarResult()" },
  { pattern: /->avg\('([^']+)'\)/g, replacement: "->select('AVG(e.$1)')->getQuery()->getSingleScalarResult()", warning: "->avg() → Doctrine getSingleScalarResult()" },
  { pattern: /->max\('([^']+)'\)/g, replacement: "->select('MAX(e.$1)')->getQuery()->getSingleScalarResult()", warning: "->max() → Doctrine getSingleScalarResult()" },
  { pattern: /->min\('([^']+)'\)/g, replacement: "->select('MIN(e.$1)')->getQuery()->getSingleScalarResult()", warning: "->min() → Doctrine getSingleScalarResult()" },

  // Collection operations on results
  { pattern: /->pluck\('([^']+)'\)/g, replacement: "->getQuery()->getResult() /* then: array_column(\$result, '$1') */", warning: "->pluck() → Doctrine getResult() + array_column()" },
  { pattern: /->sortBy\('([^']+)'\)/g, replacement: "->orderBy('e.$1', 'ASC')", warning: "->sortBy() → Doctrine orderBy()" },
  { pattern: /->map\(function\s*\(\$([^)]+)\)\s*\{/g, replacement: "/* ->map() → use array_map on getResult() */ array_map(function (\$$1) {", warning: "->map() → PHP array_map() on Doctrine result array" },
  { pattern: /->filter\(function\s*\(\$([^)]+)\)\s*\{/g, replacement: "/* ->filter() → use array_filter on getResult() */ array_filter(/* getResult(), */ function (\$$1) {", warning: "->filter() → PHP array_filter() on Doctrine result array" },
  { pattern: /->values\(\)/g, replacement: "/* ->values() → array_values() */", warning: "->values() → PHP array_values()" },

  // Eager loading / relations
  { pattern: /->with\('([^']+)'\)/g,      replacement: "/* TODO: Doctrine join or fetch='EAGER' for '$1' */", warning: "->with() → Doctrine join in QueryBuilder or EAGER fetch on association" },
  { pattern: /->withCount\('([^']+)'\)/g, replacement: "/* TODO: add COUNT subquery for '$1' in Doctrine QueryBuilder */", warning: "->withCount() → Doctrine COUNT subquery" },
  { pattern: /->load\('([^']+)'\)/g,      replacement: "/* Doctrine auto-loads '$1' lazily — no action needed */", warning: "->load() → Doctrine lazy/eager loading" },
  { pattern: /->has\('([^']+)'\)/g,       replacement: "/* TODO: Doctrine EXISTS subquery for '$1' */", warning: "->has() → Doctrine EXISTS subquery" },
  { pattern: /->whereHas\('([^']+)'/g,    replacement: "/* TODO: Doctrine EXISTS subquery for '$1':", warning: "->whereHas() → Doctrine EXISTS subquery" },

  // Relationship mutation (has-many / many-to-many)
  { pattern: /\$(\w+)->(\w+)\(\)->create\(([^)]+)\)/g, replacement: "// TODO: new entity; call set" + "Parent(\$$1); \$em->persist(\$entity); \$em->flush()", warning: "relation()->create() → Doctrine: new Entity, set parent, persist+flush" },
  { pattern: /\$(\w+)->(\w+)\(\)->attach\(([^)]+)\)/g, replacement: "// TODO: \$$1->get$2()->add(\$$3_entity); \$em->flush()", warning: "->attach() → Doctrine ManyToMany: collection->add() + flush()" },
  { pattern: /\$(\w+)->(\w+)\(\)->detach\(([^)]+)\)/g, replacement: "// TODO: \$$1->get$2()->removeElement(\$$3_entity); \$em->flush()", warning: "->detach() → Doctrine ManyToMany: removeElement() + flush()" },
  { pattern: /\$(\w+)->(\w+)\(\)->sync\(([^)]+)\)/g,   replacement: "// TODO: \$$1->get$2()->clear(); re-add items; \$em->flush()", warning: "->sync() → Doctrine: clear collection then re-add" },

  // Soft deletes
  { pattern: /->withTrashed\(\)/g,       replacement: "/* TODO: disable Gedmo SoftDeleteable filter on EntityManager */", warning: "->withTrashed() → Doctrine: disable SoftDeleteable filter" },
  { pattern: /->onlyTrashed\(\)/g,       replacement: "/* TODO: disable SoftDeleteable filter and add andWhere('e.deletedAt IS NOT NULL') */", warning: "->onlyTrashed() → Doctrine: filter deletedAt IS NOT NULL" },
  { pattern: /\$(\w+)->restore\(\)/g,    replacement: "\$$1->setDeletedAt(null); \$this->entityManager->flush()", warning: "->restore() → Doctrine: setDeletedAt(null) + flush()" },
  { pattern: /\$(\w+)->forceDelete\(\)/g, replacement: "\$this->entityManager->remove(\$$1); \$this->entityManager->flush()", warning: "->forceDelete() → Doctrine remove()+flush() (bypasses SoftDelete)" },

  // Instance operations
  { pattern: /\$(\w+)->update\(([^)]+)\)/g, replacement: "// TODO: setters on \$$1 then \$this->entityManager->flush()", warning: "->update() → Doctrine setters + flush()" },
  { pattern: /\$(\w+)->save\(\)/g,           replacement: "\$this->entityManager->persist(\$$1);\n        \$this->entityManager->flush()" },
  { pattern: /\$(\w+)->delete\(\)/g,         replacement: "\$this->entityManager->remove(\$$1);\n        \$this->entityManager->flush()" },

  // DB facade
  { pattern: /DB::transaction\(fn\s*\(\)\s*=>/g,                             replacement: "\$this->entityManager->wrapInTransaction(fn() =>", warning: "DB::transaction() → Doctrine wrapInTransaction()" },
  { pattern: /DB::transaction\(function\s*\(\)(?:\s*use\s*\([^)]*\))?\s*\{/g, replacement: "\$this->entityManager->wrapInTransaction(function () {", warning: "DB::transaction() → Doctrine wrapInTransaction()" },
  { pattern: /DB::beginTransaction\(\)/g, replacement: "\$this->entityManager->beginTransaction()" },
  { pattern: /DB::commit\(\)/g,           replacement: "\$this->entityManager->commit()" },
  { pattern: /DB::rollBack\(\)/g,         replacement: "\$this->entityManager->rollback()" },
  { pattern: /DB::select\(([^)]+)\)/g,    replacement: "\$this->entityManager->getConnection()->fetchAllAssociative($1)", warning: "DB::select() → Doctrine DBAL fetchAllAssociative()" },
  { pattern: /DB::statement\(([^)]+)\)/g, replacement: "\$this->entityManager->getConnection()->executeStatement($1)", warning: "DB::statement() → Doctrine DBAL executeStatement()" },
  { pattern: /DB::table\('([^']+)'\)/g,   replacement: "// TODO: use Doctrine DQL or QueryBuilder for table '$1'", warning: "DB::table() → use Doctrine DQL" },

  // Logging
  { pattern: /Log::info\(([^)]+)\)/g,    replacement: "\$this->logger->info($1)" },
  { pattern: /Log::error\(([^)]+)\)/g,   replacement: "\$this->logger->error($1)" },
  { pattern: /Log::warning\(([^)]+)\)/g, replacement: "\$this->logger->warning($1)" },
  { pattern: /Log::debug\(([^)]+)\)/g,   replacement: "\$this->logger->debug($1)" },

  // Cache
  { pattern: /Cache::get\('([^']+)'\)/g, replacement: "\$this->cache->getItem('$1')->get()", warning: "Cache::get() → Symfony Cache (inject CacheInterface)" },
  { pattern: /Cache::put\('([^']+)',\s*([^,]+),\s*([^)]+)\)/g, replacement: "\$item = \$this->cache->getItem('$1'); \$item->set($2); \$item->expiresAfter($3); \$this->cache->save(\$item)", warning: "Cache::put() → Symfony Cache save()" },
  { pattern: /Cache::forget\('([^']+)'\)/g, replacement: "\$this->cache->deleteItem('$1')", warning: "Cache::forget() → Symfony Cache deleteItem()" },
  { pattern: /Cache::has\('([^']+)'\)/g,    replacement: "\$this->cache->hasItem('$1')", warning: "Cache::has() → Symfony Cache hasItem()" },

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

  // Doctrine finders
  { pattern: /\$this->entityManager->getRepository\((\w+)::class\)->findAll\(\)/g,  replacement: "$1::all()" },
  { pattern: /\$this->entityManager->getRepository\((\w+)::class\)->find\(([^)]+)\)/g, replacement: "$1::find($2)" },
  { pattern: /\$this->entityManager->getRepository\((\w+)::class\)->findOneBy\(\[([^\]]+)\]\)/g, replacement: "$1::where($2)->first()", warning: "findOneBy() → Eloquent where()->first()" },
  { pattern: /\$this->entityManager->getRepository\((\w+)::class\)->findBy\(\[([^\]]+)\]\)/g,    replacement: "$1::where($2)->get()", warning: "findBy() → Eloquent where()->get()" },
  { pattern: /\$repo->findOneBy\(\[([^\]]+)\]\)/g, replacement: "/* model */::where($1)->first()", warning: "findOneBy() → Eloquent where()->first()" },

  // Doctrine QueryBuilder (starts a chain)
  { pattern: /\$this->createQueryBuilder\('(\w+)'\)/g, replacement: "/* Model */::query()", warning: "Doctrine QueryBuilder → Eloquent Model::query()" },
  { pattern: /\$this->entityManager->createQueryBuilder\(\)->select\('[^']+'\)->from\((\w+)::class,\s*'[^']+'\)/g, replacement: "$1::query()", warning: "Doctrine QueryBuilder → Eloquent Model::query()" },

  // Doctrine QueryBuilder chain methods → Eloquent
  { pattern: /->andWhere\("e\.(\w+)\s*=\s*:(\w+)"\)->setParameter\('\2',\s*([^)]+)\)/g, replacement: "->where('$1', $3)" },
  { pattern: /->andWhere\('([^']+) IN \(:(\w+)s\)'\)->setParameter\('\2s',\s*([^)]+)\)/g, replacement: "->whereIn('$1', $3)" },
  { pattern: /->orWhere\("e\.(\w+)\s*=\s*:(\w+)"\)->setParameter\('\2',\s*([^)]+)\)/g,  replacement: "->orWhere('$1', $3)" },
  { pattern: /->orderBy\('e\.(\w+)',\s*'(ASC|DESC)'\)/g, replacement: "->orderBy('$1', '$2')" },
  { pattern: /->setMaxResults\(([^)]+)\)/g,  replacement: "->limit($1)" },
  { pattern: /->setFirstResult\(([^)]+)\)/g, replacement: "->offset($1)" },
  { pattern: /->groupBy\('e\.(\w+)'\)/g,     replacement: "->groupBy('$1')" },
  { pattern: /->addSelect\('([^']+)'\)/g,     replacement: "->addSelect('$1')" },

  // Doctrine QueryBuilder result fetching → Eloquent
  { pattern: /->getQuery\(\)->getResult\(\)/g,             replacement: "->get()" },
  { pattern: /->getQuery\(\)->getOneOrNullResult\(\)\s*\?\?\s*throw \$this->createNotFoundException\([^)]*\)/g, replacement: "->firstOrFail()" },
  { pattern: /->getQuery\(\)->getOneOrNullResult\(\)/g,    replacement: "->first()" },
  { pattern: /->getQuery\(\)->getSingleScalarResult\(\)/g, replacement: "->value('id')", warning: "getSingleScalarResult() → Eloquent ->value() or ->count()/->sum() depending on select" },
  { pattern: /->getQuery\(\)->getSingleResult\(\)/g,       replacement: "->firstOrFail()" },

  // Doctrine Paginator
  { pattern: /\$this->paginator->paginate\([^,]+,\s*\$page,\s*(\d+)\)/g, replacement: "->paginate($1)", warning: "Doctrine Paginator → Eloquent paginate()" },

  // Doctrine entity lifecycle
  { pattern: /\$this->entityManager->persist\(\$(\w+)\);\s*\n?\s*\$this->entityManager->flush\(\)/g, replacement: "\$$1->save()" },
  { pattern: /\$this->entityManager->remove\(\$(\w+)\);\s*\n?\s*\$this->entityManager->flush\(\)/g,  replacement: "\$$1->delete()" },
  { pattern: /\$this->entityManager->flush\(\)/g,         replacement: "// \$model->save() (called above)", warning: "flush() → call ->save() on model instead" },
  { pattern: /\$this->entityManager->wrapInTransaction\(fn\s*\(\)\s*=>/g, replacement: "DB::transaction(fn() =>", warning: "wrapInTransaction() → DB::transaction()" },
  { pattern: /\$this->entityManager->wrapInTransaction\(function\s*\(\)\s*\{/g, replacement: "DB::transaction(function () {", warning: "wrapInTransaction() → DB::transaction()" },
  { pattern: /\$this->entityManager->beginTransaction\(\)/g, replacement: "DB::beginTransaction()" },
  { pattern: /\$this->entityManager->commit\(\)/g,           replacement: "DB::commit()" },
  { pattern: /\$this->entityManager->rollback\(\)/g,         replacement: "DB::rollBack()" },

  // Doctrine DBAL raw queries → Laravel
  { pattern: /\$this->entityManager->getConnection\(\)->fetchAllAssociative\(([^)]+)\)/g, replacement: "DB::select($1)", warning: "fetchAllAssociative() → Laravel DB::select()" },
  { pattern: /\$this->entityManager->getConnection\(\)->executeStatement\(([^)]+)\)/g,    replacement: "DB::statement($1)", warning: "executeStatement() → Laravel DB::statement()" },

  // Getter methods → Eloquent property / relation (getXxx() → $model->xxx)
  { pattern: /\$(\w+)->get([A-Z]\w+)\(\)/g, replacement: (_, obj, prop) => `\$${obj}->${prop.charAt(0).toLowerCase()}${prop.slice(1)}`, warning: "Doctrine getter → Eloquent magic property" },
  { pattern: /\$(\w+)->set([A-Z]\w+)\(([^)]+)\)/g, replacement: (_, obj, prop, val) => `\$${obj}->${prop.charAt(0).toLowerCase()}${prop.slice(1)} = ${val}`, warning: "Doctrine setter → Eloquent property assignment" },

  // Doctrine Collection → PHP / Eloquent
  { pattern: /->toArray\(\)/g,                                                      replacement: "->toArray()" },
  { pattern: /\$(\w+)->filter\(function\s*\(\$([^)]+)\)\s*\{/g,                    replacement: "\$$1->filter(function (\$$2) {" },
  { pattern: /\$(\w+)->map\(function\s*\(\$([^)]+)\)\s*\{/g,                       replacement: "\$$1->map(function (\$$2) {" },
  { pattern: /\$(\w+)->count\(\)/g,                                                 replacement: "\$$1->count()" },
  { pattern: /\$(\w+)->contains\(\$([^)]+)\)/g,                                    replacement: "\$$1->contains(\$$2)" },
  { pattern: /\$(\w+)->isEmpty\(\)/g,                                               replacement: "\$$1->isEmpty()" },
  { pattern: /\$(\w+)->first\(\)/g,                                                 replacement: "\$$1->first()" },

  // Soft deletes (SoftDeleteable → Eloquent SoftDeletes)
  { pattern: /\$(\w+)->setDeletedAt\(null\);\s*\n?\s*\$this->entityManager->flush\(\)/g, replacement: "\$$1->restore()", warning: "setDeletedAt(null)+flush() → Eloquent restore() (add SoftDeletes trait)" },
  { pattern: /\$(\w+)->getDeletedAt\(\)/g, replacement: "\$$1->deleted_at", warning: "getDeletedAt() → Eloquent deleted_at attribute" },

  // Logging
  { pattern: /\$this->logger->info\(([^)]+)\)/g,    replacement: "Log::info($1)" },
  { pattern: /\$this->logger->error\(([^)]+)\)/g,   replacement: "Log::error($1)" },
  { pattern: /\$this->logger->warning\(([^)]+)\)/g, replacement: "Log::warning($1)" },
  { pattern: /\$this->logger->debug\(([^)]+)\)/g,   replacement: "Log::debug($1)" },

  // Cache
  { pattern: /\$this->cache->getItem\('([^']+)'\)->get\(\)/g,    replacement: "Cache::get('$1')", warning: "Symfony Cache → Laravel Cache facade" },
  { pattern: /\$this->cache->deleteItem\('([^']+)'\)/g,          replacement: "Cache::forget('$1')", warning: "deleteItem() → Cache::forget()" },
  { pattern: /\$this->cache->hasItem\('([^']+)'\)/g,             replacement: "Cache::has('$1')" },

  // Messenger / Events
  { pattern: /\$this->messageBus->dispatch\(new ([^(]+)\(([^)]*)\)\)/g, replacement: "dispatch(new $1($2))" },
  { pattern: /\$this->eventDispatcher->dispatch\(new ([^(]+)\(([^)]*)\)\)/g, replacement: "event(new $1($2))" },

  // Exceptions
  { pattern: /throw \$this->createNotFoundException\(([^)]*)\)/g,     replacement: "abort(404, $1)" },
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
