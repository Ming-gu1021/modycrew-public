import { ModyConnectorSetupRegistry } from "./connector-setup.js";
import type {
  ModyConnectorAutomationScope,
  ModyConnectorConnection,
  ModyConnectorDefinition,
  ModyConnectorPermission,
  ModyConnectorStatus,
} from "./connector-setup.js";

export type ModyToolConnectivityStageId =
  | "recommended"
  | "setup_guided"
  | "credential_safe"
  | "read_or_receive_ready"
  | "draft_or_command_ready"
  | "approval_execution_ready"
  | "health_repair_ready";

export type ModyToolConnectivityStageStatus =
  | "ready"
  | "waiting"
  | "blocked"
  | "not_applicable";

export type ModyToolConnectivityStage = {
  id: ModyToolConnectivityStageId;
  label: string;
  status: ModyToolConnectivityStageStatus;
  userMessage: string;
};

export type ModyToolConnectivityInput = {
  connections?: ModyConnectorConnection[];
  recommendedConnectorIds?: string[];
  healthTrackedConnectorIds?: string[];
};

export type ModyToolConnectivityRow = {
  connectorId: string;
  connectorName: string;
  kind: ModyConnectorDefinition["kind"];
  priority: ModyConnectorDefinition["priority"];
  connectionStatus: ModyConnectorStatus;
  automationScope: ModyConnectorAutomationScope;
  policyBlocked: boolean;
  score: number;
  maxScore: number;
  scorePercent: number;
  nextStepLabel: string;
  stages: ModyToolConnectivityStage[];
};

export type ModyToolConnectivitySummary = {
  totalConnectors: number;
  connectedConnectors: number;
  approvalExecutionReadyConnectors: number;
  policyBlockedConnectors: number;
  currentScore: number;
  maxScore: number;
  totalScorePercent: number;
  maturityLabel: string;
  safetySummary: string;
};

export type ModyToolConnectivityReport = {
  rows: ModyToolConnectivityRow[];
  summary: ModyToolConnectivitySummary;
};

export class ModyToolConnectivityMatrix {
  constructor(private readonly registry = new ModyConnectorSetupRegistry()) {}

  createReport(input: ModyToolConnectivityInput = {}): ModyToolConnectivityReport {
    const connections = new Map((input.connections ?? []).map((connection) => [connection.connectorId, connection]));
    const recommendedConnectorIds = new Set(input.recommendedConnectorIds ?? []);
    const healthTrackedConnectorIds = new Set(input.healthTrackedConnectorIds ?? []);
    const rows = this.registry.listDefinitions().map((definition) => {
      const connection = connections.get(definition.id) ?? createDefaultConnection(definition.id);
      return this.createRow(definition, connection, {
        recommended: recommendedConnectorIds.has(definition.id),
        healthTracked: healthTrackedConnectorIds.has(definition.id),
      });
    });
    const currentScore = rows.reduce((total, row) => total + row.score, 0);
    const maxScore = rows.reduce((total, row) => total + row.maxScore, 0);
    const totalScorePercent = maxScore > 0 ? Math.round((currentScore / maxScore) * 100) : 0;

    return {
      rows,
      summary: {
        totalConnectors: rows.length,
        connectedConnectors: rows.filter((row) => row.connectionStatus === "ready").length,
        approvalExecutionReadyConnectors: rows.filter((row) =>
          row.stages.some((stage) => stage.id === "approval_execution_ready" && stage.status === "ready"),
        ).length,
        policyBlockedConnectors: rows.filter((row) => row.policyBlocked).length,
        currentScore,
        maxScore,
        totalScorePercent,
        maturityLabel: maturityLabelFor(totalScorePercent),
        safetySummary: "연결성은 추천, 설정 안내, 읽기/수신, 초안/명령, 승인 후 실행, 상태/수리까지 본다. OAuth 동의, bot token, OS 권한, 폴더 선택은 사용자가 직접 확인한다.",
      },
    };
  }

  private createRow(
    definition: ModyConnectorDefinition,
    connection: ModyConnectorConnection,
    options: {
      recommended: boolean;
      healthTracked: boolean;
    },
  ): ModyToolConnectivityRow {
    const card = this.registry.createSettingsCard(definition.id, connection);
    const setupPlan = this.registry.createSetupPlan(definition.id, connection);
    const policyBlocked = definition.priority === "research" || connection.status === "research_only";
    const stages: ModyToolConnectivityStage[] = [
      recommendationStage(definition, options.recommended),
      {
        id: "setup_guided",
        label: "설정 안내",
        status: setupPlan.steps.length > 0 ? "ready" : "waiting",
        userMessage: setupPlan.steps.length > 0
          ? "설치, credential, 권한, health check 단계가 안내됩니다."
          : "설정 안내 단계가 아직 없습니다.",
      },
      {
        id: "credential_safe",
        label: "비밀정보 안전",
        status: card.credentialBoundary.appMayPersistSecret === false ? "ready" : "blocked",
        userMessage: card.credentialBoundary.appMayPersistSecret === false
          ? "비밀정보 원문을 앱 화면이나 browser storage에 저장하지 않습니다."
          : "비밀정보 저장 경계가 안전하지 않습니다.",
      },
      readStage(definition, connection, policyBlocked),
      draftOrCommandStage(definition, connection, policyBlocked),
      approvalExecutionStage(definition, connection, card.automationScope, policyBlocked),
      healthRepairStage(definition, connection, options.healthTracked),
    ];
    const applicableStages = stages.filter((stage) => stage.status !== "not_applicable");
    const score = applicableStages.filter((stage) => stage.status === "ready").length;
    const maxScore = applicableStages.length;

    return {
      connectorId: definition.id,
      connectorName: definition.name,
      kind: definition.kind,
      priority: definition.priority,
      connectionStatus: connection.status,
      automationScope: card.automationScope,
      policyBlocked,
      score,
      maxScore,
      scorePercent: maxScore > 0 ? Math.round((score / maxScore) * 100) : 0,
      nextStepLabel: nextStepLabelFor(stages, policyBlocked),
      stages,
    };
  }
}

const readPermissions: ModyConnectorPermission[] = [
  "read_messages",
  "read_calendar",
  "read_files",
  "web_search",
  "mcp_tool_call",
  "desktop_read",
  "read_booking",
  "read_inventory",
];

const draftOrCommandPermissions: ModyConnectorPermission[] = [
  "send_draft",
  "mcp_tool_call",
  "cli_execution",
  "desktop_control",
  "write_booking_hold",
  "write_inventory",
];

const externalMutationPermissions: ModyConnectorPermission[] = [
  "send_external",
  "write_calendar",
  "write_files",
  "cli_execution",
  "desktop_control",
  "write_booking_hold",
  "write_inventory",
  "send_sms",
];

function createDefaultConnection(connectorId: string): ModyConnectorConnection {
  return {
    connectorId,
    status: "not_configured",
    grantedPermissions: [],
  };
}

function recommendationStage(
  definition: ModyConnectorDefinition,
  explicitRecommendation: boolean,
): ModyToolConnectivityStage {
  const recommended = explicitRecommendation || definition.priority === "p0" || definition.priority === "p1";

  return {
    id: "recommended",
    label: "추천/발견",
    status: recommended ? "ready" : "waiting",
    userMessage: recommended
      ? "사용 목적에서 이 툴을 추천하고 설정으로 안내할 수 있습니다."
      : "사용 목적과 연결된 추천 경로가 더 필요합니다.",
  };
}

function readStage(
  definition: ModyConnectorDefinition,
  connection: ModyConnectorConnection,
  policyBlocked: boolean,
): ModyToolConnectivityStage {
  if (!definition.permissions.some((permission) => readPermissions.includes(permission))) {
    return {
      id: "read_or_receive_ready",
      label: "읽기/수신",
      status: "not_applicable",
      userMessage: "이 연결은 읽기 또는 수신 권한이 핵심이 아닙니다.",
    };
  }

  if (policyBlocked) {
    return {
      id: "read_or_receive_ready",
      label: "읽기/수신",
      status: "blocked",
      userMessage: "공식 정책 확인 전까지 메시지 읽기/수신 자동화를 켜지 않습니다.",
    };
  }

  const granted = definition.permissions
    .filter((permission) => readPermissions.includes(permission))
    .some((permission) => connection.grantedPermissions.includes(permission));

  return {
    id: "read_or_receive_ready",
    label: "읽기/수신",
    status: connection.status === "ready" && granted ? "ready" : "waiting",
    userMessage: connection.status === "ready" && granted
      ? "기존 툴에서 업무를 읽거나 받을 수 있습니다."
      : "읽기 또는 수신 권한 연결이 필요합니다.",
  };
}

function draftOrCommandStage(
  definition: ModyConnectorDefinition,
  connection: ModyConnectorConnection,
  policyBlocked: boolean,
): ModyToolConnectivityStage {
  if (!definition.permissions.some((permission) => draftOrCommandPermissions.includes(permission))) {
    return {
      id: "draft_or_command_ready",
      label: "초안/명령",
      status: "not_applicable",
      userMessage: "이 연결은 초안 생성이나 명령 수신이 핵심이 아닙니다.",
    };
  }

  if (policyBlocked) {
    return {
      id: "draft_or_command_ready",
      label: "초안/명령",
      status: "blocked",
      userMessage: "공식 정책 확인 전까지 bot token이나 자동 명령 연결을 켜지 않습니다.",
    };
  }

  const granted = definition.permissions
    .filter((permission) => draftOrCommandPermissions.includes(permission))
    .some((permission) => connection.grantedPermissions.includes(permission));

  return {
    id: "draft_or_command_ready",
    label: "초안/명령",
    status: connection.status === "ready" && granted ? "ready" : "waiting",
    userMessage: connection.status === "ready" && granted
      ? "초안 생성 또는 명령 수신이 가능한 상태입니다."
      : "초안 생성 또는 명령 수신 권한 연결이 필요합니다.",
  };
}

function approvalExecutionStage(
  definition: ModyConnectorDefinition,
  connection: ModyConnectorConnection,
  automationScope: ModyConnectorAutomationScope,
  policyBlocked: boolean,
): ModyToolConnectivityStage {
  if (!definition.permissions.some((permission) => externalMutationPermissions.includes(permission))) {
    return {
      id: "approval_execution_ready",
      label: "승인 후 실행",
      status: "not_applicable",
      userMessage: "외부 시스템을 바꾸는 실행 권한이 없습니다.",
    };
  }

  if (policyBlocked) {
    return {
      id: "approval_execution_ready",
      label: "승인 후 실행",
      status: "blocked",
      userMessage: "공식 정책 확인 전까지 승인 후 실행 범위도 열지 않습니다.",
    };
  }

  const granted = definition.permissions
    .filter((permission) => externalMutationPermissions.includes(permission))
    .some((permission) => connection.grantedPermissions.includes(permission));
  const ready = connection.status === "ready" && automationScope === "approval_required_execution" && granted;

  return {
    id: "approval_execution_ready",
    label: "승인 후 실행",
    status: ready ? "ready" : "waiting",
    userMessage: ready
      ? "실행은 승인함 최종 확인 뒤에만 가능하도록 연결됩니다."
      : "외부 발송, 일정 등록, 파일/OS/CLI 실행은 승인 후 실행 범위 확인이 필요합니다.",
  };
}

function healthRepairStage(
  definition: ModyConnectorDefinition,
  connection: ModyConnectorConnection,
  explicitlyTracked: boolean,
): ModyToolConnectivityStage {
  const tracked = explicitlyTracked || connection.status !== "not_configured" || definition.priority === "research";

  return {
    id: "health_repair_ready",
    label: "상태/수리",
    status: tracked ? "ready" : "waiting",
    userMessage: tracked
      ? "연결 상태와 수리 안내를 사용자에게 보여줄 수 있습니다."
      : "health check와 수리 안내 연결이 필요합니다.",
  };
}

function nextStepLabelFor(stages: ModyToolConnectivityStage[], policyBlocked: boolean): string {
  if (policyBlocked) return "공식 정책 확인";

  const next = stages.find((stage) => stage.status === "waiting" || stage.status === "blocked");
  if (!next) return "연결성 기준 충족";
  if (next.id === "recommended") return "사용 목적 추천에 연결";
  if (next.id === "setup_guided") return "설정 마법사 연결";
  if (next.id === "credential_safe") return "비밀정보 저장 경계 수정";
  if (next.id === "read_or_receive_ready") return "읽기/수신 권한 연결";
  if (next.id === "draft_or_command_ready") return "초안/명령 권한 연결";
  if (next.id === "approval_execution_ready") return "승인 후 실행 범위 확인";
  return "상태 점검/수리 연결";
}

function maturityLabelFor(score: number): string {
  if (score >= 85) return "반복 업무 연결 준비";
  if (score >= 65) return "업무 흐름 연결 중";
  if (score >= 45) return "설정 안내 중심";
  return "연결 기반 구축 중";
}
