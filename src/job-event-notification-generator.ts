import fs from "node:fs";
import path from "node:path";
import type { ApiContract } from "./types.js";
import { toStudly, ensureDir } from "./utils.js";

// ─── Resource inference ────────────────────────────────────────────────────────

interface ResourceGroup {
  name: string;
  hasCreate: boolean;
  hasUpdate: boolean;
  hasDelete: boolean;
}

function inferResourceGroups(contract: ApiContract): ResourceGroup[] {
  const map = new Map<string, ResourceGroup>();

  for (const ep of contract.endpoints) {
    const tag = ep.tags?.[0];
    const rawName = tag
      ? toStudly(tag)
      : toStudly(ep.operationId.replace(/^(create|update|delete|get|list|show|fetch)_?/i, "").split("_")[0] ?? ep.operationId);

    const name = rawName || "Resource";
    if (!map.has(name)) map.set(name, { name, hasCreate: false, hasUpdate: false, hasDelete: false });
    const g = map.get(name)!;
    if (ep.method === "post") g.hasCreate = true;
    if (ep.method === "put" || ep.method === "patch") g.hasUpdate = true;
    if (ep.method === "delete") g.hasDelete = true;
  }

  return [...map.values()];
}

// ─── Laravel generators ────────────────────────────────────────────────────────

function laravelJob(resource: string): string {
  return `<?php

namespace App\\Jobs\\Generated;

use Illuminate\\Bus\\Queueable;
use Illuminate\\Contracts\\Queue\\ShouldQueue;
use Illuminate\\Foundation\\Bus\\Dispatchable;
use Illuminate\\Queue\\InteractsWithQueue;
use Illuminate\\Queue\\SerializesModels;

class Process${resource}Job implements ShouldQueue
{
    use Dispatchable, InteractsWithQueue, Queueable, SerializesModels;

    public int $tries = 3;
    public int $timeout = 60;

    public function __construct(
        public readonly int $resourceId,
        public readonly array $payload = [],
    ) {}

    public function handle(): void
    {
        // TODO: implement job logic for ${resource}
        // Example: send notification, process upload, call external API, etc.
    }

    public function failed(\\Throwable $exception): void
    {
        // TODO: handle failure (log, notify admin, etc.)
    }
}
`;
}

function laravelEvent(resource: string, action: string): string {
  return `<?php

namespace App\\Events\\Generated;

use Illuminate\\Foundation\\Events\\Dispatchable;
use Illuminate\\Queue\\SerializesModels;

class ${resource}${action}Event
{
    use Dispatchable, SerializesModels;

    public function __construct(
        public readonly int $resourceId,
        public readonly array $data = [],
    ) {}
}
`;
}

function laravelListener(resource: string, action: string): string {
  return `<?php

namespace App\\Listeners\\Generated;

use App\\Events\\Generated\\${resource}${action}Event;

class On${resource}${action}Listener
{
    public function handle(${resource}${action}Event $event): void
    {
        // TODO: react to ${resource} ${action.toLowerCase()} event
        // Example: dispatch a job, send email, update cache, etc.
        // \\App\\Jobs\\Generated\\Process${resource}Job::dispatch($event->resourceId);
    }
}
`;
}

function laravelNotification(resource: string): string {
  return `<?php

namespace App\\Notifications\\Generated;

use Illuminate\\Bus\\Queueable;
use Illuminate\\Contracts\\Queue\\ShouldQueue;
use Illuminate\\Notifications\\Messages\\MailMessage;
use Illuminate\\Notifications\\Notification;

class ${resource}Notification extends Notification implements ShouldQueue
{
    use Queueable;

    public function __construct(
        public readonly string $action,
        public readonly array $data = [],
    ) {}

    /** @return string[] */
    public function via(mixed $notifiable): array
    {
        return ['mail', 'database'];
    }

    public function toMail(mixed $notifiable): MailMessage
    {
        return (new MailMessage)
            ->subject("${resource}: {$this->action}")
            ->line("A ${resource} has been {$this->action}.")
            ->action('View', url('/'))
            ->line('Thank you for using our application.');
    }

    /** @return array<string, mixed> */
    public function toDatabase(mixed $notifiable): array
    {
        return [
            'resource' => '${resource}',
            'action'   => $this->action,
            'data'     => $this->data,
        ];
    }
}
`;
}

function laravelEventServiceProvider(groups: ResourceGroup[]): string {
  const listens: string[] = [];
  for (const g of groups) {
    if (g.hasCreate) {
      listens.push(
        `        \\App\\Events\\Generated\\${g.name}CreatedEvent::class => [\n            \\App\\Listeners\\Generated\\On${g.name}CreatedListener::class,\n        ],`,
      );
    }
    if (g.hasUpdate) {
      listens.push(
        `        \\App\\Events\\Generated\\${g.name}UpdatedEvent::class => [\n            \\App\\Listeners\\Generated\\On${g.name}UpdatedListener::class,\n        ],`,
      );
    }
  }

  return `<?php

namespace App\\Providers;

use Illuminate\\Foundation\\Support\\Providers\\EventServiceProvider as ServiceProvider;

/**
 * Auto-generated event map — merge with your existing EventServiceProvider.
 */
class GeneratedEventServiceProvider extends ServiceProvider
{
    /** @var array<class-string, list<class-string>> */
    protected $listen = [
${listens.join("\n")}
    ];
}
`;
}

// ─── Symfony generators ────────────────────────────────────────────────────────

function symfonyMessage(resource: string): string {
  return `<?php

namespace App\\Message\\Generated;

final class ${resource}Message
{
    public function __construct(
        public readonly int $resourceId,
        public readonly string $action,
        public readonly array $payload = [],
    ) {}
}
`;
}

function symfonyMessageHandler(resource: string): string {
  return `<?php

namespace App\\MessageHandler\\Generated;

use App\\Message\\Generated\\${resource}Message;
use Symfony\\Component\\Messenger\\Attribute\\AsMessageHandler;

#[AsMessageHandler]
final class ${resource}MessageHandler
{
    public function __invoke(${resource}Message $message): void
    {
        // TODO: handle ${resource} message (action: $message->action, id: $message->resourceId)
        // Example: send email, call external API, update search index, etc.
    }
}
`;
}

function symfonyEvent(resource: string, action: string): string {
  return `<?php

namespace App\\Event\\Generated;

final class ${resource}${action}Event
{
    public function __construct(
        public readonly int $resourceId,
        public readonly array $data = [],
    ) {}
}
`;
}

function symfonyEventListener(resource: string, action: string): string {
  return `<?php

namespace App\\EventListener\\Generated;

use App\\Event\\Generated\\${resource}${action}Event;
use Symfony\\Component\\EventDispatcher\\Attribute\\AsEventListener;

#[AsEventListener(event: ${resource}${action}Event::class)]
final class ${resource}${action}Listener
{
    public function __invoke(${resource}${action}Event $event): void
    {
        // TODO: react to ${resource} ${action.toLowerCase()} event
        // Example: $this->bus->dispatch(new ${resource}Message($event->resourceId, '${action.toLowerCase()}'));
    }
}
`;
}

function symfonyNotification(resource: string): string {
  return `<?php

namespace App\\Notification\\Generated;

use Symfony\\Component\\Notifier\\Message\\EmailMessage;
use Symfony\\Component\\Notifier\\Notification\\EmailNotificationInterface;
use Symfony\\Component\\Notifier\\Notification\\Notification;
use Symfony\\Component\\Notifier\\Recipient\\EmailRecipientInterface;

class ${resource}Notification extends Notification implements EmailNotificationInterface
{
    public function __construct(
        private readonly string $action,
        private readonly array  $data = [],
    ) {
        parent::__construct("${resource}: {$this->action}");
    }

    public function asEmailMessage(EmailRecipientInterface $recipient, string $transport = null): EmailMessage
    {
        return EmailMessage::fromNotification($this, $recipient);
    }

    public function getChannels(mixed $recipient): array
    {
        return ['email'];
    }
}
`;
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function generateLaravelJobsEventsNotifications(contract: ApiContract, outPath: string): string[] {
  const groups = inferResourceGroups(contract);
  const generated: string[] = [];

  const jobsDir = path.join(outPath, "app", "Jobs", "Generated");
  const eventsDir = path.join(outPath, "app", "Events", "Generated");
  const listenersDir = path.join(outPath, "app", "Listeners", "Generated");
  const notificationsDir = path.join(outPath, "app", "Notifications", "Generated");
  const providersDir = path.join(outPath, "app", "Providers");

  ensureDir(jobsDir);
  ensureDir(eventsDir);
  ensureDir(listenersDir);
  ensureDir(notificationsDir);
  ensureDir(providersDir);

  for (const g of groups) {
    const jobPath = path.join(jobsDir, `Process${g.name}Job.php`);
    fs.writeFileSync(jobPath, laravelJob(g.name), "utf8");
    generated.push(jobPath);

    const notifPath = path.join(notificationsDir, `${g.name}Notification.php`);
    fs.writeFileSync(notifPath, laravelNotification(g.name), "utf8");
    generated.push(notifPath);

    if (g.hasCreate) {
      const ep = path.join(eventsDir, `${g.name}CreatedEvent.php`);
      fs.writeFileSync(ep, laravelEvent(g.name, "Created"), "utf8");
      generated.push(ep);
      const lp = path.join(listenersDir, `On${g.name}CreatedListener.php`);
      fs.writeFileSync(lp, laravelListener(g.name, "Created"), "utf8");
      generated.push(lp);
    }
    if (g.hasUpdate) {
      const ep = path.join(eventsDir, `${g.name}UpdatedEvent.php`);
      fs.writeFileSync(ep, laravelEvent(g.name, "Updated"), "utf8");
      generated.push(ep);
      const lp = path.join(listenersDir, `On${g.name}UpdatedListener.php`);
      fs.writeFileSync(lp, laravelListener(g.name, "Updated"), "utf8");
      generated.push(lp);
    }
    if (g.hasDelete) {
      const ep = path.join(eventsDir, `${g.name}DeletedEvent.php`);
      fs.writeFileSync(ep, laravelEvent(g.name, "Deleted"), "utf8");
      generated.push(ep);
      const lp = path.join(listenersDir, `On${g.name}DeletedListener.php`);
      fs.writeFileSync(lp, laravelListener(g.name, "Deleted"), "utf8");
      generated.push(lp);
    }
  }

  const providerPath = path.join(providersDir, "GeneratedEventServiceProvider.php");
  fs.writeFileSync(providerPath, laravelEventServiceProvider(groups), "utf8");
  generated.push(providerPath);

  return generated;
}

export function generateSymfonyJobsEventsNotifications(contract: ApiContract, outPath: string): string[] {
  const groups = inferResourceGroups(contract);
  const generated: string[] = [];

  const messagesDir = path.join(outPath, "src", "Message", "Generated");
  const handlersDir = path.join(outPath, "src", "MessageHandler", "Generated");
  const eventsDir = path.join(outPath, "src", "Event", "Generated");
  const listenersDir = path.join(outPath, "src", "EventListener", "Generated");
  const notificationsDir = path.join(outPath, "src", "Notification", "Generated");

  ensureDir(messagesDir);
  ensureDir(handlersDir);
  ensureDir(eventsDir);
  ensureDir(listenersDir);
  ensureDir(notificationsDir);

  for (const g of groups) {
    const msgPath = path.join(messagesDir, `${g.name}Message.php`);
    fs.writeFileSync(msgPath, symfonyMessage(g.name), "utf8");
    generated.push(msgPath);

    const handlerPath = path.join(handlersDir, `${g.name}MessageHandler.php`);
    fs.writeFileSync(handlerPath, symfonyMessageHandler(g.name), "utf8");
    generated.push(handlerPath);

    const notifPath = path.join(notificationsDir, `${g.name}Notification.php`);
    fs.writeFileSync(notifPath, symfonyNotification(g.name), "utf8");
    generated.push(notifPath);

    if (g.hasCreate) {
      const ep = path.join(eventsDir, `${g.name}CreatedEvent.php`);
      fs.writeFileSync(ep, symfonyEvent(g.name, "Created"), "utf8");
      generated.push(ep);
      const lp = path.join(listenersDir, `${g.name}CreatedListener.php`);
      fs.writeFileSync(lp, symfonyEventListener(g.name, "Created"), "utf8");
      generated.push(lp);
    }
    if (g.hasUpdate) {
      const ep = path.join(eventsDir, `${g.name}UpdatedEvent.php`);
      fs.writeFileSync(ep, symfonyEvent(g.name, "Updated"), "utf8");
      generated.push(ep);
      const lp = path.join(listenersDir, `${g.name}UpdatedListener.php`);
      fs.writeFileSync(lp, symfonyEventListener(g.name, "Updated"), "utf8");
      generated.push(lp);
    }
    if (g.hasDelete) {
      const ep = path.join(eventsDir, `${g.name}DeletedEvent.php`);
      fs.writeFileSync(ep, symfonyEvent(g.name, "Deleted"), "utf8");
      generated.push(ep);
      const lp = path.join(listenersDir, `${g.name}DeletedListener.php`);
      fs.writeFileSync(lp, symfonyEventListener(g.name, "Deleted"), "utf8");
      generated.push(lp);
    }
  }

  return generated;
}
