# BackendBridge

> **Convert Symfony APIs to Laravel — and back — in minutes.**

```bash
backendbridge migrate --from symfony -s ./my-app
```

```
✔  Controllers + Routes          ✔  Auth (Policies / Voters)
✔  DTOs / FormRequests           ✔  Services stubs
✔  Repositories                  ✔  Translations (en / fr)
✔  Migrations (MySQL · PG · SQLite)  ✔  Docker + PHPUnit
```

OpenAPI-driven backend migration toolkit for Symfony and Laravel.  
Real PHP AST parsing (nikic/PHP-Parser) · Versioned IR · 3-layer logic translation (AST → regex → LLM) · 161 tests · Full CI.

---

## Installation

```bash
npm install -g backendbridge
```

Or from source:

```bash
git clone https://github.com/BackendBridge/backendbridge-core.git
cd backendbridge-core && npm install && npm run build && npm link
```

Set your [OpenRouter](https://openrouter.ai) key for AI-assisted logic translation (optional, free models):

```bash
echo "OPEN_ROUTER_KEY=sk-or-..." >> .env
```

---

## Quickstart — one command

```bash
backendbridge migrate --from symfony -s ./my-symfony-app
```

BackendBridge scans the source project, shows what it detected, and generates the full scaffold in `./generated/laravel/`:

```
  Source: symfony  →  Target: laravel

  Detected features:
    ✔  Repositories       — src/Repository found
    ✔  Console Commands   — src/Command found
    ✔  Translations       — translations/ found
    ✔  Auth (Policies)    — src/Security (Voters) found — rules extracted automatically
    ✔  Services           — src/Service(s) found — stubs generated
    ✔  Jobs / Events      — src/EventListener found
    ✔  Extras             — src/EventSubscriber found
    ✘  Mailer             (skipped — not found in source)
    ✘  Docker             (skipped — not found in source)
```

**Zero config.** BackendBridge reads the source and decides everything.

### `migrate` options

| Flag | Short | Description |
|------|-------|-------------|
| `--from` | | Source framework: `symfony` \| `laravel` \| `auto` (default) |
| `--to` | | Target framework (auto = opposite of source) |
| `--source` | `-s` | Source project folder (default: cwd) |
| `--out` | `-o` | Output folder (default: `./generated`) |
| `--openapi` | | OpenAPI contract — auto-extracted if absent |
| `--mapping` | | JSON business mapping file |
| `--dry-run` | `-n` | Simulate without writing |
| `--commit` | | Commit message |
| `--no-git-commit` | | Disable auto-commit |

---

## What gets generated

### Smart detection

BackendBridge scans the source to decide what to generate:

| Detected in source | Generated in target |
|---|---|
| `src/Repository/` or `app/Repositories/` | Repository + Interface + ServiceProvider |
| `src/Security/*Voter.php` or `app/Policies/` | Policy (Laravel) or Voter (Symfony) — **rules extracted from code** |
| `src/Service/` or `app/Services/` | Service stubs with same signatures |
| `src/Command/` or `app/Console/Commands/` | Console Commands (Artisan or `#[AsCommand]`) |
| `translations/` or `lang/` | Translation files en/fr |
| `src/EventSubscriber/` or `app/Listeners/` | EventSubscribers or Listeners |
| `app/Jobs/` or `src/Message/` | Jobs + Events + Listeners + Notifications |
| `app/Http/Middleware/` | Middleware JWT/auth/throttle/CORS |
| `app/Mail/` or `src/Mailer/` | Mailable stubs or Mailer service |
| `database/seeders/` or `src/DataFixtures/` | Seeders + Factories or Doctrine Fixtures |
| `Dockerfile` | Dockerfile + docker-compose.yml |
| `tests/` or `phpunit.xml` | PHPUnit skeleton |

### Always generated

Regardless of flags, `migrate` always generates:

- **Controllers** with try/catch (404, 422, 500), pagination, DB transactions
- **FormRequests** (Laravel) / **DTOs with Assert** (Symfony) from OpenAPI schema
- **JsonResources** (Laravel) for each GET resource
- **Routes** (`routes/api.php` or `#[Route]` attributes)
- **Eloquent Models** / **Doctrine Entities** from source PHP classes
- **SQL Migrations** (MySQL, PostgreSQL, SQLite compatible)
- **`.env`** file adapted to the target framework

---

## Logic translation (3-layer pipeline)

The `migrate` command automatically translates framework-specific patterns:

| Layer | Engine | What it handles |
|---|---|---|
| 1 | **PHP AST** (nikic/PHP-Parser) | Multi-line chains, nested calls — e.g. `Post::where()->orderBy()->paginate()` across multiple lines |
| 2 | **Regex rules** (80+ patterns) | Single-line patterns — fallback when PHP unavailable |
| 3 | **LLM** (OpenRouter, free) | Residual patterns neither AST nor regex can reach |

**LLM models used** (all free, via `OPEN_ROUTER_KEY` in `.env`):

| Role | Model |
|---|---|
| Primary translation | Gemma 4 31B IT (`google/gemma-4-31b-it:free`) |
| Fallback 1 | NVIDIA Nemotron 3 Super 120B (`nvidia/nemotron-3-super-120b-a12b:free`) |
| Fallback 2 | GPT-OSS 120B (`openai/gpt-oss-120b:free`) |
| Explanations | GPT-OSS 20B (`openai/gpt-oss-20b:free`) |

Example translations:

| Laravel | Symfony |
|---|---|
| `return response()->json($data)` | `return $this->json($data)` |
| `auth()->user()` | `$this->getUser()` |
| `Post::where('active', true)->orderByDesc('created_at')->paginate(15)` | Doctrine QueryBuilder chain |
| `$post->save()` | `$em->persist($post); $em->flush()` |
| `DB::transaction(fn() => ...)` | `$em->wrapInTransaction(fn() => ...)` |
| `Cache::get('key')` | `$this->cache->getItem('key')->get()` |
| `Log::info(...)` | `$this->logger->info(...)` |
| `dispatch(new Job(...))` | `$this->messageBus->dispatch(new Job(...))` |

And the reverse (Symfony → Laravel). Unrecognized patterns are kept as `// TODO:` comments with the original source.

---

## Advanced commands

### `convert` — full manual control

Use when you want to pick exactly what gets generated:

```bash
# Short form
backendbridge convert --to laravel --openapi ./api.yaml -s ./my-symfony -o ./out --all

# Selective
backendbridge convert --to laravel --openapi ./api.yaml -s ./my-symfony \
  --with-auth --with-services --with-repos --with-translations
```

| Flag | Short | Description |
|------|-------|-------------|
| `--all` | `-A` | Enable all optional generators |
| `--with-auth` | | Policies (Laravel) or Voters (Symfony) |
| `--with-services` | | Service stubs from source controller analysis |
| `--with-repos` | | Repository + Interface per resource |
| `--with-commands` | | Console Commands (Artisan / Symfony) |
| `--with-translations` | | Translation files en/fr |
| `--with-jobs` | | Jobs / Events / Listeners / Notifications |
| `--with-middleware` | | Middleware JWT/auth/throttle/CORS |
| `--with-mailer` | | Mailable stubs or Mailer service |
| `--with-seeders` | | Seeders + Factories or Doctrine Fixtures |
| `--with-extras` | | Guard+Provider+Collection or EventSubscriber |
| `--with-tests` | | PHPUnit skeleton |
| `--with-docker` | | Dockerfile + docker-compose.yml |
| `--with-source-logic` | | Translate source logic (AST + LLM) |
| `--source` | `-s` | Source project folder |
| `--out` | `-o` | Output folder |
| `--dry-run` | `-n` | Simulate without writing |
| `--extract-if-missing` | | Auto-extract OpenAPI if file absent |
| `--mapping` | | JSON business mapping file |

### `build` — generate both Laravel AND Symfony from one OpenAPI contract

```bash
backendbridge build --openapi ./contracts/api.yaml -o ./generated --with-services --with-docker
```

Generates `./generated/laravel/` and `./generated/symfony/` simultaneously.

### `extract` — extract OpenAPI from source code

```bash
backendbridge extract --from auto -s ./my-laravel-app --out ./contracts/api.yaml
```

Auto-detects Laravel (`Route::...`) and Symfony (`#[Route]`, ApiPlatform). Uses PHP AST automatically when available.

### `doctor` — audit compatibility before converting

```bash
backendbridge doctor -s ./my-symfony-app --report ./reports/doctor.json
```

Returns: detected framework, route count, ApiPlatform coverage, compatibility risks.

### `diff` — preview without writing

```bash
backendbridge diff --from symfony -s ./my-symfony-app
```

Shows what `migrate` would generate — no files written.

### `mapping-export` / `apply-mapping` — business mapping

```bash
backendbridge mapping-export --from symfony -s ./my-symfony --openapi ./api.yaml --out ./mapping/map.json
backendbridge apply-mapping --mapping ./mapping/map.json --target ./my-laravel --framework laravel
```

### `run-plan` — action pipeline

```yaml
# bridge.pipeline.yaml
version: 1
actions:
  - type: extract
    from: auto
    source: ./api-source
    out: ./contracts/api.yaml
  - type: convert
    from: auto
    to: laravel
    source: ./api-source
    openapi: ./contracts/api.yaml
    out: ./generated/laravel
```

```bash
backendbridge run-plan --file ./bridge.pipeline.yaml
```

### Other commands

| Command | Description |
|---|---|
| `setup` | Check PHP, Composer, Laravel CLI, Symfony CLI |
| `create` | Create a new Laravel or Symfony project |
| `run` | Start Laravel and Symfony in parallel |
| `convert-config` | Translate `security.yaml` (Symfony) ↔ `auth.php` (Laravel) |
| `release` | Bump version, generate CHANGELOG, publish to npm |

---

## Dev scripts

```bash
npm run lint    # TypeScript strict check
npm test        # 161 tests (vitest)
npm run build   # tsup → dist/
npm run package # standalone binary (Node.js SEA)
```

---

## Known limits

- **Complex custom business logic** (deeply nested conditions, domain-specific services) — the 3-layer translation covers ~90% of common patterns; the rest lands as `// TODO:` with original source in comments.
- **Advanced Doctrine relations** (table inheritance, embeddables) — not covered.
