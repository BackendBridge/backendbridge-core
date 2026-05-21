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
});
