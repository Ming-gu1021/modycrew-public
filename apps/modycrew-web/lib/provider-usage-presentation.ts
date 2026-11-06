/** Display only connections verified by the current status/metadata requests.
 * Historical usage and model catalog entries cannot establish a connection. */
export type ProviderCredit = { hasCredits: boolean; unlimited: boolean; balance: string | null };
export type ProviderWindow = { id: string; label: string; usedPercent: number; resetsAt: number | null; accountWide?: boolean; active?: boolean };
export type ProviderLimit = { provider: string; connected: boolean; status: string; checkedAt?: number; source?: string; windows: ProviderWindow[]; credits?: ProviderCredit | null };
type Connection = { provider?: string; status?: string; hasLocalKey?: boolean };
type UsageRecord = { provider: string; requests: number };

const serviceNames: Record<string, string> = {
  codex_oauth: "Codex", claude_subscription: "Claude", openai: "OpenAI API",
  anthropic: "Claude API", gemini: "Gemini API", local: "내 PC",
  higgsfield: "Higgsfield", higgsfield_mcp: "Higgsfield · 계정", higgsfield_api: "Higgsfield API",
  kling: "Kling API", byteplus: "BytePlus · Seedance", volcengine: "Volcengine · Seedance",
};
const preferredOrder = ["codex_oauth", "claude_subscription", "openai", "anthropic", "gemini", "higgsfield", "higgsfield_mcp", "higgsfield_api", "kling", "byteplus", "volcengine", "local"];
export const providerUsageName = (provider: string) => serviceNames[provider] || provider;

export function connectedUsageProviders(connections: readonly Connection[], limits: readonly ProviderLimit[] = []) {
  const ids = new Set(connections.filter(item => item.status === "connected" || item.status === "codex_oauth_ready" || (item.status === "stored_in_os_vault" && item.hasLocalKey === true)).flatMap(item => item.provider ? [item.provider] : []));
  for (const limit of limits) {
    if (limit.connected) ids.add(limit.provider);
    else ids.delete(limit.provider); // A completed disconnect check beats stale status.
  }
  const order = (id: string) => preferredOrder.includes(id) ? preferredOrder.indexOf(id) : preferredOrder.length;
  return [...ids].sort((a, b) => order(a) - order(b) || a.localeCompare(b));
}

export function currentUsageWindows(limit: ProviderLimit | undefined, now = Date.now()) {
  if (!limit?.connected || limit.status !== "ready" || !Array.isArray(limit.windows)) return [];
  return limit.windows.filter(row => Number.isFinite(row.usedPercent) && row.usedPercent >= 0 && row.usedPercent <= 100
    && (row.resetsAt === null || Number.isFinite(row.resetsAt) && row.resetsAt > now));
}

export function providerCreditText(limit?: ProviderLimit): string | null {
  if (!limit?.connected || limit.status !== "ready" || !limit.credits) return null;
  const credit = limit.credits;
  if (credit.unlimited === true && credit.hasCredits === true) return "크레딧 무제한";
  if (typeof credit.balance === "string" && credit.balance.length <= 40 && /^\d+(?:\.\d+)?$/.test(credit.balance)) {
    const [whole, fraction] = credit.balance.split(".");
    return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}${fraction === undefined ? "" : `.${fraction}`} 크레딧`;
  }
  return credit.hasCredits === true ? "크레딧 있음 · 잔액 비공개" : null;
}

export function providerUsageHeadline(provider: string, limit: ProviderLimit | undefined, records: readonly UsageRecord[] = [], now = Date.now()) {
  const windows = currentUsageWindows(limit, now).filter(row => row.accountWide !== false);
  // The tightest account-wide window determines what can still run. A model-only
  // bucket must never be displayed as the account's remaining allowance.
  const primary = windows.reduce<ProviderWindow | undefined>((picked, row) => !picked || row.usedPercent > picked.usedPercent ? row : picked, undefined);
  const remaining = primary ? Math.floor((100 - primary.usedPercent) * 10 + 1e-8) / 10 : null;
  const credits = providerCreditText(limit);
  const requests = records.filter(row => row.provider === provider && Number.isFinite(row.requests) && row.requests >= 0).reduce((sum, row) => sum + row.requests, 0);
  const errors: Record<string, string> = { login_required: "다시 연결 필요", timeout: "조회 시간 초과", unsupported: "조회 지원 안 됨", connection_changed: "연결 변경 · 새로고침" };
  const api = ["openai", "anthropic", "gemini", "higgsfield_api", "kling", "byteplus", "volcengine"].includes(provider);
  const text = remaining !== null ? `${remaining.toLocaleString("ko-KR")}% 남음` : credits
    || (provider === "local" ? "로컬 실행" : errors[limit?.status ?? ""] || (api ? "잔액 조회 미지원" : "한도 확인 불가"));
  return { text, primary, remaining, credits, requests, api };
}
