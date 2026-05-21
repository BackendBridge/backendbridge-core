# BackendBridge

BackendBridge est un CLI Node.js + TypeScript pour convertir une API Symfony vers Laravel et inversement.
Le tool prend en charge les APIs REST classiques, ApiPlatform, les contrats OpenAPI, un mapping metier (DTO/validation/auth), un doctor d'audit et un flow de release npm.

## Pourquoi OpenAPI dans le flow ?

La compatibilite avec "n'importe quelle version" de Symfony/Laravel est traitee via un format intermediaire stable (OpenAPI).
Mais BackendBridge n'est pas limite a un contrat fourni manuellement: il peut extraire le contrat depuis routes/controllers REST et metadata ApiPlatform, puis convertir.

## Installation

```bash
npm install
npm run build
npm link
```

Puis commande globale:

```bash
backendbridge --help
```

## Commande principale

```bash
backendbridge convert \
  --from auto \
  --to laravel \
  --source ./mon-projet-symfony \
  --openapi ./mon-projet-symfony/openapi.yaml \
  --mapping ./mapping/business-map.json \
  --out ./generated/laravel \
  --commit "feat(bridge): convert user api symfony to laravel"
```

Conversion avec extraction automatique si `openapi` est absent:

```bash
backendbridge convert \
  --from auto \
  --to symfony \
  --source ./mon-projet-laravel \
  --openapi ./.backendbridge/extracted-openapi.yaml \
  --extract-if-missing \
  --mapping ./mapping/business-map.json \
  --out ./generated/symfony \
  --commit "feat(bridge): convert laravel api to symfony with auto extract"
```

Sens inverse:

```bash
backendbridge convert \
  --from auto \
  --to symfony \
  --source ./mon-projet-laravel \
  --openapi ./mon-projet-laravel/openapi.json \
  --mapping ./mapping/business-map.json \
  --out ./generated/symfony \
  --commit "feat(bridge): convert billing api laravel to symfony"
```

## Mapping metier (DTO / validation / auth)

Exporter un mapping depuis une API source:

```bash
backendbridge mapping-export \
  --from auto \
  --source ./mon-projet-symfony \
  --openapi ./contracts/symfony-openapi.yaml \
  --out ./mapping/business-map.json \
  --commit "feat(bridge): export business mapping from symfony api"
```

Importer ce mapping dans un repository cible:

```bash
backendbridge mapping-import \
  --source ./mon-projet-laravel \
  --mapping ./mapping/business-map.json \
  --target ./config/backendbridge/mapping.json \
  --commit "feat(bridge): import business mapping into laravel repo"
```

## Extraction OpenAPI

Extraire directement le contrat depuis le code source:

```bash
backendbridge extract \
  --from auto \
  --source ./mon-projet-laravel \
  --out ./contracts/laravel-openapi.yaml \
  --commit "feat(bridge): extract openapi from laravel api"
```

Idem depuis Symfony:

```bash
backendbridge extract \
  --from auto \
  --source ./mon-projet-symfony \
  --out ./contracts/symfony-openapi.json \
  --commit "feat(bridge): extract openapi from symfony api"
```

Le mode Symfony detecte aussi ApiPlatform (`ApiResource`, operations metadata `Get/Post/...`).

## Pipeline d'actions

Tu peux executer plusieurs actions avec commit par action via un fichier de plan.

Exemple `bridge.pipeline.yaml`:

```yaml
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
    mapping: ./mapping/business-map.json
    out: ./generated/laravel
    commit: "feat(bridge): convert source api to laravel"
```

Execution:

```bash
backendbridge run-plan --file ./bridge.pipeline.yaml
```

## Doctor (audit avant conversion)

```bash
backendbridge doctor \
  --from auto \
  --source ./mon-projet-symfony \
  --report ./reports/doctor.json \
  --commit "chore(doctor): audit source api compatibility"
```

Le doctor remonte notamment:

- detection framework et ApiPlatform
- nombre de routes/operations REST detectees
- risques de compatibilite (absence routes, couverture faible, etc.)

## Release (version bump + changelog + npm publish)

Dry-run:

```bash
backendbridge release --source . --bump minor --dry-run
```

Release reelle + publication npm:

```bash
backendbridge release --source . --bump patch --publish
```

Effets:

- bump `package.json`
- generation/mise a jour `CHANGELOG.md`
- commit `chore(release): vX.Y.Z` + tag `vX.Y.Z`
- `npm publish` si `--publish`

## Conventions de commit

Le message doit respecter le format Conventional Commits:

- `fix(game): fix float modulo crash when pressing Enter on start screen`
- `feat(game): add 5 level themes, fire projectile, procedural obstacles`

La validation est appliquee avant le commit auto.

Chaque action CLI (`extract`, `convert`, `mapping-export`, `mapping-import`, `doctor`, `run-plan`) ajoute egalement une trace dans `.backendbridge/actions.log`.

## Scripts

```bash
npm run lint
npm run test
npm run build
```

## Limites actuelles

- Extraction basee sur patterns Laravel (`Route::...`) et Symfony (`#[Route(...)]` / `@Route(...)`).
- ApiPlatform est supporte en extraction metadata, mais la reconstruction metier complete depend toujours du mapping fourni.
- Generation scaffold API (routes + controllers generated) a partir du contrat.
- La logique metier n'est pas traduite automatiquement.
- Les schemas de validation, middlewares et securite doivent etre ajoutes ensuite.
