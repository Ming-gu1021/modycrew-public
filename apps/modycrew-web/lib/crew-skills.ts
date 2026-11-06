/**
 * 크루 스킬 — 채팅·위임 직원이 크루 스킬을 꺼내 쓰는 웹 쪽 배선.
 *
 * - 어떤 스킬을 쓸지는 도메인 정본(crew-skills)이 요청 문장으로 고르고 프롬프트에 절차를 넣는다.
 * - 이 파일은 모델이 쓰는 도구를 준다: 전체 지침 읽기(crew.skill.read), 실제 실행(crew.skill.run),
 *   멈춘 크루 작업 보기(crew.skill.attention). 실제 실행은 데스크톱 크루 스킬 실행기가 이 PC의 Codex·Claude 로 처리한다.
 *   결과 파일만 만드는 실행은 앱이 실행기(Codex 우선)를 골라 확인 창 없이 시작하고, 사용자 폴더를 고치거나 점검하는
 *   실행만 확인 창을 띄운다. 화면과 답변에는 '모디크루 <분야> 크루'로 보이고, 엔진 이름은 사용자가 물을 때만 말한다.
 * - 실행 상태는 데스크톱 실행기가 업무 상태 정본(work-status)으로 계산해 돌려준 값(workStatus·officeSignal)을
 *   그대로 업무 이벤트 저장소에 남긴다. 사무실 캐릭터·채팅이 따로 상태를 만들지 않는다.
 * - 데스크톱 연결(crewSkills)이 없는 설치본에서는 도구를 열지 않는다 — 없는 기능을 부르게 하지 않는다.
 * - 채팅 도구 정본(agent-tools)은 crewSkillAgentTools 를 그대로 펼친다. PC 앱 조작 도구(pc.*)도 이 배열에 함께 둬서
 *   채팅에서 자연어로 PC 작업을 부탁하면 모델이 고를 수 있다(실행 판단·허용·승인은 데스크톱 실행기가 한다).
 */
import type { AgentToolBridge, AgentToolContext, AgentToolEntry } from "./agent-tools";
import { pcControlAgentTools, withPcControlTools } from "./pc-control-tools";

// 화면 전용 업무 이벤트 저장소(브라우저 저장소)는 데스크톱 연결이 없을 때만 쓴다. 설치 앱에서는 사무실 화면·하루 보고가
// 메인 업무 이벤트를 읽으므로 브리지(recordSelectedWorkActionEvent)로 남겨야 보인다. 이 모듈만 따로 옮겨 검사하는
// 도구 목록 시험이 있고, 이벤트 기록은 실패해도 실행을 막지 않는 부가 기능이라 실행할 때만 불러온다.
type WorkEventStore = typeof import("./selected-work-action-events");
let workEventStore: Promise<WorkEventStore | null> | undefined;
function loadWorkEventStore(): Promise<WorkEventStore | null> {
  workEventStore ??= import("./selected-work-action-events").catch(() => null);
  return workEventStore;
}
type WorkEventInput = Parameters<WorkEventStore["recordSelectedWorkActionEvent"]>[0];
type WorkEventPatch = Parameters<WorkEventStore["updateSelectedWorkActionEvent"]>[1];
type WorkEventSink = { record(event: WorkEventInput): void; update(id: string, patch: WorkEventPatch): void };

/** 업무 이벤트를 남길 곳: 설치 앱이면 메인 기록(브리지), 아니면 화면 저장소. 기록 실패는 실행을 막지 않는다. */
async function workEventSink(bridge?: unknown): Promise<WorkEventSink | null> {
  const native = bridge as { recordSelectedWorkActionEvent?: (event: WorkEventInput) => Promise<unknown>; updateSelectedWorkActionEvent?: (id: string, patch: WorkEventPatch) => Promise<unknown> } | undefined;
  const record = native?.recordSelectedWorkActionEvent;
  const update = native?.updateSelectedWorkActionEvent;
  if (typeof record === "function" && typeof update === "function") {
    return {
      record: (event) => { void Promise.resolve().then(() => record.call(native, event)).catch(() => undefined); },
      update: (id, patch) => { void Promise.resolve().then(() => update.call(native, id, patch)).catch(() => undefined); },
    };
  }
  const store = await loadWorkEventStore();
  return store ? { record: (event) => { store.recordSelectedWorkActionEvent(event); }, update: (id, patch) => { store.updateSelectedWorkActionEvent(id, patch); } } : null;
}

export type CrewSkillRuntimeStatus = { id: string; label: string; installed: boolean; loggedIn: boolean; userMessage?: string };
export type CrewSkillOfficeSignal = { eventStatus: "running" | "done" | "needs_desktop" | "error" | "unknown"; officeStatus: string };
export type CrewSkillWorkSignal = { workStatus?: string; workReason?: string; workStatusLabel?: string; officeSignal?: CrewSkillOfficeSignal };
export type CrewSkillRunRecord = CrewSkillWorkSignal & {
  id: string; name: string; label: string; status: string; runtimeLabel?: string; startedAt: string; finishedAt?: string;
  outputText?: string; outputFiles?: Array<{ path: string; size: number }>; changedFiles?: Array<{ path: string; change: string }>;
  outsidePlan?: Array<{ path: string; change: string }>; secretHits?: Array<{ path: string; count: number }>;
  resultPath?: string; outputDir?: string; userMessage?: string; teammateId?: string; threadId?: string;
  plan?: { size: string; files: string[]; summary: string; reasons?: string[] };
  audit?: { counts: { confirmed: number; needs_validation: number; rejected: number; downgraded: number }; redactions: number };
};
export type CrewSkillAttentionItem = {
  id: string; title: string; detail?: string; status: string; reason: string; label: string; nextAction: string; statusLabel: string;
  runId?: string; threadId?: string; teammateId?: string; updatedAt: string;
};
export type CrewSkillPackageView = {
  name: string; label: string; description: string; version: string; category: string; categoryLabel: string;
  availability: "core" | "optional"; profile: string; executionLabel: string; owners: string;
  permissions: string[]; permissionLabels: string[]; runtimeTools: string[]; platforms: string[];
  requires: { runtimes: string[]; minRuntimes: number; mcpServers?: string[]; cli?: string[] }; io: { inputs: string[]; outputs: string[] };
  verification: { level: string; checkedAt: string; note: string };
  sources: Array<{ label: string; url?: string; license: string; status: string; reviewedVersion?: string }>;
  integrity: { sha256: string; ok: boolean }; lifecycle: string; lifecycleLabel: string;
  package: null | { installed: boolean; activeVersion: string; previousVersion: string; updateAvailable: boolean; addedPermissions: string[]; integrityOk: boolean | null; integrityProblem: string; blocked: boolean };
  mcpReady: Record<string, boolean>; cliReady?: Record<string, boolean>; companions: Array<{ name: string; installed: boolean }>;
};
export type CrewExtensionReferenceView = { id: string; label: string; category: string; url?: string; license: string; reviewedVersion: string; state: string; reflectedIn: string[]; note: string };
export type CrewSkillsResult = CrewSkillWorkSignal & {
  status: string; userMessage: string;
  runtimes?: CrewSkillRuntimeStatus[];
  skill?: { name: string; label: string; origin: string; execution: string; source: string; description: string; instructions: string; resources: string[] };
  run?: CrewSkillRunRecord; records?: CrewSkillRunRecord[]; outputText?: string;
  items?: CrewSkillAttentionItem[]; skills?: CrewSkillPackageView[]; references?: CrewExtensionReferenceView[];
  lifecycleLabels?: Record<string, string>; referenceStateLabels?: Record<string, string>;
  persistence?: Record<string, { label: string; note: string; guaranteed: boolean }>;
  steps?: string[]; missing?: string[];
};
type CrewSkillsCall = (payload: Record<string, unknown>) => Promise<CrewSkillsResult>;

/** 데스크톱 브리지의 크루 스킬 연결. 없으면 undefined(구버전 설치본·웹 미리보기). */
export function crewSkillsBridge(bridge?: unknown): CrewSkillsCall | undefined {
  const fromBridge = (bridge as { crewSkills?: unknown } | undefined)?.crewSkills;
  const fromWindow = typeof window === "undefined" ? undefined : (window as unknown as { modyCrewDesktopBridge?: { crewSkills?: unknown } }).modyCrewDesktopBridge?.crewSkills;
  const call = typeof fromBridge === "function" ? fromBridge : fromWindow;
  return typeof call === "function" ? (call as CrewSkillsCall) : undefined;
}

export async function crewSkills(payload: Record<string, unknown>, bridge?: unknown): Promise<CrewSkillsResult> {
  const call = crewSkillsBridge(bridge);
  if (!call) return { status: "unavailable", userMessage: "크루 스킬 실제 실행은 최신 모디크루 설치 앱에서 사용할 수 있습니다." };
  return call(payload);
}

/** 지금 앱의 저장 위치(기억 폴더). 실행기가 같은 값인지 확인해 다른 저장소 기록이 섞이지 않게 한다. */
export async function crewSkillWorkspaceRoot(): Promise<string> {
  if (typeof window === "undefined") return "";
  const raw = (window as unknown as { modyCrewDesktopBridge?: { getLocalMemoryStatus?: () => Promise<{ root?: string; defaultRoot?: string }> } }).modyCrewDesktopBridge;
  try {
    const status = await raw?.getLocalMemoryStatus?.();
    return String(status?.root || status?.defaultRoot || "");
  } catch {
    return "";
  }
}

function clip(value: unknown, max: number): string {
  const text = String(value ?? "").trim();
  return text.length > max ? text.slice(0, max - 1) + "…" : text;
}

function skillNameArg(args: Record<string, unknown>): string {
  return String(args.name ?? args.skill ?? "").trim().toLowerCase();
}

/** 지금 업무 대화 id(위임 실행기가 도구 문맥에 넣어 준 경우). 없으면 "" — 실행기는 '직원' 범위를 쓴다. */
export function contextThreadId(ctx: AgentToolContext): string {
  return String((ctx as AgentToolContext & { threadId?: unknown }).threadId ?? "").trim().slice(0, 240);
}

function newRunId(): string {
  const cryptoLike = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (typeof cryptoLike?.randomUUID === "function") return cryptoLike.randomUUID();
  throw new Error("실행 식별자를 만들 수 없습니다.");
}

                                                                             
const crewTeamLabels: Record<string, string> = {
  "mody-design-crew": "모디크루 디자인 크루",
  "mody-dev-crew": "모디크루 개발 크루",
  "mody-deep-review": "모디크루 검토 크루",
  "mody-insta-content": "모디크루 콘텐츠 크루",
  "mody-motion-video": "모디크루 영상 크루",
  "mody-doc-to-skill": "모디크루 문서 크루",
  "mody-security-audit": "모디크루 보안 크루",
  "mody-reverse-engineering": "모디크루 분석 크루",
};
export function crewTeamLabel(name: string): string {
  return crewTeamLabels[String(name ?? "").trim().toLowerCase()] ?? "모디크루 크루";
}

/** 실행 결과 → 모델 관찰 문장. 만든 파일·바뀐 파일·실패 이유를 그대로 알려 모델이 결과를 지어내지 않게 한다. */
export function formatCrewSkillRunObservation(result: CrewSkillsResult): string {
  const run = result.run;
  const lines = [result.status + " · " + result.userMessage];
  const label = result.workStatusLabel ?? run?.workStatusLabel;
  if (label) lines.push("상태: " + label);
  if (run) lines.push("담당: " + crewTeamLabel(run.name) + (run.runtimeLabel ? " (처리 엔진 " + run.runtimeLabel + " — 엔진 이름은 사용자가 물을 때만 말하세요)" : ""));
  if (run?.outputFiles?.length) lines.push("만든 파일: " + run.outputFiles.map((file) => (run.audit ? "" : "output/") + file.path).join(", "));
  if (run?.changedFiles?.length) lines.push("대상 폴더에서 바뀐 파일: " + run.changedFiles.map((file) => file.change + " " + file.path).join(", "));
  if (run?.outsidePlan?.length) lines.push("계획 밖에서 바뀐 파일(사용자 확인 필요): " + run.outsidePlan.map((file) => file.change + " " + file.path).join(", "));
  if (run?.secretHits?.length) lines.push("비밀값처럼 보이는 문자열이 있는 결과 파일: " + run.secretHits.map((hit) => hit.path).join(", ") + " — 값을 옮겨 쓰지 마세요.");
  if (run?.audit) lines.push("보안 점검 판정(앱 근거 검사 뒤): confirmed " + run.audit.counts.confirmed + " · needs_validation " + run.audit.counts.needs_validation + " · rejected " + run.audit.counts.rejected + ". 이 결과로 앱 전체가 안전하다고 말하지 마세요.");
  if (run?.resultPath) lines.push("결과 문서: " + run.resultPath);
  if (result.outputText) lines.push("실행기 결과(앞부분):\n" + clip(result.outputText, 3_000));
  if (result.status === "needs_input" && run?.workReason === "design_review") {
    lines.push("큰 변경이라 구현 전에 멈췄습니다. 계획 요지와 판정 이유를 사용자에게 보여 주고, 사용자가 '이대로 구현'처럼 확인하면 crew.skill.run 을 같은 name·request 에 approvedPlanRunId=\"" + run.id + "\" 를 넣어 다시 부르세요. 확인 전에는 구현했다고 쓰지 마세요.");
  } else if (result.status === "not_installed") {
    lines.push("선택형 확장이 아직 추가되지 않았습니다. 사용자에게 '플러그인 > 크루 스킬 확장'에서 추가할지 물어보세요. 추가 전에는 실행했다고 쓰지 마세요.");
  } else if (result.status === "use_tools") {
    lines.push("이 스킬은 crew.skill.run 이 아니라 PC 조작 도구로 진행합니다. pc.inspect 로 화면 요소를 읽고 pc.request 로 승인을 요청하세요.");
  } else if (result.status !== "completed") {
    lines.push("완료되지 않았습니다. 실행했다고 쓰지 말고 이유와 다음 행동을 알려 주세요.");
  } else {
    lines.push("답변 규칙: " + crewTeamLabel(run?.name ?? "") + "가 만들었다고 쓰고, 결과 폴더 위치와 파일 이름을 그대로 적으세요. 실행기·폴더를 사용자에게 묻지 마세요.");
  }
  return lines.join("\n");
}

/** 크루 스킬 실행을 기존 업무 이벤트 저장소에 남긴다(사무실 캐릭터가 같은 상태를 읽는다). 실패해도 실행에는 영향 없음. */
function crewSkillEvent(runId: string, name: string, teammateId: string, store: WorkEventSink | null) {
  const id = "crew-skill-" + runId;
  const workItemId = "ai-teammate:" + (teammateId || "teammate-personal-operator");
  const metrics = (signal: CrewSkillWorkSignal) => ({
    teammateId: teammateId || "teammate-personal-operator", crewSkill: name,
    ...(signal.officeSignal ? { virtualOfficeStatus: signal.officeSignal.officeStatus } : {}),
    ...(signal.workStatus ? { workStatus: signal.workStatus } : {}),
    ...(signal.workReason ? { workReason: signal.workReason } : {}),
  });
  return {
    start() {
      if (!store) return;
      try {
        // 확인 창을 오래 열어 둬도 '확인 불가'로 바뀌지 않게 승인 대기는 done+approval_pending 으로 남긴다(work-status 규칙).
        store.record({
          id, workItemId, label: "크루 스킬 · " + name, detail: "크루가 작업을 시작하고 있습니다. 사용자 폴더를 다루는 작업이면 확인 창이 뜹니다.", status: "done", createdAt: new Date().toISOString(),
          kind: "selected_action", sourceLabel: "크루 스킬", metrics: metrics({ workStatus: "needs_approval", workReason: "approval", officeSignal: { eventStatus: "done", officeStatus: "approval_pending" } }),
        });
      } catch { /* 저장소를 못 써도 실행은 계속 */ }
    },
    update(signal: CrewSkillWorkSignal, detail: string) {
      // '연결 끊김'(unknown)은 실행기만 판정한다. 화면이 덮어쓰지 않고 마지막 신호를 두면 저장소가 오래된 실행을 스스로 '확인 불가'로 보여 준다.
      const eventStatus = signal.officeSignal?.eventStatus;
      if (!store || !eventStatus || eventStatus === "unknown") return;
      try { store.update(id, { status: eventStatus, detail: clip(detail, 230), metrics: metrics(signal) }); } catch { /* 무시 */ }
    },
  };
}

const referenceTool = (id: string, label: string, description: string, argsHint: string): AgentToolEntry => ({
  id, korLabel: label, korDescription: description, argsHint, permission: "auto",
  execute: async (bridge, args, ctx) => {
    const tools = (await import("./employee-builder")).employeeReferenceAgentTools;
    const tool = tools.find((entry) => entry.id === id);
    return tool ? tool.execute(bridge, args, ctx) : "원본 스킬 도구를 찾지 못했습니다.";
  },
});
const crewSkillOwnTools: AgentToolEntry[] = [
  referenceTool("media.video.inspect", "공개 영상 정보 조회", "사용자가 준 YouTube 주소의 제목·채널·길이를 검증된 기존 yt-dlp로 조회합니다. 확인 창을 거치며 다운로드·로그인은 하지 않습니다.", '{"url":"https://www.youtube.com/watch?v=..."}'),
  referenceTool("skill.reference.search", "원본 스킬 찾기", "웹·앱 카탈로그에서 원본 스킬 ID와 담당 역할을 찾습니다. 설치하지 않습니다.", '{"query":"product-planner"}'),
  referenceTool("skill.reference.prepare", "필요한 원본 스킬 준비", "전문가의 원본 참조 ID를 준비합니다. 고정 버전·의존성·무결성을 확인하고 동일 설치본은 재사용합니다. 새 설치는 데스크톱 확인 창을 거치며 미연결 도구는 실행하지 않습니다.", '{"id":"grill-me"}'),
  {
    id: "crew.skill.read",
    korLabel: "크루 스킬 지침 읽기",
    korDescription: "크루 스킬 또는 이 PC에 설치된 Codex·Claude 스킬의 전체 지침을 불러옵니다. 자동 선택된 스킬의 절차를 정확히 따라야 할 때 먼저 읽습니다.",
    argsHint: '{"name":"mody-design-crew"}',
    permission: "auto",
    execute: async (bridge: AgentToolBridge, args: Record<string, unknown>) => {
      const name = skillNameArg(args);
      if (!name) return "읽을 스킬 이름(name)이 필요합니다.";
      const result = await crewSkills({ kind: "read", name }, bridge);
      if (result.status !== "read" || !result.skill) return clip(result.userMessage, 400);
      const skill = result.skill;
      return [
        "[" + skill.label + " · " + skill.name + " · " + skill.source + "]",
        skill.description,
        skill.resources.length ? "부속 파일: " + skill.resources.slice(0, 20).join(", ") + " (실제 실행 때 실행기가 읽습니다)" : "",
        clip(skill.instructions, 12_000),
      ].filter(Boolean).join("\n");
    },
  },
  {
    id: "crew.skill.run",
    korLabel: "크루 스킬 실제 실행",
    korDescription: "파일 생성·코드 수정·보안 점검·기능 분석·여러 AI 교차 검토가 필요한 크루 스킬을 이 PC에 로그인된 실제 Codex·Claude 로 실행합니다. 사용자가 실제 결과물을 원할 때만 부르세요. 결과 파일만 만드는 실행은 앱이 실행기와 작업 폴더를 정해 바로 시작하고 결과를 모디크루 결과 폴더에 저장합니다. 사용자 폴더를 고치거나 점검하는 실행만 확인 창에서 사용자가 고릅니다. 실행기·폴더를 사용자에게 묻지 말고, 끝나면 만든 파일과 결과 폴더를 알려 줍니다. 큰 개발 변경은 설계 확인 뒤 approvedPlanRunId 로 이어서 구현합니다.",
    argsHint: '{"name":"mody-dev-crew","request":"맡길 내용 전체","approvedPlanRunId":"설계 확인 뒤에만"}',
    permission: "auto",
    execute: async (bridge: AgentToolBridge, args: Record<string, unknown>, ctx: AgentToolContext) => {
      const name = skillNameArg(args);
      const request = String(args.request ?? args.요청 ?? "").trim();
      if (!name || !request) return "실행할 스킬 이름(name)과 맡길 내용(request)이 필요합니다.";
      const runId = newRunId();
      const teammateId = ctx.teammateId ?? "";
      // 대화마다 실행 범위를 나눈다. threadId 가 없으면 실행기는 'crew:직원' 범위를 써서 같은 직원의 다른 대화와
                                                                                   
      const threadId = contextThreadId(ctx);
      const scope = { workspaceRoot: ctx.localStorageRoot ?? "", teammateId, ...(threadId ? { threadId } : {}) };
      const approvedPlanRunId = String(args.approvedPlanRunId ?? "").trim();
      const event = crewSkillEvent(runId, name, teammateId, await workEventSink(bridge));
      event.start();
      // 실행 중에는 실행기 진행 상태를 읽어 사무실 이벤트를 새로 고친다(2분 넘게 신호가 없으면 화면이 '확인 불가'로 보므로 15초마다).
      const timer = setInterval(() => {
        void crewSkills({ kind: "progress", runId, ...scope }, bridge)
          .then((progress) => { if (progress.status === "running" || progress.status === "checking") event.update(progress, progress.userMessage); })
          .catch(() => undefined);
      }, 15_000);
      try {
        const result = await crewSkills({ kind: "run", runId, name, request, ...scope, ...(approvedPlanRunId ? { approvedPlanRunId } : {}) }, bridge);
        event.update(result.officeSignal ? result : { officeSignal: { eventStatus: result.status === "declined" ? "done" : "error", officeStatus: result.status === "declined" ? "idle" : "failed" }, workStatus: result.status === "declined" ? "cancelled" : "failed" }, result.userMessage);
        return formatCrewSkillRunObservation(result);
      } finally {
        clearInterval(timer);
      }
    },
  },
  {
    id: "crew.skill.attention",
    korLabel: "멈춘 크루 작업 보기",
    korDescription: "답변·승인·설계 확인·로그인·결과 확인 때문에 멈춘 크루 스킬 작업을 이유와 다음 행동과 함께 보여 줍니다. 사용자가 '확인할 일', '멈춘 일', '내 확인 필요'를 물을 때 씁니다.",
    argsHint: "없음",
    permission: "auto",
    execute: async (bridge: AgentToolBridge, _args: Record<string, unknown>, ctx: AgentToolContext) => {
      const result = await crewSkills({ kind: "attention", workspaceRoot: ctx.localStorageRoot ?? "" }, bridge);
      if (result.status !== "attention") return clip(result.userMessage, 400);
      if (!result.items?.length) return "확인이 필요한 크루 작업이 없습니다.";
      // 설계 확인 항목은 이어서 구현할 때 approvedPlanRunId 로 그대로 넘길 수 있게 전체 실행 번호를 보여 준다(8자리로는 이어 갈 수 없음).
      const runRef = (item: CrewSkillAttentionItem) => (!item.runId ? "" : item.reason === "design_review" ? " (approvedPlanRunId=\"" + item.runId + "\")" : " (실행 " + item.runId.slice(0, 8) + ")");
      return [result.userMessage, ...result.items.slice(0, 10).map((item, index) => (index + 1) + ". [" + item.statusLabel + "] " + item.title + " — " + item.label + " · " + item.nextAction + runRef(item))].join("\n");
    },
  },
];

/** 채팅 도구 정본이 펼치는 목록: 크루 스킬 도구 + PC 앱 조작 도구. 각 도구는 데스크톱 연결이 없으면 실행하지 않고 이유를 돌려준다. */
export const crewSkillAgentTools: AgentToolEntry[] = [...crewSkillOwnTools, ...pcControlAgentTools];

/** 데스크톱 연결이 있을 때만 크루 스킬 도구와 PC 앱 조작 도구를 더한다(각각 연결이 있을 때만). */
export function withCrewSkillTools(entries: AgentToolEntry[], bridge?: unknown): AgentToolEntry[] {
  const withPc = withPcControlTools(entries, bridge);
  if (!crewSkillsBridge(bridge)) return withPc;
  const ids = new Set(withPc.map((entry) => entry.id));
  return [...withPc, ...crewSkillOwnTools.filter((entry) => !ids.has(entry.id))];
}
