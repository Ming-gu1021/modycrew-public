export type ModyProviderOAuthPreflightProviderId =
  | "google_oauth_app"
  | "microsoft_oauth_app";

export type ModyProviderOAuthPreflightStatus =
  | "ready_for_authorization"
  | "missing_client_id"
  | "invalid_redirect_uri"
  | "needs_app_registration";

export type ModyProviderOAuthCallbackMode =
  | "registered_loopback"
  | "dynamic_loopback";

export type ModyProviderOAuthClientIdSource =
  | "dedicated_oauth_client"
  | "desktop_signin_fallback"
  | "missing";

export type ModyProviderOAuthPreflightInput = {
  env?: Record<string, string | undefined>;
  callbackPort?: number;
};

export type ModyProviderOAuthPreflightItem = {
  id: ModyProviderOAuthPreflightProviderId;
  label: string;
  status: ModyProviderOAuthPreflightStatus;
  clientIdConfigured: boolean;
  clientIdSource: ModyProviderOAuthClientIdSource;
  requiredEnv: string[];
  optionalEnv: string[];
  callbackMode: ModyProviderOAuthCallbackMode;
  callbackPort: number | null;
  redirectUris: string[];
  readOnlyScopes: string[];
  writeScopesRequireFinalApproval: string[];
  registrationChecklist: string[];
  userMessage: string;
  nextStep: string;
  externalMutation: false;
  rawSecretMaterialStored: false;
  rawSecretMaterialReturned: false;
};

export type ModyProviderOAuthPreflightSummary = {
  total: number;
  readyForAuthorization: number;
  missingClientId: number;
  needsAppRegistration: number;
  externalMutationAllowed: false;
  rawSecretMaterialReturned: false;
};

export type ModyProviderOAuthPreflightReport = {
  status: "ready_for_oauth_preflight";
  summary: ModyProviderOAuthPreflightSummary;
  items: ModyProviderOAuthPreflightItem[];
};

const defaultCallbackPort = 1455;

export class ModyProviderOAuthPreflight {
  createReport(input: ModyProviderOAuthPreflightInput = {}): ModyProviderOAuthPreflightReport {
    const env = input.env ?? {};
    const callbackPort = normalizeCallbackPort(input.callbackPort);
    const items = [
      this.createGoogleItem(env, callbackPort),
      this.createMicrosoftItem(env, callbackPort),
    ];
    const summary = this.summarize(items);

    return {
      status: "ready_for_oauth_preflight",
      summary,
      items,
    };
  }

  summarize(items: ModyProviderOAuthPreflightItem[]): ModyProviderOAuthPreflightSummary {
    return {
      total: items.length,
      readyForAuthorization: items.filter((item) => item.status === "ready_for_authorization").length,
      missingClientId: items.filter((item) => item.status === "missing_client_id").length,
      needsAppRegistration: items.filter((item) => item.status === "needs_app_registration").length,
      externalMutationAllowed: false,
      rawSecretMaterialReturned: false,
    };
  }

  private createGoogleItem(
    env: Record<string, string | undefined>,
    callbackPort: number,
  ): ModyProviderOAuthPreflightItem {
    const dedicatedClientId = firstNonEmpty(
      env.MODYCREW_GOOGLE_OAUTH_CLIENT_ID,
      env.GOOGLE_OAUTH_CLIENT_ID,
    );
    const desktopSignInClientId = firstNonEmpty(env.MODYCREW_GOOGLE_SIGNIN_CLIENT_ID);
    const clientId = dedicatedClientId || desktopSignInClientId;
    const clientIdSource: ModyProviderOAuthClientIdSource = dedicatedClientId
      ? "dedicated_oauth_client"
      : desktopSignInClientId
        ? "desktop_signin_fallback"
        : "missing";
    const callbackMode: ModyProviderOAuthCallbackMode =
      clientIdSource === "desktop_signin_fallback" ? "dynamic_loopback" : "registered_loopback";
    const configuredCallbackPort = callbackMode === "registered_loopback" ? callbackPort : null;
    const redirectBase =
      callbackMode === "dynamic_loopback"
        ? "http://127.0.0.1:<임의 포트>"
        : `http://127.0.0.1:${callbackPort}`;
    const redirectUris = [
      `${redirectBase}/connector/gmail/oauth/callback`,
      `${redirectBase}/connector/google-calendar/oauth/callback`,
    ];
    const status = clientId ? "ready_for_authorization" : "missing_client_id";

    return {
      id: "google_oauth_app",
      label: "Google OAuth 앱",
      status,
      clientIdConfigured: Boolean(clientId),
      clientIdSource,
      requiredEnv: ["MODYCREW_GOOGLE_OAUTH_CLIENT_ID 또는 MODYCREW_GOOGLE_SIGNIN_CLIENT_ID"],
      optionalEnv: [
        "MODYCREW_GOOGLE_OAUTH_AUTH_URL",
        "MODYCREW_GOOGLE_OAUTH_TOKEN_URL",
        "MODYCREW_GMAIL_OAUTH_SCOPE",
        "MODYCREW_GOOGLE_CALENDAR_OAUTH_SCOPE",
      ],
      callbackMode,
      callbackPort: configuredCallbackPort,
      redirectUris,
      readOnlyScopes: [
        "https://www.googleapis.com/auth/gmail.readonly",
        "https://www.googleapis.com/auth/calendar.freebusy",
        "https://www.googleapis.com/auth/calendar.events.readonly",
      ],
      writeScopesRequireFinalApproval: [
        "https://www.googleapis.com/auth/gmail.send",
        "https://www.googleapis.com/auth/calendar.events",
      ],
      registrationChecklist:
        callbackMode === "dynamic_loopback"
          ? [
              "기존 Google 데스크톱 로그인 client를 Gmail과 Google Calendar 연결에도 사용합니다.",
              "데스크톱 OAuth client는 앱이 실제로 연 localhost 임의 포트를 callback URI로 사용하므로 고정 포트를 등록하지 않습니다.",
              "처음 연결은 Gmail read-only와 Calendar freebusy/readonly scope로 시작합니다.",
              "메일 발송과 일정 등록 scope는 승인 카드에서 최종 확인한 뒤에만 추가 사용합니다.",
            ]
          : [
              "Google Cloud Console에서 Gmail/Calendar 전용 OAuth client를 만들고 client id만 앱 설정에 저장합니다.",
              "Gmail과 Google Calendar callback URI 두 개를 승인된 redirect URI로 등록합니다.",
              "처음 연결은 Gmail read-only와 Calendar freebusy/readonly scope로 시작합니다.",
              "메일 발송과 일정 등록 scope는 승인 카드에서 최종 확인한 뒤에만 추가 사용합니다.",
            ],
      userMessage: clientId
        ? callbackMode === "dynamic_loopback"
          ? "기존 Google 로그인 설정을 사용해 Gmail/Google Calendar 동의 창을 열 준비가 됐습니다."
          : "Google 계정 연결 설정이 있어 Gmail/Google Calendar 동의 창을 열 준비가 됐습니다."
        : "Google 계정 연결 설정이 아직 준비되지 않아 Gmail/Google Calendar 동의 창을 열 수 없습니다.",
      nextStep: clientId
        ? "연결 화면에서 Gmail 또는 Google Calendar를 열고 브라우저 동의와 localhost callback을 진행합니다."
        : "앱 관리자에게 Google 계정 연결 설정을 요청한 뒤 다시 시도해 주세요.",
      externalMutation: false,
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
    };
  }

  private createMicrosoftItem(
    env: Record<string, string | undefined>,
    callbackPort: number,
  ): ModyProviderOAuthPreflightItem {
    const clientId = firstNonEmpty(env.MODYCREW_MICROSOFT_OAUTH_CLIENT_ID, env.MICROSOFT_OAUTH_CLIENT_ID);
    const redirectUris = [
      `http://127.0.0.1:${callbackPort}/connector/outlook/oauth/callback`,
      `http://127.0.0.1:${callbackPort}/connector/outlook-calendar/oauth/callback`,
    ];
    const status = clientId ? "ready_for_authorization" : "missing_client_id";

    return {
      id: "microsoft_oauth_app",
      label: "Microsoft Entra OAuth 앱",
      status,
      clientIdConfigured: Boolean(clientId),
      clientIdSource: clientId ? "dedicated_oauth_client" : "missing",
      requiredEnv: ["MODYCREW_MICROSOFT_OAUTH_CLIENT_ID"],
      optionalEnv: [
        "MODYCREW_MICROSOFT_OAUTH_AUTH_URL",
        "MODYCREW_MICROSOFT_OAUTH_TOKEN_URL",
        "MODYCREW_OUTLOOK_MAIL_OAUTH_SCOPE",
        "MODYCREW_OUTLOOK_CALENDAR_OAUTH_SCOPE",
      ],
      callbackMode: "registered_loopback",
      callbackPort,
      redirectUris,
      readOnlyScopes: ["Mail.Read", "Mail.ReadBasic", "Calendars.Read", "offline_access"],
      writeScopesRequireFinalApproval: ["Mail.Send", "Calendars.ReadWrite"],
      registrationChecklist: [
        "Microsoft Entra 앱 등록에서 public client/redirect URI 사용을 허용합니다.",
        "Outlook Mail과 Outlook Calendar callback URI 두 개를 redirect URI로 등록합니다.",
        "처음 연결은 Mail.Read, Calendars.Read, offline_access처럼 읽기 중심 권한으로 시작합니다.",
        "Mail.Send와 Calendars.ReadWrite는 승인 카드 최종 확인 뒤에만 실제 실행에 씁니다.",
      ],
      userMessage: clientId
        ? "Microsoft OAuth client id가 있어 Outlook/Microsoft 365 동의 창을 열 준비가 됐습니다."
        : "Outlook/Microsoft 365 계정 연결 설정이 아직 준비되지 않았습니다.",
      nextStep: clientId
        ? "연결 화면에서 Outlook Mail 또는 Outlook Calendar 단일 설정을 열고 tenant/admin 동의 정책을 확인합니다."
        : "앱 관리자에게 Microsoft 365 계정 연결 설정을 요청한 뒤 다시 시도해 주세요.",
      externalMutation: false,
      rawSecretMaterialStored: false,
      rawSecretMaterialReturned: false,
    };
  }
}

function firstNonEmpty(...values: Array<string | undefined>): string {
  return values.map((value) => String(value ?? "").trim()).find(Boolean) ?? "";
}

function normalizeCallbackPort(value: number | undefined): number {
  if (!Number.isFinite(value)) return defaultCallbackPort;
  const port = Math.trunc(Number(value));
  return port > 0 && port <= 65_535 ? port : defaultCallbackPort;
}
