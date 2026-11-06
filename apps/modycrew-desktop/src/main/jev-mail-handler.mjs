import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildJevMailRequest, evaluateJevMail, JEV_MAIL_MODEL } from "./jev-mail-decision.mjs";

const modes = new Set(["off", "shadow", "assist"]);
const queues = new Map();
const sessions = new Map();
const defaultConfig = () => ({ version: 1, revision: "initial", mode: "off", allowContent: false, encryptedSecret: "" });
const sampleMail = { subject: "샘플: 견적 요청", bodyPreview: "테스트 회사의 합성 메일입니다. 포장재 300개 견적과 가능한 납기를 알려 주세요." };
const flags = { externalMutation: false, rawSecretMaterialStored: false, rawSecretMaterialReturned: false };

function configPath(options) {
  const root = options.app?.getPath?.("userData");
  return root ? path.join(root, "jev-mail-settings.v1.json") : null;
}

function sessionFor(file) {
  if (!sessions.has(file)) sessions.set(file, { cache: new Map(), pending: new Map(), controllers: new Set(), lastRun: null });
  return sessions.get(file);
}

async function readConfig(file) {
  if (!file) return defaultConfig();
  try {
    const text = await readFile(file, "utf8");
    if (text.length > 32_768) throw new Error("invalid");
    const value = JSON.parse(text);
    if (value?.version !== 1 || !modes.has(value.mode) || typeof value.allowContent !== "boolean" ||
        typeof value.encryptedSecret !== "string" || value.encryptedSecret.length > 16_384 ||
        typeof value.revision !== "string") throw new Error("invalid");
    return value;
  } catch (error) {
    if (error?.code === "ENOENT") return defaultConfig();
    throw new Error("jev_settings_unreadable");
  }
}

function publicConfig(config, file, userMessage = "메일 분류 보조 설정을 확인했습니다.") {
  return { ...flags, status: "ready", mode: config.mode, allowContent: config.allowContent,
    hasKey: Boolean(config.encryptedSecret), model: JEV_MAIL_MODEL,
    lastRun: file ? sessionFor(file).lastRun : null, userMessage };
}

function failure(code, userMessage) {
  return { ...flags, status: code, userMessage };
}

async function exclusive(file, operation) {
  const previous = queues.get(file) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(operation);
  queues.set(file, next);
  try { return await next; } finally { if (queues.get(file) === next) queues.delete(file); }
}

async function writeConfig(file, config) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  await mkdir(path.dirname(file), { recursive: true });
  try {
    await writeFile(temporary, `${JSON.stringify(config)}\n`, { encoding: "utf8", mode: 0o600 });
    await rename(temporary, file);
  } finally { await rm(temporary, { force: true }).catch(() => {}); }
  const session = sessionFor(file);
  for (const controller of session.controllers) controller.abort();
  session.cache.clear();
  session.pending.clear();
  session.lastRun = null;
}

function decryptKey(config, options) {
  if (!config.encryptedSecret || !options.safeStorage?.isEncryptionAvailable?.()) return null;
  try {
    const key = options.safeStorage.decryptString(Buffer.from(config.encryptedSecret, "base64"));
    return typeof key === "string" && key.trim() && key.length <= 4096 ? key : null;
  } catch { return null; }
}

export async function handleJevMailMessage(payload = {}, options = {}) {
  const file = configPath(options);
  if (!file) return failure("desktop_required", "Jev 메일 분류는 데스크톱 앱에서 설정할 수 있습니다.");
  try {
    if (payload.kind === "jev_status") return publicConfig(await readConfig(file), file);
    if (payload.kind === "jev_save" || payload.kind === "jev_disconnect") {
      return await exclusive(file, async () => {
        const previous = await readConfig(file);
        if (payload.kind === "jev_disconnect") {
          const cleared = { ...defaultConfig(), revision: randomUUID() };
          await writeConfig(file, cleared);
          return publicConfig(cleared, file, "Jev 연결을 해제하고 저장된 키를 지웠습니다.");
        }
        const input = payload.payload ?? {};
        if (!modes.has(input.mode) || typeof input.allowContent !== "boolean") {
          return failure("invalid_settings", "사용 방식을 선택해 주세요.");
        }
        const secret = typeof input.secret === "string" ? input.secret.trim() : "";
        if (secret.length > 4096 || /[\r\n]/u.test(secret)) return failure("invalid_key", "API 키 형식을 확인해 주세요.");
        let encryptedSecret = previous.encryptedSecret;
        if (secret) {
          if (!options.safeStorage?.isEncryptionAvailable?.()) return failure("encryption_unavailable", "이 PC의 보안 저장소를 사용할 수 없어 키를 저장하지 않았습니다.");
          encryptedSecret = options.safeStorage.encryptString(secret).toString("base64");
        }
        if (input.mode !== "off" && (!encryptedSecret || !input.allowContent)) {
          return failure("connection_required", "API 키와 메일 내용 전송 동의가 필요합니다.");
        }
        const next = { version: 1, revision: randomUUID(), mode: input.mode, allowContent: input.allowContent, encryptedSecret };
        await writeConfig(file, next);
        return publicConfig(next, file, "설정을 저장했습니다. 다음 메일 확인부터 적용됩니다.");
      });
    }
    if (payload.kind === "jev_test") {
      const config = await readConfig(file);
      const apiKey = decryptKey(config, options);
      if (!apiKey || !config.allowContent) return failure("connection_required", "API 키와 전송 동의를 먼저 저장해 주세요.");
      const controller = new AbortController();
      const session = sessionFor(file);
      session.controllers.add(controller);
      try {
        const result = await evaluateJevMail(sampleMail, { apiKey, fetch: options.jevFetch ?? options.fetch, signal: controller.signal });
        if ((await readConfig(file)).revision !== config.revision) return failure("settings_changed", "설정이 변경되어 이전 테스트 결과를 반영하지 않았습니다.");
        return { ...flags, ...result, synthetic: true,
          userMessage: result.status === "evaluated" ? "합성 샘플 메일로 연결을 확인했습니다. 실제 메일 정확도는 별도 평가가 필요합니다." : "연결을 확인하지 못했습니다. API 키와 네트워크 상태를 확인해 주세요." };
      } finally { session.controllers.delete(controller); }
    }
    return failure("unsupported_request", "지원하지 않는 메일 분류 요청입니다.");
  } catch {
    return failure("settings_unavailable", "메일 분류 설정을 읽거나 저장하지 못했습니다. 기존 파일은 유지했습니다.");
  }
}

export async function isJevMailEnabled(options = {}) {
  try {
    const config = await readConfig(configPath(options));
    return config.mode !== "off" && config.allowContent && Boolean(config.encryptedSecret);
  } catch { return false; }
}

/**
 * Jev 판단을 메일 읽기 결과 전체에 적용한다. 계정이 여러 개면 각 메일 읽기마다 판단한다.
 * scopeKey 는 문자열(모든 읽기에 같은 범위) 또는 read → 문자열 함수다.
 * Jev 가 꺼져 있으면(기본) 규칙 판단 보고서를 그대로 돌려준다 — 켜는 것은 사용자 선택이다.
 */
export async function createJevMailWorkReport({ domain, planner, input, scopeKey }, options = {}) {
  const baselineReport = planner.createReport(input);
  const reads = (input.reads ?? []).filter((item) => item?.action === "list_mail_messages");
  const hints = [];
  const summaries = [];
  for (const read of reads) {
    const readScopeKey = typeof scopeKey === "function" ? scopeKey(read) : scopeKey;
    const judged = await judgeJevMailRead({ read, baselineReport, domain, scopeKey: readScopeKey }, options);
    if (!judged.summary) continue;
    summaries.push(judged.summary);
    hints.push(...judged.hints);
  }
  if (!summaries.length) return baselineReport;
  const summary = {
    mode: summaries[0].mode,
    evaluated: summaries.reduce((sum, item) => sum + Number(item.evaluated ?? 0), 0),
    disagreements: summaries.reduce((sum, item) => sum + Number(item.disagreements ?? 0), 0),
  };
  const report = hints.length ? planner.createReport({ ...input, mailDecisionHints: hints }) : baselineReport;
  return { ...report, auditMessages: [...report.auditMessages,
    `Jev ${summary.mode === "shadow" ? "비교" : "분류 보조"}: ${summary.evaluated}건 판단, 기존 분류와 ${summary.disagreements}건 불일치. 외부 실행 승인은 기존 정책을 유지합니다.`] };
}

/** Only sanitized metadata and explicitly permitted previews leave the PC. No raw mail is persisted here. */
export async function judgeJevMailRead({ read, baselineReport, domain, scopeKey }, options = {}) {
  const file = configPath(options);
  const empty = { hints: [], summary: null };
  if (!file || !read || read.action !== "list_mail_messages" || !scopeKey ||
      read.externalMutation !== false || read.rawSecretMaterialStored !== false) return empty;
  let config;
  try { config = await readConfig(file); } catch { return empty; }
  if (config.mode === "off" || !config.allowContent) return empty;
  const apiKey = decryptKey(config, options);
  if (!apiKey) return empty;
  const session = sessionFor(file);
  const controller = new AbortController();
  session.controllers.add(controller);
  const started = Date.now();
  const summary = { mode: config.mode, model: JEV_MAIL_MODEL, evaluated: 0, failed: 0,
    disagreements: 0, applied: 0, cacheHits: 0, skipped: 0, deferred: 0, totalInputTokens: 0, latencyMs: 0,
    at: new Date().toISOString() };
  const hints = [];
  const baseline = new Map((baselineReport?.candidates ?? []).map((item) => [item.sourceId, item.classification]));
  const pending = [];
  try {
    for (const message of read.messages ?? []) {
      const secure = domain.createMailSecureIntakeDecision(message);
      if (secure.matchedRules.includes("계정/인증 보안 알림")) { summary.skipped++; continue; }
      const mail = { subject: message.subject, bodyPreview: secure.aiMayReadBodyPreview ? secure.bodyPreviewForAi : "" };
      const request = buildJevMailRequest(mail);
      const cacheKey = createHash("sha256").update(JSON.stringify([config.revision, scopeKey, read.providerId,
        read.connectorId, message.mailboxId, message.messageId, request])).digest("hex");
      const cached = session.cache.get(cacheKey);
      if (cached && Date.now() - cached.at < 300_000) {
        summary.cacheHits++;
        consume(message, cached.result);
      } else if (pending.length < 8) {
        pending.push({ message, mail, cacheKey });
      } else summary.deferred++;
    }
    let cursor = 0;
    async function worker() {
      while (cursor < pending.length && !controller.signal.aborted) {
        const item = pending[cursor++];
        const remaining = 8_000 - (Date.now() - started);
        if (remaining < 100) { summary.deferred++; continue; }
        if ((await readConfig(file)).revision !== config.revision) { controller.abort(); break; }
        let request = session.pending.get(item.cacheKey);
        const shared = Boolean(request);
        if (!request) {
          request = evaluateJevMail(item.mail, { apiKey, fetch: options.jevFetch ?? options.fetch,
            signal: controller.signal, timeoutMs: remaining });
          session.pending.set(item.cacheKey, request);
        }
        let result;
        try { result = await request; } finally {
          if (session.pending.get(item.cacheKey) === request) session.pending.delete(item.cacheKey);
        }
        if (controller.signal.aborted) break;
        if (result.status === "evaluated") {
          if (shared) summary.cacheHits++;
          else summary.totalInputTokens += result.inputTokens;
          session.cache.set(item.cacheKey, { at: Date.now(), result });
          while (session.cache.size > 256) session.cache.delete(session.cache.keys().next().value);
          consume(item.message, result);
        } else summary.failed++;
      }
    }
    function consume(message, result) {
      summary.evaluated++;
      if (baseline.get(message.messageId) !== result.category.choice) summary.disagreements++;
      // 비교 모드는 카드에 아무것도 반영하지 않는다.
      if (config.mode !== "assist") return;
      // 분류·답장 판단은 도메인이 확신도 0.9 이상일 때만 쓴다(isUsableMailDecisionHint).
      // 긴급도·회신 확률·업무 종류는 승인함 정렬과 담당 제안에만 쓰고, 발송·알림은 정하지 않는다.
      if (result.category.confidence >= 0.9 && result.category.probabilities[result.category.choice] >= 0.9) summary.applied++;
      const workType = result.workType?.choice ? {
        workType: result.workType.choice,
        workTypeConfidence: result.workType.confidence,
        workTypeProbability: result.workType.probabilities[result.workType.choice],
      } : {};
      hints.push({ connectorId: read.connectorId, providerId: read.providerId, messageId: message.messageId,
        hint: { model: JEV_MAIL_MODEL, category: result.category.choice, confidence: result.category.confidence,
          probability: result.category.probabilities[result.category.choice], needsReply: result.needsReply,
          urgencyScore: result.urgency.score, urgencyConfidence: result.urgency.confidence, ...workType } });
    }
    await Promise.all([worker(), worker()]);
    if (controller.signal.aborted || (await readConfig(file)).revision !== config.revision) return empty;
    summary.latencyMs = Date.now() - started;
    session.lastRun = summary;
    return { hints, summary };
  } catch { return empty; } finally { session.controllers.delete(controller); }
}
