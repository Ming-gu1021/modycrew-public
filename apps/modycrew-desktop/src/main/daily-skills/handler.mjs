/**
 * IPC mody.daily-skills.v1 — 일상 도구 목록과 읽기 전용 조회.
 *
 * kind:
 *  - "catalog": 화면용 공개 카탈로그(이름·설명·예문·인자 설명)
 *  - "lookup":  { skillId, endpointId, params } → 검증 후 공개 중계 서버 GET 1회
 *
 * 화면이 보낸 값은 신뢰하지 않는다. 경로·인자 검증과 네트워크 경계는 proxy-client 가 맡는다.
 */
import * as bundledCatalog from "./catalog-data.mjs";
import { createDailySkillsProxyClient } from "./proxy-client.mjs";

const maxPayloadChars = 4_000;

function payloadTooLarge(payload) {
  try {
    return JSON.stringify(payload ?? {}).length > maxPayloadChars;
  } catch {
    return true;
  }
}

export function createDailySkillsHandler(options = {}) {
  const client = createDailySkillsProxyClient({
    catalog: options.catalog ?? bundledCatalog,
    fetchImpl: options.fetchImpl,
    env: options.env ?? process.env,
    appVersion: options.appVersion,
    now: options.now,
    timeoutMs: options.timeoutMs,
    cacheTtlMs: options.cacheTtlMs,
    rateLimitPerMinute: options.rateLimitPerMinute,
  });

  return async function handleDailySkillsMessage(_event, payload) {
    if (!payload || typeof payload !== "object" || Array.isArray(payload) || payloadTooLarge(payload)) {
      return { ok: false, status: "daily_skill_invalid_request", userMessage: "일상 도구 요청 형식이 올바르지 않아요." };
    }
    if (payload.kind === "catalog") {
      return { ok: true, status: "daily_skills_catalog_loaded", ...client.publicCatalog() };
    }
    if (payload.kind === "lookup") {
      return client.lookup({ skillId: payload.skillId, endpointId: payload.endpointId, params: payload.params });
    }
    return { ok: false, status: "daily_skill_invalid_request", userMessage: "알 수 없는 일상 도구 요청이에요." };
  };
}
