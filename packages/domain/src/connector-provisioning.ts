import {
  ModyConnectorSetupRegistry,
  type ModyConnectorAutomationScope,
  type ModyConnectorConnection,
  type ModyConnectorDefinition,
  type ModyConnectorPermission,
} from "./connector-setup.js";

export type ModyProvisioningTarget =
  | "desktop_app_install"
  | "settings_repair";

export type ModyProvisioningStepKind =
  | "install_bundle"
  | "credential_storage"
  | "grant_permissions"
  | "health_check"
  | "scope_review"
  | "policy_review";

export type ModyProvisioningStepStatus =
  | "done"
  | "available"
  | "needs_user_action"
  | "blocked";

export type ModyConnectorProvisioningInput = {
  target?: ModyProvisioningTarget;
  connections?: ModyConnectorConnection[];
  includeOptional?: boolean;
};

export type ModyConnectorProvisioningStep = {
  id: string;
  connectorId: string;
  connectorName: string;
  kind: ModyProvisioningStepKind;
  label: string;
  status: ModyProvisioningStepStatus;
  userMessage: string;
  safeToRunAutomatically: boolean;
  requiresUserInteraction: boolean;
  blocksAutomation: boolean;
  commandHint?: string;
};

export type ModyConnectorProvisioningSummary = {
  totalSteps: number;
  done: number;
  available: number;
  needsUserAction: number;
  blocked: number;
  readyConnectorIds: string[];
  nextStepId?: string;
};

export type ModyConnectorProvisioningPlan = {
  target: ModyProvisioningTarget;
  steps: ModyConnectorProvisioningStep[];
  summary: ModyConnectorProvisioningSummary;
  auditMessages: string[];
};

export class ModyConnectorProvisioningPlanner {
  constructor(private readonly registry = new ModyConnectorSetupRegistry()) {}

  createPlan(input: ModyConnectorProvisioningInput = {}): ModyConnectorProvisioningPlan {
    const target = input.target ?? "desktop_app_install";
    const connections = new Map((input.connections ?? []).map((connection) => [connection.connectorId, connection]));
    const definitions = this.registry.listDefinitions()
      .filter((definition) => shouldIncludeConnector(definition, input.includeOptional));
    const steps = definitions.flatMap((definition) => this.createConnectorSteps(
      definition,
      connections.get(definition.id) ?? defaultConnectionFor(definition.id),
    ));
    const readyConnectorIds = definitions
      .filter((definition) => this.registry.createSetupPlan(
        definition.id,
        connections.get(definition.id) ?? defaultConnectionFor(definition.id),
      ).readyForAutomation)
      .map((definition) => definition.id);
    const nextStep = steps.find((step) => step.status === "needs_user_action" || step.status === "available")
      ?? steps.find((step) => step.status === "blocked");

    return {
      target,
      steps,
      summary: {
        totalSteps: steps.length,
        done: steps.filter((step) => step.status === "done").length,
        available: steps.filter((step) => step.status === "available").length,
        needsUserAction: steps.filter((step) => step.status === "needs_user_action").length,
        blocked: steps.filter((step) => step.status === "blocked").length,
        readyConnectorIds,
        ...(nextStep ? { nextStepId: nextStep.id } : {}),
      },
      auditMessages: [
        "설치 마법사는 MCP/CLI/브리지 상태를 점검하지만 OAuth token, bot token, pairing secret 원문을 저장하지 않습니다.",
        "외부 발송, 일정 등록, 파일 쓰기, OS 조작, CLI 실행 권한은 자동 허용하지 않고 사용자 확인 단계로 남깁니다.",
      ],
    };
  }

  private createConnectorSteps(
    definition: ModyConnectorDefinition,
    connection: ModyConnectorConnection,
  ): ModyConnectorProvisioningStep[] {
    const setupPlan = this.registry.createSetupPlan(definition.id, connection);
    const credentialBoundary = this.registry.evaluateCredentialBoundary(definition.id, connection);
    const missingPermissions = definition.permissions.filter(
      (permission) => !connection.grantedPermissions.includes(permission),
    );
    const automationScope = connection.automationScope ?? defaultScopeFor(definition.permissions);
    const canMutateExternally = definition.permissions.some(isExternalMutationPermission);
    const isConnected = connection.status !== "not_configured";
    const commandHint = commandHintFor(definition);

    return [
      {
        id: `${definition.id}:install`,
        connectorId: definition.id,
        connectorName: definition.name,
        kind: "install_bundle",
        label: "연결 구성",
        status: installStatusFor(definition, connection),
        userMessage: installMessageFor(definition, connection),
        safeToRunAutomatically: definition.kind === "mcp_server" || definition.kind === "cli_tool",
        requiresUserInteraction: definition.kind === "oauth_api" || definition.kind === "messaging_channel" || definition.kind === "local_folder",
        blocksAutomation: !isConnected && definition.priority === "p0",
        ...(commandHint ? { commandHint } : {}),
      },
      {
        id: `${definition.id}:credential`,
        connectorId: definition.id,
        connectorName: definition.name,
        kind: "credential_storage",
        label: "비밀정보 보관",
        status: credentialBoundary.readyForAutomation ? "done" : "needs_user_action",
        userMessage: credentialBoundary.userMessage,
        safeToRunAutomatically: false,
        requiresUserInteraction: !credentialBoundary.readyForAutomation,
        blocksAutomation: !credentialBoundary.readyForAutomation,
      },
      {
        id: `${definition.id}:permissions`,
        connectorId: definition.id,
        connectorName: definition.name,
        kind: "grant_permissions",
        label: "권한 확인",
        status: permissionStatusFor(definition, missingPermissions),
        userMessage: missingPermissions.length > 0
          ? `사용자가 확인해야 할 권한: ${missingPermissions.join(", ")}`
          : "필요 권한이 준비되어 있습니다.",
        safeToRunAutomatically: false,
        requiresUserInteraction: missingPermissions.length > 0,
        blocksAutomation: missingPermissions.length > 0,
      },
      {
        id: `${definition.id}:health`,
        connectorId: definition.id,
        connectorName: definition.name,
        kind: "health_check",
        label: "연결 상태 점검",
        status: healthStatusFor(connection),
        userMessage: setupPlan.steps.find((step) => step.id === "health-check")?.userMessage ?? "연결 상태를 확인합니다.",
        safeToRunAutomatically: connection.status === "ready" || connection.status === "disconnected" || connection.status === "error",
        requiresUserInteraction: connection.status !== "ready",
        blocksAutomation: connection.status !== "ready",
      },
      {
        id: `${definition.id}:scope`,
        connectorId: definition.id,
        connectorName: definition.name,
        kind: "scope_review",
        label: "자동화 범위",
        status: canMutateExternally && automationScope !== "approval_required_execution" ? "needs_user_action" : "done",
        userMessage: canMutateExternally
          ? "외부 실행 가능 권한은 승인 후 실행 범위로만 켭니다."
          : "읽기/초안 중심 자동화 범위입니다.",
        safeToRunAutomatically: !canMutateExternally,
        requiresUserInteraction: canMutateExternally,
        blocksAutomation: canMutateExternally && automationScope !== "approval_required_execution",
      },
      {
        id: `${definition.id}:policy`,
        connectorId: definition.id,
        connectorName: definition.name,
        kind: "policy_review",
        label: "정책 확인",
        status: definition.priority === "research" || connection.status === "research_only" ? "blocked" : "done",
        userMessage: definition.priority === "research" || connection.status === "research_only"
          ? "공식 정책 확인 전까지 자동화 실행에 연결하지 않습니다."
          : "승인 정책과 credential 보관 기준을 적용합니다.",
        safeToRunAutomatically: false,
        requiresUserInteraction: definition.priority === "research" || connection.status === "research_only",
        blocksAutomation: definition.priority === "research" || connection.status === "research_only",
      },
    ];
  }
}

function shouldIncludeConnector(definition: ModyConnectorDefinition, includeOptional = false): boolean {
  if (definition.priority === "research") return false;
  if (definition.priority === "p0") return true;
  return includeOptional;
}

function defaultConnectionFor(connectorId: string): ModyConnectorConnection {
  return {
    connectorId,
    status: "not_configured",
    grantedPermissions: [],
  };
}

function installStatusFor(
  definition: ModyConnectorDefinition,
  connection: ModyConnectorConnection,
): ModyProvisioningStepStatus {
  if (connection.status === "research_only") return "blocked";
  if (connection.status !== "not_configured") return "done";
  if (definition.kind === "mcp_server" || definition.kind === "cli_tool") return "available";
  return "needs_user_action";
}

function installMessageFor(
  definition: ModyConnectorDefinition,
  connection: ModyConnectorConnection,
): string {
  if (connection.status !== "not_configured") {
    return "연결 구성이 이미 등록되어 있습니다.";
  }

  if (definition.kind === "mcp_server") {
    return "앱 설치 마법사가 MCP 설정 위치를 점검하고 필요한 서버 설정을 안내합니다.";
  }

  if (definition.kind === "cli_tool") {
    return "앱 설치 마법사가 로컬 CLI 존재 여부를 점검하고 누락된 도구를 안내합니다.";
  }

  if (definition.kind === "local_folder") {
    return "사용자가 직접 허용 폴더를 선택해야 합니다.";
  }

  if (definition.kind === "desktop_bridge") {
    return "사용자가 OS 권한과 브리지 pairing을 확인해야 합니다.";
  }

  return "사용자가 provider 연결과 권한 동의를 직접 확인해야 합니다.";
}

function commandHintFor(definition: ModyConnectorDefinition): string | undefined {
  if (definition.id === "web-search-mcp") return "mody setup connector web-search-mcp";
  if (definition.id === "local-cli-tools") return "mody doctor cli-tools";
  if (definition.id === "desktop-bridge") return "mody bridge doctor";
  return undefined;
}

function permissionStatusFor(
  definition: ModyConnectorDefinition,
  missingPermissions: ModyConnectorPermission[],
): ModyProvisioningStepStatus {
  if (definition.priority === "research") return "blocked";
  return missingPermissions.length > 0 ? "needs_user_action" : "done";
}

function healthStatusFor(connection: ModyConnectorConnection): ModyProvisioningStepStatus {
  if (connection.status === "ready") return "done";
  if (connection.status === "research_only") return "blocked";
  return "needs_user_action";
}

function defaultScopeFor(permissions: ModyConnectorPermission[]): ModyConnectorAutomationScope {
  if (permissions.some(isExternalMutationPermission)) return "approval_required_execution";
  if (permissions.includes("send_draft")) return "draft_only";
  if (permissions.length > 0) return "read_only";
  return "off";
}

function isExternalMutationPermission(permission: ModyConnectorPermission): boolean {
  return [
    "send_external",
    "write_calendar",
    "write_files",
    "desktop_control",
    "cli_execution",
    "write_booking_hold",
    "write_inventory",
    "send_sms",
  ].includes(permission);
}
