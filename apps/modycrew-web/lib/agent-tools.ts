/**
 * 에이전트 도구 레지스트리 — 모델 주도 반복 루프(v1)가 호출할 수 있는 도구 목록.
 *
 * 원칙:
 *  - 기본 도구는 "읽기 전용 + 자동 실행(auto)" 입니다. 설정 변경처럼 앱 상태가 바뀌는
 *    요청은 permission:"approval" 로만 등록하고, 루프 호출부가 실행 대신 승인 카드로 넘깁니다.
 *  - desktop-bridge.ts 를 import 하지 않습니다(스모크의 단독 tsc 컴파일 유지).
 *    필요한 메서드만의 구조적 인터페이스(AgentToolBridge)를 정의하고, 실제 브리지는
 *    호출부(page.tsx)에서 구조적으로 충족시킵니다.
 *  - 각 도구의 관찰 요약은 도구 스스로 만들고 600자로 클램프합니다 — 모델 피드백
 *    채널이 비대해지지 않게 하는 안전장치입니다.
 */

// 타입만 가져온다(런타임 import 없음). 이 파일은 단독 변환·data: URL 로도 실행되므로 상대 모듈을 불러오지 않는다.
import type { DailySkillLookupResult } from "./daily-skills";
import { crewSkillAgentTools } from "./crew-skills";
import { creativeStudioAgentTools } from "./creative-studio";
import { documentChatAgentTools } from "./document-chat-tools";

const summaryMaxChars = 600;
// 일상 도구 조회는 표 형태 결과(여러 건의 가격·시각·장소)를 근거로 답해야 해서 넓게 준다.
// 데스크톱 메인이 이미 3,500자로 줄여 보내므로 여기서는 머리말 몫만 더한다.
const dailyLookupMaxChars = 3800;

type AgentToolResultLike = {
  status?: string;
  userMessage?: string;
} & Record<string, unknown>;

/** 루프가 사용하는 브리지 메서드들만의 구조적 부분집합 (런타임 브리지가 구조적으로 충족) */
export type AgentToolBridge = {
  runUnifiedWorkSync: (payload?: {
    limit?: number;
    suppressExternalNotifications?: boolean;
  }) => Promise<AgentToolResultLike>;
  runMailWorkIntake: (payload?: Record<string, unknown>) => Promise<AgentToolResultLike>;
  searchMail: (payload: { query: string; limit?: number }) => Promise<AgentToolResultLike>;
  readMail: (payload: { messageId: string }) => Promise<AgentToolResultLike>;
  draftMail: (payload: Record<string, unknown>) => Promise<AgentToolResultLike>;
  runTriggerDueChecks: () => Promise<AgentToolResultLike>;
  prepareToolchain: () => Promise<AgentToolResultLike>;
  getLocalMemoryStatus: () => Promise<AgentToolResultLike>;
  getDesktopControlStatus: (payload?: { featureEnabled?: boolean }) => Promise<AgentToolResultLike>;
  listWorkPatterns: () => Promise<AgentToolResultLike>;
  listConnectorStatuses: () => Promise<AgentToolResultLike>;
  getTriggerSettings: () => Promise<AgentToolResultLike>;
  searchDocumentLearningIndex: (payload: {
    query: string;
    localStorageRoot?: string;
  }) => Promise<AgentToolResultLike>;
  /** 일상 도구 조회(설치 앱 0.2.97+). 없으면 daily.lookup 은 안내 문장만 돌려준다. */
  lookupDailySkill?: (payload: {
    skillId: string;
    endpointId?: string;
    params?: Record<string, unknown>;
  }) => Promise<AgentToolResultLike>;
};

export type AgentToolContext = {
  teammateId?: string;
  /** mail.intake 가 사용하는 페이지 수준 시나리오 포커스 (페이지가 주입) */
  scenarioFocus?: unknown;
  /**
   * 학습 자료 인덱스가 있는 곳. **반드시 넘겨야 한다.**
   * 안 넘기면 데스크톱이 `문서\ModyCrew\LocalIndex` 로 되돌아가는데, 앱이 자동으로
   * 채우고 자동으로 검색하는 인덱스는 로컬 기억 폴더 아래에 있다. 그래서 이 값이
   * 없으면 직원이 쓰는 "학습 자료 검색"만 다른 파일을 보게 되고, 사용자가 어느 쪽에
   * 자료를 넣었든 회상 경로 둘 중 하나는 늘 빈손이 된다.
   */
  localStorageRoot?: string;
  /**
   * mail.draft 가 초안을 만들면 호출된다. 호출부(page.tsx)가 이 초안을 승인함 '보낼까요?' 카드로 올린다.
   * 도구가 모델에 돌려주는 관찰 문자열은 바뀌지 않는다. 발송은 여기서도, 카드에서도 마지막 확인 전에는 없다.
   */
  onMailDraftReady?: (draft: AgentMailDraftReady) => unknown;
  /**
   * 일상 도구 정책. enabled=false 면 조회하지 않는다(사용자가 끔). allowedSkillIds 가 있으면
   * 그 안의 도구만 조회한다 — 직원 역할이 허용한 분류에서 페이지가 계산해 넣는다.
   */
  dailySkills?: { enabled: boolean; allowedSkillIds?: readonly string[] };
  /** 조회 결과가 나올 때마다 호출(화면의 출처 줄 표시용). 실패해도 관찰 문장은 그대로다. */
  onDailySkillResult?: (result: DailySkillLookupResult) => unknown;
  /** 지금 대화 ID. 오래 걸리는 작업(이미지 만들기)의 진행 카드를 같은 대화에 붙인다. */
  threadId?: string;
  /** 이번 도구 호출에 허락된 시간(ms). 오래 걸리는 도구가 얼마나 기다릴지 정한다. */
  toolTimeoutMs?: number;
};

/** 채팅 도구가 만든 메일 초안 — 받는 사람·제목은 모델이 넘긴 값 그대로(검증은 호출부·데스크톱이 한다). */
export type AgentMailDraftReady = {
  body: string;
  to?: string;
  subject?: string;
  replyToMessageId?: string;
};

export type AgentToolPermission = "auto" | "approval";

export type AgentToolEntry = {
  id: string;
  korLabel: string;
  korDescription: string;
  /** 모델에게 보여줄 인자 힌트 — 예: '{"query":"검색어"}' 또는 "없음" */
  argsHint: string;
  permission: AgentToolPermission;
  execute: (
    bridge: AgentToolBridge,
    args: Record<string, unknown>,
    ctx: AgentToolContext,
  ) => Promise<string>;
};

function clampSummary(value: string, maxChars: number = summaryMaxChars): string {
  const normalized = String(value ?? "").replace(/\s+/gu, " ").trim();
  if (!normalized) return "(결과 없음)";
  return normalized.length > maxChars ? `${normalized.slice(0, maxChars - 1)}…` : normalized;
}

function describeResult(
  result: AgentToolResultLike,
  extras: string[] = [],
  maxChars: number = summaryMaxChars,
): string {
  const parts = [result?.userMessage ? String(result.userMessage) : "", ...extras].filter(Boolean);
  if (!parts.length && result?.status) parts.push(`상태: ${String(result.status)}`);
  return clampSummary(parts.join(" / "), maxChars);
}

function textValue(value: unknown): string {
  return typeof value === "string" ? value.replace(/\s+/gu, " ").trim() : "";
}

function kstShortTime(iso: string | undefined): string {
  const time = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(time)) return "방금";
  const kst = new Date(time + 9 * 60 * 60 * 1000);
  const mm = String(kst.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(kst.getUTCDate()).padStart(2, "0");
  const hh = String(kst.getUTCHours()).padStart(2, "0");
  const mi = String(kst.getUTCMinutes()).padStart(2, "0");
  return `${mm}/${dd} ${hh}:${mi}`;
}

/** daily.lookup 결과 → 모델 관찰 문장. 실패도 그대로 알려서 모델이 값을 지어내지 않게 한다. */
function formatDailySkillObservation(result: DailySkillLookupResult | null | undefined): string {
  if (!result || !result.ok) {
    return `조회 실패: ${textValue(result?.userMessage) || "조회 서버가 응답하지 않았어요."} (값을 추측하지 말고 실패를 알려 주세요)`;
  }
  const head = [
    `[${textValue(result.skillName) || result.skillId}${result.endpointSummary ? ` · ${textValue(result.endpointSummary)}` : ""}]`,
    `출처: ${textValue(result.source) || "공개 데이터"} (k-skill 공개 중계 서버 경유)`,
    `조회 ${kstShortTime(result.fetchedAt)}${result.cached ? "(1분 안 같은 조회 재사용)" : ""}`,
    result.truncated ? "결과 일부만 표시" : "",
    result.ignoredParams?.length ? `무시한 인자: ${result.ignoredParams.join(", ")}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
  return `${head}\n${result.dataText ?? ""}`;
}

/** 초안 준비 알림. 호출부 실패가 도구 결과(모델 관찰)를 바꾸거나 막지 않게 한다. */
function notifyMailDraftReady(ctx: AgentToolContext | undefined, draft: AgentMailDraftReady) {
  if (typeof ctx?.onMailDraftReady !== "function") return;
  try {
    const pending = ctx.onMailDraftReady(draft);
    if (pending && typeof (pending as Promise<unknown>).catch === "function") {
      void (pending as Promise<unknown>).catch(() => undefined);
    }
  } catch {
    // 승인함에 못 올려도 채팅 답변은 이어진다.
  }
}

function mailClassificationLabel(value: unknown): string {
  if (value === "business_mail") return "업무 메일";
  if (value === "ignored_noise") return "광고·스팸 제외";
  if (value === "needs_review") return "확인 필요";
  return "분류 확인 중";
}

function formatMailIntakeObservation(result: AgentToolResultLike): string {
  const analysis = result.workAnalysis && typeof result.workAnalysis === "object"
    ? result.workAnalysis as Record<string, unknown>
    : null;
  const stats = analysis?.stats && typeof analysis.stats === "object"
    ? analysis.stats as Record<string, unknown>
    : null;
  if (!analysis || !stats) return describeResult(result);

  const number = (key: string) => {
    const value = Number(stats[key]);
    return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
  };
  const highRiskSignals =
    number("complaintEscalationSignals") +
    number("securityAccountAlertSignals") +
    number("publicTaxSignals") +
    number("contractLegalSignals");
  const suggestions = Array.isArray(analysis.improvementSuggestions)
    ? analysis.improvementSuggestions.map(textValue).filter(Boolean)
    : [];
  return clampSummary([
    `메일 ${number("totalMessages")}건 확인`,
    `업무 후보 ${number("workItems")}건`,
    `확인 필요 ${number("reviewItems")}건`,
    `광고·스팸 제외 ${number("ignoredItems")}건`,
    highRiskSignals > 0 ? `긴급·고위험 신호 ${highRiskSignals}건` : "",
    `답장 후보 ${number("replyCandidates")}건`,
    `일정 후보 ${number("calendarCandidates")}건`,
    textValue(analysis.summary) ? `핵심: ${textValue(analysis.summary)}` : "",
    suggestions[0] ? `다음 행동: ${suggestions[0]}` : "",
  ].filter(Boolean).join(" | "));
}

function formatMailReadObservation(result: AgentToolResultLike): string {
  const message = result.message && typeof result.message === "object"
    ? result.message as Record<string, unknown>
    : null;
  if (!message) return describeResult(result);
  const preview = textValue(result.bodyPreview);
  return clampSummary([
    textValue(message.subject) ? `제목: ${textValue(message.subject)}` : "",
    textValue(message.from) ? `보낸 사람: ${textValue(message.from)}` : "",
    `분류: ${mailClassificationLabel(message.classification)}`,
    textValue(result.workSummary) ? `핵심: ${textValue(result.workSummary)}` : "",
    preview ? `내용: ${preview}` : "본문은 보안 기준상 제공되지 않음",
  ].filter(Boolean).join(" | "));
}

function countOf(value: unknown): number | null {
  if (Array.isArray(value)) return value.length;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return null;
}

const registry: AgentToolEntry[] = [
  {
    id: "work.sync",
    korLabel: "오늘 업무 동기화",
    korDescription: "연결된 채널에서 새 업무를 모아 인박스 상태를 갱신하고 요약을 돌려줍니다.",
    argsHint: "없음",
    permission: "auto",
    execute: async (bridge) => {
      const result = await bridge.runUnifiedWorkSync({ limit: 10, suppressExternalNotifications: true });
      const added = countOf(result.addedCount);
      const total = countOf(result.totalInboxItems);
      return describeResult(result, [
        added !== null ? `새 업무 ${added}건` : "",
        total !== null ? `인박스 총 ${total}건` : "",
      ]);
    },
  },
  {
    id: "mail.intake",
    korLabel: "메일/일정 읽기",
    korDescription:
      "연결된 메일을 읽기 전용으로 확인해 답장·일정 후보를 정리합니다(발송 없음). drafts:true면 안전 점검을 통과한 후보에 AI 답장 초안을 승인함 카드로 준비합니다.",
    argsHint: '없음 또는 {"drafts":true}',
    permission: "auto",
    execute: async (bridge, args, ctx) => {
      const result = await bridge.runMailWorkIntake({
        limit: 10,
        ...(args.drafts === true ? { generateDrafts: true } : {}),
        ...(ctx.scenarioFocus ? { scenarioFocus: ctx.scenarioFocus } : {}),
      });
      const drafts = (result.draftGeneration ?? null) as { generated?: unknown; blocked?: unknown } | null;
      const generatedCount = countOf(drafts?.generated);
      const blockedCount = countOf(drafts?.blocked);
      const observation = formatMailIntakeObservation(result);
      return clampSummary([
        observation,
        generatedCount !== null && generatedCount > 0 ? `AI 초안 ${generatedCount}건 준비` : "",
        blockedCount !== null && blockedCount > 0 ? `안전 점검 차단 ${blockedCount}건` : "",
      ].filter(Boolean).join(" | "));
    },
  },
  {
    id: "mail.search",
    korLabel: "메일 검색",
    korDescription:
      "최근 메일에서 키워드로 맞는 메일을 읽기 전용으로 찾습니다(제목/보낸사람/미리보기 기준, 발송 없음).",
    argsHint: '{"query":"검색어"}',
    permission: "auto",
    execute: async (bridge, args) => {
      const query = typeof args.query === "string" ? args.query.trim() : "";
      if (!query) return "검색어(query)가 비어 있어 메일 검색을 건너뛰었습니다.";
      const result = await bridge.searchMail({ query });
      const matches = Array.isArray(result.matches) ? result.matches : [];
      const lines = matches
        .slice(0, 3)
        .map((match, index) => {
          const subject =
            typeof (match as { subject?: unknown })?.subject === "string"
              ? String((match as { subject?: unknown }).subject)
              : "";
          const from = textValue((match as { from?: unknown })?.from);
          const classification = mailClassificationLabel((match as { classification?: unknown })?.classification);
          const messageId =
            typeof (match as { messageId?: unknown })?.messageId === "string"
              ? String((match as { messageId?: unknown }).messageId)
              : "";
          return subject
            ? `${index + 1}) [${classification}] ${subject}${from ? ` — ${from}` : ""}${messageId ? ` (id:${messageId})` : ""}`
            : "";
        })
        .filter(Boolean);
      if (result.status !== "mail_search_ready") return describeResult(result);
      return clampSummary([`검색 '${query}' ${matches.length}건`, lines.length ? lines.join(" · ") : ""].filter(Boolean).join(" | "));
    },
  },
  {
    id: "mail.read",
    korLabel: "메일 열람",
    korDescription:
      "mail.search로 찾은 메시지 id의 메타데이터와 안전 점검(인젝션 스캔)을 통과한 미리보기를 읽기 전용으로 확인합니다.",
    argsHint: '{"messageId":"메시지 id"}',
    permission: "auto",
    execute: async (bridge, args) => {
      const messageId = typeof args.messageId === "string" ? args.messageId.trim() : "";
      if (!messageId) return "메시지 id(messageId)가 비어 있어 메일 열람을 건너뛰었습니다. 먼저 mail.search를 사용하세요.";
      const result = await bridge.readMail({ messageId });
      if (result.status !== "mail_read_preview_ready" && result.status !== "mail_read_metadata_only") {
        return describeResult(result);
      }
      return formatMailReadObservation(result);
    },
  },
  {
    id: "mail.draft",
    korLabel: "메일 초안 작성",
    korDescription:
      "요청에 맞는 메일 본문 초안을 만들어 보여줍니다. 초안은 저장/발송하지 않으며, 실제 발송은 메일 작업 화면에서 사용자 최종 확인 후에만 진행됩니다.",
    argsHint: '{"request":"어떤 메일인지 요청","to":"(선택)","subject":"(선택)","replyToMessageId":"(선택)"}',
    permission: "auto",
    execute: async (bridge, args, ctx) => {
      const request = typeof args.request === "string" ? args.request.trim() : "";
      if (!request) return "요청 내용(request)이 비어 있어 메일 초안 작성을 건너뛰었습니다.";
      const to = typeof args.to === "string" ? args.to.trim() : "";
      const subject = typeof args.subject === "string" ? args.subject.trim() : "";
      const replyToMessageId = typeof args.replyToMessageId === "string" ? args.replyToMessageId.trim() : "";
      const result = await bridge.draftMail({
        request,
        ...(to ? { to } : {}),
        ...(subject ? { subject } : {}),
        ...(replyToMessageId ? { replyToMessageId } : {}),
      });
      const draft = (result.draft ?? null) as { body?: unknown } | null;
      const body = typeof draft?.body === "string" ? draft.body : "";
      if (result.status !== "mail_draft_ready" || !body) return describeResult(result);
      notifyMailDraftReady(ctx, {
        body,
        ...(to ? { to } : {}),
        ...(subject ? { subject } : {}),
        ...(replyToMessageId ? { replyToMessageId } : {}),
      });
      return clampSummary(`초안: ${body}`);
    },
  },
  {
    id: "automation.check",
    korLabel: "반복 업무 점검",
    korDescription: "켜져 있는 반복 업무 규칙의 마감 도래분을 점검하고 결과를 요약합니다.",
    argsHint: "없음",
    permission: "auto",
    execute: async (bridge) => {
      const result = await bridge.runTriggerDueChecks();
      const report = (result.report ?? null) as AgentToolResultLike | null;
      return describeResult(result, [report?.userMessage ? String(report.userMessage) : ""]);
    },
  },
  {
    id: "toolchain.prepare",
    korLabel: "작업 도구 상태",
    korDescription: "로컬 작업 도구(문서/검색 등) 준비 상태를 점검합니다.",
    argsHint: "없음",
    permission: "auto",
    execute: async (bridge) => describeResult(await bridge.prepareToolchain()),
  },
  {
    id: "memory.status",
    korLabel: "기억 저장소 상태",
    korDescription: "AI 팀원 업무 방식과 로컬 기억 위치, 저장 상태를 확인합니다.",
    argsHint: "없음",
    permission: "auto",
    execute: async (bridge) => {
      const result = await bridge.getLocalMemoryStatus();
      const root = typeof result.root === "string" ? result.root : "";
      return describeResult(result, [root ? `기억 위치: ${root}` : ""]);
    },
  },
  {
    id: "desktop.status",
    korLabel: "PC 화면/파일 관찰",
    korDescription: "열린 창과 최근 파일을 읽기 전용으로 관찰합니다(조작 없음).",
    argsHint: "없음",
    permission: "auto",
    execute: async (bridge) => {
      const result = await bridge.getDesktopControlStatus({});
      const windows = countOf(result.openWindows ?? result.windows);
      const recents = countOf(result.recentFiles);
      return describeResult(result, [
        windows !== null ? `열린 창 ${windows}개` : "",
        recents !== null ? `최근 파일 ${recents}개` : "",
      ]);
    },
  },
  {
    id: "patterns.list",
    korLabel: "저장한 업무 방식",
    korDescription: "사용자가 저장해 둔 업무 처리 방식(패턴) 목록을 확인합니다.",
    argsHint: "없음",
    permission: "auto",
    execute: async (bridge) => {
      const result = await bridge.listWorkPatterns();
      const patterns = Array.isArray(result.workPatterns) ? result.workPatterns : [];
      const titles = patterns
        .slice(0, 3)
        .map((pattern) =>
          typeof (pattern as { summary?: unknown })?.summary === "string"
            ? String((pattern as { summary?: unknown }).summary)
            : "",
        )
        .filter(Boolean);
      return describeResult(result, [
        `저장 방식 ${patterns.length}건`,
        titles.length ? `예: ${titles.join(" · ")}` : "",
      ]);
    },
  },
  {
    id: "connectors.status",
    korLabel: "연결 상태",
    korDescription: "메일/캘린더/메신저 등 연결된 서비스 상태를 확인합니다.",
    argsHint: "없음",
    permission: "auto",
    execute: async (bridge) => {
      const result = await bridge.listConnectorStatuses();
      const records = Array.isArray(result.connectors)
        ? result.connectors
        : Array.isArray(result.statuses)
          ? result.statuses
          : [];
      return describeResult(result, [`연결 기록 ${records.length}건`]);
    },
  },
  {
    id: "triggers.settings",
    korLabel: "반복 업무 설정",
    korDescription: "반복 업무 규칙(켜짐/꺼짐, 주기) 설정을 읽습니다.",
    argsHint: "없음",
    permission: "auto",
    execute: async (bridge) => {
      const result = await bridge.getTriggerSettings();
      const rules = Array.isArray(result.rules) ? result.rules : [];
      const enabled = rules.filter((rule) => (rule as { enabled?: unknown })?.enabled === true).length;
      return describeResult(result, [`규칙 ${rules.length}건 중 켜짐 ${enabled}건`]);
    },
  },
  {
    id: "docs.search",
    korLabel: "학습 자료 검색",
    korDescription: "문서별 제공 확인 경로가 준비될 때까지 이 도구는 검색하지 않습니다. 앱의 로컬 자료 검색을 이용할 수 있습니다.",
    argsHint: '{"query":"검색어"}',
    permission: "auto",
    execute: async () => {
      // 검색 UI는 유지하지만, 문서별 제공 동의를 검증할 수 없는 모델 도구는 자료를 읽지 않습니다.
      return "학습 자료를 모델에 제공할 문서별 확인 경로가 준비되지 않아 이 검색을 실행하지 않았습니다. 자료는 앱의 로컬 검색에서 확인할 수 있습니다.";
    },
  },
  {
    id: "daily.lookup",
    korLabel: "일상 정보 조회",
    korDescription:
      "날씨·교통·공휴일·법령·부동산 실거래가·공공 정보·뉴스 같은 실시간 공개 정보를 읽기 전용으로 조회합니다. [일상 도구 후보]에 나온 skill·endpoint·params 만 쓰세요.",
    argsHint: '{"skill":"korea-weather","endpoint":"forecast","params":{"region":"서울"}}',
    permission: "auto",
    execute: async (bridge, args, ctx) => {
      const policy = ctx?.dailySkills;
      if (policy && policy.enabled === false) {
        return "일상 도구가 꺼져 있어 조회하지 않았습니다. 사용자가 업무 도구 화면의 '일상 도구'에서 다시 켤 수 있습니다.";
      }
      if (typeof bridge.lookupDailySkill !== "function") {
        return "이 환경에서는 일상 도구를 쓸 수 없습니다. 설치된 ModyCrew 앱에서 쓸 수 있다고 안내하세요.";
      }
      const skillId = textValue(args.skill ?? args.skillId);
      const endpointId = textValue(args.endpoint ?? args.endpointId);
      const rawParams = args.params;
      const params =
        rawParams && typeof rawParams === "object" && !Array.isArray(rawParams)
          ? (rawParams as Record<string, unknown>)
          : {};
      if (!skillId) return "skill 값이 비어 있어 조회하지 않았습니다. [일상 도구 후보]의 skill 이름을 넣으세요.";
      if (policy?.allowedSkillIds && !policy.allowedSkillIds.includes(skillId)) {
        return `'${skillId}' 는 이 직원이 맡은 업무 범위의 일상 도구가 아니라 조회하지 않았습니다.`;
      }
      const result = (await bridge.lookupDailySkill({
        skillId,
        ...(endpointId ? { endpointId } : {}),
        params,
      })) as unknown as DailySkillLookupResult;
      if (typeof ctx?.onDailySkillResult === "function") {
        try {
          const pending = ctx.onDailySkillResult(result);
          if (pending && typeof (pending as Promise<unknown>).catch === "function") {
            void (pending as Promise<unknown>).catch(() => undefined);
          }
        } catch {
          // 화면 표시 실패가 관찰을 막지 않는다.
        }
      }
      return clampSummary(formatDailySkillObservation(result), dailyLookupMaxChars);
    },
  },
  {
    id: "settings.set_model",
    korLabel: "AI 모델 설정",
    korDescription: "채팅 답변에 쓸 AI 모델 변경 후보를 만듭니다. 저장은 사용자가 승인 버튼을 눌러야 합니다.",
    argsHint: '{"model":"latest"} 또는 {"model":"fast"}',
    permission: "approval",
    execute: async () => "AI 모델 변경은 자동 실행하지 않고 사용자 승인 버튼으로만 진행합니다.",
  },
  {
    id: "settings.toggle_trigger",
    korLabel: "반복 업무 켜기/끄기",
    korDescription: "저장된 반복 업무 규칙을 켜거나 끄는 후보를 만듭니다. 적용은 사용자 승인 버튼을 눌러야 합니다.",
    argsHint: '{"ruleId":"local-rule-...","enabled":true}',
    permission: "approval",
    execute: async () => "반복 업무 설정 변경은 자동 실행하지 않고 사용자 승인 버튼으로만 진행합니다.",
  },
  {
    id: "settings.set_memory_root",
    korLabel: "기억 위치 설정",
    korDescription: "로컬 기억 저장 위치를 고르는 설정 화면을 여는 후보를 만듭니다. 폴더 선택은 사용자가 직접 합니다.",
    argsHint: "없음",
    permission: "approval",
    execute: async () => "기억 위치 변경은 자동 실행하지 않고 사용자 승인 버튼으로만 진행합니다.",
  },
  {
    id: "settings.theme",
    korLabel: "화면 테마 설정",
    korDescription: "라이트/다크 화면 테마 변경 후보를 만듭니다. 적용은 사용자 승인 버튼을 눌러야 합니다.",
    argsHint: '{"theme":"dark"}',
    permission: "approval",
    execute: async () => "화면 테마 변경은 자동 실행하지 않고 사용자 승인 버튼으로만 진행합니다.",
  },
  {
    id: "teammate.create_from_learning",
    korLabel: "학습 기반 직원 만들기",
    korDescription:
      "학습한 업무 파일을 근거로 나와 같은 일을 하는 맞춤 AI 직원 생성을 제안합니다. 생성과 자동화 저장은 사용자 승인 버튼을 눌러야 진행됩니다.",
    argsHint: "없음 (최근 학습 결과 사용)",
    permission: "approval",
    execute: async () => "직원 생성은 자동 실행하지 않고 사용자 승인 버튼으로만 진행합니다.",
  },
  // 크루 스킬 지침 읽기·실제 실행. 실제 실행은 데스크톱 확인 창에서 사용자가 고른 뒤에만 시작한다.
  ...crewSkillAgentTools,
  // 이미지·홍보물 만들기 — 모디크루 디자인 크루. 실행기·결과 폴더는 앱이 고르고, 어떤 직원이든 쓴다.
  ...creativeStudioAgentTools,
  // 문서 파일 만들기 — 모디크루 문서 크루. 워드·한글·PDF·PPT·엑셀을 실제 파일로 저장하고 결과 폴더에 복사한다.
  ...documentChatAgentTools,
];

let cachedRegistry: AgentToolEntry[] | null = null;

export function getAgentToolRegistry(): AgentToolEntry[] {
  if (cachedRegistry) return cachedRegistry;
  const seen = new Set<string>();
  cachedRegistry = registry.filter((entry) => {
    if (seen.has(entry.id)) return false;
    seen.add(entry.id);
    return true;
  });
  return cachedRegistry;
}

export function findAgentTool(id: string): AgentToolEntry | null {
  const normalized = String(id ?? "").trim();
  if (!normalized) return null;
  return getAgentToolRegistry().find((entry) => entry.id === normalized) ?? null;
}

/**
 * 어떤 직원이든 쓸 수 있는 도구. 전부 읽기·확인용이라 역할과 무관하게 필요하다
 * (자기 상태를 못 보면 무슨 일이든 시작할 수 없다). 승인 경유 도구도 여기 둔다 —
 * 그건 어차피 사용자가 승인함에서 직접 결정한다.
 */
const alwaysAvailableToolIds = new Set<string>([
  "work.sync",
  "automation.check",
  "toolchain.prepare",
  "memory.status",
  "desktop.status",
  "patterns.list",
  "connectors.status",
  "triggers.settings",
  "docs.search",
  "settings.set_model",
  "settings.toggle_trigger",
  "settings.set_memory_root",
  "settings.theme",
  "teammate.create_from_learning",
  "customer.discovery.plan",
  "tradingagents.analysis.run", "tradingagents.rating.read", "scrapling.html.extract",
  "qmd.documents.search", "beads.tasks.analyze", "beads.runtime.check",
  "media.video.inspect",
  "skill.reference.search",
  "skill.reference.prepare",
  "crew.skill.read",
  "crew.skill.run",
  "studio.image.generate",
  "studio.image.status",
]);

/**
 * 업무 종류가 있어야 열리는 도구. 남의 메일함을 여는 일은 그 일을 맡은 직원만
 * 할 수 있어야 한다 — 지금까지는 재무 담당도 메일 담당과 똑같은 18개를 받았고,
 * 역할 차이는 프롬프트 문장뿐이었다.
 */
const workPackGatedToolIds: Record<string, readonly string[]> = {
  "mail.intake": ["inquiry_response", "schedule_coordination"],
  "mail.search": ["inquiry_response", "schedule_coordination"],
  "mail.read": ["inquiry_response", "schedule_coordination"],
  "mail.draft": ["inquiry_response", "schedule_coordination"],
};

/**
 * 이 직원이 쓸 수 있는 도구만 돌려준다.
 *
 * 규칙은 **좁히기만** 이다 — 전체 목록을 넘길 수는 있어도 없는 도구를 만들어낼 수는
 * 없다. 업무 종류를 하나도 안 가진 직원(고른 게 없는 custom)은 공용 도구만 받는다.
 * 판단 근거는 화면이 보여주는 것과 같은 workPackIds 라, 화면이 약속한 일과 실제로
 * 쓸 수 있는 도구가 어긋나지 않는다.
 */
export function getAgentToolRegistryForWorkPacks(
  workPackIds: readonly string[] | undefined,
  options: { dailyLookup?: boolean; roleToolIds?: readonly string[] } = {},
): AgentToolEntry[] {
  const granted = new Set(workPackIds ?? []);
  // 역할 정본(packages/domain role-capabilities)이 넘어오면 업무 종류 대신 그 목록이 메일 같은
  // 제한 도구의 기준이다 — 직원 화면이 "할 수 있는 일"로 보여 주는 것과 실제 도구가 같아야 한다.
  const roleGranted = options.roleToolIds ? new Set(options.roleToolIds) : null;
  return getAgentToolRegistry().filter((entry) => {
    // 일상 도구는 이 직원 역할에 허용된 분류가 있고, 카탈로그를 받았고, 사용자가 켜 둔
    // 때만 연다(호출부가 판단해 넘긴다). 기본값은 닫힘 — 후보 블록 없이 열면 모델이
    // 경로·인자를 지어내게 된다.
    if (entry.id === "daily.lookup") return options.dailyLookup === true;
    if (alwaysAvailableToolIds.has(entry.id)) return true;
    const required = workPackGatedToolIds[entry.id];
    if (!required) return true;
    if (roleGranted) return roleGranted.has(entry.id);
    return required.some((workPackId) => granted.has(workPackId));
  });
}

/** 모델 프롬프트용 — 도구당 한 줄 (id | 이름 | 설명 | 인자) */
export function formatAgentToolsForPrompt(entries: AgentToolEntry[] = getAgentToolRegistry()): string {
  return entries
    .map((entry) => `${entry.id} | ${entry.korLabel} | ${entry.korDescription} | 권한: ${entry.permission} | 인자: ${entry.argsHint}`)
    .join("\n");
}

export { clampSummary as clampAgentToolSummary };
