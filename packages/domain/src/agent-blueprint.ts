/**
 * 자료 학습 결과를 실제 AI 직원 생성·연결·연습 실행에 사용할 버전된 설계도로 바꿉니다.
 * Blueprint에는 파일 절대경로, 비밀번호, token 원문을 넣지 않습니다.
 */

import {
  ModyCapabilityGrantGate,
  type ModyCapabilityGrantDecision,
  type ModyCapabilityGrantRequest,
  type ModyUserOnlyActionKind,
} from "./capability-grant.js";
import type { ModyDocumentAutomationRecommendation } from "./document-automation-recommendation.js";
import type { ModyDocumentLearningPlan } from "./local-document-learning.js";
import {
  findModyWorkPack,
  type ModyWorkPackFeatureId,
  type ModyWorkPackId,
} from "./work-pack.js";

export const modyAgentBlueprintSchemaVersion = 1 as const;

export type ModyAgentBlueprintIdentity = {
  name: string;
  teamLabel: string;
  roleTitle: string;
  brief: string;
  instructions: string[];
};

export type ModyAgentConnectionAppStep =
  | "validate_selected_scope"
  | "discover_existing_connection"
  | "select_supported_method"
  | "prepare_connection"
  | "open_user_step"
  | "prepare_index"
  | "verify_health";

export type ModyAgentConnectionUserStep = {
  kind: ModyUserOnlyActionKind;
  when: "only_if_runtime_requires";
  label: string;
  reason: string;
};

export type ModyAgentConnectionRequirement = {
  id: string;
  connectorId: string;
  label: string;
  purpose: string;
  setupHref: string;
  requiredFor: "dry_run" | "live_operation";
  role: "primary" | "optional";
  mode: "selected_local_scope" | "oauth_or_supported_login" | "guided_supported_setup";
  appHandledSteps: ModyAgentConnectionAppStep[];
  userOnlySteps: ModyAgentConnectionUserStep[];
  runtimeEscalationKinds: ModyUserOnlyActionKind[];
  secretEntryAllowedInChat: false;
};

export type ModyAgentBlueprintGoal = {
  id: string;
  label: string;
  expectedOutput: string;
  recommendationId?: string;
  workPackId?: ModyWorkPackId;
};

export type ModyAgentSuccessCriterion = {
  id: "selected-source-scope" | "reviewable-output" | "approval-boundary";
  label: string;
  proof: string;
};

export type ModyAgentBlueprint = {
  schemaVersion: typeof modyAgentBlueprintSchemaVersion;
  id: string;
  createdAt: string;
  source: {
    kind: "document_learning";
    referenceId: string;
    teammateDraftId: string;
    workspaceId: string;
    selectedFileIds: string[];
  };
  identity: ModyAgentBlueprintIdentity;
  goals: ModyAgentBlueprintGoal[];
  requiredFeatureIds: ModyWorkPackFeatureId[];
  connectionRequirements: ModyAgentConnectionRequirement[];
  capabilityGrants: ModyCapabilityGrantDecision[];
  setupSummary: {
    appHandledLabels: string[];
    userOnlyLabels: string[];
    nextUserAction: string;
  };
  toolProvisioningPolicy: {
    catalogOnly: true;
    allowedInstallModes: ["bundled", "portable_user_space", "project_local"];
    arbitraryCommandAllowed: false;
    appMayPrepare: true;
    userActionOnlyFor: ["admin_consent", "license_or_payment", "os_permission"];
  };
  executionPolicy: {
    dryRun: {
      mode: "read_and_draft_only";
      requiredSuccessfulRuns: 3;
      requiresAllSuccessCriteria: true;
      externalMutation: false;
    };
    activation: {
      startsEnabled: false;
      requiresUserApproval: true;
    };
  };
  successCriteria: ModyAgentSuccessCriterion[];
  safety: {
    selectedSourceScopeOnly: true;
    rawSecretMaterialVisibleToAgent: false;
    externalMutation: false;
  };
};

export type CreateAgentBlueprintFromDocumentLearningInput = {
  teammateDraftId: string;
  createdAt: string;
  identity: ModyAgentBlueprintIdentity;
  learningPlan: ModyDocumentLearningPlan;
  recommendations: readonly ModyDocumentAutomationRecommendation[];
};

export function createAgentBlueprintFromDocumentLearning(
  input: CreateAgentBlueprintFromDocumentLearningInput,
): ModyAgentBlueprint {
  const selectedFileIds = input.learningPlan.filePlans.map((file) => file.id).filter(Boolean);
  const goals = createGoals(input.recommendations);
  const requiredFeatureIds = unique([
    "document_learning" as ModyWorkPackFeatureId,
    ...input.recommendations.flatMap((recommendation) => recommendation.requiredFeatureIds),
  ]);
  const connectionRequirements = createConnectionRequirements(input.recommendations, selectedFileIds.length > 0);
  const grantGate = new ModyCapabilityGrantGate();
  const agentId = `agent-for-${input.teammateDraftId}`;
  const capabilityGrants = createCapabilityGrantRequests({
    agentId,
    workspaceId: input.learningPlan.workspaceId,
    createdAt: input.createdAt,
    selectedFileIds,
    connectionRequirements,
  }).map((request) => grantGate.evaluate(request));
  const userOnlyLabels = unique(
    connectionRequirements.flatMap((requirement) => requirement.userOnlySteps.map((step) => step.label)),
  );

  return {
    schemaVersion: modyAgentBlueprintSchemaVersion,
    id: `agent-blueprint-${input.learningPlan.sessionId}`,
    createdAt: input.createdAt,
    source: {
      kind: "document_learning",
      referenceId: input.learningPlan.sessionId,
      teammateDraftId: input.teammateDraftId,
      workspaceId: input.learningPlan.workspaceId,
      selectedFileIds,
    },
    identity: { ...input.identity, instructions: input.identity.instructions.slice(0, 8) },
    goals,
    requiredFeatureIds,
    connectionRequirements,
    capabilityGrants,
    setupSummary: {
      appHandledLabels: [
        "선택한 자료 범위와 기존 연결 확인",
        "지원되는 연결 방식과 필요한 기능 준비",
        "연결 상태 점검과 외부 변경 없는 연습 실행",
      ],
      userOnlyLabels,
      nextUserAction: userOnlyLabels.length
        ? "로그인·권한 동의가 실제로 필요한 순간에만 한 단계씩 요청합니다."
        : "지금 사용자가 추가로 설정할 일은 없습니다.",
    },
    toolProvisioningPolicy: {
      catalogOnly: true,
      allowedInstallModes: ["bundled", "portable_user_space", "project_local"],
      arbitraryCommandAllowed: false,
      appMayPrepare: true,
      userActionOnlyFor: ["admin_consent", "license_or_payment", "os_permission"],
    },
    executionPolicy: {
      dryRun: {
        mode: "read_and_draft_only",
        requiredSuccessfulRuns: 3,
        requiresAllSuccessCriteria: true,
        externalMutation: false,
      },
      activation: { startsEnabled: false, requiresUserApproval: true },
    },
    successCriteria: [
      {
        id: "selected-source-scope",
        label: "선택한 자료만 사용",
        proof: "실행 기록의 source ID가 사용자가 고른 자료 ID 안에 있습니다.",
      },
      {
        id: "reviewable-output",
        label: "검토 가능한 결과",
        proof: "자료 근거가 붙은 초안 또는 확인 목록이 생성됩니다.",
      },
      {
        id: "approval-boundary",
        label: "승인 전 외부 변경 없음",
        proof: "발송·일정 등록·원본 파일 변경·외부 공유가 0건입니다.",
      },
    ],
    safety: {
      selectedSourceScopeOnly: true,
      rawSecretMaterialVisibleToAgent: false,
      externalMutation: false,
    },
  };
}

function createGoals(
  recommendations: readonly ModyDocumentAutomationRecommendation[],
): ModyAgentBlueprintGoal[] {
  if (recommendations.length === 0) {
    return [{
      id: "goal-document-learning",
      label: "선택한 자료에서 반복 업무 후보 찾기",
      expectedOutput: "자료 근거가 붙은 업무 요약과 검토 가능한 초안",
    }];
  }
  return recommendations.map((recommendation) => ({
    id: `goal-${recommendation.id}`,
    recommendationId: recommendation.id,
    workPackId: recommendation.workPackId,
    label: recommendation.suggestedRuleLabel,
    expectedOutput: recommendation.outputPlan.draftTarget,
  }));
}

function createConnectionRequirements(
  recommendations: readonly ModyDocumentAutomationRecommendation[],
  hasSelectedFiles: boolean,
): ModyAgentConnectionRequirement[] {
  const requirements: ModyAgentConnectionRequirement[] = [{
    id: "agent-connection-local-folder",
    connectorId: "local-folder",
    label: "선택한 업무 자료",
    purpose: "사용자가 고른 파일과 폴더 범위 안에서만 읽고 업무 기억을 만듭니다.",
    setupHref: "/learn",
    requiredFor: "dry_run",
    role: "primary",
    mode: "selected_local_scope",
    appHandledSteps: ["validate_selected_scope", "prepare_index", "verify_health"],
    userOnlySteps: hasSelectedFiles ? [] : [{
      kind: "os_permission",
      when: "only_if_runtime_requires",
      label: "업무 자료 선택",
      reason: "어떤 자료를 읽어도 되는지는 사용자만 정할 수 있습니다.",
    }],
    runtimeEscalationKinds: ["os_permission"],
    secretEntryAllowedInChat: false,
  }];

  for (const recommendation of recommendations) {
    const pack = findModyWorkPack(recommendation.workPackId);
    if (!pack) continue;
    for (const connector of pack.connectorRequirements) {
      if (connector.connectorId === "local-folder") continue;
      requirements.push({
        id: `agent-connection-${safeId(connector.connectorId)}`,
        connectorId: connector.connectorId,
        label: connector.label,
        purpose: connector.purpose,
        setupHref: connector.setupHref,
        requiredFor: "live_operation",
        role: "primary",
        mode: isOAuthLikeConnector(connector.connectorId)
          ? "oauth_or_supported_login"
          : "guided_supported_setup",
        appHandledSteps: [
          "discover_existing_connection",
          "select_supported_method",
          "prepare_connection",
          "open_user_step",
          "verify_health",
        ],
        userOnlySteps: [{
          kind: "account_authorization",
          when: "only_if_runtime_requires",
          label: `${connector.label} 로그인·권한 동의`,
          reason: "계정 소유자 확인과 서비스 권한 동의는 본인만 할 수 있습니다.",
        }],
        runtimeEscalationKinds: ["two_factor_auth", "admin_consent", "os_permission", "license_or_payment"],
        secretEntryAllowedInChat: false,
      });
    }
  }

  const byConnector = new Map<string, ModyAgentConnectionRequirement>();
  for (const requirement of requirements) {
    if (!byConnector.has(requirement.connectorId)) byConnector.set(requirement.connectorId, requirement);
  }
  return [...byConnector.values()];
}

function createCapabilityGrantRequests(input: {
  agentId: string;
  workspaceId: string;
  createdAt: string;
  selectedFileIds: string[];
  connectionRequirements: ModyAgentConnectionRequirement[];
}): ModyCapabilityGrantRequest[] {
  const selectedScope = {
    kind: "selected_sources" as const,
    resourceIds: [...input.selectedFileIds],
    recursive: false as const,
  };
  const baseConstraints = {
    selectedScopeOnly: true,
    externalMutation: false,
    dryRunRequired: true,
    finalUserPresenceRequired: false,
    approvalMode: "none" as const,
    secretEntryAllowedInChat: false as const,
    ...(input.selectedFileIds.length ? { maxItems: input.selectedFileIds.length } : {}),
  };
  const actions = [
    ["read", "document.read.selected", "read_selected_data", "l1_scoped_read"],
    ["analyze", "document.analyze.selected", "analyze_selected_data", "l1_scoped_read"],
    ["draft", "work.create.internal_draft", "create_internal_draft", "l2_isolated_draft"],
  ] as const;
  const requests: ModyCapabilityGrantRequest[] = actions.map(([suffix, capabilityId, action, riskLevel]) => ({
    grantId: `grant-${input.agentId}-${suffix}`,
    agentId: input.agentId,
    connectorId: "local-folder",
    capabilityId,
    action,
    riskLevel,
    resourceScope: selectedScope,
    dataClass: "business_content",
    duration: "session",
    constraints: baseConstraints,
    issuedAt: input.createdAt,
  }));

  for (const requirement of input.connectionRequirements) {
    if (requirement.connectorId === "local-folder") continue;
    requests.push({
      grantId: `grant-${input.agentId}-connect-${safeId(requirement.connectorId)}`,
      agentId: input.agentId,
      connectorId: requirement.connectorId,
      capabilityId: `connector.prepare.${safeId(requirement.connectorId)}`,
      action: "prepare_connection",
      riskLevel: "l0_discovery",
      resourceScope: { kind: "connector", connectorId: requirement.connectorId },
      dataClass: "credential_reference",
      duration: "session",
      constraints: {
        selectedScopeOnly: true,
        externalMutation: false,
        dryRunRequired: true,
        finalUserPresenceRequired: requirement.userOnlySteps.length > 0,
        approvalMode: "none",
        secretEntryAllowedInChat: false,
        userOnlyActionKind: requirement.userOnlySteps[0]?.kind ?? "account_authorization",
      },
      issuedAt: input.createdAt,
    });
  }

  requests.push({
    grantId: `grant-${input.agentId}-stage`,
    agentId: input.agentId,
    connectorId: "approval-queue",
    capabilityId: "approval.stage.external_candidate",
    action: "stage_external_change",
    riskLevel: "l2_isolated_draft",
    resourceScope: { kind: "workspace", workspaceId: input.workspaceId },
    dataClass: "business_content",
    duration: "session",
    constraints: baseConstraints,
    issuedAt: input.createdAt,
  });
  return requests;
}

function isOAuthLikeConnector(connectorId: string): boolean {
  return ["gmail", "google-calendar", "google-drive"].includes(connectorId);
}

function safeId(value: string): string {
  return value.replace(/[^0-9a-z_-]+/giu, "-").replace(/^-+|-+$/gu, "") || "connector";
}

function unique<T extends string>(values: readonly T[]): T[] {
  return [...new Set(values)];
}
