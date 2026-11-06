import { defaultAssistantPreferences, suggestionKinds, type AssistantPreferences } from "./proactive-assistant";

export const assistantStoragePrefix = "modycrew-proactive-assistant-v1:";
export const assistantStorageKey = (scope: string) => `${assistantStoragePrefix}${encodeURIComponent(scope)}`;

export function readAssistantPreferences(text: string | null): AssistantPreferences {
  if (text === null) return defaultAssistantPreferences();
  if (text.length > 256_000) throw new Error("AI 비서 설정이 너무 커서 불러오지 못했어요. 기존 기록은 보존했어요.");
  const value: unknown = JSON.parse(text);
  if (!value || typeof value !== "object") throw new Error("AI 비서 설정을 읽지 못했어요. 기존 기록은 보존했어요.");
  const row = value as AssistantPreferences;
  if (row.version !== 1 || typeof row.enabled !== "boolean" || !["normal", "quiet"].includes(row.frequency) || typeof row.quietHours !== "boolean" || !Array.isArray(row.disabledKinds) || row.disabledKinds.some(kind => !suggestionKinds.includes(kind)) || !row.decisions || typeof row.decisions !== "object" || Array.isArray(row.decisions)) throw new Error("AI 비서 설정 형식이 올바르지 않아요. 기존 기록은 보존했어요.");
  const decisions: AssistantPreferences["decisions"] = Object.create(null);
  for (const [id, decision] of Object.entries(row.decisions)) {
    if (id.length > 500 || !decision || typeof decision.fingerprint !== "string" || decision.fingerprint.length > 12_000 || !Number.isSafeInteger(decision.until) || decision.until < 0) throw new Error("AI 비서 선택 기록을 읽지 못했어요. 기존 기록은 보존했어요.");
    if (decision.kind !== undefined && !["skipped", "snoozed", "used"].includes(decision.kind)) throw new Error("비서 선택 기록 형식을 확인해 주세요.");
    if (decision.at !== undefined && (!Number.isSafeInteger(decision.at) || decision.at < 0)) throw new Error("비서 선택 시각을 확인해 주세요.");
    decisions[id] = { fingerprint: decision.fingerprint, until: decision.until, ...(decision.kind ? { kind: decision.kind } : {}), ...(decision.at !== undefined ? { at: decision.at } : {}) };
  }
  return { version: 1, enabled: row.enabled, frequency: row.frequency, quietHours: row.quietHours, disabledKinds: [...new Set(row.disabledKinds)], decisions };
}

/** 최신 설정을 다시 읽고 한 번 저장한다. 손상 자료를 기본값으로 덮어쓰지 않는다. */
export function updateAssistantPreferences(storage: Pick<Storage, "getItem" | "setItem">, scope: string, change: (current: AssistantPreferences) => AssistantPreferences, now: number) {
  if (!scope) throw new Error("업무 저장소를 먼저 불러와 주세요.");
  const key = assistantStorageKey(scope);
  const current = readAssistantPreferences(storage.getItem(key));
  const next = change(current);
  next.decisions = Object.fromEntries(Object.entries(next.decisions).filter(([, decision]) => decision.until > now));
  // 쓰기 전에도 형식을 확인한다. 용량 부족이면 호출자가 실패를 표시하며 이전 화면 상태를 유지한다.
  const serialized = JSON.stringify(next);
  const checked = readAssistantPreferences(serialized);
  storage.setItem(key, serialized);
  return checked;
}
