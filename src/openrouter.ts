import fs from "node:fs";
import path from "node:path";

// ─── Model catalogue (all free, verified on OpenRouter) ───────────────────────

/**
 * Primary: Gemma 4 31B IT — Google DeepMind, 256K ctx, strong on code.
 * Tested: produces concise, accurate Doctrine/Eloquent code.
 */
const MODEL_CODE = "google/gemma-4-31b-it:free";

/**
 * Fallback chain — tried in order when primary is rate-limited or down.
 * - Nemotron 3 Super 120B: NVIDIA MoE, 12B active, 1M ctx, SWE-Bench strong.
 * - GPT-OSS 120B: OpenAI open-weight, excellent code quality, 1M ctx.
 */
const MODEL_CODE_FALLBACKS = [
  "nvidia/nemotron-3-super-120b-a12b:free",
  "openai/gpt-oss-120b:free",
];

/**
 * Lightweight model for short explanations (1-2 sentences).
 * GPT-OSS 20B: small, fast, free. Falls back to primary if unavailable.
 */
const MODEL_EXPLAIN = "openai/gpt-oss-20b:free";

const OPENROUTER_API = "https://openrouter.ai/api/v1/chat/completions";
const TIMEOUT_MS     = 30_000;

// ─── Types ────────────────────────────────────────────────────────────────────

export interface LlmTranslateResult {
  code: string;
  explanation: string;
  model: string;
  cached: boolean;
}

// ─── Key resolution ───────────────────────────────────────────────────────────

function resolveKey(): string | undefined {
  // 1. env already set
  if (process.env.OPEN_ROUTER_KEY) return process.env.OPEN_ROUTER_KEY;

  // 2. look for .env in cwd or two levels up
  const candidates = [
    path.join(process.cwd(), ".env"),
    path.join(process.cwd(), "../.env"),
    path.join(process.cwd(), "../../.env"),
  ];
  for (const f of candidates) {
    if (!fs.existsSync(f)) continue;
    const line = fs.readFileSync(f, "utf8")
      .split("\n")
      .find((l) => l.startsWith("OPEN_ROUTER_KEY="));
    if (line) return line.slice("OPEN_ROUTER_KEY=".length).trim();
  }
  return undefined;
}

// ─── Core fetch ───────────────────────────────────────────────────────────────

async function chat(
  model: string,
  messages: { role: string; content: string }[],
  apiKey: string,
): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const res = await fetch(OPENROUTER_API, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
        "HTTP-Referer": "https://github.com/BackendBridge/backendbridge-core",
        "X-Title": "BackendBridge",
      },
      body: JSON.stringify({ model, messages, temperature: 0.1, max_tokens: 1024 }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`OpenRouter ${res.status}: ${text.slice(0, 200)}`);
    }

    const json = (await res.json()) as any;
    return json.choices?.[0]?.message?.content?.trim() ?? "";
  } finally {
    clearTimeout(timer);
  }
}

/** Try primary model then fallbacks; throws only if all fail. */
async function chatWithFallback(
  messages: { role: string; content: string }[],
  apiKey: string,
): Promise<{ content: string; model: string }> {
  const models = [MODEL_CODE, ...MODEL_CODE_FALLBACKS];
  let lastErr: unknown;

  for (const model of models) {
    try {
      const content = await chat(model, messages, apiKey);
      if (content) return { content, model };
    } catch (e) {
      lastErr = e;
    }
  }

  throw lastErr ?? new Error("All OpenRouter models failed");
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Translate a PHP method body snippet that the AST + regex layer could not fully
 * convert. Uses Gemma 4 31B (free) with fallbacks.
 *
 * Only called for short snippets (≤ 80 lines) that still contain untranslated
 * framework patterns (detected by heuristic on the partial output).
 */
export async function llmTranslateBody(
  originalCode: string,
  partialCode: string,
  from: "laravel" | "symfony",
  to: "laravel" | "symfony",
): Promise<LlmTranslateResult> {
  const apiKey = resolveKey();
  if (!apiKey) {
    return { code: partialCode, explanation: "", model: "none", cached: false };
  }

  const direction = `${from} → ${to}`;
  const targetFramework = to === "laravel" ? "Laravel (Eloquent, facades)" : "Symfony (Doctrine, services)";

  const systemPrompt = `You are a PHP framework migration expert.
Translate PHP code from ${direction}.
Rules:
- Output ONLY the translated PHP code, no markdown, no explanation, no \`\`\` fences.
- Preserve variable names, comments, and logic structure.
- Target: ${targetFramework}.
- For patterns you cannot translate confidently, insert a // TODO: comment with the original line.
- Never add new business logic.`;

  const userPrompt = partialCode !== originalCode
    ? `The following PHP snippet was partially auto-translated from ${from} to ${to}.\nFinish translating any remaining ${from}-specific patterns:\n\n${partialCode}`
    : `Translate this ${from} PHP snippet to ${to}:\n\n${originalCode}`;

  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user",   content: userPrompt },
  ];

  const { content, model } = await chatWithFallback(messages, apiKey);

  // Strip accidental markdown fences if the model added them
  const cleaned = content
    .replace(/^```php\s*/i, "")
    .replace(/^```\s*/,     "")
    .replace(/\s*```$/,     "")
    .trim();

  return { code: cleaned, explanation: "", model, cached: false };
}

/**
 * Generate a short human-readable explanation of a translated block.
 * Uses the lightweight model (gpt-oss-120b) — fast, low-cost.
 */
export async function llmExplainTranslation(
  originalCode: string,
  translatedCode: string,
  from: string,
  to: string,
): Promise<string> {
  const apiKey = resolveKey();
  if (!apiKey) return "";

  const messages = [
    {
      role: "system",
      content: "You are a concise technical writer. Answer in 1-2 sentences max.",
    },
    {
      role: "user",
      content: `Explain in one sentence what changed when translating this ${from} code to ${to}:\n\nBefore:\n${originalCode.slice(0, 400)}\n\nAfter:\n${translatedCode.slice(0, 400)}`,
    },
  ];

  try {
    return await chat(MODEL_EXPLAIN, messages, apiKey);
  } catch {
    return "";
  }
}

/** Returns true if an OpenRouter API key is available. */
export function openRouterAvailable(): boolean {
  return Boolean(resolveKey());
}
