// Terminal UI helpers: colors, task indicators, summary tables.
// Respects NO_COLOR env var and non-TTY environments.

const USE_COLOR = process.env.NO_COLOR === undefined && process.stdout.isTTY === true;

function wrap(code: string, text: string): string {
  return USE_COLOR ? `\x1b[${code}m${text}\x1b[0m` : text;
}

export const c = {
  bold: (t: string) => wrap("1", t),
  dim: (t: string) => wrap("2", t),
  red: (t: string) => wrap("31", t),
  green: (t: string) => wrap("32", t),
  yellow: (t: string) => wrap("33", t),
  blue: (t: string) => wrap("34", t),
  cyan: (t: string) => wrap("36", t),
  magenta: (t: string) => wrap("35", t),
};

function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;]*m/g, "");
}

/** Start a task line. Returns a done() function to resolve it with ✓ or ✗. */
export function startTask(text: string): (status: "ok" | "err", note?: string) => void {
  if (process.stdout.isTTY) {
    process.stdout.write(`${c.cyan("●")} ${text}...`);
  } else {
    process.stdout.write(`${text}...\n`);
  }

  return (status, note) => {
    const icon = status === "ok" ? c.green("✓") : c.red("✗");
    const suffix = note ? ` ${c.dim(note)}` : "";
    if (process.stdout.isTTY) {
      process.stdout.write(`\r${icon} ${text}${suffix}\n`);
    } else {
      process.stdout.write(status === "ok" ? `done\n` : `FAILED\n`);
    }
  };
}

/** Print a two-column summary table with box-drawing chars. */
export function printTable(rows: [string, string | number][]): void {
  const strRows = rows.map(([k, v]): [string, string] => [k, String(v)]);
  const col1 = Math.max(...strRows.map(([k]) => k.length));
  const col2 = Math.max(...strRows.map(([, v]) => stripAnsi(v).length));
  const hr1 = "─".repeat(col1 + 2);
  const hr2 = "─".repeat(col2 + 2);

  console.log(`┌${hr1}┬${hr2}┐`);
  for (const [k, v] of strRows) {
    const kPad = k.padEnd(col1);
    const vPad = v + " ".repeat(col2 - stripAnsi(v).length);
    console.log(`│ ${c.bold(kPad)} │ ${vPad} │`);
  }
  console.log(`└${hr1}┴${hr2}┘`);
}

export function printSuccess(msg: string): void {
  console.log(`${c.green("✓")} ${msg}`);
}

export function printError(msg: string): void {
  console.error(`${c.red("✗")} ${c.bold("Erreur:")} ${msg}`);
}

export function printWarning(msg: string): void {
  console.warn(`  ${c.yellow("⚠")} ${msg}`);
}

export function printHeader(msg: string): void {
  console.log(`\n${c.bold(c.cyan(msg))}`);
}

export function formatDuration(ms: number): string {
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(2)}s`;
}
