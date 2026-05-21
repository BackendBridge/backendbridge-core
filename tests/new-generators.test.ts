import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import type { ApiContract } from "../src/types.js";
import { generateSymfonyRepositories, generateLaravelRepositories } from "../src/generators/repository.js";
import { generateSymfonyEventSubscribers, generateLaravelGuard, generateLaravelServiceProvider, generateLaravelResourceCollections } from "../src/generators/extras.js";
import { generateLaravelCommands, generateSymfonyCommands } from "../src/generators/commands.js";
import { generateLaravelTranslations, generateSymfonyTranslations } from "../src/generators/translation.js";

// ─── Fixture ──────────────────────────────────────────────────────────────────

const blogContract: ApiContract = {
  title: "Blog API",
  version: "1.0.0",
  endpoints: [
    { method: "get",    path: "/posts",       operationId: "list_posts",   tags: ["Post"] },
    { method: "post",   path: "/posts",       operationId: "create_post",  tags: ["Post"] },
    { method: "put",    path: "/posts/{id}",  operationId: "update_post",  tags: ["Post"] },
    { method: "delete", path: "/posts/{id}",  operationId: "delete_post",  tags: ["Post"] },
    { method: "get",    path: "/comments",    operationId: "list_comments",tags: ["Comment"] },
    { method: "post",   path: "/comments",    operationId: "create_comment",tags: ["Comment"] },
  ],
};

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "bb-newgen-"));
}

function phpLint(files: string[]): void {
  for (const f of files.filter((f) => f.endsWith(".php"))) {
    execFileSync("php", ["-l", f], { stdio: "pipe" });
  }
}

// ─── Repository generator ─────────────────────────────────────────────────────

describe("Repository generator — Symfony", () => {
  let tmp: string;
  beforeEach(() => { tmp = tmpDir(); });
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it("generates one Repository per resource", () => {
    const files = generateSymfonyRepositories(blogContract, tmp);
    expect(files.find((f) => f.endsWith("PostRepository.php"))).toBeTruthy();
    expect(files.find((f) => f.endsWith("CommentRepository.php"))).toBeTruthy();
  });

  it("extends ServiceEntityRepository and has findAllPaginated", () => {
    const files = generateSymfonyRepositories(blogContract, tmp);
    const repo = fs.readFileSync(files.find((f) => f.endsWith("PostRepository.php"))!, "utf8");
    expect(repo).toContain("extends ServiceEntityRepository");
    expect(repo).toContain("findAllPaginated");
    expect(repo).toContain("countAll");
  });

  it("all generated PHP files pass php -l", () => {
    phpLint(generateSymfonyRepositories(blogContract, tmp));
  });
});

describe("Repository generator — Laravel", () => {
  let tmp: string;
  beforeEach(() => { tmp = tmpDir(); });
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it("generates Interface + Implementation + RepositoryServiceProvider", () => {
    const files = generateLaravelRepositories(blogContract, tmp);
    expect(files.find((f) => f.endsWith("PostRepositoryInterface.php"))).toBeTruthy();
    expect(files.find((f) => f.endsWith("PostRepository.php"))).toBeTruthy();
    expect(files.find((f) => f.endsWith("RepositoryServiceProvider.php"))).toBeTruthy();
  });

  it("Repository implements its interface and has CRUD methods", () => {
    const files = generateLaravelRepositories(blogContract, tmp);
    const repo = fs.readFileSync(files.find((f) => f.includes("Repositories") && f.endsWith("PostRepository.php"))!, "utf8");
    expect(repo).toContain("implements PostRepositoryInterface");
    expect(repo).toContain("findOrFail");
    expect(repo).toContain("paginate");
  });

  it("all generated PHP files pass php -l", () => {
    phpLint(generateLaravelRepositories(blogContract, tmp));
  });
});

// ─── Extras: EventSubscriber, Guard, ServiceProvider, ResourceCollection ──────

describe("EventSubscriber generator — Symfony", () => {
  let tmp: string;
  beforeEach(() => { tmp = tmpDir(); });
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it("generates one EventSubscriber per resource with CUD actions", () => {
    const files = generateSymfonyEventSubscribers(blogContract, tmp);
    expect(files.find((f) => f.endsWith("PostEventSubscriber.php"))).toBeTruthy();
  });

  it("implements EventSubscriberInterface with getSubscribedEvents", () => {
    const files = generateSymfonyEventSubscribers(blogContract, tmp);
    const content = fs.readFileSync(files.find((f) => f.endsWith("PostEventSubscriber.php"))!, "utf8");
    expect(content).toContain("implements EventSubscriberInterface");
    expect(content).toContain("getSubscribedEvents");
    expect(content).toContain("PostCreatedEvent");
    expect(content).toContain("PostUpdatedEvent");
    expect(content).toContain("PostDeletedEvent");
  });

  it("all generated PHP files pass php -l", () => {
    phpLint(generateSymfonyEventSubscribers(blogContract, tmp));
  });
});

describe("Guard generator — Laravel", () => {
  let tmp: string;
  beforeEach(() => { tmp = tmpDir(); });
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it("generates ApiTokenGuard, GuardServiceProvider and auth config hint", () => {
    const files = generateLaravelGuard(tmp);
    expect(files.find((f) => f.endsWith("ApiTokenGuard.php"))).toBeTruthy();
    expect(files.find((f) => f.endsWith("GuardServiceProvider.php"))).toBeTruthy();
    expect(files.find((f) => f.endsWith("auth.generated.php"))).toBeTruthy();
  });

  it("ApiTokenGuard implements Guard with user() and validate()", () => {
    const files = generateLaravelGuard(tmp);
    const content = fs.readFileSync(files.find((f) => f.endsWith("ApiTokenGuard.php"))!, "utf8");
    expect(content).toContain("implements Guard");
    expect(content).toContain("public function user()");
    expect(content).toContain("public function validate(");
  });

  it("all generated PHP files pass php -l", () => {
    phpLint(generateLaravelGuard(tmp));
  });
});

describe("ServiceProvider generator — Laravel", () => {
  let tmp: string;
  beforeEach(() => { tmp = tmpDir(); });
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it("generates GeneratedServiceProvider with register and boot methods", () => {
    const files = generateLaravelServiceProvider(blogContract, tmp);
    expect(files.length).toBe(1);
    const content = fs.readFileSync(files[0], "utf8");
    expect(content).toContain("extends ServiceProvider");
    expect(content).toContain("public function register()");
    expect(content).toContain("public function boot()");
  });

  it("passes php -l", () => {
    phpLint(generateLaravelServiceProvider(blogContract, tmp));
  });
});

describe("ResourceCollection generator — Laravel", () => {
  let tmp: string;
  beforeEach(() => { tmp = tmpDir(); });
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it("generates one Collection per resource", () => {
    const files = generateLaravelResourceCollections(blogContract, tmp);
    expect(files.find((f) => f.endsWith("PostCollection.php"))).toBeTruthy();
    expect(files.find((f) => f.endsWith("CommentCollection.php"))).toBeTruthy();
  });

  it("extends ResourceCollection with pagination meta", () => {
    const files = generateLaravelResourceCollections(blogContract, tmp);
    const content = fs.readFileSync(files.find((f) => f.endsWith("PostCollection.php"))!, "utf8");
    expect(content).toContain("extends ResourceCollection");
    expect(content).toContain("'meta'");
    expect(content).toContain("'total'");
    expect(content).toContain("'links'");
  });

  it("all generated PHP files pass php -l", () => {
    phpLint(generateLaravelResourceCollections(blogContract, tmp));
  });
});

// ─── Commands generator ───────────────────────────────────────────────────────

describe("Commands generator — Laravel", () => {
  let tmp: string;
  beforeEach(() => { tmp = tmpDir(); });
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it("generates one Command per resource + kernel hint", () => {
    const files = generateLaravelCommands(blogContract, tmp);
    expect(files.find((f) => f.endsWith("ProcessPostCommand.php"))).toBeTruthy();
    expect(files.find((f) => f.endsWith("ProcessCommentCommand.php"))).toBeTruthy();
    expect(files.find((f) => f.includes("kernel.generated"))).toBeTruthy();
  });

  it("command has $signature and handle() method", () => {
    const files = generateLaravelCommands(blogContract, tmp);
    const content = fs.readFileSync(files.find((f) => f.endsWith("ProcessPostCommand.php"))!, "utf8");
    expect(content).toContain("extends Command");
    expect(content).toContain("protected $signature");
    expect(content).toContain("public function handle()");
    expect(content).toContain("self::SUCCESS");
  });

  it("all generated PHP files pass php -l", () => {
    phpLint(generateLaravelCommands(blogContract, tmp).filter((f) => !f.includes("kernel.generated")));
  });
});

describe("Commands generator — Symfony", () => {
  let tmp: string;
  beforeEach(() => { tmp = tmpDir(); });
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it("generates one Command per resource", () => {
    const files = generateSymfonyCommands(blogContract, tmp);
    expect(files.find((f) => f.endsWith("ProcessPostCommand.php"))).toBeTruthy();
    expect(files.find((f) => f.endsWith("ProcessCommentCommand.php"))).toBeTruthy();
  });

  it("uses #[AsCommand] attribute and returns Command::SUCCESS", () => {
    const files = generateSymfonyCommands(blogContract, tmp);
    const content = fs.readFileSync(files.find((f) => f.endsWith("ProcessPostCommand.php"))!, "utf8");
    expect(content).toContain("#[AsCommand(");
    expect(content).toContain("extends Command");
    expect(content).toContain("Command::SUCCESS");
  });

  it("all generated PHP files pass php -l", () => {
    phpLint(generateSymfonyCommands(blogContract, tmp));
  });
});

// ─── Translation generator ────────────────────────────────────────────────────

describe("Translation generator — Laravel", () => {
  let tmp: string;
  beforeEach(() => { tmp = tmpDir(); });
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it("generates lang/en and lang/fr files per resource + validation", () => {
    const files = generateLaravelTranslations(blogContract, tmp);
    expect(files.find((f) => f.includes("lang/en") && f.endsWith("post.php"))).toBeTruthy();
    expect(files.find((f) => f.includes("lang/fr") && f.endsWith("post.php"))).toBeTruthy();
    expect(files.find((f) => f.includes("lang/en") && f.endsWith("validation.php"))).toBeTruthy();
    expect(files.find((f) => f.includes("lang/fr") && f.endsWith("validation.php"))).toBeTruthy();
  });

  it("en file contains English messages", () => {
    const files = generateLaravelTranslations(blogContract, tmp);
    const en = fs.readFileSync(files.find((f) => f.includes("lang/en") && f.endsWith("post.php"))!, "utf8");
    expect(en).toContain("created successfully");
    expect(en).toContain("<?php");
  });

  it("fr file contains French messages", () => {
    const files = generateLaravelTranslations(blogContract, tmp);
    const fr = fs.readFileSync(files.find((f) => f.includes("lang/fr") && f.endsWith("post.php"))!, "utf8");
    expect(fr).toContain("succès");
  });

  it("all generated PHP files pass php -l", () => {
    phpLint(generateLaravelTranslations(blogContract, tmp));
  });
});

describe("Translation generator — Symfony", () => {
  let tmp: string;
  beforeEach(() => { tmp = tmpDir(); });
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it("generates messages.en.yaml and messages.fr.yaml", () => {
    const files = generateSymfonyTranslations(blogContract, tmp);
    expect(files.find((f) => f.endsWith("messages.en.yaml"))).toBeTruthy();
    expect(files.find((f) => f.endsWith("messages.fr.yaml"))).toBeTruthy();
  });

  it("en file has English keys for each resource", () => {
    const files = generateSymfonyTranslations(blogContract, tmp);
    const en = fs.readFileSync(files.find((f) => f.endsWith("messages.en.yaml"))!, "utf8");
    expect(en).toContain("post.created");
    expect(en).toContain("successfully");
  });

  it("fr file has French translations", () => {
    const files = generateSymfonyTranslations(blogContract, tmp);
    const fr = fs.readFileSync(files.find((f) => f.endsWith("messages.fr.yaml"))!, "utf8");
    expect(fr).toContain("succès");
  });
});
