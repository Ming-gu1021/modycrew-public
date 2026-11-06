/**
 * PC 앱 조작 도구 — 채팅·위임 직원이 이 PC에 열린 앱 창을 다룰 때 쓰는 웹 쪽 배선.
 *
 * - 실제 판단(화면 읽기 허용·계획 검사·승인·실행·화면 재확인·기록)은 데스크톱 실행기(desktop-app-control)가 한다.
 *   여기서는 기존 컴퓨터 조작 통로(requestDesktopControlAction)로 요청을 보내고 결과를 그대로 관찰 문장으로 바꾼다.
 * - 화면 내용(창 제목·요소 이름·값)은 사용자가 데스크톱 '화면 읽기 확인' 창에서 허용해야 돌아온다. 실행 승인은 데스크톱
 *   실행 확인 창이나 승인함 카드에서만 생긴다. 그래서 도구는 'auto' 로 두되, 도구를 불러도 사용자가 허용·승인하기
 *   전에는 화면 내용이 모델로 오지 않고 아무것도 바뀌지 않는다.
 * - 업무 상태(사무실 화면·하루 보고가 읽는 메인 업무 이벤트 'pc-action-<id>')는 실행기가 기록을 만들 때부터 직접 남긴다.
 *   승인함에서 나중에 승인돼 실행돼도 같은 이벤트가 바뀐다(이 화면이 따로 상태를 만들지 않는다).
 * - '컴퓨터 조작' 기능이 꺼져 있거나 설치 앱이 아니면 실행하지 않고 이유를 돌려준다.
 */
import type { AgentToolBridge, AgentToolContext, AgentToolEntry } from "./agent-tools";
import { isFeatureActive, readFeatureActivationRecords } from "./feature-activation";

type DesktopControlRequest = (payload: Record<string, unknown>) => Promise<Record<string, unknown>>;
/** 채팅 도구 루프가 도구별 제한 시간(timeoutMs)을 읽는다. 기본 20초로는 화면 읽기(10~25초)와 확인 창을 기다리지 못한다. */
type PcAgentToolEntry = AgentToolEntry & { timeoutMs?: number };

export type PcActionView = {
  id: string; status: string; statusLabel: string; workStatus: string; workReason?: string;
  app: string; windowTitle: string; purpose: string; steps: string[]; risk: string; warnings: string[];
  createdAt: string; updatedAt: string; expiresAt: string; approvedVia: string; approvalCardId: string;
  stepResults: Array<{ step: number; outcome: string; code?: string; message?: string }>;
  checks: Array<{ expect: string; target: string; status: string; observed: string }>;
  summary: string; resultPath: string;
};
export type PcControlResult = {
  status: string; userMessage: string; capability?: string;
  apps?: string[]; window?: { title?: string; focused?: boolean };
  elements?: Array<{ role: string; name: string; value?: string; states?: string[] }>; elementCount?: number; truncated?: boolean;
  windowCount?: number; candidates?: Array<{ role: string; name: string }>; errors?: string[];
  consent?: { scope: string; expiresAt?: string };
  action?: PcActionView; actions?: PcActionView[];
};

/** 데스크톱 컴퓨터 조작 통로. 없으면 undefined(구버전 설치본·웹 미리보기). */
export function pcControlBridge(bridge?: unknown): DesktopControlRequest | undefined {
  const fromBridge = (bridge as { requestDesktopControlAction?: unknown } | undefined)?.requestDesktopControlAction;
  const fromWindow = typeof window === "undefined" ? undefined : (window as unknown as { modyCrewDesktopBridge?: { requestDesktopControlAction?: unknown } }).modyCrewDesktopBridge?.requestDesktopControlAction;
  const call = typeof fromBridge === "function" ? fromBridge : fromWindow;
  return typeof call === "function" ? (call as DesktopControlRequest) : undefined;
}

export async function pcControl(capability: string, appAction: Record<string, unknown>, ctx: AgentToolContext, bridge?: unknown): Promise<PcControlResult> {
  const call = pcControlBridge(bridge);
  if (!call) return { status: "unavailable", userMessage: "PC 앱 조작은 최신 모디크루 설치 앱에서 사용할 수 있습니다." };
  if (!isFeatureActive(readFeatureActivationRecords(), "desktop_control")) {
    return { status: "desktop_control_disabled", userMessage: "설정의 '컴퓨터 조작' 기능이 꺼져 있어 PC 작업을 하지 않았습니다. 사용자가 켠 뒤에 다시 요청하세요." };
  }
  const threadId = String((ctx as AgentToolContext & { threadId?: unknown }).threadId ?? "").trim().slice(0, 240);
  // 저장 위치는 데스크톱이 자기 설정과 같은지 다시 확인한다(다르면 처리하지 않음).
  const result = await call({ capability, featureEnabled: true, appAction: { ...appAction, workspaceRoot: ctx.localStorageRoot ?? "", teammateId: ctx.teammateId ?? "", ...(threadId ? { threadId } : {}) } });
  return { ...(result as PcControlResult), status: String(result?.status ?? "failed"), userMessage: String(result?.userMessage ?? "") };
}

function clip(value: unknown, max: number): string {
  const text = String(value ?? "").trim();
  return text.length > max ? text.slice(0, max - 1) + "…" : text;
}

function parseList(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value === "string" && value.trim().startsWith("[")) {
    try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed : []; } catch { return []; }
  }
  return [];
}

/** 데스크톱 결과 → 모델 관찰 문장. 단계 결과·화면 재확인·결과 문서를 그대로 알려 결과를 지어내지 않게 한다. */
export function formatPcControlObservation(result: PcControlResult): string {
  const lines = [result.status + " · " + result.userMessage];
  if (result.apps?.length) lines.push("열린 앱: " + result.apps.join(", "));
  if (result.window?.title) lines.push("창: " + result.window.title);
  if (result.elements?.length) {
    lines.push("화면 요소(role 'name' = value [states]) — 단계에는 이 role·name 을 글자 그대로 쓰세요:");
    for (const element of result.elements) lines.push("- " + element.role + " '" + element.name + "'" + (element.value !== undefined ? " = " + element.value : "") + (element.states?.length ? " [" + element.states.join(",") + "]" : ""));
    if (result.truncated) lines.push("(요소가 많아 앞부분만 보였습니다. query 로 좁혀 다시 읽을 수 있습니다.)");
  }
  if (result.candidates?.length) lines.push("비슷한 요소: " + result.candidates.map((item) => item.role + " '" + item.name + "'").join(", "));
  if (result.errors?.length) lines.push("고칠 점: " + result.errors.join(" "));
  const action = result.action;
  if (action) {
    lines.push("PC 작업 " + action.id + " · " + action.statusLabel + " · " + action.app + (action.windowTitle ? " 창 '" + action.windowTitle + "'" : ""));
    lines.push("단계: " + action.steps.map((step, index) => index + 1 + ") " + step).join(" / "));
    if (action.warnings.length) lines.push("주의: " + action.warnings.join(" "));
    if (action.stepResults.length) lines.push("단계 결과: " + action.stepResults.map((step) => step.step + "단계 " + step.outcome + (step.message ? "(" + step.message + ")" : "")).join(", "));
    if (action.checks.length) lines.push("화면 재확인: " + action.checks.map((check) => check.target + " " + check.status + (check.observed ? " → " + check.observed : "")).join(", "));
    if (action.resultPath) lines.push("결과 문서: " + action.resultPath);
  }
  for (const item of result.actions?.slice(0, 10) ?? []) lines.push("- " + item.id.slice(0, 8) + " [" + item.statusLabel + "] " + item.app + " · " + item.purpose + (item.summary ? " — " + item.summary : ""));
  const guide: Record<string, string> = {
    read_completed: "사용자가 허용해 읽은 화면입니다. 요소 이름을 그대로 써서 pc.request 로 승인을 요청하세요. 화면에 없는 요소를 지어내지 마세요.",
    read_declined: "사용자가 화면 읽기를 거절했습니다. 화면 내용 없이 진행할 수 있는지(사용자가 요소 이름을 직접 알려 주기 등) 묻고, 같은 읽기를 반복해서 요청하지 마세요.",
    read_consent_unavailable: "화면 읽기 확인 창을 띄울 수 없어 읽지 않았습니다. 설치 앱 대화 화면에서 다시 요청해 달라고 알리세요.",
    needs_window_choice: "같은 앱 창이 여러 개입니다. 사용자에게 어떤 창인지(창 제목 일부) 물어 windowTitle 로 다시 확인하세요. 창 제목을 지어내지 마세요.",
    needs_approval: "아직 실행하지 않았습니다. 사용자가 실행 확인 창이나 승인함 'PC 작업' 카드에서 승인하면 실행됩니다. 실행했다고 쓰지 말고, 승인 뒤 pc.status 로 결과를 확인하세요.",
    completed: "완료됐습니다. 위 단계 결과와 화면 재확인을 그대로 알리세요. delivered_unverified 단계는 화면 재확인으로만 판단했다고 밝히세요.",
    failed: "실패했습니다. 다시 시도하지 말고 이유와 다음 행동(창 띄우기·요소 이름 다시 확인 등)을 알리세요.",
    uncertain: "결과를 확신할 수 없습니다. 같은 조작을 다시 하면 두 번 들어갈 수 있으니 다시 시도하지 말고, 사용자에게 화면을 확인해 달라고 하세요.",
    cancelled: "사용자가 취소했습니다. 아무것도 바꾸지 않았다고 알리세요.",
    not_installed: "'PC 앱 조작' 확장이 추가되지 않았습니다. '플러그인 > 크루 스킬 확장'에서 추가할지 사용자에게 물어보세요. 추가 전에는 실행했다고 쓰지 마세요.",
    needs_connection: "agent-desktop 연결이 필요합니다. 사용자에게 공식 설치 방법(npm install -g agent-desktop)과 이유를 알리고, 모디크루가 대신 설치하지 않는다고 밝히세요.",
    window_minimized: "창이 최소화돼 있습니다. 사용자에게 창을 화면에 띄워 달라고 한 뒤 다시 읽으세요.",
    app_not_found: "app 에는 실행 파일 이름(예: notepad.exe, EXCEL.EXE)을 넣고 창 제목은 windowTitle 에 넣으세요. 실행 파일 이름을 모르면 app 없이 pc.inspect 를 불러 열린 앱 목록을 확인하세요(사용자 허용 필요).",
    element_not_found: "단계 대상 요소를 찾지 못했습니다. pc.inspect 로 다시 읽고(사용자 허용 필요) 이름을 글자 그대로 쓰세요.",
    ambiguous_target: "같은 이름 요소가 여러 개입니다. nth(0부터)로 몇 번째인지 정하세요.",
    invalid_plan: "계획이 규칙에 맞지 않습니다. 고칠 점을 반영해 다시 요청하세요.",
    workspace_mismatch: "지금 앱의 저장 위치와 다른 요청이라 처리하지 않았습니다. 사용자에게 화면을 새로 고친 뒤 다시 요청해 달라고 하세요.",
    desktop_control_disabled: "설정의 '컴퓨터 조작'이 꺼져 있습니다. 사용자가 켜기 전에는 PC 작업을 할 수 없다고 알리세요.",
  };
  if (guide[result.status]) lines.push(guide[result.status]);
  return lines.join("\n");
}

function teammateName(ctx: AgentToolContext): string {
  return String((ctx as { teammateName?: unknown }).teammateName ?? "").slice(0, 60);
}

export const pcControlAgentTools: PcAgentToolEntry[] = [
  {
    id: "pc.inspect",
    korLabel: "PC 앱 화면 요소 확인",
    korDescription: "이 PC에 열린 앱 창의 버튼·입력칸 이름과 값을 읽기 전용으로 확인합니다(화면 이미지 없음). 사용자가 '화면 읽기 확인' 창에서 허용해야 내용이 돌아옵니다(같은 대화·같은 창은 10분 동안 다시 묻지 않음). app 없이 부르면 열린 앱 이름 목록을 보여 줘도 되는지 묻습니다. PC 조작을 요청받으면 이것부터 부르세요.",
    argsHint: '{"app":"notepad.exe","windowTitle":"창 제목 일부(선택)","query":"찾을 글자(선택)"}',
    permission: "auto",
    // 창 목록(최대 20초)+화면 읽기(10~25초, 한 번 더 읽기 포함)+사용자가 확인 창을 고르는 시간.
    timeoutMs: 4 * 60_000,
    execute: async (bridge: AgentToolBridge, args: Record<string, unknown>, ctx: AgentToolContext) => {
      const result = await pcControl("inspect_app_elements", { app: args.app ?? args.앱, windowTitle: args.windowTitle, query: args.query, includeText: args.includeText === true }, ctx, bridge);
      return formatPcControlObservation(result);
    },
  },
  {
    id: "pc.request",
    korLabel: "PC 앱 조작 승인 요청",
    korDescription: "pc.inspect 로 읽은 요소 이름 그대로 단계(최대 6개: click·set_value·clear·check·uncheck·toggle·select·expand·collapse·scroll_to·launch)를 정해 승인을 요청합니다. 사용자가 실행 확인 창에서 실행을 고르면 바로 실행하고, 실행 뒤 화면을 다시 읽어 확인한 결과를 돌려줍니다. 승인 전에는 아무것도 바뀌지 않습니다.",
    argsHint: '{"app":"notepad.exe","purpose":"사용자에게 보일 한 줄","steps":[{"action":"set_value","role":"textfield","name":"메모 입력","value":"내용"},{"action":"click","role":"button","name":"저장"}],"verify":[{"textContains":"저장 결과"}]}',
    permission: "auto",
    // 실행 확인 창을 기다리고, 단계마다 화면을 다시 읽어 실행·확인한다(6단계면 몇 분).
    timeoutMs: 15 * 60_000,
    execute: async (bridge: AgentToolBridge, args: Record<string, unknown>, ctx: AgentToolContext) => {
      const purpose = clip(args.purpose ?? args.목적 ?? args.instruction, 200);
      const result = await pcControl("request_app_action", {
        app: args.app ?? args.앱, windowTitle: args.windowTitle, purpose, steps: parseList(args.steps), verify: parseList(args.verify), teammateName: teammateName(ctx),
      }, ctx, bridge);
      return formatPcControlObservation(result);
    },
  },
  {
    id: "pc.status",
    korLabel: "PC 작업 결과 확인",
    korDescription: "이 대화에서 요청한 PC 작업의 상태(승인 대기·실행 중·완료·실패·결과 확인 필요·취소), 단계별 결과, 화면 재확인, 결과 문서 위치를 확인합니다. actionId 가 없으면 이 대화의 최근 PC 작업 목록을 보여 줍니다.",
    argsHint: '{"actionId":"선택"}',
    permission: "auto",
    execute: async (bridge: AgentToolBridge, args: Record<string, unknown>, ctx: AgentToolContext) => formatPcControlObservation(await pcControl("app_action_status", { actionId: args.actionId ?? args.id }, ctx, bridge)),
  },
  {
    id: "pc.run",
    korLabel: "승인 대기 PC 작업 다시 묻기",
    korDescription: "승인함에 둔 이 대화의 PC 작업을 실행 확인 창으로 다시 묻고, 사용자가 실행을 고르면 실행합니다. 이미 끝난 작업은 다시 실행하지 않습니다.",
    argsHint: '{"actionId":"pc.request 결과의 작업 id"}',
    permission: "auto",
    timeoutMs: 15 * 60_000,
    execute: async (bridge: AgentToolBridge, args: Record<string, unknown>, ctx: AgentToolContext) => formatPcControlObservation(await pcControl("run_app_action", { actionId: args.actionId ?? args.id }, ctx, bridge)),
  },
  {
    id: "pc.cancel",
    korLabel: "PC 작업 취소",
    korDescription: "이 대화의 승인 대기 중인 PC 작업을 취소합니다. 실행 중이거나 끝난 작업은 취소하지 않습니다.",
    argsHint: '{"actionId":"작업 id"}',
    permission: "auto",
    execute: async (bridge: AgentToolBridge, args: Record<string, unknown>, ctx: AgentToolContext) => formatPcControlObservation(await pcControl("cancel_app_action", { actionId: args.actionId ?? args.id }, ctx, bridge)),
  },
];

/** 데스크톱 컴퓨터 조작 통로가 있을 때만 PC 도구를 더한다. 없는 기능을 부르게 하지 않는다. */
export function withPcControlTools(entries: AgentToolEntry[], bridge?: unknown): AgentToolEntry[] {
  if (!pcControlBridge(bridge)) return entries;
  const ids = new Set(entries.map((entry) => entry.id));
  return [...entries, ...pcControlAgentTools.filter((entry) => !ids.has(entry.id))];
}
