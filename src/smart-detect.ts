import fs from "node:fs";
import path from "node:path";
import type { SupportedFramework } from "./types.js";
import { hasSecurityInSource } from "./security-extractor.js";

export interface DetectedFeatures {
  withSeeders: boolean;
  withMiddleware: boolean;
  withMailer: boolean;
  withJobs: boolean;
  withAuth: boolean;
  withServices: boolean;
  withRepositories: boolean;
  withCommands: boolean;
  withTranslations: boolean;
  withExtras: boolean;
  withDocker: boolean;
  withTests: boolean;
  reasons: Record<string, string>;
}

function hasDir(base: string, ...parts: string[]): boolean {
  const p = path.join(base, ...parts);
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function hasFile(base: string, ...parts: string[]): boolean {
  try {
    fs.statSync(path.join(base, ...parts));
    return true;
  } catch {
    return false;
  }
}

function hasPhpMatching(dir: string, pattern: RegExp): boolean {
  if (!hasDir(dir)) return false;
  try {
    return fs.readdirSync(dir).some((f) => pattern.test(f));
  } catch {
    return false;
  }
}

function deepHasDir(base: string, needle: string): boolean {
  try {
    const entries = fs.readdirSync(base, { withFileTypes: true });
    for (const e of entries) {
      if (e.isDirectory()) {
        if (e.name === needle) return true;
        if (deepHasDir(path.join(base, e.name), needle)) return true;
      }
    }
  } catch {
    // ignore
  }
  return false;
}

function detectLaravel(src: string): DetectedFeatures {
  const reasons: Record<string, string> = {};

  const withSeeders = hasDir(src, "database", "seeders") || hasDir(src, "database", "factories");
  if (withSeeders) reasons.withSeeders = "database/seeders ou database/factories détecté";

  const withMiddleware = hasDir(src, "app", "Http", "Middleware");
  if (withMiddleware) reasons.withMiddleware = "app/Http/Middleware détecté";

  const withMailer = hasDir(src, "app", "Mail") || hasDir(src, "app", "Notifications");
  if (withMailer) reasons.withMailer = "app/Mail ou app/Notifications détecté";

  const withJobs =
    hasDir(src, "app", "Jobs") ||
    hasDir(src, "app", "Events") ||
    hasDir(src, "app", "Listeners");
  if (withJobs) reasons.withJobs = "app/Jobs, app/Events ou app/Listeners détecté";

  const withAuth = hasSecurityInSource(src, "laravel");
  if (withAuth) reasons.withAuth = "app/Policies détecté — règles extraites automatiquement";

  const withServices =
    hasDir(src, "app", "Services") ||
    hasPhpMatching(path.join(src, "app", "Http", "Controllers"), /Controller\.php$/);
  if (withServices) reasons.withServices = "app/Services ou controllers avec injection détectés";

  const withRepositories =
    hasDir(src, "app", "Repositories") ||
    deepHasDir(path.join(src, "app"), "Repository");
  if (withRepositories) reasons.withRepositories = "dossier Repositories/Repository détecté dans app/";

  const withCommands = hasDir(src, "app", "Console", "Commands");
  if (withCommands) reasons.withCommands = "app/Console/Commands détecté";

  const withTranslations = hasDir(src, "lang") || hasDir(src, "resources", "lang");
  if (withTranslations) reasons.withTranslations = "lang/ ou resources/lang/ détecté";

  const withExtras =
    hasDir(src, "app", "Observers") ||
    hasPhpMatching(path.join(src, "app", "Providers"), /ServiceProvider\.php$/);
  if (withExtras) reasons.withExtras = "app/Observers ou ServiceProvider custom détecté";

  const withDocker = hasFile(src, "Dockerfile") || hasFile(src, "docker-compose.yml");
  if (withDocker) reasons.withDocker = "Dockerfile ou docker-compose.yml détecté";

  const withTests = hasDir(src, "tests") || hasFile(src, "phpunit.xml") || hasFile(src, "phpunit.xml.dist");
  if (withTests) reasons.withTests = "dossier tests/ ou phpunit.xml détecté";

  return {
    withSeeders, withMiddleware, withMailer, withJobs, withAuth,
    withServices, withRepositories, withCommands, withTranslations, withExtras,
    withDocker, withTests, reasons,
  };
}

function detectSymfony(src: string): DetectedFeatures {
  const reasons: Record<string, string> = {};

  const withSeeders = hasDir(src, "src", "DataFixtures");
  if (withSeeders) reasons.withSeeders = "src/DataFixtures détecté";

  const withMiddleware =
    hasDir(src, "src", "EventSubscriber") ||
    hasPhpMatching(path.join(src, "src", "EventSubscriber"), /Middleware|Throttle|Jwt|Cors/i);
  if (withMiddleware) reasons.withMiddleware = "src/EventSubscriber détecté (middleware-like)";

  const withMailer =
    hasDir(src, "src", "Mailer") ||
    hasDir(src, "src", "Mail") ||
    hasFile(src, "config", "packages", "mailer.yaml");
  if (withMailer) reasons.withMailer = "src/Mailer ou config/packages/mailer.yaml détecté";

  const withJobs =
    hasDir(src, "src", "Message") ||
    hasDir(src, "src", "MessageHandler") ||
    hasDir(src, "src", "Event") ||
    hasDir(src, "src", "EventListener");
  if (withJobs) reasons.withJobs = "src/Message, src/Event ou src/EventListener détecté";

  const withAuth = hasSecurityInSource(src, "symfony");
  if (withAuth) reasons.withAuth = "src/Security (Voters) détecté — règles extraites automatiquement";

  const withServices =
    hasDir(src, "src", "Service") ||
    hasDir(src, "src", "Services");
  if (withServices) reasons.withServices = "src/Service(s) détecté — stubs générés dans la cible";

  const withRepositories = hasDir(src, "src", "Repository");
  if (withRepositories) reasons.withRepositories = "src/Repository détecté";

  const withCommands = hasDir(src, "src", "Command");
  if (withCommands) reasons.withCommands = "src/Command détecté";

  const withTranslations = hasDir(src, "translations");
  if (withTranslations) reasons.withTranslations = "translations/ détecté";

  const withExtras =
    hasDir(src, "src", "EventSubscriber") ||
    hasDir(src, "src", "EventListener");
  if (withExtras) reasons.withExtras = "src/EventSubscriber ou src/EventListener détecté";

  const withDocker = hasFile(src, "Dockerfile") || hasFile(src, "docker-compose.yml");
  if (withDocker) reasons.withDocker = "Dockerfile ou docker-compose.yml détecté";

  const withTests = hasDir(src, "tests") || hasFile(src, "phpunit.xml") || hasFile(src, "phpunit.xml.dist");
  if (withTests) reasons.withTests = "dossier tests/ ou phpunit.xml détecté";

  return {
    withSeeders, withMiddleware, withMailer, withJobs, withAuth,
    withServices, withRepositories, withCommands, withTranslations, withExtras,
    withDocker, withTests, reasons,
  };
}

export function detectFeatures(sourcePath: string, from: SupportedFramework): DetectedFeatures {
  return from === "laravel" ? detectLaravel(sourcePath) : detectSymfony(sourcePath);
}
