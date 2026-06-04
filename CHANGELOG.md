# Changelog

All notable changes to BackendBridge are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Versioning follows [Semantic Versioning](https://semver.org/).

---

## [Unreleased]

---

## [0.3.0] — 2026-06-04

### Added
- **3-layer logic translation pipeline** — AST → regex → LLM, all three working in sequence:
  - **PHP AST transformer** (`tools/transform_logic.php`) — nikic/PHP-Parser `NodeVisitor` that handles multi-line chains and nested expressions regex cannot match. Covers responses, auth, request, Eloquent/Doctrine finders, QueryBuilder chains, result fetching, DB facades, logging, cache, messaging, getters/setters.
  - **80+ regex rules** in `logic-translator.ts` — query chains (orderBy, limit, skip/take, whereIn, groupBy), aggregates (count/sum/avg/max/min), soft deletes (withTrashed/restore/forceDelete), DB::transaction closures, raw queries, Cache::forget/has, Doctrine QB → Eloquent, getter/setter → property access.
  - **OpenRouter LLM fallback** (`src/openrouter.ts`) — for residual patterns (≤80 lines). Free models only, key from `.env`.
- **LLM models** (free tier, OpenRouter):
  - Primary: `google/gemma-4-31b-it:free` (Gemma 4 31B — 256K ctx, strong on code)
  - Fallback 1: `nvidia/nemotron-3-super-120b-a12b:free` (Nemotron 3 Super — 1M ctx, SWE-Bench Verified)
  - Fallback 2: `openai/gpt-oss-120b:free` (GPT-OSS 120B)
  - Explain: `openai/gpt-oss-20b:free`
- **`--all` / `-A` flag** on `convert` — enables all optional generators in one flag.
- **`--with-repos`** short alias for `--with-repositories`.
- **Short flags** on `migrate` and `convert`: `-s` (source), `-o` (out), `-n` (dry-run).
- **`translatePhpBodyAsync()`** — async path in logic-translator for LLM fallback.
- **Open source project files** — `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, GitHub issue/PR templates, `repository`/`homepage`/`bugs` in `package.json`.

### Changed
- `runConversion()` and `runPipeline()` are now `async` (required for LLM fallback).
- `enhanceControllersWithSourceLogic()` is now `async`.
- CLI: `program.alias("bb")` — `bb` can now be used as a shorter entry point.
- README fully rewritten in English: short flags documented, logic translation table expanded, LLM model table added, limits updated.
- `--use-php-ast` flag removed from `convert` (AST is now always automatic when `php` is available).

### Fixed
- Double-prefixing bug (`e.e.column`) when AST and regex both ran on the same output.
- `withTrashed`/`onlyTrashed` in AST visitor now produce a named marker method instead of silently passing through.
- All async test functions updated (`it()` → `async it()`).

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
