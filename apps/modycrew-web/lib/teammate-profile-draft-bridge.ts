/**
 * 직원 프로필 초안(도메인) → 웹 생성 모델/자동화 초안 변환 브리지.
 *
 * 도메인 합성기(packages/domain teammate-profile-draft)는 웹 레이어를 모르므로,
 * 스킬 매핑(ai-skills recommendedTeam)과 자동화 draft 입력 변환은 여기서 담당합니다.
 * page.tsx 는 이 브리지의 순수 함수만 호출해 얇게 유지합니다.
 */

import { aiTeammateTemplates, type AITeammateTeam } from "./ai-teammates";
import type { AISkillPack } from "./ai-skills";
import type { LocalAutomationDraftInput, LocalAutomationProvenance } from "./local-automation-drafts";

export type AgentBlueprintLike = {
  schemaVersion: number;
  connectionRequirements: Array<{
    connectorId: string;
    label: string;
    requiredFor: "dry_run" | "live_operation";
    appHandledSteps: string[];
    userOnlySteps: Array<{
      kind: string;
      when: "only_if_runtime_requires";
      label: string;
      reason: string;
    }>;
    secretEntryAllowedInChat: false;
  }>;
  setupSummary: {
    appHandledLabels: string[];
    userOnlyLabels: string[];
    nextUserAction: string;
  };
  executionPolicy: {
    dryRun: {
      requiredSuccessfulRuns: number;
      externalMutation: false;
    };
    activation: {
      startsEnabled: false;
      requiresUserApproval: true;
    };
  };
  safety: {
    selectedSourceScopeOnly: true;
    rawSecretMaterialVisibleToAgent: false;
    externalMutation: false;
  };
};

/** 도메인 초안의 최소 구조적 형태 — domain dist 타입과 1:1 (import 없이 구조적 수용) */
export type TeammateProfileDraftLike = {
  id: string;
  createdAt: string;
  suggestedTemplateId: "operations" | "mail" | "finance" | "legal" | "desktop" | "custom";
  name: string;
  teamLabel: string;
  roleTitle: string;
  channelName: string;
  brief: string;
  instructions: string[];
  agentBlueprint?: AgentBlueprintLike;
  automationRecommendations: Array<{
    id: string;
    workPackId: string;
    title: string;
    confidence: number;
    reason: string;
    sourceLabels: string[];
    suggestedRuleLabel: string;
    outputPlan: {
      kind: string;
      label: string;
      draftTarget: string;
      handoffLabel: string;
      approvalGateLabel: string;
      nextUserAction: string;
    };
  }>;
  evidence: {
    styleProfileName: string;
    topCategories: Array<{ category: string; label: string; weight: number }>;
    sourceFileLabels: string[];
  };
};

export type AgentBlueprintUserPlan = {
  appHandledLabels: string[];
  userOnlyLabels: string[];
  connectionCount: number;
  dryRunCount: number;
};

export function getAgentBlueprintUserPlan(
  draft: TeammateProfileDraftLike,
): AgentBlueprintUserPlan {
  const blueprint = draft.agentBlueprint;
  if (!blueprint) {
    return {
      appHandledLabels: ["직원 역할·업무 기억·꺼진 자동화 준비"],
      userOnlyLabels: [],
      connectionCount: 0,
      dryRunCount: 0,
    };
  }
  return {
    appHandledLabels: blueprint.setupSummary.appHandledLabels.slice(0, 3),
    userOnlyLabels: blueprint.setupSummary.userOnlyLabels.slice(0, 4),
    connectionCount: blueprint.connectionRequirements.filter(
      (requirement) => requirement.connectorId !== "local-folder",
    ).length,
    dryRunCount: blueprint.executionPolicy.dryRun.requiredSuccessfulRuns,
  };
}

export type TeammateCreationModel = {
  templateId: AITeammateTeam;
  overrides: {
    name: string;
    teamLabel: string;
    roleTitle: string;
    channelName: string;
    brief: string;
    instructions: string[];
    skillIds: string[];
  };
};

/** 초안 → createTeammateChannel 에 먹일 생성 모델 (스킬 = 템플릿 기본 ∪ recommendedTeam 일치, 캡 16) */
export function toTeammateCreationModel(
  draft: TeammateProfileDraftLike,
  skills: AISkillPack[],
): TeammateCreationModel {
  const templateId = draft.suggestedTemplateId as AITeammateTeam;
  const template = aiTeammateTemplates.find((candidate) => candidate.id === templateId);
  const recommendedSkillIds = skills
    .filter((skill) => skill.recommendedTeam === templateId)
    .map((skill) => skill.id);
  const skillIds = [...new Set([...(template?.defaultSkillIds ?? []), ...recommendedSkillIds])].slice(0, 16);
  return {
    templateId,
    overrides: {
      name: draft.name,
      teamLabel: draft.teamLabel,
      roleTitle: draft.roleTitle,
      channelName: draft.channelName,
      brief: draft.brief,
      instructions: draft.instructions.slice(0, 8),
      skillIds,
    },
  };
}

const workPackConnectorHints: Record<string, { ids: string[]; labels: string[] }> = {
  inquiry_response: { ids: ["company-mail"], labels: ["회사 메일"] },
  schedule_coordination: { ids: ["google-calendar"], labels: ["구글 캘린더"] },
  report_cleanup: { ids: [], labels: ["로컬 문서"] },
  inventory_reorder: { ids: [], labels: ["로컬 표"] },
  tax_contract_archive: { ids: [], labels: ["로컬 문서"] },
};

/** 초안의 자동화 추천 → 로컬 자동화 draft 입력(직원 귀속 provenance 포함, 전부 기본 꺼짐 저장용) */
export function toAutomationDraftInputs(
  draft: TeammateProfileDraftLike,
  teammateId: string,
): LocalAutomationDraftInput[] {
  return draft.automationRecommendations.map((recommendation) => {
    const hints = workPackConnectorHints[recommendation.workPackId] ?? { ids: [], labels: [] };
    const provenance: LocalAutomationProvenance = {
      source: "document_learning_recommendation",
      sourceLabel: draft.evidence.styleProfileName || "문서 학습",
      intent: recommendation.suggestedRuleLabel,
      evidenceLabels: recommendation.sourceLabels.slice(0, 5),
      confidencePercent: Math.round(recommendation.confidence * 100),
      capturedAt: draft.createdAt,
      teammateId,
    };
    return {
      title: recommendation.suggestedRuleLabel,
      goal: `${recommendation.reason} ${recommendation.outputPlan.draftTarget}`.trim(),
      trigger: recommendation.outputPlan.handoffLabel,
      output: `${recommendation.outputPlan.label} → 오피스 승인함`,
      approval: recommendation.outputPlan.approvalGateLabel,
      connectorIds: hints.ids,
      connectorLabels: hints.labels,
      provenance,
    };
  });
}

/** 승인 카드에 보여줄 요약(이름/역할/근거/자동화 수) */
export function summarizeTeammateProfileDraft(draft: TeammateProfileDraftLike): string {
  const userPlan = getAgentBlueprintUserPlan(draft);
  const categories = draft.evidence.topCategories
    .slice(0, 3)
    .map((entry) => entry.label)
    .join("·");
  return [
    `이름: ${draft.name} / 역할: ${draft.roleTitle}`,
    categories ? `근거 자료: ${categories}` : "",
    `추천 자동화 ${draft.automationRecommendations.length}건 — 전부 기본 꺼짐으로 저장됩니다.`,
    draft.agentBlueprint ? `앱이 준비: ${userPlan.appHandledLabels.join(" · ")}` : "",
    draft.agentBlueprint
      ? `본인 확인: ${userPlan.userOnlyLabels.length ? userPlan.userOnlyLabels.join(" · ") : "현재 없음"}`
      : "",
    userPlan.dryRunCount
      ? `첫 ${userPlan.dryRunCount}회는 외부 발송·등록·원본 변경 없이 연습하고, 통과 후에도 활성화는 승인받습니다.`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}
