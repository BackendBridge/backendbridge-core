import fs from "node:fs";
import path from "node:path";

function parseDotenv(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

function stringifyDotenv(obj: Record<string, string>): string {
  const lines: string[] = [];
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    // quote if contains spaces
    if (v.includes(" ") || v === "") {
      lines.push(`${k}="${v.replace(/"/g, '\\"')}"`);
    } else {
      lines.push(`${k}=${v}`);
    }
  }
  return lines.join("\n") + "\n";
}

function buildDatabaseUrlFromLaravel(env: Record<string, string>): string | undefined {
  const driver = env.DB_CONNECTION || env.DB_DRIVER || "mysql";
  const host = env.DB_HOST || "127.0.0.1";
  const port = env.DB_PORT ? `:${env.DB_PORT}` : "";
  const user = env.DB_USERNAME || env.DB_USER || "";
  const pass = env.DB_PASSWORD || env.DB_PASS || "";
  const db = env.DB_DATABASE || env.DB_NAME || "";
  const auth = user ? `${encodeURIComponent(user)}:${encodeURIComponent(pass)}@` : "";
  return `${driver}://${auth}${host}${port}/${db}`;
}

function parseDatabaseUrlToLaravel(urlStr: string, out: Record<string, string>) {
  try {
    const url = new URL(urlStr);
    const protocol = url.protocol.replace(":", "");
    out.DB_CONNECTION = protocol;
    out.DB_HOST = url.hostname;
    if (url.port) out.DB_PORT = url.port;
    if (url.pathname && url.pathname !== "/") out.DB_DATABASE = url.pathname.slice(1);
    if (url.username) out.DB_USERNAME = decodeURIComponent(url.username);
    if (url.password) out.DB_PASSWORD = decodeURIComponent(url.password);
  } catch (e) {
    // ignore parse errors
  }
}

function buildMailerDsnFromLaravel(env: Record<string, string>): string | undefined {
  const host = env.MAIL_HOST || env.MAILER_HOST || env.MAIL_HOSTNAME;
  if (!host) return undefined;
  const port = env.MAIL_PORT ? `:${env.MAIL_PORT}` : "";
  const user = env.MAIL_USERNAME || env.MAIL_USER || "";
  const pass = env.MAIL_PASSWORD || env.MAIL_PASS || "";
  const auth = user ? `${encodeURIComponent(user)}:${encodeURIComponent(pass)}@` : "";
  // default to smtp
  return `smtp://${auth}${host}${port}`;
}

function parseMailerDsnToLaravel(dsn: string, out: Record<string, string>) {
  try {
    const url = new URL(dsn);
    out.MAIL_MAILER = url.protocol.replace(":", "");
    out.MAIL_HOST = url.hostname;
    if (url.port) out.MAIL_PORT = url.port;
    if (url.username) out.MAIL_USERNAME = decodeURIComponent(url.username);
    if (url.password) out.MAIL_PASSWORD = decodeURIComponent(url.password);
  } catch (e) {
    // ignore
  }
}

export interface EnvConvertOptions {
  from: "laravel" | "symfony" | "auto";
  to: "laravel" | "symfony";
  sourcePath: string;
  outPath: string;
  outFileName?: string; // optional output filename for converted env
}

export function convertEnvFile(options: EnvConvertOptions): string | undefined {
  const from = options.from === "auto" ? detectFrameworkFromPath(options.sourcePath) : options.from;
  const to = options.to;

  // locate source env
  const candidates = [".env", ".env.local", ".env.example", ".env.dist"];
  let sourceFile: string | undefined;
  for (const c of candidates) {
    const p = path.join(options.sourcePath, c);
    if (fs.existsSync(p)) {
      sourceFile = p;
      break;
    }
  }

  if (!sourceFile) return undefined;

  const raw = fs.readFileSync(sourceFile, "utf8");
  const parsed = parseDotenv(raw);

  const outEnv: Record<string, string> = {};

  if (from === "laravel" && to === "symfony") {
    if (parsed.APP_ENV) outEnv.APP_ENV = parsed.APP_ENV;
    if (parsed.APP_KEY) {
      let key = parsed.APP_KEY;
      if (key.startsWith("base64:")) key = key.slice(7);
      outEnv.APP_SECRET = key;
    }
    const dbUrl = buildDatabaseUrlFromLaravel(parsed);
    if (dbUrl) outEnv.DATABASE_URL = dbUrl;
    const mailer = buildMailerDsnFromLaravel(parsed);
    if (mailer) outEnv.MAILER_DSN = mailer;
  } else if (from === "symfony" && to === "laravel") {
    if (parsed.APP_ENV) outEnv.APP_ENV = parsed.APP_ENV;
    if (parsed.APP_SECRET) outEnv.APP_KEY = `base64:${parsed.APP_SECRET}`;
    if (parsed.DATABASE_URL) parseDatabaseUrlToLaravel(parsed.DATABASE_URL, outEnv);
    if (parsed.MAILER_DSN) parseMailerDsnToLaravel(parsed.MAILER_DSN, outEnv);
  }

  // write to target outPath
  if (Object.keys(outEnv).length === 0) return undefined;

  const defaultName = to === "laravel" ? ".env" : ".env.local";
  const outFileName = options.outFileName ?? defaultName;
  const outFile = path.join(options.outPath, outFileName);
  fs.mkdirSync(options.outPath, { recursive: true });
  fs.writeFileSync(outFile, stringifyDotenv(outEnv), "utf8");

  return outFile;
}

function detectFrameworkFromPath(p: string): "laravel" | "symfony" {
  // simple heuristics
  if (fs.existsSync(path.join(p, "artisan"))) return "laravel";
  if (fs.existsSync(path.join(p, "bin", "console")) || fs.existsSync(path.join(p, "config", "packages"))) return "symfony";
  return "laravel";
}
