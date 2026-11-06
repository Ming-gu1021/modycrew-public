// Public Codex app-server account/rateLimits/read contract. No credential reads,
// model calls or conversion between credits, tokens and currency.
// https://github.com/openai/codex/blob/main/codex-rs/app-server-protocol/src/protocol/v2/account.rs
export function normalizeCodexAccountCredit(response) {
  const bucket = response?.rateLimitsByLimitId?.codex
    ?? (response?.rateLimits?.limitId == null || response.rateLimits.limitId === 'codex' ? response?.rateLimits : null);
  const credits = bucket?.credits;
  if (!credits || typeof credits.hasCredits !== 'boolean' || typeof credits.unlimited !== 'boolean') return null;
  if (credits.unlimited && !credits.hasCredits) return null;
  // Keep the provider's decimal string. A hidden or malformed balance is not 0.
  const raw = credits.balance;
  const balance = typeof raw === 'string' && raw.length <= 40 && /^\d+(?:\.\d+)?$/.test(raw) ? raw : null;
  return { hasCredits: credits.hasCredits, unlimited: credits.unlimited, balance };
}
