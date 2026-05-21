import { describe, it, expect } from "vitest";
import { translatePhpBody } from "../src/logic-translator.js";

describe("logic-translator — Laravel → Symfony", () => {
  it("translates response()->json() to $this->json()", () => {
    const { code } = translatePhpBody("return response()->json($data);", "laravel", "symfony");
    expect(code).toContain("$this->json($data)");
  });

  it("translates response()->json() with status code", () => {
    const { code } = translatePhpBody("return response()->json($data, 201);", "laravel", "symfony");
    expect(code).toContain("$this->json($data, 201)");
  });

  it("translates auth()->user() to $this->getUser()", () => {
    const { code } = translatePhpBody("$user = auth()->user();", "laravel", "symfony");
    expect(code).toContain("$this->getUser()");
  });

  it("translates $request->all() to $request->request->all()", () => {
    const { code } = translatePhpBody("$data = $request->all();", "laravel", "symfony");
    expect(code).toContain("$request->request->all()");
  });

  it("translates $request->input('key') to $request->get('key')", () => {
    const { code } = translatePhpBody("$v = \$request->input('name');", "laravel", "symfony");
    expect(code).toContain("$request->get('name')");
  });

  it("translates Post::all() to entityManager->findAll()", () => {
    const { code } = translatePhpBody("$posts = Post::all();", "laravel", "symfony");
    expect(code).toContain("findAll()");
    expect(code).toContain("Post::class");
  });

  it("translates Post::find($id) to entityManager->find()", () => {
    const { code } = translatePhpBody("$post = Post::find($id);", "laravel", "symfony");
    expect(code).toContain("find($id)");
  });

  it("translates DB::beginTransaction()", () => {
    const { code } = translatePhpBody("DB::beginTransaction();", "laravel", "symfony");
    expect(code).toContain("beginTransaction()");
  });

  it("translates Log::info() to $this->logger->info()", () => {
    const { code } = translatePhpBody("Log::info('hello');", "laravel", "symfony");
    expect(code).toContain("$this->logger->info('hello')");
  });

  it("produces a warning for paginate()", () => {
    const { warnings } = translatePhpBody("Post::paginate(15);", "laravel", "symfony");
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings[0]).toMatch(/paginate/i);
  });

  it("tracks translatedCount", () => {
    const { translatedCount } = translatePhpBody(
      "return response()->json($data); $user = auth()->user();",
      "laravel", "symfony"
    );
    expect(translatedCount).toBeGreaterThanOrEqual(2);
  });
});

describe("logic-translator — Symfony → Laravel", () => {
  it("translates $this->json() to response()->json()", () => {
    const { code } = translatePhpBody("return \$this->json($data);", "symfony", "laravel");
    expect(code).toContain("response()->json($data)");
  });

  it("translates $this->json() with status code", () => {
    const { code } = translatePhpBody("return \$this->json($data, 201);", "symfony", "laravel");
    expect(code).toContain("response()->json($data, 201)");
  });

  it("translates $this->getUser() to auth()->user()", () => {
    const { code } = translatePhpBody("\$user = \$this->getUser();", "symfony", "laravel");
    expect(code).toContain("auth()->user()");
  });

  it("translates $request->request->all() to $request->all()", () => {
    const { code } = translatePhpBody("\$data = \$request->request->all();", "symfony", "laravel");
    expect(code).toContain("$request->all()");
  });

  it("translates $request->get('key') to $request->input('key')", () => {
    const { code } = translatePhpBody("\$v = \$request->get('name');", "symfony", "laravel");
    expect(code).toContain("$request->input('name')");
  });

  it("translates entityManager->findAll() to Model::all()", () => {
    const { code } = translatePhpBody(
      "\$posts = \$this->entityManager->getRepository(Post::class)->findAll();",
      "symfony", "laravel"
    );
    expect(code).toContain("Post::all()");
  });

  it("translates entityManager->find() to Model::find()", () => {
    const { code } = translatePhpBody(
      "\$post = \$this->entityManager->getRepository(Post::class)->find(\$id);",
      "symfony", "laravel"
    );
    expect(code).toContain("Post::find($id)");
  });

  it("translates createNotFoundException to abort(404)", () => {
    const { code } = translatePhpBody(
      "throw \$this->createNotFoundException('Not found');",
      "symfony", "laravel"
    );
    expect(code).toContain("abort(404");
  });

  it("translates $this->logger->error() to Log::error()", () => {
    const { code } = translatePhpBody("\$this->logger->error('oops');", "symfony", "laravel");
    expect(code).toContain("Log::error('oops')");
  });

  it("returns unchanged code for same framework", () => {
    const body = "return response()->json([]);";
    const { code, translatedCount } = translatePhpBody(body, "laravel", "laravel");
    expect(code).toBe(body);
    expect(translatedCount).toBe(0);
  });

  it("translates findOneBy to Eloquent where()->first()", () => {
    const { code } = translatePhpBody(
      "\$p = \$this->entityManager->getRepository(Post::class)->findOneBy(['slug' => \$slug]);",
      "symfony", "laravel"
    );
    expect(code).toContain("Post::where");
    expect(code).toContain("->first()");
  });

  it("translates findBy to Eloquent where()->get()", () => {
    const { code } = translatePhpBody(
      "\$list = \$this->entityManager->getRepository(Post::class)->findBy(['active' => true]);",
      "symfony", "laravel"
    );
    expect(code).toContain("Post::where");
    expect(code).toContain("->get()");
  });

  it("translates Doctrine getQuery()->getResult() to ->get()", () => {
    const { code } = translatePhpBody(
      "\$posts = \$qb->getQuery()->getResult();",
      "symfony", "laravel"
    );
    expect(code).toContain("->get()");
  });

  it("translates Doctrine getOneOrNullResult() to ->first()", () => {
    const { code } = translatePhpBody(
      "\$post = \$qb->getQuery()->getOneOrNullResult();",
      "symfony", "laravel"
    );
    expect(code).toContain("->first()");
  });

  it("translates Doctrine setMaxResults to ->limit()", () => {
    const { code } = translatePhpBody(
      "\$qb->setMaxResults(10);",
      "symfony", "laravel"
    );
    expect(code).toContain("->limit(10)");
  });

  it("translates Doctrine setFirstResult to ->offset()", () => {
    const { code } = translatePhpBody(
      "\$qb->setFirstResult(20);",
      "symfony", "laravel"
    );
    expect(code).toContain("->offset(20)");
  });

  it("translates wrapInTransaction to DB::transaction()", () => {
    const { code } = translatePhpBody(
      "\$this->entityManager->wrapInTransaction(fn() => \$post->save());",
      "symfony", "laravel"
    );
    expect(code).toContain("DB::transaction(");
  });

  it("translates Doctrine getter to Eloquent property", () => {
    const { code } = translatePhpBody(
      "\$title = \$post->getTitle();",
      "symfony", "laravel"
    );
    expect(code).toContain("$post->title");
  });

  it("translates Doctrine setter to Eloquent property assignment", () => {
    const { code } = translatePhpBody(
      "\$post->setTitle(\$title);",
      "symfony", "laravel"
    );
    expect(code).toContain("$post->title = $title");
  });

  it("translates deleteItem() to Cache::forget()", () => {
    const { code } = translatePhpBody(
      "\$this->cache->deleteItem('my-key');",
      "symfony", "laravel"
    );
    expect(code).toContain("Cache::forget('my-key')");
  });

  it("translates fetchAllAssociative to DB::select()", () => {
    const { code } = translatePhpBody(
      "\$rows = \$this->entityManager->getConnection()->fetchAllAssociative('SELECT * FROM posts');",
      "symfony", "laravel"
    );
    expect(code).toContain("DB::select(");
  });
});

describe("logic-translator — Laravel → Symfony (extended patterns)", () => {
  it("translates ->orderByDesc() to Doctrine orderBy DESC", () => {
    const { code } = translatePhpBody("Post::where('active', true)->orderByDesc('created_at');", "laravel", "symfony");
    expect(code).toContain("orderBy('e.created_at', 'DESC')");
  });

  it("translates ->latest() to orderBy createdAt DESC with warning", () => {
    const { code, warnings } = translatePhpBody("Post::where('active', 1)->latest();", "laravel", "symfony");
    expect(code).toContain("orderBy('e.createdAt', 'DESC')");
    expect(warnings.some(w => /latest/i.test(w))).toBe(true);
  });

  it("translates ->limit() to setMaxResults()", () => {
    const { code } = translatePhpBody("Post::where('active', 1)->limit(5);", "laravel", "symfony");
    expect(code).toContain("setMaxResults(5)");
  });

  it("translates ->skip()->take() to setFirstResult/setMaxResults", () => {
    const { code } = translatePhpBody("Post::where('x', 1)->skip(10)->take(5);", "laravel", "symfony");
    expect(code).toContain("setFirstResult(10)");
    expect(code).toContain("setMaxResults(5)");
  });

  it("translates ->firstOrFail() with warning", () => {
    const { code, warnings } = translatePhpBody("Post::where('id', \$id)->firstOrFail();", "laravel", "symfony");
    expect(code).toContain("getOneOrNullResult()");
    expect(code).toContain("createNotFoundException");
    expect(warnings.some(w => /firstOrFail/i.test(w))).toBe(true);
  });

  it("translates ->count() aggregate with warning", () => {
    const { code, warnings } = translatePhpBody("Post::where('active', 1)->count();", "laravel", "symfony");
    expect(code).toContain("getSingleScalarResult()");
    expect(warnings.some(w => /count/i.test(w))).toBe(true);
  });

  it("translates Post::count() to Doctrine COUNT query", () => {
    const { code } = translatePhpBody("Post::count();", "laravel", "symfony");
    expect(code).toContain("COUNT(e.id)");
    expect(code).toContain("Post::class");
  });

  it("translates ->restore() to setDeletedAt(null) + flush with warning", () => {
    const { code, warnings } = translatePhpBody("\$post->restore();", "laravel", "symfony");
    expect(code).toContain("setDeletedAt(null)");
    expect(warnings.some(w => /restore/i.test(w))).toBe(true);
  });

  it("translates ->forceDelete() to Doctrine remove + flush", () => {
    const { code } = translatePhpBody("\$post->forceDelete();", "laravel", "symfony");
    expect(code).toContain("entityManager->remove");
    expect(code).toContain("flush()");
  });

  it("translates DB::transaction(fn) to wrapInTransaction", () => {
    const { code, warnings } = translatePhpBody("DB::transaction(fn() => \$post->save());", "laravel", "symfony");
    expect(code).toContain("wrapInTransaction");
    expect(warnings.some(w => /transaction/i.test(w))).toBe(true);
  });

  it("translates DB::select() to fetchAllAssociative", () => {
    const { code, warnings } = translatePhpBody("DB::select('SELECT * FROM posts WHERE id = ?', [\$id]);", "laravel", "symfony");
    expect(code).toContain("fetchAllAssociative");
    expect(warnings.some(w => /select/i.test(w))).toBe(true);
  });

  it("translates ->withTrashed() with warning", () => {
    const { code, warnings } = translatePhpBody("Post::where('id', \$id)->withTrashed();", "laravel", "symfony");
    expect(code).toContain("SoftDeleteable");
    expect(warnings.some(w => /withTrashed/i.test(w))).toBe(true);
  });

  it("translates Cache::forget() to deleteItem()", () => {
    const { code, warnings } = translatePhpBody("Cache::forget('posts');", "laravel", "symfony");
    expect(code).toContain("deleteItem('posts')");
    expect(warnings.some(w => /forget/i.test(w))).toBe(true);
  });

  it("translates ->whereIn() to Doctrine IN clause", () => {
    const { code, warnings } = translatePhpBody("Post::where('active', 1)->whereIn('status', \$statuses);", "laravel", "symfony");
    expect(code).toContain("IN (:");
    expect(warnings.some(w => /whereIn/i.test(w))).toBe(true);
  });
});
