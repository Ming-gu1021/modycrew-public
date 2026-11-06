/**
 * 내 PC 안에서 도는 AI 모델 어댑터 — Ollama / LM Studio / llama.cpp 서버 / vLLM.
 *
 * 왜 넷을 하나로 묶는가: 이 런타임들은 전부 OpenAI 호환 경로
 * (`POST /v1/chat/completions`, `GET /v1/models`)를 낸다. 그래서 사용자에게는
 * "내 PC 모델"이라는 선택지 하나만 보여 주고, 어느 프로그램이 켜져 있는지·
 * 몇 번 포트인지는 우리가 찾는다. 포트를 알아야 쓸 수 있게 만드는 순간
 * 이 기능은 "어려워서 못 하는" 기능이 된다.
 *
 * 왜 `http://127.0.0.1` 로 못 박는가: baseUrl 을 아무 호스트나 받으면 이 어댑터는
 * "로컬 모델"이라는 이름표를 달고 대화 내용을 바깥으로 내보내는 통로가 된다.
 * 이 파일이 사용자에게 하는 약속은 "여기로 보낸 말은 이 PC를 벗어나지 않는다"
 * 하나뿐이라, 그 약속을 깨는 입력은 조용히 기본값으로 되돌리지 않고 실패로 돌려준다
 * (조용히 되돌리면 사용자는 자기가 지정한 주소로 갔다고 착각한다).
 *
 * 이 패키지는 순수 도메인이라 fs/path/child_process 를 쓰지 않는다. fetch 는 주입받는다.
 */

import { normalizeAIResponseUsage, type AIResponseUsage } from "./ai-usage.js";

export type ModyLocalModelLiveStatus =
  | "needs_local_runtime"
  | "needs_local_model"
  | "generate_content_loaded"
  | "local_model_api_failed";

export type ModyLocalModelListStatus =
  | "needs_local_runtime"
  | "needs_local_model"
  | "models_loaded"
  | "local_model_api_failed";

export type ModyLocalModelRuntimeId = "ollama" | "lm_studio" | "llama_cpp" | "vllm" | "custom";

export type ModyLocalModelRuntimeCandidate = {
  runtimeId: ModyLocalModelRuntimeId;
  /** 사용자에게 그대로 보여 줄 프로그램 이름 */
  label: string;
  baseUrl: string;
};

export type ModyLocalModelInfo = {
  /** 호출할 때 그대로 쓰는 id (예: llama3.1:8b) */
  id: string;
  /** 목록에 보여 줄 이름 — `:latest` 같은 군더더기를 뗀 형태 */
  label: string;
  ownedBy?: string;
  /**
   * 이름만 보고 임베딩 전용으로 보이는지. 채팅에 쓰면 실패하므로
   * 자동 선택에서 뒤로 밀 때만 쓴다(사용자가 직접 고르면 막지 않는다).
   */
  looksEmbeddingOnly: boolean;
};

export type ModyLocalModelLiveInput = {
  prompt?: string;
  /** 비우면 설치된 모델 중에서 자동으로 고른다 */
  model?: string;
  /** 비우면 이 PC에서 켜져 있는 런타임을 찾는다 */
  baseUrl?: string;
  /** 로컬 모델은 첫 응답이 느리다. 기본 120초. */
  timeoutMs?: number;
};

export type ModyLocalModelLiveResult = {
  tokenUsage?: AIResponseUsage;
  status: ModyLocalModelLiveStatus;
  providerId: "local_model";
  action: "chat_completions";
  runtimeId: ModyLocalModelRuntimeId;
  runtimeLabel: string;
  model: string;
  baseUrl: string;
  endpoint: string;
  externalMutation: false;
  appMayPersistSecret: false;
  rawSecretMaterialStored: false;
  rawSecretMaterialReturned: false;
  promptChars?: number;
  outputText?: string;
  outputChars?: number;
  userMessage: string;
  errorMessage?: string;
  auditMessages: string[];
};

export type ModyLocalModelListResult = {
  status: ModyLocalModelListStatus;
  providerId: "local_model";
  action: "list_models";
  runtimeId: ModyLocalModelRuntimeId;
  runtimeLabel: string;
  baseUrl: string;
  endpoint: string;
  models: ModyLocalModelInfo[];
  /** 자동 선택이 고른 모델. 없으면 빈 문자열. */
  recommendedModel: string;
  /** 어떤 주소를 두드려 봤는지 — "왜 못 찾았나"를 사용자에게 설명할 때 쓴다 */
  checkedBaseUrls: string[];
  externalMutation: false;
  appMayPersistSecret: false;
  rawSecretMaterialStored: false;
  rawSecretMaterialReturned: false;
  userMessage: string;
  errorMessage?: string;
  auditMessages: string[];
};

type FetchLikeResponse = {
  ok: boolean;
  status: number;
  statusText: string;
  json: () => Promise<unknown>;
};

type FetchLikeInit = {
  method: "GET" | "POST";
  headers: Record<string, string>;
  redirect: "error";
  body?: string;
  signal?: AbortSignal;
};

type FetchLike = (url: string, init: FetchLikeInit) => Promise<FetchLikeResponse>;

type OpenAICompatibleChatResponse = {
  choices?: Array<{
    message?: {
      content?: string | Array<{ type?: string; text?: string }>;
    };
    text?: string;
  }>;
  error?: {
    message?: string;
    type?: string;
    code?: string;
  };
};

type OpenAICompatibleModelsResponse = {
  data?: Array<{
    id?: string;
    /** 규격은 `id` 지만 자체 빌드 서버가 이쪽으로 내는 경우가 있다 */
    name?: string;
    model?: string;
    owned_by?: string;
  }>;
  error?: {
    message?: string;
  };
};

/**
 * 기본 탐색 순서. 앞의 둘이 일반 사용자가 실제로 설치하는 프로그램이고,
 * 뒤의 둘은 이미 직접 띄워 쓰는 사람을 위한 덤이다. 응답 모양(`data` 배열)을
 * 확인한 뒤에만 받아들이므로, 8080/8000 에 다른 개발 서버가 떠 있어도 오인하지 않는다.
 */
const defaultRuntimeCandidates: ModyLocalModelRuntimeCandidate[] = [
  { runtimeId: "ollama", label: "Ollama", baseUrl: "http://127.0.0.1:11434" },
  { runtimeId: "lm_studio", label: "LM Studio", baseUrl: "http://127.0.0.1:1234" },
  { runtimeId: "llama_cpp", label: "llama.cpp 서버", baseUrl: "http://127.0.0.1:8080" },
  { runtimeId: "vllm", label: "vLLM", baseUrl: "http://127.0.0.1:8000" },
];

const defaultTimeoutMs = 120_000;
/** 꺼져 있는 포트 하나 때문에 사용자를 2분 기다리게 하지 않는다. */
const defaultProbeTimeoutMs = 2_500;
const unknownRuntimeLabel = "내 PC 모델";

const modyAssistantInstructions = [
  "너는 ModyCrew Windows 앱 안에서 사용자와 함께 일하는 한국어 AI 업무 비서다.",
  "말투는 친근하고 자연스럽게 한다. 사용자가 답답해할 때는 먼저 한 문장으로 받아주고 바로 실제 답을 준다.",
  "답 길이는 질문에 맞춘다. 잡담·단순 확인은 짧게, 방법·이유·비교를 묻거나 사용자가 헷갈려 하면 충분히 풀어서 설명한다. 금지는 장황함이 아니라 불필요한 제품 홍보·기능 나열·가짜 진행 보고다.",
  "사용자를 초보라고 가정하고, 처음 나오는 용어·기능은 한 줄로 쉽게 풀어 설명하고 필요하면 짧은 예시를 든다. 이유를 먼저 이해시킨 다음 다음 단계를 준다.",
  "내부 모델명, runtime, smoke marker, diagnosticStage, callback URL, OAuth 세부 절차는 사용자가 직접 묻지 않으면 말하지 않는다.",
  "단순 질문에는 패널/기능/도구 소개를 붙이지 말고 질문 자체에 답한다.",
  "현재 사용자 요청을 최우선으로 처리하고, 최근 대화와 로컬 기억은 그 요청을 돕는 범위에서만 사용한다.",
  "처음 시작/세팅 대화에서는 기능을 나열하지 말고 이름, 호칭, 기억 위치, 업무 자료처럼 지금 필요한 한 가지를 물어본다.",
  "사용자가 앱이 안 된다고 말하면 변명하지 말고 가능한 복구 단계 1-2개와 열어야 할 패널만 안내한다.",
  "사용자가 이전 대화나 현재 앱 상태를 이어서 말하면 제공된 대화 맥락을 반영한다.",
  "외부 발송, 파일 변경, 일정 등록, 결제, 삭제, 공공기관/세무/계약 실행은 사용자가 승인하기 전에는 실행했다고 말하지 않는다.",
  "로그인 정보, 사이트 아이디, 비밀번호는 채팅에 쓰라고 하지 말고 앱의 보관함/설정에서 저장하라고 안내한다.",
  "모르는 것은 확인 필요라고 말하고, 지금 앱 안에서 할 수 있는 가장 작은 다음 단계를 제안한다.",
].join("\n");

const localModelSafetyFlags = {
  providerId: "local_model",
  externalMutation: false,
  appMayPersistSecret: false,
  rawSecretMaterialStored: false,
  rawSecretMaterialReturned: false,
} as const;

export class ModyLocalModelLiveConnector {
  private readonly fetchImpl: FetchLike;
  private readonly candidates: ModyLocalModelRuntimeCandidate[];
  private readonly timeoutMs: number;
  private readonly probeTimeoutMs: number;

  constructor(options: {
    fetch?: FetchLike;
    candidates?: ModyLocalModelRuntimeCandidate[];
    timeoutMs?: number;
    probeTimeoutMs?: number;
  } = {}) {
    const fetchImpl = options.fetch ?? (globalThis as unknown as { fetch?: FetchLike }).fetch;
    if (!fetchImpl) {
      throw new Error("fetch runtime is required for local model live connector");
    }
    this.fetchImpl = fetchImpl;
    this.candidates = normalizeCandidates(options.candidates);
    this.timeoutMs = sanitizeTimeout(options.timeoutMs, defaultTimeoutMs);
    this.probeTimeoutMs = sanitizeTimeout(options.probeTimeoutMs, defaultProbeTimeoutMs);
  }

  /**
   * 설치된 모델 목록. baseUrl 을 주면 그 주소만, 안 주면 켜져 있는 런타임을 찾는다.
   *
   * 이 함수가 이 어댑터의 핵심이다 — 사용자가 `llama3.1:8b` 같은 이름을
   * 외워서 타이핑하게 만들면 안 되기 때문에, 고를 수 있는 것을 먼저 읽어 온다.
   */
  async listModels(input: { baseUrl?: string; timeoutMs?: number } = {}): Promise<ModyLocalModelListResult> {
    const timeoutMs = sanitizeTimeout(input.timeoutMs, this.probeTimeoutMs);

    if (typeof input.baseUrl === "string" && input.baseUrl.trim().length > 0) {
      const pinned = resolveLocalBaseUrl(input.baseUrl, this.candidates);
      if (!pinned.ok) {
        return listFailure(pinned.candidate, [], "local_model_api_failed", pinned.userMessage, pinned.errorMessage);
      }
      const probe = await this.probeCandidate(pinned.candidate, timeoutMs);
      return this.toListResult(probe, [pinned.candidate.baseUrl]);
    }

    const checked: string[] = [];
    let firstResponder: ProbeOutcome | null = null;
    let lastError: ProbeOutcome | null = null;

    for (const candidate of this.candidates) {
      checked.push(candidate.baseUrl);
      const probe = await this.probeCandidate(candidate, timeoutMs);
      if (probe.kind === "models") {
        // 모델까지 가진 런타임을 찾으면 남은 포트는 두드리지 않는다.
        if (probe.models.length > 0) {
          return this.toListResult(probe, checked);
        }
        // 켜져 있지만 비어 있는 런타임은 기억만 해 두고,
        // 뒤에 모델을 가진 런타임이 있는지 계속 본다.
        firstResponder ??= probe;
        continue;
      }
      if (probe.kind === "http_error") {
        lastError = probe;
      }
    }

    if (firstResponder) {
      return this.toListResult(firstResponder, checked);
    }
    if (lastError && lastError.kind === "http_error") {
      return this.toListResult(lastError, checked);
    }
    // 후보를 사용자가 직접 넣은 경우(전부 custom)에는 설치 안내가 헛다리다.
    // 그 사람은 이미 설치했고, 주소나 포트가 틀렸을 뿐이다.
    const fallbackCandidate = this.candidates[0] ?? defaultCandidate();
    return listFailure(
      fallbackCandidate,
      checked,
      "needs_local_runtime",
      runtimeMissingMessage(fallbackCandidate, checked),
      "local_runtime_not_reachable",
    );
  }

  async generateContent(input: ModyLocalModelLiveInput): Promise<ModyLocalModelLiveResult> {
    const prompt = sanitizePrompt(input.prompt);
    const requestedModel = sanitizeModelId(input.model);
    const timeoutMs = sanitizeTimeout(input.timeoutMs, this.timeoutMs);

    if (typeof input.baseUrl === "string" && input.baseUrl.trim().length > 0) {
      const pinned = resolveLocalBaseUrl(input.baseUrl, this.candidates);
      if (!pinned.ok) {
        return generateFailure(
          pinned.candidate,
          requestedModel,
          "local_model_api_failed",
          pinned.userMessage,
          pinned.errorMessage,
        );
      }
    }

    if (!prompt) {
      const candidate = this.candidates[0] ?? defaultCandidate();
      return generateFailure(
        candidate,
        requestedModel,
        "local_model_api_failed",
        "내 PC 모델에 보낼 내용이 비어 있습니다. 물어볼 말을 적고 다시 눌러 주세요.",
        "prompt_missing",
      );
    }

    const listInput: { baseUrl?: string; timeoutMs: number } = { timeoutMs: this.probeTimeoutMs };
    if (typeof input.baseUrl === "string" && input.baseUrl.trim().length > 0) {
      listInput.baseUrl = input.baseUrl;
    }
    const listed = await this.listModels(listInput);
    const candidate: ModyLocalModelRuntimeCandidate = {
      runtimeId: listed.runtimeId,
      label: listed.runtimeLabel,
      baseUrl: listed.baseUrl,
    };

    if (listed.status === "needs_local_runtime") {
      return generateFailure(
        candidate,
        requestedModel,
        "needs_local_runtime",
        listed.userMessage,
        listed.errorMessage ?? "local_runtime_not_reachable",
      );
    }
    if (listed.status === "local_model_api_failed") {
      return generateFailure(
        candidate,
        requestedModel,
        "local_model_api_failed",
        listed.userMessage,
        listed.errorMessage ?? "local_models_lookup_failed",
      );
    }
    // 사용자가 모델을 직접 골랐다면 그것을 존중한다 — 자동 추천이 "대화용이 없다"고
    // 판단한 경우에도(임베딩 모델을 일부러 시험해 보는 사람을 막지 않는다).
    const chosen = chooseModel(requestedModel, listed.models);
    if (!chosen) {
      if (listed.models.length === 0) {
        return generateFailure(candidate, requestedModel, "needs_local_model", listed.userMessage, "no_local_model_installed");
      }
      if (!requestedModel) {
        return generateFailure(
          candidate,
          requestedModel,
          "needs_local_model",
          listed.userMessage,
          "no_chat_capable_local_model",
        );
      }
      return generateFailure(
        candidate,
        requestedModel,
        "local_model_api_failed",
        `${candidate.label}에 "${requestedModel}" 모델이 없습니다. 지금 쓸 수 있는 모델은 ${formatModelNames(listed.models)}입니다. 이 중에서 골라 주세요.`,
        "requested_model_not_installed",
      );
    }

    const endpoint = `${candidate.baseUrl}/v1/chat/completions`;
    const outcome = await this.requestJson(
      endpoint,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: chosen,
          messages: [
            { role: "system", content: modyAssistantInstructions },
            { role: "user", content: prompt },
          ],
          // 이 어댑터는 한 번에 완성된 답을 돌려준다. 기본값이 서버마다 달라 명시한다.
          stream: false,
          // 로컬 모델은 느리지만, 4096 에서 끊기면 보고서를 다시 시켜야 해서 더 오래 걸린다.
          // 타임아웃이 넉넉하므로(기본 120초) 한 번에 끝낼 수 있는 만큼 준다.
          max_tokens: 8192,
        }),
      },
      timeoutMs,
    );

    if (outcome.kind === "timeout") {
      return generateFailure(
        { ...candidate },
        chosen,
        "local_model_api_failed",
        `${candidate.label} 모델이 ${Math.round(timeoutMs / 1000)}초 안에 답하지 않았습니다. 로컬 모델은 처음 실행할 때 특히 느립니다. 잠시 뒤 다시 시도하거나 더 작은 모델을 골라 주세요.`,
        "local_model_timeout",
      );
    }
    if (outcome.kind === "network_error") {
      return generateFailure(
        { ...candidate },
        chosen,
        "needs_local_runtime",
        `${candidate.label}과(와)의 연결이 도중에 끊겼습니다. 프로그램이 계속 켜져 있는지 확인한 뒤 다시 눌러 주세요.`,
        redactLocalModelSecret(outcome.message),
      );
    }
    if (!outcome.response.ok) {
      const errorBody = outcome.json as OpenAICompatibleChatResponse | undefined;
      const serverSaid = typeof errorBody?.error?.message === "string" ? errorBody.error.message.trim() : "";
      // 404 를 무조건 "버전이 낮다"로 읽으면 안 된다. Ollama·LM Studio 는 목록에 있던
      // 모델이 사이에 사라졌을 때도 404 + error 본문을 준다. 본문을 준다는 것 자체가
      // 그 서버가 OpenAI 호환 규격으로 말하고 있다는 증거라, 버전 탓을 하면 거짓 안내가 된다.
      const looksLikeWrongRoute = outcome.response.status === 404 && serverSaid.length === 0;
      return generateFailure(
        { ...candidate },
        chosen,
        "local_model_api_failed",
        looksLikeWrongRoute
          ? `${candidate.label}은(는) 켜져 있지만 이 앱이 쓰는 방식(OpenAI 호환)으로 응답하지 않습니다. 프로그램을 최신 버전으로 올린 뒤 다시 시도해 주세요.`
          : outcome.response.status === 404
            ? `${candidate.label}에서 "${chosen}" 모델을 찾지 못했습니다. 목록을 다시 불러온 뒤 지금 받아 둔 모델 중에서 골라 주세요.`
            : `${candidate.label} 모델이 요청을 거절했습니다. ${candidate.label}에서 "${chosen}" 모델이 정상인지 확인해 주세요.`,
        redactLocalModelSecret(serverSaid || outcome.response.statusText),
      );
    }

    const outputText = extractLocalModelText(outcome.json as OpenAICompatibleChatResponse);
    if (!outputText) {
      return generateFailure(
        { ...candidate },
        chosen,
        "local_model_api_failed",
        `${candidate.label} 모델이 빈 답을 돌려줬습니다. 다시 한 번 시도하거나 다른 모델을 골라 주세요.`,
        "empty_text_response",
      );
    }

    return {
      status: "generate_content_loaded",
      ...localModelSafetyFlags,
      action: "chat_completions",
      runtimeId: candidate.runtimeId,
      runtimeLabel: candidate.label,
      model: chosen,
      baseUrl: candidate.baseUrl,
      endpoint,
      promptChars: prompt.length,
      outputText,
      outputChars: outputText.length,
      tokenUsage: normalizeAIResponseUsage("local", outcome.json),
      userMessage: `내 PC 안의 ${candidate.label} 모델로 답변을 만들었습니다. 이 대화 내용은 인터넷으로 나가지 않았습니다.`,
      auditMessages: [
        `Local model chat/completions POST 호출 완료 (${candidate.runtimeId})`,
        "요청은 127.0.0.1 로만 나갔습니다. 외부 서버로 대화 내용을 보내지 않습니다.",
        "AI 응답은 채팅 답변이며 외부 발송, 캘린더 등록, 파일 쓰기는 실행하지 않습니다.",
      ],
    };
  }

  private async probeCandidate(
    candidate: ModyLocalModelRuntimeCandidate,
    timeoutMs: number,
  ): Promise<ProbeOutcome> {
    const endpoint = `${candidate.baseUrl}/v1/models`;
    const outcome = await this.requestJson(
      endpoint,
      { method: "GET", headers: { Accept: "application/json" } },
      timeoutMs,
    );

    if (outcome.kind === "timeout") {
      return { kind: "unreachable", candidate, endpoint, errorMessage: "local_models_probe_timeout" };
    }
    if (outcome.kind === "network_error") {
      return {
        kind: "unreachable",
        candidate,
        endpoint,
        errorMessage: redactLocalModelSecret(outcome.message),
      };
    }
    if (!outcome.response.ok) {
      const errorBody = outcome.json as OpenAICompatibleModelsResponse | undefined;
      return {
        kind: "http_error",
        candidate,
        endpoint,
        status: outcome.response.status,
        errorMessage: redactLocalModelSecret(errorBody?.error?.message ?? outcome.response.statusText),
      };
    }

    const parsed = outcome.json as OpenAICompatibleModelsResponse | undefined;
    if (!parsed || !Array.isArray(parsed.data)) {
      // 다른 개발 서버가 그 포트를 쓰고 있는 경우다. 런타임으로 인정하지 않는다.
      return { kind: "unreachable", candidate, endpoint, errorMessage: "unexpected_models_response" };
    }

    return { kind: "models", candidate, endpoint, models: normalizeModels(parsed.data) };
  }

  private toListResult(probe: ProbeOutcome, checked: string[]): ModyLocalModelListResult {
    if (probe.kind === "models") {
      const recommended = chooseModel("", probe.models);
      // 모델이 있어도 전부 검색·임베딩 전용이면 대화에는 쓸 수 없다. 그때 "고르면 바로
      // 쓸 수 있습니다"라고 말하면, 사용자는 골라 놓고 서버 오류만 보게 된다.
      return {
        status: recommended ? "models_loaded" : "needs_local_model",
        ...localModelSafetyFlags,
        action: "list_models",
        runtimeId: probe.candidate.runtimeId,
        runtimeLabel: probe.candidate.label,
        baseUrl: probe.candidate.baseUrl,
        endpoint: probe.endpoint,
        models: probe.models,
        recommendedModel: recommended,
        checkedBaseUrls: checked,
        userMessage: recommended
          ? `${probe.candidate.label}에서 모델 ${probe.models.length}개를 찾았습니다. 이 중에서 고르면 바로 쓸 수 있습니다.`
          : modelMissingMessage(probe.candidate, probe.models),
        auditMessages: [
          `Local model /v1/models GET 조회 완료 (${probe.candidate.runtimeId})`,
          "127.0.0.1 외 주소로는 조회하지 않습니다.",
        ],
      };
    }

    if (probe.kind === "http_error") {
      return listFailure(
        probe.candidate,
        checked,
        "local_model_api_failed",
        `${probe.candidate.label}은(는) 켜져 있는데 모델 목록을 주지 않았습니다. 프로그램을 껐다 켠 뒤 다시 시도해 주세요.`,
        probe.errorMessage,
      );
    }

    return listFailure(
      probe.candidate,
      checked,
      "needs_local_runtime",
      runtimeMissingMessage(probe.candidate),
      probe.errorMessage,
    );
  }

  private async requestJson(
    url: string,
    init: { method: "GET" | "POST"; headers: Record<string, string>; body?: string },
    timeoutMs: number,
  ): Promise<RequestOutcome> {
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const requestInit: FetchLikeInit = {
      method: init.method,
      headers: init.headers,
      // A loopback server must not redirect the prompt to a different host.
      redirect: "error",
      ...(init.body === undefined ? {} : { body: init.body }),
      ...(controller ? { signal: controller.signal } : {}),
    };

    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<{ kind: "timeout" }>((resolve) => {
      timer = setTimeout(() => {
        controller?.abort();
        resolve({ kind: "timeout" });
      }, timeoutMs);
    });

    try {
      const pending = this.fetchImpl(url, requestInit);
      // 주입된 fetch 가 signal 을 무시해도 사용자가 무한정 기다리지 않도록 경주시킨다.
      // 타임아웃이 이긴 뒤 뒤늦게 실패하는 요청이 unhandled rejection 이 되지 않게 잡아 둔다.
      pending.catch(() => undefined);
      const raced = await Promise.race([
        pending.then((response) => ({ kind: "response" as const, response })),
        timeout,
      ]);
      if (raced.kind === "timeout") {
        return raced;
      }
      const json = await raced.response.json().catch(() => undefined);
      return { kind: "response", response: raced.response, json };
    } catch (error) {
      return {
        kind: "network_error",
        message: error instanceof Error ? error.message : String(error),
      };
    } finally {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    }
  }
}

/**
 * 연결 없이도 쓸 수 있는 짧은 호출부 — 화면에서 "내 PC 모델 찾기" 한 번 누를 때 쓴다.
 */
export async function listLocalModels(
  input: {
    baseUrl?: string;
    fetch?: FetchLike;
    candidates?: ModyLocalModelRuntimeCandidate[];
    timeoutMs?: number;
  } = {},
): Promise<ModyLocalModelListResult> {
  const connectorOptions: {
    fetch?: FetchLike;
    candidates?: ModyLocalModelRuntimeCandidate[];
    probeTimeoutMs?: number;
  } = {};
  if (input.fetch) connectorOptions.fetch = input.fetch;
  if (input.candidates) connectorOptions.candidates = input.candidates;
  if (typeof input.timeoutMs === "number") connectorOptions.probeTimeoutMs = input.timeoutMs;

  const connector = new ModyLocalModelLiveConnector(connectorOptions);
  const listInput: { baseUrl?: string; timeoutMs?: number } = {};
  if (typeof input.baseUrl === "string") listInput.baseUrl = input.baseUrl;
  if (typeof input.timeoutMs === "number") listInput.timeoutMs = input.timeoutMs;
  return connector.listModels(listInput);
}

export function getDefaultLocalRuntimeCandidates(): ModyLocalModelRuntimeCandidate[] {
  return defaultRuntimeCandidates.map((candidate) => ({ ...candidate }));
}

type ProbeOutcome =
  | { kind: "models"; candidate: ModyLocalModelRuntimeCandidate; endpoint: string; models: ModyLocalModelInfo[] }
  | {
      kind: "http_error";
      candidate: ModyLocalModelRuntimeCandidate;
      endpoint: string;
      status: number;
      errorMessage: string;
    }
  | { kind: "unreachable"; candidate: ModyLocalModelRuntimeCandidate; endpoint: string; errorMessage: string };

type RequestOutcome =
  | { kind: "response"; response: FetchLikeResponse; json: unknown }
  | { kind: "timeout" }
  | { kind: "network_error"; message: string };

/**
 * 로컬 서버가 안 떠 있는 것이 가장 흔한 상태라, 여기 문구가 이 어댑터에서
 * 사용자가 제일 자주 보는 화면이 된다. "연결 실패"로 끝내지 않고 다음 행동을 준다.
 * 사용자가 주소를 직접 지정한 경우에는 설치 안내가 오히려 헷갈리므로 나눠 쓴다.
 */
function runtimeMissingMessage(candidate?: ModyLocalModelRuntimeCandidate, checked?: string[]): string {
  if (candidate?.runtimeId === "custom") {
    const addresses = Array.isArray(checked) && checked.length > 1 ? checked.join(", ") : candidate.baseUrl;
    return `${addresses} 에서 응답이 없습니다. 그 주소로 모델 프로그램이 켜져 있는지, 포트 번호가 맞는지 확인한 뒤 다시 눌러 주세요.`;
  }
  return [
    "내 PC에서 실행 중인 AI 모델을 찾지 못했습니다.",
    "Ollama(ollama.com) 또는 LM Studio(lmstudio.ai) 중 하나를 설치해 실행한 뒤 다시 눌러 주세요.",
    "이미 설치했다면 그 프로그램이 지금 켜져 있는지 확인해 주세요.",
  ].join(" ");
}

function modelMissingMessage(candidate: ModyLocalModelRuntimeCandidate, models: ModyLocalModelInfo[] = []): string {
  const howTo =
    candidate.runtimeId === "ollama"
      ? '명령 창에 "ollama pull llama3.1:8b" 를 입력하면 받을 수 있습니다.'
      : candidate.runtimeId === "lm_studio"
        ? "LM Studio 왼쪽의 검색(돋보기)에서 모델을 하나 내려받아 주세요."
        : "해당 프로그램에서 모델을 하나 내려받아 주세요.";
  if (models.length > 0) {
    // 받아 둔 것이 있는데 "하나도 없습니다"라고 하면 사용자는 자기 눈을 의심하게 된다.
    return `${candidate.label}에 받아 둔 모델(${formatModelNames(models)})은 문서 검색용이라 대화에는 쓸 수 없습니다. 대화용 모델을 하나 더 받아 주세요. ${howTo}`;
  }
  return `${candidate.label}은(는) 켜져 있는데 받아 둔 모델이 하나도 없습니다. ${howTo} 처음이라면 8B 정도의 가벼운 모델이 무난합니다.`;
}

function listFailure(
  candidate: ModyLocalModelRuntimeCandidate,
  checked: string[],
  status: ModyLocalModelListStatus,
  userMessage: string,
  errorMessage: string,
): ModyLocalModelListResult {
  return {
    status,
    ...localModelSafetyFlags,
    action: "list_models",
    runtimeId: candidate.runtimeId,
    runtimeLabel: candidate.label,
    baseUrl: candidate.baseUrl,
    endpoint: `${candidate.baseUrl}/v1/models`,
    models: [],
    recommendedModel: "",
    checkedBaseUrls: checked,
    userMessage,
    errorMessage,
    auditMessages: [
      "Local model 목록 조회가 실패했습니다. 어떤 변경도 일어나지 않았습니다.",
      "127.0.0.1 외 주소로는 조회하지 않습니다.",
    ],
  };
}

function generateFailure(
  candidate: ModyLocalModelRuntimeCandidate,
  model: string,
  status: ModyLocalModelLiveStatus,
  userMessage: string,
  errorMessage: string,
): ModyLocalModelLiveResult {
  return {
    status,
    ...localModelSafetyFlags,
    action: "chat_completions",
    runtimeId: candidate.runtimeId,
    runtimeLabel: candidate.label,
    model,
    baseUrl: candidate.baseUrl,
    endpoint: `${candidate.baseUrl}/v1/chat/completions`,
    userMessage,
    errorMessage,
    auditMessages: [
      "Local model live call failed before any mutation",
      "요청은 127.0.0.1 로만 나갔고, 외부 발송·파일 변경은 실행하지 않았습니다.",
    ],
  };
}

/**
 * 이 PC 주소인지 확인한다. `localhost` 는 사용자가 실제로 타이핑하는 이름이라
 * 127.0.0.1 로 바꿔서 받아 준다(바꿔도 요청이 나가는 곳은 여전히 이 PC다).
 * 그 밖의 호스트는 되돌리지 않고 거절한다 — 조용히 기본값으로 바꾸면
 * 사용자는 자기가 지정한 서버로 갔다고 착각하게 된다.
 *
 * 받아 주는 모양은 사용자가 실제로 손에 쥐는 문자열에 맞춘다. Ollama·LM Studio 가
 * 자기 화면과 문서에 적어 주는 주소는 `http://localhost:11434/v1` 처럼 `/v1` 이 붙어
 * 있고, 사람은 `127.0.0.1:11434` 처럼 스킴을 빼고 치기도 한다. 그것을 "형식이 올바르지
 * 않습니다"로 되돌려 보내면, 사용자가 시킨 대로 복사해 왔는데 앱만 아니라고 하는
 * 상황이 된다. 그러니 여기서 벗겨 준다 — 단, 벗긴 뒤에도 호스트 검사는 그대로 받는다.
 */
function resolveLocalBaseUrl(
  value: string,
  candidates: ModyLocalModelRuntimeCandidate[],
):
  | { ok: true; candidate: ModyLocalModelRuntimeCandidate }
  | { ok: false; candidate: ModyLocalModelRuntimeCandidate; userMessage: string; errorMessage: string } {
  const trimmed = value.trim();
  // OpenAI 호환 경로만 벗긴다. 그 밖의 경로는 벗기지 않고 형식 오류로 돌려보낸다
  // (아무 경로나 잘라 내면 `http://evil.example/127.0.0.1` 같은 문자열이 통과할 길이 생긴다).
  const withoutPath = trimmed
    .replace(/\/+$/, "")
    .replace(/\/v1(?:\/chat\/completions|\/completions|\/models)?$/i, "");
  // 스킴을 빼고 치는 사람이 많다. 붙여 주더라도 호스트 검사는 아래에서 그대로 한다.
  const raw = /^[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(withoutPath)
    ? withoutPath
    : withoutPath.length > 0
      ? `http://${withoutPath}`
      : withoutPath;
  const fallback = candidates[0] ?? defaultCandidate();
  const rejected = (userMessage: string, errorMessage: string) => ({
    ok: false as const,
    candidate: { ...fallback },
    userMessage,
    errorMessage,
  });

  const match = /^(https?):\/\/([^/?#@]+)$/i.exec(raw);
  if (!match) {
    return rejected(
      "주소 형식이 올바르지 않습니다. 내 PC 모델 주소는 http://127.0.0.1:11434 처럼 포트까지 적어 주세요.",
      "base_url_malformed",
    );
  }

  const scheme = (match[1] ?? "").toLowerCase();
  const authority = match[2] ?? "";
  const hostMatch = /^([^:]+)(?::(\d{1,5}))?$/.exec(authority);
  if (!hostMatch) {
    return rejected(
      "주소 형식이 올바르지 않습니다. 내 PC 모델 주소는 http://127.0.0.1:11434 처럼 포트까지 적어 주세요.",
      "base_url_malformed",
    );
  }

  const host = (hostMatch[1] ?? "").toLowerCase();
  const port = Number(hostMatch[2] ?? "0");
  if (host !== "127.0.0.1" && host !== "localhost") {
    return rejected(
      "내 PC 모델은 이 컴퓨터 안(127.0.0.1)만 사용할 수 있습니다. 다른 컴퓨터나 인터넷 주소는 여기에 넣을 수 없습니다. 인터넷 AI를 쓰려면 AI 연결에서 OpenAI나 Gemini를 골라 주세요.",
      "base_url_not_local",
    );
  }
  if (scheme !== "http") {
    return rejected(
      "내 PC 모델 주소는 http:// 로 시작합니다. http://127.0.0.1:11434 처럼 적어 주세요.",
      "base_url_scheme_not_http",
    );
  }
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    return rejected(
      "포트 번호가 빠졌거나 잘못됐습니다. http://127.0.0.1:11434 처럼 포트까지 적어 주세요.",
      "base_url_port_invalid",
    );
  }

  const baseUrl = `http://127.0.0.1:${port}`;
  const known = candidates.find((candidate) => candidate.baseUrl === baseUrl);
  return {
    ok: true,
    candidate: known ? { ...known } : { runtimeId: "custom", label: unknownRuntimeLabel, baseUrl },
  };
}

function normalizeCandidates(value: ModyLocalModelRuntimeCandidate[] | undefined): ModyLocalModelRuntimeCandidate[] {
  if (!Array.isArray(value) || value.length === 0) {
    return getDefaultLocalRuntimeCandidates();
  }
  const normalized: ModyLocalModelRuntimeCandidate[] = [];
  for (const candidate of value) {
    const resolved = resolveLocalBaseUrl(String(candidate?.baseUrl ?? ""), []);
    if (!resolved.ok) continue;
    const label = typeof candidate?.label === "string" && candidate.label.trim() ? candidate.label.trim() : unknownRuntimeLabel;
    normalized.push({
      runtimeId: candidate?.runtimeId ?? "custom",
      label,
      baseUrl: resolved.candidate.baseUrl,
    });
  }
  return normalized.length > 0 ? normalized : getDefaultLocalRuntimeCandidates();
}

function defaultCandidate(): ModyLocalModelRuntimeCandidate {
  return { ...(defaultRuntimeCandidates[0] as ModyLocalModelRuntimeCandidate) };
}

function normalizeModels(entries: Array<{ id?: string; name?: string; model?: string; owned_by?: string }>): ModyLocalModelInfo[] {
  const seen = new Set<string>();
  const models: ModyLocalModelInfo[] = [];
  for (const entry of entries) {
    // `id` 가 규격이지만, 자체 빌드 서버가 `name`/`model` 로 내는 경우가 있다.
    // 못 읽고 "받아 둔 모델이 하나도 없습니다"라고 말하는 것보다 읽어 주는 편이 낫다.
    const id = sanitizeModelId(entry?.id) || sanitizeModelId(entry?.name) || sanitizeModelId(entry?.model);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const info: ModyLocalModelInfo = {
      id,
      label: id.replace(/:latest$/i, ""),
      looksEmbeddingOnly: /embed|bge-|gte-|e5-|reranker/i.test(id),
    };
    const ownedBy = typeof entry?.owned_by === "string" ? entry.owned_by.trim() : "";
    if (ownedBy) info.ownedBy = ownedBy;
    models.push(info);
  }
  return models;
}

/**
 * 사용자가 고른 모델이 있으면 그것을 쓰되, 설치 목록에 없으면 빈 문자열을 돌려
 * "그 모델은 없다"를 위에서 알려 줄 수 있게 한다. 안 골랐으면 채팅에 쓸 수 있는
 * 첫 모델을 대신 고른다 — 이름을 외우게 만들지 않기 위해서다.
 */
function chooseModel(requested: string, models: ModyLocalModelInfo[]): string {
  if (requested) {
    const exact = models.find((model) => model.id === requested);
    if (exact) return exact.id;
    const loose = models.find(
      (model) => model.id.replace(/:latest$/i, "").toLowerCase() === requested.replace(/:latest$/i, "").toLowerCase(),
    );
    return loose ? loose.id : "";
  }
  // 채팅에 쓸 수 있는 것이 하나도 없으면 아무거나 집어 주지 않는다. 임베딩 모델을
  // 추천해 두면 사용자는 "추천대로 골랐는데 오류가 난다"를 겪는다. 빈 문자열을 돌려
  // 위에서 "대화용 모델이 필요하다"고 말하게 한다(직접 고른 모델은 위에서 통과시킨다).
  return models.find((model) => !model.looksEmbeddingOnly)?.id ?? "";
}

function formatModelNames(models: ModyLocalModelInfo[]): string {
  return models.slice(0, 8).map((model) => model.label).join(", ");
}

function extractLocalModelText(response: OpenAICompatibleChatResponse | undefined): string {
  const choices = response?.choices ?? [];
  const texts: string[] = [];
  for (const choice of choices) {
    const before = texts.length;
    const content = choice?.message?.content;
    if (typeof content === "string") {
      if (content.trim()) texts.push(content);
    } else if (Array.isArray(content)) {
      // llama.cpp·vLLM 일부 빌드는 content 를 파트 배열로 돌려준다.
      for (const part of content) {
        if (typeof part?.text === "string" && part.text.trim()) texts.push(part.text);
      }
    }
    // content 를 빈 문자열로 두고 답을 choice.text 에 담는 서버가 있다. else 로 묶어 두면
    // 답이 눈앞에 와 있는데 "빈 답을 돌려줬습니다"라고 말하게 된다.
    if (texts.length === before && typeof choice?.text === "string" && choice.text.trim()) {
      texts.push(choice.text);
    }
  }
  return texts.filter(Boolean).join("\n").trim().slice(0, 24_000);
}

function sanitizeModelId(value: unknown): string {
  const model = typeof value === "string" ? value.trim() : "";
  return /^[A-Za-z0-9_.:\/-]{1,160}$/.test(model) ? model : "";
}

function sanitizePrompt(value: unknown): string {
  const prompt = typeof value === "string" ? value.trim() : "";
  return prompt
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .slice(0, 24_000);
}

function sanitizeTimeout(value: unknown, fallback: number): number {
  const timeout = typeof value === "number" && Number.isFinite(value) ? Math.floor(value) : 0;
  return timeout >= 1 && timeout <= 600_000 ? timeout : fallback;
}

/**
 * 로컬 경로에는 API key 가 없지만, LiteLLM 같은 로컬 프록시를 앞에 세운 사용자는
 * 상류 서비스의 키가 담긴 오류 문구를 그대로 돌려받을 수 있다. 이 errorMessage 는
 * 화면과 로그로 나가므로 키처럼 생긴 문자열은 지우고 내보낸다.
 */
export function redactLocalModelSecret(value: string): string {
  return value
    .replace(/\bsk-[A-Za-z0-9_-]{20,}\b/g, "[api-key-redacted]")
    .replace(/\bAIza[0-9A-Za-z_-]{20,}\b/g, "[api-key-redacted]")
    // 프록시가 돌려주는 문구에는 `authorization:` 접두사 없이 토큰만 실려 오는 쪽이 오히려
    // 흔하다. 접두사가 있을 때만 가리면 정작 가려야 할 모양을 놓친다.
    .replace(
      /\b(authorization\s*:\s*)?bearer\s+[A-Za-z0-9._~+/=-]{16,}/gi,
      (_match, prefix: string | undefined) => `${prefix ?? ""}bearer [api-key-redacted]`,
    )
    .replace(/\b((?:x-)?api[-_]?key\s*[:=]\s*)["']?[A-Za-z0-9._~+/=-]{12,}["']?/gi, "$1[api-key-redacted]");
}
