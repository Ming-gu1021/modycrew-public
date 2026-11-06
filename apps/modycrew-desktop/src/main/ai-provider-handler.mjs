import { spawn } from "node:child_process";
import { managedToolEnv } from "./managed-tool-env.mjs";
import crypto from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolveDesktopDomainEntryPath } from "./runtime-paths.mjs";
import { aiUsageConnectionId, beginAIUsage, readAIUsage } from "./ai-usage-ledger.mjs";
import { readCodexUsageLimits, readClaudeUsageLimits } from "./provider-usage-limits.mjs";
import { modelMaintenanceConnectionKey } from "./automatic-model-maintenance-adapter.mjs";
import { probeModelProtocol } from "./automatic-model-maintenance-probes.mjs";
let automaticModelMaintenance = null;
export function configureAIModelMaintenance(runtime) { automaticModelMaintenance = runtime; }
const { normalizeAIResponseUsage } = await import(pathToFileURL(path.join(
  path.dirname(resolveDesktopDomainEntryPath({ repoRoot: fileURLToPath(new URL("../../../../", import.meta.url)) })),
  "ai-usage.js",
)).href);
const { restoreBuiltinExpert, buildBuiltinExpertPrompt } = await import(pathToFileURL(path.join(
  path.dirname(resolveDesktopDomainEntryPath({ repoRoot: fileURLToPath(new URL("../../../../", import.meta.url)) })),
  "builtin-experts.js",
)).href);
import {
  chooseAvailableModel, discoverModelAvailability, forgetModelAvailabilityScope,
  noteModelExecution, peekModelAvailability, unavailableModelCatalog,
} from "./ai-model-availability.mjs";
import {
  aiRuntimeRouterRouteOrder,
  createAIRuntimeRecoveryPlan,
  createAIRuntimeRouterMetadata,
  ensureAIRuntimeRouterMetadata,
  inferAIRuntimeFinalRoute,
  normalizeAIRuntimeFallbackAttemptFailures,
} from "./ai-runtime-router.mjs";
import {
  buildSubscriptionModelAvailability,
  detectSubscriptionRuntimes,
  generateWithSubscriptionRuntime,
  killProcessTree,
  listSubscriptionRuntimeIds,
  readSubscriptionRuntimeStatus,
  resolveSubscriptionCliExecutable,
  startSubscriptionRuntimeLogin,
  subscriptionDefaultModelId,
} from "./subscription-cli-runtime.mjs";

// "anthropic" 은 연결 카탈로그(connectors.ts:1183 "Claude (Anthropic)")에 이미 있었는데
// 여기서 막혀 **사용자가 골라도 안 되는 항목**이었다. 이제 진짜로 받는다.
// "local" 은 내 PC 안의 모델(Ollama·LM Studio·llama.cpp·vLLM) — 키가 없고 127.0.0.1 만 탄다.
// 구독 CLI 제공자(claude_subscription 등)는 표에서 읽어 붙인다. 새 제공자를 추가할 때
// 여기 문자열을 또 고치는 것을 잊어 "목록에는 있는데 런타임이 거부" 가 반복됐다.
const subscriptionProviderIds = listSubscriptionRuntimeIds();
const allowedProviders = new Set([
  "codex_oauth", "gemini", "openai", "anthropic", "local", ...subscriptionProviderIds,
]);
const textGenerationProviders = new Set([
  "codex_oauth", "gemini", "openai", "anthropic", "local", ...subscriptionProviderIds,
]);
const vaultFileName = "ai-provider-vault.json";
const codexOAuthProvider = "codex_oauth";
const codexLoginUrl = "https://auth.openai.com/oauth/authorize";
const codexClientId = "app_EMoamEEZ73f0CkXaXp7hrann";
const codexTokenUrl = "https://auth.openai.com/oauth/token";
const codexOAuthOriginator = "openclaw";
const codexCallbackPath = "/auth/callback";
const codexDefaultCallbackPort = 1455;
const codexScope = "openid profile email offline_access";
const codexBackendResponsesUrl = "https://chatgpt.com/backend-api/codex/responses";
const codexAuthClaimPath = "https://api.openai.com/auth";
const codexProfileClaimPath = "https://api.openai.com/profile";
// Display defaults only; generation is gated by the connected account catalog.
const codexLatestKnownModel = "gpt-6-astra";
const codexFastKnownModel = "gpt-5.4-mini";
const modelTierLatest = "latest";
const modelTierFast = "fast";
function resolveCodexLatestModel() {
  const fromEnv = String(process.env.MODYCREW_CODEX_LATEST_MODEL ?? "").trim();
  return fromEnv || codexLatestKnownModel;
}
function resolveCodexFastModel() {
  const fromEnv = String(process.env.MODYCREW_CODEX_FAST_MODEL ?? "").trim();
  return fromEnv || codexFastKnownModel;
}
const codexModelUpdateRequiredMessage = "새 모델 사용을 위해 업데이트가 필요합니다. 현재 요청은 그대로 두었어요. ModyCrew와 Codex 앱/CLI를 최신 버전으로 올린 뒤 같은 요청을 다시 시도해 주세요.";
function isCodexModelUpdateRequiredDiagnostic(...values) {
  const diagnostic = values.filter(Boolean).join(" ");
  return /codex_cli_model_unsupported|requires a newer version of Codex|Please upgrade to the latest app or CLI|not supported when using Codex with a ChatGPT account/iu.test(diagnostic);
}
const codexBackendTimeoutMs = 45_000;
const codexStreamTimeoutMs = 60_000;
const codexLongRequestTimeoutMs = 120_000;
const aiRuntimeLiveProofMaxAgeMs = 30 * 60 * 1000;
const codexCliTimeoutMs = 120_000;
const codexOAuthBrowserLaunchCooldownMs = 90_000;
const aiTextStreamChannel = "mody.ai-provider.stream.v1";
const modyAssistantInstructions = [
  "너는 ModyCrew Windows 앱 안에서 사용자와 함께 일하는 한국어 AI 업무 비서다.",
  "말투는 친근하고 자연스럽게 한다. 사용자가 답답해할 때는 먼저 한 문장으로 받아주고 바로 실제 답을 준다.",
  "답변 길이는 사용자의 요청과 질문 복잡도에 맞춘다. 단순 확인·인사·명시적으로 짧게 요청한 경우에만 짧고 핵심적으로 답한다.",
  "설명·비교·작성·검토·문제 해결이나 여러 조건이 있는 업무는 필요한 근거·선택지·단계까지 충분히 답한다. 억지로 한 줄이나 고정된 항목 수로 줄이지 않는다.",
  "장황한 제품 설명, 무관한 기능 나열, 가짜 진행 보고는 하지 않는다.",
  "사용자를 초보라고 가정하고, 처음 나오는 용어·기능은 한 줄로 쉽게 풀어 설명하고 필요하면 짧은 예시를 든다. 이유를 먼저 이해시킨 다음 다음 단계를 준다.",
  "앱 채팅 답변에서는 Codex 개발 에이전트처럼 작업 진행률(예: 80%)이나 저장소/AGENTS 지침을 말하지 않는다.",
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
const moduleDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(moduleDir, "..", "..", "..", "..");
const activeCodexOAuthSessions = new Map();
const codexOAuthLaunchGuards = new Map();

function resolveResourcePath(...segments) {
  if (process.resourcesPath) {
    const packaged = path.join(process.resourcesPath, ...segments);
    if (existsSync(packaged)) return packaged;
  }
  return null;
}

function resolveDomainRuntimePath(fileName) {
  return (
    resolveResourcePath("domain", fileName) ??
    path.join(repoRoot, "packages", "domain", "dist", fileName)
  );
}

const openAILivePath = resolveDomainRuntimePath("openai-live.js");
const geminiLivePath = resolveDomainRuntimePath("gemini-live.js");
const anthropicLivePath = resolveDomainRuntimePath("anthropic-live.js");
const localModelLivePath = resolveDomainRuntimePath("local-model-live.js");

let openAIConnectorClassPromise;
let geminiConnectorClassPromise;
let anthropicConnectorClassPromise;
let localModelConnectorClassPromise;

async function loadDomainRuntimeExport(modulePath, exportName) {
  if (!existsSync(modulePath)) {
    throw new Error(`ModyCrew domain runtime module was not found: ${modulePath}`);
  }
  const module = await import(pathToFileURL(modulePath).href);
  const exported = module?.[exportName];
  if (typeof exported !== "function") {
    throw new Error(`ModyCrew domain runtime export was not found: ${exportName}`);
  }
  return exported;
}

async function loadOpenAIConnectorClass() {
  openAIConnectorClassPromise ??= loadDomainRuntimeExport(
    openAILivePath,
    "ModyOpenAILiveConnector",
  );
  return openAIConnectorClassPromise;
}

async function loadGeminiConnectorClass() {
  geminiConnectorClassPromise ??= loadDomainRuntimeExport(
    geminiLivePath,
    "ModyGeminiLiveConnector",
  );
  return geminiConnectorClassPromise;
}

async function loadAnthropicConnectorClass() {
  anthropicConnectorClassPromise ??= loadDomainRuntimeExport(
    anthropicLivePath,
    "ModyAnthropicLiveConnector",
  );
  return anthropicConnectorClassPromise;
}

async function loadLocalModelConnectorClass() {
  localModelConnectorClassPromise ??= loadDomainRuntimeExport(
    localModelLivePath,
    "ModyLocalModelLiveConnector",
  );
  return localModelConnectorClassPromise;
}

export async function generateReceiptVision(payload = {}, options = {}) {
  const provider = payload?.provider === "openai" || payload?.provider === "gemini" ? payload.provider : "";
  if (!provider) {
    return receiptVisionResult("receipt_vision_provider_required", "\uC601\uC218\uC99D \uC0AC\uC9C4\uC744 \uBCF4\uB0BC AI\uB97C \uC120\uD0DD\uD574 \uC8FC\uC138\uC694.");
  }
  if (payload?.receiptImageConsent !== true) {
    return receiptVisionResult("receipt_image_consent_required", "\uC0AC\uC9C4 \uC804\uC1A1 \uB3D9\uC758 \uD6C4\uC5D0\uB9CC \uC601\uC218\uC99D\uC744 \uC77D\uC744 \uC218 \uC788\uC2B5\uB2C8\uB2E4.");
  }

  const prompt = sanitizePrompt(payload?.prompt).slice(0, 8_000);
  const image = normalizeReceiptVisionImage(payload?.images);
  if (!prompt || !image) {
    return receiptVisionResult("receipt_image_invalid", "\uC601\uC218\uC99D \uC0AC\uC9C4 \uD55C \uC7A5\uC758 JPG \uB610\uB294 PNG\uB9CC \uBD84\uC11D\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4.");
  }

  const vault = await readVault(options);
  const record = vault.providers?.[provider];
  if (!record?.encryptedSecret) {
    return receiptVisionResult("receipt_vision_connection_required", "\uC120\uD0DD\uD55C AI\uC758 API \uC5F0\uACB0\uC744 \uBA3C\uC800 \uC124\uC815\uD574 \uC8FC\uC138\uC694.", { provider });
  }
  const credential = decryptVaultSecret(record.encryptedSecret, options.safeStorage);
  if (credential.status !== "credential_ready") {
    return receiptVisionResult("receipt_vision_connection_required", "\uC120\uD0DD\uD55C AI \uC5F0\uACB0\uC744 \uC548\uC804\uD558\uAC8C \uC77D\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4. \uC124\uC815\uC5D0\uC11C \uB2E4\uC2DC \uD655\uC778\uD574 \uC8FC\uC138\uC694.", { provider });
  }

  try {
    return provider === "openai"
      ? await generateOpenAIReceiptVision(record, prompt, image, credential.value, options)
      : await generateGeminiReceiptVision(record, prompt, image, credential.value, options);
  } catch {
    return receiptVisionResult("receipt_vision_failed", "\uC601\uC218\uC99D \uC0AC\uC9C4\uC744 \uC77D\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4. \uC0AC\uC9C4\uACFC AI \uC5F0\uACB0\uC744 \uD655\uC778\uD55C \uB4A4 \uB2E4\uC2DC \uC2DC\uB3C4\uD574 \uC8FC\uC138\uC694.", { provider });
  }
}

async function generateOpenAIReceiptVision(record, prompt, image, apiKey, options) {
  const model = normalizeModel(record.model, "openai");
  const response = await fetchWithTimeout(
    resolveFetch(options),
    "https://api.openai.com/v1/responses",
    {
      method: "POST",
      headers: { Authorization: "Bearer " + apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        input: [{
          role: "user",
          content: [
            { type: "input_text", text: prompt },
            { type: "input_image", image_url: "data:" + image.mimeType + ";base64," + image.dataBase64, detail: "high" },
          ],
        }],
        store: false,
      }),
    },
    codexBackendTimeoutMs,
  );
  const json = await response.json().catch(() => null);
  const outputText = response.ok ? extractOpenAIResponseText(json) : "";
  return outputText
    ? receiptVisionResult("generate_content_loaded", "\uC601\uC218\uC99D \uC0AC\uC9C4\uC744 \uC77D\uC5B4 \uCD08\uC548\uC744 \uB9CC\uB4E4\uC5C8\uC2B5\uB2C8\uB2E4.", { provider: "openai", model, outputText, answerReady: true })
    : receiptVisionResult("receipt_vision_failed", "\uC601\uC218\uC99D \uC0AC\uC9C4\uC5D0\uC11C \uD655\uC778\uD560 \uC218 \uC788\uB294 \uC815\uBCF4\uB97C \uC77D\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4.", { provider: "openai", model });
}

async function generateGeminiReceiptVision(record, prompt, image, apiKey, options) {
  const model = normalizeModel(record.model, "gemini");
  const response = await fetchWithTimeout(
    resolveFetch(options),
    "https://generativelanguage.googleapis.com/v1beta/models/" + encodeURIComponent(model) + ":generateContent",
    {
      method: "POST",
      headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{
          role: "user",
          parts: [
            { text: prompt },
            { inline_data: { mime_type: image.mimeType, data: image.dataBase64 } },
          ],
        }],
        generationConfig: { temperature: 0 },
      }),
    },
    codexBackendTimeoutMs,
  );
  const json = await response.json().catch(() => null);
  const outputText = response.ok ? extractGeminiReceiptResponseText(json) : "";
  return outputText
    ? receiptVisionResult("generate_content_loaded", "\uC601\uC218\uC99D \uC0AC\uC9C4\uC744 \uC77D\uC5B4 \uCD08\uC548\uC744 \uB9CC\uB4E4\uC5C8\uC2B5\uB2C8\uB2E4.", { provider: "gemini", model, outputText, answerReady: true })
    : receiptVisionResult("receipt_vision_failed", "\uC601\uC218\uC99D \uC0AC\uC9C4\uC5D0\uC11C \uD655\uC778\uD560 \uC218 \uC788\uB294 \uC815\uBCF4\uB97C \uC77D\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4.", { provider: "gemini", model });
}

function normalizeReceiptVisionImage(images) {
  if (!Array.isArray(images) || images.length !== 1) return null;
  const source = images[0] ?? {};
  const mimeType = source.mimeType === "image/png" ? "image/png" : source.mimeType === "image/jpeg" || source.mimeType === "image/jpg" ? "image/jpeg" : "";
  const dataBase64 = String(source.dataBase64 ?? "").replace(/\s+/g, "");
  if (!mimeType || !dataBase64 || dataBase64.length % 4 !== 0) return null;
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(dataBase64)) return null;
  const data = Buffer.from(dataBase64, "base64");
  if (!data.length || data.length > 12 * 1024 * 1024 || data.toString("base64") !== dataBase64) return null;
  const isPng = data.length >= 8 && data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47 && data[4] === 0x0d && data[5] === 0x0a && data[6] === 0x1a && data[7] === 0x0a;
  const isJpeg = data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff;
  if ((mimeType === "image/png" && !isPng) || (mimeType === "image/jpeg" && !isJpeg)) return null;
  return { mimeType, dataBase64 };
}

function extractGeminiReceiptResponseText(response) {
  return (Array.isArray(response?.candidates) ? response.candidates : [])
    .flatMap((candidate) => Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [])
    .map((part) => typeof part?.text === "string" ? part.text : "")
    .filter(Boolean)
    .join("\n")
    .trim()
    .slice(0, 24_000);
}

function receiptVisionResult(status, userMessage, extra = {}) {
  return {
    status,
    userMessage,
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
    ...extra,
  };
}

export async function handleAIProviderMessage(event, payload = {}, options = {}) {
  const kind = String(payload.kind ?? "");

  if (kind === "usage_summary") {
    if (options.usageTrackingScope !== "personal_device") return { status: "ai_usage_scope_unavailable" };
    const vault = await readVault(options);
    const connections = Object.entries(vault.providers ?? {}).map(([provider, record]) => ({ provider, id: usageConnectionId(provider, record, options) }));
    const [ledger, providerLimits] = await Promise.all([
      readAIUsage({ root: options.app.getPath("userData"), connections, days: payload.days }),
      payload.includeProviderLimits === true ? readConnectedProviderLimits(vault, options) : Promise.resolve([]),
    ]);
    return { ...ledger, providerLimits };
  }

  if (kind.startsWith("jev_")) {
    const { handleJevMailMessage } = await import("./jev-mail-handler.mjs");
    return handleJevMailMessage(payload, options);
  }

  if (kind === "status") {
    const status = await readVaultStatus(options);
    return { ...status, ...(options.usageTrackingScope === "personal_device" && automaticModelMaintenance?.scope?.() === resolveVaultPath(options) ? { modelMaintenance: automaticModelMaintenance.getStatus() } : {}) };
  }

  if (kind === "maintenance_protocol_probe") {
    // Only the main-process maintenance adapter can request this diagnostic. Renderer
    // payloads cannot grant it and no arbitrary user prompt/tool is accepted.
    if (options.allowMaintenanceProbe !== true) return { status: "maintenance_probe_not_authorized", completed: false };
    const provider = normalizeProvider(payload.provider);
    if (!["codex_oauth", "openai", "anthropic", "gemini"].includes(provider)) return { status: "maintenance_probe_unsupported", completed: false };
    const vault = await readVault(options);
    const record = vault.providers[provider];
    if (!record?.encryptedSecret || (provider !== codexOAuthProvider && record.chatContentAllowed !== true)) return { status: "maintenance_probe_consent_required", completed: false };
    const { context, availability } = await providerModelAvailability(provider, options, { vault });
    const model = String(payload.model ?? "");
    if (!context || !chooseAvailableModel(availability, model) || ["latest", "fast"].includes(model)) return { status: "maintenance_probe_model_unavailable", completed: false };
    const result = await probeModelProtocol(context, { model, nonce: payload.nonce, mode: payload.mode, signal: options.abortSignal, fetchFn: resolveFetch(options) });
    const after = await readVault(options);
    const current = await providerModelAvailability(provider, options, { vault: after, cachedOnly: true });
    if (!current.context || current.context.secret !== context.secret || current.context.accountId !== context.accountId
      || (provider !== codexOAuthProvider && after.providers[provider]?.chatContentAllowed !== true)) return { status: "maintenance_probe_connection_changed", completed: false };
    return { ...result, status: result.completed ? "maintenance_probe_completed" : "maintenance_probe_failed", externalMutation: false, rawSecretMaterialReturned: false };
  }

  if (kind === "list_models") {
    const provider = normalizeProvider(payload.provider);
    const { availability } = await providerModelAvailability(provider, options, { forceRefresh: payload.forceRefresh === true });
    return { status: availability.state === "available" ? "models_loaded" : "model_catalog_unavailable", provider, modelAvailability: availability, userMessage: availability.userMessage, externalMutation: false, rawSecretMaterialReturned: false };
  }

  if (kind === "live_proofs") {
    return readAIRuntimeLiveProofs();
  }

  if (kind === "save_api_key") {
    return saveApiKey(payload, options);
  }

  // 내 PC 에 깔린 모델 목록. 사용자가 llama3.1:8b 같은 이름을 외워 타이핑하게 만들면
  // 그 순간 "어려워서 못 하는" 사람이 된다 — 켜져 있는 런타임을 찾아 읽어 온다.
  if (kind === "list_local_models") {
    return listLocalModelsForUi(payload, options);
  }

  // 구독 계정으로 쓰는 AI(Claude 등). API 키를 받지 않는 경로다 —
  // 키 발급이 이 앱이 없애려는 바로 그 어려움이기 때문이다.
  if (kind === "subscription_runtimes") {
    const detected = await detectSubscriptionRuntimes(options);
    for (const runtime of detected.runtimes ?? []) subscriptionStatusCache.set(runtime.providerId, { at: Date.now(), status: runtime });
    return detected;
  }
  if (kind === "subscription_runtime_status") {
    const provider = String(payload?.provider ?? "");
    forgetSubscriptionStatusCache(provider);
    return readSubscriptionRuntimeStatus(provider, options);
  }
  if (kind === "subscription_runtime_login") {
    const provider = String(payload?.provider ?? "");
    forgetSubscriptionStatusCache(provider);
    return startSubscriptionRuntimeLogin(provider, options);
  }

  if (kind === "save_model") {
    const result = await saveProviderModel(payload, options);
    if (options.usageTrackingScope === "personal_device" && ["model_updated", "model_preference_saved"].includes(result.status) && automaticModelMaintenance?.scope?.() === resolveVaultPath(options)) {
      void automaticModelMaintenance.check({ force: true }).catch(() => {});
    }
    return result;
  }

  if (kind === "start_oauth") {
    return startOAuth(payload, options);
  }

  if (kind === "clear_credential") {
    return clearCredential(payload, options);
  }

  if (kind === "generate_text") {
    return createAITextRuntimeReceipt(await generateText(payload, options));
  }

  if (kind === "generate_text_stream") {
    const streamId = String(payload.streamId ?? "");
    // '중지'(cancel_stream)나 창 닫힘이 오면 답변 받기를 끊고, 돌던 CLI 는 딸린 프로세스까지 끝낸다.
    const cancellation = registerAITextStream(event, streamId);
    const onDelta = (delta) => {
      const text = String(delta ?? "");
      if (!text || !streamId || cancellation.signal.aborted) return;
      const sender = event?.sender;
      if (!sender || (typeof sender.isDestroyed === "function" && sender.isDestroyed())) return;
      try {
        sender.send(aiTextStreamChannel, { streamId, delta: text });
      } catch {
        // 렌더러로의 스트림 전송 실패는 무시하고 최종 결과로 마무리합니다.
      }
    };
    try {
      const generation = generateTextStreaming(payload, { ...options, abortSignal: cancellation.signal }, onDelta);
      // 중지된 뒤 늦게 실패해도 처리되지 않은 거부로 남지 않게 한다(아래 race 는 그대로 결과를 받는다).
      generation.catch(() => undefined);
      const result = await Promise.race([generation, cancellation.cancelled]);
      if (cancellation.signal.aborted) return createAITextRuntimeReceipt(cancelledAITextStreamResult(payload));
      return createAITextRuntimeReceipt(result);
    } finally {
      cancellation.release();
    }
  }

  if (kind === "cancel_stream") {
    return cancelAITextStream(event, String(payload.streamId ?? ""));
  }

  throw new Error(`unsupported ai-provider kind: ${kind}`);
}

async function readConnectedProviderLimits(vault, options) {
  const cwd = options.app.getPath("userData");
  const queries = [
    (async () => {
      const record = vault.providers?.codex_oauth;
      if (record?.encryptedSecret) {
        const credential = await resolveCodexCredential(record, options);
        if (credential.status !== "credential_ready") return { provider: "codex_oauth", connected: true, status: "login_required", windows: [] };
        const matches = record => {
          if (!record?.encryptedSecret) return false;
          const secret = decryptVaultSecret(record.encryptedSecret, options.safeStorage);
          const parsed = secret.status === "credential_ready" ? parseCodexCredential(secret.value) : null;
          return parsed?.access === credential.value.access && parsed?.accountId === credential.value.accountId;
        };
        const before = (await readVault(options)).providers?.codex_oauth;
        if (!matches(before)) return { provider: "codex_oauth", connected: Boolean(before?.encryptedSecret), status: "connection_changed", windows: [] };
        const limits = await readCodexUsageLimits({ executable: resolveCodexCliExecutable(options), credential: credential.value, cwd });
        // A reconnect while the query is running must not expose the former account's quota.
        const current = (await readVault(options)).providers?.codex_oauth;
        if (!matches(current)) return { provider: "codex_oauth", connected: Boolean(current?.encryptedSecret), status: "connection_changed", windows: [] };
        return limits;
      }
      if (options.disableCodexAuthFileDetection) return null;
      return readCodexUsageLimits({ executable: resolveCodexCliExecutable(options), cwd });
    })(),
    (async () => {
      const runtime = await readSubscriptionRuntimeStatus("claude_subscription", { ...options, statusTimeoutMs: 3000 });
      if (!runtime.loggedIn) return null;
      return readClaudeUsageLimits({ executable: resolveSubscriptionCliExecutable("claude_subscription", options), cwd });
    })(),
  ];
  return (await Promise.allSettled(queries)).flatMap(item => item.status === "fulfilled" && item.value ? [item.value] : []);
}

// 진행 중인 답변 스트림. 키는 "보낸 창:streamId" 라서 다른 창의 답변은 멈출 수 없다.
const activeAITextStreams = new Map();

function aiTextStreamKey(event, streamId) {
  const senderId = event?.sender?.id;
  return `${senderId === undefined || senderId === null ? "main" : String(senderId)}:${streamId}`;
}

function registerAITextStream(event, streamId) {
  const controller = new AbortController();
  let markCancelled = () => undefined;
  const cancelled = new Promise((resolve) => {
    markCancelled = resolve;
  });
  const abort = () => {
    if (!controller.signal.aborted) controller.abort();
  };
  controller.signal.addEventListener("abort", () => markCancelled(), { once: true });
  const key = streamId ? aiTextStreamKey(event, streamId) : "";
  if (key) {
    // 같은 id 로 다시 시작하면 앞의 것은 더 기다릴 사람이 없다.
    activeAITextStreams.get(key)?.abort();
    activeAITextStreams.set(key, { abort });
  }
  // 창이 닫히면 답을 받을 곳이 없으므로 바로 멈춘다.
  const sender = event?.sender;
  const onSenderDestroyed = () => abort();
  if (sender && typeof sender.once === "function") sender.once("destroyed", onSenderDestroyed);
  return {
    signal: controller.signal,
    cancelled,
    release() {
      if (key && activeAITextStreams.get(key)?.abort === abort) activeAITextStreams.delete(key);
      if (sender && typeof sender.removeListener === "function") sender.removeListener("destroyed", onSenderDestroyed);
    },
  };
}

function cancelAITextStream(event, streamId) {
  const entry = streamId ? activeAITextStreams.get(aiTextStreamKey(event, streamId)) : undefined;
  entry?.abort();
  return {
    status: entry ? "ai_text_stream_cancelled" : "ai_text_stream_not_running",
    streamId,
    cancelled: Boolean(entry),
    userMessage: entry ? "답변을 멈췄어요." : "이미 끝난 답변이라 멈출 것이 없어요.",
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

function cancelledAITextStreamResult(payload = {}) {
  return {
    status: "ai_text_stream_cancelled",
    provider: String(payload.provider ?? ""),
    model: String(payload.model ?? ""),
    cancelled: true,
    outputText: "",
    diagnosticStage: "answer_cancelled_by_user",
    userMessage: "요청하신 대로 답변을 멈췄어요. 이어서 하고 싶으면 다시 말씀해 주세요.",
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

async function generateText(payload, options) {
  const userPrompt = sanitizePrompt(payload.prompt);
  if (!userPrompt) {
    return withAIRuntimeRouterMetadata({
      status: "prompt_required",
      userMessage: "채팅으로 처리할 문장을 먼저 입력해 주세요.",
      externalMutation: false,
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
    }, ["setup_recovery"], "setup_recovery");
  }

  const runtimeContext = createRuntimeContextReceipt(payload);
  const prompt = buildRuntimePrompt(userPrompt, payload);
  notifyRuntimePromptObserver(options, prompt, payload);
  const vault = await readVault(options);
  return generateSelectedModelText(payload, prompt, options, vault, runtimeContext);
}

// 구독 CLI(Claude 등)는 보관함에 키가 없다. '연결됨'의 근거는 CLI 의 로그인 상태다.
// 예전에는 키가 없다는 이유로 늘 '연결 필요'로 판정돼, 로그인해 둔 구독을 답변 AI 로
// 고를 수도(저장 거절) 쓸 수도(답변 거절) 없었다. `auth status` 는 프로세스를 하나 띄우므로
// 결과를 5분 기억한다(상태 조회는 화면 포커스마다 불린다). 로그인·로그아웃을 하면 곧바로 다시 읽는다.
const subscriptionStatusCacheMs = 5 * 60_000;
const subscriptionStatusCache = new Map();

export function forgetSubscriptionStatusCache(provider) {
  if (provider) subscriptionStatusCache.delete(provider);
  else subscriptionStatusCache.clear();
}

async function readCachedSubscriptionStatus(provider, options, { forceRefresh = false } = {}) {
  const cached = subscriptionStatusCache.get(provider);
  if (!forceRefresh && cached && Date.now() - cached.at < subscriptionStatusCacheMs) return cached.status;
  const status = await readSubscriptionRuntimeStatus(provider, options);
  subscriptionStatusCache.set(provider, { at: Date.now(), status });
  return status;
}

async function providerModelAvailability(provider, options, { vault, forceRefresh = false, cachedOnly = false } = {}) {
  const currentVault = vault ?? await readVault(options);
  const record = currentVault.providers?.[provider];
  const selectedModel = record?.model ?? "";
  if (subscriptionProviderIds.includes(provider)) {
    const status = await readCachedSubscriptionStatus(provider, options, { forceRefresh });
    return { availability: buildSubscriptionModelAvailability(provider, status, selectedModel) };
  }
  if (provider === "local") {
    if (cachedOnly) return { availability: unavailableModelCatalog(provider, selectedModel, "catalog_unavailable", "local_catalog") };
    const listed = await listLocalModelsForUi({ baseUrl: record?.baseUrl }, options);
    const models = (listed.models ?? []).map((model) => ({ id: model.id, label: model.name ?? model.id, availability: "available", evidence: "catalog" }));
    return { availability: { state: models.length ? "available" : "unknown", source: "local_catalog", models, checkedAt: new Date().toISOString(), userMessage: listed.userMessage, availabilityIsNotEntitlementProof: true } };
  }
  if (!record?.encryptedSecret) {
    const localOnly = provider === codexOAuthProvider && !options.disableCodexAuthFileDetection && await findCodexAuthFile();
    return { availability: unavailableModelCatalog(provider, selectedModel, localOnly ? "local_catalog_only" : "connection_required", localOnly ? "local_catalog" : "none") };
  }
  let secret = "", accountId = record.accountUid ?? "";
  if (provider === codexOAuthProvider) {
    const decrypted = cachedOnly ? decryptVaultSecret(record.encryptedSecret, options.safeStorage) : null;
    const credential = cachedOnly
      ? { status: decrypted?.status, value: decrypted?.status === "credential_ready" ? parseCodexCredential(decrypted.value) : null }
      : await resolveCodexCredential(record, options);
    if (credential.status !== "credential_ready" || !credential.value || (cachedOnly && credential.value.expires && credential.value.expires <= Date.now())) {
      return { availability: unavailableModelCatalog(provider, selectedModel, "connection_required") };
    }
    secret = credential.value.access;
    accountId = credential.value.accountId ?? "";
  } else {
    const credential = decryptVaultSecret(record.encryptedSecret, options.safeStorage);
    if (credential.status !== "credential_ready") return { availability: unavailableModelCatalog(provider, selectedModel) };
    secret = credential.value;
  }
  const context = { provider, scope: resolveVaultPath(options), secret, accountId, selectedModel };
  const availability = cachedOnly
    ? peekModelAvailability(context) ?? unavailableModelCatalog(provider, selectedModel, "catalog_unavailable")
    : await discoverModelAvailability(context, { fetchFn: resolveFetch(options), forceRefresh, timeoutMs: Number(options.modelDiscoveryTimeoutMs ?? 12_000) });
  return { availability, context };
}

function unavailableSelectedModel(provider, model, availability) {
  const entry = availability?.models?.find((item) => item.id === model);
  return {
    status: "model_unavailable", provider, model, modelAvailability: availability,
    userMessage: entry?.availability === "blocked"
      ? "선택한 모델은 현재 연결에서 사용할 수 없습니다. 모델 목록을 새로고침하거나 사용 가능한 모델을 직접 선택해 주세요."
      : "선택한 모델을 현재 연결에서 사용할 수 있는지 확인하지 못했습니다. 연결과 모델 목록을 확인해 주세요.",
    diagnosticStage: "model_availability_required", externalMutation: false,
    rawSecretMaterialStored: false, rawSecretMaterialReturned: false,
  };
}

async function generateSelectedModelText(payload, prompt, options, vault, runtimeContext, onDelta) {
  const explicitProvider = String(payload.provider ?? vault.activeProvider ?? "").trim();
  if (!explicitProvider && !String(payload.model ?? "").trim() && !Object.values(vault.providers).some((item) => item?.provider && allowedProviders.has(item.provider))) {
    return withAIRuntimeRouterMetadata({ status: "ai_provider_required", userMessage: "답변에 사용할 AI 연결을 먼저 설정해 주세요.", externalMutation: false, rawSecretMaterialStored: false, rawSecretMaterialReturned: false }, ["setup_recovery"], "setup_recovery", runtimeContext);
  }
  const provider = explicitProvider || (vault.providers[codexOAuthProvider]?.encryptedSecret ? codexOAuthProvider
    : ["openai", "gemini", "anthropic", "local", ...subscriptionProviderIds].find((id) => vault.providers[id]) ?? codexOAuthProvider);
  if (!allowedProviders.has(provider)) return { status: "ai_provider_required", userMessage: "사용할 AI 연결을 선택해 주세요.", externalMutation: false };
  const record = vault.providers[provider] ?? { provider };
  const preference = String(payload.model ?? record.model ?? "latest").trim();
  const route = provider === codexOAuthProvider ? "codex_oauth" : fallbackRouteIds[provider] ?? `${provider}_api`;
  const wrap = (result) => withAIRuntimeRouterMetadata(result, [route], isGeneratedTextReady(result) ? route : "setup_recovery", runtimeContext);
  // A stored key does not authorize chat use, including discovery triggered by a chat request.
  if (provider !== codexOAuthProvider && provider !== "local" && !subscriptionProviderIds.includes(provider) && record.encryptedSecret && record.chatContentAllowed !== true) {
    return wrap({ status: "chat_content_consent_required", provider, model: preference, userMessage: "이 AI 연결의 대화 사용에 동의한 뒤 다시 시도해 주세요.", externalMutation: false, rawSecretMaterialReturned: false });
  }
  const { availability, context } = await providerModelAvailability(provider, options, { vault });
  let model;
  if (options.usageTrackingScope === "personal_device" && ["latest", "fast"].includes(preference) && context && automaticModelMaintenance?.scope?.() === context.scope) {
    const connection = { provider, connectionKey: modelMaintenanceConnectionKey({ ...record, provider, accountId: context.accountId }), preference, authorized: true };
    const verified = await automaticModelMaintenance.resolveModel(connection).catch(() => null);
    if (!verified) return wrap({ status: "automatic_model_verification_pending", provider, model: preference,
      userMessage: "자동 모델의 실제 연결을 점검하고 있습니다. 잠시 후 다시 시도하거나 사용할 모델을 직접 선택해 주세요.", externalMutation: false, rawSecretMaterialReturned: false });
    model = chooseAvailableModel(availability, verified);
  } else model = chooseAvailableModel(availability, preference);
  if (!model) return wrap(unavailableSelectedModel(provider, preference, availability));
  const latestVault = await readVault(options);
  const latestConnection = await providerModelAvailability(provider, options, { vault: latestVault, cachedOnly: true });
  if (context && (!latestConnection.context || latestConnection.context.secret !== context.secret || latestConnection.context.accountId !== context.accountId)) {
    return wrap(unavailableSelectedModel(provider, model, unavailableModelCatalog(provider, model, "connection_changed")));
  }
  if (context && !chooseAvailableModel(latestConnection.availability, model)) return wrap(unavailableSelectedModel(provider, model, latestConnection.availability));
  if (provider !== codexOAuthProvider && provider !== "local" && !subscriptionProviderIds.includes(provider) && latestVault.providers[provider]?.chatContentAllowed !== true) {
    return wrap({ status: "chat_content_consent_required", provider, model, userMessage: "이 AI 연결의 대화 사용에 동의한 뒤 다시 시도해 주세요.", externalMutation: false, rawSecretMaterialReturned: false });
  }
  const active = { ...(latestVault.providers[provider] ?? record), model };
  const runOptions = { ...options, strictModelSelection: true };
  const usageJournal = options.usageTrackingScope === "personal_device"
    ? beginAIUsage({ root: options.app.getPath("userData"), connectionId: usageConnectionId(provider, active, options), provider, model })
    : { finish: () => ({ status: "scope_unavailable" }) };
  let result;
  try {
    if (provider === codexOAuthProvider) result = onDelta
      ? await generateCodexOAuthTextStream(active, prompt, runOptions, onDelta)
      : await generateCodexOAuthText(active, prompt, runOptions);
    else if (provider === "openai") result = await generateOpenAIText(active, prompt, runOptions);
    else if (provider === "gemini") result = await generateGeminiText(active, prompt, runOptions);
    else if (provider === "anthropic") result = await generateAnthropicText(active, prompt, runOptions);
    else if (provider === "local") result = await generateLocalModelText(active, prompt, runOptions);
    else result = await generateWithSubscriptionRuntime(provider, prompt, { ...runOptions, model });
  } catch {
    result = { status: "model_request_failed", provider, model, userMessage: "선택한 모델의 응답을 받지 못했습니다. 같은 모델로 다시 시도해 주세요.", externalMutation: false };
  }
  if (result.model && result.model !== model) result = { status: "model_selection_mismatch", provider, model, tokenUsage: result.tokenUsage, userMessage: "요청한 모델과 응답 모델이 달라 결과를 사용하지 않았습니다.", externalMutation: false };
  if (context) noteModelExecution(context, model, result);
  if (!isGeneratedTextReady(result)) result = { ...result, userMessage: `${result.userMessage ?? "선택한 모델의 요청이 실패했습니다."} 다른 모델로 자동 전환하지 않았습니다.`, modelAvailability: context ? peekModelAvailability(context) ?? availability : availability };
  return wrap({ ...result, usageRecording: usageJournal.finish({ ...result, cancelled: options.abortSignal?.aborted === true }) });
}

function usageConnectionId(provider, record, options) {
  if (provider === "local") return aiUsageConnectionId(provider, `local:${record.baseUrl || "automatic"}`);
  if (subscriptionProviderIds.includes(provider)) return null;
  const credential = decryptVaultSecret(record.encryptedSecret, options.safeStorage);
  if (credential.status !== "credential_ready") return null;
  if (provider === codexOAuthProvider) {
    const account = parseCodexCredential(credential.value)?.accountId;
    return account ? aiUsageConnectionId(provider, `account:${account}`) : null;
  }
  // Hash only in the main process. No identity, key, prompt or response is saved.
  return aiUsageConnectionId(provider, `key:${credential.value}`);
}

function notifyRuntimePromptObserver(options = {}, prompt = "", payload = {}) {
  if (typeof options.onRuntimePrompt !== "function") return;
  try {
    options.onRuntimePrompt({
      prompt,
      promptChars: String(prompt ?? "").length,
      providerHint: String(payload.provider ?? payload.modelProvider ?? ""),
      hasRoleContext: Boolean(payload.roleContext && typeof payload.roleContext === "object"),
      hasExecutionContext: Boolean(payload.executionContext && typeof payload.executionContext === "object"),
    });
  } catch {
    // Runtime prompt observation is proof-only; it must not block answer generation.
  }
}

function isGeneratedTextReady(result) {
  return result?.status === "generate_content_loaded" && Boolean(result.outputText);
}

function withAIRuntimeRouterMetadata(result = {}, attemptedRoutes = [], finalRoute = "", runtimeContext = null) {
  const aiRuntimeRouter = ensureAIRuntimeRouterMetadata(result, {
    attemptedRoutes,
    finalRoute,
    answerReady: isGeneratedTextReady(result),
    codexOAuthProvider,
  });
  return {
    ...result,
    ...(runtimeContext ? { runtimeContext } : {}),
    aiRuntimeRouter,
  };
}

function createAITextRuntimeReceipt(result = {}) {
  const answerReady = isGeneratedTextReady(result);
  const aiRuntimeRouter = ensureAIRuntimeRouterMetadata(result, {
    answerReady,
    codexOAuthProvider,
  });
  const fallbackUsed = Boolean(
    result.fallbackFrom ||
      result.fallbackFromModel ||
      result.previousFailureStatus ||
      result.runtime === "codex_cli" ||
      aiRuntimeRouter.attemptedRoutes.filter((route) => route !== "setup_recovery").length > 1,
  );
  const status = String(result.status ?? "unknown");
  const diagnosticStage = result.diagnosticStage ?? (answerReady ? "answer_generated" : "answer_generation_blocked");
  const recoveryPlan = answerReady ? null : createAIRuntimeRecoveryPlan(result);
  const fallbackAttemptFailures = normalizeAIRuntimeFallbackAttemptFailures(result.fallbackAttemptFailures);
  const userNextAction = answerReady
    ? fallbackUsed
      ? "답변은 만들었습니다. 기본 AI 연결은 설정에서 다시 확인할 수 있습니다."
      : "이 채팅창에 바로 다음 요청을 입력할 수 있습니다."
    : /required|not_connected|credential|refresh|invalid|login/u.test(status)
      ? "AI 연결을 다시 확인한 뒤 방금 요청을 이어서 처리하세요."
      : "선택한 모델 연결을 확인한 뒤 같은 요청을 다시 시도하세요. 다른 모델은 직접 선택할 수 있습니다.";
  const recoverySummary = answerReady
    ? fallbackUsed
      ? "기본 경로가 막혀도 대체 답변 경로로 채팅을 이어갔습니다."
      : "앱 안 AI 답변 경로가 실제 응답을 반환했습니다."
    : "연결됨 표시와 별개로 실제 답변 생성이 막혀 복구 선택지가 필요합니다.";

  return {
    ...result,
    aiRuntimeRouter,
    answerReady,
    fallbackUsed,
    userNextAction,
    recoverySummary,
    diagnosticStage,
    aiRuntimeReceipt: {
      status,
      provider: result.provider ?? "",
      model: result.model ?? "",
      runtime: result.runtime ?? "direct",
      answerReady,
      fallbackUsed,
      diagnosticStage,
      previousFailureStatus: result.previousFailureStatus ?? "",
      userNextAction,
      recoverySummary,
      routeOrder: aiRuntimeRouter.routeOrder ?? aiRuntimeRouterRouteOrder,
      attemptedRoutes: aiRuntimeRouter.attemptedRoutes ?? [],
      finalRoute: aiRuntimeRouter.finalRoute ?? inferAIRuntimeFinalRoute(result),
      failClosed: aiRuntimeRouter.failClosed ?? !answerReady,
      recoveryRequired: aiRuntimeRouter.recoveryRequired ?? !answerReady,
      recoveryReason: aiRuntimeRouter.recoveryReason ?? status,
      recoveryPlan,
      fallbackAttemptFailures,
      ...(result.runtimeContext ? { runtimeContext: result.runtimeContext } : {}),
      canRetryPendingRequest: !answerReady,
      externalMutation: false,
      rawSecretMaterialReturned: false,
    },
  };
}

/** 대체 경로 이름표 — 제공자가 늘어날 때 삼항이 겹치지 않게 한 곳에 모은다. */
const fallbackProviderLabels = {
  openai: "저장된 OpenAI API",
  gemini: "저장된 Gemini API",
  anthropic: "저장된 Claude API",
  // 로컬은 "저장된 API" 가 아니다 — 이 PC 안에서 돈다는 것이 요점이라 그렇게 말한다.
  local: "내 PC 안의 모델",
};

const fallbackRouteIds = {
  openai: "openai_api",
  gemini: "gemini_api",
  anthropic: "anthropic_api",
  local: "local_model",
};

async function generateCodexOAuthText(record, prompt, options) {
  const credential = await resolveCodexCredential(record, options);
  if (credential.status !== "credential_ready") {
    return {
      status: credential.status,
      provider: codexOAuthProvider,
      model: record.model,
      userMessage: credential.userMessage,
      externalMutation: false,
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
    };
  }

  const fetchFn = resolveFetch(options);
  const backendTimeoutMs = Number(options.codexBackendTimeoutMs ?? (prompt.length >= 6_000 ? codexLongRequestTimeoutMs : codexBackendTimeoutMs));
  // The selected account catalog was checked before this exact model reaches the transport.
  const model = normalizeModel(record.model, codexOAuthProvider);

  try {
    const firstAttempt = await callCodexBackendText({
      fetchFn,
      credential,
      model,
      prompt,
      timeoutMs: backendTimeoutMs,
    });
    const usableAttempt = firstAttempt;

    if (usableAttempt.status === "generate_content_loaded") {
      return {
        status: "generate_content_loaded",
        provider: codexOAuthProvider,
        model: usableAttempt.model,
        outputText: usableAttempt.outputText,
        tokenUsage: usableAttempt.tokenUsage,
        outputChars: usableAttempt.outputText.length,
        promptChars: prompt.length,
        userMessage:
          usableAttempt.fallbackFromModel && usableAttempt.fallbackFromModel !== usableAttempt.model
            ? `${usableAttempt.fallbackFromModel} 호출이 막혀 ${usableAttempt.model}로 답변을 만들었습니다.`
            : "Codex 브라우저 로그인으로 앱 안에서 실제 답변을 만들었습니다.",
        auditMessages: [
          "Codex OAuth access token으로 ChatGPT/Codex backend 호출 완료",
          usableAttempt.fallbackFromModel
            ? `Codex backend model fallback: ${usableAttempt.fallbackFromModel} -> ${usableAttempt.model}`
            : "",
          "OAuth token 원문은 renderer, 로그, 결과에 반환하지 않습니다.",
          "AI 응답은 채팅 답변이며 외부 발송, 캘린더 등록, 파일 쓰기는 실행하지 않았습니다.",
        ].filter(Boolean),
        fallbackFromModel: usableAttempt.fallbackFromModel,
        previousFailureStatus: usableAttempt.previousFailureStatus,
        diagnosticStage: usableAttempt.diagnosticStage,
        externalMutation: false,
        rawSecretMaterialStored: false,
        rawSecretMaterialReturned: false,
      };
    }

    if (usableAttempt.status === "codex_oauth_generate_failed") {
      const backendError = {
        status: "codex_oauth_generate_failed",
        provider: codexOAuthProvider,
        model,
        userMessage: "Codex OAuth 연결은 됐지만 답변 생성 호출에 실패했습니다.",
        errorMessage: redactSecretLike(usableAttempt.errorMessage, [
          credential.value.access,
          credential.value.refresh,
        ]),
        diagnosticStage: "codex_backend_failed",
        recoveryActions: buildCodexOAuthRecoveryActions("codex_backend_failed"),
        externalMutation: false,
        rawSecretMaterialStored: false,
        rawSecretMaterialReturned: false,
      };
      return { ...backendError, httpStatus: usableAttempt.httpStatus };
    }

    return {
      status: "codex_oauth_empty_response",
      provider: codexOAuthProvider,
      model,
      userMessage: "Codex OAuth 응답에서 텍스트를 찾지 못했습니다.",
      diagnosticStage: "codex_backend_empty_response",
      recoveryActions: buildCodexOAuthRecoveryActions("codex_backend_failed"),
      externalMutation: false,
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
    };
  } catch (error) {
    const timedOut = error?.name === "TimeoutError";
    const networkError = {
      status: timedOut ? "codex_oauth_timeout" : "codex_oauth_network_failed",
      provider: codexOAuthProvider,
      model,
      userMessage: timedOut ? "AI 답변을 기다리는 시간이 초과됐습니다. 저장한 자료는 유지됩니다. 다시 시도하거나 한 번에 정리할 자료를 줄여 주세요." : "AI 연결 중 네트워크 문제가 생겼습니다. 연결 상태를 확인한 뒤 다시 시도해 주세요.",
      errorMessage: redactSecretLike(error instanceof Error ? error.message : String(error), [
        credential.value.access,
        credential.value.refresh,
      ]),
      diagnosticStage: timedOut ? "codex_backend_timeout" : "codex_backend_network_failed",
      recoveryActions: buildCodexOAuthRecoveryActions("codex_backend_failed"),
      externalMutation: false,
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
    };
    return networkError;
  }
}

async function callCodexBackendText({ fetchFn, credential, model, prompt, timeoutMs }) {
  // Codex requires stream:true even when the renderer wants a single final answer.
  // Consume the same transport without emitting deltas; its timeout covers the body too.
  return callCodexBackendTextStream({ fetchFn, credential, model, prompt, timeoutMs });
}

// === 스트리밍 (대화감 개선) =================================================
// Codex는 같은 SSE 전송을 사용하며 대화 화면에만 델타를 전달한다.
// 선택한 계정/모델의 요청이 실패하면 다른 모델로 자동 전환하지 않는다.
async function generateTextStreaming(payload, options, onDelta) {
  const userPrompt = sanitizePrompt(payload.prompt);
  if (!userPrompt) {
    return generateText(payload, options);
  }

  const runtimeContext = createRuntimeContextReceipt(payload);
  const prompt = buildRuntimePrompt(userPrompt, payload);
  const vault = await readVault(options);
  notifyRuntimePromptObserver(options, prompt, payload);
  return generateSelectedModelText(payload, prompt, options, vault, runtimeContext, onDelta);
}

async function generateCodexOAuthTextStream(record, prompt, options, onDelta) {
  const credential = await resolveCodexCredential(record, options);
  if (credential.status !== "credential_ready") {
    return { status: credential.status, provider: codexOAuthProvider, model: record.model };
  }

  const model = normalizeModel(record.model, codexOAuthProvider);
  const fetchFn = resolveFetch(options);
  const attempt = await callCodexBackendTextStream({
    fetchFn,
    credential,
    model,
    prompt,
    timeoutMs: Number(options.codexStreamTimeoutMs ?? (prompt.length >= 6_000 ? codexLongRequestTimeoutMs : codexStreamTimeoutMs)),
    onDelta,
    abortSignal: options.abortSignal,
  });

  if (attempt.status === "generate_content_loaded") {
    return {
      status: "generate_content_loaded",
      provider: codexOAuthProvider,
      model: attempt.model,
      outputText: attempt.outputText,
      tokenUsage: attempt.tokenUsage,
      outputChars: attempt.outputText.length,
      promptChars: prompt.length,
      userMessage: "Codex 브라우저 로그인으로 앱 안에서 실제 답변을 만들었습니다.",
      auditMessages: [
        "Codex OAuth access token으로 ChatGPT/Codex backend 스트리밍 호출 완료",
        "OAuth token 원문은 renderer, 로그, 결과에 반환하지 않습니다.",
        "AI 응답은 채팅 답변이며 외부 발송, 캘린더 등록, 파일 쓰기는 실행하지 않았습니다.",
      ],
      streamed: true,
      externalMutation: false,
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
    };
  }

  // 비정상 → non-ready 반환하여 상위에서 one-shot 폴백
  return { status: attempt.status ?? "codex_oauth_generate_failed", provider: codexOAuthProvider, model, httpStatus: attempt.httpStatus, errorMessage: redactSecretLike(attempt.errorMessage ?? "", [credential.value.access, credential.value.refresh]) };
}

async function callCodexBackendTextStream({ fetchFn, credential, model, prompt, timeoutMs, onDelta, abortSignal }) {
  const controller = new AbortController();
  let timedOut = false;
  const timeout = setTimeout(() => { timedOut = true; controller.abort(); }, Number(timeoutMs));
  // 사용자가 '중지'하면 서버 스트림도 끊는다(뒤에서 계속 생성되며 사용량을 쓰지 않게).
  const stopOnCancel = () => controller.abort();
  abortSignal?.addEventListener?.("abort", stopOnCancel, { once: true });
  if (abortSignal?.aborted) controller.abort();
  try {
    const response = await fetchFn(codexBackendResponsesUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${credential.value.access}`,
        originator: codexOAuthOriginator,
        "User-Agent": "ModyCrew/desktop",
        Accept: "text/event-stream",
        ...(credential.value.accountId ? { "ChatGPT-Account-ID": credential.value.accountId } : {}),
      },
      body: JSON.stringify({
        model,
        instructions: modyAssistantInstructions,
        input: [
          {
            role: "user",
            content: [{ type: "input_text", text: prompt }],
          },
        ],
        stream: true,
        store: false,
      }),
      signal: controller.signal,
    });

    if (!response.ok || !response.body || typeof response.body.getReader !== "function" || response.headers?.get?.("content-type")?.includes("application/json")) {
      const json = await (response.json?.().catch(() => ({})) ?? Promise.resolve({}));
      if (response.ok) {
        const outputText = extractOpenAIResponseText(json).trim().slice(0, 24_000);
        if (outputText && typeof onDelta === "function") onDelta(outputText);
        return { status: outputText ? "generate_content_loaded" : "codex_oauth_empty_response", model, outputText, tokenUsage: normalizeAIResponseUsage("openai", json) };
      }
      return {
        status: "codex_oauth_generate_failed",
        model,
        httpStatus: response.status,
        errorMessage: json?.error?.message ?? json?.detail ?? response.statusText,
      };
    }

    const accumulated = await consumeOpenAIResponsesStream(response.body, onDelta);
    const outputText = accumulated.text.trim().slice(0, 24_000);
    if (!outputText) {
      return { status: "codex_oauth_empty_response", model, httpStatus: response.status, tokenUsage: accumulated.tokenUsage };
    }
    return { status: "generate_content_loaded", model, outputText, tokenUsage: accumulated.tokenUsage };
  } catch (error) {
    if (timedOut) {
      const timeoutError = new Error("AI response deadline exceeded");
      timeoutError.name = "TimeoutError";
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    abortSignal?.removeEventListener?.("abort", stopOnCancel);
  }
}

// OpenAI Responses API 의 SSE 스트림(`response.output_text.delta` 이벤트)을 파싱해
// 토큰을 누적하고, 각 델타를 onDelta 로 흘려보냅니다.
async function consumeOpenAIResponsesStream(body, onDelta) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";
  let tokenUsage = normalizeAIResponseUsage("openai", null);
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newlineIndex;
      while ((newlineIndex = buffer.indexOf("\n")) >= 0) {
        const rawLine = buffer.slice(0, newlineIndex).replace(/\r$/u, "");
        buffer = buffer.slice(newlineIndex + 1);
        const line = rawLine.trim();
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (!data || data === "[DONE]") continue;
        let parsed;
        try {
          parsed = JSON.parse(data);
        } catch {
          continue;
        }
        const type = String(parsed?.type ?? "");
        if (type === "response.output_text.delta" && typeof parsed.delta === "string") {
          full += parsed.delta;
          if (typeof onDelta === "function") onDelta(parsed.delta);
        } else if (type === "response.completed") {
          tokenUsage = normalizeAIResponseUsage("openai", parsed.response);
          if (!full) full = extractOpenAIResponseText(parsed.response ?? {});
        }
      }
    }
  } finally {
    try {
      reader.releaseLock?.();
    } catch {
      // noop
    }
  }
  return { text: full, tokenUsage };
}

// === 모델 이름 자동 탐색 =====================================================
// 모델 id 를 상수로 박아두면(gpt-5.6 등) 그 이름이 실제와 다른 순간 모든 답변이
// 막힌다. 실제 계정이 쓸 수 있는 모델 목록을 서버에서 받아와 고르고, 실패하면
// 그 목록을 순서대로 시도한다. 목록을 못 받으면 기존 상수로 되돌아간다.
function extractModelIds(json) {
  const buckets = [json?.data, json?.models, Array.isArray(json) ? json : null];
  const ids = [];
  for (const bucket of buckets) {
    if (!Array.isArray(bucket)) continue;
    for (const item of bucket) {
      const id = typeof item === "string" ? item : item?.id ?? item?.slug ?? item?.model ?? "";
      const value = String(id ?? "").trim();
      if (value && !ids.includes(value)) ids.push(value);
    }
  }
  return ids;
}

async function generateOpenAIText(record, prompt, options) {
  const credential = decryptVaultSecret(record.encryptedSecret, options.safeStorage);
  if (credential.status !== "credential_ready") {
    return {
      status: credential.status,
      provider: "openai",
      model: record.model,
      userMessage: credential.userMessage,
      externalMutation: false,
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
    };
  }

  const ModyOpenAILiveConnector = await loadOpenAIConnectorClass();
  const connector = new ModyOpenAILiveConnector(
    options.fetch ? { fetch: options.fetch } : {},
  );
  const result = await connector.generateContent({
    apiKey: credential.value,
    model: record.model,
    prompt,
  });

  return {
    status: result.status,
    provider: "openai",
    httpStatus: result.httpStatus,
    model: result.model,
    outputText: result.outputText,
    outputChars: result.outputChars,
    tokenUsage: result.tokenUsage,
    promptChars: result.promptChars,
    userMessage:
      result.status === "generate_content_loaded"
        ? "실제 OpenAI API로 답변을 만들었습니다. 외부 발송이나 파일 변경은 하지 않았습니다."
        : result.userMessage,
    errorMessage: result.errorMessage
      ? redactSecretLike(result.errorMessage, [credential.value])
      : undefined,
    auditMessages: result.auditMessages,
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

async function generateGeminiText(record, prompt, options) {
  const credential = decryptVaultSecret(record.encryptedSecret, options.safeStorage);
  if (credential.status !== "credential_ready") {
    return {
      status: credential.status,
      provider: "gemini",
      model: record.model,
      userMessage: credential.userMessage,
      externalMutation: false,
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
    };
  }

  const ModyGeminiLiveConnector = await loadGeminiConnectorClass();
  const connector = new ModyGeminiLiveConnector(
    options.fetch ? { fetch: options.fetch } : {},
  );
  const result = await connector.generateContent({
    apiKey: credential.value,
    model: record.model,
    prompt,
  });

  return {
    status: result.status,
    provider: "gemini",
    httpStatus: result.httpStatus,
    model: result.model,
    outputText: result.outputText,
    outputChars: result.outputChars,
    tokenUsage: result.tokenUsage,
    promptChars: result.promptChars,
    userMessage:
      result.status === "generate_content_loaded"
        ? "실제 Gemini API로 답변을 만들었습니다. 외부 발송이나 파일 변경은 하지 않았습니다."
        : result.userMessage,
    errorMessage: result.errorMessage
      ? redactSecretLike(result.errorMessage, [credential.value])
      : undefined,
    auditMessages: result.auditMessages,
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

/**
 * Claude(Anthropic) 로 실제 답변을 만든다.
 *
 * 선택한 공급자 경로에서 동일한 결과 계약을 유지한다.
 */
async function generateAnthropicText(record, prompt, options) {
  const credential = decryptVaultSecret(record.encryptedSecret, options.safeStorage);
  if (credential.status !== "credential_ready") {
    return {
      status: credential.status,
      provider: "anthropic",
      model: record.model,
      userMessage: credential.userMessage,
      externalMutation: false,
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
    };
  }

  const ModyAnthropicLiveConnector = await loadAnthropicConnectorClass();
  const connector = new ModyAnthropicLiveConnector(options.fetch ? { fetch: options.fetch } : {});
  const result = await connector.generateContent({
    apiKey: credential.value,
    model: record.model,
    preserveModelId: options.strictModelSelection === true,
    prompt,
  });

  return {
    status: result.status,
    provider: "anthropic",
    httpStatus: result.httpStatus,
    model: result.model,
    outputText: result.outputText,
    outputChars: result.outputChars,
    tokenUsage: result.tokenUsage,
    promptChars: result.promptChars,
    userMessage:
      result.status === "generate_content_loaded"
        ? "실제 Claude API로 답변을 만들었습니다. 외부 발송이나 파일 변경은 하지 않았습니다."
        : result.userMessage,
    errorMessage: result.errorMessage
      ? redactSecretLike(result.errorMessage, [credential.value])
      : undefined,
    auditMessages: result.auditMessages,
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

/**
 * 내 PC 안의 모델로 답변을 만든다.
 *
 * 다른 제공자와 다른 점 하나: **키가 없다.** 인증 없는 로컬 경로라 금고를 읽지 않는다.
 * 대신 어디로 보낼지(baseUrl)를 기록에서 읽는다. 결과 모양은 나머지와 같게 유지한다.
 *
 * 대화 내용이 이 PC 밖으로 나가지 않는 유일한 경로다 — 그것이 이 제공자의 값어치다.
 */
async function generateLocalModelText(record, prompt, options) {
  const ModyLocalModelLiveConnector = await loadLocalModelConnectorClass();
  const connector = new ModyLocalModelLiveConnector(options.fetch ? { fetch: options.fetch } : {});
  const result = await connector.generateContent({
    baseUrl: record.baseUrl,
    model: record.model,
    prompt,
  });

  return {
    status: result.status,
    provider: "local",
    model: result.model,
    outputText: result.outputText,
    outputChars: result.outputChars,
    tokenUsage: result.tokenUsage,
    promptChars: result.promptChars,
    userMessage: result.userMessage,
    errorMessage: result.errorMessage,
    auditMessages: result.auditMessages,
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}


/**
 * 내 PC 에서 켜져 있는 모델 런타임을 찾아 설치된 모델을 돌려준다.
 *
 * 화면(모델 고르는 줄)이 부른다. 아무것도 없을 때도 **왜 없는지** 를 담아 보낸다 —
 * 빈 목록만 주면 사용자는 앱이 고장 났다고 생각한다.
 */
async function listLocalModelsForUi(payload = {}, options = {}) {
  try {
    const ModyLocalModelLiveConnector = await loadLocalModelConnectorClass();
    const connector = new ModyLocalModelLiveConnector(options.fetch ? { fetch: options.fetch } : {});
    const result = await connector.listModels({
      baseUrl: typeof payload.baseUrl === "string" ? payload.baseUrl : undefined,
    });
    return {
      status: result.status,
      provider: "local",
      models: result.models ?? [],
      baseUrl: result.baseUrl ?? "",
      runtimeLabel: result.runtimeLabel ?? "",
      userMessage: result.userMessage,
      externalMutation: false,
    };
  } catch (error) {
    // 도메인 런타임 파일이 없는 설치본에서도 화면이 멈추면 안 된다.
    return {
      status: "local_model_list_failed",
      provider: "local",
      models: [],
      userMessage: "내 PC 안의 모델을 찾지 못했습니다. Ollama 나 LM Studio 를 켠 뒤 다시 시도해 주세요.",
      errorMessage: String(error?.message ?? error).slice(0, 200),
      externalMutation: false,
    };
  }
}

async function saveApiKey(payload, options) {
  const provider = normalizeProvider(payload.provider);
  if (provider === codexOAuthProvider) {
    throw new Error("Codex OAuth는 API key 저장 방식이 아닙니다. Codex 로그인으로 연결해 주세요.");
  }
  const secret = String(payload.payload?.secret ?? "").trim();
  const model = normalizeModel(payload.payload?.model, provider);
  const chatContentAllowed = payload.payload?.allowChatContent === true;

  if (secret.length < 8) {
    throw new Error("API key 길이가 너무 짧습니다.");
  }

  const { safeStorage } = options;
  if (!safeStorage?.isEncryptionAvailable?.()) {
    throw new Error("OS 보안 저장소 암호화를 사용할 수 없습니다.");
  }

  const keyFingerprint = createFingerprint(secret);
  const encryptedSecret = safeStorage.encryptString(secret).toString("base64");
  await mutateAIVault(options, (vault) => {
    vault.providers[provider] = {
      provider,
      model,
      accountUid: sanitizeAccountUid(payload.payload?.accountUid),
      syncSource:
        payload.payload?.syncSource === "account_cloud" ? "account_cloud" : "manual_input",
      chatContentAllowed,
      encryptedSecret,
      keyFingerprint,
      updatedAt: new Date().toISOString(),
    };
  });

  forgetModelAvailabilityScope(resolveVaultPath(options), provider);

  return {
    status: "stored_in_os_vault",
    provider,
    model,
    hasLocalKey: true,
    keyFingerprint,
    chatContentAllowed,
    userMessage: chatContentAllowed
      ? "AI 비밀값을 이 PC 보관함에 저장했습니다. 실제 답변 확인이 필요합니다."
      : "AI 비밀값은 저장했지만 대화 사용 동의 전에는 요청 내용을 보내지 않습니다.",
    rawSecretMaterialStored: false,
  };
}

async function saveProviderModel(payload, options) {
  const provider = normalizeProvider(payload.provider);
  const model = normalizeStoredModelPreference(payload.payload?.model, provider);
  const initialVault = await readVault(options);
  const { availability, context } = await providerModelAvailability(provider, options, { vault: initialVault });
  if (!chooseAvailableModel(availability, model)) return unavailableSelectedModel(provider, model, availability);
  const { JSON_STORE_SKIP_WRITE } = await loadAIVaultJsonStore();
  let unavailable = null;
  let current = { provider };
  // 연결이 바뀌었는지 확인하고 저장하는 일을 보관함 대기열 안에서 한 번에 한다.
  // (cachedOnly 확인은 토큰 갱신·보관함 저장을 하지 않으므로 대기열 안에서 불러도 안전하다.)
  const vault = await mutateAIVault(options, async (latestVault) => {
    const latestConnection = await providerModelAvailability(provider, options, { vault: latestVault, cachedOnly: true });
    if (context && (!latestConnection.context || latestConnection.context.secret !== context.secret || latestConnection.context.accountId !== context.accountId)) {
      unavailable = unavailableSelectedModel(provider, model, unavailableModelCatalog(provider, model, "connection_changed"));
      return JSON_STORE_SKIP_WRITE;
    }
    if (context && !chooseAvailableModel(latestConnection.availability, model)) {
      unavailable = unavailableSelectedModel(provider, model, latestConnection.availability);
      return JSON_STORE_SKIP_WRITE;
    }
    current = latestVault.providers[provider] ?? { provider };
    latestVault.providers[provider] = {
      ...current,
      provider,
      model,
      updatedAt: new Date().toISOString(),
    };
    latestVault.activeProvider = provider;
    return undefined;
  });
  if (unavailable) return unavailable;

  return {
    status: current.encryptedSecret ? "model_updated" : "model_preference_saved",
    provider,
    model,
    activeProvider: provider,
    isActive: true,
    modelAvailability: availability,
    hasLocalKey: Boolean(current.encryptedSecret),
    keyFingerprint: current.keyFingerprint,
    updatedAt: vault.providers[provider].updatedAt,
    authMode: provider === codexOAuthProvider ? "codex_oauth" : "api_key",
    userMessage:
      provider === codexOAuthProvider
        ? `Codex 답변 모델을 ${model}로 저장했습니다.`
        : subscriptionProviderIds.includes(provider) && model === subscriptionDefaultModelId
          ? "구독 계정의 기본 모델로 답변하도록 저장했습니다. 추가 요금 없이 계정 조건을 따릅니다."
          : `AI 답변 모델을 ${model}로 저장했습니다.`,
    rawSecretMaterialStored: false,
  };
}

async function clearCredential(payload, options) {
  const provider = normalizeProvider(payload.provider);
  // 지운 비밀값이 .previous 백업에 남지 않게 새 내용으로 백업도 맞춘다.
  await mutateAIVault(options, (vault) => {
    delete vault.providers[provider];
    if (vault.activeProvider === provider) delete vault.activeProvider;
  }, { previousMode: "mirror" });
  forgetModelAvailabilityScope(resolveVaultPath(options), provider);
  return {
    status: "cleared",
    provider,
    hasLocalKey: false,
    rawSecretMaterialStored: false,
  };
}

async function readVaultStatus(options) {
  const vault = await readVault(options);
  // Match the generation route for older vaults that predate activeProvider.
  const activeProvider = vault.activeProvider || (vault.providers[codexOAuthProvider]?.encryptedSecret ? codexOAuthProvider
    : ["openai", "gemini", "anthropic", "local", ...subscriptionProviderIds].find(id => vault.providers[id]));
  const codexStatus = await readCodexOAuthStatus(options, vault);
  const providerRecords = [codexStatus,
    ...Object.values(vault.providers).filter((record) => record?.provider !== codexOAuthProvider && textGenerationProviders.has(record?.provider))
      .map((record) => ({ status: "stored_in_os_vault", provider: record.provider, model: record.model, hasLocalKey: Boolean(record.encryptedSecret), keyFingerprint: record.keyFingerprint, updatedAt: record.updatedAt, syncSource: record.syncSource, chatContentAllowed: record.chatContentAllowed === true, authMode: "api_key", rawSecretMaterialStored: false }))];
  const providers = await Promise.all(providerRecords.map(async (record) => ({ ...record, isActive: record.provider === activeProvider,
    modelAvailability: (await providerModelAvailability(record.provider, options, { vault, cachedOnly: true })).availability })));
  return {
    status: "ready",
    activeProvider,
    providers,
  };
}

async function readAIRuntimeLiveProofs() {
  const proofSpecs = [
    {
      id: "role_live",
      label: "역할 실기",
      reportPath: "tmp/ai-runtime-role-live-probe-report.json",
      fallbackReportPath: "tmp/ai-runtime-role-live-probe-verify-report.json",
      summarize: summarizeRoleLiveProof,
    },
    {
      id: "mailops_workqueue",
      label: "메일 업무대장",
      reportPath: "tmp/ai-runtime-mailops-role-workqueue-live-report.json",
      fallbackReportPath: "tmp/ai-runtime-mailops-role-workqueue-report.json",
      summarize: summarizeMailOpsLiveProof,
    },
    {
      id: "release_readiness",
      label: "출시 실기",
      reportPath: "tmp/release-ai-runtime-readiness-report.json",
      summarize: summarizeGenericAIRuntimeProof,
    },
    {
      id: "setup_doctor",
      label: "연결 점검",
      reportPath: "tmp/ai-runtime-setup-doctor-report.json",
      summarize: summarizeGenericAIRuntimeProof,
    },
  ];
  const proofs = [];

  for (const spec of proofSpecs) {
    const primary = await readSafeTmpJsonReport(spec.reportPath);
    const fallback = primary ?? (spec.fallbackReportPath ? await readSafeTmpJsonReport(spec.fallbackReportPath) : null);
    if (!fallback) continue;
    proofs.push(spec.summarize(spec, fallback));
  }

  const verifiedCount = proofs.filter((proof) => proof.liveVerified).length;
  return {
    status: proofs.length > 0 ? "ai_runtime_live_proofs_loaded" : "ai_runtime_live_proofs_missing",
    proofCount: proofs.length,
    verifiedCount,
    proofs,
    userMessage:
      proofs.length > 0
        ? `최근 AI 실기 리포트 ${proofs.length}건 중 ${verifiedCount}건이 답변/업무 경로를 증명했습니다.`
        : "아직 저장된 AI 실기 리포트가 없습니다. 짧게 테스트를 먼저 실행해 주세요.",
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
  };
}

async function readSafeTmpJsonReport(relativePath) {
  const tmpRoot = path.resolve(repoRoot, "tmp");
  const filePath = path.resolve(repoRoot, relativePath);
  if (filePath !== tmpRoot && !filePath.startsWith(`${tmpRoot}${path.sep}`)) {
    return null;
  }
  if (!existsSync(filePath)) return null;
  try {
    const [raw, stats] = await Promise.all([readFile(filePath, "utf8"), stat(filePath).catch(() => null)]);
    return {
      report: JSON.parse(raw),
      reportPath: path.relative(repoRoot, filePath).replaceAll(path.sep, "/"),
      updatedAt: stats?.mtime?.toISOString?.() ?? "",
    };
  } catch {
    return null;
  }
}

function summarizeRoleLiveProof(spec, source) {
  const report = source.report ?? {};
  const result = report.result ?? {};
  const promptProof = report.outboundPromptProof ?? {};
  const mode = safeProofString(report.mode);
  const status = safeProofString(report.status);
  const answerReady = result.answerReady === true;
  const promptObserved = promptProof.providerRequestObserved === true;
  const reportFresh = isFreshAIRuntimeLiveProof(report.createdAt || source.updatedAt);
  return sanitizeLiveProofItem({
    id: spec.id,
    label: spec.label,
    status,
    mode,
    provider: safeProofString(report.provider),
    model: safeProofString(report.model),
    reportPath: source.reportPath,
    answerReady,
    liveVerified: reportFresh && mode === "live" && status === "ai_runtime_role_live_answer_ready" && answerReady && promptObserved,
    promptObserved,
    contract: safeProofString(result.runtimeAssignmentContract ?? report.roleProbeContract),
    workContract: safeProofString(result.roleWorkAutomationContract),
    createdAt: safeProofString(report.createdAt),
    updatedAt: source.updatedAt,
    reportFresh,
    reportAgeMs: reportAgeMs(report.createdAt || source.updatedAt),
    proofExpired: !reportFresh,
  });
}

function summarizeMailOpsLiveProof(spec, source) {
  const report = source.report ?? {};
  const runtime = report.aiRuntime ?? {};
  const queue = report.mailOpsWorkQueue ?? {};
  const promptProof = report.providerPrompt ?? {};
  const mode = safeProofString(report.mode);
  const status = safeProofString(report.status);
  const answerReady = runtime.answerReady === true;
  const promptObserved = promptProof.providerRequestObserved === true;
  const reportFresh = isFreshAIRuntimeLiveProof(report.createdAt || source.updatedAt);
  return sanitizeLiveProofItem({
    id: spec.id,
    label: spec.label,
    status,
    mode,
    provider: safeProofString(report.provider),
    model: safeProofString(report.model),
    reportPath: source.reportPath,
    answerReady,
    liveVerified: reportFresh && mode === "live" && status === "ai_runtime_mailops_role_workqueue_live_answer_ready" && answerReady && promptObserved,
    promptObserved,
    contract: safeProofString(report.contract),
    workContract: "mailops_role_workqueue_v1",
    rowCount: Number.isFinite(queue.rowCount) ? queue.rowCount : 0,
    finalReadyCount: Number.isFinite(queue.finalReadyCount) ? queue.finalReadyCount : 0,
    createdAt: safeProofString(report.createdAt),
    updatedAt: source.updatedAt,
    reportFresh,
    reportAgeMs: reportAgeMs(report.createdAt || source.updatedAt),
    proofExpired: !reportFresh,
  });
}

function summarizeGenericAIRuntimeProof(spec, source) {
  const report = source.report ?? {};
  const status = safeProofString(report.status);
  const mode = safeProofString(report.mode);
  const setupDoctorOnly = spec.id === "setup_doctor";
  const reportFresh = setupDoctorOnly ? true : isFreshAIRuntimeLiveProof(report.createdAt || source.updatedAt);
  const answerReady =
    report.answerReady === true ||
    report.result?.answerReady === true ||
    report.aiRuntime?.answerReady === true ||
    (!setupDoctorOnly && reportFresh && status.includes("live_verified"));
  const liveVerified =
    !setupDoctorOnly &&
    reportFresh &&
    (mode === "live" || status.includes("live_verified") || status.includes("live_answer_ready"));
  return sanitizeLiveProofItem({
    id: spec.id,
    label: spec.label,
    status,
    mode,
    provider: safeProofString(report.provider ?? report.readyProvider),
    model: safeProofString(report.model),
    reportPath: source.reportPath,
    answerReady,
    liveVerified,
    promptObserved: report.providerRequestObserved === true || report.result?.providerRequestObserved === true,
    contract: safeProofString(report.contract ?? report.setupDoctorContract),
    workContract: "",
    runtimeTrackStatus: safeProofString(report.runtimeTrackStatus),
    liveProviderTrackStatus: safeProofString(report.liveProviderTrackStatus),
    roleRuntimeTrackStatus: safeProofString(report.roleRuntimeTrackStatus),
    mailOpsRoleWorkQueueTrackStatus: safeProofString(report.mailOpsRoleWorkQueueTrackStatus),
    routerSafetyTrackStatus: safeProofString(report.routerSafetyTrackStatus),
    liveReadyGroups: Number.isFinite(report.liveReadyGroups) ? report.liveReadyGroups : 0,
    latestLiveReports: Number.isFinite(report.latestLiveReports) ? report.latestLiveReports : 0,
    releaseBlockerSummary: safeProofString(report.releaseBlockerSummary),
    createdAt: safeProofString(report.createdAt),
    updatedAt: source.updatedAt,
    reportFresh,
    reportAgeMs: reportAgeMs(report.createdAt || source.updatedAt),
    proofExpired: !reportFresh,
  });
}

function isFreshAIRuntimeLiveProof(createdAt) {
  const ageMs = reportAgeMs(createdAt);
  return Number.isFinite(ageMs) && ageMs >= 0 && ageMs <= aiRuntimeLiveProofMaxAgeMs;
}

function reportAgeMs(createdAt) {
  const time = Date.parse(String(createdAt ?? ""));
  if (!Number.isFinite(time)) return Number.POSITIVE_INFINITY;
  return Date.now() - time;
}

function sanitizeLiveProofItem(item) {
  return {
    ...item,
    externalMutation: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
    rawPromptStored: false,
  };
}

function safeProofString(value) {
  return typeof value === "string" ? value.slice(0, 240) : "";
}

async function startOAuth(payload, options = {}) {
  const provider = normalizeProvider(payload.provider);
  if (provider !== codexOAuthProvider) {
    throw new Error(`OAuth 시작을 지원하지 않는 provider 입니다: ${provider}`);
  }

  const vault = await readVault(options);
  const status = await readCodexOAuthStatus(options, vault);
  if (status.status === "codex_oauth_ready" && !payload.forceReconnect) {
    return {
      ...status,
      userMessage: "Codex 브라우저 로그인이 연결되어 있습니다. 실제 답변 확인을 한 번 실행해 주세요.",
    };
  }

  const selectedModel = normalizeStoredModelPreference(payload.model, codexOAuthProvider);
  const callbackPort = resolveCodexCallbackPort(options);
  const existingGuard = readActiveCodexOAuthLaunchGuard(callbackPort);
  // 가드는 '이미 브라우저가 열려 있으니 창을 또 만들지 말자'는 장치다.
  // 그런데 직전 시도가 브라우저를 못 열었을 때도 가드가 기록돼 있어서,
  // 사용자가 다시 눌러도 90초 동안 "이미 열었습니다"만 나오고 아무 창도 뜨지 않았다
                                                  
  // 실제로 연 적이 있을 때만 재실행을 막는다.
  // 단 disableExternalLaunch(테스트·CLI 모드)는 애초에 창을 안 여는 게 정상이므로
  // 그때는 기존대로 중복 세션만 막는다.
  const externalLaunchDisabled = Boolean(options.disableExternalLaunch);
  if (
    existingGuard &&
    (existingGuard.externalUrlOpened || externalLaunchDisabled) &&
    !payload.forceReconnect
  ) {
    return {
      ...status,
      status: "codex_oauth_login_in_progress",
      loginUrl: existingGuard.authorizationUrl,
      authorizationUrl: existingGuard.authorizationUrl,
      callbackUrl: existingGuard.callbackUrl,
      callbackPort,
      state: existingGuard.state,
      externalUrlOpened: false,
      cliLoginStarted: false,
      diagnosticStage: "browser_login_already_open",
      recoveryActions: [
        "이미 열린 브라우저 로그인 창에서 인증 마무리",
        "실패하면 잠시 뒤 사용자가 다시 연결 버튼 누르기",
        "대체 답변 연결 확인",
      ],
      userMessage:
        "AI 로그인 창은 이미 한 번 열었습니다. 새 창을 또 만들지 않고, 열린 브라우저에서 인증을 마친 뒤 앱으로 돌아와 주세요.",
      rawSecretMaterialStored: false,
    };
  }

  const session = await startCodexBrowserOAuthSession({ ...options, codexOAuthModel: selectedModel }).catch((error) =>
    createCodexOAuthStartFailureStatus(error, status, options),
  );
  if (session?.status) {
    return session;
  }
  const launch = await openCodexOAuthWindow(options, session.authorizationUrl).catch((error) => ({
    externalUrlOpened: false,
    cliLoginStarted: false,
    errorMessage: error instanceof Error ? error.message : String(error),
  }));
  rememberCodexOAuthLaunchGuard(callbackPort, session, launch.externalUrlOpened);

  if (status.hasLocalKey) {
    return {
      ...status,
      status: "codex_oauth_login_started",
      loginUrl: session.authorizationUrl,
      authorizationUrl: session.authorizationUrl,
      callbackUrl: session.callbackUrl,
      callbackPort: session.callbackPort,
      state: session.state,
      externalUrlOpened: launch.externalUrlOpened,
      cliLoginStarted: false,
      diagnosticStage: launch.errorMessage ? "open_external_failed" : "browser_login_waiting",
      recoveryActions: buildCodexOAuthRecoveryActions(launch.errorMessage ? "open_external_failed" : "browser_login_waiting"),
      userMessage: launch.externalUrlOpened
        ? "Codex 브라우저 로그인을 열었습니다. 인증이 끝나면 앱이 localhost callback으로 받아 저장합니다."
        : buildCodexLaunchMessage(launch),
      errorMessage: launch.errorMessage ? redactSecretLike(launch.errorMessage) : undefined,
    };
  }

  return {
    ...status,
    status: launch.externalUrlOpened
      ? "codex_oauth_login_started"
      : "codex_oauth_action_required",
    loginUrl: session.authorizationUrl,
    authorizationUrl: session.authorizationUrl,
    callbackUrl: session.callbackUrl,
    callbackPort: session.callbackPort,
    state: session.state,
    externalUrlOpened: launch.externalUrlOpened,
    cliLoginStarted: false,
    diagnosticStage: launch.errorMessage ? "open_external_failed" : "browser_login_waiting",
    recoveryActions: buildCodexOAuthRecoveryActions(launch.errorMessage ? "open_external_failed" : "browser_login_waiting"),
    errorMessage: launch.errorMessage ? redactSecretLike(launch.errorMessage) : undefined,
    userMessage: buildCodexLaunchMessage(launch),
  };
}

async function startCodexBrowserOAuthSession(options = {}) {
  const callbackPort = resolveCodexCallbackPort(options);
  const callbackUrl = `http://localhost:${callbackPort}${codexCallbackPath}`;
  const { verifier, challenge } = createPkcePair();
  const state = crypto.randomBytes(16).toString("hex");
  const authorizationUrl = buildCodexAuthorizationUrl({
    callbackUrl,
    challenge,
    state,
  });

  const existingSession = activeCodexOAuthSessions.get(callbackPort);
  existingSession?.close?.();
  codexOAuthLaunchGuards.delete(callbackPort);

  const session = await createCodexCallbackServer({
    callbackPort,
    callbackUrl,
    state,
    verifier,
    model: normalizeModel(options.codexOAuthModel, codexOAuthProvider),
    options,
  });
  activeCodexOAuthSessions.set(callbackPort, session);

  return {
    authorizationUrl,
    callbackUrl,
    callbackPort,
    state,
    close: session.close,
  };
}

function readActiveCodexOAuthLaunchGuard(callbackPort) {
  const guard = codexOAuthLaunchGuards.get(callbackPort);
  if (!guard) return null;
  if (Date.now() - guard.startedAt > codexOAuthBrowserLaunchCooldownMs) {
    codexOAuthLaunchGuards.delete(callbackPort);
    return null;
  }
  if (!activeCodexOAuthSessions.has(callbackPort)) {
    codexOAuthLaunchGuards.delete(callbackPort);
    return null;
  }
  return guard;
}

function rememberCodexOAuthLaunchGuard(callbackPort, session, externalUrlOpened) {
  codexOAuthLaunchGuards.set(callbackPort, {
    authorizationUrl: session.authorizationUrl,
    callbackUrl: session.callbackUrl,
    state: session.state,
    externalUrlOpened: Boolean(externalUrlOpened),
    startedAt: Date.now(),
  });
}

async function openCodexOAuthWindow(options, authorizationUrl) {
  if (options.disableExternalLaunch) {
    return { externalUrlOpened: false, cliLoginStarted: false };
  }

  const externalUrlOpened = await openAllowedExternalUrl(options.shell, authorizationUrl);
  return { externalUrlOpened, cliLoginStarted: false };
}

async function openAllowedExternalUrl(shellApi, url) {
  if (!shellApi) return false;

  const parsed = new URL(url);
  const isAllowed =
    parsed.protocol === "https:" &&
    parsed.hostname === "auth.openai.com" &&
    parsed.pathname === "/oauth/authorize" &&
    parsed.searchParams.get("client_id") === codexClientId &&
    parsed.searchParams.get("redirect_uri")?.startsWith("http://localhost:") &&
    parsed.searchParams.get("redirect_uri")?.endsWith(codexCallbackPath);
  if (!isAllowed) {
    throw new Error(`허용되지 않은 Codex OAuth URL 입니다: ${url}`);
  }

  const openExternal = shellApi["openExternal"];
  if (typeof openExternal !== "function") return false;
  await openExternal.call(shellApi, parsed.toString());
  return true;
}

function buildCodexLaunchMessage(launch) {
  if (launch.externalUrlOpened) {
    return "Codex 브라우저 로그인을 열었습니다. 브라우저에서 OpenAI 계정을 선택하면 앱이 자동으로 연결을 마무리합니다.";
  }
  if (launch.errorMessage) {
    return "Codex 브라우저 로그인 링크를 준비했지만 자동으로 열지는 못했습니다. 앱의 로그인 버튼을 눌러 인증해 주세요.";
  }
  return "Codex 브라우저 로그인 링크를 준비했습니다. 자동으로 열리지 않으면 앱의 로그인 버튼을 눌러 인증해 주세요.";
}

function createCodexOAuthStartFailureStatus(error, previousStatus = {}, options = {}) {
  const callbackPort = resolveCodexCallbackPort(options);
  const message = error instanceof Error ? error.message : String(error);
  const isPortBusy = error?.code === "EADDRINUSE" || /EADDRINUSE|address already in use/i.test(message);
  const isAccessDenied = error?.code === "EACCES" || /EACCES|permission denied/i.test(message);
  const status = isPortBusy
    ? "codex_oauth_callback_port_busy"
    : isAccessDenied
      ? "codex_oauth_callback_permission_denied"
      : "codex_oauth_callback_failed";
  return {
    ...previousStatus,
    status,
    provider: codexOAuthProvider,
    model: normalizeModel("", codexOAuthProvider),
    authMode: "codex_oauth",
    hasLocalKey: Boolean(previousStatus?.hasLocalKey),
    loginUrl: codexLoginUrl,
    callbackUrl: `http://localhost:${callbackPort}${codexCallbackPath}`,
    callbackPort,
    diagnosticStage: isPortBusy ? "callback_port_busy" : isAccessDenied ? "callback_permission_denied" : "callback_server_failed",
    recommendedCommand: isPortBusy ? `netstat -ano | findstr :${callbackPort}` : undefined,
    recoveryActions: buildCodexOAuthRecoveryActions(isPortBusy ? "callback_port_busy" : "callback_server_failed"),
    userMessage: isPortBusy
      ? `Codex OAuth callback 포트 ${callbackPort}를 다른 프로그램이 사용 중입니다. 다른 Codex/OpenClaw 로그인 창을 닫고 다시 연결해 주세요.`
      : isAccessDenied
        ? `Codex OAuth callback 포트 ${callbackPort}를 열 권한이 없습니다. 앱을 다시 실행한 뒤 연결해 주세요.`
        : "Codex OAuth callback 서버를 열지 못했습니다. 앱을 다시 실행한 뒤 연결을 다시 시도해 주세요.",
    errorMessage: redactSecretLike(message),
    externalMutation: false,
    rawSecretMaterialStored: false,
  };
}

function buildCodexOAuthRecoveryActions(stage = "") {
  if (stage === "callback_port_busy") {
    return [
      "다른 OpenClaw/Codex 로그인 흐름을 닫고 다시 연결",
      "포트 점유 프로세스 확인",
      "그래도 막히면 Codex CLI 로그인 상태로 fallback",
      "저장된 OpenAI/Gemini API fallback 준비",
    ];
  }
  if (stage === "open_external_failed") {
    return [
      "앱에 표시된 auth.openai.com 링크를 직접 열기",
      "브라우저에서 OpenAI 계정 선택",
      "localhost callback 완료 후 앱에서 상태 새로고침",
    ];
  }
  if (stage === "codex_backend_failed" || stage === "codex_cli_failed") {
    return [
      "Codex 브라우저 로그인 재승인",
      "Codex 앱/CLI 최신 버전 확인",
      "저장된 OpenAI/Gemini API fallback 사용",
      "요청을 보관하고 재시도",
    ];
  }
  if (stage === "codex_cli_model_unsupported") {
    return [
      "ModyCrew와 Codex 앱/CLI 최신 버전으로 업데이트",
      "모델 지원이 막히면 OpenAI/Gemini API fallback 연결",
      "방금 요청 이어서 처리로 같은 대화에서 재시도",
      "계속 실패하면 Codex OAuth를 다시 연결",
    ];
  }
  if (stage === "codex_cli_not_installed") {
    return [
      "앱에서 AI 연결 복구 도구 설치 승인",
      "설치 후 AI 브라우저 로그인으로 연결",
      "설치 없이 쓰려면 저장된 OpenAI/Gemini API fallback 연결",
    ];
  }
  return [
    "Codex 브라우저 로그인 재시도",
    "Codex CLI 로그인 상태 확인",
    "OpenAI/Gemini API fallback 준비",
  ];
}

async function readCodexOAuthStatus(options = {}, vault = null) {
  const activeVault = vault ?? (options.app ? await readVault(options) : { providers: {} });
  const storedRecord = activeVault.providers?.[codexOAuthProvider];
  if (storedRecord?.encryptedSecret) {
    const credential = await resolveCodexCredential(storedRecord, options);
    if (credential.status === "credential_ready") {
      return {
        status: "codex_oauth_ready",
        provider: codexOAuthProvider,
        model: normalizeModel(storedRecord.model, codexOAuthProvider),
        // 해석 전 저장값도 함께 준다. 화면이 "최신 자동"을 고른 상태를 복원하려면
        // 해석된 구체 id 가 아니라 저장된 별칭이 필요하다.
        modelPreference: normalizeStoredModelPreference(storedRecord.model, codexOAuthProvider),
        authMode: "codex_oauth",
        hasLocalKey: true,
        accountId: credential.value.accountId,
        email: credential.value.email,
        keyFingerprint: storedRecord.keyFingerprint,
        updatedAt: storedRecord.updatedAt,
        loginUrl: codexLoginUrl,
        userMessage: "Codex 브라우저 로그인이 연결되어 있습니다. 실제 답변 확인이 필요합니다.",
        rawSecretMaterialStored: false,
      };
    }

    return {
      status: credential.status ?? "codex_oauth_vault_unreadable",
      provider: codexOAuthProvider,
      model: normalizeModel(storedRecord.model, codexOAuthProvider),
        // 해석 전 저장값도 함께 준다. 화면이 "최신 자동"을 고른 상태를 복원하려면
        // 해석된 구체 id 가 아니라 저장된 별칭이 필요하다.
        modelPreference: normalizeStoredModelPreference(storedRecord.model, codexOAuthProvider),
      authMode: "codex_oauth",
      hasLocalKey: false,
      keyFingerprint: storedRecord.keyFingerprint,
      updatedAt: storedRecord.updatedAt,
      loginUrl: codexLoginUrl,
      userMessage: credential.userMessage ?? "저장된 Codex OAuth 토큰을 읽지 못했습니다. 다시 연결해 주세요.",
      rawSecretMaterialStored: false,
    };
  }

  const authFile = options.disableCodexAuthFileDetection ? null : await findCodexAuthFile();
  if (!authFile) {
    return {
      status: "codex_oauth_not_connected",
      provider: codexOAuthProvider,
      model: normalizeModel("", codexOAuthProvider),
      authMode: "codex_oauth",
      hasLocalKey: false,
      loginUrl: codexLoginUrl,
      userMessage: "Codex 브라우저 로그인이 아직 앱에 연결되지 않았습니다.",
      rawSecretMaterialStored: false,
    };
  }

  const authStat = await stat(authFile);
  const keyFingerprint = crypto
    .createHash("sha256")
    .update(`${authFile}:${authStat.size}:${authStat.mtimeMs}`)
    .digest("hex")
    .slice(0, 12)
    .toUpperCase();

  return {
    status: "codex_oauth_detected",
    provider: codexOAuthProvider,
    model: normalizeModel("", codexOAuthProvider),
    authMode: "codex_oauth",
    hasLocalKey: true,
    loginUrl: codexLoginUrl,
    keyFingerprint,
    updatedAt: authStat.mtime.toISOString(),
    userMessage: "기존 Codex OAuth 파일이 감지됐습니다. 앱 내부 채팅용으로는 브라우저 로그인을 한 번 더 연결해 주세요.",
    rawSecretMaterialStored: false,
  };
}

function createCodexCallbackServer(params) {
  const { callbackPort, callbackUrl, state, verifier, model, options } = params;
  const servers = [];
  const requestHandler = async (req, res) => {
    try {
      const requestUrl = new URL(req.url ?? "/", `http://localhost:${callbackPort}`);
      if (requestUrl.pathname !== codexCallbackPath) {
        res.statusCode = 404;
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.end(renderCodexOAuthPage("오류", "Codex 인증 callback 경로가 아닙니다.", false));
        return;
      }

      const receivedState = requestUrl.searchParams.get("state") ?? "";
      const code = requestUrl.searchParams.get("code") ?? "";
      if (!receivedState || receivedState !== state) {
        res.statusCode = 400;
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.end(renderCodexOAuthPage("오류", "인증 상태값이 맞지 않습니다. 앱에서 다시 연결을 시작해 주세요.", false));
        return;
      }
      if (!code) {
        res.statusCode = 400;
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.end(renderCodexOAuthPage("오류", "OpenAI 인증 코드가 전달되지 않았습니다.", false));
        return;
      }

      const token = await exchangeCodexAuthorizationCode({
        code,
        verifier,
        callbackUrl,
        options,
      });
      await storeCodexOAuthCredential(token, { ...options, codexOAuthModel: model });

      res.statusCode = 200;
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(renderCodexOAuthPage("로그인 완료", "ModyCrew 앱으로 돌아가면 실제 답변 확인이 자동으로 진행됩니다.", true));
      closeCodexOAuthSession(callbackPort);
    } catch (error) {
      res.statusCode = 500;
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.end(
        renderCodexOAuthPage(
          "연결 실패",
          redactSecretLike(error instanceof Error ? error.message : String(error)),
          false,
        ),
      );
    }
  };

  return new Promise((resolve, reject) => {
    let settled = false;
    let closing = false;
    const requiredServer = createServer(requestHandler);
    requiredServer.once("error", (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
    requiredServer.listen(callbackPort, "127.0.0.1", () => {
      if (settled) return;
      settled = true;
      servers.push(requiredServer);
      const optionalServer = createServer(requestHandler);
      optionalServer.once("error", () => {
        // IPv6 loopback may be unavailable or already covered by the OS socket.
      });
      optionalServer.listen(callbackPort, "::1", () => {
        servers.push(optionalServer);
        if (closing) {
          try {
            optionalServer.close();
          } catch {
            // already closed
          }
        }
      });
      resolve({
        close: () => {
          closing = true;
          for (const server of servers) {
            try {
              server.close();
            } catch {
              // already closed
            }
          }
        },
      });
    });
  });
}

function closeCodexOAuthSession(callbackPort) {
  const session = activeCodexOAuthSessions.get(callbackPort);
  if (!session) return;
  activeCodexOAuthSessions.delete(callbackPort);
  codexOAuthLaunchGuards.delete(callbackPort);
  session.close?.();
}

function buildCodexAuthorizationUrl({ callbackUrl, challenge, state }) {
  const url = new URL(codexLoginUrl);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", codexClientId);
  url.searchParams.set("redirect_uri", callbackUrl);
  url.searchParams.set("scope", codexScope);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("state", state);
  url.searchParams.set("id_token_add_organizations", "true");
  url.searchParams.set("codex_cli_simplified_flow", "true");
  url.searchParams.set("originator", codexOAuthOriginator);
  return url.toString();
}

function createPkcePair() {
  const verifier = base64Url(crypto.randomBytes(32));
  const challenge = base64Url(crypto.createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

async function exchangeCodexAuthorizationCode({ code, verifier, callbackUrl, options }) {
  const response = await resolveFetch(options)(codexTokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      originator: codexOAuthOriginator,
      "User-Agent": "ModyCrew/desktop",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: codexClientId,
      code,
      code_verifier: verifier,
      redirect_uri: callbackUrl,
    }),
  });
  const bodyText = await response.text();
  const body = parseJsonObject(bodyText);
  if (!response.ok) {
    throw new Error(`OpenAI Codex token exchange failed: HTTP ${response.status} ${sanitizeOauthErrorText(bodyText)}`);
  }

  const access = trimNonEmptyString(body?.access_token);
  const refresh = trimNonEmptyString(body?.refresh_token);
  if (!access || !refresh) {
    throw new Error("OpenAI Codex token exchange response did not include access and refresh tokens.");
  }

  const expiresInMs = normalizeTokenLifetimeMs(body?.expires_in);
  const identity = resolveCodexIdentity(access);
  return {
    access,
    refresh,
    expires: expiresInMs ? Date.now() + expiresInMs : resolveCodexAccessTokenExpiry(access) ?? Date.now(),
    accountId: identity.accountId,
    email: identity.email,
    profileName: identity.profileName,
    chatgptPlanType: identity.chatgptPlanType,
  };
}

async function refreshCodexCredential(credential, options) {
  const response = await resolveFetch(options)(codexTokenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      originator: codexOAuthOriginator,
      "User-Agent": "ModyCrew/desktop",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: codexClientId,
      refresh_token: credential.refresh,
    }),
  });
  const bodyText = await response.text();
  const body = parseJsonObject(bodyText);
  if (!response.ok) {
    throw new Error(`OpenAI Codex token refresh failed: HTTP ${response.status} ${sanitizeOauthErrorText(bodyText)}`);
  }

  const access = trimNonEmptyString(body?.access_token);
  const refresh = trimNonEmptyString(body?.refresh_token) || credential.refresh;
  if (!access) {
    throw new Error("OpenAI Codex token refresh response did not include an access token.");
  }

  const identity = resolveCodexIdentity(access);
  return {
    access,
    refresh,
    expires:
      normalizeTokenLifetimeMs(body?.expires_in) ? Date.now() + normalizeTokenLifetimeMs(body?.expires_in) : resolveCodexAccessTokenExpiry(access) ?? Date.now(),
    accountId: identity.accountId ?? credential.accountId,
    email: identity.email ?? credential.email,
    profileName: identity.profileName ?? credential.profileName,
    chatgptPlanType: identity.chatgptPlanType ?? credential.chatgptPlanType,
  };
}

/**
 * Codex 로그인 정보를 보관함에 저장한다.
 * expectedEncryptedSecret 을 주면(토큰 갱신) 그 사이 다른 로그인·해제로 저장값이 바뀐 경우
 * 덮어쓰지 않는다. 사용자가 방금 다시 로그인한 계정을 옛 계정 갱신본이 지우지 않게 한다.
 */
async function storeCodexOAuthCredential(credential, options, { expectedEncryptedSecret } = {}) {
  const { safeStorage } = options;
  if (!safeStorage?.isEncryptionAvailable?.()) {
    throw new Error("OS 보안 저장소 암호화를 사용할 수 없습니다.");
  }

  const serialized = JSON.stringify({
    access: credential.access,
    refresh: credential.refresh,
    expires: credential.expires,
    accountId: credential.accountId,
    email: credential.email,
    profileName: credential.profileName,
    chatgptPlanType: credential.chatgptPlanType,
  });
  const encryptedSecret = safeStorage.encryptString(serialized).toString("base64");
  const { JSON_STORE_SKIP_WRITE } = await loadAIVaultJsonStore();
  let stored = false;
  await mutateAIVault(options, (vault) => {
    const existing = vault.providers[codexOAuthProvider];
    if (expectedEncryptedSecret !== undefined && (existing?.encryptedSecret ?? "") !== expectedEncryptedSecret) {
      return JSON_STORE_SKIP_WRITE;
    }
    vault.providers[codexOAuthProvider] = {
      provider: codexOAuthProvider,
      model: normalizeStoredModelPreference(options.codexOAuthModel ?? existing?.model, codexOAuthProvider),
      authMode: "codex_oauth",
      encryptedSecret,
      keyFingerprint: createFingerprint(`${credential.accountId ?? ""}:${credential.refresh}`),
      updatedAt: new Date().toISOString(),
    };
    stored = true;
    return undefined;
  });
  if (stored) forgetModelAvailabilityScope(resolveVaultPath(options), codexOAuthProvider);
  return stored;
}

// Codex 토큰 갱신은 보관함마다 한 번에 하나만 한다. refresh token 은 한 번 쓰면 바뀌므로
// 채팅과 배경 업무가 같은 토큰으로 동시에 갱신하면 두 번째가 거절되고 로그인이 풀렸다.
const codexRefreshInFlight = new Map();

function codexRefreshFlightKey(options) {
  const resolved = path.resolve(resolveVaultPath(options));
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function isCodexCredentialFresh(credential) {
  return !credential.expires || credential.expires > Date.now() + 60_000;
}

async function refreshCodexCredentialOnce(parsed, record, options) {
  let base = parsed;
  let baseEncryptedSecret = record.encryptedSecret ?? "";
  // 호출자가 읽은 뒤 다른 호출이 이미 갱신해 저장했으면 그 값을 그대로 쓴다.
  try {
    const latest = (await readVault(options)).providers?.[codexOAuthProvider];
    if (latest?.encryptedSecret && latest.encryptedSecret !== baseEncryptedSecret) {
      const decrypted = decryptVaultSecret(latest.encryptedSecret, options.safeStorage);
      const latestParsed = decrypted.status === "credential_ready" ? parseCodexCredential(decrypted.value) : null;
      if (latestParsed) {
        if (isCodexCredentialFresh(latestParsed)) return latestParsed;
        base = latestParsed;
        baseEncryptedSecret = latest.encryptedSecret;
      }
    }
  } catch {
    // 보관함을 다시 읽지 못하면 호출자가 준 값으로 갱신한다.
  }
  let refreshed;
  try {
    refreshed = await refreshCodexCredential(base, options);
  } catch (error) {
    throw new Error(redactSecretLike(error instanceof Error ? error.message : String(error), [base.refresh, parsed.refresh]));
  }
  await storeCodexOAuthCredential(refreshed, options, { expectedEncryptedSecret: baseEncryptedSecret });
  return refreshed;
}

async function resolveCodexCredential(record, options) {
  const credential = decryptVaultSecret(record.encryptedSecret, options.safeStorage);
  if (credential.status !== "credential_ready") {
    return {
      status: credential.status,
      userMessage: credential.userMessage,
    };
  }

  const parsed = parseCodexCredential(credential.value);
  if (!parsed) {
    return {
      status: "codex_oauth_credential_invalid",
      userMessage: "저장된 Codex OAuth 정보를 읽지 못했습니다. 다시 연결해 주세요.",
    };
  }

  if (isCodexCredentialFresh(parsed)) {
    return { status: "credential_ready", value: parsed };
  }

  try {
    const flightKey = codexRefreshFlightKey(options);
    let flight = codexRefreshInFlight.get(flightKey);
    if (!flight) {
      flight = refreshCodexCredentialOnce(parsed, record, options);
      codexRefreshInFlight.set(flightKey, flight);
      const clearFlight = () => {
        if (codexRefreshInFlight.get(flightKey) === flight) codexRefreshInFlight.delete(flightKey);
      };
      flight.then(clearFlight, clearFlight);
    }
    const refreshed = await flight;
    return { status: "credential_ready", value: refreshed };
  } catch (error) {
    return {
      status: "codex_oauth_refresh_failed",
      userMessage: `Codex OAuth 토큰을 갱신하지 못했습니다. 다시 연결해 주세요. ${redactSecretLike(error instanceof Error ? error.message : String(error), [parsed.refresh])}`,
    };
  }
}

async function findCodexAuthFile() {
  const home = os.homedir();
  const candidates = [
    process.env.CODEX_AUTH_FILE,
    home ? path.join(home, ".codex", "auth.json") : "",
    process.env.APPDATA ? path.join(process.env.APPDATA, "Codex", "auth.json") : "",
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      const authStat = await stat(candidate);
      if (authStat.isFile()) return candidate;
    } catch (error) {
      if (error?.code !== "ENOENT") continue;
    }
  }

  return "";
}

// AI 연결 보관함 저장은 json-store 의 파일별 대기열·원자적 쓰기·.previous 백업을 쓴다.
// 예전엔 모델 저장과 토큰 갱신이 겹치면 키가 사라지거나 파일이 깨져 AI가 영구 불통이 됐다.
let aiVaultJsonStoreModulePromise;
const loadAIVaultJsonStore = () => (aiVaultJsonStoreModulePromise ??= import("./json-store.mjs"));

function parseAIVaultShape(parsed) {
  if (
    !parsed ||
    typeof parsed !== "object" ||
    !parsed.providers ||
    typeof parsed.providers !== "object" ||
    Array.isArray(parsed.providers)
  ) {
    throw new Error("invalid_ai_provider_vault_shape");
  }
  return { version: 1, providers: parsed.providers, ...(allowedProviders.has(parsed.activeProvider) ? { activeProvider: parsed.activeProvider } : {}) };
}

function createVaultUnreadableError(cause) {
  const vaultError = new Error(
    "AI 연결 보관함을 읽지 못했습니다. 기존 연결 정보는 변경하지 않았습니다.",
  );
  vaultError.code = "ai_provider_vault_unreadable";
  vaultError.cause = cause;
  return vaultError;
}

async function readVault(options) {
  const filePath = resolveVaultPath(options);
  const { readJsonStore } = await loadAIVaultJsonStore();
  const loaded = await readJsonStore(filePath, { parse: parseAIVaultShape });
  // 본 파일이 깨졌어도 직전 정상본(.previous)이 있으면 그것으로 읽는다.
  if (loaded.status === "ok" || loaded.status === "recovered") return loaded.value;
  if (loaded.status === "missing") return { version: 1, providers: {} };
  // 백업도 없으면 예전처럼 거절하고 원본은 건드리지 않는다.
  throw createVaultUnreadableError(loaded.error);
}

/**
 * 보관함 대기열 안에서 최신 내용을 읽고 mutator 로 고친 뒤 원자적으로 저장한다.
 * 읽을 수 없는 보관함은 덮어쓰지 않고 ai_provider_vault_unreadable 로 거절한다.
 * mutator 안에서 이 함수나 storeCodexOAuthCredential·resolveCodexCredential 을 부르면 안 된다.
 */
async function mutateAIVault(options, mutator, { previousMode = "keep" } = {}) {
  const filePath = resolveVaultPath(options);
  const { mutateJsonStore } = await loadAIVaultJsonStore();
  return mutateJsonStore(
    filePath,
    {
      parse: parseAIVaultShape,
      empty: () => ({ version: 1, providers: {} }),
      onUnreadable: "throw",
      createUnreadableError: createVaultUnreadableError,
      previousMode,
    },
    mutator,
  );
}

function resolveVaultPath(options) {
  if (!options.app?.getPath) {
    throw new Error("앱 데이터 폴더를 찾지 못했습니다.");
  }
  return path.join(options.app.getPath("userData"), vaultFileName);
}

function normalizeProvider(value) {
  const provider = String(value ?? "").trim();
  if (!allowedProviders.has(provider)) {
    throw new Error(`지원하지 않는 AI provider 입니다: ${provider}`);
  }
  return provider;
}

function normalizeModel(value, provider) {
  const model = String(value ?? "").trim();
  if (provider === "codex_oauth") {
    // 티어 별칭은 호출 시점에 실제 모델 id로 해석합니다.
    // "latest"로 저장해 두면 최신 모델이 바뀌어도 사용자는 자동으로 새 모델을 씁니다.
    if (!model || model.toLowerCase() === modelTierLatest) return resolveCodexLatestModel();
    if (model.toLowerCase() === modelTierFast) return resolveCodexFastModel();
    if (/^(?:gpt[-\s]?)?5\.4[-\s]?mini$/iu.test(model)) return "gpt-5.4-mini";
    // Normalize spelling only. Missing family IDs remain unavailable rather than changing models.
    const shorthand = model.match(/^(?:gpt[-\s]?)?(\d+\.\d+)$/iu);
    if (shorthand) return `gpt-${shorthand[1]}`;
    // Availability is checked separately against this account, including newly listed IDs.
    return model.slice(0, 80);
  }
  if (model.length > 0) return model.slice(0, 120);
  // 구독 계정은 계정에 딸린 기본 모델을 쓴다. 예전에는 아래 마지막 줄로 떨어져
  // Claude CLI 에 'gemini-2.5-flash' 를 --model 로 넘기고 있었다.
  if (subscriptionProviderIds.includes(provider)) return subscriptionDefaultModelId;
  if (provider === "openai") return "gpt-4o-mini";
  // 최신 우선 정책([[model-tier-latest-policy]]): 기본은 품질과 속도가 업무용으로
  // 균형 잡힌 것으로 둔다.
  if (provider === "anthropic") return "claude-sonnet-5";
  // 로컬은 기본 모델을 못 박지 않는다 — 사용자 PC 에 무엇이 깔려 있는지 우리가 모른다.
  // 빈 값이면 어댑터가 설치된 것 중에서 고른다.
  if (provider === "local") return "";
  // 도메인 어댑터(gemini-live.ts)와 설정 카드는 이미 2.5 를 쓴다. 여기만 1.5 로 남아
  // 있어서, 모델을 안 고른 사용자만 조용히 옛 모델을 쓰고 있었다.
  return "gemini-2.5-flash";
}

// 저장용 정규화: 티어 별칭("latest"/"fast")을 구체 모델 id로 굳히지 않고 그대로 보존합니다.
// 별칭은 실제 호출 시점(normalizeModel)에만 해석되므로, 최신 모델이 바뀌면
// "latest"로 저장해 둔 모든 사용자가 자동으로 새 모델을 따라갑니다.
function normalizeStoredModelPreference(value, provider) {
  const model = String(value ?? "").trim();
  if (provider === "codex_oauth") {
    if (!model) return modelTierLatest;
    const lower = model.toLowerCase();
    if (lower === modelTierLatest || lower === modelTierFast) return lower;
  }
  return normalizeModel(model, provider);
}

/**
 * 설치된 Codex CLI 가 실제로 아는 모델 id 목록을 읽는다.
 *
 * CLI 는 ~/.codex/config.toml 의 model_catalog_json 이 가리키는 파일(기본
 * ~/.codex/opencodex-catalog.json)에서 쓸 수 있는 모델을 읽는다. 우리가 상수로
 * 박아 둔 id 가 그 목록에 없으면 호출이 통째로 실패하므로, 보내기 전에 대조한다.
 * 이 목록 자체는 계정 사용 권한의 근거가 아니며, 읽지 못하면 빈 배열을 반환한다.
 */
function readLocalCodexModelCatalog() {
  const home = process.env.USERPROFILE || process.env.HOME || "";
  if (!home) return [];
  const candidates = [];
  try {
    const config = readFileSync(path.join(home, ".codex", "config.toml"), "utf8");
    const match = config.match(/^\s*model_catalog_json\s*=\s*"([^"]+)"/mu);
    // TOML 은 역슬래시를 두 번 써서 하나를 표현한다. 실제 경로로 되돌린다.
    // 소스에 역슬래시 리터럴을 쓰지 않는다 — 편집 도구를 거치며 이스케이프가 유실된 적이 있다.
    const backslash = String.fromCharCode(92);
    if (match?.[1]) candidates.push(match[1].split(backslash + backslash).join(backslash));
  } catch {
    // config.toml 이 없으면 기본 경로만 본다
  }
  candidates.push(path.join(home, ".codex", "opencodex-catalog.json"));
  for (const file of candidates) {
    try {
      const parsed = JSON.parse(readFileSync(file, "utf8"));
      const ids = extractModelIds(parsed);
      if (ids.length) {
        return ids;
      }
    } catch {
      // 다음 후보
    }
  }
  return [];
}

// Never substitute a family member or omit the explicit model for the account default.
export function pickCodexModelFromCatalog(catalog, requested) {
  const model = String(requested ?? "").trim();
  const ids = Array.isArray(catalog) ? catalog : [];
  if (ids.includes(model)) return model;
  return "";
}

function pickCodexCliModel(requested) {
  return pickCodexModelFromCatalog(readLocalCodexModelCatalog(), requested);
}

function resolveCodexCliModel(options = {}) {
  const explicit = String(options.codexCliModel ?? process.env.MODYCREW_CODEX_CLI_MODEL ?? "").trim();
  return pickCodexCliModel(normalizeModel(explicit, codexOAuthProvider));
}

function sanitizeAccountUid(value) {
  const uid = String(value ?? "").trim();
  return /^[a-zA-Z0-9_-]{8,128}$/.test(uid) ? uid : "";
}

function createFingerprint(secret) {
  return crypto.createHash("sha256").update(secret).digest("hex").slice(0, 12).toUpperCase();
}

/**
 * 앱 안 도구(이미지 스튜디오)가 모디크루에 저장된 Gemini·OpenAI 키로 직접 그릴 때 쓴다.
 * 키 값은 호출한 모듈 안에서만 쓰고 화면·기록으로 내보내지 않는다. 다른 제공자의 비밀값은 열지 않는다.
 */
export async function readProviderCredentialForTool(provider, options = {}) {
  if (!["gemini", "openai"].includes(provider)) return { status: "unsupported_provider" };
  let vault;
  try { vault = await readVault(options); } catch { return { status: "vault_unreadable" }; }
  const record = vault?.providers?.[provider];
  if (!record?.encryptedSecret) return { status: "credential_missing" };
  return decryptVaultSecret(record.encryptedSecret, options.safeStorage);
}

function decryptVaultSecret(encryptedSecret, safeStorage) {
  if (!safeStorage?.isEncryptionAvailable?.()) {
    return {
      status: "os_vault_unavailable",
      userMessage: "이 PC의 OS 보안 저장소를 사용할 수 없어 AI key를 읽지 못했습니다.",
    };
  }

  try {
    const value = safeStorage.decryptString(Buffer.from(String(encryptedSecret), "base64"));
    if (!value) {
      return {
        status: "credential_empty",
        userMessage: "저장된 AI key를 읽었지만 값이 비어 있습니다. 설정에서 다시 저장해 주세요.",
      };
    }
    return { status: "credential_ready", value };
  } catch {
    return {
      status: "credential_decrypt_failed",
      userMessage: "저장된 AI key를 복호화하지 못했습니다. 설정에서 다시 저장해 주세요.",
    };
  }
}

function sanitizePrompt(value) {
  const prompt = String(value ?? "").trim();
  return prompt
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .slice(0, 24_000);
}

function sanitizeRuntimeContextText(value, maxLength = 160) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function sanitizeRuntimeContextList(value, maxItems = 8, maxLength = 160) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => sanitizeRuntimeContextText(item, maxLength))
    .filter(Boolean)
    .slice(0, maxItems);
}

function normalizeRuntimeContextCount(value) {
  const count = Number(value);
  if (!Number.isFinite(count)) return null;
  return Math.max(0, Math.min(99, Math.round(count)));
}

function createRuntimeContextReceipt(payload = {}) {
  const roleContext = payload.roleContext && typeof payload.roleContext === "object"
    ? payload.roleContext
    : {};
  const executionContext = payload.executionContext && typeof payload.executionContext === "object"
    ? payload.executionContext
    : {};
  const teammateName = sanitizeRuntimeContextText(roleContext.teammateName, 60);
  const roleTitle = sanitizeRuntimeContextText(roleContext.roleTitle, 80);
  const channelName = sanitizeRuntimeContextText(roleContext.channelName, 80);
  const assignmentContract = sanitizeRuntimeContextText(roleContext.assignmentContract, 80);
  const assignmentSummary = sanitizeRuntimeContextText(roleContext.assignmentSummary, 180);
  const assignmentRuntimeLine = sanitizeRuntimeContextText(roleContext.assignmentRuntimeLine, 220);
  const assignmentApprovalLine = sanitizeRuntimeContextText(roleContext.assignmentApprovalLine, 220);
  const assignmentMemoryLine = sanitizeRuntimeContextText(roleContext.assignmentMemoryLine, 220);
  const workAutomationContract = sanitizeRuntimeContextText(roleContext.workAutomationContract, 100);
  const workAutomationOneLineLabel = sanitizeRuntimeContextText(roleContext.workAutomationOneLineLabel, 220);
  const workAutomationCandidateLabel = sanitizeRuntimeContextText(roleContext.workAutomationCandidateLabel, 180);
  const workAutomationPipelineLabel = sanitizeRuntimeContextText(roleContext.workAutomationPipelineLabel, 180);
  const workAutomationApprovalGateLabel = sanitizeRuntimeContextText(roleContext.workAutomationApprovalGateLabel, 140);
  const workAutomationEvidencePath = sanitizeRuntimeContextText(roleContext.workAutomationEvidencePath, 220);
  const workAutomationConnectionGateLabel = sanitizeRuntimeContextText(
    roleContext.workAutomationConnectionGateLabel || executionContext.workAutomationConnectionGateLabel,
    220,
  );
  const workAutomationConnectionRequiredIds = sanitizeRuntimeContextText(
    roleContext.workAutomationConnectionRequiredIds || executionContext.workAutomationConnectionRequiredIds,
    80,
  );
  const workAutomationCandidateBlockedUntilConnections = Boolean(
    roleContext.workAutomationCandidateBlockedUntilConnections ||
      executionContext.workAutomationCandidateBlockedUntilConnections,
  );
  const intent = sanitizeRuntimeContextText(executionContext.intent, 80);
  const source = sanitizeRuntimeContextText(executionContext.source, 80);
  const approvalMode = sanitizeRuntimeContextText(executionContext.approvalMode, 40);
  const requestedWorkSummary = sanitizeRuntimeContextText(executionContext.requestedWorkSummary, 180);
  const plannedToolSequenceLabel = sanitizeRuntimeContextText(executionContext.plannedToolSequenceLabel, 220);
  const approvalQueueCount = normalizeRuntimeContextCount(executionContext.approvalQueueCount);
  const traceId = sanitizeRuntimeContextText(roleContext.traceId || executionContext.traceId, 120);
  const traceContract = sanitizeRuntimeContextText(roleContext.traceContract || executionContext.traceContract, 140);
  if (
    !teammateName &&
    !roleTitle &&
    !channelName &&
    !intent &&
    !source &&
    !approvalMode &&
    !requestedWorkSummary &&
    !plannedToolSequenceLabel &&
    approvalQueueCount === null
  ) {
    return null;
  }
  return {
    contract: "role_context_to_generation_runtime_v1",
    teammateId: sanitizeRuntimeContextText(roleContext.teammateId, 100),
    teammateName,
    roleTitle,
    channelName,
    assignmentContract,
    assignmentSummary,
    assignmentRuntimeLine,
    assignmentApprovalLine,
    assignmentMemoryLine,
    workAutomationContract,
    workAutomationOneLineLabel,
    workAutomationCandidateLabel,
    workAutomationPipelineLabel,
    workAutomationApprovalGateLabel,
    workAutomationEvidencePath,
    workAutomationConnectionGateLabel,
    workAutomationConnectionRequiredIds,
    workAutomationCandidateBlockedUntilConnections,
    intent,
    responseMode: sanitizeRuntimeContextText(executionContext.responseMode, 60),
    approvalMode,
    requestedWorkSummary,
    plannedToolSequenceLabel,
    ...(approvalQueueCount === null ? {} : { approvalQueueCount }),
    source,
    traceId,
    traceContract,
    safetyBoundary:
      sanitizeRuntimeContextText(executionContext.safetyBoundary, 180) ||
      "외부 발송, 일정 등록, 파일 변경, 공유, 삭제는 사용자 최종 승인 전 실행하지 않습니다.",
    externalMutationAllowed: false,
  };
}

export function buildRuntimePrompt(userPrompt, payload = {}) {
  const incomingRole = payload.roleContext && typeof payload.roleContext === "object"
    ? payload.roleContext
    : {};
  const roleContext = restoreBuiltinExpert({ ...incomingRole, id: incomingRole.teammateId });
  const executionContext = payload.executionContext && typeof payload.executionContext === "object"
    ? payload.executionContext
    : {};
  const teammateName = sanitizeRuntimeContextText(roleContext.teammateName, 60);
  const teamLabel = sanitizeRuntimeContextText(roleContext.teamLabel, 60);
  const roleTitle = sanitizeRuntimeContextText(roleContext.roleTitle, 80);
  const channelName = sanitizeRuntimeContextText(roleContext.channelName, 80);
  const brief = sanitizeRuntimeContextText(roleContext.brief, 240);
  const roleContextContract =
    sanitizeRuntimeContextText(roleContext.contract, 100) ||
    (teammateName || roleTitle || channelName ? "role_context_to_generation_runtime_v1" : "");
  const assignmentContract = sanitizeRuntimeContextText(roleContext.assignmentContract, 80);
  const assignmentSummary = sanitizeRuntimeContextText(roleContext.assignmentSummary, 180);
  const assignmentRuntimeLine = sanitizeRuntimeContextText(roleContext.assignmentRuntimeLine, 220);
  const assignmentApprovalLine = sanitizeRuntimeContextText(roleContext.assignmentApprovalLine, 220);
  const assignmentMemoryLine = sanitizeRuntimeContextText(roleContext.assignmentMemoryLine, 220);
  const workAutomationContract = sanitizeRuntimeContextText(roleContext.workAutomationContract, 100);
  const workAutomationOneLineLabel = sanitizeRuntimeContextText(roleContext.workAutomationOneLineLabel, 220);
  const workAutomationCandidateLabel = sanitizeRuntimeContextText(roleContext.workAutomationCandidateLabel, 180);
  const workAutomationPipelineLabel = sanitizeRuntimeContextText(roleContext.workAutomationPipelineLabel, 180);
  const workAutomationApprovalGateLabel = sanitizeRuntimeContextText(roleContext.workAutomationApprovalGateLabel, 140);
  const workAutomationEvidencePath = sanitizeRuntimeContextText(roleContext.workAutomationEvidencePath, 220);
  const workAutomationConnectionGateLabel = sanitizeRuntimeContextText(
    roleContext.workAutomationConnectionGateLabel || executionContext.workAutomationConnectionGateLabel,
    220,
  );
  const workAutomationConnectionRequiredIds = sanitizeRuntimeContextText(
    roleContext.workAutomationConnectionRequiredIds || executionContext.workAutomationConnectionRequiredIds,
    80,
  );
  const workAutomationCandidateBlockedUntilConnections = Boolean(
    roleContext.workAutomationCandidateBlockedUntilConnections ||
      executionContext.workAutomationCandidateBlockedUntilConnections,
  );
  const skillIds = sanitizeRuntimeContextList(roleContext.skillIds, 12, 80);
  const instructions = sanitizeRuntimeContextList(roleContext.instructions, 8, 180);
  const intent = sanitizeRuntimeContextText(executionContext.intent, 80);
  const responseMode = sanitizeRuntimeContextText(executionContext.responseMode, 60);
  const approvalMode = sanitizeRuntimeContextText(executionContext.approvalMode, 40);
  const source = sanitizeRuntimeContextText(executionContext.source, 80);
  const requestedWorkSummary = sanitizeRuntimeContextText(executionContext.requestedWorkSummary, 180);
  const plannedToolSequenceLabel = sanitizeRuntimeContextText(executionContext.plannedToolSequenceLabel, 220);
  const approvalQueueCount = normalizeRuntimeContextCount(executionContext.approvalQueueCount);
  const safetyBoundary =
    sanitizeRuntimeContextText(executionContext.safetyBoundary, 180) ||
    "외부 발송, 일정 등록, 파일 변경, 공유, 삭제는 사용자 최종 승인 전 실행하지 않습니다.";
  const runtimeLines = [
    buildBuiltinExpertPrompt(roleContext),
    "[ModyCrew Runtime Role Contract]",
    roleContextContract ? `역할 컨텍스트 계약: ${roleContextContract}` : "",
    teammateName ? `AI 직원: ${teammateName}` : "",
    teamLabel ? `팀: ${teamLabel}` : "",
    roleTitle ? `역할: ${roleTitle}` : "",
    channelName ? `채널: ${channelName}` : "",
    brief ? `맡는 일: ${brief}` : "",
    assignmentContract ? `역할 배치 계약: ${assignmentContract}` : "",
    assignmentSummary ? `역할 배치 요약: ${assignmentSummary}` : "",
    assignmentRuntimeLine ? `역할 런타임 적용: ${assignmentRuntimeLine}` : "",
    assignmentApprovalLine ? `역할 실행 경계: ${assignmentApprovalLine}` : "",
    assignmentMemoryLine ? `역할 기억 경로: ${assignmentMemoryLine}` : "",
    workAutomationContract ? `역할 업무 후보 계약: ${workAutomationContract}` : "",
    workAutomationOneLineLabel ? `역할 업무 후보 요약: ${workAutomationOneLineLabel}` : "",
    workAutomationCandidateLabel ? `역할 업무 후보: ${workAutomationCandidateLabel}` : "",
    workAutomationPipelineLabel ? `역할 업무 파이프라인: ${workAutomationPipelineLabel}` : "",
    workAutomationApprovalGateLabel ? `역할 승인 게이트: ${workAutomationApprovalGateLabel}` : "",
    workAutomationEvidencePath ? `역할 업무 증거 경로: ${workAutomationEvidencePath}` : "",
    workAutomationConnectionGateLabel ? `역할 필요 연결 판단: ${workAutomationConnectionGateLabel}` : "",
    workAutomationConnectionRequiredIds ? `역할 누락 연결: ${workAutomationConnectionRequiredIds}` : "",
    workAutomationCandidateBlockedUntilConnections ? "역할 업무 후보 생성: 필요 연결 전 차단" : "",
    skillIds.length ? `사용 가능한 스킬 힌트: ${skillIds.join(", ")}` : "",
    ...instructions.map((item) => `역할 기준: ${item}`),
    "",
    "[ModyCrew Runtime Execution Contract]",
    source ? `호출 출처: ${source}` : "",
    intent ? `판단된 의도: ${intent}` : "",
    responseMode ? `응답 모드: ${responseMode}` : "",
    approvalMode ? `승인 모드: ${approvalMode}` : "",
    requestedWorkSummary ? `사용자 요청 실행 요약: ${requestedWorkSummary}` : "",
    plannedToolSequenceLabel ? `계획된 실행 후보: ${plannedToolSequenceLabel}` : "",
    approvalQueueCount === null ? "" : `승인 대기 후보 수: ${approvalQueueCount}`,
    `실행 경계: ${safetyBoundary}`,
    "실제 외부 실행을 했다거나 메일/일정/파일을 읽었다고 말하려면 앱 도구 관찰 결과가 프롬프트에 명시되어 있어야 합니다.",
    "도구 관찰이 없으면 답변, 초안, 후보, 다음 단계 제안까지만 말합니다.",
  ].filter(Boolean).join("\n");
  return sanitizePrompt(`${runtimeLines}\n\n[User Prompt]\n${userPrompt}`);
}

function redactSecretLike(value, knownSecrets = []) {
  let redacted = String(value ?? "");
  for (const secret of knownSecrets) {
    const token = String(secret ?? "").trim();
    if (token) redacted = redacted.split(token).join("[secret-redacted]");
  }
  return redacted
    .replace(/\bAIza[0-9A-Za-z_-]{20,}\b/g, "[gemini-api-key-redacted]")
    .replace(/\bsk-[A-Za-z0-9_-]{20,}\b/g, "[api-key-redacted]")
    .replace(/\bsk-ant-[A-Za-z0-9_-]{20,}\b/g, "[api-key-redacted]");
}

function resolveFetch(options = {}) {
  const fetchFn = options.fetch ?? globalThis.fetch;
  if (typeof fetchFn !== "function") {
    throw new Error("네트워크 fetch 런타임을 찾지 못했습니다.");
  }
  return fetchFn;
}

async function fetchWithTimeout(fetchFn, url, init, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(timeoutMs));
  try {
    return await fetchFn(url, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function runCodexCliExec(prompt, options = {}) {
  const executable = resolveCodexCliExecutable(options);
  if (!executable) {
    const notInstalledError = new Error(
      "이 PC에서 실행 가능한 최신 Codex 앱/CLI를 찾지 못했습니다. Codex 앱 설치 또는 업데이트가 필요합니다.",
    );
    notInstalledError.code = "codex_cli_not_installed";
    throw notInstalledError;
  }

  const cwd = resolveCodexCliWorkdir(options);
  const cliModel = resolveCodexCliModel(options);
  if (!cliModel) {
    const error = new Error("선택한 모델을 현재 Codex CLI 목록에서 확인하지 못했습니다. 다른 모델이나 계정 기본값으로 전환하지 않습니다.");
    error.code = "codex_cli_model_unsupported";
    throw error;
  }
  const args = [
    "exec",
    "--json",
    "--ephemeral",
    "--skip-git-repo-check",
    "--sandbox",
    "read-only",
    "-m", cliModel,
    "--disable",
    "plugins",
    "--disable",
    "memories",
    "-C",
    cwd,
  ];
  const promptText = buildCodexCliPrompt(prompt);

  // 사용자 프롬프트는 PowerShell 인자 파싱을 거치지 않도록 stdin으로만 전달합니다.
  const result = await runCodexCliProcess(executable, [...args, "-"], {
    input: promptText,
    timeout: Number(options.codexCliTimeoutMs ?? codexCliTimeoutMs),
    windowsHide: true,
    maxBuffer: 4 * 1024 * 1024,
    codexCliPowerShellWrapper: options.codexCliPowerShellWrapper,
    powerShellPath: options.powerShellPath,
    abortSignal: options.abortSignal,
    env: {
      ...managedToolEnv(),
      ...(options.codexCliEnv ?? {}),
    },
  });

  const outputText = extractCodexCliJsonText(result.stdout);
  if (!outputText) {
    const diagnostic = sanitizeCodexCliDiagnostic(`${result.stderr}\n${result.stdout}`);
    throw new Error(
      diagnostic
        ? `Codex CLI가 답변 텍스트를 반환하지 않았습니다: ${diagnostic}`
        : "Codex CLI가 답변 텍스트를 반환하지 않았습니다.",
    );
  }

  return {
    outputText,
    executable,
    model: extractCodexCliModel(result.stdout) || cliModel || resolveCodexLatestModel(),
  };
}

function runCodexCliProcess(executable, args, options = {}) {
  if (process.platform !== "win32" || options.codexCliPowerShellWrapper === false) {
    return execFileCaptured(executable, args, options);
  }

  const encodedCommand = buildPowerShellCodexCommand(executable, args);
  return execFileCaptured(resolvePowerShellExecutable(options), [
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-EncodedCommand",
    encodedCommand,
  ], options);
}

function resolvePowerShellExecutable(options = {}) {
  return String(options.powerShellPath ?? process.env.MODYCREW_POWERSHELL_PATH ?? "powershell.exe").trim();
}

function buildPowerShellCodexCommand(executable, args) {
  const argv = args.map((arg) => powerShellSingleQuoted(String(arg))).join(",\n  ");
  const script = [
    "$ErrorActionPreference = 'Continue'",
    `$exe = ${powerShellSingleQuoted(String(executable))}`,
    "$argv = @(",
    `  ${argv}`,
    ")",
    "& $exe @argv",
    "exit $LASTEXITCODE",
  ].join("\n");
  return Buffer.from(script, "utf16le").toString("base64");
}

function powerShellSingleQuoted(value) {
  return `'${String(value ?? "").replace(/['\u2018\u2019\u201a\u201b]/g, "$&$&")}'`;
}
function execFileCaptured(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      windowsHide: options.windowsHide !== false,
      env: options.env,
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let settled = false;
    const maxBuffer = Number(options.maxBuffer ?? 4 * 1024 * 1024);
    const abortSignal = options.abortSignal;
    // 윈도우에서는 powershell.exe 껍데기 아래에 실제 codex 가 돈다. child.kill 은 껍데기만
    // 끝내므로 딸린 프로세스까지 끝낸다(killProcessTree).
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      abortSignal?.removeEventListener?.("abort", onAbort);
      void killProcessTree(child);
      const diagnostic = sanitizeCodexCliDiagnostic(`${stderr}\n${stdout}`);
      reject(new Error(diagnostic || "Codex CLI 응답 시간이 초과되었습니다."));
    }, Number(options.timeout ?? codexCliTimeoutMs));
    const onAbort = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      void killProcessTree(child);
      const error = new Error("요청하신 대로 Codex CLI 답변을 멈췄습니다.");
      error.name = "AbortError";
      reject(error);
    };
    abortSignal?.addEventListener?.("abort", onAbort, { once: true });
    if (abortSignal?.aborted) onAbort();

    child.stdout?.on("data", (chunk) => {
      stdout += Buffer.from(chunk).toString("utf8");
      if (stdout.length + stderr.length > maxBuffer && !settled) {
        settled = true;
        clearTimeout(timeout);
        abortSignal?.removeEventListener?.("abort", onAbort);
        void killProcessTree(child);
        reject(new Error("Codex CLI 출력이 너무 큽니다."));
      }
    });

    child.stderr?.on("data", (chunk) => {
      stderr += Buffer.from(chunk).toString("utf8");
    });

    child.on("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      abortSignal?.removeEventListener?.("abort", onAbort);
      reject(error);
    });

    child.on("close", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      abortSignal?.removeEventListener?.("abort", onAbort);
      if (code !== 0) {
        if (stdout.includes("\"type\":\"agent_message\"")) {
          resolve({
            stdout: String(stdout ?? ""),
            stderr: String(stderr ?? ""),
            recoveredNonZeroExit: true,
            exitCode: code,
            signal,
          });
          return;
        }
        const diagnostic = sanitizeCodexCliDiagnostic(
          `${stderr}\n${stdout}\nCodex CLI exited with ${signal ?? code}`,
        );
        reject(new Error(diagnostic || "Codex CLI 실행에 실패했습니다."));
        return;
      }
      resolve({ stdout: String(stdout ?? ""), stderr: String(stderr ?? "") });
    });

    child.stdin?.end(String(options.input ?? ""));
  });
}

function resolveCodexCliExecutable(options = {}) {
  const explicit = String(options.codexCliPath ?? process.env.MODYCREW_CODEX_CLI_PATH ?? "").trim();
  if (explicit && existsSync(explicit)) return explicit;

  const candidates = [];
  if (process.resourcesPath) {
    // 설치팩에 동봉된 AI 연결 복구 도구(라이선스 검토 완료)를 최우선으로 사용합니다.
    candidates.push(
      path.join(process.resourcesPath, "toolchain", "codex", "bin", "codex.exe"),
      path.join(process.resourcesPath, "toolchain", "codex", "codex.exe"),
    );
  }
  const localAppData = process.env.LOCALAPPDATA;
  if (localAppData) {
    const binRoot = path.join(localAppData, "OpenAI", "Codex", "bin");
    const versionDirs = listExistingDirectories(binRoot).sort(
      (a, b) => b.mtimeMs - a.mtimeMs,
    );
    for (const dir of versionDirs) {
      candidates.push(path.join(dir.path, "codex.exe"));
    }
    candidates.push(path.join(binRoot, "codex.exe"));
  }

  candidates.push("codex.exe", "codex.cmd", "codex");

  for (const candidate of candidates) {
    if (candidate.includes(path.sep)) {
      if (existsSync(candidate)) return candidate;
      continue;
    }
    const resolved = findExecutableOnSystemPath(candidate);
    if (resolved) return resolved;
  }
  return "";
}

function findExecutableOnSystemPath(fileName) {
  const pathValue = String(process.env.PATH ?? process.env.Path ?? "");
  for (const rawDir of pathValue.split(path.delimiter)) {
    const dir = rawDir.trim().replace(/^"|"$/gu, "");
    if (!dir) continue;
    try {
      const candidate = path.join(dir, fileName);
      if (existsSync(candidate)) return candidate;
    } catch {
      // PATH 항목이 잘못된 경우 다음 후보를 계속 확인합니다.
    }
  }
  return "";
}

function listExistingDirectories(root) {
  try {
    return readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => {
        const fullPath = path.join(root, entry.name);
        const info = statSync(fullPath);
        return { path: fullPath, mtimeMs: info.mtimeMs };
      });
  } catch {
    return [];
  }
}

function resolveCodexCliWorkdir(options = {}) {
  const fromApp =
    typeof options.app?.getPath === "function" ? options.app.getPath("userData") : "";
  const candidate = String(options.codexCliWorkdir ?? fromApp ?? repoRoot).trim();
  return candidate && existsSync(candidate) ? candidate : os.homedir();
}

function buildCodexCliPrompt(prompt) {
  const request = String(prompt ?? "")
    .replace(/\r\n?/g, "\n")
    .trim()
    .slice(0, 24_000);
  return [
    "You are only the Korean chat assistant inside the ModyCrew Windows app, not a coding agent.",
    "Answer like a natural ChatGPT-style Korean assistant: warm, direct, and not robotic.",
    "Match the response depth to the user's request: keep simple confirmations, greetings, and explicit requests for brevity short; give explanations, comparisons, writing, reviews, troubleshooting, and multi-condition work enough detail, reasoning, options, and steps to be genuinely useful.",
    "Do not force complex answers into one line or a fixed number of bullets. Stay focused and avoid irrelevant product explanations or feature lists.",
    "Never mention repository work, AGENTS instructions, Codex task progress, percentages, files you inspected, implementation status, OAuth diagnostics, callback URLs, runtime names, or selected model names unless the user explicitly asks.",
    "Do not list app features unless they are the immediate next step for the user's request.",
    "Do not claim external actions, uploads, file changes, calendar changes, or message sends were executed.",
    "If the user asks whether AI is connected, say it is connected for app chat and suggest sending the next request.",
    `User request: ${request}`,
  ].join(" ");
}

function extractCodexCliJsonText(stdout) {
  const messages = [];
  for (const line of String(stdout ?? "").split(/\r?\n/u)) {
    const text = line.trim();
    if (!text.startsWith("{")) continue;
    const event = parseJsonObject(text);
    if (event?.type === "item.completed" && event.item?.type === "agent_message") {
      const message = trimNonEmptyString(event.item.text);
      if (message) messages.push(message);
    }
  }
  return messages.join("\n").trim().slice(0, 8_000);
}

function extractCodexCliModel(stdout) {
  const match = String(stdout ?? "").match(/^model:\s*([^\r\n]+)/mu);
  return trimNonEmptyString(match?.[1]);
}

function sanitizeCodexCliOutput(value) {
  return String(value ?? "")
    .replace(/\r\n/g, "\n")
    .trim()
    .slice(0, 8_000);
}

function sanitizeCodexCliDiagnostic(value) {
  return redactSecretLike(String(value ?? ""))
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.startsWith("{\"type\":\"thread."))
    .filter((line) => !line.startsWith("{\"type\":\"turn."))
    .filter((line) => !line.includes("session id:"))
    .slice(-8)
    .join(" / ")
    .slice(0, 600);
}

function resolveCodexCallbackPort(options = {}) {
  const port = Number(options.oauthPort ?? process.env.MODYCREW_CODEX_OAUTH_PORT ?? codexDefaultCallbackPort);
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : codexDefaultCallbackPort;
}

function parseJsonObject(text) {
  try {
    const parsed = JSON.parse(String(text ?? ""));
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function trimNonEmptyString(value) {
  const text = typeof value === "string" ? value.trim() : "";
  return text.length > 0 ? text : "";
}

function normalizeTokenLifetimeMs(value) {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.trunc(value * 1000);
  }
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    return Number.parseInt(value.trim(), 10) * 1000;
  }
}

function parseCodexCredential(value) {
  const parsed = parseJsonObject(value);
  if (!parsed) return null;
  const access = trimNonEmptyString(parsed.access);
  const refresh = trimNonEmptyString(parsed.refresh);
  if (!access || !refresh) return null;
  return {
    access,
    refresh,
    expires: typeof parsed.expires === "number" ? parsed.expires : 0,
    accountId: trimNonEmptyString(parsed.accountId),
    email: trimNonEmptyString(parsed.email),
    profileName: trimNonEmptyString(parsed.profileName),
    chatgptPlanType: trimNonEmptyString(parsed.chatgptPlanType),
  };
}

function decodeJwtPayload(token) {
  const parts = String(token ?? "").split(".");
  if (parts.length !== 3) return null;
  try {
    const parsed = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function resolveCodexAccessTokenExpiry(accessToken) {
  const exp = decodeJwtPayload(accessToken)?.exp;
  if (typeof exp === "number" && Number.isFinite(exp) && exp > 0) {
    return Math.trunc(exp * 1000);
  }
}

function resolveCodexIdentity(accessToken) {
  const payload = decodeJwtPayload(accessToken);
  const auth = payload?.[codexAuthClaimPath];
  const profile = payload?.[codexProfileClaimPath];
  const accountId = trimNonEmptyString(auth?.chatgpt_account_id);
  const chatgptPlanType = trimNonEmptyString(auth?.chatgpt_plan_type);
  const email = trimNonEmptyString(profile?.email);
  const stableSubject =
    trimNonEmptyString(auth?.chatgpt_account_user_id) ||
    trimNonEmptyString(auth?.chatgpt_user_id) ||
    trimNonEmptyString(payload?.sub);

  return {
    accountId,
    chatgptPlanType,
    email,
    profileName: email || (stableSubject ? `id-${base64Url(Buffer.from(stableSubject))}` : ""),
  };
}

function base64Url(buffer) {
  return Buffer.from(buffer).toString("base64url");
}

function sanitizeOauthErrorText(value) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
    .replace(/\s+/g, " ")
    .slice(0, 400);
}

function extractOpenAIResponseText(response) {
  const direct = typeof response?.output_text === "string" ? response.output_text : "";
  const nested = Array.isArray(response?.output)
    ? response.output
        .flatMap((item) => (Array.isArray(item?.content) ? item.content : []))
        .map((content) => (typeof content?.text === "string" ? content.text : ""))
        .filter(Boolean)
        .join("\n")
    : "";
  return (direct || nested).trim().slice(0, 24_000);
}

function renderCodexOAuthPage(title, message, success) {
  const safeTitle = escapeHtml(title);
  const safeMessage = escapeHtml(message);
  const accent = success ? "#16a34a" : "#dc2626";
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>ModyCrew Codex Login</title>
  <style>
    :root { color-scheme: dark light; }
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      background: #111;
      color: #f5f5f5;
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    main {
      width: min(420px, calc(100vw - 40px));
      padding: 28px;
      border: 1px solid #2f2f2f;
      border-radius: 14px;
      background: #1b1b1b;
      box-shadow: 0 24px 70px rgba(0, 0, 0, 0.36);
    }
    i {
      width: 12px;
      height: 12px;
      display: inline-block;
      border-radius: 99px;
      background: ${accent};
      box-shadow: 0 0 0 6px color-mix(in srgb, ${accent} 18%, transparent);
    }
    h1 { margin: 18px 0 8px; font-size: 24px; letter-spacing: 0; }
    p { margin: 0; color: #b8b8b8; line-height: 1.65; font-size: 14px; }
  </style>
</head>
<body>
  <main>
    <i aria-hidden="true"></i>
    <h1>${safeTitle}</h1>
    <p>${safeMessage}</p>
  </main>
</body>
</html>`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
// 프롬프트 전달 경로 회귀 테스트 전용 노출입니다.
export {
  buildCodexCliPrompt,
  buildPowerShellCodexCommand,
  powerShellSingleQuoted,
  runCodexCliProcess,
};
