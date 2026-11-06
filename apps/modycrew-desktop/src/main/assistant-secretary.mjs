/**
 * MODY 비서(24시간 비서)의 메인 프로세스 엔진.
 *
 * 앱이 켜져 있는 동안(창을 닫아 트레이에 있어도) 1분마다 이 PC에 이미 있는 근거만 읽는다:
 * 업무함(메일·일정 카드), 통합 메일 원장, 업무 대화의 마감, 승인 대기 수, 연결 상태, 메일 자동 확인 결과.
 * 연결된 캘린더는 10분마다 읽기 전용으로 직접 확인한다(바쁜 시간만 읽는 권한이라 제목은 모른다고 말한다).
 * 그 근거로 먼저 말을 거는 대화 메시지(오늘 브리핑, 곧 시작할 일정, 임박한 마감, 답장할 새 메일,
 * 끊긴 연결 다시 연결 안내)를 만들고, 필요한 것은 PC 알림으로도 띄운다.
 *
 * 근거를 읽지 못한 것은 '없음'으로 치지 않는다. 연결 목록을 못 읽었으면 끊김·복구를 말하지 않고,
 * 저장에 실패하면 성공한 척하지 않고 화면에 알린다. 읽지 못한 기록 파일은 보관한 뒤에만 새로 쓴다.
 *
 * 하지 않는 일: 메일 발송·일정 등록·파일 변경·외부 전송·모델 호출. 대화 답변은 사용자가 말을 걸었을 때
 * 화면이 기존 AI 경로로 만든다. 메일 원문은 저장하지 않고 제목·보낸 사람만 쓴다.
 */
import { copyFile } from "node:fs/promises";
import path from "node:path";
import { readJsonStore, replaceFileWithText } from "./json-store.mjs";

export const assistantSecretaryChannel = "mody.assistant-secretary.v1";
export const assistantSecretaryChangedChannel = "mody.assistant-secretary.changed";

const storeVersion = 1;
const maxMessages = 400;
const maxReturnedMessages = 200;
const tickIntervalMs = 60_000;
const dayMs = 86_400_000;
const minuteMs = 60_000;
const calendarRefreshMs = 10 * minuteMs;
const idlePersistMs = 10 * minuteMs;
const terminalStatuses = new Set(["completed", "held", "rejected", "done", "archived", "sent"]);
// 'disconnected'·'not_connected' 는 끝이 connected 라 정상처럼 보인다. 끊김을 뜻하는 말이 하나라도 있으면 끊김이다.
const brokenConnectorStatus = /(fail|error|expired|revoked|invalid|required|missing|unavailable|disconnected|not_connected|mismatch|denied|not_found|blocked|(?:^|_)needs_)/u;
// 캘린더 읽기에서 이런 말이 나오면 한 번만 실패해도 다시 연결이 필요하다(기다려도 풀리지 않는다).
const calendarAuthFailure = /(token|credential|auth|expired|revoked|invalid_grant|unauthori[sz]ed|forbidden|scope|consent|permission)/u;
// 메일 자동 확인 실패가 로그인 문제로 보이면 2번, 그 밖(네트워크 등)은 3번 연속일 때 알린다.
const mailAuthFailure = /(invalid_grant|unauthori[sz]ed|\b401\b|\b403\b|token|credential|인증|로그인|만료|비밀번호|password)/iu;
const brokenRecoveryKinds = new Set([
  "credential_failed",
  "connection_required",
  "oauth_token_expired",
  "oauth_read_scope_required",
  "oauth_app_registration_required",
  "oauth_admin_consent_required",
]);

export function defaultSecretaryPreferences() {
  return {
    notifications: true,
    quietHours: true,
    quietStartHour: 21,
    quietEndHour: 8,
    briefingHour: 8,
    briefingMinute: 30,
    assistantName: "MODY",
    // 잠금 화면 등에 뜨는 PC 알림에서 메일 제목·일정 제목을 가린다(앱 대화에는 그대로 남는다).
    hideNotificationContent: false,
  };
}

function emptyStore() {
  return {
    version: storeVersion,
    messages: [],
    memory: { dedupe: {}, seenMail: {}, incidents: {}, baselineDone: false, lastBriefingDate: "", lastApprovalCount: null, lastApprovalNoticeAt: 0 },
    preferences: defaultSecretaryPreferences(),
    lastTickAt: "",
    lastContextSummary: null,
  };
}

const pad = (value) => String(value).padStart(2, "0");
export const localDateKey = (ms) => {
  const date = new Date(ms);
  return date.getFullYear() + "-" + pad(date.getMonth() + 1) + "-" + pad(date.getDate());
};
const hhmm = (ms) => {
  const date = new Date(ms);
  return pad(date.getHours()) + ":" + pad(date.getMinutes());
};
const weekdays = ["일", "월", "화", "수", "목", "금", "토"];
const dayLabel = (ms) => {
  const date = new Date(ms);
  return (date.getMonth() + 1) + "월 " + date.getDate() + "일(" + weekdays[date.getDay()] + ")";
};

export function cleanSecretaryText(value, limit = 400) {
  return String(value ?? "")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, " ")
    .replace(/[ \t]+/gu, " ")
    .trim()
    .slice(0, limit);
}
const oneLine = (value, limit = 120) => cleanSecretaryText(String(value ?? "").replace(/\s+/gu, " "), limit);
const finiteTime = (value) => {
  if (typeof value === "number") return Number.isFinite(value) ? value : NaN;
  const parsed = Date.parse(String(value ?? ""));
  return Number.isFinite(parsed) ? parsed : NaN;
};
const isFinitePositive = (value) => Number.isFinite(value) && value > 0;

function sanitizeAction(action) {
  if (!action || typeof action !== "object") return null;
  const kind = ["open", "prompt", "mail_draft", "tick"].includes(action.kind) ? action.kind : "";
  if (!kind) return null;
  const label = oneLine(action.label, 40);
  if (!label) return null;
  const result = { kind, label };
  if (kind === "open") {
    const href = String(action.href ?? "").trim();
    // 앱 안 경로만 허용한다. 외부 주소·스크립트 주소는 버린다.
    if (!/^\/(?!\/)[A-Za-z0-9_\-./?=&%]*$/u.test(href)) return null;
    result.href = href.slice(0, 300);
  }
  if (kind === "prompt") result.prompt = cleanSecretaryText(action.prompt, 1200);
  if (kind === "mail_draft") {
    result.messageId = oneLine(action.messageId, 200);
    result.accountId = oneLine(action.accountId, 200);
    result.subject = oneLine(action.subject, 160);
    if (!result.messageId) return null;
  }
  return result;
}

function sanitizeMessage(input, now) {
  const role = ["user", "assistant", "notice"].includes(input?.role) ? input.role : "assistant";
  const text = cleanSecretaryText(input?.text, role === "user" ? 4000 : role === "assistant" ? 8000 : 1600);
  if (!text) return null;
  const kind = oneLine(input?.kind || "chat", 32);
  const severity = ["info", "attention", "urgent"].includes(input?.severity) ? input.severity : "info";
  const actions = Array.isArray(input?.actions) ? input.actions.map(sanitizeAction).filter(Boolean).slice(0, 4) : [];
  const createdAt = new Date(isFinitePositive(finiteTime(input?.createdAt)) ? finiteTime(input.createdAt) : now).toISOString();
  const message = {
    id: oneLine(input?.id, 120) || role + "-" + now.toString(36) + "-" + Math.random().toString(36).slice(2, 8),
    role,
    kind,
    text,
    severity,
    actions,
    createdAt,
    read: role === "user" ? true : input?.read === true,
  };
  if (input?.meta && typeof input.meta === "object") {
    const meta = {};
    if (Array.isArray(input.meta.usedTools)) meta.usedTools = input.meta.usedTools.map((tool) => oneLine(tool, 40)).filter(Boolean).slice(0, 8);
    if (Array.isArray(input.meta.stagedDraftIds)) meta.stagedDraftIds = input.meta.stagedDraftIds.map((id) => oneLine(id, 160)).filter(Boolean).slice(0, 6);
    if (typeof input.meta.failed === "boolean") meta.failed = input.meta.failed;
    if (Object.keys(meta).length) message.meta = meta;
  }
  return message;
}

function normalizeStore(value) {
  const base = emptyStore();
  const now = Date.now();
  const messages = Array.isArray(value?.messages)
    ? value.messages.map((message) => sanitizeMessage(message, now)).filter(Boolean).slice(-maxMessages)
    : [];
  const memory = value?.memory && typeof value.memory === "object" ? value.memory : {};
  return {
    version: storeVersion,
    messages,
    memory: {
      dedupe: memory.dedupe && typeof memory.dedupe === "object" ? memory.dedupe : {},
      seenMail: memory.seenMail && typeof memory.seenMail === "object" ? memory.seenMail : {},
      incidents: memory.incidents && typeof memory.incidents === "object" ? memory.incidents : {},
      baselineDone: memory.baselineDone === true,
      lastBriefingDate: typeof memory.lastBriefingDate === "string" ? memory.lastBriefingDate : "",
      lastApprovalCount: Number.isFinite(memory.lastApprovalCount) ? memory.lastApprovalCount : null,
      lastApprovalNoticeAt: Number.isFinite(memory.lastApprovalNoticeAt) ? memory.lastApprovalNoticeAt : 0,
    },
    preferences: { ...base.preferences, ...sanitizePreferences(value?.preferences ?? {}) },
    lastTickAt: typeof value?.lastTickAt === "string" ? value.lastTickAt : "",
    lastContextSummary: value?.lastContextSummary && typeof value.lastContextSummary === "object" ? value.lastContextSummary : null,
  };
}

export function sanitizePreferences(patch = {}) {
  const result = {};
  if (typeof patch.notifications === "boolean") result.notifications = patch.notifications;
  if (typeof patch.quietHours === "boolean") result.quietHours = patch.quietHours;
  if (typeof patch.hideNotificationContent === "boolean") result.hideNotificationContent = patch.hideNotificationContent;
  for (const key of ["quietStartHour", "quietEndHour", "briefingHour"]) {
    const value = Number(patch[key]);
    if (patch[key] !== undefined && patch[key] !== null && Number.isInteger(value) && value >= 0 && value <= 23) result[key] = value;
  }
  const minute = Number(patch.briefingMinute);
  if (patch.briefingMinute !== undefined && patch.briefingMinute !== null && Number.isInteger(minute) && minute >= 0 && minute <= 59) result.briefingMinute = minute;
  const name = oneLine(patch.assistantName, 30);
  if (name) result.assistantName = name;
  return result;
}

// ── 근거 정리(순수 함수) ────────────────────────────────────────────────

/** 업무함 카드에서 앞으로의 일정(시작 시각이 있는 것)만 모은다. 다른 카드를 요약한 브리핑 카드는 뺀다. */
export function collectUpcomingEvents(inbox = [], now = Date.now()) {
  const events = [];
  const seen = new Set();
  const push = (event) => {
    if (!Number.isFinite(event.startsAt)) return;
    if (event.startsAt < now - 2 * 60 * minuteMs || event.startsAt > now + 8 * dayMs) return;
    const key = event.title + "@" + event.startsAt;
    if (seen.has(key)) return;
    seen.add(key);
    events.push(event);
  };
  for (const item of Array.isArray(inbox) ? inbox : []) {
    if (!item || typeof item !== "object" || terminalStatuses.has(item.status)) continue;
    if (item.scheduleBriefing && item.scheduleBriefing.kind !== "meeting") continue;
    const baseTitle = oneLine(item.title, 80) || "일정";
    for (const schedule of Array.isArray(item.schedules) ? item.schedules : []) {
      push({
        id: oneLine(item.id, 120) + ":" + oneLine(schedule?.id || schedule?.startsAt, 60),
        workItemId: oneLine(item.id, 120),
        title: oneLine(schedule?.label || schedule?.title, 80) || baseTitle,
        startsAt: finiteTime(schedule?.startsAt),
        location: oneLine(schedule?.location, 60),
      });
    }
    const evidence = item.sourceEvidence ?? {};
    const calendarStartsAt = finiteTime(evidence.calendarStartsAt);
    if (Number.isFinite(calendarStartsAt)) {
      push({ id: oneLine(item.id, 120) + ":calendar", workItemId: oneLine(item.id, 120), title: baseTitle, startsAt: calendarStartsAt, location: oneLine(evidence.calendarLocationLabel, 60) });
    }
    if (item.source === "calendar" || item.scheduleBriefing?.kind === "meeting") {
      const due = finiteTime(item.dueAt ?? item.deadlineAt);
      if (Number.isFinite(due)) push({ id: oneLine(item.id, 120) + ":due", workItemId: oneLine(item.id, 120), title: baseTitle, startsAt: due, location: "" });
    }
  }
  return events.sort((a, b) => a.startsAt - b.startsAt);
}

/** 마감이 있는 일. 업무함 카드(dueAt)와 업무 대화(dueDate, 날짜만)를 함께 본다. */
export function collectDeadlines(inbox = [], sessions = [], now = Date.now()) {
  const deadlines = [];
  for (const item of Array.isArray(inbox) ? inbox : []) {
    if (!item || typeof item !== "object" || terminalStatuses.has(item.status) || item.scheduleBriefing) continue;
    if (item.source === "calendar") continue;
    const due = finiteTime(item.dueAt ?? item.deadlineAt);
    if (!Number.isFinite(due)) continue;
    deadlines.push({ id: "item:" + oneLine(item.id, 120), workItemId: oneLine(item.id, 120), title: oneLine(item.title, 80) || "업무", dueAt: due, dateOnly: false });
  }
  for (const session of Array.isArray(sessions) ? sessions : []) {
    if (!session || typeof session !== "object" || session.archivedAt || session.status === "done") continue;
    const dueDate = String(session.dueDate ?? "");
    if (!/^\d{4}-\d{2}-\d{2}$/u.test(dueDate)) continue;
    const due = new Date(dueDate + "T18:00:00").getTime();
    if (!Number.isFinite(due)) continue;
    deadlines.push({ id: "session:" + oneLine(session.threadId, 120), threadId: oneLine(session.threadId, 120), title: oneLine(session.title, 80) || "업무 대화", dueAt: due, dueDate, dateOnly: true });
  }
  const today = localDateKey(now);
  return deadlines
    .map((deadline) => ({ ...deadline, overdue: deadline.dateOnly ? deadline.dueDate < today : deadline.dueAt < now }))
    .sort((a, b) => a.dueAt - b.dueAt);
}

// 광고·소셜·알림 같은 메일은 먼저 일을 제안할 대상이 아니다.
const nonBusinessMailCategories = new Set(["promotion", "promotions", "social", "notification", "notifications", "update", "updates", "forum", "forums", "spam", "newsletter"]);

/**
 * 먼저 일을 제안할 업무 메일: 광고·소셜·알림을 빼고 답장·일정·영수증 신호가 있는 메일.
 * 다른 메일 프로그램(회사 웹메일·Outlook)에서 이미 읽은 메일도 처리 여부를 알 수 없으므로 포함한다(한 번만 제안).
 * 원문은 싣지 않고 제목·보낸 사람만 쓴다.
 */
export function collectMailProposals(mailRows = [], now = Date.now(), withinMs = 3 * dayMs) {
  return (Array.isArray(mailRows) ? mailRows : [])
    .filter((row) => row && typeof row === "object" && !nonBusinessMailCategories.has(String(row.category ?? "").toLowerCase()))
    .map((row) => ({
      key: oneLine(row.accountId, 120) + ":" + oneLine(row.messageId, 200),
      messageId: oneLine(row.messageId, 200),
      accountId: oneLine(row.accountId, 120),
      subject: oneLine(row.subject, 100) || "(제목 없음)",
      from: oneLine(String(row.from ?? "").replace(/<[^>]*>/gu, ""), 60),
      receivedAt: finiteTime(row.receivedAt),
      read: row.isRead === true,
      kinds: [row.replyCandidate === true ? "reply" : "", row.scheduleCandidate === true ? "schedule" : "", row.receiptCandidate === true ? "receipt" : ""].filter(Boolean),
    }))
    .filter((row) => row.kinds.length && row.messageId && Number.isFinite(row.receivedAt) && now - row.receivedAt <= withinMs && row.receivedAt <= now + 10 * minuteMs)
    .sort((a, b) => b.receivedAt - a.receivedAt);
}

/** 답장 후보(읽음 여부 무관, 업무 메일만). 화면·프롬프트의 '답장할 메일'에 쓴다. */
export function collectReplyCandidates(mailRows = [], now = Date.now(), withinMs = 7 * dayMs) {
  return collectMailProposals(mailRows, now, withinMs).filter((row) => row.kinds.includes("reply"));
}

const mailListHref = "/?panel=mail&mailFocus=reply";

function mailDraftAction(row) {
  return { kind: "mail_draft", label: "답장 초안 만들기", messageId: row.messageId, accountId: row.accountId, subject: row.subject };
}

function mailSchedulePrompt(row) {
  return "'" + row.subject + "' 메일(메일 ID: " + row.messageId + ")을 읽고 날짜·시간·장소·참석자를 정리해 일정 후보로 만들어줘. 캘린더 등록은 하지 말고 승인함에 등록 후보로만 올려줘.";
}

function mailReceiptPrompt(row) {
  return "'" + row.subject + "' 메일(메일 ID: " + row.messageId + ")을 읽고 금액·결제 기한·거래처를 정리해줘. 결제나 회신은 하지 마.";
}

/** 업무 메일 한 통에 대한 먼저 제안 문장과 버튼. */
export function mailProposalMessage(row) {
  const head = "'" + row.subject + "'" + (row.from ? " — " + row.from : "");
  const readNote = row.read ? " 이미 읽으신 메일이라면 처리하셨는지만 확인해 주세요." : "";
  if (row.kinds.includes("schedule")) {
    return {
      text: head + " 메일에 일정이 들어 있어요. 날짜·시간·장소를 정리해 일정 후보로 올려 둘까요? 캘린더 등록은 승인하신 뒤에만 해요." + readNote,
      actions: [
        { kind: "prompt", label: "일정 후보로 정리", prompt: mailSchedulePrompt(row) },
        ...(row.kinds.includes("reply") ? [mailDraftAction(row)] : []),
        { kind: "open", label: "메일 보기", href: mailListHref },
      ],
    };
  }
  if (row.kinds.includes("reply")) {
    return {
      text: head + " 메일에 답장이 필요해 보여요. 답장 초안을 만들어 승인함에 올려 둘까요? 보내기는 승인하신 뒤에만 해요." + readNote,
      actions: [mailDraftAction(row), { kind: "open", label: "답장 후보 보기", href: mailListHref }],
    };
  }
  return {
    text: head + " 메일이 영수증·청구 메일로 보여요. 금액과 결제 기한을 정리해 둘까요?" + readNote,
    actions: [{ kind: "prompt", label: "영수증 정리", prompt: mailReceiptPrompt(row) }, { kind: "open", label: "메일 보기", href: mailListHref }],
  };
}

function countMailKinds(rows) {
  return {
    total: rows.length,
    reply: rows.filter((row) => row.kinds.includes("reply")).length,
    schedule: rows.filter((row) => row.kinds.includes("schedule")).length,
    receipt: rows.filter((row) => row.kinds.includes("receipt")).length,
  };
}

function mailKindsLabel(counts) {
  return [counts.reply ? "답장 " + counts.reply : "", counts.schedule ? "일정 " + counts.schedule : "", counts.receipt ? "영수증 " + counts.receipt : ""].filter(Boolean).join(" · ");
}

/** 업무함에 이미 올라온 메일 카드(최근 7일): 답장 초안이 준비된 것과 확인이 필요한 것. */
export function collectMailWorkCards(inbox = [], now = Date.now()) {
  const cards = (Array.isArray(inbox) ? inbox : []).filter((item) => item && typeof item === "object"
    && ["email", "imap_smtp", "gmail", "outlook"].includes(String(item.source ?? ""))
    && now - finiteTime(item.receivedAt) <= 7 * dayMs);
  return {
    draftsReady: cards.filter((item) => item.status === "draft_ready").length,
    needsReview: cards.filter((item) => item.status === "needs_review").length,
  };
}

/**
 * 연결된 캘린더를 직접 읽은 결과(connector-handler 의 loadCalendarWorkflowContext)를 비서가 쓰는 모양으로 줄인다.
 * Google freeBusy·Outlook getSchedule 은 바쁜 시간만 돌려준다. 제목·장소는 없으니 지어내지 않는다.
 * raw 가 없으면(읽기 자체가 실패) 직전 바쁜 시간은 그대로 두고 연결별 실패 횟수만 올린다.
 */
export function normalizeCalendarSnapshot(raw, previous = null, now = Date.now()) {
  const checkedAt = new Date(now).toISOString();
  const previousReads = Array.isArray(previous?.reads) ? previous.reads : [];
  if (!raw || typeof raw !== "object") {
    return {
      checkedAt,
      reads: previousReads.map((read) => ({ ...read, ok: false, status: "calendar_read_failed", failures: (Number(read.failures) || 0) + 1 })),
      busy: Array.isArray(previous?.busy) ? previous.busy : [],
      error: "캘린더를 읽지 못했어요.",
    };
  }
  const previousFailures = new Map(previousReads.map((read) => [read.connectorId, Number(read.failures) || 0]));
  const reads = [];
  for (const read of Array.isArray(raw.calendarReads) ? raw.calendarReads : []) {
    const connectorId = oneLine(read?.connectorId, 120);
    if (!connectorId) continue;
    const ok = read.status === "calendar_context_ready";
    reads.push({ connectorId, providerId: oneLine(read.providerId, 40), ok, status: oneLine(read.status, 60), failures: ok ? 0 : (previousFailures.get(connectorId) ?? 0) + 1 });
  }
  const busy = [];
  for (const providerRead of Array.isArray(raw.providerReads) ? raw.providerReads : []) {
    if (providerRead?.action !== "list_calendar_events") continue;
    for (const event of Array.isArray(providerRead.events) ? providerRead.events : []) {
      if (busy.length >= 80) break;
      const startsAt = finiteTime(event?.startsAt);
      const endsAt = finiteTime(event?.endsAt);
      if (!Number.isFinite(startsAt)) continue;
      busy.push({
        connectorId: oneLine(providerRead.connectorId, 120),
        providerId: oneLine(providerRead.providerId, 40),
        startsAt: new Date(startsAt).toISOString(),
        endsAt: Number.isFinite(endsAt) ? new Date(endsAt).toISOString() : "",
      });
    }
  }
  return { checkedAt, reads, busy, error: "" };
}

/** 캘린더에서 읽은 바쁜 시간을 일정으로 바꾼다. 제목은 '캘린더 일정'으로만 쓰고 busyOnly 로 표시한다. */
export function collectCalendarBusy(calendar, now = Date.now()) {
  const events = [];
  const seen = new Set();
  for (const window of Array.isArray(calendar?.busy) ? calendar.busy : []) {
    const startsAt = finiteTime(window?.startsAt);
    const endsAt = finiteTime(window?.endsAt);
    if (!Number.isFinite(startsAt)) continue;
    if (startsAt < now - 2 * 60 * minuteMs || startsAt > now + 8 * dayMs) continue;
    const key = startsAt + ":" + (Number.isFinite(endsAt) ? endsAt : "");
    if (seen.has(key)) continue;
    seen.add(key);
    events.push({
      id: "busy:" + oneLine(window.connectorId, 120) + ":" + startsAt,
      workItemId: "",
      title: "캘린더 일정",
      busyOnly: true,
      allDay: Number.isFinite(endsAt) && endsAt - startsAt >= 12 * 60 * minuteMs,
      startsAt,
      endsAt: Number.isFinite(endsAt) ? endsAt : NaN,
      location: "",
    });
  }
  return events;
}

/** 업무 카드에 같은 시각(5분 안) 일정이 있으면 제목이 있는 쪽만 남긴다. */
export function mergeUpcomingEvents(titled = [], busy = []) {
  const merged = [...titled];
  for (const event of busy) {
    if (titled.some((other) => Math.abs(other.startsAt - event.startsAt) <= 5 * minuteMs)) continue;
    merged.push(event);
  }
  return merged.sort((a, b) => a.startsAt - b.startsAt);
}

function eventTimeLabel(event) {
  if (event.allDay) return "종일";
  return Number.isFinite(event.endsAt) && event.busyOnly ? hhmm(event.startsAt) + "–" + hhmm(event.endsAt) : hhmm(event.startsAt);
}

const providerLabels = {
  gmail: "Gmail",
  imap_smtp: "회사 메일",
  outlook: "Outlook 메일",
  microsoft: "Outlook 메일",
  naver: "네이버 메일",
  google_calendar: "구글 캘린더",
  "google-calendar": "구글 캘린더",
  outlook_calendar: "Outlook 캘린더",
  "outlook-calendar": "Outlook 캘린더",
};

export function connectorDisplayLabel(connector = {}) {
  const provider = String(connector.providerId ?? connector.method ?? "").toLowerCase();
  const id = String(connector.connectorId ?? "").toLowerCase();
  const base = providerLabels[provider] || providerLabels[id] || (id.startsWith("gmail") ? "Gmail" : id === "company-mail" ? "회사 메일" : connector.category === "calendar" ? "캘린더" : connector.category === "mail" ? "메일" : "연결");
  const email = oneLine(connector.emailAddress, 80);
  return email && !/redacted/u.test(email) ? base + "(" + email + ")" : base;
}

function connectorCatalogId(connector = {}) {
  const id = String(connector.connectorId ?? "");
  const provider = String(connector.providerId ?? "").toLowerCase();
  if (id.startsWith("gmail") || provider === "gmail") return "gmail";
  if (provider.includes("outlook") || provider === "microsoft") return connector.category === "calendar" ? "outlook-calendar" : "outlook-mail";
  if (provider.includes("google_calendar") || id.includes("google-calendar")) return "google-calendar";
  if (connector.method === "imap_smtp" || id === "company-mail") return "company-mail";
  return id.replace(/__.*$/u, "").slice(0, 60) || "gmail";
}

export function reconnectHref(connector = {}) {
  return "/connect?open=" + encodeURIComponent(connectorCatalogId(connector)) + "&reauth=1&from=chat";
}

/**
 * 연결 상태를 '정상 / 다시 연결 필요'로 정리한다.
 * 토큰이 곧 만료되는 것만으로는 끊김이 아니다(메일 자동 확인이 새로 받는다). 실제 실패 상태·복구 필요 판정·
 * 메일 자동 확인 실패를 근거로만 끊김을 말한다.
 */
function isRefreshableTokenExpiry(recovery = {}) {
  // connector-handler 는 OAuth access token 이 만료(임박)되면 'oauth_token_expired' 또는 'credential_failed' + '토큰 만료'로 표시한다.
  // Gmail 토큰은 1시간마다 만료되고 쓸 때 자동 갱신되므로, refresh token 이 있으면 그것만으로는 끊김이 아니다.
  // refresh token 이 없을 때만 connector-handler 가 'refresh token이 없습니다'라고 쓴다.
  const kind = String(recovery?.kind ?? "");
  if (kind !== "oauth_token_expired" && kind !== "credential_failed") return false;
  if (!/만료/u.test(String(recovery?.label ?? ""))) return false;
  return !/refresh token이 없/u.test(String(recovery?.detail ?? ""));
}

function calendarReadFailureReason(read) {
  if (calendarAuthFailure.test(read.status)) return "캘린더 로그인이 만료됐거나 저장된 로그인 정보를 쓸 수 없어요. 다시 연결해 주세요.";
  return "캘린더를 " + read.failures + "번 연속 읽지 못했어요(" + read.status + ").";
}

export function assessConnections(connectors = [], mailSync = {}, now = Date.now(), calendar = null) {
  const list = Array.isArray(connectors) ? connectors : [];
  const issues = [];
  const rows = [];
  const calendarReads = new Map((Array.isArray(calendar?.reads) ? calendar.reads : []).map((read) => [read.connectorId, read]));
  for (const connector of list) {
    if (!connector || typeof connector !== "object") continue;
    if (!["mail", "calendar"].includes(connector.category)) continue;
    const status = String(connector.status ?? "").toLowerCase();
    const recoveryKind = String(connector.recovery?.kind ?? "");
    const statusBroken = brokenConnectorStatus.test(status);
    const tokenOnlyExpiry = !statusBroken && isRefreshableTokenExpiry(connector.recovery);
    const recoveryBroken = brokenRecoveryKinds.has(recoveryKind) && !tokenOnlyExpiry;
    let broken = statusBroken || recoveryBroken;
    const label = connectorDisplayLabel(connector);
    let reason = broken
      ? oneLine(connector.recovery?.label && connector.recovery?.kind !== "ready" ? connector.recovery.label + " · " + (connector.recovery.detail ?? "") : connector.userMessage || status, 160)
      : "";
    if (!broken && connector.category === "calendar") {
      // 저장된 상태는 정상이어도 실제로 읽어 보니 실패하는 경우(토큰 철회·권한 변경)를 잡는다.
      const read = calendarReads.get(String(connector.connectorId ?? ""));
      if (read && !read.ok && (read.failures >= 2 || calendarAuthFailure.test(read.status))) {
        broken = true;
        reason = calendarReadFailureReason(read);
      }
    }
    rows.push({ key: oneLine(connector.accountId || connector.connectorId, 120), category: connector.category, label, ok: !broken, reason, href: reconnectHref(connector) });
    if (broken) {
      issues.push({ key: "conn:" + oneLine(connector.accountId || connector.connectorId, 120), connectorId: oneLine(connector.connectorId, 120), label, reason, href: reconnectHref(connector), category: connector.category });
    }
  }
  const mailConnectors = list.filter((connector) => connector?.category === "mail");
  const calendarConnected = list.some((connector) => connector?.category === "calendar" && !issues.some((issue) => issue.connectorId === connector.connectorId));
  const consecutiveFailures = Number(mailSync?.consecutiveFailures ?? 0) || 0;
  const authLikeFailure = mailAuthFailure.test([mailSync?.lastError, mailSync?.recovery?.kind, mailSync?.recovery?.label, mailSync?.recovery?.detail].filter(Boolean).join(" "));
  if (mailConnectors.length && consecutiveFailures >= (authLikeFailure ? 2 : 3)) {
    const recovery = mailSync?.recovery ?? null;
    const failingConnector = mailConnectors.find((connector) => connector.connectorId === recovery?.connectorId) ?? mailConnectors[0];
    const failureText = (recovery?.detail || mailSync?.lastError || "메일을 가져오지 못했습니다") + " (" + consecutiveFailures + "번 연속 실패)";
    const existing = issues.find((issue) => issue.category === "mail" && issue.connectorId === failingConnector?.connectorId);
    if (existing) {
      existing.reason = oneLine(existing.reason + " · 메일 자동 확인: " + failureText, 240);
    } else {
      issues.push({
        key: "mailsync",
        connectorId: oneLine(failingConnector?.connectorId, 120),
        label: recovery?.label ? oneLine(recovery.label, 40) : "메일 자동 확인",
        reason: oneLine(failureText, 200),
        href: failingConnector ? reconnectHref(failingConnector) : "/connect?open=gmail&from=chat",
        category: "mail",
      });
    }
  }
  const lastSuccess = finiteTime(mailSync?.lastSuccessAt);
  const runningSince = finiteTime(mailSync?.startedAt);
  if (mailConnectors.length && !issues.some((issue) => issue.category === "mail") && Number.isFinite(runningSince) && now - runningSince > 75 * minuteMs
    && (!Number.isFinite(lastSuccess) || now - lastSuccess > 75 * minuteMs) && mailSync?.skippedNoConnector !== true) {
    issues.push({
      key: "mailstale",
      connectorId: oneLine(mailConnectors[0]?.connectorId, 120),
      label: "메일 최신화",
      reason: Number.isFinite(lastSuccess) ? "마지막으로 메일을 가져온 시각이 " + hhmm(lastSuccess) + "입니다. 그 뒤로 새 메일을 가져오지 못했어요." : "앱을 켠 뒤 메일을 한 번도 가져오지 못했어요.",
      href: reconnectHref(mailConnectors[0]),
      category: "mail",
    });
  }
  if (mailConnectors.length && mailSync?.skippedNoConnector === true && !issues.some((issue) => issue.category === "mail")) {
    issues.push({
      key: "mailnotready",
      connectorId: oneLine(mailConnectors[0]?.connectorId, 120),
      label: connectorDisplayLabel(mailConnectors[0]),
      reason: "저장된 메일 연결이 있지만 지금 읽을 수 있는 상태가 아니에요.",
      href: reconnectHref(mailConnectors[0]),
      category: "mail",
    });
  }
  return { issues, rows, mailConnected: mailConnectors.length > 0, calendarConnected, calendarCheckedAt: oneLine(calendar?.checkedAt, 40) };
}

const sourceLabels = { inbox: "업무함", connectors: "연결 목록", mail: "메일 기록", workspace: "업무 대화", calendar: "캘린더" };

/** 대화·프롬프트·화면 옆 상태판이 함께 쓰는 요약. 메일 본문은 넣지 않는다. */
export function summarizeSecretaryContext(context = {}, now = Date.now()) {
  const events = mergeUpcomingEvents(collectUpcomingEvents(context.inbox, now), collectCalendarBusy(context.calendar, now));
  const deadlines = collectDeadlines(context.inbox, context.sessions, now);
  const replies = collectReplyCandidates(context.mailRows, now);
  const proposals = collectMailProposals(context.mailRows, now, 3 * dayMs);
  const mailWork = collectMailWorkCards(context.inbox, now);
  const connectionsKnown = Array.isArray(context.connectors);
  const connections = assessConnections(context.connectors, context.mailSync, now, context.calendar);
  const today = localDateKey(now);
  const unavailable = [...new Set((Array.isArray(context.unavailable) ? context.unavailable : []).filter((key) => sourceLabels[key]))];
  if (context.calendar?.error && !unavailable.includes("calendar")) unavailable.push("calendar");
  return {
    generatedAt: new Date(now).toISOString(),
    today,
    todayEvents: events.filter((event) => localDateKey(event.startsAt) === today && (event.startsAt >= now - 60 * minuteMs || (Number.isFinite(event.endsAt) && event.endsAt > now))).slice(0, 8)
      .map((event) => ({ title: event.title, time: eventTimeLabel(event), startsAt: new Date(event.startsAt).toISOString(), location: event.location || undefined, workItemId: event.workItemId || undefined, busyOnly: event.busyOnly === true || undefined })),
    upcomingEvents: events.filter((event) => event.startsAt >= now).slice(0, 10)
      .map((event) => ({ title: event.title, when: dayLabel(event.startsAt) + " " + eventTimeLabel(event), startsAt: new Date(event.startsAt).toISOString(), workItemId: event.workItemId || undefined, busyOnly: event.busyOnly === true || undefined })),
    dueToday: deadlines.filter((deadline) => !deadline.overdue && localDateKey(deadline.dueAt) === today).slice(0, 8)
      .map((deadline) => ({ title: deadline.title, time: deadline.dateOnly ? "오늘" : hhmm(deadline.dueAt), threadId: deadline.threadId, workItemId: deadline.workItemId })),
    overdue: deadlines.filter((deadline) => deadline.overdue).slice(0, 8)
      .map((deadline) => ({ title: deadline.title, due: deadline.dateOnly ? deadline.dueDate : localDateKey(deadline.dueAt) + " " + hhmm(deadline.dueAt), threadId: deadline.threadId, workItemId: deadline.workItemId })),
    overdueCount: deadlines.filter((deadline) => deadline.overdue).length,
    replyCandidates: replies.slice(0, 8).map((row) => ({ subject: row.subject, from: row.from, receivedAt: new Date(row.receivedAt).toISOString(), messageId: row.messageId, accountId: row.accountId })),
    replyCandidateCount: replies.length,
    // 최근 3일 업무 메일 중 먼저 처리하면 좋을 것(답장·일정·영수증). 원문 없이 제목·보낸 사람만.
    mailProposals: proposals.slice(0, 8).map((row) => ({ subject: row.subject, from: row.from, receivedAt: new Date(row.receivedAt).toISOString(), messageId: row.messageId, accountId: row.accountId, kinds: row.kinds, read: row.read })),
    mailProposalCounts: countMailKinds(proposals),
    mailWorkCards: mailWork,
    approvals: Math.max(0, Math.floor(Number(context.approvals) || 0)),
    connections: connections.rows,
    connectionIssues: connections.issues,
    // 연결 목록을 읽지 못했으면 '연결 안 됨'이 아니라 '모름'이다. 화면·브리핑은 이 값을 보고 단정하지 않는다.
    connectionsKnown,
    mailConnected: connections.mailConnected,
    calendarConnected: connections.calendarConnected,
    calendarCheckedAt: connections.calendarCheckedAt,
    calendarBusyOnly: collectCalendarBusy(context.calendar, now).length > 0,
    unavailableSources: unavailable.map((key) => sourceLabels[key]),
    mailSync: {
      lastSuccessAt: context.mailSync?.lastSuccessAt || "",
      lastAttemptAt: context.mailSync?.lastAttemptAt || "",
      consecutiveFailures: Number(context.mailSync?.consecutiveFailures ?? 0) || 0,
    },
  };
}

// ── 먼저 말 걸기 규칙(순수 함수) ─────────────────────────────────────────

function greeting(now) {
  const hour = new Date(now).getHours();
  if (hour < 11) return "좋은 아침이에요";
  if (hour < 17) return "안녕하세요";
  return "오늘 하루 수고 많으셨어요";
}

export function buildBriefingText(summary, now) {
  const lines = [greeting(now) + ". " + dayLabel(now) + " 브리핑이에요."];
  if (summary.todayEvents.length) {
    lines.push("• 오늘 일정 " + summary.todayEvents.length + "건: " + summary.todayEvents.slice(0, 4).map((event) => event.time + " " + event.title).join(", "));
    if (summary.todayEvents.some((event) => event.busyOnly)) lines.push("  (캘린더 연결은 바쁜 시간만 읽을 수 있어서 '캘린더 일정'의 제목은 캘린더에서 확인해 주세요.)");
  } else if (summary.unavailableSources?.includes("업무함") && !summary.calendarConnected) {
    lines.push("• 업무함을 읽지 못해 오늘 일정을 확인하지 못했어요.");
  } else {
    lines.push(summary.calendarConnected ? "• 오늘 남은 일정은 없어요." : "• 캘린더가 연결되어 있지 않아, 메일·업무 카드에서 찾은 일정만 알려드릴 수 있어요. 오늘 찾은 일정은 없어요.");
  }
  if (summary.dueToday.length) lines.push("• 오늘 마감 " + summary.dueToday.length + "건: " + summary.dueToday.slice(0, 3).map((due) => due.title).join(", "));
  if (summary.overdueCount) lines.push("• 마감이 지난 일 " + summary.overdueCount + "건 — 끝났으면 완료로 바꾸고, 아니면 새 마감을 정해 주세요.");
  const mailCounts = summary.mailProposalCounts;
  if (mailCounts?.total) {
    lines.push("• 먼저 처리하면 좋을 업무 메일 " + mailCounts.total + "통(" + mailKindsLabel(mailCounts) + ") — 최근: '" + summary.mailProposals[0].subject + "'");
  } else if (summary.replyCandidateCount) {
    lines.push("• 답장이 필요해 보이는 메일 " + summary.replyCandidateCount + "통 (최근: " + summary.replyCandidates[0].subject + ")");
  }
  if (summary.mailWorkCards?.draftsReady) lines.push("• 메일 답장 초안 " + summary.mailWorkCards.draftsReady + "건이 승인함에서 확인을 기다려요.");
  if (summary.approvals) lines.push("• 승인 대기 " + summary.approvals + "건" + (summary.approvals >= 50 ? " — 오래된 후보가 많이 쌓였어요. 정리를 도와드릴 수 있어요." : ""));
  if (summary.connectionIssues.length) {
    lines.push("• 다시 연결이 필요한 곳: " + summary.connectionIssues.map((issue) => issue.label).join(", "));
  } else if (summary.connectionsKnown === false) {
    lines.push("• 연결 상태를 이번에 읽지 못했어요. 다음 확인 때 다시 볼게요.");
  } else if (summary.mailConnected) {
    lines.push("• 메일 연결 정상" + (summary.mailSync.lastSuccessAt ? " (마지막 확인 " + hhmm(finiteTime(summary.mailSync.lastSuccessAt)) + ")" : ""));
  } else {
    lines.push("• 메일이 연결되어 있지 않아 새 메일은 알려드릴 수 없어요.");
  }
  if (summary.unavailableSources?.length) lines.push("• 이번에 읽지 못한 정보: " + summary.unavailableSources.join(", ") + " — 잠시 뒤 다시 확인할게요.");
  lines.push("무엇부터 도와드릴까요?");
  return lines.join("\n");
}

const notice = (fields) => ({ role: "notice", read: false, severity: "info", actions: [], ...fields });

/**
 * 지금 근거로 새로 말할 것만 돌려준다. memory 는 복사본을 고쳐 함께 돌려준다(같은 말을 반복하지 않게).
 * 첫 실행에는 이미 쌓여 있던 메일을 '새 메일'로 알리지 않는다(브리핑에서 개수로만 말한다).
 */
export function evaluateSecretary({ context = {}, memory: previousMemory = {}, preferences = defaultSecretaryPreferences(), now = Date.now() }) {
  const memory = {
    dedupe: { ...(previousMemory.dedupe ?? {}) },
    seenMail: { ...(previousMemory.seenMail ?? {}) },
    incidents: { ...(previousMemory.incidents ?? {}) },
    baselineDone: previousMemory.baselineDone === true,
    lastBriefingDate: previousMemory.lastBriefingDate ?? "",
    lastApprovalCount: Number.isFinite(previousMemory.lastApprovalCount) ? previousMemory.lastApprovalCount : null,
    lastApprovalNoticeAt: Number.isFinite(previousMemory.lastApprovalNoticeAt) ? previousMemory.lastApprovalNoticeAt : 0,
  };
  const notices = [];
  const summary = summarizeSecretaryContext(context, now);
  const once = (key) => {
    if (memory.dedupe[key]) return false;
    memory.dedupe[key] = new Date(now).toISOString();
    return true;
  };

  // 1) 끊긴 연결: 처음 끊긴 순간 한 번 말하고, 돌아오면 다시 정상이라고 말한다.
  //    연결 목록을 읽지 못한 때는 끊김도 복구도 말하지 않는다(읽기 실패를 '복구됨'으로 오해하지 않게).
  if (summary.connectionsKnown) {
    const openKeys = new Set();
    for (const issue of summary.connectionIssues) {
      openKeys.add(issue.key);
      if (memory.incidents[issue.key]) continue;
      memory.incidents[issue.key] = { openedAt: new Date(now).toISOString(), label: issue.label };
      notices.push(notice({
        kind: "connection",
        severity: "attention",
        notify: true,
        text: issue.label + " 연결을 다시 확인해 주세요. " + issue.reason + "\n연결이 끊긴 동안에는 새 메일·일정을 가져오지 못해 알림도 늦어질 수 있어요.",
        actions: [
          { kind: "open", label: "다시 연결하기", href: issue.href },
          { kind: "tick", label: "지금 다시 확인" },
        ],
      }));
    }
    for (const [key, incident] of Object.entries(memory.incidents)) {
      if (openKeys.has(key)) continue;
      delete memory.incidents[key];
      notices.push(notice({ kind: "connection", severity: "info", notify: false, text: (incident?.label || "연결") + " 연결이 다시 정상이에요. 밀린 메일·일정을 이어서 확인할게요." }));
    }
  }

  // 2) 메일·캘린더가 아예 없을 때는 한 번만 안내한다(브리핑에도 한 줄 남는다).
  if (summary.connectionsKnown && !summary.mailConnected && once("setup:mail")) {
    notices.push(notice({ kind: "setup", severity: "info", notify: false, text: "메일이 연결되어 있지 않아요. 메일을 연결하면 답장이 필요한 메일과 일정 후보를 먼저 알려드릴게요.", actions: [{ kind: "open", label: "메일 연결하기", href: "/connect?open=gmail&from=chat" }] }));
  }
  if (summary.connectionsKnown && !summary.calendarConnected && !(context.connectors ?? []).some((connector) => connector?.category === "calendar") && once("setup:calendar")) {
    notices.push(notice({ kind: "setup", severity: "info", notify: false, text: "캘린더가 연결되어 있지 않아요. 지금은 메일·업무 카드에서 찾은 일정만 알려드릴 수 있어요. 캘린더를 연결하면 미팅 30분 전, 10분 전에 먼저 알려드릴게요.", actions: [{ kind: "open", label: "캘린더 연결하기", href: "/connect?open=google-calendar&from=chat" }] }));
  }

  // 3) 오늘 브리핑: 정한 시각 이후 첫 확인 때 하루 한 번.
  const today = summary.today;
  const nowDate = new Date(now);
  const minutesPastBriefing = nowDate.getHours() * 60 + nowDate.getMinutes() - (preferences.briefingHour * 60 + preferences.briefingMinute);
  // 업무함을 못 읽었으면 일정·마감이 빠진 브리핑이 되므로 2시간까지는 다음 확인으로 미룬다.
  const briefingInputsReady = Array.isArray(context.inbox) || minutesPastBriefing >= 120;
  if (memory.lastBriefingDate !== today && minutesPastBriefing >= 0 && briefingInputsReady) {
    memory.lastBriefingDate = today;
    const actions = [{ kind: "prompt", label: "오늘 할 일 정리해줘", prompt: "오늘 일정·마감·답장할 메일·승인 대기를 보고 우선순위대로 할 일을 정리해줘." }];
    if (summary.mailProposalCounts?.total) actions.push({ kind: "prompt", label: "업무 메일 정리해줘", prompt: "최근 3일 업무 메일(답장·일정·영수증 후보)을 읽고 해야 할 일을 우선순위대로 정리해줘. 답장은 초안만, 일정은 등록 후보만 승인함에 올려줘." });
    if (summary.replyCandidateCount) actions.push({ kind: "open", label: "답장 후보 보기", href: mailListHref });
    if (summary.approvals) actions.push({ kind: "open", label: "승인함 열기", href: "/office/?officeView=approval" });
    notices.push(notice({ kind: "briefing", severity: "info", notify: true, text: buildBriefingText(summary, now), actions }));
  }

  // 4) 곧 시작하는 일정: 30분 전, 10분 전. 업무 카드 일정과 캘린더에서 직접 읽은 바쁜 시간을 함께 본다.
  for (const event of mergeUpcomingEvents(collectUpcomingEvents(context.inbox, now), collectCalendarBusy(context.calendar, now))) {
    if (event.allDay) continue;
    const minutes = Math.round((event.startsAt - now) / minuteMs);
    if (minutes <= 0 || minutes > 31) continue;
    const key10 = "meeting10:" + event.id + ":" + event.startsAt;
    const key30 = "meeting30:" + event.id + ":" + event.startsAt;
    if (minutes <= 11) {
      if (!once(key10)) continue;
      memory.dedupe[key30] ??= new Date(now).toISOString();
    } else if (!once(key30)) continue;
    notices.push(notice({
      kind: "meeting",
      severity: "urgent",
      notify: true,
      text: event.busyOnly
        ? "캘린더에 잡힌 " + eventTimeLabel(event) + " 일정이 " + minutes + "분 뒤 시작해요. 연결 권한이 바쁜 시간만 읽는 범위라 제목은 캘린더에서 확인해 주세요."
        : hhmm(event.startsAt) + " '" + event.title + "' 일정이 " + minutes + "분 뒤 시작해요." + (event.location ? " 장소: " + event.location : ""),
      actions: event.busyOnly
        ? [{ kind: "prompt", label: "준비할 것 정리", prompt: hhmm(event.startsAt) + "에 시작하는 캘린더 일정 전에 확인할 메일·자료와 오늘 남은 일을 정리해줘." }]
        : [
            { kind: "prompt", label: "준비할 것 정리", prompt: "곧 시작하는 '" + event.title + "' 일정 준비물과 확인할 메일·자료를 정리해줘." },
            ...(event.workItemId ? [{ kind: "open", label: "일정 카드 보기", href: "/?workItem=" + encodeURIComponent(event.workItemId) + "&queue=meeting" }] : []),
          ],
    }));
  }

  // 5) 임박한 마감: 3시간 안(시각이 있는 업무 카드). 날짜만 있는 업무는 브리핑에서 말한다.
  for (const deadline of collectDeadlines(context.inbox, [], now)) {
    const remaining = deadline.dueAt - now;
    if (remaining <= 0 || remaining > 3 * 60 * minuteMs) continue;
    if (!once("due3h:" + deadline.id + ":" + deadline.dueAt)) continue;
    const hours = Math.floor(remaining / (60 * minuteMs));
    const mins = Math.round((remaining % (60 * minuteMs)) / minuteMs);
    notices.push(notice({
      kind: "deadline",
      severity: "attention",
      notify: true,
      text: "'" + deadline.title + "' 마감이 " + (hours ? hours + "시간" + (mins ? " " : "") : "") + (mins || !hours ? mins + "분" : "") + " 남았어요 (" + hhmm(deadline.dueAt) + ").",
      actions: [
        { kind: "prompt", label: "남은 일 정리", prompt: "'" + deadline.title + "' 마감 전에 남은 일과 바로 할 수 있는 초안을 정리해줘." },
        ...(deadline.workItemId ? [{ kind: "open", label: "업무 카드 보기", href: "/?workItem=" + encodeURIComponent(deadline.workItemId) + "&queue=deadline" }] : []),
      ],
    }));
  }

  // 6) 새로 온 업무 메일: 답장·일정·영수증 중 무엇을 하면 좋을지 먼저 제안한다(메일마다 한 번).
  const proposals = collectMailProposals(context.mailRows, now, 3 * dayMs);
  const fresh = proposals.filter((row) => !memory.seenMail[row.key]);
  for (const row of proposals) memory.seenMail[row.key] ??= new Date(now).toISOString();
  if (memory.baselineDone && fresh.length) {
    if (fresh.length === 1) {
      const proposal = mailProposalMessage(fresh[0]);
      notices.push(notice({ kind: "mail", severity: "attention", notify: true, text: proposal.text, actions: proposal.actions }));
    } else {
      const counts = countMailKinds(fresh);
      const first = mailProposalMessage(fresh[0]);
      notices.push(notice({
        kind: "mail",
        severity: "attention",
        notify: true,
        text: "새로 온 업무 메일 " + fresh.length + "통이 있어요(" + mailKindsLabel(counts) + "). " + fresh.slice(0, 3).map((row) => "'" + row.subject + "'").join(", ")
          + (fresh.length > 3 ? " 외 " + (fresh.length - 3) + "통" : "") + ". 가장 최근 메일부터 처리할까요?",
        actions: [
          first.actions[0],
          { kind: "prompt", label: "새 업무 메일 정리해줘", prompt: "새로 온 업무 메일 " + fresh.length + "통(" + fresh.slice(0, 6).map((row) => "'" + row.subject + "'").join(", ") + ")을 읽고 해야 할 일을 정리해줘. 답장은 초안만, 일정은 등록 후보만 승인함에 올려줘." },
          { kind: "open", label: "답장 후보 보기", href: mailListHref },
        ],
      }));
    }
  }
  if (Array.isArray(context.mailRows)) memory.baselineDone = true;

                                                 
  const approvals = summary.approvals;
  if (memory.lastApprovalCount !== null && approvals > memory.lastApprovalCount && now - memory.lastApprovalNoticeAt >= 2 * 60 * minuteMs) {
    memory.lastApprovalNoticeAt = now;
    notices.push(notice({
      kind: "approval",
      severity: "info",
      notify: false,
      text: "승인을 기다리는 일이 " + (approvals - memory.lastApprovalCount) + "건 늘었어요(지금 " + approvals + "건). 보내기·등록 같은 실행은 승인 전에는 하지 않아요.",
      actions: [{ kind: "open", label: "승인함 열기", href: "/office/?officeView=approval" }],
    }));
  }
  memory.lastApprovalCount = approvals;

  // 기록 정리: 2주 지난 중복 방지 기록과 30일 지난 메일 표시는 지운다.
  for (const [key, at] of Object.entries(memory.dedupe)) {
    if (key.startsWith("setup:")) continue;
    if (now - finiteTime(at) > 14 * dayMs) delete memory.dedupe[key];
  }
  for (const [key, at] of Object.entries(memory.seenMail)) {
    if (now - finiteTime(at) > 30 * dayMs) delete memory.seenMail[key];
  }
  return { notices, memory, summary };
}

/** 조용한 시간(기본 밤 9시~아침 8시)에는 급한 일정 알림만 PC 알림으로 띄운다. */
export function shouldShowOsNotification(message, preferences = defaultSecretaryPreferences(), now = Date.now()) {
  if (!preferences.notifications || !message?.notify) return false;
  if (!preferences.quietHours) return true;
  const hour = new Date(now).getHours();
  const start = preferences.quietStartHour;
  const end = preferences.quietEndHour;
  const quiet = start === end ? false : start < end ? hour >= start && hour < end : hour >= start || hour < end;
  return !quiet || message.severity === "urgent";
}

// ── 엔진 ───────────────────────────────────────────────────────────────

/** PC 알림에 띄울 글. '알림에 내용 숨기기'를 켜면 제목·보낸 사람 없이 종류만 말한다(앱 대화에는 그대로 남는다). */
export function osNotificationText(message, preferences = defaultSecretaryPreferences()) {
  if (!preferences?.hideNotificationContent) return String(message?.text ?? "");
  const generic = {
    meeting: "곧 시작하는 일정이 있어요.",
    deadline: "마감이 가까운 일이 있어요.",
    mail: "답장이 필요해 보이는 새 메일이 왔어요.",
    connection: "다시 연결이 필요한 곳이 있어요.",
    briefing: "오늘 브리핑이 준비됐어요.",
  };
  return (generic[message?.kind] ?? "확인할 일이 있어요.") + " MODY에서 확인해 주세요.";
}

const severityRank = { urgent: 3, attention: 2, info: 1 };

/** 한 번에 여러 개를 말할 때 PC 알림은 하나로 묶는다(가장 급한 것 + 나머지 개수). */
export function pickOsNotification(candidates = [], preferences = defaultSecretaryPreferences()) {
  if (!candidates.length) return null;
  const sorted = [...candidates].sort((a, b) => (severityRank[b.severity] ?? 0) - (severityRank[a.severity] ?? 0));
  const top = sorted[0];
  const body = osNotificationText(top, preferences) + (sorted.length > 1 ? "\n그 밖에 " + (sorted.length - 1) + "건을 MODY 대화에 남겼어요." : "");
  return { message: top, body, count: sorted.length };
}

function parseStoredSecretary(value) {
  if (value?.version !== storeVersion) throw new Error("unsupported version");
  return normalizeStore(value);
}

function mergeMemory(saved = {}, current = {}) {
  const pick = (key) => ({ ...(saved[key] ?? {}), ...(current[key] ?? {}) });
  return {
    dedupe: pick("dedupe"),
    seenMail: pick("seenMail"),
    incidents: pick("incidents"),
    baselineDone: saved.baselineDone === true || current.baselineDone === true,
    lastBriefingDate: [saved.lastBriefingDate, current.lastBriefingDate].filter(Boolean).sort().at(-1) ?? "",
    lastApprovalCount: Number.isFinite(current.lastApprovalCount) ? current.lastApprovalCount : Number.isFinite(saved.lastApprovalCount) ? saved.lastApprovalCount : null,
    lastApprovalNoticeAt: Math.max(Number(saved.lastApprovalNoticeAt) || 0, Number(current.lastApprovalNoticeAt) || 0),
  };
}

export function createAssistantSecretary(options = {}) {
  const clock = typeof options.now === "function" ? options.now : Date.now;
  const storePath = options.storePath;
  if (!storePath) throw new Error("assistant secretary storePath required");
  let store = null;
  let loading = null;
  let writeChain = Promise.resolve();
  let ticking = null;
  let pendingTick = false;
  let timer = null;
  let stopped = false;
  let storeWarning = "";
  // 원래 기록 파일을 지킬 수 없을 때(열지 못함·읽지도 보관하지도 못함)는 새 기록으로 덮어쓰지 않는다.
  let writeBlockedReason = "";
  let saveError = "";
  let lastPersistAt = 0;
  let preferencesTouched = false;
  let calendarSnapshot = null;
  let calendarCheckedAtMs = 0;
  let calendarInFlight = null;

  const warn = (text, error) => options.logger?.warn?.("[assistant-secretary] " + text + (error ? ": " + String(error?.message ?? error) : ""));

  async function preserveUnreadable() {
    const name = path.basename(storePath) + ".unreadable-" + new Date(clock()).toISOString().replace(/[:.]/gu, "-");
    try {
      await copyFile(storePath, path.join(path.dirname(storePath), name));
      return name;
    } catch (error) {
      warn("읽지 못한 기록을 보관하지 못했습니다", error);
      return "";
    }
  }

  async function adoptLoaded(loaded) {
    if (loaded.status === "ok" || loaded.status === "recovered") {
      let warning = "";
      if (loaded.status === "recovered") {
        const kept = await preserveUnreadable();
        warning = "MODY 대화 기록 파일이 손상되어 직전 저장본으로 되살렸어요." + (kept ? " 손상된 파일은 " + kept + " 로 보관했어요." : "");
      }
      return { value: loaded.value, warning, blocked: "" };
    }
    if (loaded.status === "missing") return { value: null, warning: "", blocked: "" };
    if (loaded.status === "unreadable") {
      const kept = await preserveUnreadable();
      return kept
        ? { value: null, warning: "이전 MODY 대화 기록을 읽지 못해 " + kept + " 로 보관하고 새로 시작했어요.", blocked: "" }
        : { value: null, warning: "", blocked: "이전 MODY 대화 기록을 읽지 못했고 따로 보관하지도 못했어요. 원래 파일을 지키기 위해 새 대화는 이 PC에 저장하지 않고 있어요." };
    }
    // io_error: 파일은 있는데 열지 못함(다른 프로그램이 잡고 있거나 권한 문제). 추측으로 덮어쓰지 않는다.
    return { value: null, warning: "", blocked: "MODY 대화 기록 파일을 열지 못했어요(다른 프로그램이 쓰고 있거나 권한 문제). 원래 기록을 지키기 위해 지금은 새 대화를 저장하지 않고, 잠시 뒤 다시 열어 볼게요." };
  }

  async function load() {
    if (store) return store;
    loading ??= (async () => {
      const adopted = await adoptLoaded(await readJsonStore(storePath, { parse: parseStoredSecretary }));
      store = adopted.value ?? emptyStore();
      writeBlockedReason = adopted.blocked;
      storeWarning = adopted.blocked || adopted.warning;
      return store;
    })().finally(() => { loading = null; });
    return loading;
  }

  /** 저장을 막아 둔 상태라면 원래 파일을 다시 열어 본다. 열리면 그동안의 대화를 원래 기록 뒤에 붙인다. */
  async function tryReopen() {
    const adopted = await adoptLoaded(await readJsonStore(storePath, { parse: parseStoredSecretary }));
    if (adopted.blocked) return false;
    if (adopted.value) {
      const saved = adopted.value;
      const known = new Set(saved.messages.map((message) => message.id));
      const messages = [...saved.messages, ...store.messages.filter((message) => !known.has(message.id))]
        .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)))
        .slice(-maxMessages);
      store = {
        ...saved,
        messages,
        memory: mergeMemory(saved.memory, store.memory),
        preferences: preferencesTouched ? store.preferences : saved.preferences,
        lastTickAt: store.lastTickAt || saved.lastTickAt,
        lastContextSummary: store.lastContextSummary ?? saved.lastContextSummary,
      };
    }
    writeBlockedReason = "";
    storeWarning = adopted.warning;
    return true;
  }

  function persist() {
    const run = writeChain.then(async () => {
      if (writeBlockedReason && !(await tryReopen())) {
        saveError = writeBlockedReason;
        return { ok: false, error: saveError };
      }
      try {
        await replaceFileWithText(storePath, JSON.stringify(store, null, 1));
        saveError = "";
        lastPersistAt = clock();
        return { ok: true, error: "" };
      } catch (error) {
        saveError = "MODY 대화 기록을 이 PC에 저장하지 못했어요(" + oneLine(error?.code || error?.message || "알 수 없는 오류", 60) + "). 저장 공간과 폴더 권한을 확인해 주세요. 다음 확인 때 다시 저장해 볼게요.";
        warn("저장 실패", error);
        return { ok: false, error: saveError };
      }
    });
    writeChain = run.catch(() => undefined);
    return run;
  }

  /** 연결된 캘린더를 10분마다(직접 다시 확인·절전 복귀·시작 때는 바로) 읽기 전용으로 읽는다. */
  async function readCalendar(force) {
    if (typeof options.readCalendar !== "function") return null;
    const startedAt = clock();
    if (!force && calendarSnapshot && startedAt - calendarCheckedAtMs < (options.calendarRefreshMs ?? calendarRefreshMs)) return calendarSnapshot;
    calendarInFlight ??= (async () => {
      let raw = null;
      try {
        raw = await options.readCalendar({
          timeMin: new Date(startedAt - 60 * minuteMs).toISOString(),
          timeMax: new Date(startedAt + 2 * dayMs).toISOString(),
        });
      } catch (error) {
        warn("캘린더 읽기 실패", error);
      }
      calendarSnapshot = normalizeCalendarSnapshot(raw, calendarSnapshot, clock());
      calendarCheckedAtMs = clock();
      return calendarSnapshot;
    })().finally(() => { calendarInFlight = null; });
    return calendarInFlight;
  }

  function unreadCount() {
    return (store?.messages ?? []).filter((message) => message.role !== "user" && message.read !== true).length;
  }

  function attentionCount() {
    return (store?.messages ?? []).filter((message) => message.role === "notice" && message.read !== true && message.severity !== "info").length;
  }

  function publicState(extra = {}) {
    return {
      status: "assistant_secretary_ready",
      messages: (store?.messages ?? []).slice(-maxReturnedMessages),
      unread: unreadCount(),
      attention: attentionCount(),
      preferences: store?.preferences ?? defaultSecretaryPreferences(),
      summary: store?.lastContextSummary ?? null,
      lastTickAt: store?.lastTickAt ?? "",
      storeWarning,
      saveError,
      externalMutation: false,
      rawSecretMaterialReturned: false,
      ...extra,
    };
  }

  function broadcast() {
    try { options.broadcast?.({ unread: unreadCount(), attention: attentionCount(), lastMessageId: store?.messages.at(-1)?.id ?? "", lastTickAt: store?.lastTickAt ?? "" }); } catch { /* 창이 닫히는 중 */ }
  }

  function appendMessages(inputs) {
    const now = clock();
    const added = [];
    for (const input of inputs) {
      const message = sanitizeMessage(input, now);
      if (!message) continue;
      store.messages.push(message);
      added.push({ message, notify: input.notify === true });
    }
    if (store.messages.length > maxMessages) store.messages.splice(0, store.messages.length - maxMessages);
    return added;
  }

  const comparable = (memory, summary) => JSON.stringify([memory, summary ? { ...summary, generatedAt: "" } : null]);

  async function tick(reason = "interval") {
    if (stopped) return publicState();
    if (ticking) { pendingTick = true; return ticking; }
    ticking = (async () => {
      await load();
      let context = null;
      try {
        context = await options.readContext?.();
      } catch (error) {
        warn("근거 읽기 실패", error);
      }
      if (!context) return publicState();
      const calendar = await readCalendar(reason === "manual" || reason === "resume" || reason === "startup");
      if (calendar) context = { ...context, calendar };
      const now = clock();
      const before = comparable(store.memory, store.lastContextSummary);
      const { notices, memory, summary } = evaluateSecretary({ context, memory: store.memory, preferences: store.preferences, now });
      store.memory = memory;
      store.lastTickAt = new Date(now).toISOString();
      store.lastContextSummary = summary;
      const added = appendMessages(notices);
      // 바뀐 것이 없으면 1분마다 디스크에 쓰지 않는다(10분에 한 번만 확인 시각을 남긴다).
      if (added.length || reason !== "interval" || saveError || writeBlockedReason || now - lastPersistAt >= idlePersistMs || comparable(store.memory, summary) !== before) {
        await persist();
      }
      const notifiable = added
        .filter(({ message, notify }) => shouldShowOsNotification({ ...message, notify }, store.preferences, now))
        .map(({ message }) => message);
      const picked = options.isUserViewingAssistant?.() === true ? null : pickOsNotification(notifiable, store.preferences);
      if (picked) {
        try { options.notify?.({ title: store.preferences.assistantName || "MODY", body: picked.body, message: picked.message, count: picked.count }); } catch { /* 알림 실패는 대화 기록에 영향 없음 */ }
      }
      if (added.length || reason !== "interval") broadcast();
      return publicState({ added: added.length });
    })().finally(() => {
      ticking = null;
      if (pendingTick && !stopped) { pendingTick = false; void tick("coalesced"); }
    });
    return ticking;
  }

  async function handle(payload = {}) {
    await load();
    const kind = String(payload?.kind ?? "state");
    if (kind === "state") return publicState();
    if (kind === "counts") return { status: "assistant_secretary_counts", unread: unreadCount(), attention: attentionCount(), lastTickAt: store.lastTickAt };
    if (kind === "context") {
      if (!store.lastContextSummary || payload.refresh === true) await tick("context");
      return { status: "assistant_secretary_context", summary: store.lastContextSummary, lastTickAt: store.lastTickAt, externalMutation: false };
    }
    if (kind === "append") {
      const role = payload.role === "user" ? "user" : "assistant";
      const added = appendMessages([{ ...(payload.message ?? {}), role, read: role === "user" ? true : payload.message?.read === true }]);
      if (!added.length) return { status: "assistant_secretary_append_rejected", userMessage: "빈 메시지는 저장하지 않았어요." };
      const saved = await persist();
      broadcast();
      return {
        status: "assistant_secretary_appended",
        message: added[0].message,
        unread: unreadCount(),
        saved: saved.ok,
        ...(saved.ok ? {} : { saveError: saved.error, userMessage: saved.error }),
      };
    }
    if (kind === "mark_read") {
      let changed = false;
      for (const message of store.messages) { if (!message.read) { message.read = true; changed = true; } }
      if (changed) { await persist(); broadcast(); }
      return publicState();
    }
    if (kind === "run_now") return tick("manual");
    if (kind === "set_preferences") {
      store.preferences = { ...store.preferences, ...sanitizePreferences(payload.preferences ?? {}) };
      preferencesTouched = true;
      await persist();
      broadcast();
      return publicState();
    }
    if (kind === "clear") {
      store.messages = [];
      await persist();
      broadcast();
      return publicState();
    }
    return { status: "assistant_secretary_unsupported", userMessage: "지원하지 않는 요청이에요." };
  }

  return {
    handle,
    tick,
    requestTick(reason = "event") { if (!stopped) void tick(reason); },
    start() {
      if (timer || stopped) return;
      const first = setTimeout(() => { void tick("startup"); }, options.startupDelayMs ?? 20_000);
      first.unref?.();
      timer = setInterval(() => { void tick("interval"); }, options.intervalMs ?? tickIntervalMs);
      timer.unref?.();
    },
    stop() { stopped = true; if (timer) clearInterval(timer); timer = null; },
    isStarted: () => timer !== null,
    unreadCount: () => unreadCount(),
  };
}

