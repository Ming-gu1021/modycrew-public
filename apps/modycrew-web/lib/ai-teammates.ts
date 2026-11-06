"use client";

import { getBuiltinExpert, restoreBuiltinExpert, buildBuiltinExpertPrompt } from "../../../packages/domain/dist/builtin-experts.js";
export { getBuiltinExpert } from "../../../packages/domain/dist/builtin-experts.js";

import {
  getDefaultCrewCharacterIdForRole,
  isCrewCharacterId,
  type CrewCharacterId,
} from "./crew-character-catalog";
import {
  modyWorkPackCatalog,
  resolveModyTeammateWorkPackIds,
} from "../../../packages/domain/dist/work-pack.js";

/** 업무 종류 정본은 도메인 카탈로그다. 화면은 그 목록만 보여준다. */
export const teammateWorkPackChoices = modyWorkPackCatalog.map((pack) => ({
  id: pack.id,
  title: pack.title,
  description: pack.description,
  categoryLabel: pack.categoryLabel,
}));

const knownWorkPackIds = new Set<string>(teammateWorkPackChoices.map((pack) => pack.id));

/**
 * 이 직원이 실제로 맡는 업무 종류. 템플릿 기본값과 따로 받은 범위를 합친 것으로,
 * 화면에 "이 직원이 하는 일"을 적을 때 쓴다. 판정은 데스크톱이 같은 규칙으로 한다.
 */
export function workPackIdsForTeammate(teammate: AITeammate): string[] {
  return resolveModyTeammateWorkPackIds({
    templateId: teammate.templateId,
    workPackIds: teammate.workPackIds ?? [],
  });
}

/**
 * 템플릿을 고르면 기본으로 딸려 오는 업무 종류. 직원 만들기 화면이 여기서 시작해
 * 사용자가 더하거나 뺀다. 만들기는 항상 custom 으로 저장되므로, 이 값을 명시로
 * 남기지 않으면 템플릿을 골라도 아무 일도 못 맡는다.
 */
export function defaultWorkPackIdsForTemplate(templateId: AITeammateTeam): string[] {
  return resolveModyTeammateWorkPackIds({ templateId });
}

export type AITeammateTeam =
  | "operations"
  | "mail"
  | "desktop"
  | "marketing"
  | "development"
  | "finance"
  | "legal"
  | "personal"
  | "custom";

export type AITeammateTemplate = {
  id: AITeammateTeam;
  teamLabel: string;
  defaultName: string;
  roleTitle: string;
  channelName: string;
  brief: string;
  defaultSkillIds: string[];
  defaultInstructions: string[];
};

export type AITeammate = {
  id: string;
  builtinExpertId?: string;
  promptVersion?: string;
  templateId: AITeammateTeam;
  avatarId: CrewCharacterId;
  name: string;
  teamLabel: string;
  roleTitle: string;
  channelName: string;
  brief: string;
  skillIds: string[];
  /**
   * 이 직원이 맡기로 한 업무 종류. 템플릿이 있는 직원은 템플릿 기본값이 따로 있고,
   * 사용자가 만든 직원은 **여기 적힌 것만** 맡는다 — 비어 있으면 어떤 업무도
   * 배정받지 못한다. 실제 배정 판정은 데스크톱이 하며, 두 곳이 어긋나지 않도록
   * tests/domain/teammate-work-pack-authority.test.mjs 가 지킨다.
   */
  workPackIds?: string[];
  instructions: string[];
  originProposalId?: string;
  createdAt: number;
  updatedAt: number;
};

export type RoleChannelOrchestrationCard = {
  teammateId: string;
  label: string;
  roleTitle: string;
  channelName: string;
  stateLabel: string;
  commandHint: string;
  memoryPath: string;
  workLogPath: string;
  decisionLogPath: string;
  officeRoute: string;
  steps: Array<{
    label: string;
    detail: string;
  }>;
};

export type AITeammateRuntimeAssignment = {
  contract: "role_assignment_runtime_v1";
  summary: string;
  setupLine: string;
  runtimeLine: string;
  approvalLine: string;
  memoryLine: string;
  nextActions: string[];
};

const storageKey = "modycrew-ai-teammates-v1";
export const defaultAITeammateId = "teammate-personal-operator";

export const aiTeammateTemplates: AITeammateTemplate[] = [
  {
    id: "personal",
    teamLabel: "Control",
    defaultName: "업무 비서",
    roleTitle: "개인 업무 조율",
    channelName: "개인 작업장",
    brief: "사용자의 요청을 가장 먼저 받아 연결, 자료, 자동화 후보로 정리합니다.",
    defaultSkillIds: ["portable_memory", "work_pattern_learning", "connector_discovery", "parallel_team_routing", "skill_bridge_orchestrator"],
    defaultInstructions: [
      "사용자가 무엇을 원하는지 먼저 정리하고 필요한 연결을 채팅 안에서 안내합니다.",
      "비밀번호, 토큰, 외부 계정 정보는 채팅에 쓰게 하지 않고 보관함으로 안내합니다.",
      "여러 팀원에게 나눌 수 있는 일은 역할별로 분리해서 제안합니다.",
    ],
  },
  {
    id: "operations",
    teamLabel: "Operations",
    defaultName: "운영 담당",
    roleTitle: "운영·고객 문의",
    channelName: "운영 관리",
    brief: "메일, 문의, 일정, 반복 확인 업무를 읽고 승인 가능한 실행 후보로 정리합니다.",
    defaultSkillIds: ["connector_discovery", "work_pattern_learning", "approval_guard"],
    defaultInstructions: [
      "받은 메일과 문의를 업무 단위로 분리하고 우선순위를 붙입니다.",
      "외부 발송, 일정 등록, 삭제, 결제는 항상 사용자 승인 전에는 실행하지 않습니다.",
      "반복되는 운영 업무는 반복 업무 후보로 정리합니다.",
    ],
  },
  {
    id: "mail",
    teamLabel: "MailOps",
    defaultName: "메일 업무 담당자",
    roleTitle: "메일·일정 자동화",
    channelName: "메일 업무실",
    brief: "메일함, 문의, 답장 초안, 일정 후보, 발송 전 승인 흐름을 전담합니다.",
    defaultSkillIds: ["mail_calendar_operator", "connector_discovery", "work_pattern_learning", "approval_guard"],
    defaultInstructions: [
      "메일과 문의는 광고, 공지, 답장 필요, 일정 후보, 확인 필요로 분리합니다.",
      "답장 발송과 일정 등록은 초안과 승인 후보까지만 만들고 사용자 최종 승인 전 실행하지 않습니다.",
      "메일 말투, 자주 쓰는 답장 기준, 일정 조율 기준은 이 채널의 기억에 따로 저장합니다.",
    ],
  },
  {
    id: "desktop",
    teamLabel: "Desktop",
    defaultName: "바탕화면 관리자",
    roleTitle: "파일·바탕화면 정리",
    channelName: "파일 정리실",
    brief: "바탕화면, 다운로드, 문서 폴더의 정리 기준을 학습하고 실행 전 검토 후보를 만듭니다.",
    defaultSkillIds: ["folder_organizer", "computer_use_operator", "document_context", "work_pattern_learning", "approval_guard"],
    defaultInstructions: [
      "정리 전에는 현재 구조와 사용자가 정한 분류 기준을 먼저 읽습니다.",
      "파일 이동, 삭제, 덮어쓰기는 실행 전 검토와 오피스 승인 전에는 실행하지 않습니다.",
      "바탕화면과 폴더별 정리 기준은 이 팀원의 업무 방식 기억, 업무 기록, 결정 기록에 따로 남깁니다.",
    ],
  },
  {
    id: "marketing",
    teamLabel: "Growth",
    defaultName: "마케팅 담당",
    roleTitle: "홍보·콘텐츠",
    channelName: "홍보 마케팅",
    brief: "뉴스, SNS, 캠페인, 고객 반응을 정리하고 콘텐츠 초안과 실험안을 만듭니다.",
    defaultSkillIds: ["document_context", "work_pattern_learning"],
    defaultInstructions: [
      "캠페인 목표, 대상, 채널, CTA를 먼저 분리합니다.",
      "콘텐츠 초안은 바로 쓸 수 있게 짧은 버전과 상세 버전을 함께 제안합니다.",
      "성과 판단이 필요한 경우 지표와 다음 실험을 같이 정리합니다.",
    ],
  },
  {
    id: "development",
    teamLabel: "Product",
    defaultName: "개발 담당",
    roleTitle: "제품·기술",
    channelName: "개발 작업실",
    brief: "기능 요구사항, 버그, 자동화 도구, 릴리즈 준비를 기술 작업으로 분리합니다.",
    defaultSkillIds: ["document_context", "parallel_team_routing", "approval_guard", "skill_bridge_orchestrator"],
    defaultInstructions: [
      "기능 요청은 사용자 흐름, 데이터 흐름, 검증 방법으로 나눕니다.",
      "코드 변경이 필요한 일은 위험도와 테스트 범위를 먼저 밝힙니다.",
      "배포나 삭제처럼 되돌리기 어려운 일은 사용자 확인 전 실행하지 않습니다.",
    ],
  },
  {
    id: "finance",
    teamLabel: "Finance",
    defaultName: "재무 담당",
    roleTitle: "정산·비용",
    channelName: "재무 검토",
    brief: "정산 파일, 청구, 비용, 입출금 확인을 표와 근거 중심으로 정리합니다.",
    defaultSkillIds: ["document_context", "approval_guard", "portable_memory"],
    defaultInstructions: [
      "숫자는 원본 출처와 계산 기준을 분리해서 표시합니다.",
      "세무, 계약, 공공기관 제출은 조언이 아니라 확인 필요 항목으로 다룹니다.",
      "불확실한 금액은 추정으로 표시하고 확정처럼 쓰지 않습니다.",
    ],
  },
  {
    id: "legal",
    teamLabel: "Legal",
    defaultName: "검토 담당",
    roleTitle: "계약·정책 검토",
    channelName: "계약 검토",
    brief: "계약, 약관, 정책, 공공기관 문서를 리스크와 확인 질문 중심으로 정리합니다.",
    defaultSkillIds: ["document_context", "approval_guard", "portable_memory"],
    defaultInstructions: [
      "법률 판단을 확정하지 말고 리스크, 질문, 확인 자료로 분리합니다.",
      "사용자 승인 없이 외부 제출, 신고, 계약 변경을 실행하지 않습니다.",
      "중요 문서는 원문 근거와 확인 필요 문장을 함께 남깁니다.",
    ],
  },
  {
    id: "custom",
    teamLabel: "직접 만든 담당자",
    defaultName: "새 팀원",
    roleTitle: "사용자 지정 역할",
    channelName: "사용자 지정 대화",
    brief: "사용자가 정한 성향, 직업, 업무 범위에 맞춰 독립된 AI 팀원으로 일합니다.",
    defaultSkillIds: ["portable_memory", "work_pattern_learning", "skill_bridge_orchestrator"],
    defaultInstructions: [
      "성향과 성격은 사용자가 적은 기준을 우선합니다.",
      "역할이 모호하면 먼저 목표, 결과, 승인 기준을 짧게 확인합니다.",
      "필요한 외부 계정이나 비밀번호는 채팅이 아니라 보관함으로 안내합니다.",
    ],
  },
];

export function readAITeammates(): AITeammate[] {
  if (typeof window === "undefined") return [createDefaultAITeammate()];
  try {
    const raw = window.localStorage.getItem(storageKey);
    const parsed = raw ? JSON.parse(raw) : null;
    if (!Array.isArray(parsed)) return [createDefaultAITeammate()];
    const teammates = parsed.map(sanitizeAITeammate).filter(Boolean) as AITeammate[];
    return ensureDefaultAITeammate(teammates);
  } catch {
    return [createDefaultAITeammate()];
  }
}

export function saveAITeammates(teammates: AITeammate[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(storageKey, JSON.stringify(normalizeAITeammates(teammates)));
}

export function normalizeAITeammates(value: unknown): AITeammate[] {
  if (!Array.isArray(value)) return [createDefaultAITeammate()];
  return ensureDefaultAITeammate(value.map(sanitizeAITeammate).filter(Boolean) as AITeammate[]);
}

export function createAITeammateFromTemplate(templateId: AITeammateTeam): AITeammate {
  const template = aiTeammateTemplates.find((item) => item.id === templateId) ?? aiTeammateTemplates[0];
  const now = Date.now();
  return {
    id: `teammate-${template.id}-${now}`,
    templateId: template.id,
    avatarId: getDefaultAvatarId(template),
    name: template.defaultName,
    teamLabel: template.teamLabel,
    roleTitle: template.roleTitle,
    channelName: template.channelName,
    brief: template.brief,
    skillIds: [...template.defaultSkillIds],
    instructions: [...template.defaultInstructions],
    createdAt: now,
    updatedAt: now,
  };
}

export function createDefaultAITeammate(): AITeammate {
  const template = aiTeammateTemplates[0];
  return restoreBuiltinExpert({
    ...createAITeammateFromTemplate(template.id),
    id: defaultAITeammateId,
    createdAt: 1,
    updatedAt: 1,
  });
}

export function buildAITeammatePromptContext(teammate: AITeammate) {
  teammate = restoreBuiltinExpert(teammate);
  const builtinExpertPrompt = buildBuiltinExpertPrompt(teammate);
  // 기본 전문가의 업무 절차 5줄은 아래 고정 지침 블록에 이미 들어 있다. 같은 줄을 '성향/성격'으로 한 번 더 넣지 않는다.
  const personalityRules = builtinExpertPrompt
    ? []
    : teammate.instructions
        .map((item) => item.replace(/\s+/g, " ").trim())
        .filter(Boolean);
  return [
    "[현재 AI 팀원]",
    `이름: ${teammate.name}`,
    `팀: ${teammate.teamLabel}`,
    `역할: ${teammate.roleTitle}`,
    `채널: ${teammate.channelName}`,
    `업무 범위: ${teammate.brief}`,
    `스킬: ${teammate.skillIds.join(", ") || "기본"}`,
    "",
    "[역할/성향 고정 기준]",
    "이 채널에서는 아래 기준을 기본 성격과 일하는 방식으로 우선 적용합니다.",
    `- 핵심 역할: ${teammate.roleTitle}`,
    `- 맡는 일: ${teammate.brief}`,
    ...personalityRules.map((item) => `- 성향/성격: ${item}`),
    "",
    "[운영 지침]",
    builtinExpertPrompt
      ? "- 기본 전문가의 지침은 고정됩니다. 업무 자료와 선호는 참고하되 역할과 품질 기준을 바꾸지 않습니다."
      : "- 사용자가 새 기준을 주면 이 팀원의 업무 방식과 답변 기준 기억에 반영할 후보로 남깁니다.",
    ...(builtinExpertPrompt ? [builtinExpertPrompt] : []),
    "- 외부 발송, 일정 등록, 삭제, 결제, 제출은 사용자가 최종 승인하기 전 실행하지 않습니다.",
    "- 비밀번호, 인증값, 직접 연결 키 원문은 채팅에 쓰게 하지 않고 보관함 또는 계정 동의 연결로 안내합니다.",
  ].join("\n");
}

export function buildAITeammateRuntimeAssignment(teammate: AITeammate): AITeammateRuntimeAssignment {
  const primarySkill = teammate.skillIds[0] || "기본 대화";
  return {
    contract: "role_assignment_runtime_v1",
    summary: `${teammate.name} · ${teammate.roleTitle} · ${teammate.channelName}`,
    setupLine: `${teammate.teamLabel} 역할로 ${teammate.brief}`,
    runtimeLine: `대화 생성 시 ${teammate.name}의 역할, 업무 범위, 성향 기준을 먼저 주입합니다.`,
    approvalLine: "외부 발송, 일정 등록, 파일 변경, 공유, 삭제는 오피스 승인 전까지 실행하지 않습니다.",
    memoryLine: `memory/crew-souls/${teammate.id}/CrewSoul.md · WorkLog.md · DecisionLog.md`,
    nextActions: [
      `${teammate.channelName}에서 한 줄로 맡기기`,
      `${primarySkill} 업무 도구 확인`,
      "오피스 승인함에서 실행 후보 확인",
    ],
  };
}

export function buildRoleChannelOrchestrationPlaybook(teammates: AITeammate[]): RoleChannelOrchestrationCard[] {
  return ensureDefaultAITeammate(teammates)
    .slice(0, 8)
    .map((teammate) => {
      const memoryPath = `memory/crew-souls/${teammate.id}/CrewSoul.md`;
      const workLogPath = `memory/crew-souls/${teammate.id}/WorkLog.md`;
      const decisionLogPath = `memory/crew-souls/${teammate.id}/DecisionLog.md`;
      return {
        teammateId: teammate.id,
        label: teammate.name,
        roleTitle: teammate.roleTitle,
        channelName: teammate.channelName,
        stateLabel: teammate.id === defaultAITeammateId ? "메인 컨트롤" : "역할",
        commandHint:
          teammate.id === defaultAITeammateId
            ? "메인 컨트롤은 요청을 받아 어떤 AI 팀원에게 나눌지 판단합니다."
            : `메인 컨트롤에서 "${teammate.channelName}에게 맡겨줘"처럼 말하면 이 팀원에게 위임됩니다.`,
        memoryPath,
        workLogPath,
        decisionLogPath,
        officeRoute: "업무 오피스에서 담당 AI 팀원, 진행 상태, 승인 대기, 결과를 함께 표시",
        steps: [
          {
            label: "명령 수신",
            detail: teammate.id === defaultAITeammateId ? "사용자 요청을 메인 컨트롤이 먼저 받습니다." : `${teammate.roleTitle} 관점으로 업무를 받습니다.`,
          },
          {
            label: "업무 방식",
            detail: `AI 팀원 업무 방식 기준: ${memoryPath}`,
          },
          {
            label: "작업 로그",
            detail: `업무 기록과 결정 기록에 위임 이유와 결과를 분리 저장합니다.`,
          },
          {
            label: "오피스 확인",
            detail: "진행 중, 승인 필요, 결과 준비 상태를 오피스에서 확인합니다.",
          },
        ],
      };
    });
}

function ensureDefaultAITeammate(teammates: AITeammate[]) {
  const sanitized = teammates.filter(Boolean);
  if (sanitized.some((teammate) => teammate.id === defaultAITeammateId)) return sanitized;
  return [createDefaultAITeammate(), ...sanitized];
}

function sanitizeAITeammate(value: unknown): AITeammate | null {
  if (!value || typeof value !== "object") return null;
  const item = restoreBuiltinExpert(value as Partial<AITeammate>);
  const template = aiTeammateTemplates.find((candidate) => candidate.id === item.templateId) ?? aiTeammateTemplates[0];
  const name = sanitizeText(item.name, template.defaultName, 32);
  const roleTitle = sanitizeText(item.roleTitle, template.roleTitle, 48);
  const originProposalId = sanitizeOptionalOpaqueId(item.originProposalId, 240);
  return {
    id: sanitizeText(item.id, `teammate-${template.id}-${Date.now()}`, 80),
    ...(getBuiltinExpert(item) ? { builtinExpertId: getBuiltinExpert(item)!.id, promptVersion: item.promptVersion } : {}),
    templateId: template.id,
    avatarId: sanitizeAvatarId(item.avatarId, template, roleTitle),
    name,
    teamLabel: sanitizeText(item.teamLabel, template.teamLabel, 28),
    roleTitle,
    channelName: sanitizeText(item.channelName, template.channelName, 42),
    brief: sanitizeText(item.brief, template.brief, 180),
    skillIds: Array.isArray(item.skillIds)
      ? item.skillIds.map((line) => sanitizeText(line, "", 64)).filter(Boolean).slice(0, 16)
      : [...template.defaultSkillIds],
    workPackIds: sanitizeTeammateWorkPackIds(item.workPackIds),
    instructions: Array.isArray(item.instructions)
      ? item.instructions.map((line) => sanitizeText(line, "", 160)).filter(Boolean).slice(0, 8)
      : [...template.defaultInstructions],
    ...(originProposalId ? { originProposalId } : {}),
    createdAt: Number.isFinite(item.createdAt) ? Number(item.createdAt) : Date.now(),
    updatedAt: Number.isFinite(item.updatedAt) ? Number(item.updatedAt) : Date.now(),
  };
}

function getDefaultAvatarId(template: AITeammateTemplate, roleTitle = template.roleTitle): CrewCharacterId {
  return getDefaultCrewCharacterIdForRole(`${template.id} ${roleTitle}`);
}

/**
 * 저장된 값에서 아는 업무 종류만 남긴다. 데스크톱도 같은 목록으로 다시 거르므로
 * 여기서 통과해도 실행 권한이 되지는 않는다 — 화면이 거짓말하지 않게 하려는 것이다.
 */
function sanitizeTeammateWorkPackIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value
        .map((workPackId) => sanitizeText(workPackId, "", 60))
        .filter((workPackId) => knownWorkPackIds.has(workPackId)),
    ),
  ].sort();
}

function sanitizeAvatarId(
  value: unknown,
  template: AITeammateTemplate,
  roleTitle: string,
): CrewCharacterId {
  return isCrewCharacterId(value) ? value : getDefaultAvatarId(template, roleTitle);
}

function sanitizeText(value: unknown, fallback: string, maxLength: number) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
  return text || fallback;
}

function sanitizeOptionalOpaqueId(value: unknown, maxLength: number) {
  const text = sanitizeText(value, "", maxLength);
  return /^[A-Za-z0-9][A-Za-z0-9._:-]*$/u.test(text) ? text : "";
}
