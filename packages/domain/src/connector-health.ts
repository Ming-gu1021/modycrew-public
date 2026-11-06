import {
  ModyConnectorSetupRegistry,
  type ModyConnectorConnection,
  type ModyConnectorCredentialHealthStatus,
  type ModyConnectorDefinition,
  type ModyConnectorStatus,
} from "./connector-setup.js";

export type ModyConnectorHealthIssueKind =
  | "not_configured"
  | "needs_permission"
  | "disconnected"
  | "provider_error"
  | "credential_missing"
  | "credential_expired"
  | "credential_revoked"
  | "credential_unknown"
  | "health_stale"
  | "automation_off"
  | "policy_blocked";

export type ModyConnectorHealthSeverity =
  | "critical"
  | "action_required"
  | "warning"
  | "info";

export type ModyConnectorRepairActionKind =
  | "connect"
  | "grant_permissions"
  | "reconnect"
  | "rotate_secret"
  | "run_health_check"
  | "change_scope"
  | "view_policy";

export type ModyConnectorHealthInput = {
  connections?: ModyConnectorConnection[];
  includeOptional?: boolean;
  now?: Date;
  staleAfterMs?: number;
};

export type ModyConnectorHealthIssue = {
  id: string;
  connectorId: string;
  connectorName: string;
  kind: ModyConnectorHealthIssueKind;
  severity: ModyConnectorHealthSeverity;
  message: string;
  repairAction: ModyConnectorRepairActionKind;
  repairLabel: string;
  blocksAutomation: boolean;
};

export type ModyConnectorHealthSummary = {
  totalConnectors: number;
  ready: number;
  blocked: number;
  critical: number;
  actionRequired: number;
  warning: number;
  info: number;
  stale: number;
  automationReadyConnectorIds: string[];
  nextIssueId?: string;
};

export type ModyConnectorHealthReport = {
  generatedAt: string;
  issues: ModyConnectorHealthIssue[];
  summary: ModyConnectorHealthSummary;
  userMessage: string;
};

export class ModyConnectorHealthMonitor {
  constructor(private readonly registry = new ModyConnectorSetupRegistry()) {}

  createReport(input: ModyConnectorHealthInput = {}): ModyConnectorHealthReport {
    const now = input.now ?? new Date();
    const staleAfterMs = input.staleAfterMs ?? 10 * 60 * 1000;
    const connections = new Map((input.connections ?? []).map((connection) => [connection.connectorId, connection]));
    const definitions = this.registry.listDefinitions().filter(
      (definition) => input.includeOptional || definition.priority === "p0",
    );
    const issues = definitions.flatMap((definition) => this.createIssuesForConnector(
      definition,
      connections.get(definition.id) ?? defaultConnectionFor(definition.id),
      now,
      staleAfterMs,
    ));
    const automationReadyConnectorIds = definitions
      .filter((definition) => this.registry.createSettingsCard(
        definition.id,
        connections.get(definition.id) ?? defaultConnectionFor(definition.id),
      ).readyForAutomation)
      .map((definition) => definition.id);
    const nextIssue = issues.find((issue) => issue.severity === "critical")
      ?? issues.find((issue) => issue.severity === "action_required")
      ?? issues.find((issue) => issue.severity === "warning")
      ?? issues[0];
    const blockedConnectorIds = new Set(issues
      .filter((issue) => issue.blocksAutomation)
      .map((issue) => issue.connectorId));

    return {
      generatedAt: now.toISOString(),
      issues,
      summary: {
        totalConnectors: definitions.length,
        ready: automationReadyConnectorIds.length,
        blocked: blockedConnectorIds.size,
        critical: issues.filter((issue) => issue.severity === "critical").length,
        actionRequired: issues.filter((issue) => issue.severity === "action_required").length,
        warning: issues.filter((issue) => issue.severity === "warning").length,
        info: issues.filter((issue) => issue.severity === "info").length,
        stale: issues.filter((issue) => issue.kind === "health_stale").length,
        automationReadyConnectorIds,
        ...(nextIssue ? { nextIssueId: nextIssue.id } : {}),
      },
      userMessage: issues.length > 0
        ? "연결 수리 대기 항목이 있습니다. 자동화 실행 전에 사용자 확인 또는 재연결이 필요합니다."
        : "모든 핵심 연결이 자동화 준비 상태입니다.",
    };
  }

  private createIssuesForConnector(
    definition: ModyConnectorDefinition,
    connection: ModyConnectorConnection,
    now: Date,
    staleAfterMs: number,
  ): ModyConnectorHealthIssue[] {
    const issues: ModyConnectorHealthIssue[] = [];
    const credentialBoundary = this.registry.evaluateCredentialBoundary(definition.id, connection);
    const setupPlan = this.registry.createSetupPlan(definition.id, connection);
    const missingPermissions = definition.permissions.filter(
      (permission) => !connection.grantedPermissions.includes(permission),
    );

    const connectionIssue = connectionIssueFor(definition, connection.status);
    if (connectionIssue) {
      issues.push(connectionIssue);
    }

    const credentialIssue = credentialIssueFor(definition, credentialBoundary.credentialStatus);
    if (credentialIssue) {
      issues.push(credentialIssue);
    }

    if (missingPermissions.length > 0) {
      issues.push({
        id: `${definition.id}:needs_permission`,
        connectorId: definition.id,
        connectorName: definition.name,
        kind: "needs_permission",
        severity: "action_required",
        message: `필요 권한이 부족합니다: ${missingPermissions.join(", ")}`,
        repairAction: "grant_permissions",
        repairLabel: "권한 허용",
        blocksAutomation: true,
      });
    }

    if (isHealthStale(connection, now, staleAfterMs)) {
      issues.push({
        id: `${definition.id}:health_stale`,
        connectorId: definition.id,
        connectorName: definition.name,
        kind: "health_stale",
        severity: "warning",
        message: "최근 health check가 오래되었습니다. 자동화 전 상태를 다시 확인해야 합니다.",
        repairAction: "run_health_check",
        repairLabel: "상태 다시 확인",
        blocksAutomation: false,
      });
    }

    if (setupPlan.readyForAutomation && (connection.automationScope ?? "off") === "off") {
      issues.push({
        id: `${definition.id}:automation_off`,
        connectorId: definition.id,
        connectorName: definition.name,
        kind: "automation_off",
        severity: "info",
        message: "연결은 준비되었지만 자동화 범위가 꺼져 있습니다.",
        repairAction: "change_scope",
        repairLabel: "자동화 범위",
        blocksAutomation: false,
      });
    }

    return issues;
  }
}

function defaultConnectionFor(connectorId: string): ModyConnectorConnection {
  return {
    connectorId,
    status: "not_configured",
    grantedPermissions: [],
  };
}

function connectionIssueFor(
  definition: ModyConnectorDefinition,
  status: ModyConnectorStatus,
): ModyConnectorHealthIssue | undefined {
  if (status === "ready") return undefined;
  if (status === "not_configured") {
    return {
      id: `${definition.id}:not_configured`,
      connectorId: definition.id,
      connectorName: definition.name,
      kind: "not_configured",
      severity: "action_required",
      message: "아직 연결되지 않았습니다.",
      repairAction: "connect",
      repairLabel: "연결하기",
      blocksAutomation: true,
    };
  }
  if (status === "needs_permission") {
    return {
      id: `${definition.id}:needs_permission_status`,
      connectorId: definition.id,
      connectorName: definition.name,
      kind: "needs_permission",
      severity: "action_required",
      message: "사용자 권한 허용이 필요합니다.",
      repairAction: "grant_permissions",
      repairLabel: "권한 허용",
      blocksAutomation: true,
    };
  }
  if (status === "disconnected") {
    return {
      id: `${definition.id}:disconnected`,
      connectorId: definition.id,
      connectorName: definition.name,
      kind: "disconnected",
      severity: definition.priority === "p0" ? "critical" : "action_required",
      message: "연결이 끊겼습니다. 자동화 실행 전에 재연결해야 합니다.",
      repairAction: "reconnect",
      repairLabel: "다시 연결",
      blocksAutomation: true,
    };
  }
  if (status === "error") {
    return {
      id: `${definition.id}:provider_error`,
      connectorId: definition.id,
      connectorName: definition.name,
      kind: "provider_error",
      severity: "critical",
      message: "연결 점검 중 오류가 발생했습니다.",
      repairAction: "run_health_check",
      repairLabel: "상태 다시 확인",
      blocksAutomation: true,
    };
  }
  if (status === "research_only") {
    return {
      id: `${definition.id}:policy_blocked`,
      connectorId: definition.id,
      connectorName: definition.name,
      kind: "policy_blocked",
      severity: "warning",
      message: "공식 정책 확인 전까지 자동화에 연결하지 않습니다.",
      repairAction: "view_policy",
      repairLabel: "정책 보기",
      blocksAutomation: true,
    };
  }

  return undefined;
}

function credentialIssueFor(
  definition: ModyConnectorDefinition,
  credentialStatus: ModyConnectorCredentialHealthStatus,
): ModyConnectorHealthIssue | undefined {
  if (credentialStatus === "valid" || credentialStatus === "not_required") return undefined;

  const common = {
    connectorId: definition.id,
    connectorName: definition.name,
    blocksAutomation: true,
  };

  if (credentialStatus === "expired") {
    return {
      ...common,
      id: `${definition.id}:credential_expired`,
      kind: "credential_expired",
      severity: "critical",
      message: "credential이 만료되었습니다. token 원문을 저장하지 않고 재동의 또는 회전이 필요합니다.",
      repairAction: "rotate_secret",
      repairLabel: "credential 회전",
    };
  }

  if (credentialStatus === "revoked") {
    return {
      ...common,
      id: `${definition.id}:credential_revoked`,
      kind: "credential_revoked",
      severity: "critical",
      message: "사용자가 credential 권한을 철회했습니다.",
      repairAction: "reconnect",
      repairLabel: "다시 연결",
    };
  }

  if (credentialStatus === "missing") {
    return {
      ...common,
      id: `${definition.id}:credential_missing`,
      kind: "credential_missing",
      severity: "action_required",
      message: "credential이 아직 연결되지 않았습니다.",
      repairAction: "connect",
      repairLabel: "연결하기",
    };
  }

  return {
    ...common,
    id: `${definition.id}:credential_unknown`,
    kind: "credential_unknown",
    severity: "action_required",
    message: "credential 상태를 확인할 수 없습니다.",
    repairAction: "run_health_check",
    repairLabel: "상태 다시 확인",
  };
}

function isHealthStale(
  connection: ModyConnectorConnection,
  now: Date,
  staleAfterMs: number,
): boolean {
  if (!connection.lastCheckedAt) return false;
  return now.getTime() - new Date(connection.lastCheckedAt).getTime() > staleAfterMs;
}
