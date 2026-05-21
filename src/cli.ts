#!/usr/bin/env node
import path from "node:path";
import { Command } from "commander";
import { runConversion } from "./convert.js";
import { runDoctor } from "./doctor.js";
import { runExtraction } from "./extract.js";
import { runMappingExport, runMappingImport } from "./mapping.js";
import { runMappingEditor } from "./mapping-editor.js";
import { runPipeline } from "./pipeline.js";
import { runRelease } from "./release.js";
import type { SupportedFramework } from "./types.js";
import { applyMapping, applyMappingInteractive } from "./mapping-applier.js";
import { convertSecurityConfig } from "./config-converter.js";
import enquirer from "enquirer";
const { prompt } = enquirer as unknown as { prompt: typeof import("enquirer").prompt };
import { c, startTask, printTable, printError, printWarning, printHeader, formatDuration } from "./ui.js";
import { generateDockerFiles } from "./docker-generator.js";
import { checkSetup, installLaravelInstaller, getSymfonyCliInstallInstructions, formatSetupReport } from "./setup-checker.js";
import { createLaravelProject, createSymfonyProject } from "./project-creator.js";
import { runServers } from "./runner.js";

const program = new Command();

program
  .name("backendbridge")
  .description("CLI de bridge REST Symfony <-> Laravel (routes, ApiPlatform, mapping metier, release)")
  .version("0.2.0");

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
  .option("--env-out-name <name>", "Nom du fichier .env généré dans le dossier de sortie")
  .option("--extract-out <path>", "Chemin de sortie OpenAPI lors d'une extraction auto")
  .option("--target-version <version>", "Version cible du framework")
  .option("--with-tests", "Generer un squelette phpunit dans la sortie", false)
  .option("--with-docker", "Generer Dockerfile + docker-compose.yml dans la sortie", false)
  .option("--with-seeders", "Generer seeders, factories (Laravel) ou fixtures (Symfony)", false)
  .option("--with-middleware", "Generer middleware auth/JWT/throttle/CORS", false)
  .option("--with-mailer", "Generer config mailer + stubs Mailable/Symfony Email", false)
  .option("--with-jobs", "Generer Jobs/Messages, Events/Listeners et Notifications", false)
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

      const label = from === "auto" ? `auto → ${to}` : `${from} → ${to}`;
      const done = startTask(`Converting ${label}`);
      const t0 = Date.now();

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
          withDocker: Boolean(rawOptions.withDocker),
          withSeeders: Boolean(rawOptions.withSeeders),
          withMiddleware: Boolean(rawOptions.withMiddleware),
          withMailer: Boolean(rawOptions.withMailer),
          withJobs: Boolean(rawOptions.withJobs),
        },
        Boolean(rawOptions.gitCommit),
        rawOptions.commit,
      );

      const elapsed = Date.now() - t0;
      done("ok", formatDuration(elapsed));

      // If --with-docker was not explicitly passed and we're in a TTY, ask interactively.
      let dockerized = result.dockerized;
      if (!rawOptions.withDocker && !dockerized && process.stdout.isTTY) {
        const answer = await prompt<{ docker: boolean }>({
          type: "confirm",
          name: "docker",
          message: "Générer les fichiers Docker (Dockerfile + docker-compose.yml) ?",
          initial: false,
        });
        if (answer.docker) {
          const dockerDone = startTask("Generating Docker files");
          try {
            const dockerResult = generateDockerFiles(to, outPath);
            dockerDone("ok");
            result.generatedFiles.push(...dockerResult.files);
            dockerized = true;
          } catch (e) {
            dockerDone("err");
            printWarning(`Docker: ${e instanceof Error ? e.message : String(e)}`);
          }
        }
      }

      const warningCount = result.warnings.length;
      const tableRows: [string, string | number][] = [
        ["Framework", `${result.from} → ${result.to}`],
        ["Files generated", result.generatedFiles.length],
        ["Docker", dockerized ? c.green("yes") : c.dim("no")],
        ["Warnings", warningCount === 0 ? c.green("0") : c.yellow(String(warningCount))],
        ["Duration", formatDuration(elapsed)],
      ];
      if (result.committed) {
        tableRows.push(["Commit", c.dim(result.commitMessage ?? "")]);
      } else {
        tableRows.push(["Commit", c.dim(rawOptions.dryRun ? "dry-run" : "skipped")]);
      }

      console.log("");
      printTable(tableRows);

      if (result.generatedFiles.length > 0) {
        printHeader("Generated files");
        for (const file of result.generatedFiles) {
          console.log(`  ${c.dim("-")} ${path.relative(process.cwd(), file)}`);
        }
      }

      if (warningCount > 0) {
        printHeader(`Warnings (${warningCount})`);
        for (const w of result.warnings) {
          printWarning(w);
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erreur inconnue";
      printError(message);
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

      const done = startTask("Exporting mapping");
      const t0 = Date.now();
      const result = runMappingExport(
        { from, sourcePath, openApiPath, outPath, dryRun: Boolean(rawOptions.dryRun) },
        Boolean(rawOptions.gitCommit),
        rawOptions.commit,
      );
      done("ok", formatDuration(Date.now() - t0));

      console.log("");
      printTable([
        ["Output", path.relative(process.cwd(), result.outPath)],
        ["Rules", result.rules],
        ["Commit", result.committed ? c.green("yes") : c.dim("no")],
      ]);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erreur inconnue";
      printError(message);
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

      const done = startTask("Importing mapping");
      const t0 = Date.now();
      const result = runMappingImport(
        sourcePath,
        mappingPath,
        targetPath,
        Boolean(rawOptions.dryRun),
        Boolean(rawOptions.gitCommit),
        rawOptions.commit,
      );
      done("ok", formatDuration(Date.now() - t0));

      console.log("");
      printTable([
        ["Target", path.relative(process.cwd(), result.targetPath)],
        ["Commit", result.committed ? c.green("yes") : c.dim("no")],
      ]);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erreur inconnue";
      printError(message);
      process.exitCode = 1;
    }
  });

program
  .command("mapping-edit")
  .description("Editeur interactif minimal pour un fichier mapping JSON")
  .requiredOption("--mapping <path>", "Chemin du mapping JSON")
  .action(async (rawOptions) => {
    try {
      const mappingPath = path.resolve(rawOptions.mapping);
      await runMappingEditor(mappingPath);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      printError(message);
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

      const done = startTask(`Extracting OpenAPI from ${from}`);
      const t0 = Date.now();
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
      const elapsed = Date.now() - t0;
      done("ok", formatDuration(elapsed));

      console.log("");
      printTable([
        ["Framework", result.from],
        ["Endpoints", result.endpoints],
        ["Output", path.relative(process.cwd(), result.outPath)],
        ["Duration", formatDuration(elapsed)],
        ["Commit", result.committed ? c.green("yes") : c.dim(rawOptions.dryRun ? "dry-run" : "no")],
      ]);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erreur inconnue";
      printError(message);
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
      const done = startTask("Running pipeline");
      const t0 = Date.now();
      const result = runPipeline(filePath, Boolean(rawOptions.gitCommit), Boolean(rawOptions.dryRun));
      done("ok", formatDuration(Date.now() - t0));

      console.log("");
      printTable([["Actions", result.actions]]);
      if (result.summaries.length > 0) {
        printHeader("Steps");
        for (const summary of result.summaries) {
          console.log(`  ${c.dim("-")} ${summary}`);
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erreur inconnue";
      printError(message);
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

      const done = startTask("Running doctor");
      const t0 = Date.now();
      const result = runDoctor(
        sourcePath,
        from,
        reportPath,
        Boolean(rawOptions.dryRun),
        Boolean(rawOptions.gitCommit),
        rawOptions.commit,
      );
      done("ok", formatDuration(Date.now() - t0));

      const errors = result.issues.filter((i) => i.level === "error").length;
      const warnings = result.issues.filter((i) => i.level === "warning").length;

      console.log("");
      printTable([
        ["Framework", result.framework],
        ["ApiPlatform", result.apiPlatformDetected ? c.green("yes") : c.dim("no")],
        ["Routes", result.routesDetected],
        ["Errors", errors > 0 ? c.red(String(errors)) : c.green("0")],
        ["Warnings", warnings > 0 ? c.yellow(String(warnings)) : c.green("0")],
        ...(result.reportPath
          ? ([["Report", path.relative(process.cwd(), result.reportPath)]] as [string, string][])
          : []),
      ]);

      if (result.issues.length > 0) {
        printHeader("Issues");
        for (const issue of result.issues) {
          const levelColor =
            issue.level === "error" ? c.red : issue.level === "warning" ? c.yellow : c.cyan;
          console.log(`  ${levelColor(`[${issue.level}]`)} ${c.bold(issue.code)}: ${issue.message}`);
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erreur inconnue";
      printError(message);
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

      const done = startTask("Preparing release");
      const t0 = Date.now();
      const result = runRelease({
        projectPath: sourcePath,
        bump: rawOptions.bump as "patch" | "minor" | "major" | "prerelease",
        version: rawOptions.version,
        changelogPath,
        publish: Boolean(rawOptions.publish),
        dryRun: Boolean(rawOptions.dryRun),
      });
      done("ok", formatDuration(Date.now() - t0));

      console.log("");
      printTable([
        ["Version", `${c.dim(result.previousVersion)} → ${c.green(result.nextVersion)}`],
        ["Changelog", path.relative(process.cwd(), result.changelogPath)],
        ["Commit/tag", result.committed ? c.green("ok") : c.dim("dry-run")],
        ["npm publish", result.published ? c.green("ok") : c.dim("skipped")],
      ]);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erreur inconnue";
      printError(message);
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

      const done = startTask("Applying mapping");
      const t0 = Date.now();
      let res;
      if (interactive) {
        res = await applyMappingInteractive(
          { mappingPath, targetPath, framework, dryRun: Boolean(rawOptions.dryRun) },
          Boolean(rawOptions.commit),
        );
      } else {
        res = applyMapping(
          { mappingPath, targetPath, framework, dryRun: Boolean(rawOptions.dryRun) },
          Boolean(rawOptions.commit),
        );
      }
      done("ok", formatDuration(Date.now() - t0));

      console.log("");
      printTable([["Rules applied", res.applied]]);

      if (res.generatedFiles && res.generatedFiles.length > 0) {
        printHeader("Generated files");
        for (const f of res.generatedFiles) {
          console.log(`  ${c.dim("-")} ${path.relative(process.cwd(), f)}`);
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Erreur inconnue";
      printError(message);
      process.exitCode = 1;
    }
  });

program
  .command("convert-config")
  .description("Convertir un fichier de configuration (ex: security.yaml -> config/auth.php)")
  .requiredOption("--in <path>", "Fichier d entree (yaml/php)")
  .requiredOption("--out <path>", "Fichier de sortie")
  .option("--from <framework>", "Framework source: symfony|laravel", "symfony")
  .action((rawOptions) => {
    try {
      const inPath = path.resolve(rawOptions.in);
      const outPath = path.resolve(rawOptions.out);
      const from = rawOptions.from === "laravel" ? "laravel" : "symfony";

      const done = startTask(`Converting config (${from})`);
      const res = convertSecurityConfig(inPath, outPath, from as "symfony" | "laravel");
      done("ok");

      console.log("");
      printTable([["Output", path.relative(process.cwd(), res)]]);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      printError(message);
      process.exitCode = 1;
    }
  });

// ─── setup ────────────────────────────────────────────────────────────────────

program
  .command("setup")
  .description("Vérifier et installer PHP, Composer, Laravel CLI, Symfony CLI")
  .option("--install-laravel", "Installer laravel/installer via composer global require")
  .action(async (rawOptions) => {
    const done = startTask("Checking environment");
    const status = checkSetup();
    done("ok");

    console.log("");
    printHeader("Environment");
    console.log(formatSetupReport(status));

    if (rawOptions.installLaravel && !status.laravelInstaller.installed) {
      console.log("");
      const d = startTask("Installing laravel/installer");
      const ok = installLaravelInstaller();
      ok ? d("ok") : d("err");
    }

    if (!status.symfonyCli.installed) {
      console.log(`\n${c.yellow("⚠")} Symfony CLI not found. Install with:\n  ${c.cyan(getSymfonyCliInstallInstructions())}`);
    }

    if (!status.php.installed) {
      console.log(`\n${c.red("✗")} PHP not found. Install PHP 8.2+ before using BackendBridge.`);
      process.exitCode = 1;
    }
  });

// ─── create ───────────────────────────────────────────────────────────────────

program
  .command("create")
  .description("Créer un nouveau projet Laravel ou Symfony vide")
  .argument("<name>", "Nom du projet")
  .option("--framework <fw>", "laravel | symfony", "laravel")
  .option("--type <type>", "Pour Symfony: webapp | api | skeleton", "api")
  .option("--out <dir>", "Répertoire parent de création", process.cwd())
  .action(async (name: string, rawOptions) => {
    const fw = rawOptions.framework as "laravel" | "symfony";
    const outDir = path.resolve(rawOptions.out);

    printHeader(`Creating ${fw} project: ${name}`);

    const envDone = startTask("Checking prerequisites");
    const status = checkSetup();
    envDone(status.php.installed && status.composer.installed ? "ok" : "err");

    if (!status.php.installed || !status.composer.installed) {
      printError("PHP and Composer are required. Run: backendbridge setup");
      process.exitCode = 1;
      return;
    }

    try {
      const done = startTask(`Scaffolding ${fw} project`);
      const t0 = Date.now();
      const result = fw === "laravel"
        ? createLaravelProject(name, outDir)
        : createSymfonyProject(name, outDir, rawOptions.type as "webapp" | "api" | "skeleton");
      done("ok", formatDuration(Date.now() - t0));

      console.log("");
      printTable([
        ["Framework", fw],
        ["Project", name],
        ["Path", result.projectPath],
      ]);
    } catch (err) {
      printError(err instanceof Error ? err.message : String(err));
      process.exitCode = 1;
    }
  });

// ─── build ────────────────────────────────────────────────────────────────────

program
  .command("build")
  .description("Générer le scaffold dans Laravel ET Symfony depuis un seul contrat OpenAPI")
  .requiredOption("--openapi <path>", "Chemin du contrat OpenAPI (.yaml/.json)")
  .option("--source <path>", "Dossier source du projet API", process.cwd())
  .option("--out <path>", "Dossier racine de sortie", "./generated")
  .option("--from <framework>", "Framework source: auto | symfony | laravel", "auto")
  .option("--with-docker", "Générer Docker files dans chaque sortie", false)
  .option("--with-seeders", "Générer seeders/factories", false)
  .option("--with-middleware", "Générer middleware stubs", false)
  .option("--with-mailer", "Générer config mailer + stubs", false)
  .option("--with-jobs", "Générer Jobs/Messages, Events/Listeners et Notifications", false)
  .option("--dry-run", "Simuler sans écrire", false)
  .action(async (rawOptions) => {
    const openApiPath = path.resolve(rawOptions.openapi);
    const sourcePath = path.resolve(rawOptions.source);
    const baseOut = path.resolve(rawOptions.out);
    const from = rawOptions.from as "auto" | SupportedFramework;

    printHeader("BackendBridge Build — generating for both frameworks");

    const sharedOpts = {
      from,
      sourcePath,
      openApiPath,
      dryRun: Boolean(rawOptions.dryRun),
      withDocker: Boolean(rawOptions.withDocker),
      withSeeders: Boolean(rawOptions.withSeeders),
      withMiddleware: Boolean(rawOptions.withMiddleware),
      withMailer: Boolean(rawOptions.withMailer),
      withJobs: Boolean(rawOptions.withJobs),
    };

    const results: { framework: string; files: number; warnings: number }[] = [];

    for (const fw of ["laravel", "symfony"] as SupportedFramework[]) {
      const outPath = path.join(baseOut, fw);
      const done = startTask(`Generating ${fw} scaffold`);
      const t0 = Date.now();
      try {
        const result = runConversion(
          { ...sharedOpts, to: fw, outPath },
          false,
        );
        done("ok", formatDuration(Date.now() - t0));
        results.push({ framework: fw, files: result.generatedFiles.length, warnings: result.warnings.length });
        if (result.warnings.length) {
          for (const w of result.warnings) printWarning(w);
        }
      } catch (err) {
        done("err");
        printError(`${fw}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    if (results.length) {
      console.log("");
      for (const r of results) {
        printTable([
          ["Framework", r.framework],
          ["Files generated", r.files],
          ["Warnings", r.warnings > 0 ? c.yellow(String(r.warnings)) : c.green("0")],
        ]);
        console.log("");
      }
    }
  });

// ─── run ──────────────────────────────────────────────────────────────────────

program
  .command("run")
  .description("Lancer les serveurs Laravel et/ou Symfony en parallèle")
  .option("--laravel <path>", "Chemin du projet Laravel")
  .option("--symfony <path>", "Chemin du projet Symfony")
  .option("--laravel-port <port>", "Port Laravel (défaut: 8000)", "8000")
  .option("--symfony-port <port>", "Port Symfony (défaut: 8001)", "8001")
  .action((rawOptions) => {
    try {
      runServers({
        laravelPath: rawOptions.laravel ? path.resolve(rawOptions.laravel) : undefined,
        symfonyPath: rawOptions.symfony ? path.resolve(rawOptions.symfony) : undefined,
        laravelPort: parseInt(rawOptions.laravelPort, 10),
        symfonyPort: parseInt(rawOptions.symfonyPort, 10),
      });
    } catch (err) {
      printError(err instanceof Error ? err.message : String(err));
      process.exitCode = 1;
    }
  });

program.parse();
