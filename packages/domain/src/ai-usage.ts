export type AIResponseUsage = {
  source: "provider_response" | "local_response" | "unavailable";
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  cachedInputTokens: number | null;
  cacheWriteInputTokens: number | null;
  reasoningTokens: number | null;
};

const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const tokens = (value: unknown): number | null => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;

/** Only keep reported numbers. Missing usage is unknown, never a zero-cost claim. */
export function normalizeAIResponseUsage(provider: string, response: unknown): AIResponseUsage {
  const body = object(response);
  const raw = object(provider === "gemini" ? body.usageMetadata : body.usage);
  const inputDetail = object(raw.input_tokens_details ?? raw.prompt_tokens_details);
  const outputDetail = object(raw.output_tokens_details ?? raw.completion_tokens_details);
  const usage = {
    inputTokens: tokens(provider === "gemini" ? raw.promptTokenCount : raw.input_tokens ?? raw.prompt_tokens),
    outputTokens: tokens(provider === "gemini" ? raw.candidatesTokenCount : raw.output_tokens ?? raw.completion_tokens),
    totalTokens: tokens(provider === "gemini" ? raw.totalTokenCount : raw.total_tokens),
    cachedInputTokens: tokens(provider === "gemini" ? raw.cachedContentTokenCount : raw.cache_read_input_tokens ?? inputDetail.cached_tokens),
    cacheWriteInputTokens: tokens(raw.cache_creation_input_tokens),
    reasoningTokens: tokens(provider === "gemini" ? raw.thoughtsTokenCount : outputDetail.reasoning_tokens),
  };
  return { source: Object.values(usage).every(value => value === null) ? "unavailable" : provider === "local" ? "local_response" : "provider_response", ...usage };
}
