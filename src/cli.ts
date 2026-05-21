#!/usr/bin/env node
import path from "node:path";
import { Command } from "commander";
import { runConversion } from "./convert.js";
import { runDoctor } from "./doctor.js";
import { runExtraction } from "./extract.js";
import { runMappingExport, runMappingImport } from "./mapping.js";
import { runPipeline } from "./pipeline.js";
import { runRelease } from "./release.js";
import type { SupportedFramework } from "./types.js";
import { applyMapping, applyMappingInteractive } from "./mapping-applier.js";

const program = new Command();

program
  .name("backendbridge")
  .description("CLI de bridge REST Symfony <-> Laravel (routes, ApiPlatform, mapping metier, release)")
  .version("0.1.0");

program
  .command("convert")
  .description("Convertir une API source Symfony/Laravel vers un scaffold cible")
  .requiredOption("--to <framework>", "Framework cible: symfony | laravel")
  .requiredOption("--openapi <path>", "Chemin du contrat OpenAPI (.yaml/.yml/.json)")
  .option("--mapping <path>", "Fichier JSON de mapping metier (DTO/validation/auth)")
  .option("--from <framework>", "Framework source: symfony | laravel | auto", "auto")
  .option("--source <path>", "Dossier source du projet API", process.cwd())
  .option("--out <path>", "Dossier de sortie de la conversion", "./generated")
  .option("--extract-if-missing", "Extraire automatiquement OpenAPI si le fichier n'existe pas")
  .option("--use-php-ast", "Utiliser un parseur PHP AST (requiert php) pour l'extraction ApiPlatform", false)
  .option("--env-out-name <name>", "Nom du fichier .env généré dans le dossier de sortie (par défaut: .env pour Laravel, .env.local pour Symfony)")
  .option(
    "--extract-out <path>",
    "Chemin de sortie OpenAPI lors d'une extraction auto (par defaut: --openapi)",
  )
  .option("--target-version <version>", "Version cible du framework")
  .option("--with-tests", "Generer un squelette phpunit dans la sortie", false)
  .option("--commit <message>", "Message de commit conventionnel")
  .option("--no-git-commit", "Desactiver le commit automatique")
  .option("--dry-run", "Simuler la conversion sans commit")
  .action(async (rawOptions) => {
    try {
      const to = rawOptions.to as SupportedFramework;
      const from = rawOptions.from as "auto" | SupportedFramework;

      if (!["symfony", "laravel"].includes(to)) {
        throw new Error("--to doit valoir symfony ou laravel");
      }

      if (!["auto", "symfony", "laravel"].includes(from)) {
        throw new Error("--from doit valoir auto, symfony ou laravel");
      }

      const sourcePath = path.resolve(rawOptions.source);
      const outPath = path.resolve(rawOptions.out);
      const openApiPath = path.resolve(rawOptions.openapi);
      const mappingPath = rawOptions.mapping ? path.resolve(rawOptions.mapping) : undefined;

      const result = runConversion(
        {
          from,
          to,
          sourcePath,
          outPath,
          openApiPath,
          mappingPath,
          extractIfMissing: Boolean(rawOptions.extractIfMissing),
          usePhpAst: Boolean(rawOptions.usePhpAst),
          extractOutPath: rawOptions.extractOut ? path.resolve(rawOptions.extractOut) : undefined,
          envOutName: rawOptions.envOutName,
          targetVersion: rawOptions.targetVersion,
          dryRun: Boolean(rawOptions.dryRun),
          withTests: Boolean(rawOptions.withTests),
        },
        Boolean(rawOptions.gitCommit),
        rawOptions.commit,
      );

      console.log(`Conversion terminee: ${result.from} -> ${result.to}`);
      console.log(`Fichiers generes: ${result.generatedFiles.length}`);
      for (const file of result.generatedFiles) {
        console.log(`- ${path.relative(process.cwd(), file)}`);
      }

      if (result.committed) {
        console.log(`Commit cree: ${result.commitMessage}`);
      } else {
        console.log("Aucun commit cree (dry-run ou commit desactive).");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erreur inconnue";
      console.error(`Erreur: ${message}`);
      process.exitCode = 1;
    }
  });

program
  .command("mapping-export")
  .description("Exporter un mapping metier (DTO/validation/auth) depuis API source")
  .requiredOption("--out <path>", "Chemin de sortie du mapping JSON")
  .requiredOption("--openapi <path>", "Chemin du contrat OpenAPI source")
  .option("--from <framework>", "Framework source: symfony | laravel | auto", "auto")
  .option("--source <path>", "Dossier source du projet API", process.cwd())
  .option("--commit <message>", "Message de commit conventionnel")
  .option("--no-git-commit", "Desactiver le commit automatique")
  .option("--dry-run", "Simuler sans commit")
  .action(async (rawOptions) => {
    try {
      const sourcePath = path.resolve(rawOptions.source);
      const outPath = path.resolve(rawOptions.out);
      const openApiPath = path.resolve(rawOptions.openapi);
      const from = rawOptions.from as "auto" | SupportedFramework;

      const result = runMappingExport(
        {
          from,
          sourcePath,
          openApiPath,
          outPath,
          dryRun: Boolean(rawOptions.dryRun),
        },
        Boolean(rawOptions.gitCommit),
        rawOptions.commit,
      );

      console.log(`Mapping exporte: ${path.relative(process.cwd(), result.outPath)}`);
      console.log(`Rules: ${result.rules}`);
      if (result.committed) {
        console.log(`Commit cree: ${result.commitMessage}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erreur inconnue";
      console.error(`Erreur: ${message}`);
      process.exitCode = 1;
    }
  });

program
  .command("mapping-import")
  .description("Importer un mapping metier dans le repository cible")
  .requiredOption("--mapping <path>", "Chemin du mapping JSON source")
  .requiredOption("--target <path>", "Chemin cible du mapping")
  .option("--source <path>", "Racine du projet cible", process.cwd())
  .option("--commit <message>", "Message de commit conventionnel")
  .option("--no-git-commit", "Desactiver le commit automatique")
  .option("--dry-run", "Simuler sans commit")
  .action(async (rawOptions) => {
    try {
      const sourcePath = path.resolve(rawOptions.source);
      const mappingPath = path.resolve(rawOptions.mapping);
      const targetPath = path.resolve(rawOptions.target);

      const result = runMappingImport(
        sourcePath,
        mappingPath,
        targetPath,
        Boolean(rawOptions.dryRun),
        Boolean(rawOptions.gitCommit),
        rawOptions.commit,
      );

      console.log(`Mapping importe: ${path.relative(process.cwd(), result.targetPath)}`);
      if (result.committed) {
        console.log(`Commit cree: ${result.commitMessage}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erreur inconnue";
      console.error(`Erreur: ${message}`);
      process.exitCode = 1;
    }
  });

program
  .command("extract")
  .description("Extraire un contrat OpenAPI depuis un projet Symfony/Laravel")
  .requiredOption("--out <path>", "Chemin de sortie OpenAPI (.yaml/.yml/.json)")
  .option("--from <framework>", "Framework source: symfony | laravel | auto", "auto")
  .option("--source <path>", "Dossier source du projet API", process.cwd())
  .option("--title <title>", "Titre OpenAPI")
  .option("--version <version>", "Version OpenAPI", "1.0.0")
  .option("--commit <message>", "Message de commit conventionnel")
  .option("--no-git-commit", "Desactiver le commit automatique")
  .option("--dry-run", "Simuler l'extraction sans commit")
  .option("--use-php-ast", "Utiliser un parseur PHP AST (requiert php) pour l'extraction ApiPlatform", false)
  .action(async (rawOptions) => {
    try {
      const from = rawOptions.from as "auto" | SupportedFramework;
      if (!["auto", "symfony", "laravel"].includes(from)) {
        throw new Error("--from doit valoir auto, symfony ou laravel");
      }

      const sourcePath = path.resolve(rawOptions.source);
      const outPath = path.resolve(rawOptions.out);

      const result = runExtraction(
        {
          from,
          sourcePath,
          outPath,
          title: rawOptions.title,
          version: rawOptions.version,
          dryRun: Boolean(rawOptions.dryRun),
        },
        Boolean(rawOptions.gitCommit),
        rawOptions.commit,
      );

      console.log(`Extraction terminee: ${result.from}`);
      console.log(`Endpoints detectes: ${result.endpoints}`);
      console.log(`Contrat genere: ${path.relative(process.cwd(), result.outPath)}`);

      if (result.committed) {
        console.log(`Commit cree: ${result.commitMessage}`);
      } else {
        console.log("Aucun commit cree (dry-run ou commit desactive).");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erreur inconnue";
      console.error(`Erreur: ${message}`);
      process.exitCode = 1;
    }
  });

program
  .command("run-plan")
  .description("Executer un pipeline d'actions extract/convert depuis un fichier YAML/JSON")
  .requiredOption("--file <path>", "Chemin du plan pipeline")
  .option("--no-git-commit", "Desactiver le commit automatique")
  .option("--dry-run", "Simuler les actions sans commit")
  .action(async (rawOptions) => {
    try {
      const filePath = path.resolve(rawOptions.file);
      const result = runPipeline(filePath, Boolean(rawOptions.gitCommit), Boolean(rawOptions.dryRun));

      console.log(`Pipeline execute: ${result.actions} action(s)`);
      for (const summary of result.summaries) {
        console.log(`- ${summary}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erreur inconnue";
      console.error(`Erreur: ${message}`);
      process.exitCode = 1;
    }
  });

program
  .command("doctor")
  .description("Auditer la compatibilite source avant conversion (REST, ApiPlatform, risques)")
  .option("--from <framework>", "Framework source: symfony | laravel | auto", "auto")
  .option("--source <path>", "Dossier source du projet API", process.cwd())
  .option("--report <path>", "Chemin de sortie du rapport JSON")
  .option("--commit <message>", "Message de commit conventionnel")
  .option("--no-git-commit", "Desactiver le commit automatique")
  .option("--dry-run", "Simuler sans commit")
  .action((rawOptions) => {
    try {
      const sourcePath = path.resolve(rawOptions.source);
      const from = rawOptions.from as "auto" | SupportedFramework;
      const reportPath = rawOptions.report ? path.resolve(rawOptions.report) : undefined;

      const result = runDoctor(
        sourcePath,
        from,
        reportPath,
        Boolean(rawOptions.dryRun),
        Boolean(rawOptions.gitCommit),
        rawOptions.commit,
      );

      console.log(`Doctor framework: ${result.framework}`);
      console.log(`ApiPlatform: ${result.apiPlatformDetected ? "yes" : "no"}`);
      console.log(`Routes detectees: ${result.routesDetected}`);
      for (const issue of result.issues) {
        console.log(`- [${issue.level}] ${issue.code}: ${issue.message}`);
      }
      if (result.reportPath) {
        console.log(`Rapport: ${path.relative(process.cwd(), result.reportPath)}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erreur inconnue";
      console.error(`Erreur: ${message}`);
      process.exitCode = 1;
    }
  });

program
  .command("release")
  .description("Bump version, generer changelog et publier sur npm")
  .option("--source <path>", "Racine du projet package", process.cwd())
  .option("--bump <type>", "Type de bump: patch|minor|major|prerelease", "patch")
  .option("--version <semver>", "Version explicite (prioritaire sur --bump)")
  .option("--changelog <path>", "Chemin du changelog", "./CHANGELOG.md")
  .option("--publish", "Publier sur npm")
  .option("--dry-run", "Executer sans commit/tag/publish")
  .action((rawOptions) => {
    try {
      const sourcePath = path.resolve(rawOptions.source);
      const changelogPath = path.resolve(rawOptions.changelog);

      const result = runRelease({
        projectPath: sourcePath,
        bump: rawOptions.bump as "patch" | "minor" | "major" | "prerelease",
        version: rawOptions.version,
        changelogPath,
        publish: Boolean(rawOptions.publish),
        dryRun: Boolean(rawOptions.dryRun),
      });

      console.log(`Release: ${result.previousVersion} -> ${result.nextVersion}`);
      console.log(`Changelog: ${path.relative(process.cwd(), result.changelogPath)}`);
      console.log(`Commit/tag: ${result.committed ? "ok" : "dry-run"}`);
      console.log(`Publish npm: ${result.published ? "ok" : "skip"}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erreur inconnue";
      console.error(`Erreur: ${message}`);
      process.exitCode = 1;
    }
  });

program
  .command("apply-mapping")
  .description("Apply mapping rules to generate validation/auth stubs in target project")
  .requiredOption("-m, --mapping <path>", "mapping file path (json/yaml)")
  .requiredOption("-t, --target <path>", "target project root to write stubs into")
  .option("-f, --framework <framework>", "target framework: laravel|symfony|auto", "auto")
  .option("--dry-run", "do not write files or commit", false)
  .option("--commit", "commit generated files", false)
  .option("--interactive", "ask interactive questions before applying rules", false)
  .action(async (rawOptions) => {
    try {
      const mappingPath = path.resolve(rawOptions.mapping);
      const targetPath = path.resolve(rawOptions.target);
      const framework = rawOptions.framework as "laravel" | "symfony" | "auto";

      const interactive = Boolean(rawOptions.interactive);
      let res;
      if (interactive) {
        res = await applyMappingInteractive({ mappingPath, targetPath, framework, dryRun: Boolean(rawOptions.dryRun) }, Boolean(rawOptions.commit));
      } else {
        // applyMapping may be synchronous or return a Promise
        res = await applyMapping({ mappingPath, targetPath, framework, dryRun: Boolean(rawOptions.dryRun) }, Boolean(rawOptions.commit));
      }

      console.log(`Applied ${res.applied} mapping rules.`);
      if (res.generatedFiles && res.generatedFiles.length) {
        console.log("Generated files:");
        for (const f of res.generatedFiles) console.log(`- ${path.relative(process.cwd(), f)}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erreur inconnue";
      console.error(`Erreur: ${message}`);
      process.exitCode = 1;
    }
  });

program.parse();
