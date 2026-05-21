# BackendBridge

> **Convertis ton API Symfony en Laravel (ou l'inverse) en une seule commande.**

CLI Node.js + TypeScript qui analyse ton projet source, détecte automatiquement ce qui existe (repositories, auth, events, services, commandes, traductions…) et génère uniquement ce qui est pertinent dans le framework cible.

---

## Installation

```bash
npm install -g backendbridge
```

Ou depuis les sources :

```bash
npm install && npm run build && npm link
```

---

## Démarrage rapide — une commande suffit

```bash
backendbridge migrate --from symfony --source ./mon-projet-symfony
```

BackendBridge analyse le projet source, affiche ce qu'il a détecté, et génère le scaffold complet dans `./generated/laravel/` :

```
  Source détectée : symfony  →  Cible : laravel

  Features détectées dans le projet source :
    ✔  Repositories       — src/Repository détecté
    ✔  Console Commands   — src/Command détecté
    ✔  Translations       — translations/ détecté
    ✔  Auth (Policies)    — src/Security (Voters) détecté — règles extraites automatiquement
    ✔  Services           — src/Service(s) détecté — stubs générés dans la cible
    ✔  Jobs / Events      — src/EventListener détecté
    ✔  Extras             — src/EventSubscriber détecté
    ✘  Mailer             (ignoré, absent du projet source)
    ✘  Docker             (ignoré, absent du projet source)
```

**Rien à configurer.** BackendBridge lit le code source et décide tout seul.

### Options de la commande migrate

| Flag | Description |
|------|-------------|
| `--from` | Framework source : `symfony` \| `laravel` \| `auto` (défaut) |
| `--to` | Framework cible (auto = opposé du source) |
| `--source` | Dossier source du projet (défaut : répertoire courant) |
| `--out` | Dossier de sortie (défaut : `./generated`) |
| `--openapi` | Contrat OpenAPI — extrait automatiquement si absent |
| `--mapping` | Fichier JSON de mapping métier (active l'auth depuis les règles mapping) |
| `--dry-run` | Simule sans écrire |
| `--commit` | Message de commit |
| `--no-git-commit` | Désactive le commit automatique |

---

## Ce qui est généré automatiquement

### Détection intelligente

BackendBridge scanne le projet source pour décider quoi générer :

| Ce qui est détecté dans la source | Ce qui est généré dans la cible |
|-----------------------------------|---------------------------------|
| `src/Repository/` ou `app/Repositories/` | Repository + Interface + ServiceProvider |
| `src/Security/*Voter.php` ou `app/Policies/` | Policy (Laravel) ou Voter (Symfony) — **règles extraites du code** |
| `src/Service/` ou `app/Services/` | Stubs de Service avec mêmes signatures |
| `src/Command/` ou `app/Console/Commands/` | Console Commands (Artisan ou `#[AsCommand]`) |
| `translations/` ou `lang/` | Fichiers de traduction en/fr |
| `src/EventSubscriber/` ou `app/Listeners/` | EventSubscribers ou Listeners |
| `app/Jobs/` ou `src/Message/` | Jobs + Events + Listeners + Notifications |
| `app/Http/Middleware/` | Middleware JWT/auth/throttle/CORS |
| `app/Mail/` ou `src/Mailer/` | Stubs Mailable ou Mailer service |
| `database/seeders/` ou `src/DataFixtures/` | Seeders + Factories ou Fixtures Doctrine |
| `Dockerfile` | Dockerfile + docker-compose.yml |
| `tests/` ou `phpunit.xml` | Squelette PHPUnit |

### Ce qui est toujours généré

Peu importe les flags, `migrate` génère toujours :

- **Controllers** avec try/catch (404, 422, 500), pagination, transactions DB
- **FormRequests** (Laravel) / **DTOs avec Assert** (Symfony) depuis le schema OpenAPI
- **JsonResources** (Laravel) pour chaque ressource exposée en GET
- **Routes** (`routes/api.php` ou attributs `#[Route]`)
- **Modèles Eloquent** / **Entités Doctrine** depuis les classes PHP source
- **Migrations** SQL (compatible MySQL, PostgreSQL, SQLite)
- **Fichier `.env`** adapté au framework cible

---

## Commandes avancées

### `convert` — contrôle total avec flags manuels

Pour les cas où tu veux choisir exactement ce qui est généré :

```bash
backendbridge convert \
  --from symfony \
  --to laravel \
  --source ./mon-projet-symfony \
  --openapi ./contracts/api.yaml \
  --out ./generated/laravel \
  --with-auth \
  --with-services \
  --with-repositories \
  --with-commands \
  --with-translations
```

Tous les flags disponibles :

| Flag | Description |
|------|-------------|
| `--with-auth` | Policies (Laravel) ou Voters (Symfony) — auto-extrait de la source si pas de mapping |
| `--with-services` | Stubs de Service depuis l'analyse des controllers source |
| `--with-repositories` | Repository + Interface par ressource |
| `--with-commands` | Console Commands (Artisan / Symfony) par ressource |
| `--with-translations` | Fichiers lang en/fr (PHP ou YAML) |
| `--with-extras` | Guard+Provider+Collection (Laravel) ou EventSubscriber (Symfony) |
| `--with-jobs` | Jobs/Messages, Events/Listeners, Notifications |
| `--with-middleware` | Middleware JWT/auth/throttle/CORS |
| `--with-mailer` | Stubs Mailable (Laravel) ou Mailer service (Symfony) |
| `--with-seeders` | Seeders + Factories (Laravel) ou Fixtures Doctrine (Symfony) |
| `--with-docker` | Dockerfile + docker-compose.yml |
| `--with-tests` | Squelette PHPUnit |
| `--mapping` | Fichier JSON de mapping métier (enrichit les règles auth) |
| `--dry-run` | Simule sans écrire |
| `--extract-if-missing` | Extrait OpenAPI automatiquement si le fichier est absent |

### `build` — générer Laravel ET Symfony depuis un contrat OpenAPI

```bash
backendbridge build \
  --openapi ./contracts/api.yaml \
  --out ./generated \
  --with-services \
  --with-repositories \
  --with-docker
```

Génère `./generated/laravel/` et `./generated/symfony/` simultanément.

### `extract` — extraire le contrat OpenAPI depuis le code source

```bash
backendbridge extract \
  --from auto \
  --source ./mon-projet-laravel \
  --out ./contracts/api.yaml
```

Détecte automatiquement Laravel (`Route::...`) et Symfony (`#[Route]`, ApiPlatform). **PHP est utilisé automatiquement** pour un parsing AST précis quand il est disponible — pas besoin de `--use-php-ast`.

### `doctor` — auditer la compatibilité avant conversion

```bash
backendbridge doctor \
  --from auto \
  --source ./mon-projet-symfony \
  --report ./reports/doctor.json
```

Remonte : framework détecté, nombre de routes, couverture ApiPlatform, risques de compatibilité.

### `mapping-export` / `apply-mapping` — mapping métier

```bash
# Exporter les règles métier depuis la source
backendbridge mapping-export \
  --from symfony \
  --source ./mon-projet-symfony \
  --openapi ./contracts/api.yaml \
  --out ./mapping/business-map.json

# Appliquer dans le projet cible
backendbridge apply-mapping \
  --mapping ./mapping/business-map.json \
  --target ./mon-projet-laravel \
  --framework laravel
```

### `run-plan` — pipeline d'actions

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

### Autres commandes

| Commande | Description |
|----------|-------------|
| `setup` | Vérifie PHP, Composer, Laravel CLI, Symfony CLI |
| `create` | Crée un nouveau projet Laravel ou Symfony |
| `run` | Démarre Laravel et Symfony en parallèle |
| `convert-config` | Traduit `security.yaml` (Symfony) ↔ `auth.php` (Laravel) |
| `release` | Bump version, génère CHANGELOG, publie sur npm |

---

## Scripts de dev

```bash
npm run lint    # TypeScript strict check
npm test        # 99 tests (vitest)
npm run build   # tsup → dist/
npm run package # binaire standalone (Node.js SEA)
```

---

## Limites connues

- **La logique métier n'est pas traduite automatiquement** — les controllers générés sont des scaffolds documentés à compléter. BackendBridge génère les stubs de Service avec les bonnes signatures mais le code interne reste à implémenter.
- **Les relations Doctrine complexes** (héritage de table, embeddables) ne sont pas couvertes.
