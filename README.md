# BackendBridge

BackendBridge est un CLI Node.js + TypeScript pour convertir une API Symfony vers Laravel et inversement, en s'appuyant sur un contrat OpenAPI.

## Pourquoi OpenAPI ?

La compatibilite avec "n'importe quelle version" de Symfony/Laravel est traitee via un format intermediaire stable (OpenAPI). Le CLI reste agnostique des versions internes framework et genere un scaffold cible coherent.

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
  --out ./generated/symfony \
  --commit "feat(bridge): convert billing api laravel to symfony"
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

## Conventions de commit

Le message doit respecter le format Conventional Commits:

- `fix(game): fix float modulo crash when pressing Enter on start screen`
- `feat(game): add 5 level themes, fire projectile, procedural obstacles`

La validation est appliquee avant le commit auto.

Chaque action CLI (`extract`, `convert`) ajoute egalement une trace dans `.backendbridge/actions.log`.

## Scripts

```bash
npm run lint
npm run test
npm run build
```

## Limites actuelles

- Extraction basee sur patterns Laravel (`Route::...`) et Symfony (`#[Route(...)]` / `@Route(...)`).
- Generation scaffold API (routes + controllers generated) a partir du contrat.
- La logique metier n'est pas traduite automatiquement.
- Les schemas de validation, middlewares et securite doivent etre ajoutes ensuite.
