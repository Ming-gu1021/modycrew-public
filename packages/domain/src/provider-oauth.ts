import {
  createProviderReadOnlyCredential,
  type ModyProviderId,
  type ModyProviderReadActionKind,
  type ModyProviderReadCredential,
} from "./provider-read-adapter.js";
import type { ModyConnectorPermission } from "./connector-setup.js";

export type ModyProviderOAuthSurface =
  | "google_workspace"
  | "microsoft_graph";

export type ModyProviderOAuthSensitivity =
  | "non_sensitive"
  | "sensitive"
  | "restricted"
  | "graph_delegated"
  | "credential_lifecycle";

export type ModyProviderOAuthScope = {
  value: string;
  permission?: ModyConnectorPermission;
  action?: ModyProviderReadActionKind;
  purpose: string;
  readOnly: boolean;
  externalMutation: false;
  sensitivity: ModyProviderOAuthSensitivity;
  verificationNote: string;
};

export type ModyProviderOAuthAuthorizationInput = {
  connectorId: string;
  providerId: ModyProviderId;
  clientId: string;
  redirectUri: string;
  state: string;
  requestedActions: ModyProviderReadActionKind[];
  codeChallenge?: string;
  codeChallengeMethod?: "S256" | "plain";
  loginHint?: string;
  promptConsent?: boolean;
  includeOfflineAccess?: boolean;
};

export type ModyProviderOAuthAuthorizationPlan = {
  connectorId: string;
  providerId: ModyProviderId;
  surface: ModyProviderOAuthSurface;
  authorizationUrl: string;
  scopes: ModyProviderOAuthScope[];
  requestedActions: ModyProviderReadActionKind[];
  externalMutation: false;
  appMayPersistSecret: false;
  rawSecretMaterialStored: false;
  requiresUserInteraction: true;
  callbackMustValidateState: true;
  pkceVerifierStorage: "runtime_memory_only";
  credentialStorageTarget: "os_keychain" | "enterprise_vault";
  userMessage: string;
};

export type ModyProviderOAuthCallbackInput = {
  expectedState: string;
  returnedState?: string;
  authorizationCodePresent?: boolean;
  error?: string;
  errorDescription?: string;
};

export type ModyProviderOAuthCallbackResult = {
  status: "ready_for_token_exchange" | "blocked";
  appMayPersistSecret: false;
  rawSecretMaterialStored: false;
  codeStoredInApp: false;
  userMessage: string;
};

export type ModyProviderOAuthCredentialHandoffInput = {
  connectorId: string;
  providerId: ModyProviderId;
  credentialReferenceId: string;
  credentialStatus: "valid" | "missing" | "expired" | "revoked";
  storage: ModyProviderReadCredential["storage"];
  grantedScopes: string[];
  createdByPlan: ModyProviderOAuthAuthorizationPlan;
};

export type ModyProviderOAuthCredentialHandoffResult = {
  status: "credential_ready" | "blocked";
  credential?: ModyProviderReadCredential;
  appMayPersistSecret: false;
  rawSecretMaterialStored: false;
  userMessage: string;
};

type ProviderOAuthProfile = {
  surface: ModyProviderOAuthSurface;
  authorizationEndpoint: string;
  supportsActions: ModyProviderReadActionKind[];
  baseScopes: ModyProviderOAuthScope[];
  scopeSeparator: "space";
  includeGoogleOfflineParams?: boolean;
};

const providerLabels: Record<ModyProviderId, string> = {
  gmail: "Gmail",
  outlook: "Outlook Mail",
  imap_smtp: "IMAP/SMTP",
  webmail: "웹메일",
  mobile_share: "휴대폰 선택 메일",
  google_calendar: "Google Calendar",
  outlook_calendar: "Outlook Calendar",
};

const providerProfiles: Partial<Record<ModyProviderId, ProviderOAuthProfile>> = {
  gmail: {
    surface: "google_workspace",
    authorizationEndpoint: "https://accounts.google.com/o/oauth2/v2/auth",
    supportsActions: ["list_mail_messages"],
    scopeSeparator: "space",
    includeGoogleOfflineParams: true,
    baseScopes: [
      {
        value: "https://www.googleapis.com/auth/gmail.readonly",
        permission: "read_messages",
        action: "list_mail_messages",
        purpose: "받은 메일과 메일 설정을 읽어 업무 인박스에 반영합니다.",
        readOnly: true,
        externalMutation: false,
        sensitivity: "restricted",
        verificationNote: "Google은 gmail.readonly를 restricted scope로 분류하므로 공개 앱 검증과 보안 검토 계획이 필요합니다.",
      },
    ],
  },
  google_calendar: {
    surface: "google_workspace",
    authorizationEndpoint: "https://accounts.google.com/o/oauth2/v2/auth",
    supportsActions: ["list_calendar_events"],
    scopeSeparator: "space",
    includeGoogleOfflineParams: true,
    baseScopes: [
      {
        value: "https://www.googleapis.com/auth/calendar.events.readonly",
        permission: "read_calendar",
        action: "list_calendar_events",
        purpose: "일정 이벤트를 읽어 예약/미팅 후보를 정리합니다.",
        readOnly: true,
        externalMutation: false,
        sensitivity: "sensitive",
        verificationNote: "Google Calendar 이벤트 조회에는 쓰기 scope 대신 events.readonly를 우선 사용합니다.",
      },
      {
        value: "https://www.googleapis.com/auth/calendar.freebusy",
        permission: "read_calendar",
        purpose: "가능 시간 확인을 위해 FreeBusy 조회만 허용합니다.",
        readOnly: true,
        externalMutation: false,
        sensitivity: "sensitive",
        verificationNote: "예약 조율은 일정 생성 전 FreeBusy 조회로 시작합니다.",
      },
    ],
  },
  outlook: {
    surface: "microsoft_graph",
    authorizationEndpoint: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    supportsActions: ["list_mail_messages"],
    scopeSeparator: "space",
    baseScopes: [
      {
        value: "offline_access",
        purpose: "사용자가 앱을 열지 않았을 때도 승인된 읽기 권한을 유지하기 위한 Microsoft lifecycle scope입니다.",
        readOnly: true,
        externalMutation: false,
        sensitivity: "credential_lifecycle",
        verificationNote: "offline_access는 추가 데이터 권한을 부여하지 않고 refresh token 발급을 요청합니다.",
      },
      {
        value: "Mail.Read",
        permission: "read_messages",
        action: "list_mail_messages",
        purpose: "서명한 사용자의 메일함을 읽어 업무 인박스에 반영합니다.",
        readOnly: true,
        externalMutation: false,
        sensitivity: "graph_delegated",
        verificationNote: "Microsoft Graph Mail.Read delegated permission은 사용자 메일 읽기 권한입니다.",
      },
    ],
  },
  outlook_calendar: {
    surface: "microsoft_graph",
    authorizationEndpoint: "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    supportsActions: ["list_calendar_events"],
    scopeSeparator: "space",
    baseScopes: [
      {
        value: "offline_access",
        purpose: "사용자가 앱을 열지 않았을 때도 승인된 읽기 권한을 유지하기 위한 Microsoft lifecycle scope입니다.",
        readOnly: true,
        externalMutation: false,
        sensitivity: "credential_lifecycle",
        verificationNote: "offline_access는 추가 데이터 권한을 부여하지 않고 refresh token 발급을 요청합니다.",
      },
      {
        value: "Calendars.Read",
        permission: "read_calendar",
        action: "list_calendar_events",
        purpose: "서명한 사용자의 캘린더 이벤트를 읽어 일정 조율 후보를 만듭니다.",
        readOnly: true,
        externalMutation: false,
        sensitivity: "graph_delegated",
        verificationNote: "Microsoft Graph Calendars.Read delegated permission은 사용자 캘린더 읽기 권한입니다.",
      },
    ],
  },
};

const mutatingScopePatterns = [
  /gmail\.send/i,
  /gmail\.compose/i,
  /gmail\.modify/i,
  /mail\.google\.com/i,
  /calendar\.events$/i,
  /calendar\.events\.owned$/i,
  /calendar\.app\.created/i,
  /Mail\.Send/i,
  /Mail\.ReadWrite/i,
  /Calendars\.ReadWrite/i,
  /SMTP\.Send/i,
];

export class ModyProviderOAuthPlanner {
  createAuthorizationPlan(
    input: ModyProviderOAuthAuthorizationInput,
  ): ModyProviderOAuthAuthorizationPlan {
    const profile = getProfile(input.providerId);
    validateRedirectUri(input.redirectUri);
    const requestedActions = uniqueRequestedActions(input.requestedActions);
    const unsupportedAction = requestedActions.find(
      (action) => !profile.supportsActions.includes(action),
    );
    if (unsupportedAction) {
      throw new Error(
        `${providerLabels[input.providerId]}는 ${unsupportedAction} OAuth 읽기 연결을 지원하지 않습니다.`,
      );
    }

    const scopes = scopesForActions(profile, requestedActions, input.includeOfflineAccess ?? true);
    assertReadOnlyScopes(input.providerId, scopes);
    const authorizationUrl = buildAuthorizationUrl(input, profile, scopes);

    return {
      connectorId: input.connectorId,
      providerId: input.providerId,
      surface: profile.surface,
      authorizationUrl,
      scopes,
      requestedActions,
      externalMutation: false,
      appMayPersistSecret: false,
      rawSecretMaterialStored: false,
      requiresUserInteraction: true,
      callbackMustValidateState: true,
      pkceVerifierStorage: "runtime_memory_only",
      credentialStorageTarget: "os_keychain",
      userMessage: `${providerLabels[input.providerId]} 읽기 연결을 시작할 수 있습니다. OAuth 동의와 state 검증 뒤 token 원문은 OS 보안 저장소나 vault에 맡기고 ModyCrew에는 참조 ID만 남깁니다.`,
    };
  }

  verifyCallback(
    input: ModyProviderOAuthCallbackInput,
  ): ModyProviderOAuthCallbackResult {
    if (input.error) {
      return {
        status: "blocked",
        appMayPersistSecret: false,
        rawSecretMaterialStored: false,
        codeStoredInApp: false,
        userMessage: `OAuth 연결이 provider 오류로 중단되었습니다: ${input.errorDescription ?? input.error}`,
      };
    }

    if (!input.returnedState || input.returnedState !== input.expectedState) {
      return {
        status: "blocked",
        appMayPersistSecret: false,
        rawSecretMaterialStored: false,
        codeStoredInApp: false,
        userMessage: "OAuth state가 일치하지 않아 연결을 중단했습니다. 다시 연결을 시작해 주세요.",
      };
    }

    if (!input.authorizationCodePresent) {
      return {
        status: "blocked",
        appMayPersistSecret: false,
        rawSecretMaterialStored: false,
        codeStoredInApp: false,
        userMessage: "OAuth authorization code가 없어 credential 교환을 진행할 수 없습니다.",
      };
    }

    return {
      status: "ready_for_token_exchange",
      appMayPersistSecret: false,
      rawSecretMaterialStored: false,
      codeStoredInApp: false,
      userMessage: "OAuth callback state를 확인했습니다. authorization code는 앱에 저장하지 말고 보안 저장소 교환기로 전달해야 합니다.",
    };
  }

  createCredentialFromReference(
    input: ModyProviderOAuthCredentialHandoffInput,
  ): ModyProviderOAuthCredentialHandoffResult {
    const requiredPermissions = permissionsForPlan(input.createdByPlan);
    const missingScope = input.createdByPlan.scopes
      .filter((scope) => scope.permission)
      .find((scope) => !input.grantedScopes.includes(scope.value));

    if (missingScope) {
      return {
        status: "blocked",
        appMayPersistSecret: false,
        rawSecretMaterialStored: false,
        userMessage: `${providerLabels[input.providerId]} 연결에 필요한 읽기 scope가 없습니다: ${missingScope.value}`,
      };
    }

    return {
      status: "credential_ready",
      credential: createProviderReadOnlyCredential({
        connectorId: input.connectorId,
        providerId: input.providerId,
        referenceId: input.credentialReferenceId,
        status: input.credentialStatus,
        grantedPermissions: requiredPermissions,
        storage: input.storage,
      }),
      appMayPersistSecret: false,
      rawSecretMaterialStored: false,
      userMessage: `${providerLabels[input.providerId]} credential 원문 없이 읽기 전용 참조를 만들었습니다.`,
    };
  }

  listScopeProfiles(providerId: ModyProviderId): ModyProviderOAuthScope[] {
    return [...getProfile(providerId).baseScopes];
  }
}

function getProfile(providerId: ModyProviderId): ProviderOAuthProfile {
  const profile = providerProfiles[providerId];
  if (!profile) {
    throw new Error(`${providerLabels[providerId]}는 OAuth read-only planner 대상이 아닙니다.`);
  }

  return profile;
}

function uniqueRequestedActions(
  actions: ModyProviderReadActionKind[],
): ModyProviderReadActionKind[] {
  return [...new Set(actions)];
}

function scopesForActions(
  profile: ProviderOAuthProfile,
  requestedActions: ModyProviderReadActionKind[],
  includeOfflineAccess: boolean,
): ModyProviderOAuthScope[] {
  return profile.baseScopes.filter((scope) => {
    if (scope.sensitivity === "credential_lifecycle") {
      return includeOfflineAccess;
    }

    if (!scope.action) {
      return true;
    }

    return requestedActions.includes(scope.action);
  });
}

function buildAuthorizationUrl(
  input: ModyProviderOAuthAuthorizationInput,
  profile: ProviderOAuthProfile,
  scopes: ModyProviderOAuthScope[],
): string {
  const params: Array<[string, string]> = [
    ["client_id", input.clientId],
    ["redirect_uri", input.redirectUri],
    ["response_type", "code"],
    ["scope", scopes.map((scope) => scope.value).join(" ")],
    ["state", input.state],
  ];

  if (input.codeChallenge) {
    params.push(["code_challenge", input.codeChallenge]);
    params.push(["code_challenge_method", input.codeChallengeMethod ?? "S256"]);
  }

  if (input.loginHint) {
    params.push(["login_hint", input.loginHint]);
  }

  if (profile.surface === "google_workspace") {
    params.push(["include_granted_scopes", "true"]);
    if (profile.includeGoogleOfflineParams) {
      params.push(["access_type", "offline"]);
    }

    if (input.promptConsent ?? true) {
      params.push(["prompt", "consent"]);
    }
  }

  if (profile.surface === "microsoft_graph") {
    params.push(["response_mode", "query"]);
    if (input.promptConsent) {
      params.push(["prompt", "consent"]);
    }
  }

  return `${profile.authorizationEndpoint}?${params
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join("&")}`;
}

function assertReadOnlyScopes(
  providerId: ModyProviderId,
  scopes: ModyProviderOAuthScope[],
): void {
  for (const scope of scopes) {
    const mutating = scope.externalMutation || mutatingScopePatterns.some((pattern) =>
      pattern.test(scope.value),
    );

    if (!scope.readOnly || mutating) {
      throw new Error(
        `${providerLabels[providerId]} OAuth 읽기 연결에 외부 변경 scope가 섞였습니다: ${scope.value}`,
      );
    }
  }
}

function permissionsForPlan(
  plan: ModyProviderOAuthAuthorizationPlan,
): ModyConnectorPermission[] {
  return [...new Set(
    plan.scopes
      .map((scope) => scope.permission)
      .filter((permission): permission is ModyConnectorPermission => Boolean(permission)),
  )];
}

function validateRedirectUri(redirectUri: string): void {
  if (redirectUri.startsWith("https://")) return;
  if (redirectUri.startsWith("app://")) return;
  if (/^http:\/\/(127\.0\.0\.1|localhost|\[::1\])(?::\d+)?\//.test(redirectUri)) return;

  throw new Error("OAuth redirectUri는 HTTPS, app scheme, 또는 localhost 개발 callback만 허용합니다.");
}
