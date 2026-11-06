"use client";

/**
 * 하루 업무 보고서("오늘 한 일") 연결 모듈.
 *
 * 도메인의 `ModyWorkActivityReportBuilder`(검증된 한국어 렌더링 + secret redaction)를
 * 저장된 업무 완료·대기 상태와 직원 작업 기록에 연결합니다.
 * 실행 이벤트의 성공은 업무 전체의 완료가 아니므로 건수와 상세 기록을 분리합니다.
 *
 * 안전 경계: 보고서 생성만으로 외부 발송/일정 등록/파일 이동은 실행하지 않습니다.
 * 이 모듈은 로컬 이벤트만 읽어 요약·마크다운을 만들 뿐입니다.
 */

import { ModyWorkActivityReportBuilder } from "../../../packages/domain/dist/work-activity-report.js";
import type { ModyWorkActivityReport } from "../../../packages/domain/dist/work-activity-report.js";
import { modyPolicyVersion } from "../../../packages/domain/dist/types.js";
import type {
  ModyAuditEntry,
  WorkItem,
  WorkItemStatus,
} from "../../../packages/domain/dist/types.js";
import type { SelectedWorkActionEvent } from "./selected-work-action-events";

const REPORT_STATE_KEY = "modycrew.dailyActivityReport.v1";

type DailyReportAction = {
  label: string;
  action?: "open_office" | "daily_activity_report";
  shareToTeamTitle?: string;
  saveAsDocumentTitle?: string;
};

export function createDailyReportActions(title: string): DailyReportAction[] {
  const safeTitle = title.replace(/[\r\n\t]/gu, " ").trim().slice(0, 180);
  return [
    { label: "팀에 공유", shareToTeamTitle: safeTitle },
    { label: "문서로 저장", saveAsDocumentTitle: safeTitle },
    { label: "오피스 보기", action: "open_office" },
    { label: "보고서 다시 만들기", action: "daily_activity_report" },
    { label: "실행 로그 확인", action: "open_office" },
  ];
}

/** 예전 저장기가 지운 버튼만 복구한다. 본문은 보존하며 실제 공유/저장은 클릭 후 진행한다. */
export function restoreDailyReportActions(message: { id?: unknown; role?: unknown; text?: unknown }): DailyReportAction[] | undefined {
  if (message.role !== "assistant" || typeof message.id !== "string" ||
      !/^assistant-action-daily-activity-report-\d+$/u.test(message.id) || typeof message.text !== "string") return undefined;
  const title = message.text.split(/\r?\n/u, 1)[0].trim();
  if (!/^.{1,40} 한 일 보고서 \(\d{4}-\d{2}-\d{2}\)$/u.test(title)) return undefined;
  return createDailyReportActions(title);
}

export type DailyAgentActivity = {
  teammateId: string;
  name: string;
  total: number;
  done: number;
  activityCount: number;
  latestDetail: string;
};

/**
 * 업무판(업무 원장) 한 건 — desktop-bridge 의 TaskLedgerTask 중 보고서가 읽는 칸만.
 * 이 파일은 테스트가 따로 컴파일하므로 다른 앱 모듈을 새로 import 하지 않는다.
 */
export type DailyReportLedgerTask = {
  id: string;
  title: string;
  status: string;
  assigneeId?: string;
  assigneeName?: string;
  createdAt?: string;
  updatedAt?: string;
  completedAt?: string;
  result?: string;
  humanQA?: Array<{ question: string; answer?: string; dismissedAt?: string }>;
  execution?: { state?: string; lastCompletedAt?: string; error?: string; repeat?: string };
};

export type DailyReportWorkSession = {
  threadId: string;
  title?: string;
  status: string;
  assigneeName?: string;
  updatedAt: number;
  completedAt?: number;
};

/** 보고서에 들어가는 업무판 한 줄. waitingFor 는 기다리는 일일 때 무엇을 기다리는지. */
export type DailyReportLedgerRow = {
  id: string;
  title: string;
  kind: "done" | "waiting";
  waitingFor?: "answer" | "approval" | "retry" | "review";
  assigneeId: string;
  assigneeName: string;
  at: string;
  excerpt: string;
};

export type DailyActivityReportResult = {
  report: ModyWorkActivityReport;
  markdown: string;
  reportDate: string; // yyyy-mm-dd (로컬, 보고 대상 날짜)
  dayLabel: string; // "오늘" | "어제" 등 사용자 문구용 라벨
  doneToday: number;
  totalToday: number;
  activityCount: number;
  completionDateUnknown: number;
  dataWarnings: string[];
  perAgent: DailyAgentActivity[];
  hasWork: boolean;
  /** 같은 기간에 업무판에서 끝났거나 답·승인을 기다리는 일(예약·위임 업무 결과 포함). */
  ledger: DailyReportLedgerRow[];
};

function localDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function readLastDailyReportDate(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(REPORT_STATE_KEY);
  } catch {
    return null;
  }
}

/**
 * 마지막으로 브리핑을 본 시각.
 *
 * 예전에는 날짜 열쇠(YYYY-MM-DD)만 저장했다. 그래서 "어제"밖에 말할 수 없었고,
 * 사흘 자리를 비우면 가운데 이틀이 통째로 사라졌다. 이제 시각을 저장한다.
 * 예전 값(날짜 열쇠)이 남아 있으면 그날 끝으로 읽어 이어서 쓴다.
 */
export function readLastBriefedAt(): Date | null {
  const raw = readLastDailyReportDate();
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/u.test(raw)) {
    const [year, month, day] = raw.split("-").map(Number);
    return new Date(year, month - 1, day, 23, 59, 59, 999);
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function markDailyReportGenerated(date: Date = new Date()): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(REPORT_STATE_KEY, date.toISOString());
  } catch {
    // 로컬 저장 실패는 보고서 생성 자체를 막지 않습니다.
  }
}

/** 자리를 비웠다고 볼 최소 시간. 이보다 짧으면 "없는 동안"이라 부르지 않는다. */
const awayThresholdMs = 6 * 60 * 60 * 1000;
/** 아무리 오래 비웠어도 이보다 먼 것까지 끌어오지는 않는다. */
const maxAwayWindowMs = 14 * 24 * 60 * 60 * 1000;

export type AwayWindow = {
  sinceIso: string;
  untilIso: string;
  /** 사용자에게 보일 기간 이름. */
  label: string;
  awayMs: number;
};

/**
 * "내가 없는 동안"이 언제부터 언제까지인지.
 *
 * 처음 켠 경우(기록 없음)에는 null 을 돌려준다 — 비운 적이 없는데 "없는 동안"을
 * 보여주면 거짓말이다. 호출부는 그때 조용히 지금 시각만 찍어 두면 된다.
 */
export function resolveAwayWindow(now: Date = new Date()): AwayWindow | null {
  const lastSeen = readLastBriefedAt();
  if (!lastSeen) return null;
  const awayMs = now.getTime() - lastSeen.getTime();
  if (awayMs < awayThresholdMs) return null;
  const since = new Date(Math.max(lastSeen.getTime(), now.getTime() - maxAwayWindowMs));
  const awayDays = Math.floor(awayMs / (24 * 60 * 60 * 1000));
  return {
    sinceIso: since.toISOString(),
    untilIso: now.toISOString(),
    label: awayDays >= 2 ? `지난 ${Math.min(awayDays, 14)}일 동안` : "내가 없는 동안",
    awayMs,
  };
}

/** 오늘(로컬 기준) 아직 보고서를 만들지 않았으면 true. */
export function isDailyReportDue(now: Date = new Date()): boolean {
  const lastSeen = readLastBriefedAt();
  if (!lastSeen) return true;
  return localDateKey(lastSeen) !== localDateKey(now);
}

function isSameLocalDay(iso: string | undefined, day: Date): boolean {
  if (!iso) return false;
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return false;
  return localDateKey(parsed) === localDateKey(day);
}

function metricString(event: SelectedWorkActionEvent, key: string): string {
  const value = event.metrics?.[key];
  return typeof value === "string" ? value : "";
}

function eventToAuditEntry(event: SelectedWorkActionEvent): ModyAuditEntry {
  const eventType: ModyAuditEntry["eventType"] =
    event.status === "done"
      ? "tool_completed"
      : event.status === "error"
        ? "tool_failed"
        : event.status === "needs_desktop"
          ? "approval_required"
          : "tool_requested";
  return {
    id: `audit-${event.id}`,
    actor: "agent",
    eventType,
    message: event.detail ? `${event.label} — ${event.detail}` : event.label,
    createdAt: event.updatedAt ?? event.createdAt,
  };
}

function teammateIdFromEvent(event: SelectedWorkActionEvent): string {
  const fromMetrics = metricString(event, "teammateId");
  if (fromMetrics) return fromMetrics;
  if (event.workItemId.startsWith("ai-teammate:")) {
    return event.workItemId.slice("ai-teammate:".length);
  }
  return "";
}

function summarizePerAgent(
  events: SelectedWorkActionEvent[],
  resolveTeammateName?: (teammateId: string) => string | undefined,
  ledger: DailyReportLedgerRow[] = [],
): DailyAgentActivity[] {
  const byId = new Map<string, DailyAgentActivity>();
  for (const event of [...events].sort((a, b) => timeOf(a.updatedAt ?? a.createdAt) - timeOf(b.updatedAt ?? b.createdAt))) {
    const teammateId = teammateIdFromEvent(event);
    if (!teammateId) continue;
    const fallbackName =
      (event.sourceLabel && event.sourceLabel.split(" · ")[0]) ||
      event.label.split(" · ")[0] ||
      "AI 직원";
    const name = resolveTeammateName?.(teammateId) || fallbackName;
    const current = byId.get(teammateId) ?? {
      teammateId,
      name,
      total: 0,
      done: 0,
      activityCount: 0,
      latestDetail: "",
    };
    current.name = name;
    current.activityCount += 1;
    if (event.detail) current.latestDetail = event.detail;
    byId.set(teammateId, current);
  }
  // 업무판에서 담당이 정해진 일도 그 직원이 한 일로 센다(기본 비서에게 간 일은 담당이 비어 있다).
  for (const row of ledger) {
    if (!row.assigneeId) continue;
    const name = resolveTeammateName?.(row.assigneeId) || row.assigneeName || "AI 직원";
    const current = byId.get(row.assigneeId) ?? { teammateId: row.assigneeId, name, total: 0, done: 0, activityCount: 0, latestDetail: "" };
    current.total += 1;
    if (row.kind === "done") current.done += 1;
    if (!current.latestDetail && row.excerpt) current.latestDetail = row.excerpt;
    byId.set(row.assigneeId, current);
  }
  return Array.from(byId.values()).sort((a, b) => b.total - a.total || b.activityCount - a.activityCount);
}

function oneLine(value: string | undefined, max: number): string {
  const text = String(value ?? "").replace(/\s+/gu, " ").trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1).trimEnd()}…`;
}

function timeOf(iso: string | undefined): number {
  if (!iso) return Number.NaN;
  return new Date(iso).getTime();
}

/** 아직 답하지 않은 마지막 질문(업무판의 "답이 필요해요"). */
function openLedgerQuestion(task: DailyReportLedgerTask) {
  return [...(task.humanQA ?? [])].reverse().find((qa) => qa && !qa.answer && !qa.dismissedAt);
}

function ledgerWaitingFor(task: DailyReportLedgerTask): DailyReportLedgerRow["waitingFor"] | undefined {
  const state = task.execution?.state ?? "";
  if (openLedgerQuestion(task) || state === "waiting_input") return "answer";
  if (state === "waiting_approval") return "approval";
  if (state === "failed") return "retry";
  return task.status === "blocked" ? "review" : undefined;
}

const LEDGER_EXCERPT_CHARS = 140;

/**
 * 업무판에서 그 기간에 끝났거나(반복 업무는 마지막 완료 시각), 그 기간에 멈춰 답·승인을
 * 기다리게 된 일을 고른다. 이미 다른 업무 목록에 포함된 id는 두 번 세지 않는다.
 */
export function selectLedgerTasksForReport(
  tasks: DailyReportLedgerTask[] | undefined,
  inWindow: (iso: string | undefined) => boolean,
  knownIds: ReadonlySet<string> = new Set(),
): DailyReportLedgerRow[] {
  const rows: DailyReportLedgerRow[] = [];
  const seen = new Set<string>();
  for (const task of Array.isArray(tasks) ? tasks : []) {
    if (!task || typeof task.id !== "string" || !task.id || seen.has(task.id) || knownIds.has(task.id)) continue;
    const title = oneLine(task.title, 120);
    if (!title) continue;
    const assigneeName = oneLine(task.assigneeName, 40);
    const base = { id: task.id, title, assigneeId: String(task.assigneeId ?? ""), assigneeName };
    const waitingFor = ledgerWaitingFor(task);
    if (waitingFor) {
      const at = [task.updatedAt, task.execution?.lastCompletedAt].find((iso) => inWindow(iso));
      if (!at) continue;
      const question = openLedgerQuestion(task)?.question;
      const excerpt =
        waitingFor === "answer"
          ? oneLine(question, LEDGER_EXCERPT_CHARS)
          : waitingFor === "retry"
            ? oneLine(task.execution?.error, LEDGER_EXCERPT_CHARS)
            : oneLine(task.result, LEDGER_EXCERPT_CHARS);
      rows.push({ ...base, kind: "waiting", waitingFor, at, excerpt });
      seen.add(task.id);
      continue;
    }
    const repeated = Boolean(task.execution?.repeat && task.execution.repeat !== "none");
    if (task.status !== "done" && !repeated) continue;
    const completedAt = [task.completedAt, task.execution?.lastCompletedAt].find((at) => inWindow(at));
    if (!completedAt) continue;
    rows.push({ ...base, kind: "done", at: completedAt, excerpt: oneLine(task.result, LEDGER_EXCERPT_CHARS) });
    seen.add(task.id);
  }
  return rows.sort((a, b) => (a.kind === b.kind ? timeOf(b.at) - timeOf(a.at) : a.kind === "done" ? -1 : 1));
}

function ledgerRowToWorkItem(row: DailyReportLedgerRow): WorkItem {
  const status: WorkItemStatus =
    row.kind === "done" ? "completed" : row.waitingFor === "approval" ? "approval_pending" : "needs_review";
  return {
    id: `task-ledger-${row.id}`,
    title: row.title,
    source: "business_system",
    body: row.excerpt || row.title,
    status,
    riskLabel: "low",
    riskSignals: [],
    toolActionRequests: [],
    policyVersion: modyPolicyVersion,
    createdAt: row.at,
    updatedAt: row.at,
  };
}

function ledgerRowToAuditEntry(row: DailyReportLedgerRow): ModyAuditEntry {
  return {
    id: `audit-task-ledger-${row.id}`,
    actor: "agent",
    eventType: row.kind === "done" ? "tool_completed" : row.waitingFor === "retry" ? "tool_failed" : "approval_required",
    message: row.excerpt ? `${row.title} — ${row.excerpt}` : row.title,
    createdAt: row.at,
  };
}

/** 실행 로그는 작업의 증거이며 업무 완료 자체가 아니다. 생성한 보고서는 재집계하지 않는다. */
function isReportGeneration(event: SelectedWorkActionEvent): boolean {
  return event.id.startsWith("daily-report-") || event.metrics?.activityReportGenerated === true;
}

function reportTasks(options: BuildDailyActivityReportOptions): DailyReportLedgerTask[] {
  const byId = new Map<string, DailyReportLedgerTask>();
  for (const task of options.ledgerTasks ?? []) {
    if (!task?.id || task.id.startsWith("inbox:schedule-briefing:") || task.id.startsWith("inbox:trigger:work_trigger_signal_daily-weekly-schedule-briefing")) continue;
    byId.set(task.id, task);
  }
  for (const session of options.workSessions ?? []) {
    const id = `chat:${session.threadId}`;
    if (byId.has(id)) continue;
    byId.set(id, {
      id,
      title: session.title || options.resolveThreadTitle?.(session.threadId) || "업무 대화",
      status: session.status === "waiting" ? "blocked" : session.status,
      assigneeName: session.assigneeName,
      updatedAt: Number.isFinite(session.updatedAt) ? new Date(session.updatedAt).toISOString() : undefined,
      completedAt: Number.isFinite(session.completedAt) ? new Date(session.completedAt!).toISOString() : undefined,
    });
  }
  return [...byId.values()];
}

export type BuildDailyActivityReportOptions = {
  /** 업무판(업무 원장)의 업무들. 주면 그 기간에 끝났거나 기다리는 일을 보고서에 함께 담는다. */
  ledgerTasks?: DailyReportLedgerTask[];
  workSessions?: DailyReportWorkSession[];
  resolveThreadTitle?: (threadId: string) => string | undefined;
  dataWarnings?: string[];
  now?: Date;
  /** 보고 대상 날짜. 생략하면 오늘. */
  reportDay?: Date;
  /**
   * 기간으로 볼 때의 시작·끝. 주면 reportDay(하루) 대신 이 구간을 본다.
   * "내가 없는 동안"은 하루에 안 맞아떨어지므로 이쪽을 쓴다.
   */
  sinceIso?: string;
  untilIso?: string;
  /** 사용자 문구용 라벨("오늘"/"어제"/"내가 없는 동안"). 생략하면 "오늘". */
  dayLabel?: string;
  workspaceLabel?: string;
  resolveTeammateName?: (teammateId: string) => string | undefined;
};

function eventFallsInWindow(
  event: SelectedWorkActionEvent,
  sinceMs: number,
  untilMs: number,
): boolean {
  for (const iso of [event.updatedAt ?? event.createdAt]) {
    if (!iso) continue;
    const at = new Date(iso).getTime();
    if (Number.isNaN(at)) continue;
    if (at >= sinceMs && at <= untilMs) return true;
  }
  return false;
}

/**
 * 하루(기본: 오늘, reportDay 지정 시 그날)의 직원 업무 이벤트를 모아 업무 활동 보고서를 만듭니다.
 * 업무·활동·조회 오류가 모두 없으면 `hasWork: false`로 빈 보고서를 숨깁니다.
 */
export function buildDailyActivityReport(
  events: SelectedWorkActionEvent[],
  options: BuildDailyActivityReportOptions = {},
): DailyActivityReportResult {
  const now = options.now ?? new Date();
  const reportDay = options.reportDay ?? now;
  const dayLabel = options.dayLabel ?? "오늘";
  // 구간이 오면 구간으로 본다. 하루 단위로만 보면 사흘 비웠을 때 가운데가 사라진다.
  const sinceMs = options.sinceIso ? new Date(options.sinceIso).getTime() : Number.NaN;
  const untilMs = options.untilIso ? new Date(options.untilIso).getTime() : now.getTime();
  const useWindow = Number.isFinite(sinceMs) && Number.isFinite(untilMs) && sinceMs <= untilMs;
  const sourceEvents = events.filter((event) => !isReportGeneration(event));
  const dayEvents = useWindow
    ? sourceEvents.filter((event) => eventFallsInWindow(event, sinceMs, untilMs))
    : sourceEvents.filter(
        (event) => isSameLocalDay(event.updatedAt ?? event.createdAt, reportDay),
      );
  const inWindow = (iso: string | undefined) => {
    if (!useWindow) return isSameLocalDay(iso, reportDay);
    const at = timeOf(iso);
    return Number.isFinite(at) && at >= sinceMs && at <= untilMs;
  };
  const tasks = reportTasks(options);
  const ledger = selectLedgerTasksForReport(tasks, inWindow);
  const completionDateUnknown = tasks.filter((task) => task.status === "done" &&
    !Number.isFinite(timeOf(task.completedAt)) && !Number.isFinite(timeOf(task.execution?.lastCompletedAt))).length;
  const dataWarnings = options.dataWarnings ?? [];

  const workItems = ledger.map(ledgerRowToWorkItem);
  const auditEntries = [...dayEvents.map(eventToAuditEntry), ...ledger.map(ledgerRowToAuditEntry)];
  const builder = new ModyWorkActivityReportBuilder({ now: () => now });
  const report = builder.createReport({
    id: `daily_activity_report_${localDateKey(reportDay).replace(/-/gu, "")}`,
    title: `${dayLabel} 한 일 보고서 (${localDateKey(reportDay)})`,
    periodLabel: `${dayLabel} ${localDateKey(reportDay)}`,
    workspaceLabel: options.workspaceLabel ?? "ModyCrew 오피스",
    generatedAt: now.toISOString(),
    workItems,
    auditEntries,
  });
  report.summary.headline = `${dataWarnings.length ? "일부 자료를 불러오지 못해 확인된 기록만 집계했습니다. " : ""}${dayLabel} 완료 업무 ${ledger.filter((row) => row.kind === "done").length}건, 확인을 기다리는 업무 ${ledger.filter((row) => row.kind === "waiting").length}건입니다. 작업 기록 ${dayEvents.length}건은 업무 완료와 구분했습니다.`;
  report.summary.workMethodSummary = "저장된 업무 상태와 완료 시각을 기준으로 집계했습니다. 메일 읽기·정보 수정·답변 생성 기록은 완료 업무로 세지 않습니다.";
  report.notes = [...(report.notes ?? []), ...dataWarnings, ...(completionDateUnknown ? [`완료 시각이 없는 과거 업무 ${completionDateUnknown}건은 기간별 완료 집계에서 제외했습니다.`] : [])];
  const markdown = builder.renderMarkdown(report);

  const totalToday = ledger.length;
  return {
    report,
    markdown,
    reportDate: localDateKey(reportDay),
    dayLabel,
    doneToday: ledger.filter((row) => row.kind === "done").length,
    totalToday,
    activityCount: dayEvents.length,
    completionDateUnknown,
    dataWarnings,
    perAgent: summarizePerAgent(dayEvents, options.resolveTeammateName, ledger),
    hasWork: totalToday > 0 || dayEvents.length > 0 || dataWarnings.length > 0,
    ledger,
  };
}

const ledgerWaitingLabels: Record<NonNullable<DailyReportLedgerRow["waitingFor"]>, string> = {
  answer: "답을 기다려요",
  approval: "승인함에서 확인을 기다려요",
  retry: "다시 시도가 필요해요",
  review: "확인이 필요해요",
};

/** 보고서 글에 붙는 업무판 부분. 끝낸 일·기다리는 일을 각각 몇 줄씩만. */
function formatLedgerLines(ledger: DailyReportLedgerRow[], limit = 6): string[] {
  const lines: string[] = [];
  const done = ledger.filter((row) => row.kind === "done");
  const waiting = ledger.filter((row) => row.kind === "waiting");
  const who = (row: DailyReportLedgerRow) => (row.assigneeName ? ` (${row.assigneeName})` : "");
  if (done.length) {
    lines.push(`업무판에서 끝낸 일 ${done.length}건:`);
    for (const row of done.slice(0, limit)) lines.push(`• ${row.title}${who(row)}${row.excerpt ? ` — ${row.excerpt}` : ""}`);
    if (done.length > limit) lines.push(`• 그 밖에 ${done.length - limit}건은 업무판에서 볼 수 있어요.`);
  }
  if (waiting.length) {
    lines.push(`답·승인을 기다리는 일 ${waiting.length}건:`);
    for (const row of waiting.slice(0, limit)) {
      const label = row.waitingFor ? ledgerWaitingLabels[row.waitingFor] : "확인이 필요해요";
      lines.push(`• ${row.title}${who(row)} — ${label}${row.excerpt ? `: ${row.excerpt}` : ""}`);
    }
    if (waiting.length > limit) lines.push(`• 그 밖에 ${waiting.length - limit}건은 업무판에서 볼 수 있어요.`);
  }
  return lines;
}

/** 보고서 카드/채팅에 쓸 사람 친화 요약 문장을 만듭니다. */
export function formatDailyActivityReportMessage(result: DailyActivityReportResult): string {
  const { report, perAgent, reportDate, dayLabel } = result;
  const summary = report.summary;
  const lines: string[] = [
    `${dayLabel} 한 일 보고서 (${reportDate})`,
    report.summary.headline,
    `완료 ${summary.completedWorkItems} · 승인 대기 ${summary.approvalPendingWorkItems} · 확인 필요 ${summary.reviewNeededWorkItems} (총 ${summary.totalWorkItems}건)`,
  ];
  if (perAgent.length) {
    lines.push(`직원별 ${dayLabel} 업무:`);
    for (const agent of perAgent.slice(0, 6)) {
      const latest = agent.latestDetail ? ` (최근: ${agent.latestDetail})` : "";
      lines.push(`• ${agent.name} — 완료 업무 ${agent.done}건 · 작업 기록 ${agent.activityCount}건${latest}`);
    }
  }
  lines.push(...formatLedgerLines(result.ledger ?? []));
  if (result.completionDateUnknown) lines.push(`완료 시각이 없는 과거 업무 ${result.completionDateUnknown}건은 기간별 완료 집계에서 제외했습니다.`);
  lines.push(...result.dataWarnings);
  lines.push("이 보고서를 만드는 과정에서 외부 발송·일정 등록·파일 이동은 실행하지 않았습니다. 발송 여부는 각 업무의 실행 기록에서 확인하세요.");
  return lines.join("\n");
}
