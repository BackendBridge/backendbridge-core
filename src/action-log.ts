import fs from "node:fs";
import path from "node:path";

interface ActionLogEntry {
  at: string;
  action: string;
  sourcePath: string;
  details: Record<string, unknown>;
}

export function appendActionLog(
  sourcePath: string,
  action: string,
  details: Record<string, unknown>,
): string {
  const logDir = path.join(sourcePath, ".backendbridge");
  fs.mkdirSync(logDir, { recursive: true });

  const logPath = path.join(logDir, "actions.log");
  const entry: ActionLogEntry = {
    at: new Date().toISOString(),
    action,
    sourcePath: path.resolve(sourcePath),
    details,
  };

  fs.appendFileSync(logPath, `${JSON.stringify(entry)}\n`, "utf8");
  return logPath;
}
