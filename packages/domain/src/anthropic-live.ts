import { normalizeAIResponseUsage, type AIResponseUsage } from "./ai-usage.js";

export type ModyAnthropicLiveStatus =
  | "needs_credentials"
  | "generate_content_loaded"
  | "anthropic_api_failed";

export type ModyAnthropicLiveAction = "messages_create";

/**
 * 모델 목록 조회 결과의 상태. local-model-live.ts 의 ModyLocalModelListStatus 와
 * 같은 규칙을 쓴다 — 성공은 models_loaded, 연결은 됐는데 쓸 모델이 없으면 needs_*,
 * 호출 자체가 실패하면 <제공자>_api_failed. 화면(모델 고르는 줄)이 제공자들의 목록을
 * 한 곳에서 그리므로, 여기서 이름을 다르게 지으면 분기 하나로는 못 붙는다.
 */
export type ModyAnthropicModelListStatus =
  | "needs_credentials"
  | "needs_model_access"
  | "models_loaded"
  | "anthropic_api_failed";

export type ModyAnthropicModelInfo = {
  /** 호출할 때 그대로 쓰는 id */
  id: string;
  /** 목록에 보여 줄 이름 — API 가 준 display_name, 없으면 id */
  label: string;
  /**
   * 한 번에 읽을 수 있는 입력 토큰 수(API 의 max_input_tokens).
   * "이 모델이 얼마나 긴 문서를 읽을 수 있나"는 사용자가 고를 때 실제로 쓰는 정보라
   * 목록에 같이 싣는다. context_window 라는 필드는 응답에 없다.
   */
  contextWindowTokens?: number;
  /** 한 번에 만들 수 있는 출력 토큰 수(API 의 max_tokens) */
  maxOutputTokens?: number;
  createdAt?: string;
};

export type ModyAnthropicModelListInput = {
  apiKey?: string;
  endpointBase?: string;
};

export type ModyAnthropicLiveInput = {
  preserveModelId?: boolean;
  apiKey?: string;
  prompt?: string;
  model?: string;
  endpointBase?: string;
};

export type ModyAnthropicLiveResult = {
  tokenUsage?: AIResponseUsage;
  status: ModyAnthropicLiveStatus;
  providerId: "anthropic";
  action: ModyAnthropicLiveAction;
  model: string;
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
  httpStatus?: number;
  auditMessages: string[];
};

export type ModyAnthropicModelListResult = {
  status: ModyAnthropicModelListStatus;
  providerId: "anthropic";
  action: "list_models";
  endpoint: string;
  models: ModyAnthropicModelInfo[];
  /** 아무것도 안 고른 사용자에게 쓸 모델. 고를 것이 없으면 빈 문자열. */
  recommendedModel: string;
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

// 목록 조회는 GET 이고 본문이 없다. local-model-live.ts 와 같은 모양으로 넓혀 둬야
// 두 어댑터에 같은 가짜 fetch 를 물릴 수 있다(테스트와 배선이 갈라지지 않게).
type FetchLikeInit = {
  method: "GET" | "POST";
  headers: Record<string, string>;
  body?: string;
};

type FetchLike = (url: string, init: FetchLikeInit) => Promise<FetchLikeResponse>;

/** 성공 응답과 오류 응답 양쪽에서 error 봉투만 읽는 자리 */
type AnthropicErrorEnvelope = {
  error?: {
    message?: unknown;
    type?: string;
  };
};

/**
 * GET /v1/models 응답. 값 하나하나를 unknown 으로 받는 이유: 이 목록은 그대로 화면에
 * 뜨는 데이터라, 낯선 모양이 들어와도 던지지 않고 걸러 내야 한다. 던지면 목록 조회
 * 실패가 "인터넷 연결을 확인하세요" 로 둔갑한다.
 */
type AnthropicModelListEntry = {
  id?: unknown;
  display_name?: unknown;
  created_at?: unknown;
  max_input_tokens?: unknown;
  max_tokens?: unknown;
  capabilities?: unknown;
};

type AnthropicModelsListResponse = AnthropicErrorEnvelope & {
  data?: AnthropicModelListEntry[];
  has_more?: unknown;
  first_id?: unknown;
  last_id?: unknown;
};

type AnthropicMessagesResponse = {
  content?: Array<{
    type?: string;
    text?: string;
  }>;
  stop_reason?: string;
  // stop_reason 이 "refusal" 일 때만 채워진다. 나머지 경우엔 null 이라 반드시 가드한다.
  stop_details?: {
    type?: string;
    category?: string | null;
    explanation?: string;
  } | null;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
  error?: {
    message?: unknown;
    type?: string;
  };
};

/**
 * **조회 실패 시 쓰는 기본 목록이다. 고를 수 있는 모델의 전부가 아니다.**
 *
 * 진짜 목록은 listModels() 가 계정에 직접 물어서 가져온다. 손으로 적어 두면 Anthropic 이
 * 모델을 더하거나 뺄 때마다 어긋나고, 실제로 죽은 id 가 목록에 남아 골랐다가 404 만
 * 받던 사고가 있었다. 그래도 이 배열을 지우지 않는 이유는 두 가지다 — 아직 키를 넣기
 * 전(연결 전)에도 무엇을 쓰게 될지 보여 줘야 하고, 조회가 실패해도 화면이 빈 채로
 * 멈추면 안 되기 때문이다.
 *
 * 데스크톱의 codexSelectableModels 와 같은 { id, label } 모양이라 화면 목록에 그대로 넘긴다.
 */
export const modyAnthropicSelectableModels: ReadonlyArray<{ id: string; label: string }> = [
  { id: "claude-sonnet-5", label: "최신 · 균형" },
  { id: "claude-opus-5", label: "최신 · 깊게 생각" },
  // Fable 5 는 가장 뛰어나지만 값이 Opus 의 두 배다. 이 어댑터는 model·max_tokens·
  // system·messages 만 보내므로 Fable 5 가 400 을 내는 파라미터(temperature·top_p·
  // budget_tokens·thinking 명시)를 애초에 안 보낸다 — 그대로 호환된다.
  // 다만 30일 데이터 보관이 필요해, 보관을 끈 조직에서는 400 이 돌아온다(아래 400 안내 참고).
  { id: "claude-fable-5", label: "가장 뛰어남 · 가장 비쌈" },
  // 날짜 꼬리표(-20251001)를 붙이면 안 된다. Anthropic 모델 id 는 그 자체로 완성형이라
  // 날짜를 덧붙이면 404 not_found_error 가 돌아온다 — 목록 셋째 줄이 통째로 죽는다.
  { id: "claude-haiku-4-5", label: "빠르고 저렴" },
];

// 업무용 기본값은 품질과 속도가 균형인 sonnet 이다. 최신 모델 id 가 바뀌면
// 이 상수와 위 목록 한 곳만 고치면 된다("항상 최신" 정책).
const defaultModel = "claude-sonnet-5";
const defaultEndpointBase = "https://api.anthropic.com/v1";
// Anthropic 은 날짜 문자열로 API 계약을 고정한다. 올리지 않으면 응답 모양이
// 바뀌지 않으므로, 아래 파서와 함께 검증한 뒤에만 올린다.
const anthropicVersion = "2023-06-01";
// max_tokens 는 Anthropic Messages API 의 필수 항목이라 빼면 400 이 돌아온다.
// 4096 은 한국어 보고서·메일 초안이 매번 중간에 끊기는 값이었다. 스트리밍 없이 쓰는
// 호출의 권장 기본값은 16,000 이고, 이 값이면 HTTP 타임아웃에도 걸리지 않는다.
const defaultMaxTokens = 16_000;
/*
 * 프롬프트/응답 안전 상한. 자를 때는 반드시 사용자에게 잘랐다고 말한다(아래 참고).
 *
 * 24,000자였다 — 한국어로 12~15쪽이다. Claude 5 계열은 컨텍스트가 **1M 토큰**이고
 * Haiku 4.5 도 200K 라, 옛 상한은 능력의 1% 도 안 쓰고 있었다. 실제 업무 문서(보고서·
 * 계약서)가 매번 앞부분만 전달되고 있었다는 뜻이다.
 *
 * 200,000자는 약 65K 토큰이다. Haiku 의 200K 컨텍스트에도 넉넉히 들어가고,
 * Opus 5 기준 한 번에 약 $0.33 — "문서 하나 읽어 줘" 에 치를 만한 값이다.
 * 무제한으로 열지 않는 이유가 이것이다: 1M 을 다 채우면 한 번에 $5 가 나간다.
 */
/*
 * 목록 한 장의 크기와 최대 장수. /v1/models 는 커서 방식으로 나눠 주므로 has_more 가
 * 참인 동안 이어서 읽는다. 장수를 막아 두는 이유는 서버가 has_more 를 참으로 두고
 * 커서를 안 바꾸면 같은 장을 무한히 다시 읽게 되기 때문이다(커서 정체 검사와 2중 방어).
 */
const modelListPageSize = 100;
const maxModelListPages = 10;
const maxPromptChars = 200_000;
const maxOutputChars = 48_000;
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

export class ModyAnthropicLiveConnector {
  private readonly fetchImpl: FetchLike;

  constructor(options: { fetch?: FetchLike } = {}) {
    const fetchImpl = options.fetch ?? (globalThis as unknown as { fetch?: FetchLike }).fetch;
    if (!fetchImpl) {
      throw new Error("fetch runtime is required for Anthropic live connector");
    }
    this.fetchImpl = fetchImpl;
  }

  async generateContent(input: ModyAnthropicLiveInput): Promise<ModyAnthropicLiveResult> {
    const apiKey = sanitizeAnthropicApiKey(input.apiKey);
    const model = input.preserveModelId === true && typeof input.model === "string" && anthropicModelIdPattern.test(input.model.trim())
      ? input.model.trim()
      : sanitizeAnthropicModel(input.model);
    // 고른 모델과 실제로 답한 모델이 다르면 반드시 자국이 남아야 한다.
    // 조용히 바뀌면 사용자는 다른 모델의 답을 고른 모델의 답으로 믿는다.
    const requestedModel = typeof input.model === "string" ? input.model.trim() : "";
    // 요청한 id 를 그대로 적으면 안 된다. 키를 모델 칸에 잘못 붙여 넣은 사용자가 있고,
    // 그때 이 줄이 감사 기록으로 키를 흘린다. 감사 줄도 마스킹을 거친다.
    const modelSubstitutionNote =
      requestedModel.length > 0 && requestedModel !== model
        ? [
            `요청한 모델 id "${redactAnthropicSecret(requestedModel, [apiKey, input.apiKey]).slice(0, 120)}" 대신 "${model}" 로 호출했습니다.`,
          ]
        : [];
    const endpointBase = sanitizeEndpointBase(input.endpointBase);
    const endpoint = `${endpointBase}/messages`;
    const { prompt, truncated: promptTruncated } = sanitizePrompt(input.prompt);

    if (!apiKey) {
      return needsCredentials(model, endpoint, describeMissingApiKey(input.apiKey));
    }

    if (!prompt) {
      return apiFailure(model, endpoint, "Claude에 보낼 문장이 비어 있습니다. 물어볼 내용을 적어 주세요.", "prompt_missing");
    }

    // 네트워크 호출과 응답 해석을 분리한다. 한 try 로 묶으면 서버가 멀쩡히 답한
    // 뒤에 생긴 파싱 오류까지 "인터넷 연결을 확인하세요" 로 안내하게 되고,
    // 사용자는 멀쩡한 방화벽·공유기를 뒤지게 된다.
    let response: FetchLikeResponse;
    try {
      response = await this.fetchImpl(endpoint, {
        method: "POST",
        headers: {
          // Anthropic 은 Authorization Bearer 가 아니라 전용 헤더 두 개를 쓴다.
          "content-type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": anthropicVersion,
        },
        body: JSON.stringify({
          model,
          max_tokens: defaultMaxTokens,
          system: modyAssistantInstructions,
          messages: [
            {
              role: "user",
              content: prompt,
            },
          ],
        }),
      });
    } catch (error) {
      return apiFailure(
        model,
        endpoint,
        describeAnthropicNetworkFailure(error),
        redactAnthropicSecret(error instanceof Error ? error.message : String(error), [apiKey]),
        modelSubstitutionNote,
      );
    }

    // 감싼 fetch 가 응답이 아닌 것을 돌려줘도 던지지 않는다(목록 조회와 같은 이유).
    if (!isFetchLikeResponse(response)) {
      return apiFailure(
        model,
        endpoint,
        "Claude 호출에서 응답을 받지 못했습니다. 잠시 뒤에 다시 시도해 주세요.",
        "unexpected_fetch_response",
        modelSubstitutionNote,
      );
    }

    // 여기서부터 서버는 이미 답했다. 본문이 JSON 이 아니어도, null 이어도,
    // 모양이 낯설어도 던지지 않고 빈 객체로 떨어뜨린다.
    const json = await readAnthropicJson(response);

    if (!response.ok) {
      return apiFailure(
        model,
        endpoint,
        describeAnthropicHttpFailure(response.status, readErrorType(json)),
        redactAnthropicSecret(readErrorMessage(json) || response.statusText, [apiKey]),
        modelSubstitutionNote,
        response.status,
      );
    }

    const stopReason = typeof json.stop_reason === "string" ? json.stop_reason : "";

    // 안전상 거절은 "모델을 바꿔 보세요" 로 안내하면 안 된다 — 바꿔도 같은 답이 나오고
    // 사용자는 멀쩡한 설정을 헤집는다. 실패로 돌려 다음 AI 연결이 이어받게 한다.
    if (stopReason === "refusal") {
      return apiFailure(
        model,
        endpoint,
        "Claude가 이 요청에는 답하지 않기로 했습니다. 모델을 바꿔도 결과는 같습니다. 하려는 일을 한 문장으로 다시 적어 보내 주시면 다른 방법을 찾아보겠습니다.",
        `refusal${readRefusalCategory(json) ? `:${readRefusalCategory(json)}` : ""}`,
      );
    }

    const { text: outputText, truncated: outputTruncated } = extractAnthropicText(json);
    if (!outputText) {
      return apiFailure(
        model,
        endpoint,
        "Claude가 답변 글자를 돌려주지 않았습니다. 같은 질문을 한 번 더 보내 보시고, 계속 같으면 설정에서 다른 Claude 모델을 골라 주세요.",
        "empty_text_response",
      );
    }

    // 잘린 것을 말하지 않으면 사용자는 절반짜리 답을 완성본으로 믿는다.
    // 길이 제한(모델), 프롬프트 절단(우리), 응답 절단(우리) 셋 다 알린다.
    const notes: string[] = [];
    if (promptTruncated) {
      notes.push(
        `보내주신 글이 길어 앞부분 ${maxPromptChars.toLocaleString("ko-KR")}자까지만 전달했습니다. 뒷부분은 반영되지 않았으니 나눠서 한 번 더 보내 주세요.`,
      );
    }
    if (stopReason === "max_tokens") {
      notes.push("길이 제한에서 문장이 끊겼습니다. \"이어서 써줘\"라고 한 번 더 말씀해 주세요.");
    }
    if (outputTruncated) {
      notes.push("답변이 너무 길어 뒷부분을 줄였습니다. 필요하면 나눠서 다시 물어봐 주세요.");
    }

    return {
      status: "generate_content_loaded",
      providerId: "anthropic",
      action: "messages_create",
      model,
      endpoint,
      externalMutation: false,
      appMayPersistSecret: false,
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
      promptChars: prompt.length,
      outputText,
      outputChars: outputText.length,
      tokenUsage: normalizeAIResponseUsage("anthropic", json),
      userMessage: [
        "Claude로 답변을 만들었습니다.",
        ...notes,
        "외부 발송이나 파일 변경은 하지 않았습니다.",
      ].join(" "),
      auditMessages: [
        "Anthropic Messages API POST 호출 완료",
        ...modelSubstitutionNote,
        "API key 원문은 결과, 리포트, 감사 메시지에 반환하지 않습니다.",
        "AI 응답은 채팅 답변이며 외부 발송, 캘린더 등록, 파일 쓰기는 실행하지 않습니다.",
        ...(promptTruncated ? [`사용자 입력이 ${maxPromptChars}자에서 잘려 전송되었습니다.`] : []),
        ...(outputTruncated ? [`응답이 ${maxOutputChars}자에서 잘렸습니다.`] : []),
      ],
    };
  }

  /**
   * 이 계정이 실제로 쓸 수 있는 Claude 모델 목록.
   *
   * 왜 계정에 물어보는가: 고를 수 있는 모델을 코드에 적어 두는 한, Anthropic 이 모델을
   * 더하거나 뺄 때마다 화면과 현실이 어긋난다. 계정에 물으면 그 어긋남이 사라진다.
   *
   * 실패해도 던지지 않는다. 빈 목록과 이유를 돌려주고, 부르는 쪽이
   * modyAnthropicSelectableModels(기본 목록)로 넘어가 화면을 채울 수 있게 한다 —
   * 모델 목록 하나 때문에 앱이 멈추면 안 된다.
   */
  async listModels(input: ModyAnthropicModelListInput = {}): Promise<ModyAnthropicModelListResult> {
    const apiKey = sanitizeAnthropicApiKey(input.apiKey);
    const endpointBase = sanitizeEndpointBase(input.endpointBase);
    const endpoint = `${endpointBase}/models`;

    if (!apiKey) {
      return modelListNeedsCredentials(endpoint, describeMissingApiKey(input.apiKey));
    }

    const models: ModyAnthropicModelInfo[] = [];
    const filteredIds: string[] = [];
    const seen = new Set<string>();
    let cursor = "";
    let pages = 0;
    // 목록이 잘렸는지. 잘렸는데 아무 자국도 안 남기면 "왜 그 모델이 없냐"를 못 푼다.
    let truncated: "" | "cursor_missing" | "page_limit" = "";

    // 목록은 페이지로 나뉜다. 첫 장만 읽으면 계정이 실제로 쓸 수 있는 모델이 빠진 채
    // 화면에 뜨고, 사용자는 "왜 그 모델이 없냐"를 겪는다.
    while (pages < maxModelListPages) {
      pages += 1;
      const pageUrl = cursor
        ? `${endpoint}?limit=${modelListPageSize}&after_id=${encodeURIComponent(cursor)}`
        : `${endpoint}?limit=${modelListPageSize}`;

      // 네트워크 호출과 응답 해석을 분리한다 — generateContent 와 같은 이유다.
      // 한 try 로 묶으면 서버가 답한 뒤에 생긴 파싱 오류까지 "인터넷 연결을 확인하세요"
      // 로 안내하게 되고, 사용자는 멀쩡한 방화벽을 뒤진다.
      let response: FetchLikeResponse;
      try {
        response = await this.fetchImpl(pageUrl, {
          method: "GET",
          headers: {
            // generateContent 와 같은 인증 헤더다. Authorization Bearer 가 아니다.
            accept: "application/json",
            "x-api-key": apiKey,
            "anthropic-version": anthropicVersion,
          },
        });
      } catch (error) {
        return modelListFailure(
          endpoint,
          describeAnthropicNetworkFailure(error),
          redactAnthropicSecret(error instanceof Error ? error.message : String(error), [apiKey]),
        );
      }

      // 데스크톱 쪽에서 fetch 를 감싸 넘기므로, 감싼 것이 응답을 안 돌려줄 수 있다.
      // 여기서 던지면 모델 목록 하나 때문에 화면이 무너진다 — 목록 조회는 절대 던지지 않는다.
      if (!isFetchLikeResponse(response)) {
        return modelListFailure(
          endpoint,
          "Claude 모델 목록을 불러오지 못했습니다. 앱을 껐다 켜신 뒤에도 같으면 기본 모델 목록에서 골라 쓰셔도 됩니다.",
          "unexpected_fetch_response",
        );
      }

      const json = await readAnthropicJson<AnthropicModelsListResponse>(response);

      if (!response.ok) {
        return modelListFailure(
          endpoint,
          describeAnthropicModelListFailure(response.status, readErrorType(json)),
          redactAnthropicSecret(readErrorMessage(json) || response.statusText, [apiKey]),
        );
      }

      const entries = Array.isArray(json.data) ? json.data : null;
      if (!entries) {
        // 200 인데 data 배열이 없다 — 사내 프록시가 응답을 바꿔치기했거나 규격이 바뀐 것이다.
        // 빈 목록으로 조용히 넘기면 사용자는 "내 계정에 모델이 없다"로 잘못 읽는다.
        return modelListFailure(
          endpoint,
          "Claude 모델 목록의 형태를 알아보지 못했습니다. 회사망의 보안 프로그램이 응답을 바꿔치기했을 수 있으니 다른 네트워크에서 한 번 시도해 보세요. 그동안에는 기본 모델 목록에서 골라 쓰셔도 됩니다.",
          "unexpected_models_response",
        );
      }

      for (const entry of entries) {
        const id = sanitizeListedModelId(entry?.id);
        if (!id || seen.has(id)) continue;
        seen.add(id);
        if (looksNonChatModel(id, entry?.capabilities)) {
          filteredIds.push(id);
          continue;
        }
        // 계정이 이 id 를 쓸 수 있다고 말했다 — 호출 쪽이 옛 id 표로 덧씌우지 않게 기억한다.
        rememberAccountModelId(id);
        models.push(toAnthropicModelInfo(id, entry));
      }

      const nextCursor = sanitizeModelListCursor(json.last_id);
      // has_more 만 믿고 돌면, 커서를 안 주는 서버에서 같은 장을 계속 다시 읽는다.
      if (json.has_more !== true) break;
      if (!nextCursor || nextCursor === cursor) {
        // 서버는 "더 있다"고 했는데 다음 장으로 갈 커서를 안 줬다(또는 제자리다).
        // 여기서 그냥 멈추면 목록이 잘린 채 "다 불러왔다"로 보인다.
        truncated = "cursor_missing";
        break;
      }
      cursor = nextCursor;
      if (pages >= maxModelListPages) truncated = "page_limit";
    }

    const auditMessages = [
      `Anthropic Models API GET 조회 완료 (${pages}장)`,
      "API key 원문은 결과, 리포트, 감사 메시지에 반환하지 않습니다.",
      "모델 목록만 읽었고 외부 발송, 파일 변경, 설정 저장은 실행하지 않았습니다.",
      ...(filteredIds.length > 0
        ? [`대화에 쓸 수 없는 모델 ${filteredIds.length}개를 목록에서 제외했습니다: ${filteredIds.slice(0, 8).join(", ")}`]
        : []),
      ...(truncated === "cursor_missing"
        ? ["서버가 다음 장이 더 있다고 했지만 이어 읽을 커서를 주지 않아 목록이 잘렸을 수 있습니다."]
        : []),
      ...(truncated === "page_limit"
        ? [`목록이 ${maxModelListPages}장 상한에서 멈춰 뒷부분이 빠졌을 수 있습니다.`]
        : []),
    ];

    if (models.length === 0) {
      // 키는 통했는데 고를 것이 없다. 이걸 "실패"라고 말하면 사용자는 멀쩡한 키를 지우고
      // 새로 만든다. 해야 할 일(결제 수단·권한 확인)을 대신 알려 준다.
      return {
        status: "needs_model_access",
        ...anthropicListSafetyFlags,
        action: "list_models",
        endpoint,
        models: [],
        recommendedModel: "",
        userMessage:
          "이 Claude 키로는 쓸 수 있는 대화용 모델이 없습니다. 키 자체는 확인됐으니 다시 만들 필요는 없고, Anthropic 콘솔(console.anthropic.com)에서 결제 수단이 등록돼 있는지와 이 키에 모델 사용 권한이 있는지 확인해 주세요.",
        auditMessages,
      };
    }

    // 기본 모델을 이 계정이 쓸 수 있으면 그대로 둔다 — 설정을 건드린 적 없는 사용자의
    // 답변 품질이 "목록을 한 번 불러왔다"는 이유로 바뀌면 안 된다. 없을 때만 목록 첫
    // 줄로 내려간다(Anthropic 은 최신 모델을 앞에 준다).
    const recommendedModel = models.some((model) => model.id === defaultModel)
      ? defaultModel
      : (models[0]?.id ?? "");

    return {
      status: "models_loaded",
      ...anthropicListSafetyFlags,
      action: "list_models",
      endpoint,
      models,
      recommendedModel,
      userMessage: `Claude 계정에서 쓸 수 있는 모델 ${models.length}개를 찾았습니다. 이 중에서 고르면 바로 쓸 수 있습니다.`,
      auditMessages,
    };
  }
}

/**
 * 연결 없이 한 번 부르는 짧은 호출부 — 화면에서 "모델 목록 새로고침"을 누를 때 쓴다.
 * local-model-live.ts 의 listLocalModels 와 같은 결이다.
 */
export async function listAnthropicModels(
  input: {
    apiKey?: string;
    endpointBase?: string;
    fetch?: FetchLike;
  } = {},
): Promise<ModyAnthropicModelListResult> {
  const connectorOptions: { fetch?: FetchLike } = {};
  if (input.fetch) connectorOptions.fetch = input.fetch;

  const connector = new ModyAnthropicLiveConnector(connectorOptions);
  const listInput: ModyAnthropicModelListInput = {};
  if (typeof input.apiKey === "string") listInput.apiKey = input.apiKey;
  if (typeof input.endpointBase === "string") listInput.endpointBase = input.endpointBase;
  return connector.listModels(listInput);
}

const anthropicListSafetyFlags = {
  providerId: "anthropic",
  externalMutation: false,
  appMayPersistSecret: false,
  rawSecretMaterialStored: false,
  rawSecretMaterialReturned: false,
} as const;

function modelListNeedsCredentials(endpoint: string, userMessage: string): ModyAnthropicModelListResult {
  return {
    status: "needs_credentials",
    ...anthropicListSafetyFlags,
    action: "list_models",
    endpoint,
    models: [],
    recommendedModel: "",
    userMessage,
    auditMessages: [
      "Anthropic 모델 목록 조회에는 사용자 API key 가 필요합니다. 호출하지 않았습니다.",
      "API key 원문은 앱 결과에 반환하지 않습니다.",
    ],
  };
}

function modelListFailure(
  endpoint: string,
  userMessage: string,
  errorMessage: string,
): ModyAnthropicModelListResult {
  return {
    status: "anthropic_api_failed",
    ...anthropicListSafetyFlags,
    action: "list_models",
    endpoint,
    models: [],
    recommendedModel: "",
    userMessage,
    errorMessage,
    auditMessages: [
      "Anthropic 모델 목록 조회가 실패했습니다. 어떤 변경도 일어나지 않았습니다.",
      "오류 메시지는 API key-like 문자열을 마스킹한 뒤 반환합니다.",
    ],
  };
}

/**
 * 목록 조회 실패 안내. 401·403·429·5xx 는 generateContent 와 원인도 해결 방법도 같아
 * describeAnthropicHttpFailure 를 그대로 재사용한다 — 같은 401 에 서로 다른 안내가
 * 뜨면 사용자는 두 문구를 비교하다 멀쩡한 키를 지운다.
 *
 * 404 만 갈라 쓴다. 이 호출의 주소는 sanitizeEndpointBase 가 고정하므로 여기서의 404 는
 * "고른 모델이 없다"가 아니라 "그 주소에 목록이 없다"는 뜻이고, 모델을 바꾸라는 안내는
 * 사용자를 엉뚱한 화면으로 보낸다.
 */
function describeAnthropicModelListFailure(httpStatus: number, errorType?: string): string {
  if (httpStatus === 404 || errorType === "not_found_error") {
    return "Claude 모델 목록 주소에 닿지 못했습니다. 회사망이라면 api.anthropic.com 이 막혀 있을 수 있습니다. 그동안에는 기본 모델 목록에서 골라 쓰셔도 됩니다.";
  }
  return `${describeAnthropicHttpFailure(httpStatus, errorType)} 목록을 못 불러와도 기본 모델 목록에서 골라 쓰실 수 있습니다.`;
}

function needsCredentials(model: string, endpoint: string, userMessage: string): ModyAnthropicLiveResult {
  return {
    status: "needs_credentials",
    providerId: "anthropic",
    action: "messages_create",
    model,
    endpoint,
    externalMutation: false,
    appMayPersistSecret: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
    userMessage,
    auditMessages: [
      "Anthropic live connector needs user-provided API key or OS secure credential reference",
      "API key 원문은 앱 결과에 반환하지 않습니다.",
    ],
  };
}

function apiFailure(
  model: string,
  endpoint: string,
  userMessage: string,
  errorMessage: string,
  extraAuditMessages: string[] = [],
  httpStatus?: number,
): ModyAnthropicLiveResult {
  return {
    status: "anthropic_api_failed",
    providerId: "anthropic",
    action: "messages_create",
    model,
    endpoint,
    externalMutation: false,
    appMayPersistSecret: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
    userMessage,
    errorMessage,
    ...(httpStatus === undefined ? {} : { httpStatus }),
    auditMessages: [
      "Anthropic API live call failed before any mutation",
      ...extraAuditMessages,
      "오류 메시지는 API key-like 문자열을 마스킹한 뒤 반환합니다.",
    ],
  };
}

/**
 * 실패마다 사용자가 할 일이 다르다. 키를 고쳐야 하는지, 기다리면 되는지,
 * 모델을 바꿔야 하는지를 문구로 구분해 준다 — 같은 "실패했습니다"만 보이면
 * 사용자는 멀쩡한 키를 지우고 다시 발급받는다.
 */
function describeAnthropicHttpFailure(httpStatus: number, errorType?: string): string {
  if (errorType === "overloaded_error" || httpStatus === 529) {
    return "지금 Claude 서버에 요청이 몰려 있습니다. 키 설정은 그대로 두시고 1분쯤 뒤에 같은 요청을 다시 보내 주세요.";
  }
  if (errorType === "billing_error") {
    return "Anthropic 계정의 크레딧이나 결제 수단에 문제가 있습니다. 키는 그대로 두시고 Anthropic 콘솔의 결제(Billing) 화면에서 잔액을 확인해 주세요.";
  }
  if (httpStatus === 401) {
    return "Claude API 키가 확인되지 않았습니다. 설정의 AI 연결에서 키를 다시 확인해 주세요. 키 앞뒤에 공백이 붙었거나 예전 키일 수 있습니다.";
  }
  if (httpStatus === 403) {
    return "이 Claude 키로는 요청이 허용되지 않았습니다. Anthropic 콘솔에서 키가 살아 있는지, 사용 권한이 있는지 확인해 주세요.";
  }
  if (httpStatus === 404 || errorType === "not_found_error") {
    return "고른 Claude 모델을 찾지 못했습니다. 설정의 AI 연결에서 다른 Claude 모델을 골라 주세요.";
  }
  if (httpStatus === 429) {
    return "Claude 사용량 한도에 걸렸습니다. 1~2분 뒤에 다시 시도해 주세요. 계속 막히면 Anthropic 콘솔에서 남은 사용량과 결제 상태를 확인해 주세요.";
  }
  if (httpStatus === 400) {
    // Fable 5 는 30일 데이터 보관이 필요해, 보관을 끈 조직에서는 글 길이와 무관하게
    // 400 이 돌아온다. 길이만 탓하면 사용자가 글을 계속 줄이며 헛수고를 한다.
    return "Claude가 요청을 받아들이지 못했습니다. 보낸 글이 너무 길 수 있으니 줄이거나 나눠서 보내 주세요. 그래도 같으면 다른 Claude 모델로 바꿔 보세요 — Fable 5 는 조직 설정에 따라 쓸 수 없는 경우가 있습니다.";
  }
  if (httpStatus === 413) {
    return "보낸 글이 한 번에 처리하기에 너무 깁니다. 절반쯤으로 나눠서 다시 보내 주세요.";
  }
  if (httpStatus >= 500) {
    return "Claude 쪽에서 일시적인 오류가 났습니다. 잠시 뒤에 같은 요청을 다시 보내 주세요.";
  }
  return "Claude 호출에 실패했습니다. 인터넷 연결과 설정의 AI 연결 키를 확인한 뒤 다시 시도해 주세요.";
}

/**
 * 네트워크 예외는 원인이 둘로 갈린다. 끊긴 것(기다렸다 재시도)과 못 닿는 것
 * (연결·방화벽 확인)을 구분해 줘야 사용자가 엉뚱한 곳을 고치지 않는다.
 */
function describeAnthropicNetworkFailure(error: unknown): string {
  const signature = error instanceof Error
    ? `${error.name} ${error.message}`
    : String(error);
  if (/abort|timeout|timed out|ETIMEDOUT|ESOCKETTIMEDOUT/i.test(signature)) {
    return "Claude 응답을 기다리다 시간이 초과됐습니다. 인터넷이 느리거나 글이 길면 생길 수 있으니, 내용을 조금 줄여 다시 보내 주세요.";
  }
  return "Claude 서버에 연결하지 못했습니다. 인터넷 연결을 확인하고 다시 시도해 주세요. 회사망이라면 방화벽이 api.anthropic.com 을 막고 있을 수 있습니다.";
}

/**
 * 응답 본문을 절대 던지지 않고 읽는다. JSON 이 아니거나(점검 페이지, 프록시 HTML),
 * 본문이 null 이거나, json() 자체가 없어도 빈 객체로 떨어뜨린다 — 여기서 던지면
 * 바깥에서 네트워크 오류로 오인해 엉뚱한 안내가 나간다.
 */
function isFetchLikeResponse(value: unknown): value is FetchLikeResponse {
  return typeof value === "object" && value !== null;
}

async function readAnthropicJson<T extends object = AnthropicMessagesResponse>(
  response: FetchLikeResponse,
): Promise<T> {
  try {
    const parsed = await Promise.resolve(response.json()).catch(() => null);
    return parsed && typeof parsed === "object" ? (parsed as T) : ({} as T);
  } catch {
    return {} as T;
  }
}

function readErrorMessage(json: AnthropicErrorEnvelope): string {
  const message = json.error?.message;
  if (typeof message === "string") return message;
  // 문자열이 아니면 그대로 넘기지 않는다. 마스킹 함수가 문자열을 가정하기 때문이다.
  return message === undefined || message === null ? "" : safeStringify(message);
}

function readErrorType(json: AnthropicErrorEnvelope): string | undefined {
  return typeof json.error?.type === "string" ? json.error.type : undefined;
}

function readRefusalCategory(json: AnthropicMessagesResponse): string {
  const category = json.stop_details?.category;
  return typeof category === "string" ? category : "";
}

/**
 * content 는 블록 배열이고 tool_use·thinking 같은 비-텍스트 블록이 섞일 수 있어
 * type === "text" 인 블록만 이어 붙인다. 배열이 아니면 빈 문자열로 떨어뜨린다.
 */
function extractAnthropicText(response: AnthropicMessagesResponse): { text: string; truncated: boolean } {
  const blocks = Array.isArray(response.content) ? response.content : [];
  const joined = blocks
    .map((block) => (block?.type === "text" && typeof block.text === "string" ? block.text : ""))
    .filter(Boolean)
    .join("\n")
    .trim();
  return { text: joined.slice(0, maxOutputChars), truncated: joined.length > maxOutputChars };
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

/**
 * 키가 아예 없는 것과, 붙여 넣다 망가진 것은 사용자가 할 일이 다르다.
 * 망가진 키에 "새로 만드세요" 라고 하면 멀쩡한 키를 버리고 다시 발급받는다.
 */
function describeMissingApiKey(value: unknown): string {
  const raw = typeof value === "string" ? value.trim() : "";
  if (raw.length === 0) {
    return "Claude API 키가 필요합니다. Anthropic 콘솔(console.anthropic.com)에서 키를 만들어 설정의 AI 연결에 붙여 넣어 주세요.";
  }
  return "붙여 넣은 Claude API 키의 형태가 이상합니다. 줄바꿈이 섞였거나 일부만 복사된 것 같습니다. 키를 새로 만들 필요는 없고, 설정의 AI 연결에서 키 전체를 다시 복사해 붙여 넣어 주세요.";
}

function sanitizeAnthropicApiKey(value: unknown): string {
  const key = typeof value === "string" ? value.trim() : "";
  return key.length >= 20 && key.length <= 4096 && !/[\r\n]/.test(key) ? key : "";
}

/**
 * 이미 저장돼 있던 옛 모델 id 를 지금 살아 있는 id 로 올려 준다.
 * 날짜 꼬리표가 붙은 id 는 404 가 나므로, 저장된 연결이 조용히 죽는 대신
 * 최신 id 로 이어지게 한다("항상 최신" 정책).
 */
const legacyAnthropicModelAliases: Record<string, string> = {
  "claude-haiku-4-5-20251001": "claude-haiku-4-5",
};

/**
 * 계정이 "지금 쓸 수 있다"고 말해 준 모델 id. listModels() 가 채운다.
 *
 * 왜 필요한가: 위 표는 "이 id 는 죽었다"는 **추측**이다. 그런데 listModels 가 계정에
 * 직접 물어 같은 id 를 받아 왔다면, 그 id 가 살아 있다는 **증거**가 생긴 것이다.
 * 증거가 추측을 이겨야 한다 — 안 그러면 사용자가 목록에서 고른 id 와 실제로 답한
 * 모델이 달라지고, 화면은 고른 이름을 그대로 보여 주므로 아무도 눈치채지 못한다.
 * (sanitizeListedModelId 가 목록 쪽에서 이미 같은 이유로 표를 안 쓴다. 그 판단이
 *  호출 쪽에서 뒤집히면 반쪽짜리가 된다.)
 *
 * 이 집합은 덧씌우기를 **끄기만** 한다. 없던 모델을 살려 내지는 않으므로,
 * 비어 있어도(=목록을 한 번도 안 불렀어도) 지금까지의 동작 그대로다.
 */
const accountConfirmedModelIds = new Set<string>();
const maxAccountConfirmedModelIds = 500;

function rememberAccountModelId(id: string): void {
  if (accountConfirmedModelIds.size >= maxAccountConfirmedModelIds) return;
  accountConfirmedModelIds.add(id);
}

/**
 * generateContent 가 받아 주는 모델 id 모양. 목록 쪽도 이 규칙으로 거른다 —
 * 여기를 통과 못 하는 id 를 목록에 실으면, 사용자가 그것을 골랐을 때
 * sanitizeAnthropicModel 이 조용히 기본 모델로 바꿔 버린다. 고른 것과 실제로 답한
 * 모델이 달라지는 것이 가장 나쁘다.
 */
const anthropicModelIdPattern = /^[A-Za-z0-9_.:-]{2,120}$/;

function sanitizeAnthropicModel(value: unknown): string {
  const model = typeof value === "string" ? value.trim() : "";
  if (!anthropicModelIdPattern.test(model)) return defaultModel;
  // 계정이 쓸 수 있다고 말해 준 id 는 그대로 보낸다(위 집합 주석 참고).
  if (accountConfirmedModelIds.has(model)) return model;
  return legacyAnthropicModelAliases[model] ?? model;
}

function sanitizeEndpointBase(value: unknown): string {
  const endpoint = typeof value === "string" ? value.trim().replace(/\/+$/, "") : "";
  if (/^https:\/\/api\.anthropic\.com\/v1$/.test(endpoint)) {
    return endpoint;
  }
  return defaultEndpointBase;
}

/** 잘랐는지까지 돌려준다. 조용히 자르면 사용자는 반쪽 답을 완성본으로 믿는다. */
function sanitizePrompt(value: unknown): { prompt: string; truncated: boolean } {
  const prompt = typeof value === "string" ? value.trim() : "";
  const normalized = prompt
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n");
  return {
    prompt: normalized.slice(0, maxPromptChars),
    truncated: normalized.length > maxPromptChars,
  };
}

function sanitizeListedModelId(value: unknown): string {
  const id = typeof value === "string" ? value.trim() : "";
  // 목록에 온 id 는 alias 로 바꾸지 않는다. 계정이 지금 쓸 수 있다고 말해 준 id 가
  // 가장 정확한 값이라, 우리 표를 덧씌우면 손으로 적어 둔 목록으로 되돌아가는 셈이 된다.
  return anthropicModelIdPattern.test(id) ? id : "";
}

/** 커서는 그대로 URL 에 붙으므로 길이와 타입을 확인한 뒤에만 쓴다. */
function sanitizeModelListCursor(value: unknown): string {
  const cursor = typeof value === "string" ? value.trim() : "";
  return cursor.length > 0 && cursor.length <= 200 ? cursor : "";
}

function toAnthropicModelInfo(id: string, entry: AnthropicModelListEntry | undefined): ModyAnthropicModelInfo {
  // 사람이 읽을 이름은 API 가 준 display_name 을 쓰고, 없으면 id 로 떨어진다.
  // 줄바꿈이 섞여 오면 목록 한 줄이 무너지므로 공백 하나로 눌러 둔다.
  const displayName = typeof entry?.display_name === "string" ? entry.display_name.replace(/\s+/g, " ").trim() : "";
  const info: ModyAnthropicModelInfo = {
    id,
    label: displayName.length > 0 ? displayName.slice(0, 120) : id,
  };
  const contextWindowTokens = readPositiveInteger(entry?.max_input_tokens);
  if (contextWindowTokens !== undefined) info.contextWindowTokens = contextWindowTokens;
  const maxOutputTokens = readPositiveInteger(entry?.max_tokens);
  if (maxOutputTokens !== undefined) info.maxOutputTokens = maxOutputTokens;
  const createdAt = typeof entry?.created_at === "string" ? entry.created_at.trim() : "";
  if (createdAt.length > 0 && createdAt.length <= 64) info.createdAt = createdAt;
  return info;
}

function readPositiveInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && Number.isInteger(value) && value > 0
    ? value
    : undefined;
}

/*
 * 채팅에 쓸 수 없는 모델을 목록에서 뺀다. 임베딩·재순위·음성 모델이 섞여 있으면
 * 사용자는 그걸 골라 놓고 오류만 보게 된다.
 *
 * 거르는 규칙은 하나뿐이다: **못 쓴다는 증거가 있을 때만 뺀다.** 증거가 없으면 통과시킨다.
 * 반대로 하면(모르는 것은 숨긴다) Anthropic 이 새 모델을 낼 때마다 이 목록이 다시
 * 손으로 적어 둔 목록처럼 뒤처진다 — 그걸 없애려고 만든 함수라 자기모순이 된다.
 *
 * 증거는 둘이다.
 *  1) 이름: embedding·rerank·TTS/음성·이미지 생성·moderation 은 Messages API 로 대화를
 *     시킬 수 없다. 지금 Anthropic 이 그런 모델을 이 목록에 내지는 않지만, 늘어났을 때
 *     사용자가 먼저 부딪히는 것을 막는 방어선이다.
 *  2) capabilities: 응답이 능력을 밝혔는데 글을 만드는 능력이 하나도 없고 임베딩 같은
 *     다른 용도만 있으면 뺀다. 능력을 안 밝혔으면(빈 목록) 판단하지 않고 통과시킨다.
 */
const nonChatModelIdPattern =
  /(^|[-_.])(embed|embedding|embeddings|rerank|reranker|reranking|tts|stt|speech|voice|whisper|moderation)([-_.]|$)|image-gen|imagegen/i;

const chatCapabilityTokens = new Set([
  "text",
  "text_output",
  "text-output",
  "chat",
  "messages",
  "completion",
  "completions",
  "conversation",
  "vision",
  "tool_use",
  "tools",
  "thinking",
]);

const nonChatCapabilityTokens = new Set([
  "embed",
  "embedding",
  "embeddings",
  "rerank",
  "reranking",
  "tts",
  "text_to_speech",
  "speech",
  "speech_to_text",
  "audio_output",
  "image_generation",
  "image_output",
  "moderation",
]);

function looksNonChatModel(id: string, capabilities: unknown): boolean {
  if (nonChatModelIdPattern.test(id)) return true;
  // 응답이 "무엇을 내놓는지"를 밝혔으면 그것만 본다.
  //
  // 입력까지 같이 세면 필터가 통째로 꺼진다: 임베딩 모델도 글을 **입력으로** 받으므로
  // { input: ["text"], output: ["embedding"] } 에는 "text" 가 늘 들어 있고, 그 한 낱말이
                                                      
  // 오류만 본다. 대화에 쓸 수 있느냐를 정하는 것은 입력이 아니라 출력이다.
  const outputTokens = readCapabilityTokens(readOutputCapabilityNode(capabilities));
  const tokens = outputTokens.length > 0 ? outputTokens : readCapabilityTokens(capabilities);
  if (tokens.length === 0) return false;
  if (tokens.some((token) => chatCapabilityTokens.has(token))) return false;
  return tokens.some((token) => nonChatCapabilityTokens.has(token));
}

/**
 * capabilities 안에서 "출력" 자리를 찾는다. { output: [...] } 로 바로 오기도 하고
 * { modalities: { input: [...], output: [...] } } 처럼 한 겹 싸여 오기도 해서 몇 겹만
 * 들여다본다. 못 찾으면 undefined 를 돌려 예전처럼 전체를 훑게 둔다 — 못 찾았다고
 * 모델을 빼면 "증거가 없으면 빼지 않는다" 규칙이 깨진다.
 */
const outputCapabilityKeys = new Set(["output", "outputs", "output_modalities", "output_modality"]);

function readOutputCapabilityNode(value: unknown, depth = 0): unknown {
  if (depth > 3 || value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (outputCapabilityKeys.has(key.trim().toLowerCase())) return child;
  }
  for (const child of Object.values(value as Record<string, unknown>)) {
    const found = readOutputCapabilityNode(child, depth + 1);
    if (found !== undefined) return found;
  }
  return undefined;
}

/**
 * capabilities 가 어떤 모양으로 와도 낱말만 뽑아낸다. 실제로 본 모양이 셋이라
 * (문자열 배열, 켜짐/꺼짐 객체, input/output 으로 묶인 객체) 하나만 가정하면
 * 나머지 둘에서 "능력을 안 밝혔다"로 읽혀 필터가 통째로 꺼진다.
 */
function readCapabilityTokens(value: unknown): string[] {
  const tokens: string[] = [];
  const push = (raw: unknown) => {
    if (typeof raw !== "string") return;
    const token = raw.trim().toLowerCase();
    if (token) tokens.push(token);
  };
  const visit = (node: unknown, depth: number) => {
    if (depth > 3 || node === null || node === undefined) return;
    if (typeof node === "string") {
      push(node);
      return;
    }
    if (Array.isArray(node)) {
      for (const item of node) visit(item, depth + 1);
      return;
    }
    if (typeof node === "object") {
      for (const [key, child] of Object.entries(node as Record<string, unknown>)) {
        // { text: true, embeddings: false } 처럼 켜짐/꺼짐으로 오는 모양.
        // 꺼진 능력을 낱말로 세면 "글을 못 만든다"를 "만든다"로 잘못 읽는다.
        if (typeof child === "boolean") {
          if (child) push(key);
          continue;
        }
        // { input: ["text","image"], output: ["text"] } 처럼 묶여 오는 모양.
        visit(child, depth + 1);
      }
    }
  };
  visit(value, 0);
  return tokens;
}

export function redactAnthropicSecret(value: unknown, knownSecrets: Array<string | undefined> = []): string {
  // 문자열이 아닌 값이 들어와도 던지지 않는다. 여기서 던지면 그 예외가 바깥
  // catch 로 흘러가 "인터넷 연결을 확인하세요" 같은 엉뚱한 안내가 나간다.
  let redacted = typeof value === "string" ? value : safeStringify(value);
  for (const secret of knownSecrets) {
    const token = typeof secret === "string" ? secret.trim() : "";
    if (token.length > 0) {
      redacted = redacted.split(token).join("[anthropic-api-key-redacted]");
    }
  }
  return redacted
    .replace(/\bsk-ant-[A-Za-z0-9_-]{10,}\b/g, "[anthropic-api-key-redacted]")
    .replace(/x-api-key:\s*[^\s,;]+/gi, "x-api-key: [anthropic-api-key-redacted]");
}
