import { normalizeAIResponseUsage, type AIResponseUsage } from "./ai-usage.js";

export type ModyOpenAILiveStatus =
  | "needs_credentials"
  | "generate_content_loaded"
  | "openai_api_failed";

export type ModyOpenAILiveInput = {
  apiKey?: string;
  prompt?: string;
  model?: string;
  endpointBase?: string;
};

export type ModyOpenAILiveResult = {
  tokenUsage?: AIResponseUsage;
  status: ModyOpenAILiveStatus;
  providerId: "openai";
  action: "responses_create";
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

type FetchLikeResponse = {
  ok: boolean;
  status: number;
  statusText: string;
  json: () => Promise<unknown>;
};

type FetchLike = (url: string, init: {
  method: "POST";
  headers: Record<string, string>;
  body: string;
}) => Promise<FetchLikeResponse>;

type OpenAIResponsesCreateResponse = {
  output_text?: string;
  output?: Array<{
    type?: string;
    content?: Array<{
      type?: string;
      text?: string;
    }>;
  }>;
  error?: {
    message?: string;
    type?: string;
    code?: string;
  };
};

const defaultModel = "gpt-4o-mini";
const defaultEndpointBase = "https://api.openai.com/v1";
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

export class ModyOpenAILiveConnector {
  private readonly fetchImpl: FetchLike;

  constructor(options: { fetch?: FetchLike } = {}) {
    const fetchImpl = options.fetch ?? (globalThis as unknown as { fetch?: FetchLike }).fetch;
    if (!fetchImpl) {
      throw new Error("fetch runtime is required for OpenAI live connector");
    }
    this.fetchImpl = fetchImpl;
  }

  async generateContent(input: ModyOpenAILiveInput): Promise<ModyOpenAILiveResult> {
    const apiKey = sanitizeOpenAIKey(input.apiKey);
    const model = sanitizeOpenAIModel(input.model);
    const endpointBase = sanitizeEndpointBase(input.endpointBase);
    const endpoint = `${endpointBase}/responses`;
    const prompt = sanitizePrompt(input.prompt);

    if (!apiKey) {
      return needsCredentials(model, endpoint, "OpenAI API key가 필요합니다.");
    }

    if (!prompt) {
      return apiFailure(model, endpoint, "OpenAI에 보낼 문장이 필요합니다.", "prompt_missing");
    }

    try {
      const response = await this.fetchImpl(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          instructions: modyAssistantInstructions,
          input: prompt,
          max_output_tokens: 4096,
        }),
      });
      const json = await response.json().catch(() => ({})) as OpenAIResponsesCreateResponse;
      if (!response.ok) {
        return apiFailure(
          model,
          endpoint,
          "OpenAI Responses API 호출에 실패했습니다.",
          redactOpenAISecret(json.error?.message ?? response.statusText, [apiKey]),
          response.status,
        );
      }

      const outputText = extractOpenAIText(json);
      if (!outputText) {
        return apiFailure(model, endpoint, "OpenAI 응답에서 텍스트를 찾지 못했습니다.", "empty_text_response");
      }

      return {
        status: "generate_content_loaded",
        providerId: "openai",
        action: "responses_create",
        model,
        endpoint,
        externalMutation: false,
        appMayPersistSecret: false,
        rawSecretMaterialStored: false,
        rawSecretMaterialReturned: false,
        promptChars: prompt.length,
        outputText,
        outputChars: outputText.length,
        tokenUsage: normalizeAIResponseUsage("openai", json),
        userMessage: "OpenAI Responses API로 답변을 만들었습니다. 외부 실행은 하지 않았습니다.",
        auditMessages: [
          "OpenAI Responses API POST 호출 완료",
          "API key 원문은 결과, 리포트, 감사 메시지에 반환하지 않습니다.",
          "AI 응답은 채팅 답변이며 외부 발송, 캘린더 등록, 파일 쓰기는 실행하지 않습니다.",
        ],
      };
    } catch (error) {
      return apiFailure(
        model,
        endpoint,
        "OpenAI Responses API 네트워크 호출에 실패했습니다.",
        redactOpenAISecret(error instanceof Error ? error.message : String(error), [apiKey]),
      );
    }
  }
}

function needsCredentials(model: string, endpoint: string, userMessage: string): ModyOpenAILiveResult {
  return {
    status: "needs_credentials",
    providerId: "openai",
    action: "responses_create",
    model,
    endpoint,
    externalMutation: false,
    appMayPersistSecret: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
    userMessage,
    auditMessages: [
      "OpenAI live connector needs user-provided API key or OS secure credential reference",
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
): ModyOpenAILiveResult {
  return {
    status: "openai_api_failed",
    providerId: "openai",
    action: "responses_create",
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
      "OpenAI API live call failed before any mutation",
      "오류 메시지는 API key-like 문자열을 마스킹한 뒤 반환합니다.",
    ],
  };
}

function extractOpenAIText(response: OpenAIResponsesCreateResponse): string {
  const direct = typeof response.output_text === "string" ? response.output_text : "";
  const nested = (response.output ?? [])
    .flatMap((item) => item.content ?? [])
    .map((content) => typeof content.text === "string" ? content.text : "")
    .filter(Boolean)
    .join("\n");
  return (direct || nested).trim().slice(0, 24_000);
}

function sanitizeOpenAIKey(value: unknown): string {
  const key = typeof value === "string" ? value.trim() : "";
  return key.length >= 20 && key.length <= 4096 && !/[\r\n]/.test(key) ? key : "";
}

function sanitizeOpenAIModel(value: unknown): string {
  const model = typeof value === "string" ? value.trim() : "";
  return /^[A-Za-z0-9_.:-]{2,120}$/.test(model) ? model : defaultModel;
}

function sanitizeEndpointBase(value: unknown): string {
  const endpoint = typeof value === "string" ? value.trim().replace(/\/+$/, "") : "";
  if (/^https:\/\/api\.openai\.com\/v1$/.test(endpoint)) {
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

export function redactOpenAISecret(value: string, knownSecrets: Array<string | undefined> = []): string {
  let redacted = value;
  for (const secret of knownSecrets) {
    const token = typeof secret === "string" ? secret.trim() : "";
    if (token.length > 0) {
      redacted = redacted.split(token).join("[openai-api-key-redacted]");
    }
  }
  return redacted
    .replace(/\bsk-proj-[A-Za-z0-9_-]{20,}\b/g, "[openai-api-key-redacted]")
    .replace(/\bsk-[A-Za-z0-9_-]{20,}\b/g, "[openai-api-key-redacted]")
    .replace(/authorization:\s*bearer\s+[^\s,;]+/gi, "authorization: bearer [openai-api-key-redacted]");
}
