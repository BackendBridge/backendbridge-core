# Contributing to BackendBridge

Thanks for taking the time to contribute!

## Quick start

```bash
git clone https://github.com/BackendBridge/backendbridge-core.git
cd backendbridge-core
npm install
npm run build
npm test          # 161 tests — all must pass
```

To use your local build as the global CLI:

```bash
npm link
backendbridge --version
```

## Project structure

```
src/
  cli.ts                   # Entry point — all commands (migrate, convert, build, …)
  generators/              # Laravel & Symfony code generators
  logic-translator.ts      # Bidirectional Eloquent ↔ Doctrine pattern rules
  ir.ts                    # Versioned Intermediate Representation
  smart-detect.ts          # Feature auto-detection for the migrate command
  extract.ts               # OpenAPI extractor (AST + regex fallback)
  convert.ts               # Orchestrates the full conversion pipeline
tests/
  fixtures/                # Real PHP projects used by golden tests
tools/
  vendor/                  # PHP deps (nikic/PHP-Parser, phpstan, phpunit)
  parse_controllers.php    # AST → route extraction
  parse_method_bodies.php  # AST → method body extraction
```

## Running tests

```bash
npm test                   # full suite
npm test -- tests/logic-translator.test.ts   # single file
```

PHP must be available for golden tests and php -l checks. If not installed, those tests are skipped gracefully.

## Adding translation rules

Edit `src/logic-translator.ts`. Each rule is a `{ pattern, replacement, warning? }` object in either `LARAVEL_TO_SYMFONY` or `SYMFONY_TO_LARAVEL`. Add a test in `tests/logic-translator.test.ts`.

## Adding a generator

Create `src/generators/my-feature.ts`, export `generateLaravelMyFeature` and `generateSymfonyMyFeature`, then wire them up in `src/convert.ts` and the CLI flags in `src/cli.ts`.

## Pull request checklist

- [ ] `npm test` passes (no new failures)
- [ ] New behaviour is covered by at least one test
- [ ] No new TypeScript errors (`npm run lint`)
- [ ] CHANGELOG.md updated under `## [Unreleased]`

## Reporting a bug

Use [GitHub Issues](https://github.com/BackendBridge/backendbridge-core/issues) and fill in the bug report template.

## Code style

- TypeScript strict mode — no `any` unless unavoidable
- ESM imports with `.js` extension
- No comments explaining *what* the code does — only *why* when non-obvious
