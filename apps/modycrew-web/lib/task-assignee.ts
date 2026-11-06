/**
 * 업무판 '업무 맡기기'의 담당 직원 고르기와, 승인함으로 이어지는 링크.
 *
 * - 담당을 비워 두면 기본 비서(모든 업무 종류를 맡는 조율자)가 한다. 데스크톱도 같은 규칙이다.
 * - 직원을 고르면 그 직원의 역할·지침이 실행 프롬프트와 역할 정보(roleContext)로 가고,
 *   맡은 업무 종류(workPackId)가 있으면 실행 기록이 그 직원 이름으로 남는다(agentRunContext).
 * - desktop-bridge 를 import 하지 않는다(구조적 타입만) — 단독 테스트가 이 파일만 옮겨 돌린다.
 */

export const masterOperatorTeammateId = "teammate-personal-operator";

export type TaskAssigneeOption = {
  id: string;
  name: string;
  roleTitle: string;
  brief: string;
  instructions: string[];
  templateId: string;
  workPackIds: string[];
};

type TaskLike = {
  id: string;
  status?: string;
  origin?: { kind?: string } | undefined;
  execution?: { state?: string; approvalCardId?: string } | undefined;
};

function textOf(value: unknown, max: number): string {
  return typeof value === "string" ? value.replace(/\s+/gu, " ").trim().slice(0, max) : "";
}

/** 앱 프로필(load_app_profile)의 직원 목록을 담당 고르기용으로 정리한다. 이상한 항목은 뺀다. */
export function normalizeTaskAssigneeRoster(profile: unknown): TaskAssigneeOption[] {
  const teammates = (profile as { teammates?: unknown } | null | undefined)?.teammates;
  if (!Array.isArray(teammates)) return [];
  const seen = new Set<string>();
  const roster: TaskAssigneeOption[] = [];
  for (const raw of teammates) {
    if (!raw || typeof raw !== "object") continue;
    const entry = raw as Record<string, unknown>;
    const id = textOf(entry.id, 120);
    const name = textOf(entry.name, 60);
    if (!id || !name || seen.has(id)) continue;
    seen.add(id);
    roster.push({
      id,
      name,
      roleTitle: textOf(entry.roleTitle, 120),
      brief: textOf(entry.brief, 300),
      instructions: Array.isArray(entry.instructions)
        ? entry.instructions.map((line) => textOf(line, 220)).filter(Boolean).slice(0, 12)
        : [],
      templateId: textOf(entry.templateId, 60),
      workPackIds: Array.isArray(entry.workPackIds)
        ? entry.workPackIds.map((line) => textOf(line, 60)).filter(Boolean).slice(0, 12)
        : [],
    });
  }
  return roster;
}

export function isMasterOperator(option: Pick<TaskAssigneeOption, "id" | "templateId"> | null | undefined): boolean {
  return !option || option.id === masterOperatorTeammateId || option.templateId === "personal";
}

function basePromptFor(option: TaskAssigneeOption): string {
  return [
    `당신은 ${option.name}${option.roleTitle ? `(${option.roleTitle})` : ""}입니다.${option.brief ? ` ${option.brief}` : ""}`,
    "맡은 일을 실제로 확인한 내용으로 처리하고 한국어로 답하세요.",
    option.instructions.length ? `[일하는 방식]\n${option.instructions.map((line) => `- ${line}`).join("\n")}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * 업무 실행 요청(runTask)에 붙일 담당 정보. 담당이 없거나 기본 비서면 빈 객체 —
 * 데스크톱이 기본 비서로 처리한다(오늘과 같은 도구 범위).
 */
export function buildAssignedTaskFields(
  option: TaskAssigneeOption | null | undefined,
  resolveWorkPackIds: (option: TaskAssigneeOption) => string[] = (entry) => entry.workPackIds,
) {
  if (!option) return {};
  if (isMasterOperator(option)) return { assigneeId: option.id, assigneeName: option.name };
  const workPackId = resolveWorkPackIds(option)[0] ?? "";
  return {
    assigneeId: option.id,
    assigneeName: option.name,
    basePrompt: basePromptFor(option),
    generation: {
      // 실행기는 매번 프롬프트를 새로 만든다. 여기서는 역할 정보만 넘긴다.
      prompt: "",
      roleContext: {
        teammateId: option.id,
        teammateName: option.name,
        roleTitle: option.roleTitle,
        brief: option.brief,
        instructions: option.instructions,
        templateId: option.templateId,
      },
      ...(workPackId
        ? {
            agentRunContext: {
              sourceTeammateId: masterOperatorTeammateId,
              targetTeammateId: option.id,
              workPackId,
            },
          }
        : {}),
    },
  };
}

/** 자동 점검이 승인함 카드를 업무판에 올린 일(`inbox:<카드 id>`). 다시 실행할 것이 아니라 승인함에서 처리한다. */
export function inboxCardIdForTask(task: TaskLike): string {
  if (task.id.startsWith("inbox:")) return task.id.slice("inbox:".length);
  return "";
}

/**
 * 이 일을 승인함에서 이어서 볼 주소. 없으면 빈 문자열.
 * 승인함에 카드가 실제로 올라간 일만 링크를 준다 — 메일과 무관한 '승인 필요'는 승인함에 아무것도 없으므로
 * 링크 대신 업무판의 안내 문장을 그대로 둔다(헛걸음 방지).
 */
export function taskApprovalHref(task: TaskLike): string {
  const cardId = task.execution?.approvalCardId || inboxCardIdForTask(task);
  if (cardId) return `/office/?preview=workbench&officeView=approval&focusFinalActionCard=${encodeURIComponent(cardId)}`;
  if (task.origin?.kind === "mail" && !task.execution) return "/office/?preview=workbench&officeView=approval";
  return "";
}
