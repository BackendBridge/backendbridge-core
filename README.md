# BackendBridge

CLI Node.js + TypeScript pour convertir une API Symfony vers Laravel et inversement.
Prend en charge les APIs REST classiques, ApiPlatform, les contrats OpenAPI, un mapping métier (DTO/validation/auth), un doctor d'audit et un flow de release npm.

## Installation globale

```bash
npm install -g backendbridge
```

Ou depuis les sources:

```bash
npm install && npm run build && npm link
```

Lors de la première utilisation, BackendBridge vérifie que PHP, Composer, Laravel CLI et Symfony CLI sont disponibles:

```bash
backendbridge setup
```

Si un outil manque, il propose de l'installer automatiquement.

## Créer un projet vide

```bash
backendbridge create --framework laravel --name mon-api --out ./projets
backendbridge create --framework symfony --name mon-api --type api --out ./projets
```

Options `--type`: `api` (défaut), `webapp`, `skeleton`.

## Migration intelligente (commande recommandée)

La commande `migrate` détecte automatiquement ce qui existe dans le projet source et ne génère que ce qui est pertinent — pas besoin de passer tous les flags manuellement.

```bash
backendbridge migrate \
  --from symfony \
  --source ./mon-projet-symfony \
  --out ./generated
```

Exemple de sortie :

```
  Source détectée : symfony  →  Cible : laravel

  Features détectées dans le projet source :
    ✔  Repositories       — src/Repository détecté
    ✔  Console Commands   — src/Command détecté
    ✔  Translations       — translations/ détecté
    ✔  Auth (Voters)      — src/Security détecté
    ✔  Jobs / Events      — src/EventListener détecté
    ✔  Extras             — src/EventSubscriber détecté
    ✘  Mailer             (ignoré, absent du projet source)
    ✘  Docker             (ignoré, absent du projet source)
```

Options disponibles :

| Flag | Description |
|------|-------------|
| `--from` | Framework source : `symfony` \| `laravel` \| `auto` (défaut) |
| `--to` | Framework cible (auto = opposé du source) |
| `--source` | Dossier source du projet |
| `--out` | Dossier de sortie (défaut : `./generated`) |
| `--openapi` | Contrat OpenAPI — extrait automatiquement si absent |
| `--mapping` | Fichier JSON de mapping métier (active `--with-auth`) |
| `--dry-run` | Simule sans écrire |
| `--commit` | Message de commit |
| `--no-git-commit` | Désactive le commit automatique |

## Générer le scaffold dans les deux frameworks

```bash
backendbridge build \
  --openapi ./contracts/api.yaml \
  --out ./generated \
  --with-seeders \
  --with-middleware \
  --with-mailer \
  --with-jobs \
  --with-docker
```

Génère `./generated/laravel/` et `./generated/symfony/` depuis un seul contrat OpenAPI.

## Démarrer les serveurs

```bash
backendbridge run \
  --laravel ./generated/laravel \
  --symfony ./generated/symfony \
  --laravel-port 8000 \
  --symfony-port 8001
```

Démarre les deux serveurs en parallèle (Ctrl+C pour stopper).

## Commande convert (framework unique)

```bash
backendbridge convert \
  --from auto \
  --to laravel \
  --source ./mon-projet-symfony \
  --openapi ./mon-projet-symfony/openapi.yaml \
  --mapping ./mapping/business-map.json \
  --out ./generated/laravel \
  --with-seeders \
  --with-middleware \
  --with-mailer \
  --with-jobs \
  --with-docker \
  --commit "feat(bridge): convert user api symfony to laravel"
```

Options disponibles:

| Flag | Description |
|------|-------------|
| `--with-seeders` | Génère seeders + factories (Laravel) ou fixtures Doctrine (Symfony) |
| `--with-middleware` | Génère middleware JWT/auth/throttle/CORS |
| `--with-mailer` | Génère stubs Mailable (Laravel) ou Mailer service (Symfony) |
| `--with-jobs` | Génère Jobs/Messages, Events/Listeners, Notifications |
| `--with-auth` | Génère Policies (Laravel) ou Voters (Symfony) depuis le mapping |
| `--with-repositories` | Génère Repository + Interface par ressource |
| `--with-commands` | Génère Console Commands (Artisan / Symfony) par ressource |
| `--with-translations` | Génère fichiers lang en/fr (PHP ou YAML) |
| `--with-extras` | Génère Guard+Provider+Collection (Laravel) ou EventSubscriber (Symfony) |
| `--with-docker` | Génère Dockerfile + docker-compose.yml |
| `--with-tests` | Génère squelette PHPUnit |
| `--dry-run` | Simule sans écrire |
| `--extract-if-missing` | Extrait OpenAPI auto si le fichier est absent |

### Ce qui est généré par convert

- **Controllers** avec try/catch (404, 422, 500), pagination (`paginate(15)`) pour les GETs liste, `findOrFail` pour les GETs par ID, transactions DB pour les écritures
- **FormRequests** (Laravel) / **DTOs avec Asserts** (Symfony) depuis le schema OpenAPI
- **JsonResources** (Laravel) pour chaque ressource exposée en GET
- **Routes** (`routes/api.php` Laravel, `#[Route]` attributes Symfony)
- **Uploads** : single (`format: binary`) et multiple (`type: array, items.format: binary`) — génère les règles de validation et les hints de stockage
- **Sessions, Cookies, JWT** : hints dans chaque controller
- **Docker** : Dockerfile PHP 8.2, docker-compose avec MySQL (Laravel) ou PostgreSQL (Symfony), healthchecks
- **Seeders/Factories** : inférence Faker par nom de champ (email→safeEmail, name→name(), phone→phoneNumber(), etc.)
- **Middleware** : JWT auth subscriber, throttle, CORS
- **Mailer** : WelcomeMail, PasswordResetMail, config .env
- **Jobs/Events/Notifications** :
  - Laravel: `ShouldQueue` Jobs, Events, Listeners, Notifications (mail+database), `GeneratedEventServiceProvider`
  - Symfony: Messenger Messages + Handlers (`#[AsMessageHandler]`), Events, Listeners (`#[AsEventListener]`), Notifier Notifications

## Extraction OpenAPI

```bash
backendbridge extract \
  --from auto \
  --source ./mon-projet-laravel \
  --out ./contracts/laravel-openapi.yaml
```

Détecte automatiquement Laravel (`Route::...`) et Symfony (`#[Route]`, ApiPlatform).

## Mapping métier (DTO / validation / auth)

```bash
# Exporter depuis la source
backendbridge mapping-export \
  --from auto \
  --source ./mon-projet-symfony \
  --openapi ./contracts/api.yaml \
  --out ./mapping/business-map.json

# Appliquer dans le projet cible
backendbridge apply-mapping \
  --mapping ./mapping/business-map.json \
  --target ./mon-projet-laravel \
  --framework laravel
```

## Pipeline d'actions

```yaml
# bridge.pipeline.yaml
version: 1
actions:
  - type: extract
    from: auto
    source: ./api-source
    out: ./contracts/source-openapi.yaml
    commit: "feat(bridge): extract source contract"

  - type: convert
    from: auto
    to: laravel
    source: ./api-source
    openapi: ./contracts/source-openapi.yaml
    out: ./generated/laravel
    commit: "feat(bridge): convert source api to laravel"
```

```bash
backendbridge run-plan --file ./bridge.pipeline.yaml
```

## Doctor (audit avant conversion)

```bash
backendbridge doctor \
  --from auto \
  --source ./mon-projet-symfony \
  --report ./reports/doctor.json
```

Remonte : framework détecté, nombre de routes, couverture ApiPlatform, risques de compatibilité.

## Release

```bash
backendbridge release --source . --bump minor --dry-run
backendbridge release --source . --bump patch --publish
```

Bump `package.json`, génère `CHANGELOG.md`, commit `chore(release): vX.Y.Z`, tag, et publie sur npm.

## Scripts de dev

```bash
npm run lint
npm test
npm run build
```

## Limites

- L'extraction repose sur des patterns textuels (pas un vrai AST PHP) — `--use-php-ast` active le parseur PHP pour plus de précision.
- La logique métier n'est pas traduite automatiquement — les controllers générés sont des scaffolds documentés à compléter.
- Les schemas de sécurité avancée (voters, policies) doivent être implémentés manuellement à partir des hints générés.
