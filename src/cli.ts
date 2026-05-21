#!/usr/bin/env node
import path from "node:path";
import { Command } from "commander";
import { runConversion } from "./convert.js";
import { runExtraction } from "./extract.js";
import type { SupportedFramework } from "./types.js";

const program = new Command();

program
  .name("backendbridge")
  .description("CLI de conversion d'API Symfony <-> Laravel (via contrat OpenAPI)")
  .version("0.1.0");

program
  .command("convert")
  .description("Convertir une API source Symfony/Laravel vers un scaffold cible")
  .requiredOption("--to <framework>", "Framework cible: symfony | laravel")
  .requiredOption("--openapi <path>", "Chemin du contrat OpenAPI (.yaml/.yml/.json)")
  .option("--from <framework>", "Framework source: symfony | laravel | auto", "auto")
  .option("--source <path>", "Dossier source du projet API", process.cwd())
  .option("--out <path>", "Dossier de sortie de la conversion", "./generated")
  .option("--extract-if-missing", "Extraire automatiquement OpenAPI si le fichier n'existe pas")
  .option(
    "--extract-out <path>",
    "Chemin de sortie OpenAPI lors d'une extraction auto (par defaut: --openapi)",
  )
  .option("--target-version <version>", "Version cible du framework")
  .option("--commit <message>", "Message de commit conventionnel")
  .option("--no-git-commit", "Desactiver le commit automatique")
  .option("--dry-run", "Simuler la conversion sans commit")
  .action((rawOptions) => {
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

      const result = runConversion(
        {
          from,
          to,
          sourcePath,
          outPath,
          openApiPath,
          extractIfMissing: Boolean(rawOptions.extractIfMissing),
          extractOutPath: rawOptions.extractOut ? path.resolve(rawOptions.extractOut) : undefined,
          targetVersion: rawOptions.targetVersion,
          dryRun: Boolean(rawOptions.dryRun),
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
  .action((rawOptions) => {
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

program.parse();
