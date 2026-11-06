import {
  ModyCredentialVaultPolicy,
  type ModyCredentialSecretKind,
  type ModyCredentialVaultDecision,
} from "./connector-credential-vault.js";
import type { ISODateTimeString } from "./types.js";

export type ModyQuickConnectMethod =
  | "bot_token"
  | "api_key"
  | "oauth"
  | "site_login"
  | "imap_smtp"
  | "api_key_or_oauth"
  | "local_permission"
  | "manual_provider";

export type ModyQuickConnectDraftStatus =
  | "needs_credential"
  | "needs_warning_confirmation"
  | "needs_user_presence"
  | "ready_for_health_check"
  | "blocked";

export type ModyQuickConnectToolProfile = {
  id: string;
  label: string;
  iconLabel: string;
  method: ModyQuickConnectMethod;
  credentialKind: ModyCredentialSecretKind;
  inputLabel: string;
  helpText: string;
  officialFirst: boolean;
  warning?: string;
  healthCheck: string;
};

export type ModyQuickConnectInput = {
  toolId: string;
  method?: ModyQuickConnectMethod;
  credentialCaptured?: boolean;
  credentialReferenceId?: string;
  warningAccepted?: boolean;
  userPresenceConfirmed?: boolean;
  createdAt: ISODateTimeString;
};

export type ModyQuickConnectDraft = {
  tool: ModyQuickConnectToolProfile;
  method: ModyQuickConnectMethod;
  status: ModyQuickConnectDraftStatus;
  credentialDecision: ModyCredentialVaultDecision;
  credentialReferenceId?: string;
  appMayPersistSecret: false;
  rawSecretMaterialStored: false;
  steps: string[];
  userMessage: string;
  auditMessages: string[];
};

export const modyQuickConnectToolProfiles: ModyQuickConnectToolProfile[] = [
  {
    id: "telegram-bot",
    label: "Telegram Bot",
    iconLabel: "TG",
    method: "bot_token",
    credentialKind: "bot_token",
    inputLabel: "Bot token",
    helpText: "BotFather에서 받은 bot token을 OS 보안 저장소에 넣고 getMe/webhook 상태만 확인합니다.",
    officialFirst: true,
    healthCheck: "Telegram Bot API getMe와 webhook 상태 확인",
  },
  {
    id: "line-messaging",
    label: "LINE Messaging API",
    iconLabel: "LI",
    method: "api_key",
    credentialKind: "api_key",
    inputLabel: "Channel access token",
    helpText: "LINE Official Account의 channel access token을 참조로 저장하고 Messaging API 상태를 확인합니다.",
    officialFirst: true,
    healthCheck: "LINE Messaging API channel 상태와 webhook 검증",
  },
  {
    id: "kakao-channel",
    label: "Kakao Channel/API",
    iconLabel: "KA",
    method: "oauth",
    credentialKind: "oauth_refresh_token",
    inputLabel: "OAuth/API credential",
    helpText: "카카오 개발자 앱의 REST API/OAuth 동의를 우선 사용하고, 채널 정책 확인 후 수신/초안/승인 흐름에 연결합니다.",
    officialFirst: true,
    healthCheck: "Kakao OAuth callback, scope, channel permission 확인",
  },
  {
    id: "naver-login",
    label: "NAVER Login/API",
    iconLabel: "N",
    method: "oauth",
    credentialKind: "oauth_refresh_token",
    inputLabel: "OAuth client",
    helpText: "네이버 아이디로 로그인과 공식 Open API 권한을 우선 연결합니다.",
    officialFirst: true,
    healthCheck: "NAVER OAuth callback, scope, 연결 계정 확인",
  },
  {
    id: "naver-site-session",
    label: "NAVER 사이트 로그인",
    iconLabel: "N",
    method: "site_login",
    credentialKind: "browser_session_reference",
    inputLabel: "아이디/비밀번호",
    helpText: "공식 API/OAuth가 없는 관리 화면은 격리 브라우저 세션과 OS 보안 저장소 reference로만 다룹니다.",
    officialFirst: false,
    warning: "사이트 로그인 자동화는 약관, 2단계 인증, 계정 잠금, 개인정보 노출 위험이 있습니다. 공식 API/OAuth가 있으면 그것을 우선 사용해야 합니다.",
    healthCheck: "격리 브라우저 세션 열기, 로그인 성공 여부, 사용자 현장 확인",
  },
  {
    id: "slack-app",
    label: "Slack App",
    iconLabel: "SL",
    method: "oauth",
    credentialKind: "oauth_refresh_token",
    inputLabel: "OAuth install",
    helpText: "Slack OAuth install과 slash command를 앱 최종 확인 경계로 연결합니다.",
    officialFirst: true,
    healthCheck: "Slack OAuth workspace, command endpoint, signing secret reference 확인",
  },
  {
    id: "gmail-outlook-mail",
    label: "Gmail/Outlook Mail",
    iconLabel: "M",
    method: "oauth",
    credentialKind: "oauth_refresh_token",
    inputLabel: "OAuth consent",
    helpText: "메일은 OAuth 읽기 권한부터 연결하고 답장 발송은 승인 후 실행으로 둡니다.",
    officialFirst: true,
    healthCheck: "read-only mail scope, callback state, credential reference 확인",
  },
  {
    id: "gmail-imap",
    label: "Gmail IMAP",
    iconLabel: "GM",
    method: "imap_smtp",
    credentialKind: "api_key",
    inputLabel: "Gmail 앱 비밀번호",
    helpText: "IMAP read-only probe로 최신 메일 envelope만 확인합니다. Gmail API OAuth는 별도 OAuth 앱 등록 후 연결합니다.",
    officialFirst: true,
    healthCheck: "imap.gmail.com:993 read-only probe",
  },
  {
    id: "outlook-graph-mail",
    label: "Outlook / Microsoft 365",
    iconLabel: "MS",
    method: "oauth",
    credentialKind: "oauth_refresh_token",
    inputLabel: "Microsoft OAuth",
    helpText: "Microsoft Graph Mail.Read부터 연결하고 Mail.Send는 승인 후 실행 권한으로 분리합니다.",
    officialFirst: true,
    healthCheck: "Microsoft Graph Mail scope, tenant consent, callback state 확인",
  },
  {
    id: "naver-mail-imap",
    label: "NAVER Mail",
    iconLabel: "N",
    method: "imap_smtp",
    credentialKind: "api_key",
    inputLabel: "NAVER 앱 비밀번호",
    helpText: "NAVER IMAP/SMTP 사용 설정 후 imap.naver.com read-only probe로 문의 메일 수신을 확인합니다.",
    officialFirst: true,
    healthCheck: "imap.naver.com:993 read-only probe",
  },
  {
    id: "daum-kakao-mail-imap",
    label: "Daum/Kakao Mail",
    iconLabel: "KA",
    method: "imap_smtp",
    credentialKind: "api_key",
    inputLabel: "Kakao 앱 비밀번호",
    helpText: "2단계 인증과 앱 비밀번호를 사용해 imap.kakao.com read-only probe로 메일 접속을 확인합니다.",
    officialFirst: true,
    healthCheck: "imap.kakao.com:993 read-only probe",
  },
  {
    id: "company-mail-imap",
    label: "회사/그룹웨어 메일",
    iconLabel: "CO",
    method: "imap_smtp",
    credentialKind: "api_key",
    inputLabel: "IMAP host와 앱 비밀번호",
    helpText: "회사 전용 메일은 Google Workspace, Microsoft 365, 그룹웨어, 호스팅 메일 중 실제 provider를 고른 뒤 읽기부터 확인합니다.",
    officialFirst: true,
    healthCheck: "custom IMAP host read-only probe 또는 OAuth tenant consent 확인",
  },
  {
    id: "public-agency-mail",
    label: "공공기관/보안 메일",
    iconLabel: "GOV",
    method: "manual_provider",
    credentialKind: "cli_credential_reference",
    inputLabel: "기관 제공 방식",
    helpText: "기관별 보안 정책, 망분리, 관리자 승인이 필요하므로 자동 credential 저장 없이 검토 티켓부터 만듭니다.",
    officialFirst: true,
    warning: "공공기관 메일은 기관 정책 확인 전 자동 로그인, 발송, 수집 자동화를 켜면 안 됩니다.",
    healthCheck: "기관별 테스트 계정, read-only 허용 범위, 보안 책임자 승인 확인",
  },
  {
    id: "calendar-google-outlook",
    label: "Google/Outlook Calendar",
    iconLabel: "C",
    method: "oauth",
    credentialKind: "oauth_refresh_token",
    inputLabel: "OAuth consent",
    helpText: "캘린더는 FreeBusy/읽기부터 연결하고 일정 등록은 승인 후 실행 후보로만 만듭니다.",
    officialFirst: true,
    healthCheck: "calendar read/freebusy scope, callback state, credential reference 확인",
  },
  {
    id: "whatsapp-business",
    label: "WhatsApp Business Platform",
    iconLabel: "WA",
    method: "api_key",
    credentialKind: "api_key",
    inputLabel: "Business API token",
    helpText: "Meta WhatsApp Cloud API는 business app, phone number, webhook, customer opt-in 확인 뒤 연결합니다.",
    officialFirst: true,
    warning: "WhatsApp은 개인 계정 자동화가 아니라 Business Platform 정책과 webhook 검토가 필요합니다.",
    healthCheck: "Meta app, phone number id, webhook verify token, messages subscription 확인",
  },
  {
    id: "facebook-messenger-page",
    label: "Facebook Messenger Page",
    iconLabel: "FB",
    method: "oauth",
    credentialKind: "oauth_refresh_token",
    inputLabel: "Page access token",
    helpText: "Facebook Page와 Messenger Platform webhook을 연결하고 고객 응답 정책을 확인합니다.",
    officialFirst: true,
    warning: "Page access token과 app review 상태 없이는 실제 고객 메시지 자동화를 켜지 않습니다.",
    healthCheck: "Page subscription, webhook callback, app review 상태 확인",
  },
  {
    id: "instagram-messaging",
    label: "Instagram Messaging",
    iconLabel: "IG",
    method: "oauth",
    credentialKind: "oauth_refresh_token",
    inputLabel: "Meta OAuth",
    helpText: "Instagram professional account와 Meta webhook/app review를 확인해 DM 문의 수신 후보로 연결합니다.",
    officialFirst: true,
    warning: "Instagram DM 자동화는 professional account, permissions, app review, 고객 opt-in 정책 확인이 필요합니다.",
    healthCheck: "Instagram account link, webhook fields, app review 상태 확인",
  },
  {
    id: "naver-works-bot",
    label: "NAVER WORKS Bot",
    iconLabel: "NW",
    method: "api_key",
    credentialKind: "api_key",
    inputLabel: "Bot/API credential",
    helpText: "NAVER WORKS tenant 관리자 권한과 bot credential을 확인해 팀 보고 채널로 연결합니다.",
    officialFirst: true,
    healthCheck: "tenant id, bot id, callback/webhook, 관리자 승인 확인",
  },
  {
    id: "discord-app",
    label: "Discord App",
    iconLabel: "DI",
    method: "oauth",
    credentialKind: "oauth_refresh_token",
    inputLabel: "OAuth install",
    helpText: "Discord Application Commands와 interaction endpoint를 앱 최종 확인 경계로 연결합니다.",
    officialFirst: true,
    healthCheck: "Discord OAuth2 install, application command, interaction endpoint 확인",
  },
  {
    id: "notion-workspace",
    label: "Notion",
    iconLabel: "NO",
    method: "oauth",
    credentialKind: "oauth_refresh_token",
    inputLabel: "OAuth 또는 integration token",
    helpText: "Notion 문서와 DB는 OAuth/internal integration reference로 읽기부터 연결합니다.",
    officialFirst: true,
    healthCheck: "Notion workspace authorization, database/page read 권한 확인",
  },
  {
    id: "figma-design",
    label: "Figma",
    iconLabel: "FI",
    method: "oauth",
    credentialKind: "oauth_refresh_token",
    inputLabel: "OAuth 또는 token",
    helpText: "Figma 파일 읽기와 comment/handoff 후보를 분리하고 쓰기는 승인 후 실행으로 둡니다.",
    officialFirst: true,
    healthCheck: "Figma OAuth/PAT reference, file read 권한 확인",
  },
  {
    id: "gemini-ai",
    label: "Google Gemini",
    iconLabel: "GE",
    method: "api_key",
    credentialKind: "api_key",
    inputLabel: "Gemini API key",
    helpText: "Google AI Studio에서 만든 Gemini API key를 OS 보안 저장소 reference로만 기록하고 generateContent health check를 실행합니다.",
    officialFirst: true,
    healthCheck: "Gemini generateContent read-only draft probe",
  },
  {
    id: "local-document-folder",
    label: "컴퓨터 자료 폴더",
    iconLabel: "DOC",
    method: "local_permission",
    credentialKind: "cli_credential_reference",
    inputLabel: "허용 폴더",
    helpText: "사용자가 고른 폴더 안의 Excel, Word, PDF, CSV, HWP를 로컬에서 분류하고 검색합니다.",
    officialFirst: true,
    healthCheck: "folder allowlist, parser availability, local index 상태 확인",
  },
];

export class ModyConnectorQuickConnectPlanner {
  private readonly vaultPolicy: ModyCredentialVaultPolicy;

  constructor(options: { vaultPolicy?: ModyCredentialVaultPolicy } = {}) {
    this.vaultPolicy = options.vaultPolicy ?? new ModyCredentialVaultPolicy();
  }

  listTools(): ModyQuickConnectToolProfile[] {
    return [...modyQuickConnectToolProfiles];
  }

  createDraft(input: ModyQuickConnectInput): ModyQuickConnectDraft {
    const tool = this.findTool(input.toolId);
    if (!tool) {
      const fallback = modyQuickConnectToolProfiles[0];
      if (!fallback) {
        throw new Error("quick connect tool profile is not configured");
      }
      return this.blockedDraft(fallback, input, "지원하지 않는 연결 도구입니다.");
    }

    const method = input.method ?? tool.method;
    if (method !== tool.method) {
      return this.blockedDraft(tool, input, `${tool.label}은 ${tool.method} 방식으로만 연결합니다.`);
    }

    const referenceId = input.credentialReferenceId ?? buildReferenceId(tool.id, input.createdAt);
    const credentialReferenceInput = {
      connectorId: tool.id,
      secretKind: tool.credentialKind,
      storage: "os_keychain",
      displayLabel: `${tool.label} OS 보안 저장소 reference`,
      createdAt: input.createdAt,
      materialPresent: false,
      metadata: {
        toolId: tool.id,
        method,
        capturedBy: "quick_connect",
        rawMaterialStored: false,
        siteLoginNoticeAccepted: input.warningAccepted === true,
        userPresenceConfirmed: input.userPresenceConfirmed === true,
      },
    } satisfies Parameters<ModyCredentialVaultPolicy["createReference"]>[0];

    const credentialDecision = this.vaultPolicy.createReference(
      input.credentialCaptured
        ? { ...credentialReferenceInput, referenceId }
        : credentialReferenceInput,
    );

    if (credentialDecision.status !== "reference_recorded") {
      return this.draft(tool, method, "needs_credential", credentialDecision, [
        "아이콘 선택",
        `${tool.inputLabel} 입력`,
        "OS 보안 저장소 reference 생성",
      ], `${tool.label} 연결에 필요한 credential reference가 아직 없습니다. 원문은 앱 화면이나 localStorage에 저장하지 않습니다.`);
    }

    if (tool.warning && input.warningAccepted !== true) {
      return this.draft(tool, method, "needs_warning_confirmation", credentialDecision, [
        "주의 사항 확인",
        "권한 주기 동의",
        method === "site_login" ? "격리 브라우저 세션 준비" : "provider 정책 확인",
      ], `${tool.label} 주의 사항에 동의해야 합니다. 공식 API/OAuth가 가능하면 그 방식을 먼저 사용하세요.`);
    }

    if (method === "site_login" && input.userPresenceConfirmed !== true) {
      return this.draft(tool, method, "needs_user_presence", credentialDecision, [
        "사용자 현장 확인",
        "2단계 인증 또는 보안 알림 직접 처리",
        "세션 reference만 저장",
      ], "사이트 로그인은 사용자 현장 확인이 필요합니다. 앱이 아이디/비밀번호 원문을 보관하지 않고 세션 reference만 사용합니다.");
    }

    return this.draft(tool, method, "ready_for_health_check", credentialDecision, [
      "아이콘 선택",
      "credential reference 생성",
      tool.officialFirst ? "공식 API/OAuth 우선" : "주의 사항 확인",
      tool.healthCheck,
    ], `${tool.label} 연결 준비가 끝났습니다. 다음 단계는 health check이며 실제 외부 발송, 예약 확정, 캘린더 등록은 승인 후 실행합니다.`);
  }

  private findTool(toolId: string): ModyQuickConnectToolProfile | undefined {
    return modyQuickConnectToolProfiles.find((tool) => tool.id === toolId);
  }

  private blockedDraft(tool: ModyQuickConnectToolProfile, input: ModyQuickConnectInput, userMessage: string): ModyQuickConnectDraft {
    const credentialDecision = this.vaultPolicy.createReference({
      connectorId: tool.id,
      secretKind: tool.credentialKind,
      storage: "not_required",
      createdAt: input.createdAt,
      materialPresent: false,
    });
    return this.draft(tool, tool.method, "blocked", credentialDecision, ["지원 여부 확인", "연결 중단"], userMessage);
  }

  private draft(
    tool: ModyQuickConnectToolProfile,
    method: ModyQuickConnectMethod,
    status: ModyQuickConnectDraftStatus,
    credentialDecision: ModyCredentialVaultDecision,
    steps: string[],
    userMessage: string,
  ): ModyQuickConnectDraft {
    const draft: ModyQuickConnectDraft = {
      tool,
      method,
      status,
      credentialDecision,
      appMayPersistSecret: false,
      rawSecretMaterialStored: false,
      steps,
      userMessage,
      auditMessages: [
        `${tool.label} quick connect status=${status}`,
        "원문 credential은 앱 화면, app memory, app database, localStorage, sessionStorage, UI state에 저장하지 않습니다.",
        status === "ready_for_health_check" ? `다음 점검: ${tool.healthCheck}` : "사용자 입력 또는 확인이 더 필요합니다.",
      ],
    };

    if (credentialDecision.reference?.referenceId) {
      draft.credentialReferenceId = credentialDecision.reference.referenceId;
    }

    return draft;
  }
}

function buildReferenceId(toolId: string, createdAt: ISODateTimeString): string {
  const normalizedDate = createdAt.replaceAll(/[^0-9A-Za-z]/g, "").slice(0, 14);
  return `mody.quick.${toolId}.${normalizedDate}`;
}
