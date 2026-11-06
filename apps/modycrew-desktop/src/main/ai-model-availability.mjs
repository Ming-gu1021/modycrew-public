import crypto from "node:crypto";
import { pinnedCodexCliVersion } from "./codex-client-version.mjs";

// These are discoverable names, never evidence that a connected account can use them.
const knownNames = {
  codex_oauth: ["gpt-6-astra", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna", "gpt-5.4-mini"],
  openai: ["gpt-6-astra", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna", "gpt-5.4-mini"],
  anthropic: ["claude-opus-5", "claude-sonnet-5", "claude-haiku-4-5"],
  gemini: [],
};
const cache = new Map();
const requestGenerations = new Map();
let cacheEpoch = 0;
let requestSequence = 0;
const ttlMs = 10 * 60_000;
const maxEntries = 64;
const sourceFor = (provider) => provider === "codex_oauth" ? "codex_oauth" : "provider_api";
const labelFor = (id) => id === "gpt-6-astra" ? "GPT-6 Astra" : id;

export function modelAvailabilityKey({ provider, scope, secret, accountId = "" }) {
  return crypto.createHash("sha256").update(JSON.stringify([provider, scope, accountId, secret])).digest("hex");
}

function candidates(provider, selectedModel = "") {
  return [...new Set([...(knownNames[provider] ?? []), selectedModel].filter((id) => validModelId(id) && !["latest", "fast"].includes(id)))];
}

function validModelId(id) {
  return typeof id === "string" && /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/u.test(id);
}

export function unavailableModelCatalog(provider, selectedModel, reason = "connection_required", source = "none") {
  const userMessage = reason === "connection_required"
    ? "이 연결을 먼저 설정한 뒤 사용 가능한 모델을 확인해 주세요."
    : reason === "local_catalog_only"
      ? "설치된 모델 이름만 확인했습니다. 계정의 사용 권한은 확인되지 않아 선택할 수 없습니다."
      : "현재 연결에서 모델 목록을 확인하지 못했습니다. 연결을 확인하고 새로고침해 주세요.";
  return {
    state: "unknown", source, userMessage, availabilityIsNotEntitlementProof: true,
    models: candidates(provider, selectedModel).map((id) => ({ id, label: labelFor(id), availability: "unknown", reason, evidence: "catalog" })),
  };
}

export function peekModelAvailability(context) {
  const entry = cache.get(modelAvailabilityKey(context));
  if (!entry || Date.now() - entry.fetchedAt >= ttlMs) return null;
  return structuredClone(entry.value);
}

function remember(context, value, expected) {
  const key = modelAvailabilityKey(context);
  if (expected && (expected.epoch !== cacheEpoch || expected.generation !== requestGenerations.get(key))) {
    return peekModelAvailability(context) ?? unavailableModelCatalog(context.provider, context.selectedModel, "catalog_changed");
  }
  cache.delete(key);
  cache.set(key, { fetchedAt: Date.now(), value: structuredClone(value) });
  while (cache.size > maxEntries) cache.delete(cache.keys().next().value);
  return structuredClone(value);
}

export function forgetModelAvailabilityScope(scope, provider) {
  // Keys deliberately contain no raw account data. A credential mutation invalidates all
  // entries: cheap (64 at most), and reconnecting the same credential must not revive proof.
  cache.clear();
  cacheEpoch += 1;
  requestGenerations.clear();
}

export function rankDiscoveredModels(ids) {
  const score = (id) => {
    const version = id.match(/(?:gpt-|gemini-)(\d+)(?:\.(\d+))?/u);
    return [Number(version?.[1] ?? 0), Number(version?.[2] ?? 0), /mini|small|fast|nano|lite|luna/u.test(id) ? 1 : 0];
  };
  return [...ids].sort((a, b) => {
    const x = score(a), y = score(b);
    return y[0] - x[0] || y[1] - x[1] || x[2] - y[2] || a.localeCompare(b);
  });
}

function supportsText(provider, id, item) {
  if (provider !== "codex_oauth" && !/^[A-Za-z0-9_.:-]{2,120}$/u.test(id)) return false;
  if (provider === "codex_oauth" && id.length > 80) return false;
  if (provider === "gemini") return item?.supportedGenerationMethods?.includes("generateContent") === true;
  if (provider === "anthropic") return id.startsWith("claude-");
  if (provider === "codex_oauth") return item?.supported_in_api !== false && item?.availability !== "disabled";
  return /^(?:gpt-|chatgpt-|o\d(?:-|$)|codex-|ft:(?:gpt-|o\d))/u.test(id)
    && !/image|audio|realtime|transcribe|tts|search|embedding|moderation|computer-use/iu.test(id);
}

function parseModels(provider, json) {
  const rows = provider === "gemini" ? json?.models : json?.data ?? json?.models;
  if (!Array.isArray(rows)) throw new Error("invalid_model_catalog");
  if (rows.length > 2000) throw new Error("model_catalog_size_limit");
  return rows.flatMap((item) => {
    const raw = typeof item === "string" ? item : item?.id ?? item?.slug ?? item?.name ?? item?.model;
    const id = provider === "gemini" ? String(raw ?? "").replace(/^models\//u, "") : raw;
    if (!validModelId(id) || !supportsText(provider, id, item)) return [];
    return [{ id, label: id === "gpt-6-astra" ? labelFor(id) : String(item?.display_name ?? item?.displayName ?? id).slice(0, 128),
      availability: "available", evidence: "catalog" }];
  });
}

function requestSpec(context) {
  const { provider, secret, accountId } = context;
  if (provider === "codex_oauth") return {
    url: `https://chatgpt.com/backend-api/codex/models?client_version=${pinnedCodexCliVersion}`, headers: {
      Authorization: `Bearer ${secret}`, originator: "openclaw", "User-Agent": "ModyCrew/desktop",
      ...(accountId ? { "ChatGPT-Account-ID": accountId } : {}),
    },
  };
  if (provider === "openai") return { url: "https://api.openai.com/v1/models", headers: { Authorization: `Bearer ${secret}` } };
  if (provider === "anthropic") return { url: "https://api.anthropic.com/v1/models?limit=1000", headers: { "x-api-key": secret, "anthropic-version": "2023-06-01" } };
  if (provider === "gemini") return { url: "https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000", headers: { "x-goog-api-key": secret } };
  return null;
}

export async function discoverModelAvailability(context, { fetchFn, forceRefresh = false, timeoutMs = 12_000 } = {}) {
  const { provider, selectedModel } = context;
  const previous = peekModelAvailability(context);
  if (!forceRefresh && previous) return previous;
  const spec = requestSpec(context);
  if (!spec || !context.secret) return unavailableModelCatalog(provider, selectedModel);
  const key = modelAvailabilityKey(context);
  const expected = { epoch: cacheEpoch, generation: ++requestSequence };
  requestGenerations.set(key, expected.generation);
  while (requestGenerations.size > maxEntries * 2) requestGenerations.delete(requestGenerations.keys().next().value);
  if (forceRefresh) {
    const pending = unavailableModelCatalog(provider, selectedModel, "catalog_refresh_pending", sourceFor(provider));
    if (previous) pending.models = previous.models.map((model) => ({ ...model, availability: "unknown", reason: "catalog_refresh_pending" }));
    remember(context, pending, expected);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let httpStatus;
  try {
    let url = spec.url;
    const models = new Map();
    const cursors = new Set();
    for (let page = 0; page < 10; page += 1) {
      const response = await fetchFn(url, { method: "GET", headers: spec.headers, signal: controller.signal, redirect: "error" });
      httpStatus = response.status;
      if (!response.ok) throw new Error("model_catalog_request_failed");
      const json = await response.json();
      for (const model of parseModels(provider, json)) models.set(model.id, model);
      const next = provider === "gemini" ? json.nextPageToken : provider === "anthropic" && json.has_more ? json.last_id : null;
      if (!next) {
        if (provider === "anthropic" && json.has_more) throw new Error("incomplete_model_catalog");
        const order = rankDiscoveredModels([...models.keys()]);
        const entries = order.map((id) => models.get(id));
        for (const id of candidates(provider, selectedModel)) {
          if (!models.has(id)) entries.push({ id, label: labelFor(id), availability: "blocked", reason: "not_in_account_catalog", evidence: "catalog" });
        }
        return remember(context, {
          state: entries.some((model) => model.availability === "available") ? "available" : "blocked",
          source: sourceFor(provider), checkedAt: new Date().toISOString(), models: entries,
          userMessage: "이 연결의 모델 목록을 확인했습니다. 실제 사용은 요청 시 계정 권한과 사용 한도의 영향을 받습니다.",
          availabilityIsNotEntitlementProof: true,
        }, expected);
      }
      if (typeof next !== "string" || next.length > 2048 || cursors.has(next)) throw new Error("invalid_model_cursor");
      cursors.add(next);
      const nextUrl = new URL(spec.url);
      nextUrl.searchParams.set(provider === "gemini" ? "pageToken" : "after_id", next);
      url = nextUrl.href;
    }
    throw new Error("model_catalog_page_limit");
  } catch {
    const value = unavailableModelCatalog(provider, selectedModel, [401, 403].includes(httpStatus) ? "connection_rejected" : "catalog_unavailable", sourceFor(provider));
    if ([401, 403].includes(httpStatus)) {
      value.state = "blocked";
      value.models = value.models.map((model) => ({ ...model, availability: "blocked" }));
      value.userMessage = "현재 계정의 모델 조회 권한이 거절됐습니다. 연결을 다시 확인해 주세요.";
    }
    value.checkedAt = new Date().toISOString();
    return remember(context, value, expected);
  } finally {
    clearTimeout(timer);
  }
}

export function noteModelExecution(context, model, result) {
  const existing = peekModelAvailability(context);
  if (!existing) return;
  const rejected = [401, 403, 404].includes(result?.httpStatus)
    || /model.{0,120}(?:not supported|unsupported|does not exist|not found|not available|no access)|(?:not supported|unsupported|no access).{0,120}model/iu.test(String(result?.errorMessage ?? ""));
  if (!rejected && result?.status !== "generate_content_loaded") return;
  const entry = existing.models.find((item) => item.id === model);
  if (!entry) return;
  const key = modelAvailabilityKey(context);
  requestGenerations.set(key, ++requestSequence);
  entry.availability = rejected ? "blocked" : "available";
  entry.evidence = "response";
  entry.reason = rejected ? "request_rejected" : undefined;
  existing.state = existing.models.some((item) => item.availability === "available") ? "available" : "blocked";
  if (rejected) existing.userMessage = "선택한 모델의 요청이 거절됐습니다. 다른 모델로 자동 전환하지 않았습니다. 연결을 확인하고 목록을 새로고침해 주세요.";
  remember(context, existing);
}

export function chooseAvailableModel(availability, requested = "latest") {
  if (availability?.state !== "available") return "";
  const models = availability?.models?.filter((model) => model.availability === "available") ?? [];
  if (!requested || requested === "latest") return models[0]?.id ?? "";
  if (requested === "fast") return models.find((model) => /mini|small|fast|nano|lite|luna/u.test(model.id))?.id ?? models.at(-1)?.id ?? "";
  return models.find((model) => model.id === requested)?.id ?? "";
}
