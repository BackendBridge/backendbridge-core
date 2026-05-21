import { execFileSync } from "node:child_process";
import fs from "node:fs";

export interface ParsedColumn {
  name?: string;
  type?: string;
  length?: number;
  nullable?: boolean;
  default?: unknown;
  unique?: boolean;
  index?: boolean;
}

export interface ParsedIndex {
  columns?: string[];
  unique?: boolean;
  name?: string;
}

export interface ParsedJoinColumn {
  name?: string;
  referencedColumnName?: string;
  nullable?: boolean;
  onDelete?: string;
  onUpdate?: string;
}

export interface ParsedRelationPivot {
  primary?: string[];
  indexes?: ParsedIndex[];
  columns?: ParsedColumn[];
  timestamps?: boolean;
  onDelete?: string;
  onUpdate?: string;
}

export interface ParsedRelation {
  type?: string;
  target?: string;
  joinColumn?: ParsedJoinColumn;
  pivot?: ParsedRelationPivot;
  mappedBy?: string | null;
  inversedBy?: string | null;
  cascade?: string[] | null;
  orphanRemoval?: boolean | null;
}

export interface ParsedProperty {
  name: string;
  type?: string;
  relation?: ParsedRelation;
  column?: ParsedColumn;
}

export interface ParsedClass {
  file: string;
  class: string;
  namespace?: string;
  properties: ParsedProperty[];
  indexes?: ParsedIndex[];
}

export function phpAvailable(): boolean {
  try {
    execFileSync("php", ["-v"], { stdio: "ignore" });
    return true;
  } catch (err) {
    return false;
  }
}

export function parsePhpClasses(filePath: string): ParsedClass[] {
  if (!phpAvailable()) throw new Error("php not available");
  const scriptPath = new URL("../tools/parse_php_classes.php", import.meta.url).pathname;
  const out = execFileSync("php", [scriptPath, filePath], { encoding: "utf8" });
  try {
    const parsed = JSON.parse(out);
    if (parsed && parsed.error) {
      throw new Error(parsed.message || parsed.error);
    }
    return parsed;
  } catch (err) {
    throw new Error("Failed to parse PHP classes: " + String(err));
  }
}
