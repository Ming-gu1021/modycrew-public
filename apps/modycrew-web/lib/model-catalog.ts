/** 표시 이름은 안내용이다. 선택 가능 여부는 현재 연결의 모델 조회 결과만 결정한다. */
import type { ModelChoice } from "@/components/ModelPicker";

export type CatalogEntry = { id: string; label: string; hint: string };

export const codexCatalog: CatalogEntry[] = [
  { id: "gpt-6-astra", label: "GPT-6 Astra", hint: "현재 계정의 지원 여부 확인 필요" },
  { id: "gpt-5.6-sol", label: "GPT-5.6 Sol", hint: "현재 계정의 지원 여부 확인 필요" },
  { id: "gpt-5.6-terra", label: "GPT-5.6 Terra", hint: "현재 계정의 지원 여부 확인 필요" },
  { id: "gpt-5.6-luna", label: "GPT-5.6 Luna", hint: "현재 계정의 지원 여부 확인 필요" },
];

export const openaiCatalog: CatalogEntry[] = [...codexCatalog];
export const anthropicCatalog: CatalogEntry[] = [
  { id: "claude-sonnet-5", label: "Claude Sonnet 5", hint: "현재 계정의 지원 여부 확인 필요" },
  { id: "claude-opus-5", label: "Claude Opus 5", hint: "현재 계정의 지원 여부 확인 필요" },
  { id: "claude-fable-5", label: "Claude Fable 5", hint: "현재 계정의 지원 여부 확인 필요" },
  { id: "claude-haiku-4-5", label: "Claude Haiku 4.5", hint: "현재 계정의 지원 여부 확인 필요" },
];
export const geminiCatalog: CatalogEntry[] = [
  { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash", hint: "현재 계정의 지원 여부 확인 필요" },
  { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro", hint: "현재 계정의 지원 여부 확인 필요" },
];

export type ModelAvailabilityInput = {
  state: "available" | "unknown" | "blocked";
  source: "provider_api" | "codex_oauth" | "local_catalog" | "subscription_cli" | "none";
  checkedAt?: string;
  models: Array<{
    id: string;
    label?: string;
    availability: "available" | "unknown" | "blocked";
    reason?: string;
    evidence?: "catalog" | "response" | "cli_login" | "user_selected";
  }>;
  userMessage?: string;
};

export type ProviderState = {
  /** 인증과 대화 사용 동의가 준비됐는지. 모델 권한과는 별개다. */
  ready: boolean;
  needs?: string;
  modelAvailability?: ModelAvailabilityInput;
};

export type SubscriptionRuntimeInput = {
  providerId: string;
  label: string;
  installed: boolean;
  loggedIn: boolean;
  models?: CatalogEntry[];
  modelAvailability?: ModelAvailabilityInput;
};

export type BuildModelChoicesInput = {
  codex: ProviderState;
  openai?: ProviderState;
  anthropic: ProviderState;
  gemini: ProviderState;
  localModels: Array<{ id: string; label?: string; runtimeLabel?: string }>;
  subscriptions?: SubscriptionRuntimeInput[];
};

const modelAvailabilityReasons: Record<string, string> = {
  not_in_account_catalog: "현재 계정의 사용 가능 목록에 없습니다.",
  request_rejected: "이 계정에서 모델 사용 요청이 거절됐습니다.",
  catalog_unavailable: "모델 목록을 확인하지 못했습니다. 새로고침해 주세요.",
  local_catalog_only: "설치된 모델 안내만 확인했습니다. 계정의 지원 여부 확인이 필요합니다.",
  connection_changed: "연결한 계정이 바뀌었습니다. 모델 목록을 다시 확인해 주세요.",
};

/** 홈과 계정 설정이 같은 근거로 모델을 활성화한다. */
export function buildProviderModelChoices(
  provider: string,
  providerLabel: string,
  state: ProviderState,
  catalog: CatalogEntry[],
): ModelChoice[] {
  const availability = state.modelAvailability;
  const entries = new Map(catalog.map((entry) => [entry.id, entry]));
  const accountModels = new Map((availability?.models ?? []).filter((entry) => entry.id.trim()).map((entry) => [entry.id, entry]));
  for (const model of accountModels.values()) {
    if (!entries.has(model.id)) entries.set(model.id, { id: model.id, label: model.label?.trim() || model.id, hint: "계정에서 조회한 모델" });
  }
  // 구독 계정은 CLI 로그인 확인이 곧 계정 확인이다(subscription_cli).
  const accountListVerified = availability?.state === "available"
    && (availability.source === "provider_api" || availability.source === "codex_oauth" || availability.source === "subscription_cli");
  return [...entries.values()].map((entry) => {
    const accountModel = accountModels.get(entry.id);
    const ready = state.ready && accountListVerified && accountModel?.availability === "available";
    const reason = accountModel?.reason ?? "";
    const translatedReason = Object.hasOwn(modelAvailabilityReasons, reason) ? modelAvailabilityReasons[reason] : undefined;
    const needs = !state.ready
      ? state.needs || "계정 연결 필요"
      : translatedReason || (reason && availability?.userMessage)
        || (accountModel?.availability === "blocked"
        ? "이 계정에서 사용할 수 없는 모델입니다."
        : accountListVerified && !accountModel
          ? "현재 계정의 사용 가능 목록에 없습니다."
          : availability?.userMessage || "모델 사용 가능 여부를 확인해 주세요.");
    return {
      id: entry.id,
      label: entry.label,
      hint: ready ? "계정 목록 확인됨 · 실행 시 권한과 사용량 확인" : entry.hint,
      provider,
      providerLabel,
      ready: Boolean(ready),
      setupRequired: !state.ready,
      ...(!ready ? { needs } : {}),
    };
  });
}

export function buildModelChoices(input: BuildModelChoicesInput): ModelChoice[] {
  const groups = [
    ...(input.subscriptions ?? []).map((runtime) => buildProviderModelChoices(
      runtime.providerId,
      `${runtime.label} 구독`,
      {
        ready: runtime.loggedIn,
        needs: runtime.installed ? `${runtime.label} 로그인 (API 키 없이 연결)` : `${runtime.label} 앱 설치`,
        modelAvailability: runtime.modelAvailability,
      },
      runtime.models?.length ? runtime.models : [{ id: "", label: `${runtime.label} 계정 기본 모델`, hint: "사용 범위와 요금은 연결한 계정의 조건을 따릅니다." }],
    )),
    buildProviderModelChoices("codex_oauth", "ChatGPT 로그인", input.codex, codexCatalog),
    buildProviderModelChoices("openai", "OpenAI API", input.openai ?? { ready: false, needs: "OpenAI API 키 연결" }, openaiCatalog),
    buildProviderModelChoices("anthropic", "Claude API", input.anthropic, anthropicCatalog),
    buildProviderModelChoices("gemini", "Gemini API", input.gemini, geminiCatalog),
    input.localModels.length
      ? input.localModels.map((model): ModelChoice => ({ id: model.id, label: model.label?.trim() || model.id, hint: model.runtimeLabel?.trim() || "이 PC 안에서 실행", provider: "local", providerLabel: "내 PC", ready: true, setupRequired: false }))
      : [{ id: "", label: "설치된 모델 없음", hint: "Ollama나 LM Studio를 켜면 여기 나옵니다.", provider: "local", providerLabel: "내 PC", ready: false, setupRequired: true, needs: "내 PC에서 모델 찾기" }],
  ];
  return [...groups.filter((group) => group.some((choice) => choice.ready)), ...groups.filter((group) => !group.some((choice) => choice.ready))].flat();
}
