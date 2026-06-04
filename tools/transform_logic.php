#!/usr/bin/env php
<?php

/**
 * AST-based PHP logic transformer — BackendBridge
 *
 * Usage:
 *   php transform_logic.php --from laravel --to symfony <<< "$phpCode"
 *   php transform_logic.php --from symfony --to laravel <<< "$phpCode"
 *
 * Reads PHP method body (no <?php tag) from stdin.
 * Outputs JSON: { code, warnings, translatedCount }
 *
 * Handles multi-line chains and nested expressions that regex cannot match.
 */

require_once __DIR__ . '/vendor/autoload.php';

use PhpParser\{NodeTraverser, NodeVisitorAbstract, ParserFactory, Node};
use PhpParser\Node\{Identifier, Name, Scalar};
use PhpParser\Node\Expr\{
    StaticCall, MethodCall, FuncCall, New_, Variable,
    PropertyFetch, ClassConstFetch, BinaryOp
};
use PhpParser\PrettyPrinter\Standard;

// ═══════════════════════════════════════════════════════════════════════════════
// Helpers (global functions — used by both visitors)
// ═══════════════════════════════════════════════════════════════════════════════

function nodeName(Node $node): string
{
    if ($node instanceof Identifier) return $node->name;
    if ($node instanceof Name)       return $node->toString();
    return '';
}

function chainRoot(Node\Expr $expr): Node\Expr
{
    if ($expr instanceof MethodCall) return chainRoot($expr->var);
    return $expr;
}

/** Build $this->entityManager */
function em(): PropertyFetch
{
    return new PropertyFetch(new Variable('this'), 'entityManager');
}

/** Build $this->entityManager->getRepository(Class::class) */
function repo(string $class): MethodCall
{
    return new MethodCall(em(), 'getRepository', [
        new Node\Arg(new ClassConstFetch(new Name($class), 'class')),
    ]);
}

/** Build $this->entityManager->createQueryBuilder() */
function qb(): MethodCall
{
    return new MethodCall(em(), 'createQueryBuilder');
}

/** Build a MethodCall, wrapping raw args in Node\Arg if needed */
function mc(Node\Expr $obj, string $method, array $args = []): MethodCall
{
    return new MethodCall($obj, $method, array_map(
        fn($a) => $a instanceof Node\Arg ? $a : new Node\Arg($a),
        $args
    ));
}

/** Build a StaticCall */
function sc(string $class, string $method, array $args = []): StaticCall
{
    return new StaticCall(new Name($class), $method, array_map(
        fn($a) => $a instanceof Node\Arg ? $a : new Node\Arg($a),
        $args
    ));
}

/** Extract string value from a scalar string node */
function scalarStr(Node\Expr $e): ?string
{
    return $e instanceof Scalar\String_ ? $e->value : null;
}

// ═══════════════════════════════════════════════════════════════════════════════
// Laravel → Symfony visitor
// ═══════════════════════════════════════════════════════════════════════════════

class LaravelToSymfonyVisitor extends NodeVisitorAbstract
{
    public array $warnings        = [];
    public int   $translatedCount = 0;

    public function leaveNode(Node $node)
    {
        // ── response()->json($data[, $status]) → $this->json(…) ────────────
        if ($node instanceof MethodCall
            && nodeName($node->name) === 'json'
            && $node->var instanceof FuncCall
            && nodeName($node->var->name) === 'response'
        ) {
            $this->hit();
            return mc(new Variable('this'), 'json', $node->args);
        }

        // ── response()->noContent() → new Response(null, 204) ──────────────
        if ($node instanceof MethodCall
            && nodeName($node->name) === 'noContent'
            && $node->var instanceof FuncCall
            && nodeName($node->var->name) === 'response'
        ) {
            $this->hit();
            return new New_(new Name('Response'), [
                new Node\Arg(new Node\Expr\ConstFetch(new Name('null'))),
                new Node\Arg(new Scalar\LNumber(204)),
            ]);
        }

        // ── auth()->user() / ->check() / ->id() ────────────────────────────
        if ($node instanceof MethodCall
            && $node->var instanceof FuncCall
            && nodeName($node->var->name) === 'auth'
        ) {
            $method = nodeName($node->name);
            $this->hit();
            return match ($method) {
                'user'  => mc(new Variable('this'), 'getUser'),
                'check' => new BinaryOp\NotIdentical(
                               mc(new Variable('this'), 'getUser'),
                               new Node\Expr\ConstFetch(new Name('null'))
                           ),
                'id'    => new Node\Expr\NullsafeMethodCall(
                               mc(new Variable('this'), 'getUser'), 'getId'
                           ),
                default => $node,
            };
        }

        // ── $request->all() → $request->request->all() ─────────────────────
        if ($node instanceof MethodCall
            && nodeName($node->name) === 'all'
            && $node->var instanceof Variable
            && $node->var->name === 'request'
        ) {
            $this->hit();
            return mc(new PropertyFetch(new Variable('request'), 'request'), 'all');
        }

        // ── $request->input('key') → $request->get('key') ──────────────────
        if ($node instanceof MethodCall
            && nodeName($node->name) === 'input'
            && $node->var instanceof Variable
            && $node->var->name === 'request'
        ) {
            $this->hit();
            return mc(new Variable('request'), 'get', $node->args);
        }

        // ── Log::info/error/… → $this->logger->info/error/… ────────────────
        if ($node instanceof StaticCall && nodeName($node->class) === 'Log') {
            $method = nodeName($node->name);
            $this->hit();
            return mc(new PropertyFetch(new Variable('this'), 'logger'), $method, $node->args);
        }

        // ── DB:: facades ───────────────────────────────────────────────────
        if ($node instanceof StaticCall && nodeName($node->class) === 'DB') {
            $method = nodeName($node->name);
            switch ($method) {
                case 'beginTransaction': $this->hit(); return mc(em(), 'beginTransaction');
                case 'commit':           $this->hit(); return mc(em(), 'commit');
                case 'rollBack':         $this->hit(); return mc(em(), 'rollback');
                case 'transaction':
                    $this->hit('DB::transaction() → Doctrine wrapInTransaction()');
                    return mc(em(), 'wrapInTransaction', $node->args);
                case 'select':
                    $this->hit('DB::select() → Doctrine DBAL fetchAllAssociative()');
                    return mc(mc(em(), 'getConnection'), 'fetchAllAssociative', $node->args);
                case 'statement':
                    $this->hit('DB::statement() → Doctrine DBAL executeStatement()');
                    return mc(mc(em(), 'getConnection'), 'executeStatement', $node->args);
            }
        }

        // ── Cache:: ─────────────────────────────────────────────────────────
        if ($node instanceof StaticCall && nodeName($node->class) === 'Cache') {
            $method = nodeName($node->name);
            $cache  = new PropertyFetch(new Variable('this'), 'cache');
            switch ($method) {
                case 'get':
                    $this->hit('Cache::get() → Symfony Cache (inject CacheInterface)');
                    return mc(mc($cache, 'getItem', $node->args), 'get');
                case 'forget':
                    $this->hit('Cache::forget() → Symfony Cache deleteItem()');
                    return mc($cache, 'deleteItem', $node->args);
                case 'has':
                    $this->hit('Cache::has() → Symfony Cache hasItem()');
                    return mc($cache, 'hasItem', $node->args);
            }
        }

        // ── dispatch(new Job(…)) → $this->messageBus->dispatch(…) ──────────
        if ($node instanceof FuncCall && nodeName($node->name) === 'dispatch') {
            $this->hit();
            return mc(new PropertyFetch(new Variable('this'), 'messageBus'), 'dispatch', $node->args);
        }

        // ── event(new Event(…)) → $this->eventDispatcher->dispatch(…) ──────
        if ($node instanceof FuncCall && nodeName($node->name) === 'event') {
            $this->hit();
            return mc(new PropertyFetch(new Variable('this'), 'eventDispatcher'), 'dispatch', $node->args);
        }

        // ── Model::all() ────────────────────────────────────────────────────
        if ($node instanceof StaticCall
            && nodeName($node->name) === 'all'
            && $this->isModel($node->class)
        ) {
            $class = nodeName($node->class);
            $this->hit();
            return mc(repo($class), 'findAll');
        }

        // ── Model::find($id) ────────────────────────────────────────────────
        if ($node instanceof StaticCall
            && nodeName($node->name) === 'find'
            && $this->isModel($node->class)
        ) {
            $class = nodeName($node->class);
            $this->hit();
            return mc(repo($class), 'find', $node->args);
        }

        // ── Model::findOrFail($id) ──────────────────────────────────────────
        if ($node instanceof StaticCall
            && nodeName($node->name) === 'findOrFail'
            && $this->isModel($node->class)
        ) {
            $class = nodeName($node->class);
            $this->hit('findOrFail() → find() + createNotFoundException()');
            return new BinaryOp\Coalesce(
                mc(repo($class), 'find', $node->args),
                new Node\Expr\Throw_(mc(new Variable('this'), 'createNotFoundException'))
            );
        }

        // ── Model::count() ──────────────────────────────────────────────────
        if ($node instanceof StaticCall
            && nodeName($node->name) === 'count'
            && empty($node->args)
            && $this->isModel($node->class)
        ) {
            $class = nodeName($node->class);
            $this->hit('::count() → Doctrine getSingleScalarResult()');
            return mc(mc(
                mc(mc(qb(),
                    'select', [new Node\Arg(new Scalar\String_('COUNT(e.id)'))]),
                    'from',   [new Node\Arg(new ClassConstFetch(new Name($class), 'class')),
                               new Node\Arg(new Scalar\String_('e'))]),
                'getQuery'), 'getSingleScalarResult');
        }

        // ── Model::where(…) — root of a QueryBuilder chain ──────────────────
        if ($node instanceof StaticCall
            && nodeName($node->name) === 'where'
            && $this->isModel($node->class)
        ) {
            $class = nodeName($node->class);
            $this->hit('::where() → Doctrine QueryBuilder');
            // Build: $em->createQueryBuilder()->select('e')->from(X::class,'e')->andWhere(…)
            return mc(
                mc(mc(qb(),
                    'select', [new Node\Arg(new Scalar\String_('e'))]),
                    'from',   [new Node\Arg(new ClassConstFetch(new Name($class), 'class')),
                               new Node\Arg(new Scalar\String_('e'))]),
                'andWhere', $node->args
            );
        }

        // ── Eloquent query chain → Doctrine equivalents ─────────────────────
        if ($node instanceof MethodCall) {
            $method = nodeName($node->name);
            switch ($method) {
                case 'orderByDesc':
                    if (!empty($node->args)) {
                        $col = scalarStr($node->args[0]->value) ?? 'id';
                        $this->hit();
                        return mc($node->var, 'orderBy', [
                            new Node\Arg(new Scalar\String_("e.$col")),
                            new Node\Arg(new Scalar\String_('DESC')),
                        ]);
                    }
                    break;
                case 'latest':
                    $col = (!empty($node->args) ? scalarStr($node->args[0]->value) : null) ?? 'createdAt';
                    $this->hit('->latest() → orderBy DESC');
                    return mc($node->var, 'orderBy', [
                        new Node\Arg(new Scalar\String_("e.$col")),
                        new Node\Arg(new Scalar\String_('DESC')),
                    ]);
                case 'oldest':
                    $col = (!empty($node->args) ? scalarStr($node->args[0]->value) : null) ?? 'createdAt';
                    $this->hit('->oldest() → orderBy ASC');
                    return mc($node->var, 'orderBy', [
                        new Node\Arg(new Scalar\String_("e.$col")),
                        new Node\Arg(new Scalar\String_('ASC')),
                    ]);
                case 'limit':
                case 'take':
                    $this->hit();
                    return mc($node->var, 'setMaxResults', $node->args);
                case 'offset':
                case 'skip':
                    $this->hit();
                    return mc($node->var, 'setFirstResult', $node->args);
                case 'groupBy':
                    if (!empty($node->args)) {
                        $col = scalarStr($node->args[0]->value) ?? 'id';
                        $this->hit();
                        return mc($node->var, 'groupBy', [
                            new Node\Arg(new Scalar\String_("e.$col")),
                        ]);
                    }
                    break;
                case 'whereIn':
                    if (count($node->args) >= 2) {
                        $col = scalarStr($node->args[0]->value) ?? 'id';
                        $this->hit('->whereIn() → Doctrine IN(:param)');
                        return mc($node->var, 'andWhere', [
                            new Node\Arg(new Scalar\String_("e.$col IN (:{$col}s)")),
                        ]);
                    }
                    break;
                case 'whereNull':
                    if (!empty($node->args)) {
                        $col = scalarStr($node->args[0]->value) ?? 'id';
                        $this->hit();
                        return mc($node->var, 'andWhere', [new Node\Arg(new Scalar\String_("e.$col IS NULL"))]);
                    }
                    break;
                case 'whereNotNull':
                    if (!empty($node->args)) {
                        $col = scalarStr($node->args[0]->value) ?? 'id';
                        $this->hit();
                        return mc($node->var, 'andWhere', [new Node\Arg(new Scalar\String_("e.$col IS NOT NULL"))]);
                    }
                    break;
                case 'firstOrFail':
                    $this->hit('->firstOrFail() → getOneOrNullResult() + createNotFoundException()');
                    return new BinaryOp\Coalesce(
                        mc(mc($node->var, 'getQuery'), 'getOneOrNullResult'),
                        new Node\Expr\Throw_(mc(new Variable('this'), 'createNotFoundException'))
                    );
                case 'first':
                    $this->hit('->first() → Doctrine getOneOrNullResult()');
                    return mc(mc($node->var, 'getQuery'), 'getOneOrNullResult');
                case 'get':
                    $this->hit('->get() → Doctrine getQuery()->getResult()');
                    return mc(mc($node->var, 'getQuery'), 'getResult');
                case 'exists':
                    $this->hit('->exists() → check getOneOrNullResult() !== null');
                    return new BinaryOp\NotIdentical(
                        mc(mc($node->var, 'getQuery'), 'getOneOrNullResult'),
                        new Node\Expr\ConstFetch(new Name('null'))
                    );
                case 'count':
                    if (empty($node->args)) {
                        $this->hit('->count() → Doctrine getSingleScalarResult()');
                        return mc(mc(
                            mc($node->var, 'select', [new Node\Arg(new Scalar\String_('COUNT(e.id)'))]),
                            'getQuery'), 'getSingleScalarResult');
                    }
                    break;
                case 'save':
                    $this->hit();
                    return mc(mc(em(), 'persist', [$node->var]), 'flush');  // simplified
                case 'delete':
                    $this->hit();
                    return mc(mc(em(), 'remove', [$node->var]), 'flush');
                case 'restore':
                    $this->hit('->restore() → Doctrine: setDeletedAt(null) + flush()');
                    return mc(mc($node->var, 'setDeletedAt', [
                        new Node\Arg(new Node\Expr\ConstFetch(new Name('null'))),
                    ]), 'flushAfter');  // marker
                case 'forceDelete':
                    $this->hit('->forceDelete() → Doctrine remove()+flush()');
                    return mc(mc(em(), 'remove', [$node->var]), 'flush');
                case 'withTrashed':
                    $this->hit('->withTrashed() → Doctrine: disable SoftDeleteable filter');
                    // Replace with a marker method readable in the output
                    return mc($node->var, '__TODO_disable_SoftDeleteable_filter__');
                case 'onlyTrashed':
                    $this->hit('->onlyTrashed() → Doctrine: filter deletedAt IS NOT NULL');
                    return mc($node->var, '__TODO_filter_deletedAt_IS_NOT_NULL__');
                case 'pluck':
                    $this->hit('->pluck() → Doctrine getResult() + array_column()');
                    $col = !empty($node->args) ? (scalarStr($node->args[0]->value) ?? 'id') : 'id';
                    return mc(mc($node->var, 'getQuery'), 'getResult');  // array_column note in warning
            }
        }

        return null;
    }

    private function isModel(Node $classNode): bool
    {
        $name = nodeName($classNode);
        return $name !== '' && ctype_upper($name[0])
            && !in_array($name, ['DB','Log','Cache','Mail','Route','Auth','Gate','Event','Queue'], true);
    }

    private function hit(string $w = ''): void { $this->translatedCount++; if ($w) $this->warnings[] = $w; }
    private function warn(string $w): void      { $this->warnings[] = $w; }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Symfony → Laravel visitor
// ═══════════════════════════════════════════════════════════════════════════════

class SymfonyToLaravelVisitor extends NodeVisitorAbstract
{
    public array $warnings        = [];
    public int   $translatedCount = 0;

    public function leaveNode(Node $node)
    {
        // ── $this->json(…) → response()->json(…) ───────────────────────────
        if ($node instanceof MethodCall
            && nodeName($node->name) === 'json'
            && $node->var instanceof Variable && $node->var->name === 'this'
        ) {
            $this->hit();
            return mc(new FuncCall(new Name('response')), 'json', $node->args);
        }

        // ── $this->getUser() → auth()->user() ──────────────────────────────
        if ($node instanceof MethodCall
            && nodeName($node->name) === 'getUser'
            && $node->var instanceof Variable && $node->var->name === 'this'
        ) {
            $this->hit();
            return mc(new FuncCall(new Name('auth')), 'user');
        }

        // ── $this->denyAccessUnlessGranted(…) → $this->authorize(…) ────────
        if ($node instanceof MethodCall
            && nodeName($node->name) === 'denyAccessUnlessGranted'
            && $node->var instanceof Variable && $node->var->name === 'this'
        ) {
            $this->hit('denyAccessUnlessGranted() → authorize() (configure Gate/Policy)');
            return mc(new Variable('this'), 'authorize', $node->args);
        }

        // ── throw $this->createNotFoundException(…) → abort(404, …) ────────
        if ($node instanceof MethodCall
            && nodeName($node->name) === 'createNotFoundException'
            && $node->var instanceof Variable && $node->var->name === 'this'
        ) {
            $this->hit();
            $msg = $node->args[0] ?? new Node\Arg(new Scalar\String_('Not Found'));
            return new FuncCall(new Name('abort'), [new Node\Arg(new Scalar\LNumber(404)), $msg]);
        }

        // ── throw $this->createAccessDeniedException(…) → abort(403, …) ────
        if ($node instanceof MethodCall
            && nodeName($node->name) === 'createAccessDeniedException'
            && $node->var instanceof Variable && $node->var->name === 'this'
        ) {
            $this->hit();
            $msg = $node->args[0] ?? new Node\Arg(new Scalar\String_('Forbidden'));
            return new FuncCall(new Name('abort'), [new Node\Arg(new Scalar\LNumber(403)), $msg]);
        }

        // ── $request->request->all() → $request->all() ─────────────────────
        if ($node instanceof MethodCall
            && nodeName($node->name) === 'all'
            && $node->var instanceof PropertyFetch
            && nodeName($node->var->name) === 'request'
            && $node->var->var instanceof Variable && $node->var->var->name === 'request'
        ) {
            $this->hit();
            return mc(new Variable('request'), 'all');
        }

        // ── $request->get('key') → $request->input('key') ──────────────────
        if ($node instanceof MethodCall
            && nodeName($node->name) === 'get'
            && $node->var instanceof Variable && $node->var->name === 'request'
        ) {
            $this->hit();
            return mc(new Variable('request'), 'input', $node->args);
        }

        // ── $request->query->get('key') → $request->query('key') ───────────
        if ($node instanceof MethodCall
            && nodeName($node->name) === 'get'
            && $node->var instanceof PropertyFetch
            && nodeName($node->var->name) === 'query'
            && $node->var->var instanceof Variable && $node->var->var->name === 'request'
        ) {
            $this->hit();
            return mc(new Variable('request'), 'query', $node->args);
        }

        // ── $em->getRepository(X::class)->findAll() → X::all() ─────────────
        if ($this->isEmRepoCall($node, 'findAll')) {
            $this->hit(); return sc($this->repoClass($node), 'all');
        }

        // ── $em->getRepository(X::class)->find($id) → X::find($id) ─────────
        if ($this->isEmRepoCall($node, 'find')) {
            $this->hit(); return sc($this->repoClass($node), 'find', $node->args);
        }

        // ── findOneBy([…]) → X::where(…)->first() ──────────────────────────
        if ($this->isEmRepoCall($node, 'findOneBy')) {
            $this->hit('findOneBy() → Eloquent where()->first()');
            return mc(sc($this->repoClass($node), 'where', $node->args), 'first');
        }

        // ── findBy([…]) → X::where(…)->get() ────────────────────────────────
        if ($this->isEmRepoCall($node, 'findBy')) {
            $this->hit('findBy() → Eloquent where()->get()');
            return mc(sc($this->repoClass($node), 'where', $node->args), 'get');
        }

        // ── $em->wrapInTransaction(…) → DB::transaction(…) ─────────────────
        if ($node instanceof MethodCall
            && nodeName($node->name) === 'wrapInTransaction'
            && $this->isEm($node->var)
        ) {
            $this->hit('wrapInTransaction() → DB::transaction()');
            return sc('DB', 'transaction', $node->args);
        }

        // ── $em->beginTransaction/commit/rollback → DB:: ────────────────────
        if ($node instanceof MethodCall && $this->isEm($node->var)) {
            $m = nodeName($node->name);
            $map = ['beginTransaction' => 'beginTransaction', 'commit' => 'commit', 'rollback' => 'rollBack'];
            if (isset($map[$m])) {
                $this->hit(); return sc('DB', $map[$m]);
            }
            if ($m === 'flush') {
                $this->warn('flush() → call ->save() on model instead');
                return $node;
            }
        }

        // ── Doctrine QueryBuilder chain → Eloquent ──────────────────────────
        // ->getQuery()->getResult() → ->get()
        if ($node instanceof MethodCall
            && nodeName($node->name) === 'getResult'
            && $node->var instanceof MethodCall
            && nodeName($node->var->name) === 'getQuery'
        ) {
            /** @var MethodCall $getQueryCall */
            $getQueryCall = $node->var;
            $this->hit('getQuery()->getResult() → ->get()');
            return mc($getQueryCall->var, 'get');
        }

        // ->getQuery()->getOneOrNullResult() → ->first()
        if ($node instanceof MethodCall
            && nodeName($node->name) === 'getOneOrNullResult'
            && $node->var instanceof MethodCall
            && nodeName($node->var->name) === 'getQuery'
        ) {
            /** @var MethodCall $getQueryCall */
            $getQueryCall = $node->var;
            $this->hit('getQuery()->getOneOrNullResult() → ->first()');
            return mc($getQueryCall->var, 'first');
        }

        // ->getQuery()->getSingleScalarResult() → ->value()
        if ($node instanceof MethodCall
            && nodeName($node->name) === 'getSingleScalarResult'
            && $node->var instanceof MethodCall
            && nodeName($node->var->name) === 'getQuery'
        ) {
            /** @var MethodCall $getQueryCall */
            $getQueryCall = $node->var;
            $this->hit('getSingleScalarResult() → Eloquent ->get() (adjust to ->count() / ->sum() as needed)');
            return mc($getQueryCall->var, 'get');
        }

        // ── Doctrine QB chain helpers ────────────────────────────────────────
        if ($node instanceof MethodCall) {
            $m = nodeName($node->name);
            if ($m === 'setMaxResults') { $this->hit(); return mc($node->var, 'limit',  $node->args); }
            if ($m === 'setFirstResult') { $this->hit(); return mc($node->var, 'offset', $node->args); }
        }

        // ── $this->logger->info/error/… → Log::info/error/… ────────────────
        if ($node instanceof MethodCall
            && $node->var instanceof PropertyFetch
            && nodeName($node->var->name) === 'logger'
            && $node->var->var instanceof Variable && $node->var->var->name === 'this'
        ) {
            $this->hit();
            return sc('Log', nodeName($node->name), $node->args);
        }

        // ── $this->messageBus->dispatch(…) → dispatch(…) ────────────────────
        if ($node instanceof MethodCall
            && nodeName($node->name) === 'dispatch'
            && $node->var instanceof PropertyFetch
            && nodeName($node->var->name) === 'messageBus'
        ) {
            $this->hit();
            return new FuncCall(new Name('dispatch'), $node->args);
        }

        // ── $this->eventDispatcher->dispatch(…) → event(…) ──────────────────
        if ($node instanceof MethodCall
            && nodeName($node->name) === 'dispatch'
            && $node->var instanceof PropertyFetch
            && nodeName($node->var->name) === 'eventDispatcher'
        ) {
            $this->hit();
            return new FuncCall(new Name('event'), $node->args);
        }

        // ── Doctrine getter → Eloquent property ($post->getTitle() → $post->title)
        if ($node instanceof MethodCall
            && !($node->var instanceof Variable && $node->var->name === 'this')
            && empty($node->args)
        ) {
            $m = nodeName($node->name);
            if (str_starts_with($m, 'get') && strlen($m) > 3 && ctype_upper($m[3])) {
                $prop = lcfirst(substr($m, 3));
                $skip = ['user','repository','query','connection','container','result','query'];
                if (!in_array($prop, $skip, true)) {
                    $this->hit('Doctrine getter → Eloquent magic property');
                    return new PropertyFetch($node->var, $prop);
                }
            }
        }

        // ── Doctrine setter → Eloquent property assignment ───────────────────
        if ($node instanceof MethodCall
            && !($node->var instanceof Variable && $node->var->name === 'this')
            && count($node->args) === 1
        ) {
            $m = nodeName($node->name);
            if (str_starts_with($m, 'set') && strlen($m) > 3 && ctype_upper($m[3])) {
                $prop = lcfirst(substr($m, 3));
                $this->hit('Doctrine setter → Eloquent property assignment');
                return new Node\Expr\Assign(
                    new PropertyFetch($node->var, $prop),
                    $node->args[0]->value
                );
            }
        }

        // ── $this->cache->getItem('k')->get() → Cache::get('k') ─────────────
        if ($node instanceof MethodCall
            && nodeName($node->name) === 'get'
            && $node->var instanceof MethodCall
            && nodeName($node->var->name) === 'getItem'
            && $node->var->var instanceof PropertyFetch
            && nodeName($node->var->var->name) === 'cache'
        ) {
            /** @var MethodCall $getItemCall */
            $getItemCall = $node->var;
            $this->hit('Symfony Cache → Laravel Cache facade');
            return sc('Cache', 'get', $getItemCall->args);
        }

        // ── $this->cache->deleteItem('k') → Cache::forget('k') ──────────────
        if ($node instanceof MethodCall
            && nodeName($node->name) === 'deleteItem'
            && $node->var instanceof PropertyFetch
            && nodeName($node->var->name) === 'cache'
        ) {
            $this->hit('deleteItem() → Cache::forget()');
            return sc('Cache', 'forget', $node->args);
        }

        return null;
    }

    private function isEm(Node\Expr $e): bool
    {
        return $e instanceof PropertyFetch
            && nodeName($e->name) === 'entityManager'
            && $e->var instanceof Variable && $e->var->name === 'this';
    }

    private function isEmRepoCall(Node $node, string $method): bool
    {
        return $node instanceof MethodCall
            && nodeName($node->name) === $method
            && $node->var instanceof MethodCall
            && nodeName($node->var->name) === 'getRepository'
            && $this->isEm($node->var->var);
    }

    private function repoClass(MethodCall $node): string
    {
        $arg = $node->var->args[0]->value ?? null;
        return ($arg instanceof ClassConstFetch) ? nodeName($arg->class) : 'Model';
    }

    private function hit(string $w = ''): void { $this->translatedCount++; if ($w) $this->warnings[] = $w; }
    private function warn(string $w): void      { $this->warnings[] = $w; }
}

// ═══════════════════════════════════════════════════════════════════════════════
// Main — parse, transform, print
// ═══════════════════════════════════════════════════════════════════════════════

$opts    = getopt('', ['from:', 'to:']);
$from    = $opts['from'] ?? 'laravel';
$to      = $opts['to']   ?? 'symfony';
$code    = stream_get_contents(STDIN);
$factory = new ParserFactory();
$parser  = $factory->createForNewestSupportedVersion();
$printer = new Standard(['shortArraySyntax' => true]);

$wrapped = "<?php\nfunction __bb__() {\n$code\n}";

try {
    $ast = $parser->parse($wrapped);
} catch (\Throwable $e) {
    echo json_encode([
        'code'            => $code,
        'warnings'        => ['AST parse failed: ' . $e->getMessage()],
        'translatedCount' => 0,
    ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit(0);
}

$visitor   = $from === 'laravel' ? new LaravelToSymfonyVisitor() : new SymfonyToLaravelVisitor();
$traverser = new NodeTraverser();
$traverser->addVisitor($visitor);
$transformed = $traverser->traverse($ast);

$stmts = $transformed[0]->stmts ?? [];
$lines = [];
foreach ($stmts as $stmt) {
    $lines[] = $printer->prettyPrint([$stmt]);
}

echo json_encode([
    'code'            => implode("\n", $lines),
    'warnings'        => $visitor->warnings,
    'translatedCount' => $visitor->translatedCount,
], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
