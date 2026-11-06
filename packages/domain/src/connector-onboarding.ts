import { ModyConnectorSetupRegistry } from "./connector-setup.js";
import type {
  ModyConnectorAutomationScope,
  ModyConnectorConnection,
  ModyConnectorDefinition,
  ModyConnectorPermission,
} from "./connector-setup.js";

export type ModyConnectorOnboardingCredentialKind =
  | "oauth_refresh_token"
  | "bot_token"
  | "oauth_bot_token"
  | "channel_access_token"
  | "business_api_token"
  | "page_access_token"
  | "msp_business_account"
  | "bot_webhook_secret"
  | "pairing_secret"
  | "local_desktop_permission"
  | "folder_permission"
  | "mcp_config_reference"
  | "local_env_reference"
  | "not_required";

export type ModyConnectorOnboardingSurface =
  | "provider_console"
  | "webhook_endpoint"
  | "os_settings"
  | "desktop_shell"
  | "local_folder_picker"
  | "mcp_config"
  | "cli_environment"
  | "mody_settings"
  | "policy_review";

export type ModyConnectorOnboardingTaskKind =
  | "review_policy"
  | "create_provider_app"
  | "configure_webhook"
  | "grant_permissions"
  | "capture_credential_reference"
  | "store_secret_reference"
  | "run_health_check"
  | "set_automation_scope";

export type ModyConnectorOnboardingTaskStatus =
  | "done"
  | "available"
  | "needs_user_action"
  | "blocked";

export type ModyConnectorOnboardingTask = {
  id: string;
  connectorId: string;
  kind: ModyConnectorOnboardingTaskKind;
  label: string;
  surface: ModyConnectorOnboardingSurface;
  status: ModyConnectorOnboardingTaskStatus;
  credentialKind?: ModyConnectorOnboardingCredentialKind;
  safeToRunAutomatically: boolean;
  requiresUserInteraction: boolean;
  blocksAutomation: boolean;
  webhookRequired: boolean;
  commandHint?: string;
  userMessage: string;
  expectedProof: string;
};

export type ModyConnectorOnboardingSummary = {
  totalTasks: number;
  done: number;
  available: number;
  needsUserAction: number;
  blocked: number;
  canStartAutomatically: boolean;
  policyBlocked: boolean;
  nextTaskId?: string;
};

export type ModyConnectorOnboardingRecipe = {
  connectorId: string;
  connectorName: string;
  priority: ModyConnectorDefinition["priority"];
  credentialKinds: ModyConnectorOnboardingCredentialKind[];
  webhookRequired: boolean;
  initialAutomationScope: ModyConnectorAutomationScope;
  policyBlocked: boolean;
  appMayPersistSecret: false;
  tasks: ModyConnectorOnboardingTask[];
  summary: ModyConnectorOnboardingSummary;
  userMessage: string;
};

export type ModyConnectorOnboardingInput = {
  connectorIds?: string[];
  connections?: ModyConnectorConnection[];
  includeResearch?: boolean;
};

export class ModyConnectorOnboardingPlanner {
  constructor(private readonly registry = new ModyConnectorSetupRegistry()) {}

  createRecipes(input: ModyConnectorOnboardingInput = {}): ModyConnectorOnboardingRecipe[] {
    const connectionMap = new Map((input.connections ?? []).map((connection) => [connection.connectorId, connection]));
    const requestedConnectorIds = new Set(input.connectorIds ?? []);

    return this.registry.listDefinitions()
      .filter((definition) => {
        if (requestedConnectorIds.size > 0) return requestedConnectorIds.has(definition.id);
        if (definition.priority === "research") return Boolean(input.includeResearch);
        return true;
      })
      .map((definition) => this.createRecipe(
        definition.id,
        connectionMap.get(definition.id) ?? defaultConnectionFor(definition.id),
      ));
  }

  createRecipe(
    connectorId: string,
    connection: ModyConnectorConnection = defaultConnectionFor(connectorId),
  ): ModyConnectorOnboardingRecipe {
    const definition = getDefinition(this.registry, connectorId);
    const profile = onboardingProfileFor(definition);
    const policyBlocked = definition.priority === "research" || connection.status === "research_only";
    const tasks = createTasks(definition, connection, profile, policyBlocked);
    const nextTask = tasks.find((task) => task.status === "needs_user_action" || task.status === "available")
      ?? tasks.find((task) => task.status === "blocked");

    return {
      connectorId: definition.id,
      connectorName: definition.name,
      priority: definition.priority,
      credentialKinds: profile.credentialKinds,
      webhookRequired: profile.webhookRequired,
      initialAutomationScope: initialAutomationScopeFor(definition, policyBlocked),
      policyBlocked,
      appMayPersistSecret: false,
      tasks,
      summary: {
        totalTasks: tasks.length,
        done: tasks.filter((task) => task.status === "done").length,
        available: tasks.filter((task) => task.status === "available").length,
        needsUserAction: tasks.filter((task) => task.status === "needs_user_action").length,
        blocked: tasks.filter((task) => task.status === "blocked").length,
        canStartAutomatically: tasks.some((task) => task.status === "available" && task.safeToRunAutomatically),
        policyBlocked,
        ...(nextTask ? { nextTaskId: nextTask.id } : {}),
      },
      userMessage: policyBlocked
        ? "공식 정책과 사용자 권한 경계를 확인하기 전까지 연결 실행 계획은 자동화에 붙지 않습니다."
        : "연결 실행 계획은 provider 동의, credential 참조, 권한, health check를 나누고 비밀정보 원문을 저장하지 않습니다.",
    };
  }
}

type OnboardingProfile = {
  credentialKinds: ModyConnectorOnboardingCredentialKind[];
  webhookRequired: boolean;
  providerSurface: ModyConnectorOnboardingSurface;
  commandHint?: string;
};

function onboardingProfileFor(definition: ModyConnectorDefinition): OnboardingProfile {
  if (
    definition.id === "gmail-outlook-mail" ||
    definition.id === "calendar-google-outlook" ||
    definition.id === "business-inquiry-inbox" ||
    definition.id === "booking-platform-hub" ||
    definition.id === "notion-workspace" ||
    definition.id === "figma-design"
  ) {
    return {
      credentialKinds: definition.id === "business-inquiry-inbox" || definition.id === "booking-platform-hub"
        ? ["oauth_refresh_token", "bot_webhook_secret"]
        : ["oauth_refresh_token"],
      webhookRequired: definition.id === "business-inquiry-inbox" || definition.id === "booking-platform-hub",
      providerSurface: "provider_console",
    };
  }

  if (definition.id === "slack-app") {
    return {
      credentialKinds: ["oauth_bot_token", "bot_webhook_secret"],
      webhookRequired: true,
      providerSurface: "provider_console",
    };
  }

  if (
    definition.id === "telegram-bot" ||
    definition.id === "discord-app" ||
    definition.id === "naver-works-bot"
  ) {
    return {
      credentialKinds: ["bot_token", "bot_webhook_secret"],
      webhookRequired: true,
      providerSurface: "provider_console",
    };
  }

  if (definition.id === "line-kakao-channel") {
    return {
      credentialKinds: ["channel_access_token", "bot_token", "bot_webhook_secret"],
      webhookRequired: true,
      providerSurface: "policy_review",
    };
  }

  if (definition.id === "social-business-messaging") {
    return {
      credentialKinds: ["business_api_token", "page_access_token", "msp_business_account"],
      webhookRequired: true,
      providerSurface: "policy_review",
    };
  }

  if (definition.id === "imessage-local-macos-bridge") {
    return {
      credentialKinds: ["local_desktop_permission"],
      webhookRequired: false,
      providerSurface: "os_settings",
    };
  }

  if (definition.id === "desktop-bridge") {
    return {
      credentialKinds: ["pairing_secret", "local_desktop_permission"],
      webhookRequired: false,
      providerSurface: "desktop_shell",
      commandHint: "mody bridge doctor",
    };
  }

  if (definition.id === "local-folder-index") {
    return {
      credentialKinds: ["folder_permission"],
      webhookRequired: false,
      providerSurface: "local_folder_picker",
    };
  }

  if (definition.id === "web-search-mcp") {
    return {
      credentialKinds: ["mcp_config_reference"],
      webhookRequired: false,
      providerSurface: "mcp_config",
      commandHint: "mody setup connector web-search-mcp",
    };
  }

  if (definition.id === "local-cli-tools") {
    return {
      credentialKinds: ["local_env_reference"],
      webhookRequired: false,
      providerSurface: "cli_environment",
      commandHint: "mody doctor cli-tools",
    };
  }

  return {
    credentialKinds: ["not_required"],
    webhookRequired: false,
    providerSurface: "mody_settings",
  };
}

function createTasks(
  definition: ModyConnectorDefinition,
  connection: ModyConnectorConnection,
  profile: OnboardingProfile,
  policyBlocked: boolean,
): ModyConnectorOnboardingTask[] {
  const credentialKind = profile.credentialKinds[0] ?? "not_required";
  const missingPermissions = definition.permissions.filter(
    (permission) => !connection.grantedPermissions.includes(permission),
  );
  const credentialReady = definition.credentialPolicy.secretStorage === "not_required"
    || connection.credentialHealth?.status === "valid"
    || connection.status === "ready";

  return [
    createTask({
      definition,
      kind: "review_policy",
      label: policyBlocked ? "공식 정책 확인" : "연결 정책 적용",
      surface: policyBlocked ? "policy_review" : "mody_settings",
      status: policyBlocked ? "blocked" : "done",
      credentialKind,
      policyBlocked,
      webhookRequired: profile.webhookRequired,
      userMessage: policyBlocked
        ? "공식 API, 앱 심사, 사용자 opt-in 또는 OS 권한 조건을 확인하기 전까지 자동화에 연결하지 않습니다."
        : "승인 정책, credential vault, 자동화 범위 기준을 이 연결에 적용합니다.",
      expectedProof: policyBlocked ? "정책 검토 기록과 허용 범위" : "Mody 정책 버전과 연결 정의",
    }),
    createTask({
      definition,
      kind: "create_provider_app",
      label: providerTaskLabelFor(definition),
      surface: profile.providerSurface,
      status: providerStatusFor(definition, connection, policyBlocked),
      credentialKind,
      policyBlocked,
      webhookRequired: profile.webhookRequired,
      commandHint: profile.commandHint,
      userMessage: providerMessageFor(definition),
      expectedProof: providerProofFor(definition),
    }),
    createTask({
      definition,
      kind: "configure_webhook",
      label: "Webhook/수신 경로",
      surface: profile.webhookRequired ? "webhook_endpoint" : profile.providerSurface,
      status: profile.webhookRequired
        ? policyBlocked ? "blocked" : "needs_user_action"
        : "done",
      credentialKind: profile.webhookRequired ? "bot_webhook_secret" : credentialKind,
      policyBlocked,
      webhookRequired: profile.webhookRequired,
      userMessage: profile.webhookRequired
        ? "공개 HTTPS webhook URL과 검증 secret을 준비하되 원문 secret은 앱 화면에 남기지 않습니다."
        : "이 연결은 V1 설정에서 별도 webhook이 핵심 요구사항이 아닙니다.",
      expectedProof: profile.webhookRequired ? "검증된 webhook endpoint와 signature 검증" : "webhook 불필요 사유",
    }),
    createTask({
      definition,
      kind: "grant_permissions",
      label: "권한 허용",
      surface: permissionSurfaceFor(definition),
      status: missingPermissions.length === 0 && connection.status !== "not_configured"
        ? "done"
        : policyBlocked ? "blocked" : "needs_user_action",
      credentialKind,
      policyBlocked,
      webhookRequired: profile.webhookRequired,
      userMessage: missingPermissions.length > 0
        ? `사용자가 확인해야 할 권한: ${missingPermissions.join(", ")}`
        : "필요 권한이 준비되어 있습니다.",
      expectedProof: "사용자가 허용한 scope와 granted permission 목록",
    }),
    createTask({
      definition,
      kind: "capture_credential_reference",
      label: "Credential 참조 만들기",
      surface: credentialSurfaceFor(definition),
      status: credentialReady ? "done" : policyBlocked ? "blocked" : "needs_user_action",
      credentialKind,
      policyBlocked,
      webhookRequired: profile.webhookRequired,
      userMessage: "token, secret, pairing 값 원문은 저장하지 않고 OS 보안 저장소나 외부 설정의 referenceId만 기록합니다.",
      expectedProof: "rawSecretMaterialStored=false, appMayPersistSecret=false",
    }),
    createTask({
      definition,
      kind: "store_secret_reference",
      label: "비밀정보 저장 경계",
      surface: "mody_settings",
      status: credentialReady ? "done" : policyBlocked ? "blocked" : "needs_user_action",
      credentialKind,
      policyBlocked,
      webhookRequired: profile.webhookRequired,
      userMessage: definition.credentialPolicy.userMessage,
      expectedProof: `secretStorage=${definition.credentialPolicy.secretStorage}`,
    }),
    createTask({
      definition,
      kind: "run_health_check",
      label: "Health check",
      surface: healthSurfaceFor(definition),
      status: connection.status === "ready"
        ? "done"
        : policyBlocked ? "blocked" : healthCheckStatusFor(definition),
      credentialKind,
      policyBlocked,
      webhookRequired: profile.webhookRequired,
      commandHint: profile.commandHint,
      userMessage: "연결 상태만 읽고 provider 설정, OS 권한, token 값을 변경하지 않습니다.",
      expectedProof: "마지막 health check 시각과 오류 사유",
    }),
    createTask({
      definition,
      kind: "set_automation_scope",
      label: "자동화 범위 고정",
      surface: "mody_settings",
      status: policyBlocked ? "blocked" : "needs_user_action",
      credentialKind,
      policyBlocked,
      webhookRequired: profile.webhookRequired,
      userMessage: automationScopeMessageFor(definition.permissions),
      expectedProof: `initialAutomationScope=${initialAutomationScopeFor(definition, policyBlocked)}`,
    }),
  ];
}

function createTask(input: {
  definition: ModyConnectorDefinition;
  kind: ModyConnectorOnboardingTaskKind;
  label: string;
  surface: ModyConnectorOnboardingSurface;
  status: ModyConnectorOnboardingTaskStatus;
  credentialKind: ModyConnectorOnboardingCredentialKind;
  policyBlocked: boolean;
  webhookRequired: boolean;
  commandHint?: string | undefined;
  userMessage: string;
  expectedProof: string;
}): ModyConnectorOnboardingTask {
  const safeToRunAutomatically = input.kind === "run_health_check"
    && !input.policyBlocked
    && (input.definition.kind === "mcp_server" || input.definition.kind === "cli_tool");

  return {
    id: `${input.definition.id}:${input.kind}`,
    connectorId: input.definition.id,
    kind: input.kind,
    label: input.label,
    surface: input.surface,
    status: input.status,
    credentialKind: input.credentialKind,
    safeToRunAutomatically,
    requiresUserInteraction: input.status === "needs_user_action" || input.status === "blocked",
    blocksAutomation: input.status === "blocked" || input.status === "needs_user_action",
    webhookRequired: input.webhookRequired,
    ...(input.commandHint ? { commandHint: input.commandHint } : {}),
    userMessage: input.userMessage,
    expectedProof: input.expectedProof,
  };
}

function providerStatusFor(
  definition: ModyConnectorDefinition,
  connection: ModyConnectorConnection,
  policyBlocked: boolean,
): ModyConnectorOnboardingTaskStatus {
  if (connection.status === "ready") return "done";
  if (policyBlocked) return "blocked";
  if (definition.kind === "mcp_server" || definition.kind === "cli_tool") return "available";
  return "needs_user_action";
}

function providerTaskLabelFor(definition: ModyConnectorDefinition): string {
  if (definition.kind === "oauth_api") return "Provider OAuth 앱";
  if (definition.kind === "messaging_channel") return "채널 앱/token 준비";
  if (definition.kind === "desktop_bridge") return "로컬 브리지 준비";
  if (definition.kind === "local_folder") return "허용 폴더 선택";
  if (definition.kind === "mcp_server") return "MCP 설정 확인";
  if (definition.kind === "cli_tool") return "CLI 환경 확인";
  return "연결 구성";
}

function providerMessageFor(definition: ModyConnectorDefinition): string {
  if (definition.id === "social-business-messaging") {
    return "Meta/Apple business 계정, page access token, business API token, MSP 연결 가능성을 정책 기준으로 확인합니다.";
  }
  if (definition.id === "imessage-local-macos-bridge") {
    return "개인 iMessage cloud bot token은 전제로 두지 않고 사용자 Mac의 Messages 앱과 macOS Automation 권한을 검토합니다.";
  }
  if (definition.kind === "oauth_api") return "사용자가 provider OAuth 동의 화면에서 필요한 scope만 허용합니다.";
  if (definition.kind === "messaging_channel") return "bot token, channel access token, webhook secret은 사용자가 만든 채널에서 가져옵니다.";
  if (definition.kind === "desktop_bridge") return "데스크톱 앱과 로컬 브리지 pairing을 사용자가 확인합니다.";
  if (definition.kind === "local_folder") return "사용자가 직접 허용 폴더를 선택합니다.";
  if (definition.kind === "mcp_server") return "MCP 설정 파일과 서버 health를 확인합니다.";
  if (definition.kind === "cli_tool") return "로컬 CLI가 있는지만 점검하고 전역 설정은 바꾸지 않습니다.";
  return "연결 구성을 확인합니다.";
}

function providerProofFor(definition: ModyConnectorDefinition): string {
  if (definition.kind === "oauth_api") return "OAuth client와 consent scope";
  if (definition.kind === "messaging_channel") return "채널 ID, webhook URL, token reference";
  if (definition.kind === "desktop_bridge") return "pairing 상태와 OS 권한";
  if (definition.kind === "local_folder") return "허용 폴더 절대경로";
  if (definition.kind === "mcp_server") return "MCP 서버 health";
  if (definition.kind === "cli_tool") return "CLI version check";
  return "연결 설정 기록";
}

function permissionSurfaceFor(definition: ModyConnectorDefinition): ModyConnectorOnboardingSurface {
  if (definition.kind === "desktop_bridge") return "os_settings";
  if (definition.kind === "local_folder") return "local_folder_picker";
  if (definition.kind === "mcp_server") return "mcp_config";
  if (definition.kind === "cli_tool") return "cli_environment";
  if (definition.priority === "research") return "policy_review";
  return "provider_console";
}

function credentialSurfaceFor(definition: ModyConnectorDefinition): ModyConnectorOnboardingSurface {
  if (definition.credentialPolicy.secretStorage === "external_mcp_config") return "mcp_config";
  if (definition.credentialPolicy.secretStorage === "local_env_reference") return "cli_environment";
  if (definition.credentialPolicy.secretStorage === "not_required") {
    return definition.kind === "local_folder" ? "local_folder_picker" : "os_settings";
  }
  return "mody_settings";
}

function healthSurfaceFor(definition: ModyConnectorDefinition): ModyConnectorOnboardingSurface {
  if (definition.kind === "desktop_bridge") return "desktop_shell";
  if (definition.kind === "mcp_server") return "mcp_config";
  if (definition.kind === "cli_tool") return "cli_environment";
  if (definition.kind === "local_folder") return "local_folder_picker";
  return definition.priority === "research" ? "policy_review" : "provider_console";
}

function healthCheckStatusFor(definition: ModyConnectorDefinition): ModyConnectorOnboardingTaskStatus {
  if (definition.kind === "mcp_server" || definition.kind === "cli_tool") return "available";
  return "needs_user_action";
}

function initialAutomationScopeFor(
  definition: ModyConnectorDefinition,
  policyBlocked: boolean,
): ModyConnectorAutomationScope {
  if (policyBlocked) return "off";
  if (definition.permissions.some(isExternalMutationPermission)) return "approval_required_execution";
  if (definition.permissions.includes("send_draft")) return "draft_only";
  if (definition.permissions.length > 0) return "read_only";
  return "off";
}

function automationScopeMessageFor(permissions: ModyConnectorPermission[]): string {
  if (permissions.some(isExternalMutationPermission)) {
    return "외부 발송, 일정 등록, 예약 확정/변경, 재고 수정, 문자 발송, 파일 쓰기, OS 조작, CLI 실행은 승인 후 실행 범위로만 켭니다.";
  }
  if (permissions.includes("send_draft")) return "초안과 명령 기록까지만 먼저 켭니다.";
  return "읽기 전용부터 켭니다.";
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

function getDefinition(
  registry: ModyConnectorSetupRegistry,
  connectorId: string,
): ModyConnectorDefinition {
  const definition = registry.listDefinitions().find((candidate) => candidate.id === connectorId);
  if (!definition) throw new Error(`등록되지 않은 연결입니다: ${connectorId}`);
  return definition;
}

function defaultConnectionFor(connectorId: string): ModyConnectorConnection {
  return {
    connectorId,
    status: "not_configured",
    grantedPermissions: [],
  };
}
