# Changelog

All notable changes to BackendBridge are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Versioning follows [Semantic Versioning](https://semver.org/).

---

## [Unreleased]

---

## [0.2.0] — 2025-05-21

### Added
- **`migrate` command** — smart single-command conversion that auto-detects which features are present in the source project (repositories, events, auth, mailer, commands, translations, docker…) and generates only what's relevant.
- **Repository generator** — Symfony (`ServiceEntityRepository` with `findAllPaginated`, `countAll`) and Laravel (Interface + Implementation + `RepositoryServiceProvider`). Flag: `--with-repositories`.
- **Console Commands generator** — Symfony (`#[AsCommand]`, `SymfonyStyle`) and Laravel Artisan commands with kernel hint file. Flag: `--with-commands`.
- **Translations generator** — Laravel `lang/en` + `lang/fr` PHP files per resource + `validation.php`. Symfony `messages.en.yaml` + `messages.fr.yaml`. Flag: `--with-translations`.
- **Extras generators** — Laravel: `ApiTokenGuard`, `GuardServiceProvider`, `GeneratedServiceProvider`, `{Resource}Collection`. Symfony: `{Resource}EventSubscriber` (Created/Updated/Deleted events). Flag: `--with-extras`.
- **Auth generators** — Laravel `Policy` and Symfony `Voter` generated from mapping auth rules. Flag: `--with-auth`.
- **Queue/Messenger config** — Symfony `config/packages/messenger.yaml` and Laravel `config/queue.generated.php` generated alongside Jobs.
- **Standalone binary** — `npm run package` produces a self-contained Node.js SEA binary (no Node.js required on target machine). PHP scripts embedded as TypeScript constants for SEA fallback.
- **`build` command** — generates both Laravel and Symfony scaffolds simultaneously from a single OpenAPI contract.
- **`migrate` command** — replaces all `--with-*` flags with automatic source-code detection.

### Fixed
- `DeletedEvent` was generated but never registered in `EventServiceProvider.$listen` — fixed.
- `#[Assert\...]` on indented class properties not captured by schema extractor — regex updated.
- `import.meta.url` empty in CJS/SEA builds — `resolvePhpScript()` falls back to tmpdir copy.

### Changed
- `toSnake()` utility added for generating Artisan command signatures (e.g., `post:process`).
- All generators now accept `ApiContract` and output path; return array of generated file paths.

---

## [0.1.0] — 2025-04-01

### Added
- **`convert` command** — bidirectional Symfony ↔ Laravel conversion from an OpenAPI contract.
- **`extract` command** — extract OpenAPI from Laravel routes or Symfony `#[Route]` attributes (+ ApiPlatform).
- **`doctor` command** — audit source project for compatibility risks before conversion.
- **`mapping-export` / `mapping-import` / `mapping-edit`** — business mapping workflow (DTO/validation/auth rules).
- **`apply-mapping`** — apply a mapping file to a target project (interactive + batch mode).
- **`run-plan`** — execute a YAML/JSON pipeline of extract + convert actions.
- **`release`** — bump `package.json`, generate `CHANGELOG.md`, commit, tag, publish to npm.
- **`setup`** — check PHP, Composer, Laravel CLI, Symfony CLI availability.
- **`create`** — scaffold a new Laravel or Symfony project.
- **`run`** — start Laravel and Symfony dev servers in parallel.
- **`convert-config`** — translate `security.yaml` (Symfony) ↔ `auth.php` (Laravel).
- **Controllers** with try/catch, 404/422/500 responses, pagination, `findOrFail`, DB transactions.
- **FormRequests** (Laravel) and **DTOs with Assert constraints** (Symfony) from OpenAPI schema.
- **JsonResources** (Laravel) per exposed resource.
- **Routes** (`routes/api.php` Laravel, `#[Route]` attributes Symfony).
- **File upload** support: single (`format: binary`) and multiple (`type: array, items.format: binary`).
- **Docker** — Dockerfile PHP 8.2 + docker-compose with MySQL (Laravel) or PostgreSQL (Symfony).
- **Seeders/Factories** — Faker inference by field name (email, name, phone, etc.).
- **Middleware** — JWT auth subscriber, throttle, CORS.
- **Mailer** — `WelcomeMail`, `PasswordResetMail`, `.env` config hints.
- **Jobs/Events/Notifications** — Laravel (`ShouldQueue` Jobs, Events, Listeners, Notifications, `EventServiceProvider`) and Symfony (Messenger Messages + Handlers, Events, Listeners, Notifier Notifications).
- **Doctrine Entities** — attributes (`#[ORM\Entity]`), OneToMany/ManyToOne relations, collection methods.
- **Migrations** — Laravel + SQL (SQLite, MySQL, PostgreSQL) with nullable, defaults, indexes, FK constraints.
- **PHPUnit skeleton** — `phpunit.xml.dist` + base test class.
- **CI** — GitHub Actions: lint + build + vitest + PHP 8.2 phpstan/phpunit + MySQL/PostgreSQL matrix.
