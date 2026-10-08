import "server-only";
import Anthropic from "@anthropic-ai/sdk";

// Claude API access for the platform's AI drafting tools. Server-side only; the key never reaches the browser.
// No ANTHROPIC_API_KEY -> callers fall back to deterministic demo output (see isAiConfigured()).

export const MODEL = "claude-sonnet-5-5";

export const isAiConfigured = () => !!process.env.ANTHROPIC_API_KEY;

let client: Anthropic | null = null;
function getClient() {
  if (!client) client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 2, timeout: 120_000 });
  return client;
}

export type ToolSpec = { name: string; description: string; input_schema: Record<string, unknown> };
export type Turn = { role: "user" | "assistant"; content: string };

export class AiError extends Error {}

/**
 * One structured call: static instructions in a cached system prompt, a single strict tool whose input is the JSON we want,
 * and the conversation turns (rebuilt from our own tables each time). Claude Sonnet 5.5 does not accept a forced
 * tool_choice, so the tool is offered with tool_choice "auto", the system prompt requires it, and strict mode keeps the
 * arguments schema-valid. Uses the standard (non-beta) Messages API so the first live run has no untested options.
 */
export async function callStructured<T>(opts: { system: string; tool: ToolSpec; turns: Turn[]; maxTokens?: number }): Promise<{ input: T; model: string }> {
  const res = await getClient().messages.create({
    model: MODEL,
    max_tokens: opts.maxTokens ?? 16000,
    system: [{ type: "text", text: opts.system, cache_control: { type: "ephemeral" } }],
    tools: [{ ...opts.tool, strict: true } as Anthropic.Tool],
    tool_choice: { type: "auto", disable_parallel_tool_use: true },
    messages: opts.turns.map((t) => ({ role: t.role, content: t.content })),
  });
  if ((res.stop_reason as string) === "refusal") throw new AiError("The AI declined this request. Try rephrasing the brief or direction.");
  if (res.stop_reason === "max_tokens") throw new AiError("The AI ran out of room before finishing. Try again with a shorter direction.");
  const block = res.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use" && b.name === opts.tool.name);
  if (!block) throw new AiError("The AI replied without structured concepts. Try again.");
  return { input: block.input as T, model: res.model || MODEL };
}
