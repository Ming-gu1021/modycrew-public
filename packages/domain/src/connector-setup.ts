import { ModyCredentialVaultPolicy } from "./connector-credential-vault.js";
import type { ISODateTimeString, ToolRiskLabel } from "./types.js";
import type {
  ModyCredentialPersistenceLocation,
  ModyCredentialSecretKind,
  ModyCredentialVaultDecision,
} from "./connector-credential-vault.js";

export type ModyConnectorKind =
  | "oauth_api"
  | "messaging_channel"
  | "mcp_server"
  | "cli_tool"
  | "desktop_bridge"
  | "browser_automation"
  | "business_system"
  | "local_folder";

export type ModyConnectorStatus =
  | "not_configured"
  | "needs_permission"
  | "ready"
  | "disconnected"
  | "error"
  | "research_only";

export type ModyConnectorAutomationScope =
  | "off"
  | "read_only"
  | "draft_only"
  | "approval_required_execution";

export type ModyConnectorSecretStorage =
  | "not_required"
  | "os_keychain"
  | "enterprise_vault"
  | "external_mcp_config"
  | "local_env_reference";

export type ModyConnectorCredentialHealthStatus =
  | "not_required"
  | "missing"
  | "valid"
  | "expired"
  | "revoked"
  | "unknown";

export type ModyConnectorCredentialPolicy = {
  secretStorage: ModyConnectorSecretStorage;
  storesSecretMaterial: boolean;
  appMayPersistSecret: false;
  userMessage: string;
};

export type ModyConnectorCredentialHealth = {
  status: ModyConnectorCredentialHealthStatus;
  checkedAt?: ISODateTimeString;
  expiresAt?: ISODateTimeString;
  lastError?: string;
};

export type ModyConnectorCredentialBoundary = {
  connectorId: string;
  secretStorage: ModyConnectorSecretStorage;
  credentialStatus: ModyConnectorCredentialHealthStatus;
  appMayPersistSecret: false;
  readyForAutomation: boolean;
  recoveryAction: "none" | "connect" | "reconnect" | "rotate_secret" | "grant_permissions";
  userMessage: string;
};

export type ModyConnectorSettingsActionKind =
  | "connect"
  | "grant_permissions"
  | "reconnect"
  | "change_scope"
  | "view_policy";

export type ModyConnectorPermission =
  | "read_messages"
  | "send_draft"
  | "send_external"
  | "read_calendar"
  | "write_calendar"
  | "read_files"
  | "write_files"
  | "web_search"
  | "mcp_tool_call"
  | "cli_execution"
  | "desktop_read"
  | "desktop_control"
  | "read_booking"
  | "write_booking_hold"
  | "read_inventory"
  | "write_inventory"
  | "send_sms";

export type ModyConnectorDefinition = {
  id: string;
  name: string;
  kind: ModyConnectorKind;
  priority: "p0" | "p1" | "p2" | "research";
  oneTimeSetup: boolean;
  permissions: ModyConnectorPermission[];
  credentialPolicy: ModyConnectorCredentialPolicy;
  riskLabel: ToolRiskLabel;
  userValue: string;
};

export type ModyConnectorConnection = {
  connectorId: string;
  status: ModyConnectorStatus;
  grantedPermissions: ModyConnectorPermission[];
  automationScope?: ModyConnectorAutomationScope;
  credentialHealth?: ModyConnectorCredentialHealth;
  lastCheckedAt?: ISODateTimeString;
  disconnectedReason?: string;
};

export type ModyConnectorSetupStep = {
  id: string;
  label: string;
  status: "done" | "needs_action" | "blocked";
  userMessage: string;
};

export type ModyConnectorSetupPlan = {
  connector: ModyConnectorDefinition;
  connection: ModyConnectorConnection;
  readyForAutomation: boolean;
  needsUserAction: boolean;
  steps: ModyConnectorSetupStep[];
};

export type ModyConnectorSettingsAction = {
  kind: ModyConnectorSettingsActionKind;
  label: string;
  requiresUserInteraction: boolean;
  userMessage: string;
};

export type ModyConnectorSettingsCard = {
  connector: ModyConnectorDefinition;
  connection: ModyConnectorConnection;
  statusLabel: string;
  statusTone: "ready" | "warning" | "danger" | "neutral";
  automationScope: ModyConnectorAutomationScope;
  credentialBoundary: ModyConnectorCredentialBoundary;
  readyForAutomation: boolean;
  primaryAction: ModyConnectorSettingsAction;
  secondaryActions: ModyConnectorSettingsAction[];
};

export type ModyConnectorPermissionChangeStatus =
  | "safe"
  | "requires_user_confirmation"
  | "blocked";

export type ModyConnectorPermissionChangeInput = {
  requestedPermissions: ModyConnectorPermission[];
  requestedAutomationScope?: ModyConnectorAutomationScope;
};

export type ModyConnectorPermissionChangeReview = {
  connector: ModyConnectorDefinition;
  currentPermissions: ModyConnectorPermission[];
  requestedPermissions: ModyConnectorPermission[];
  addedPermissions: ModyConnectorPermission[];
  removedPermissions: ModyConnectorPermission[];
  requestedAutomationScope: ModyConnectorAutomationScope;
  status: ModyConnectorPermissionChangeStatus;
  riskLabel: ToolRiskLabel;
  userMessage: string;
};

const defaultConnectors: ModyConnectorDefinition[] = [
  {
    id: "gmail-outlook-mail",
    name: "Gmail/Outlook 메일",
    kind: "oauth_api",
    priority: "p0",
    oneTimeSetup: true,
    permissions: ["read_messages", "send_draft", "send_external"],
    credentialPolicy: {
      secretStorage: "os_keychain",
      storesSecretMaterial: true,
      appMayPersistSecret: false,
      userMessage: "OAuth refresh token은 앱 화면이나 localStorage가 아니라 OS 보안 저장소에 둡니다.",
    },
    riskLabel: "high",
    userValue: "문의 읽기, 답장 초안, 승인 후 발송 대기를 연결합니다.",
  },
  {
    id: "calendar-google-outlook",
    name: "Google/Outlook 캘린더",
    kind: "oauth_api",
    priority: "p0",
    oneTimeSetup: true,
    permissions: ["read_calendar", "write_calendar"],
    credentialPolicy: {
      secretStorage: "os_keychain",
      storesSecretMaterial: true,
      appMayPersistSecret: false,
      userMessage: "캘린더 OAuth token은 OS 보안 저장소에 보관하고 앱 상태에는 저장하지 않습니다.",
    },
    riskLabel: "high",
    userValue: "일정 요청을 읽고 승인 후 일정 등록 후보를 만듭니다.",
  },
  {
    id: "business-inquiry-inbox",
    name: "회사/공공기관/포털 문의함",
    kind: "oauth_api",
    priority: "p1",
    oneTimeSetup: true,
    permissions: ["read_messages", "send_draft"],
    credentialPolicy: {
      secretStorage: "os_keychain",
      storesSecretMaterial: true,
      appMayPersistSecret: false,
      userMessage: "회사 메일, 공공기관 메일, 네이버/카카오 문의 credential은 OS 보안 저장소나 공식 provider secret 참조만 기록합니다.",
    },
    riskLabel: "medium",
    userValue: "여러 문의 입구를 광고/스팸/업무 요청으로 분류하고 업무 메일처럼 초안과 보고를 만듭니다.",
  },
  {
    id: "booking-platform-hub",
    name: "네이버/카카오/구글 예약 허브",
    kind: "oauth_api",
    priority: "p1",
    oneTimeSetup: true,
    permissions: ["read_booking", "write_booking_hold", "read_calendar"],
    credentialPolicy: {
      secretStorage: "os_keychain",
      storesSecretMaterial: true,
      appMayPersistSecret: false,
      userMessage: "예약 플랫폼 credential은 공식 API/관리자 권한 확인 후 참조만 저장하고 예약 확정/변경은 승인 후 실행으로 둡니다.",
    },
    riskLabel: "high",
    userValue: "예약 요청과 사용자 캘린더를 함께 보고 가능한 날짜/미팅 시간을 추려 승인 대기 후보를 만듭니다.",
  },
  {
    id: "business-system-inventory",
    name: "회사 시스템·재고",
    kind: "business_system",
    priority: "p1",
    oneTimeSetup: true,
    permissions: ["read_inventory", "send_draft", "send_sms"],
    credentialPolicy: {
      secretStorage: "os_keychain",
      storesSecretMaterial: true,
      appMayPersistSecret: false,
      userMessage: "POS/ERP/재고 API credential은 OS 보안 저장소나 공식 secret manager 참조만 기록하고 앱 화면에는 원문을 남기지 않습니다.",
    },
    riskLabel: "high",
    userValue: "POS, ERP, 엑셀 재고표를 읽고 부족 재고를 정리한 뒤 문자 발송 후보를 승인함에 올립니다.",
  },
  {
    id: "notion-workspace",
    name: "Notion 워크스페이스",
    kind: "oauth_api",
    priority: "p0",
    oneTimeSetup: true,
    permissions: ["read_files", "write_files"],
    credentialPolicy: {
      secretStorage: "os_keychain",
      storesSecretMaterial: true,
      appMayPersistSecret: false,
      userMessage: "Notion OAuth token은 OS 보안 저장소에 두고 페이지/데이터베이스 변경은 승인 후 실행으로만 둡니다.",
    },
    riskLabel: "high",
    userValue: "Notion 문서, 업무 DB, 회의록을 읽고 승인 후 정리/업데이트 후보를 만듭니다.",
  },
  {
    id: "figma-design",
    name: "Figma 디자인",
    kind: "oauth_api",
    priority: "p0",
    oneTimeSetup: true,
    permissions: ["read_files", "write_files", "mcp_tool_call"],
    credentialPolicy: {
      secretStorage: "os_keychain",
      storesSecretMaterial: true,
      appMayPersistSecret: false,
      userMessage: "Figma OAuth/PAT 원문은 앱 상태에 저장하지 않고, 디자인 쓰기 작업은 사용자가 승인한 범위로만 실행합니다.",
    },
    riskLabel: "medium",
    userValue: "디자인 파일, 화면 캡처, 컴포넌트 handoff를 읽고 승인 후 디자인/문서화 작업 후보를 만듭니다.",
  },
  {
    id: "gemini-ai",
    name: "Google Gemini",
    kind: "oauth_api",
    priority: "p0",
    oneTimeSetup: true,
    permissions: ["send_draft"],
    credentialPolicy: {
      secretStorage: "os_keychain",
      storesSecretMaterial: true,
      appMayPersistSecret: false,
      userMessage: "Gemini API key는 앱 화면이나 localStorage가 아니라 OS 보안 저장소에 두고, 앱에는 credential reference와 health 상태만 남깁니다.",
    },
    riskLabel: "medium",
    userValue: "메일/문의/자료를 바탕으로 답장 초안과 요약 후보를 생성합니다. 외부 발송은 승인 후 실행으로 둡니다.",
  },
  {
    id: "slack-app",
    name: "Slack App",
    kind: "messaging_channel",
    priority: "p0",
    oneTimeSetup: true,
    permissions: ["read_messages", "send_draft"],
    credentialPolicy: {
      secretStorage: "os_keychain",
      storesSecretMaterial: true,
      appMayPersistSecret: false,
      userMessage: "Slack OAuth bot token은 OS 보안 저장소에 저장하고 UI에는 workspace와 권한 상태만 표시합니다.",
    },
    riskLabel: "medium",
    userValue: "워크스페이스 slash command, 승인 알림, 수정 요청을 앱 최종 확인 경계로 연결합니다.",
  },
  {
    id: "telegram-bot",
    name: "Telegram Bot",
    kind: "messaging_channel",
    priority: "p0",
    oneTimeSetup: true,
    permissions: ["read_messages", "send_draft"],
    credentialPolicy: {
      secretStorage: "os_keychain",
      storesSecretMaterial: true,
      appMayPersistSecret: false,
      userMessage: "Telegram bot token은 OS 보안 저장소에 저장하고 webhook secret 원문은 앱 화면에 남기지 않습니다.",
    },
    riskLabel: "medium",
    userValue: "개인/소규모 팀이 AI에게 빠르게 묻고 승인, 수정 요청, 보류를 기록합니다.",
  },
  {
    id: "discord-app",
    name: "Discord App",
    kind: "messaging_channel",
    priority: "p1",
    oneTimeSetup: true,
    permissions: ["read_messages", "send_draft"],
    credentialPolicy: {
      secretStorage: "os_keychain",
      storesSecretMaterial: true,
      appMayPersistSecret: false,
      userMessage: "Discord bot token은 OS 보안 저장소에 두고 user token 방식은 허용하지 않습니다.",
    },
    riskLabel: "medium",
    userValue: "커뮤니티, 개발팀, 내부 테스트 서버에서 명령과 승인 알림 후보로 연결합니다.",
  },
  {
    id: "naver-works-bot",
    name: "NAVER WORKS Bot",
    kind: "messaging_channel",
    priority: "p1",
    oneTimeSetup: true,
    permissions: ["read_messages", "send_draft"],
    credentialPolicy: {
      secretStorage: "os_keychain",
      storesSecretMaterial: true,
      appMayPersistSecret: false,
      userMessage: "NAVER WORKS bot token과 tenant credential은 OS 보안 저장소나 서버 secret manager 참조만 기록합니다.",
    },
    riskLabel: "medium",
    userValue: "한국 업무용 메신저 고객의 팀 명령, 승인 알림, 보고서 요약을 연결합니다.",
  },
  {
    id: "web-search-mcp",
    name: "웹 검색 MCP",
    kind: "mcp_server",
    priority: "p0",
    oneTimeSetup: true,
    permissions: ["web_search", "mcp_tool_call"],
    credentialPolicy: {
      secretStorage: "external_mcp_config",
      storesSecretMaterial: false,
      appMayPersistSecret: false,
      userMessage: "MCP credential은 MCP 설정에 남기고 ModyCrew는 health와 권한 상태만 읽습니다.",
    },
    riskLabel: "medium",
    userValue: "업무 조사와 레퍼런스 확인을 앱 안에서 안전하게 요청합니다.",
  },
  {
    id: "desktop-bridge",
    name: "Windows/macOS 데스크톱 브리지",
    kind: "desktop_bridge",
    priority: "p0",
    oneTimeSetup: true,
    permissions: ["desktop_read", "desktop_control", "read_files", "write_files"],
    credentialPolicy: {
      secretStorage: "os_keychain",
      storesSecretMaterial: true,
      appMayPersistSecret: false,
      userMessage: "데스크톱 브리지 pairing secret은 OS 보안 저장소에 두고 명령 큐에는 저장하지 않습니다.",
    },
    riskLabel: "high",
    userValue: "기존 앱, 로컬 파일, 브라우저 업무 화면 옆에서 AI가 보조합니다.",
  },
  {
    id: "local-folder-index",
    name: "컴퓨터 자료 폴더",
    kind: "local_folder",
    priority: "p0",
    oneTimeSetup: false,
    permissions: ["read_files"],
    credentialPolicy: {
      secretStorage: "not_required",
      storesSecretMaterial: false,
      appMayPersistSecret: false,
      userMessage: "로컬 폴더 연결은 별도 secret 없이 사용자가 허용한 폴더 경계만 저장합니다.",
    },
    riskLabel: "medium",
    userValue: "컴퓨터에 보관된 업무 파일을 앱 안에서 검색합니다.",
  },
  {
    id: "local-cli-tools",
    name: "로컬 CLI 도구",
    kind: "cli_tool",
    priority: "p1",
    oneTimeSetup: true,
    permissions: ["cli_execution", "read_files"],
    credentialPolicy: {
      secretStorage: "local_env_reference",
      storesSecretMaterial: false,
      appMayPersistSecret: false,
      userMessage: "CLI credential은 로컬 환경 설정을 참조하고 앱 DB나 브라우저 storage에 복사하지 않습니다.",
    },
    riskLabel: "medium",
    userValue: "검증, 변환, 파일 처리 자동화를 로컬 도구로 실행합니다.",
  },
  {
    id: "line-kakao-channel",
    name: "LINE/KakaoTalk 정책 확인",
    kind: "messaging_channel",
    priority: "research",
    oneTimeSetup: true,
    permissions: ["read_messages", "send_draft"],
    credentialPolicy: {
      secretStorage: "os_keychain",
      storesSecretMaterial: true,
      appMayPersistSecret: false,
      userMessage: "공식 정책 확인 전까지 bot token이나 채널 secret을 앱에 저장하지 않습니다.",
    },
    riskLabel: "blocked",
    userValue: "LINE 공식 계정과 카카오톡 API/채널 정책을 확인한 뒤 고객 채널 후보로 검토합니다.",
  },
  {
    id: "social-business-messaging",
    name: "WhatsApp/Facebook/Instagram/Apple Business",
    kind: "messaging_channel",
    priority: "research",
    oneTimeSetup: true,
    permissions: ["read_messages", "send_draft", "send_external"],
    credentialPolicy: {
      secretStorage: "os_keychain",
      storesSecretMaterial: true,
      appMayPersistSecret: false,
      userMessage: "business API token, page access token, MSP credential은 공식 심사와 계정 연결 전까지 앱에 저장하지 않습니다.",
    },
    riskLabel: "high",
    userValue: "WhatsApp, Facebook Messenger, Instagram DM, Apple Messages for Business 같은 SNS/비즈니스 메시징 후보를 정책 기반으로 검토합니다.",
  },
  {
    id: "imessage-local-macos-bridge",
    name: "iMessage/macOS Messages 로컬 브리지",
    kind: "desktop_bridge",
    priority: "research",
    oneTimeSetup: true,
    permissions: ["desktop_read", "desktop_control", "send_draft"],
    credentialPolicy: {
      secretStorage: "not_required",
      storesSecretMaterial: false,
      appMayPersistSecret: false,
      userMessage: "개인 iMessage용 cloud bot token은 전제로 두지 않습니다. macOS Automation 권한과 사용자 현장 확인을 경계로 둡니다.",
    },
    riskLabel: "high",
    userValue: "사용자 Mac의 Messages 앱을 로컬 브리지로 보조하되, 자동 발송이 아니라 초안/열기/확인 중심으로 검토합니다.",
  },
];

export class ModyConnectorSetupRegistry {
  private readonly definitions = new Map(defaultConnectors.map((connector) => [connector.id, connector]));
  private readonly credentialVaultPolicy = new ModyCredentialVaultPolicy();

  listDefinitions(): ModyConnectorDefinition[] {
    return [...this.definitions.values()];
  }

  createSetupPlan(
    connectorId: string,
    connection: ModyConnectorConnection = {
      connectorId,
      status: "not_configured",
      grantedPermissions: [],
    },
  ): ModyConnectorSetupPlan {
    const connector = this.getDefinition(connectorId);
    const missingPermissions = connector.permissions.filter(
      (permission) => !connection.grantedPermissions.includes(permission),
    );
    const credentialBoundary = this.evaluateCredentialBoundary(connectorId, connection);
    const readyForAutomation =
      connection.status === "ready" &&
      missingPermissions.length === 0 &&
      connector.priority !== "research" &&
      credentialBoundary.readyForAutomation;

    return {
      connector,
      connection,
      readyForAutomation,
      needsUserAction: !readyForAutomation,
      steps: [
        {
          id: "install-or-connect",
          label: "연결 준비",
          status: connection.status === "not_configured" ? "needs_action" : "done",
          userMessage: connector.oneTimeSetup
            ? "처음 한 번만 연결하면 이후에는 상태만 점검합니다."
            : "사용할 때마다 연결 상태를 확인합니다.",
        },
        {
          id: "grant-permissions",
          label: "권한 승인",
          status: missingPermissions.length > 0 ? "needs_action" : "done",
          userMessage: missingPermissions.length > 0
            ? `필요 권한: ${missingPermissions.join(", ")}`
            : "필요 권한이 준비되어 있습니다.",
        },
        {
          id: "credential-boundary",
          label: "비밀정보 보관",
          status: credentialBoundary.readyForAutomation ? "done" : "needs_action",
          userMessage: credentialBoundary.userMessage,
        },
        {
          id: "health-check",
          label: "연결 상태 확인",
          status: connection.status === "ready" ? "done" : connection.status === "research_only" ? "blocked" : "needs_action",
          userMessage: statusMessageFor(connection),
        },
      ],
    };
  }

  createSettingsCard(
    connectorId: string,
    connection: ModyConnectorConnection = {
      connectorId,
      status: "not_configured",
      grantedPermissions: [],
    },
  ): ModyConnectorSettingsCard {
    const plan = this.createSetupPlan(connectorId, connection);
    const automationScope = connection.automationScope ?? defaultAutomationScopeFor(plan);
    const credentialBoundary = this.evaluateCredentialBoundary(connectorId, connection);

    return {
      connector: plan.connector,
      connection: plan.connection,
      statusLabel: statusLabelFor(connection.status),
      statusTone: statusToneFor(connection.status),
      automationScope,
      credentialBoundary,
      readyForAutomation: plan.readyForAutomation && credentialBoundary.readyForAutomation && automationScope !== "off",
      primaryAction: primaryActionFor(connection.status),
      secondaryActions: [
        {
          kind: "change_scope",
          label: "자동화 범위",
          requiresUserInteraction: true,
          userMessage: "읽기, 초안, 승인 후 실행 범위를 사용자가 직접 확인합니다.",
        },
        {
          kind: "view_policy",
          label: "권한 보기",
          requiresUserInteraction: false,
          userMessage: "현재 연결에 필요한 권한과 승인 정책을 보여줍니다.",
        },
      ],
    };
  }

  summarize(connections: ModyConnectorConnection[]): {
    ready: number;
    needsAction: number;
    disconnected: number;
    automationReadyConnectorIds: string[];
  } {
    const plans = connections.map((connection) => this.createSetupPlan(connection.connectorId, connection));

    return {
      ready: plans.filter((plan) => plan.readyForAutomation).length,
      needsAction: plans.filter((plan) => plan.needsUserAction).length,
      disconnected: connections.filter((connection) => connection.status === "disconnected" || connection.status === "error").length,
      automationReadyConnectorIds: plans
        .filter((plan) => plan.readyForAutomation)
        .map((plan) => plan.connector.id),
    };
  }

  evaluateCredentialBoundary(
    connectorId: string,
    connection: ModyConnectorConnection = {
      connectorId,
      status: "not_configured",
      grantedPermissions: [],
    },
  ): ModyConnectorCredentialBoundary {
    const connector = this.getDefinition(connectorId);
    const credentialStatus = credentialStatusFor(connector, connection);
    const readyForAutomation = credentialStatus === "not_required" || credentialStatus === "valid";

    return {
      connectorId,
      secretStorage: connector.credentialPolicy.secretStorage,
      credentialStatus,
      appMayPersistSecret: false,
      readyForAutomation,
      recoveryAction: recoveryActionFor(connection.status, credentialStatus),
      userMessage: credentialBoundaryMessageFor(connector, credentialStatus),
    };
  }

  createCredentialReference(
    connectorId: string,
    input: {
      secretKind: ModyCredentialSecretKind;
      storage?: ModyCredentialPersistenceLocation;
      referenceId?: string;
      displayLabel?: string;
      createdAt: ISODateTimeString;
      materialPresent?: boolean;
      metadata?: Record<string, unknown>;
    },
  ): ModyCredentialVaultDecision {
    const connector = this.getDefinition(connectorId);
    const referenceInput: {
      connectorId: string;
      secretKind: ModyCredentialSecretKind;
      storage: ModyCredentialPersistenceLocation;
      referenceId?: string;
      displayLabel?: string;
      createdAt: ISODateTimeString;
      materialPresent?: boolean;
      metadata?: Record<string, unknown>;
    } = {
      connectorId,
      secretKind: input.secretKind,
      storage: input.storage ?? connector.credentialPolicy.secretStorage,
      createdAt: input.createdAt,
    };

    if (input.referenceId) {
      referenceInput.referenceId = input.referenceId;
    }
    if (input.displayLabel) {
      referenceInput.displayLabel = input.displayLabel;
    }
    if (input.materialPresent !== undefined) {
      referenceInput.materialPresent = input.materialPresent;
    }
    if (input.metadata) {
      referenceInput.metadata = input.metadata;
    }

    return this.credentialVaultPolicy.createReference(referenceInput);
  }

  evaluatePermissionChange(
    connectorId: string,
    connection: ModyConnectorConnection,
    input: ModyConnectorPermissionChangeInput,
  ): ModyConnectorPermissionChangeReview {
    const connector = this.getDefinition(connectorId);
    const currentPermissions = uniquePermissions(connection.grantedPermissions);
    const requestedPermissions = uniquePermissions(input.requestedPermissions);
    const unsupportedPermissions = requestedPermissions.filter(
      (permission) => !connector.permissions.includes(permission),
    );
    const addedPermissions = requestedPermissions.filter((permission) => !currentPermissions.includes(permission));
    const removedPermissions = currentPermissions.filter((permission) => !requestedPermissions.includes(permission));
    const currentScope = connection.automationScope ?? defaultAutomationScopeFor({
      connector,
      connection,
      readyForAutomation: false,
      needsUserAction: true,
      steps: [],
    });
    const requestedAutomationScope = input.requestedAutomationScope ?? currentScope;
    const addsExternalMutation = addedPermissions.some(isExternalMutationPermission);
    const escalatesScope = scopeRank(requestedAutomationScope) > scopeRank(currentScope);

    if (connector.priority === "research" || connection.status === "research_only") {
      return {
        connector,
        currentPermissions,
        requestedPermissions,
        addedPermissions,
        removedPermissions,
        requestedAutomationScope,
        status: "blocked",
        riskLabel: "blocked",
        userMessage: "공식 정책 확인 전까지 이 연결의 권한 변경은 자동화에 반영하지 않습니다.",
      };
    }

    if (unsupportedPermissions.length > 0) {
      return {
        connector,
        currentPermissions,
        requestedPermissions,
        addedPermissions,
        removedPermissions,
        requestedAutomationScope,
        status: "blocked",
        riskLabel: "blocked",
        userMessage: `이 연결에서 지원하지 않는 권한이 포함되어 있습니다: ${unsupportedPermissions.join(", ")}`,
      };
    }

    if ((addsExternalMutation || escalatesScope) && connection.status !== "ready") {
      return {
        connector,
        currentPermissions,
        requestedPermissions,
        addedPermissions,
        removedPermissions,
        requestedAutomationScope,
        status: "blocked",
        riskLabel: "blocked",
        userMessage: "연결이 정상 상태가 아니므로 위험 권한 확대를 적용하지 않습니다. 먼저 재연결해야 합니다.",
      };
    }

    if (addsExternalMutation || escalatesScope) {
      return {
        connector,
        currentPermissions,
        requestedPermissions,
        addedPermissions,
        removedPermissions,
        requestedAutomationScope,
        status: "requires_user_confirmation",
        riskLabel: "high",
        userMessage: "외부 발송, 일정 등록, 파일 쓰기, OS 조작, CLI 실행으로 이어질 수 있어 사용자가 권한 변경을 다시 확인해야 합니다.",
      };
    }

    return {
      connector,
      currentPermissions,
      requestedPermissions,
      addedPermissions,
      removedPermissions,
      requestedAutomationScope,
      status: "safe",
      riskLabel: connector.riskLabel,
      userMessage: "위험 권한 확대 없이 설정을 조정할 수 있습니다.",
    };
  }

  private getDefinition(connectorId: string): ModyConnectorDefinition {
    const definition = this.definitions.get(connectorId);
    if (!definition) {
      throw new Error(`등록되지 않은 연결입니다: ${connectorId}`);
    }

    return definition;
  }
}

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

const automationScopeRanks: Record<ModyConnectorAutomationScope, number> = {
  off: 0,
  read_only: 1,
  draft_only: 2,
  approval_required_execution: 3,
};

function statusMessageFor(connection: ModyConnectorConnection): string {
  if (connection.status === "ready") return "연결이 정상입니다.";
  if (connection.status === "disconnected") {
    return connection.disconnectedReason ?? "연결이 끊어졌습니다. 다시 연결해야 합니다.";
  }
  if (connection.status === "error") return "연결 점검 중 오류가 발생했습니다.";
  if (connection.status === "needs_permission") return "권한 승인이 필요합니다.";
  if (connection.status === "research_only") return "정책 확인 전까지 자동화에 연결하지 않습니다.";
  return "아직 연결되지 않았습니다.";
}

function statusLabelFor(status: ModyConnectorStatus): string {
  if (status === "ready") return "연결됨";
  if (status === "needs_permission") return "권한 필요";
  if (status === "disconnected") return "재연결 필요";
  if (status === "error") return "오류";
  if (status === "research_only") return "정책 확인";
  return "연결 전";
}

function statusToneFor(status: ModyConnectorStatus): ModyConnectorSettingsCard["statusTone"] {
  if (status === "ready") return "ready";
  if (status === "disconnected" || status === "error") return "danger";
  if (status === "needs_permission" || status === "not_configured") return "warning";
  return "neutral";
}

function credentialStatusFor(
  connector: ModyConnectorDefinition,
  connection: ModyConnectorConnection,
): ModyConnectorCredentialHealthStatus {
  if (connector.credentialPolicy.secretStorage === "not_required") return "not_required";
  if (connection.credentialHealth) return connection.credentialHealth.status;
  if (connection.status === "ready") return "valid";
  if (connection.status === "disconnected" || connection.status === "error") return "unknown";
  return "missing";
}

function credentialBoundaryMessageFor(
  connector: ModyConnectorDefinition,
  credentialStatus: ModyConnectorCredentialHealthStatus,
): string {
  if (credentialStatus === "valid" || credentialStatus === "not_required") {
    return connector.credentialPolicy.userMessage;
  }

  if (credentialStatus === "expired") {
    return "credential이 만료되어 재연결 또는 회전이 필요합니다. 비밀정보는 앱 화면이나 localStorage에 저장하지 않습니다.";
  }

  if (credentialStatus === "revoked") {
    return "사용자가 권한을 철회했습니다. 재연결 전까지 자동화를 중단합니다.";
  }

  if (credentialStatus === "missing") {
    return "credential이 아직 연결되지 않았습니다. 연결 과정에서도 비밀정보 원문은 앱 상태에 저장하지 않습니다.";
  }

  return "credential 상태를 확인할 수 없습니다. 재연결 점검 전까지 자동화 준비로 보지 않습니다.";
}

function recoveryActionFor(
  connectionStatus: ModyConnectorStatus,
  credentialStatus: ModyConnectorCredentialHealthStatus,
): ModyConnectorCredentialBoundary["recoveryAction"] {
  if (credentialStatus === "valid" || credentialStatus === "not_required") return "none";
  if (credentialStatus === "expired" || credentialStatus === "revoked") return "rotate_secret";
  if (connectionStatus === "disconnected" || connectionStatus === "error") return "reconnect";
  if (connectionStatus === "needs_permission") return "grant_permissions";
  return "connect";
}

function primaryActionFor(status: ModyConnectorStatus): ModyConnectorSettingsAction {
  if (status === "ready") {
    return {
      kind: "change_scope",
      label: "범위 수정",
      requiresUserInteraction: true,
      userMessage: "이 연결이 어디까지 자동화할 수 있는지 조정합니다.",
    };
  }

  if (status === "needs_permission") {
    return {
      kind: "grant_permissions",
      label: "권한 허용",
      requiresUserInteraction: true,
      userMessage: "부족한 권한을 사용자가 직접 확인하고 허용합니다.",
    };
  }

  if (status === "disconnected" || status === "error") {
    return {
      kind: "reconnect",
      label: "다시 연결",
      requiresUserInteraction: true,
      userMessage: "끊긴 OAuth, MCP, CLI, 데스크톱 브리지 연결을 다시 점검합니다.",
    };
  }

  if (status === "research_only") {
    return {
      kind: "view_policy",
      label: "정책 확인",
      requiresUserInteraction: false,
      userMessage: "공식 정책 확인 전까지 자동화 실행에 연결하지 않습니다.",
    };
  }

  return {
    kind: "connect",
    label: "연결하기",
    requiresUserInteraction: true,
    userMessage: "처음 한 번 연결하고 필요한 권한만 허용합니다.",
  };
}

function defaultAutomationScopeFor(plan: ModyConnectorSetupPlan): ModyConnectorAutomationScope {
  if (!plan.readyForAutomation) return "off";

  const permissions = plan.connector.permissions;
  const canMutateExternalSystem = permissions.some((permission) => [
    "send_external",
    "write_calendar",
    "write_files",
    "desktop_control",
    "cli_execution",
    "write_booking_hold",
    "write_inventory",
    "send_sms",
  ].includes(permission));

  if (canMutateExternalSystem) return "approval_required_execution";
  if (permissions.includes("send_draft")) return "draft_only";
  return "read_only";
}

function uniquePermissions(permissions: ModyConnectorPermission[]): ModyConnectorPermission[] {
  return [...new Set(permissions)];
}

function isExternalMutationPermission(permission: ModyConnectorPermission): boolean {
  return externalMutationPermissions.includes(permission);
}

function scopeRank(scope: ModyConnectorAutomationScope): number {
  return automationScopeRanks[scope];
}
