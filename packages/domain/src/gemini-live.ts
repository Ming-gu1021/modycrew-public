import { normalizeAIResponseUsage, type AIResponseUsage } from "./ai-usage.js";

export type ModyGeminiLiveStatus =
  | "needs_credentials"
  | "generate_content_loaded"
  | "gemini_api_failed";

export type ModyGeminiLiveAction = "generate_content";

export type ModyGeminiLiveInput = {
  apiKey?: string;
  prompt?: string;
  model?: string;
  endpointBase?: string;
};

export type ModyGeminiLiveResult = {
  tokenUsage?: AIResponseUsage;
  status: ModyGeminiLiveStatus;
  providerId: "google_gemini";
  action: ModyGeminiLiveAction;
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

/**
 * 모델 목록 조회 상태. 로컬 모델 어댑터(local-model-live.ts)의
 * ModyLocalModelListStatus 와 같은 규칙을 쓴다 — 화면이 두 결과를 같은 코드로
 * 다뤄야 하므로, 여기서 이름이 어긋나면 목록 줄이 제공자마다 갈라진다.
 */
export type ModyGeminiModelListStatus =
  | "needs_credentials"
  | "models_loaded"
  | "needs_model_access"
  | "gemini_api_failed";

export type ModyGeminiModelInfo = {
  /** 호출할 때 그대로 쓰는 id — `models/` 접두사를 뗀 형태 (예: gemini-2.5-flash) */
  id: string;
  /** 목록에 보여 줄 이름 — API 가 준 displayName, 없으면 id */
  label: string;
  description?: string;
  inputTokenLimit?: number;
  outputTokenLimit?: number;
};

export type ModyGeminiModelListResult = {
  status: ModyGeminiModelListStatus;
  providerId: "google_gemini";
  action: "list_models";
  endpoint: string;
  models: ModyGeminiModelInfo[];
  /** 자동 선택이 고른 모델. 없으면 빈 문자열. */
  recommendedModel: string;
  /** 채팅에 쓸 수 없어 뺀 모델 수 — 화면이 "왜 목록이 짧은가"를 설명할 때 쓴다 */
  filteredOutCount: number;
  /** 몇 장을 이어 받았는지. 페이지를 놓치면 목록이 조용히 잘리므로 남긴다. */
  pagesFetched: number;
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

// 모델 목록은 GET 이라 method/body 를 넓혔다. generateContent 는 그대로 POST + body 를 보낸다.
type FetchLikeInit = {
  method: "GET" | "POST";
  headers: Record<string, string>;
  body?: string;
};

type FetchLike = (url: string, init: FetchLikeInit) => Promise<FetchLikeResponse>;

type GeminiGenerateContentResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
      }>;
    };
  }>;
  error?: {
    message?: string;
    status?: string;
  };
};

type GeminiModelsListResponse = {
  models?: Array<{
    /** `models/gemini-2.5-flash` 처럼 접두사가 붙어 온다 */
    name?: string;
    displayName?: string;
    description?: string;
    inputTokenLimit?: number;
    outputTokenLimit?: number;
    supportedGenerationMethods?: string[];
  }>;
  nextPageToken?: string;
  error?: {
    message?: string;
    status?: string;
  };
};

const defaultModel = "gemini-2.5-flash";
/** 한 번에 받아 오는 수. Gemini ListModels 는 안 주면 50개만 준다. */
const modelListPageSize = 200;
/**
 * 페이지를 도는 횟수 상한. 서버가 같은 nextPageToken 을 계속 주면 무한 루프가 되고,
 * 그러면 목록 한 번 누른 사용자의 화면이 영원히 돌아간다.
 */
const modelListMaxPages = 10;
const defaultEndpointBase = "https://generativelanguage.googleapis.com/v1beta/models";
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

export class ModyGeminiLiveConnector {
  private readonly fetchImpl: FetchLike;

  constructor(options: { fetch?: FetchLike } = {}) {
    const fetchImpl = options.fetch ?? (globalThis as unknown as { fetch?: FetchLike }).fetch;
    if (!fetchImpl) {
      throw new Error("fetch runtime is required for Gemini live connector");
    }
    this.fetchImpl = fetchImpl;
  }

  /**
   * 이 API key 로 실제로 쓸 수 있는 모델 목록.
   *
   * 왜 물어보는가: 고를 수 있는 모델을 사람이 손으로 적어 두면 반드시 어긋난다.
   * 실제로 `claude-haiku-4-5-20251001` 같은 죽은 id 가 목록에 남아 고르면 404 가
   * 나던 사고가 있었다. 계정에 직접 물어보면 그 종류의 사고가 사라진다.
   *
   * 왜 key 를 URL 이 아니라 헤더로 보내는가: Google 문서는 `?key=` 도 받지만,
   * 그러면 키가 URL 에 실려 프록시·서버 접근 로그·오류 리포트에 그대로 남는다.
   * 같은 파일의 generateContent 와 똑같이 `x-goog-api-key` 헤더만 쓴다.
   */
  async listModels(input: { apiKey?: string; endpointBase?: string } = {}): Promise<ModyGeminiModelListResult> {
    const apiKey = sanitizeGeminiApiKey(input.apiKey);
    const endpoint = sanitizeEndpointBase(input.endpointBase);

    if (!apiKey) {
      return listNeedsCredentials(endpoint);
    }

    const collected: ModyGeminiModelInfo[] = [];
    const seen = new Set<string>();
    const seenRawNames = new Set<string>();
    let filteredOutCount = 0;
    let pagesFetched = 0;
    let pageToken = "";
    let truncatedByPageCap = false;

    for (let page = 0; page < modelListMaxPages; page += 1) {
      const url = buildModelListUrl(endpoint, pageToken);
      let json: GeminiModelsListResponse;
      let response: FetchLikeResponse;

      try {
        response = await this.fetchImpl(url, {
          method: "GET",
          headers: {
            Accept: "application/json",
            "x-goog-api-key": apiKey,
          },
        });
        // 여기부터 아래 응답 해석은 try 밖이다. json 이 객체가 아니면 (본문이 리터럴
        // null 이거나 json() 이 undefined 를 주는 프록시) json.error / json.models 접근에서
        // TypeError 가 나고, 그 예외는 listModels 를 통째로 reject 시켜 화면을 무너뜨린다.
        // 그래서 여기서 반드시 객체로 만들어 둔다.
        json = asModelsListJson(await response.json().catch(() => ({})));
      } catch (error) {
        // 첫 장에서 끊기면 목록이 아예 없고, 중간에 끊기면 반쪽짜리 목록이 된다.
        // 반쪽을 "이게 전부"라고 내놓으면 사용자는 쓸 수 있는 모델을 못 보게 되므로
        // 둘 다 실패로 돌려준다(부르는 쪽이 손으로 적어 둔 기본 목록으로 넘어간다).
        return listFailure(
          endpoint,
          "Gemini 모델 목록을 가져오지 못했습니다. 인터넷 연결을 확인한 뒤 다시 눌러 주세요.",
          redactGeminiSecret(error instanceof Error ? error.message : String(error), [apiKey]),
          pagesFetched,
        );
      }

      if (!response.ok) {
        return listFailure(
          endpoint,
          modelListHttpMessage(response.status),
          redactGeminiSecret(json.error?.message ?? response.statusText, [apiKey]),
          pagesFetched,
        );
      }

      if (!Array.isArray(json.models)) {
        // 주소는 살아 있는데 Gemini 규격이 아닌 응답이다(프록시·차단 페이지 등).
        return listFailure(
          endpoint,
          "Gemini 모델 목록 응답을 읽지 못했습니다. 회사 네트워크나 보안 프로그램이 막고 있는지 확인한 뒤 다시 눌러 주세요.",
          "unexpected_models_response",
          pagesFetched,
        );
      }

      pagesFetched += 1;

      for (const entry of json.models) {
        const rawName = typeof entry?.name === "string" ? entry.name.trim() : "";
        const id = stripGeminiModelPrefix(entry?.name);
        if (!id) {
          // 우리가 호출에 쓸 수 없는 모양의 이름. 조용히 버리면 목록만 짧아지고
          // filteredOutCount 는 0이라 화면이 "왜 짧은지"를 설명할 수 없다.
          if (rawName && !seenRawNames.has(rawName)) {
            seenRawNames.add(rawName);
            filteredOutCount += 1;
          }
          continue;
        }
        if (seen.has(id)) continue;
        seen.add(id);
        if (!isChatCapableGeminiModel(id, entry?.supportedGenerationMethods)) {
          filteredOutCount += 1;
          continue;
        }
        collected.push(toGeminiModelInfo(id, entry));
      }

      const nextPageToken = typeof json.nextPageToken === "string" ? json.nextPageToken.trim() : "";
      if (!nextPageToken || nextPageToken === pageToken) break;
      pageToken = nextPageToken;
      // 아직 다음 장이 남았는데 상한에 걸려 멈추는 경우. 여기서 아무 말도 안 하면
      // 사용자는 잘린 목록을 전부라고 믿는다.
      if (page === modelListMaxPages - 1) truncatedByPageCap = true;
    }

    if (collected.length === 0) {
      // 호출은 성공했는데 쓸 것이 하나도 없는 상태. "가져왔습니다"라고 하면
      // 사용자는 빈 목록을 앞에 두고 무엇이 잘못됐는지 알 수 없다.
      return {
        status: "needs_model_access",
        providerId: "google_gemini",
        action: "list_models",
        endpoint,
        models: [],
        recommendedModel: "",
        filteredOutCount,
        pagesFetched,
        externalMutation: false,
        appMayPersistSecret: false,
        rawSecretMaterialStored: false,
        rawSecretMaterialReturned: false,
        userMessage: filteredOutCount > 0
          ? `이 API key로 보이는 모델 ${filteredOutCount}개는 임베딩·음성·이미지 전용이라 대화에는 쓸 수 없습니다. Google AI Studio에서 Gemini 대화 모델을 쓸 수 있는 key인지 확인해 주세요.`
          : "이 API key로 쓸 수 있는 모델이 없습니다. Google AI Studio(aistudio.google.com)에서 key가 살아 있는지, 프로젝트에 Generative Language API가 켜져 있는지 확인해 주세요.",
        auditMessages: [
          "Gemini API models GET 조회 완료 (대화 가능 모델 0개)",
          "API key 원문은 결과, 리포트, 감사 메시지에 반환하지 않습니다.",
        ],
      };
    }

    const recommendedModel = chooseGeminiModel(collected);
    return {
      status: "models_loaded",
      providerId: "google_gemini",
      action: "list_models",
      endpoint,
      models: collected,
      recommendedModel,
      filteredOutCount,
      pagesFetched,
      externalMutation: false,
      appMayPersistSecret: false,
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
      userMessage: truncatedByPageCap
        ? `Gemini에서 대화에 쓸 수 있는 모델 ${collected.length}개를 찾았습니다. 모델이 너무 많아 앞부분만 불러왔으니, 찾는 모델이 없으면 다시 눌러 주세요.`
        : `Gemini에서 대화에 쓸 수 있는 모델 ${collected.length}개를 찾았습니다. 이 중에서 고르면 바로 쓸 수 있습니다.`,
      auditMessages: [
        truncatedByPageCap
          ? `Gemini API models GET 조회 완료 (페이지 상한 ${modelListMaxPages}장에서 중단, 목록이 잘렸을 수 있음)`
          : "Gemini API models GET 조회 완료",
        "API key 원문은 결과, 리포트, 감사 메시지에 반환하지 않습니다.",
        "모델 목록 조회는 읽기 전용이며 외부 발송, 캘린더 등록, 파일 쓰기는 실행하지 않습니다.",
      ],
    };
  }

  async generateContent(input: ModyGeminiLiveInput): Promise<ModyGeminiLiveResult> {
    const apiKey = sanitizeGeminiApiKey(input.apiKey);
    const model = sanitizeGeminiModel(input.model);
    const endpointBase = sanitizeEndpointBase(input.endpointBase);
    const endpoint = `${endpointBase}/${encodeURIComponent(model)}:generateContent`;
    const prompt = sanitizePrompt(input.prompt);

    if (!apiKey) {
      return needsCredentials(model, endpoint, "Gemini API key가 필요합니다.");
    }

    if (!prompt) {
      return apiFailure(model, endpoint, "Gemini에 보낼 테스트 문장이 필요합니다.", "prompt_missing");
    }

    try {
      const response = await this.fetchImpl(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify({
          systemInstruction: {
            parts: [{ text: modyAssistantInstructions }],
          },
          contents: [
            {
              role: "user",
              parts: [{ text: prompt }],
            },
          ],
          // 4096 은 한국어 보고서가 중간에 끊기는 값이었다. Gemini 2.5 는 훨씬 긴
          // 출력을 낸다. 스트리밍 없이 쓰므로 HTTP 타임아웃에 안 걸리는 선에서 올린다.
          generationConfig: { maxOutputTokens: 16_000 },
        }),
      });
      const json = asGenerateContentJson(await response.json().catch(() => ({})));
      if (!response.ok) {
        return apiFailure(
          model,
          endpoint,
          "Gemini generateContent 호출에 실패했습니다.",
          redactGeminiSecret(json.error?.message ?? response.statusText, [apiKey]),
          response.status,
        );
      }

      const outputText = extractGeminiText(json);
      if (!outputText) {
        return apiFailure(model, endpoint, "Gemini 응답에서 텍스트를 찾지 못했습니다.", "empty_text_response");
      }

      return {
        status: "generate_content_loaded",
        providerId: "google_gemini",
        action: "generate_content",
        model,
        endpoint,
        externalMutation: false,
        appMayPersistSecret: false,
        rawSecretMaterialStored: false,
        rawSecretMaterialReturned: false,
        promptChars: prompt.length,
        outputText,
        outputChars: outputText.length,
        tokenUsage: normalizeAIResponseUsage("gemini", json),
        userMessage: "Gemini API 호출이 성공했습니다. 이 결과는 초안 생성 테스트이며 외부 발송은 하지 않습니다.",
        auditMessages: [
          "Gemini API generateContent POST 호출 완료",
          "API key 원문은 결과, 리포트, 감사 메시지에 반환하지 않습니다.",
          "AI 응답은 초안 후보이며 메일 발송, 캘린더 등록, 파일 쓰기는 실행하지 않습니다.",
        ],
      };
    } catch (error) {
      return apiFailure(
        model,
        endpoint,
        "Gemini generateContent 네트워크 호출에 실패했습니다.",
        redactGeminiSecret(error instanceof Error ? error.message : String(error), [apiKey]),
      );
    }
  }
}

function needsCredentials(model: string, endpoint: string, userMessage: string): ModyGeminiLiveResult {
  return {
    status: "needs_credentials",
    providerId: "google_gemini",
    action: "generate_content",
    model,
    endpoint,
    externalMutation: false,
    appMayPersistSecret: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
    userMessage,
    auditMessages: [
      "Gemini live connector needs user-provided API key or OS secure credential reference",
      "API key 원문은 앱 결과에 반환하지 않습니다.",
    ],
  };
}

function apiFailure(
  model: string,
  endpoint: string,
  userMessage: string,
  errorMessage: string,
  httpStatus?: number,
): ModyGeminiLiveResult {
  return {
    status: "gemini_api_failed",
    providerId: "google_gemini",
    action: "generate_content",
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
      "Gemini API live call failed before any mutation",
      "오류 메시지는 API key-like 문자열을 마스킹한 뒤 반환합니다.",
    ],
  };
}

/**
 * 응답 본문을 항상 객체로 만든다.
 *
 * `response.json()` 은 본문이 리터럴 `null` 이면 `null` 을, 일부 프록시/목 구현은
 * `undefined` 를 돌려준다. 그대로 두고 `json.error` 나 `json.models` 를 읽으면
 * TypeError 가 나는데, listModels 는 그 접근이 try 밖에 있어 예외가 그대로 밖으로
 * 나가 화면이 무너진다. 목록 조회 실패는 결과값으로만 알려야 한다.
 */
function asJsonObject(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asModelsListJson(value: unknown): GeminiModelsListResponse {
  return asJsonObject(value) as GeminiModelsListResponse;
}

function asGenerateContentJson(value: unknown): GeminiGenerateContentResponse {
  return asJsonObject(value) as GeminiGenerateContentResponse;
}

function extractGeminiText(response: GeminiGenerateContentResponse): string {
  return (response.candidates ?? [])
    .flatMap((candidate) => candidate.content?.parts ?? [])
    .map((part) => typeof part.text === "string" ? part.text : "")
    .filter(Boolean)
    .join("\n")
    .trim()
    .slice(0, 24_000);
}

function sanitizeGeminiApiKey(value: unknown): string {
  const key = typeof value === "string" ? value.trim() : "";
  return key.length >= 20 && key.length <= 4096 && !/[\r\n]/.test(key) ? key : "";
}

function sanitizeGeminiModel(value: unknown): string {
  const model = typeof value === "string" ? value.trim() : "";
  return /^[A-Za-z0-9_.:-]{2,120}$/.test(model) ? model : defaultModel;
}

function sanitizeEndpointBase(value: unknown): string {
  const endpoint = typeof value === "string" ? value.trim().replace(/\/+$/, "") : "";
  if (/^https:\/\/generativelanguage\.googleapis\.com\/v1(?:beta)?\/models$/.test(endpoint)) {
    return endpoint;
  }
  return defaultEndpointBase;
}

function sanitizePrompt(value: unknown): string {
  const prompt = typeof value === "string" ? value.trim() : "";
  return prompt
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .slice(0, 24_000);
}

export function redactGeminiSecret(value: string, knownSecrets: Array<string | undefined> = []): string {
  let redacted = value;
  for (const secret of knownSecrets) {
    const token = typeof secret === "string" ? secret.trim() : "";
    if (token.length > 0) {
      redacted = redacted.split(token).join("[gemini-api-key-redacted]");
    }
  }
  return redacted
    .replace(/\bAIza[0-9A-Za-z_-]{20,}\b/g, "[gemini-api-key-redacted]")
    .replace(/x-goog-api-key:\s*[^\s,;]+/gi, "x-goog-api-key: [gemini-api-key-redacted]");
}

/**
 * 화면에서 "Gemini 모델 다시 불러오기" 한 번 누를 때 쓰는 짧은 호출부.
 * 로컬 모델 어댑터의 listLocalModels 와 같은 자리, 같은 모양이다.
 */
export async function listGeminiModels(
  input: { apiKey?: string; endpointBase?: string; fetch?: FetchLike } = {},
): Promise<ModyGeminiModelListResult> {
  const connectorOptions: { fetch?: FetchLike } = {};
  if (input.fetch) connectorOptions.fetch = input.fetch;

  const connector = new ModyGeminiLiveConnector(connectorOptions);
  const listInput: { apiKey?: string; endpointBase?: string } = {};
  if (typeof input.apiKey === "string") listInput.apiKey = input.apiKey;
  if (typeof input.endpointBase === "string") listInput.endpointBase = input.endpointBase;
  return connector.listModels(listInput);
}

function buildModelListUrl(endpointBase: string, pageToken: string): string {
  const query = `?pageSize=${modelListPageSize}`;
  // 키는 헤더로만 보낸다. pageToken 은 비밀이 아니지만 그대로 붙이면 URL 이 깨질 수 있다.
  return pageToken ? `${endpointBase}${query}&pageToken=${encodeURIComponent(pageToken)}` : `${endpointBase}${query}`;
}

/**
 * `models/gemini-2.5-flash` -> `gemini-2.5-flash`.
 * 이걸 안 떼면 호출 주소가 `.../models/models~2Fgemini-2.5-flash:generateContent` 가 되어
 * 고른 모델이 전부 404 로 실패한다.
 */
function stripGeminiModelPrefix(value: unknown): string {
  const raw = typeof value === "string" ? value.trim() : "";
  const id = raw.replace(/^models\//, "").trim();
  // generateContent 의 sanitizeGeminiModel 이 통과시키는 모양만 목록에 올린다.
  // 여기서 통과시켜 놓고 호출 때 기본값으로 바뀌면 사용자는 다른 모델의 답을 보게 된다.
  return /^[A-Za-z0-9_.:-]{2,120}$/.test(id) ? id : "";
}

/**
 * 채팅에 쓸 수 있는 모델만 남긴다.
 *
 * 1차 기준은 `supportedGenerationMethods` 에 `generateContent` 가 있는지다.
 * Gemini 목록에는 임베딩(embedContent 전용), aqa(generateAnswer 전용),
 * Live API(bidiGenerateContent 전용)가 같이 섞여 오는데, 이것들을 안 걸러 두면
 * 사용자가 골랐다가 오류만 보게 된다.
 *
 * 2차로 이름까지 보는 이유: TTS·이미지 생성 모델은 generateContent 를 지원한다고
 * 적혀 있지만 실제로는 responseModalities(AUDIO/IMAGE)를 요구해서, 우리가 보내는
 * 평범한 텍스트 요청에는 오류로 답한다. 규격만 믿으면 이 둘이 목록에 남는다.
 *
 * 필드가 아예 없는 응답(자체 프록시 등)은 1차를 건너뛰고 이름으로만 판단한다.
 * 못 읽었다고 전부 버리면 목록이 통째로 비어 버리기 때문이다.
 */
function isChatCapableGeminiModel(id: string, supportedGenerationMethods: unknown): boolean {
  if (Array.isArray(supportedGenerationMethods)) {
    const methods = supportedGenerationMethods
      .map((method) => (typeof method === "string" ? method.trim() : ""))
      .filter(Boolean);
    if (methods.length > 0 && !methods.includes("generateContent")) return false;
  }
  return !nonChatGeminiModelIdPattern.test(id);
}

/**
 * 이름만 봐도 채팅용이 아닌 것들:
 * - embedding/embed/aqa: 검색·임베딩 전용
 * - tts: 음성 출력 전용
 * - image / image-generation / imagen: 이미지 출력 전용
 * - veo: 영상 생성
 * - live / native-audio: 실시간 음성 세션(websocket) 전용
 */
const nonChatGeminiModelIdPattern =
  /(?:^|-)(?:aqa|tts|imagen|veo|image|embedding|embeddings)(?:-|$)|embedding|image-generation|native-audio|(?:^|-)live(?:-|$)/i;

function toGeminiModelInfo(
  id: string,
  entry: { displayName?: string; description?: string; inputTokenLimit?: number; outputTokenLimit?: number },
): ModyGeminiModelInfo {
  const displayName = typeof entry?.displayName === "string" ? entry.displayName.trim() : "";
  const description = typeof entry?.description === "string" ? entry.description.trim() : "";
  const info: ModyGeminiModelInfo = {
    id,
    // 사람이 읽을 이름이 없으면 id 를 그대로 쓴다. 빈 칸을 보여 주면 고를 수가 없다.
    label: displayName ? displayName.slice(0, 120) : id,
  };
  if (description) info.description = description.slice(0, 400);
  if (Number.isFinite(entry?.inputTokenLimit)) info.inputTokenLimit = Number(entry.inputTokenLimit);
  if (Number.isFinite(entry?.outputTokenLimit)) info.outputTokenLimit = Number(entry.outputTokenLimit);
  return info;
}

/**
 * 목록 순서는 API 가 준 그대로 둔다(화면이 임의로 뒤섞으면 사용자가 찾던 자리에서 사라진다).
 * 대신 미리 골라 둘 하나만 정한다 — 이 파일이 이미 기본값으로 쓰는 모델이 목록에 있으면
 * 그것을, 없으면 첫 번째를. 그래야 모델을 안 고른 사용자와 고른 사용자가 같은 모델을 쓴다.
 */
function chooseGeminiModel(models: ModyGeminiModelInfo[]): string {
  const preferred = models.find((model) => model.id === defaultModel);
  if (preferred) return preferred.id;
  return models[0]?.id ?? "";
}

/**
 * HTTP 상태별로 다음에 할 일을 알려 준다. "실패했습니다"로 끝나면 사용자는
 * 키가 틀린 건지, 결제가 안 된 건지, 잠깐 몰린 건지 구분할 수 없다.
 */
function modelListHttpMessage(status: number): string {
  if (status === 400 || status === 401 || status === 403) {
    return "Gemini API key가 거절당했습니다. Google AI Studio(aistudio.google.com/apikey)에서 key를 다시 확인해 붙여 넣어 주세요.";
  }
  if (status === 429) {
    return "Gemini 요청이 잠시 몰렸습니다. 1분쯤 뒤에 다시 눌러 주세요.";
  }
  if (status >= 500) {
    return "Gemini 서버가 응답하지 않습니다. 잠시 뒤에 다시 눌러 주세요.";
  }
  return "Gemini 모델 목록을 가져오지 못했습니다. 잠시 뒤에 다시 눌러 주세요.";
}

function listNeedsCredentials(endpoint: string): ModyGeminiModelListResult {
  return {
    status: "needs_credentials",
    providerId: "google_gemini",
    action: "list_models",
    endpoint,
    models: [],
    recommendedModel: "",
    filteredOutCount: 0,
    pagesFetched: 0,
    externalMutation: false,
    appMayPersistSecret: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
    userMessage: "Gemini API key가 필요합니다. Google AI Studio(aistudio.google.com/apikey)에서 key를 받아 연결 화면에 넣어 주세요.",
    auditMessages: [
      "Gemini model list needs user-provided API key or OS secure credential reference",
      "API key 원문은 앱 결과에 반환하지 않습니다.",
    ],
  };
}

/**
 * 목록 조회가 실패해도 앱은 멈추면 안 된다. 빈 목록과 이유를 돌려주어,
 * 부르는 쪽이 손으로 적어 둔 기본 목록으로 넘어갈 수 있게 한다.
 */
function listFailure(
  endpoint: string,
  userMessage: string,
  errorMessage: string,
  pagesFetched: number,
): ModyGeminiModelListResult {
  return {
    status: "gemini_api_failed",
    providerId: "google_gemini",
    action: "list_models",
    endpoint,
    models: [],
    recommendedModel: "",
    filteredOutCount: 0,
    pagesFetched,
    externalMutation: false,
    appMayPersistSecret: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
    userMessage,
    errorMessage,
    auditMessages: [
      "Gemini model list call failed before any mutation",
      "오류 메시지는 API key-like 문자열을 마스킹한 뒤 반환합니다.",
    ],
  };
}
