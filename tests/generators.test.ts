import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import type { ApiContract } from "../src/types.js";
import { generateLaravelFromContract } from "../src/generators/laravel.js";
import { generateSymfonyFromContract } from "../src/generators/symfony.js";
import { generateLaravelJobsEventsNotifications, generateSymfonyJobsEventsNotifications } from "../src/job-event-notification-generator.js";
import { generateDockerFiles } from "../src/docker-generator.js";
import { generateLaravelSeedersAndFactories, generateSymfonyFixtures } from "../src/seeder-factory-generator.js";
import { generateLaravelMiddleware, generateSymfonyMiddleware } from "../src/middleware-generator.js";
import { generateLaravelMailer, generateSymfonyMailer } from "../src/mailer-generator.js";

// ─── Shared fixture contract ──────────────────────────────────────────────────

const blogContract: ApiContract = {
  title: "Blog API",
  version: "1.0.0",
  endpoints: [
    {
      method: "get",
      path: "/posts",
      operationId: "list_posts",
      tags: ["Post"],
      summary: "List all posts",
    },
    {
      method: "get",
      path: "/posts/{id}",
      operationId: "get_post",
      tags: ["Post"],
      pathParameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }],
    },
    {
      method: "post",
      path: "/posts",
      operationId: "create_post",
      tags: ["Post"],
      requestBodySchema: {
        properties: {
          title: { type: "string", minLength: 3, maxLength: 255 },
          content: { type: "string" },
          email: { type: "string", format: "email" },
        },
        required: ["title", "content"],
      },
    },
    {
      method: "put",
      path: "/posts/{id}",
      operationId: "update_post",
      tags: ["Post"],
      requestBodySchema: {
        properties: {
          title: { type: "string" },
          content: { type: "string" },
        },
        required: [],
      },
    },
    {
      method: "delete",
      path: "/posts/{id}",
      operationId: "delete_post",
      tags: ["Post"],
      pathParameters: [{ name: "id", in: "path", required: true }],
    },
  ],
};

const uploadContract: ApiContract = {
  title: "Upload API",
  version: "1.0.0",
  endpoints: [
    {
      method: "post",
      path: "/upload",
      operationId: "upload_file",
      tags: ["Upload"],
      requestBodySchema: {
        properties: {
          avatar: { type: "string", format: "binary" },
          photos: { type: "array", items: { type: "string", format: "binary" } },
        },
        required: ["avatar"],
      },
    },
  ],
};

// ─── Helper ───────────────────────────────────────────────────────────────────

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "bb-gen-test-"));
}

// ─── Laravel generator ────────────────────────────────────────────────────────

describe("Laravel controller generator", () => {
  let tmp: string;
  beforeEach(() => { tmp = tmpDir(); });
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it("generates controllers, FormRequests, JsonResources and routes", () => {
    const files = generateLaravelFromContract(blogContract, tmp);

    const controllerNames = ["ListPostsController.php", "GetPostController.php", "CreatePostController.php", "UpdatePostController.php", "DeletePostController.php"];
    for (const name of controllerNames) {
      const found = files.find((f) => f.endsWith(name));
      expect(found, `Missing ${name}`).toBeTruthy();
      const content = fs.readFileSync(found!, "utf8");
      expect(content).toContain("namespace App\\Http\\Controllers\\Generated");
      expect(content).toContain("extends Controller");
    }

    // JsonResource generated for GET endpoints
    const resourceFile = files.find((f) => f.includes("Resources") && f.endsWith("Resource.php"));
    expect(resourceFile).toBeTruthy();

    // FormRequest for POST
    const requestFile = files.find((f) => f.endsWith("CreatePostRequest.php"));
    expect(requestFile).toBeTruthy();
    const reqContent = fs.readFileSync(requestFile!, "utf8");
    expect(reqContent).toContain("extends FormRequest");
    expect(reqContent).toContain("'title'");
    expect(reqContent).toContain("min:3");

    // routes/api.php
    const routesFile = files.find((f) => f.endsWith("api.php"));
    expect(routesFile).toBeTruthy();
    const routesContent = fs.readFileSync(routesFile!, "utf8");
    expect(routesContent).toContain("Route::get");
    expect(routesContent).toContain("Route::post");
  });

  it("wraps controller body in try/catch with proper error responses", () => {
    const files = generateLaravelFromContract(blogContract, tmp);
    const ctrl = files.find((f) => f.endsWith("CreatePostController.php"))!;
    const content = fs.readFileSync(ctrl, "utf8");
    expect(content).toContain("try {");
    expect(content).toContain("ModelNotFoundException");
    expect(content).toContain("response()->json");
    expect(content).toContain("404");
    expect(content).toContain("422");
    expect(content).toContain("500");
  });

  it("adds paginate hint for list endpoints", () => {
    const files = generateLaravelFromContract(blogContract, tmp);
    const ctrl = files.find((f) => f.endsWith("ListPostsController.php"))!;
    const content = fs.readFileSync(ctrl, "utf8");
    expect(content).toContain("->paginate(");
  });

  it("adds findOrFail hint for show endpoints", () => {
    const files = generateLaravelFromContract(blogContract, tmp);
    const ctrl = files.find((f) => f.endsWith("GetPostController.php"))!;
    const content = fs.readFileSync(ctrl, "utf8");
    expect(content).toContain("findOrFail");
  });

  it("adds DB::beginTransaction hint for write operations", () => {
    const files = generateLaravelFromContract(blogContract, tmp);
    const ctrl = files.find((f) => f.endsWith("CreatePostController.php"))!;
    const content = fs.readFileSync(ctrl, "utf8");
    expect(content).toContain("DB::beginTransaction");
    expect(content).toContain("DB::commit");
    expect(content).toContain("DB::rollBack");
  });

  it("handles single and multiple file uploads", () => {
    const files = generateLaravelFromContract(uploadContract, tmp);
    const ctrl = files.find((f) => f.endsWith("UploadFileController.php"))!;
    const content = fs.readFileSync(ctrl, "utf8");
    expect(content).toContain("Single upload");
    expect(content).toContain("Multiple uploads");

    // FormRequest should have array rule for multiple uploads
    const req = files.find((f) => f.endsWith("UploadFileRequest.php"))!;
    const reqContent = fs.readFileSync(req, "utf8");
    expect(reqContent).toContain("'photos' => '");
    expect(reqContent).toContain("array");
    expect(reqContent).toContain("'photos.*'");
  });
});

// ─── Symfony generator ────────────────────────────────────────────────────────

describe("Symfony controller generator", () => {
  let tmp: string;
  beforeEach(() => { tmp = tmpDir(); });
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it("generates controllers and DTOs", () => {
    const files = generateSymfonyFromContract(blogContract, tmp);

    const controllerNames = ["ListPostsController.php", "GetPostController.php", "CreatePostController.php"];
    for (const name of controllerNames) {
      const found = files.find((f) => f.endsWith(name));
      expect(found, `Missing ${name}`).toBeTruthy();
      const content = fs.readFileSync(found!, "utf8");
      expect(content).toContain("namespace App\\Controller\\Generated");
      expect(content).toContain("extends AbstractController");
      expect(content).toContain("#[Route(");
    }

    // DTO for POST
    const dto = files.find((f) => f.endsWith("CreatePostDto.php"));
    expect(dto).toBeTruthy();
    const dtoContent = fs.readFileSync(dto!, "utf8");
    expect(dtoContent).toContain("Assert\\NotBlank");
    expect(dtoContent).toContain("Assert\\Length");
  });

  it("wraps controller body in try/catch", () => {
    const files = generateSymfonyFromContract(blogContract, tmp);
    const ctrl = files.find((f) => f.endsWith("CreatePostController.php"))!;
    const content = fs.readFileSync(ctrl, "utf8");
    expect(content).toContain("try {");
    expect(content).toContain("NotFoundHttpException");
    expect(content).toContain("this->json");
    expect(content).toContain("404");
    expect(content).toContain("500");
  });

  it("adds paginator hint for list endpoints", () => {
    const files = generateSymfonyFromContract(blogContract, tmp);
    const ctrl = files.find((f) => f.endsWith("ListPostsController.php"))!;
    const content = fs.readFileSync(ctrl, "utf8");
    expect(content).toContain("setMaxResults");
  });

  it("adds createNotFoundException hint for show endpoints", () => {
    const files = generateSymfonyFromContract(blogContract, tmp);
    const ctrl = files.find((f) => f.endsWith("GetPostController.php"))!;
    const content = fs.readFileSync(ctrl, "utf8");
    expect(content).toContain("createNotFoundException");
  });

  it("adds transaction hint for write operations", () => {
    const files = generateSymfonyFromContract(blogContract, tmp);
    const ctrl = files.find((f) => f.endsWith("CreatePostController.php"))!;
    const content = fs.readFileSync(ctrl, "utf8");
    expect(content).toContain("beginTransaction");
    expect(content).toContain("persist");
    expect(content).toContain("flush");
    expect(content).toContain("rollback");
  });

  it("switches to Request param when file upload present", () => {
    const files = generateSymfonyFromContract(uploadContract, tmp);
    const ctrl = files.find((f) => f.endsWith("UploadFileController.php"))!;
    const content = fs.readFileSync(ctrl, "utf8");
    expect(content).toContain("Request $request");
    expect(content).not.toContain("#[MapRequestPayload]");
  });
});

// ─── Jobs/Events/Notifications generator ──────────────────────────────────────

describe("Jobs/Events/Notifications generator — Laravel", () => {
  let tmp: string;
  beforeEach(() => { tmp = tmpDir(); });
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it("generates Job, Notification, Events, Listeners, EventServiceProvider", () => {
    const files = generateLaravelJobsEventsNotifications(blogContract, tmp);

    const jobFile = files.find((f) => f.endsWith("ProcessPostJob.php"));
    expect(jobFile).toBeTruthy();
    const jobContent = fs.readFileSync(jobFile!, "utf8");
    expect(jobContent).toContain("implements ShouldQueue");
    expect(jobContent).toContain("public int \$tries");

    const notifFile = files.find((f) => f.endsWith("PostNotification.php"));
    expect(notifFile).toBeTruthy();
    const notifContent = fs.readFileSync(notifFile!, "utf8");
    expect(notifContent).toContain("extends Notification");
    expect(notifContent).toContain("'mail', 'database'");

    const createdEvent = files.find((f) => f.endsWith("PostCreatedEvent.php"));
    expect(createdEvent).toBeTruthy();

    const createdListener = files.find((f) => f.endsWith("OnPostCreatedListener.php"));
    expect(createdListener).toBeTruthy();

    const provider = files.find((f) => f.endsWith("GeneratedEventServiceProvider.php"));
    expect(provider).toBeTruthy();
    const providerContent = fs.readFileSync(provider!, "utf8");
    expect(providerContent).toContain("PostCreatedEvent::class");
    expect(providerContent).toContain("OnPostCreatedListener::class");
  });
});

describe("Jobs/Events/Notifications generator — Symfony", () => {
  let tmp: string;
  beforeEach(() => { tmp = tmpDir(); });
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it("generates Message, MessageHandler, Events, Listeners, Notification", () => {
    const files = generateSymfonyJobsEventsNotifications(blogContract, tmp);

    const msgFile = files.find((f) => f.endsWith("PostMessage.php"));
    expect(msgFile).toBeTruthy();
    const msgContent = fs.readFileSync(msgFile!, "utf8");
    expect(msgContent).toContain("final class PostMessage");

    const handlerFile = files.find((f) => f.endsWith("PostMessageHandler.php"));
    expect(handlerFile).toBeTruthy();
    const handlerContent = fs.readFileSync(handlerFile!, "utf8");
    expect(handlerContent).toContain("#[AsMessageHandler]");
    expect(handlerContent).toContain("PostMessage \$message");

    const notifFile = files.find((f) => f.endsWith("PostNotification.php"));
    expect(notifFile).toBeTruthy();

    const listenerFile = files.find((f) => f.endsWith("PostCreatedListener.php"));
    expect(listenerFile).toBeTruthy();
    const listenerContent = fs.readFileSync(listenerFile!, "utf8");
    expect(listenerContent).toContain("#[AsEventListener");
  });
});

// ─── Docker generator ─────────────────────────────────────────────────────────

describe("Docker generator", () => {
  let tmp: string;
  beforeEach(() => { tmp = tmpDir(); });
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it("generates Dockerfile and docker-compose.yml for Laravel", () => {
    const result = generateDockerFiles("laravel", tmp);
    expect(result.files.some((f) => f.endsWith("Dockerfile"))).toBe(true);
    expect(result.files.some((f) => f.endsWith("docker-compose.yml"))).toBe(true);

    const dockerfilePath = result.files.find((f) => f.endsWith("Dockerfile"))!;
    const content = fs.readFileSync(dockerfilePath, "utf8");
    expect(content).toContain("php");

    const composePath = result.files.find((f) => f.endsWith("docker-compose.yml"))!;
    const composeContent = fs.readFileSync(composePath, "utf8");
    expect(composeContent).toContain("mysql");
  });

  it("generates Dockerfile and docker-compose.yml for Symfony", () => {
    const result = generateDockerFiles("symfony", tmp);
    const composePath = result.files.find((f) => f.endsWith("docker-compose.yml"))!;
    const content = fs.readFileSync(composePath, "utf8");
    expect(content).toContain("postgres");
  });
});

// ─── Seeder/Factory generator ─────────────────────────────────────────────────

describe("Seeder/Factory generator — Laravel", () => {
  let tmp: string;
  beforeEach(() => { tmp = tmpDir(); });
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it("generates factory and seeder files", () => {
    const files = generateLaravelSeedersAndFactories(blogContract, tmp);
    const factory = files.find((f) => f.endsWith("Factory.php"));
    const seeder = files.find((f) => f.endsWith("Seeder.php"));
    expect(factory).toBeTruthy();
    expect(seeder).toBeTruthy();
    const factContent = fs.readFileSync(factory!, "utf8");
    expect(factContent).toContain("extends Factory");
    expect(factContent).toContain("definition()");
  });
});

describe("Fixtures generator — Symfony", () => {
  let tmp: string;
  beforeEach(() => { tmp = tmpDir(); });
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it("generates Doctrine fixture classes", () => {
    const files = generateSymfonyFixtures(blogContract, tmp);
    const fixture = files.find((f) => f.endsWith("Fixture.php") || f.endsWith("Fixtures.php"));
    expect(fixture).toBeTruthy();
    const content = fs.readFileSync(fixture!, "utf8");
    // Symfony Fixtures extend the abstract Fixture class (which implements FixtureInterface)
    expect(content).toContain("extends Fixture");
  });
});

// ─── Middleware generator ─────────────────────────────────────────────────────

describe("Middleware generator — Laravel", () => {
  let tmp: string;
  beforeEach(() => { tmp = tmpDir(); });
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it("generates auth, throttle and CORS middleware files", () => {
    const files = generateLaravelMiddleware(tmp);
    expect(files.some((f) => f.toLowerCase().includes("auth"))).toBe(true);
    expect(files.some((f) => f.toLowerCase().includes("throttle") || f.toLowerCase().includes("cors") || f.toLowerCase().includes("rate"))).toBe(true);
  });
});

describe("Middleware generator — Symfony", () => {
  let tmp: string;
  beforeEach(() => { tmp = tmpDir(); });
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it("generates EventSubscriber stubs for JWT/throttle", () => {
    const files = generateSymfonyMiddleware(tmp);
    const subscriber = files.find((f) => f.endsWith("Subscriber.php"));
    expect(subscriber).toBeTruthy();
    const content = fs.readFileSync(subscriber!, "utf8");
    expect(content).toContain("implements EventSubscriberInterface");
  });
});

// ─── Mailer generator ─────────────────────────────────────────────────────────

describe("Mailer generator — Laravel", () => {
  let tmp: string;
  beforeEach(() => { tmp = tmpDir(); });
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it("generates Mailable stubs and .env example", () => {
    const files = generateLaravelMailer(tmp);
    const mailable = files.find((f) => f.endsWith("Mail.php"));
    expect(mailable).toBeTruthy();
    const content = fs.readFileSync(mailable!, "utf8");
    expect(content).toContain("extends Mailable");
    const envFile = files.find((f) => f.includes(".env"));
    expect(envFile).toBeTruthy();
  });
});

describe("Mailer generator — Symfony", () => {
  let tmp: string;
  beforeEach(() => { tmp = tmpDir(); });
  afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it("generates Mailer service stubs and config", () => {
    const files = generateSymfonyMailer(tmp);
    const mailerService = files.find((f) => f.endsWith("Mailer.php"));
    expect(mailerService).toBeTruthy();
    const content = fs.readFileSync(mailerService!, "utf8");
    expect(content).toContain("MailerInterface");
  });
});
