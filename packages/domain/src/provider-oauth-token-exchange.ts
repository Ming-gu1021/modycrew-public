import { ModyCredentialVaultPolicy } from "./connector-credential-vault.js";
import type { ModyConnectorSecretStorage } from "./connector-setup.js";
import type {
  ModyCredentialVaultDecision,
} from "./connector-credential-vault.js";
import type {
  ModyProviderOAuthAuthorizationPlan,
} from "./provider-oauth.js";
import type {
  ModyProviderId,
  ModyProviderReadCredential,
} from "./provider-read-adapter.js";

export type ModyProviderOAuthTokenExchangeStatus =
  | "token_exchange_completed"
  | "blocked";

export type ModyProviderOAuthTokenEndpoint =
  | "https://oauth2.googleapis.com/token"
  | "https://login.microsoftonline.com/common/oauth2/v2.0/token";

export type ModyProviderOAuthTokenExchangeInput = {
  connectorId: string;
  providerId: ModyProviderId;
  plan: ModyProviderOAuthAuthorizationPlan;
  authorizationCode: string;
  codeVerifier: string;
  clientId: string;
  redirectUri: string;
  clientSecret?: string;
  grantedScopes?: string[];
  exchangedAt: string;
  storage?: ModyConnectorSecretStorage;
  credentialReferenceId?: string;
  tokenMaterialSink?: (material: ModyProviderOAuthTokenMaterial) => void | Promise<void>;
};

export type ModyProviderOAuthTokenMaterial = {
  accessToken: string;
  refreshToken?: string;
  expiresInSeconds?: number;
  tokenType: string;
  scope: string;
};

export type ModyProviderOAuthTokenExchangeResult = {
  status: ModyProviderOAuthTokenExchangeStatus;
  connectorId: string;
  providerId: ModyProviderId;
  tokenEndpoint: ModyProviderOAuthTokenEndpoint;
  credentialReferenceId?: string;
  grantedScopes: string[];
  credential?: ModyProviderReadCredential;
  vaultDecision?: ModyCredentialVaultDecision;
  externalMutation: false;
  appMayPersistSecret: false;
  rawSecretMaterialStored: false;
  rawSecretMaterialReturned: false;
  codeStoredInApp: false;
  tokenMaterialStoredInApp: false;
  tokenMaterialReturnedToRenderer: false;
  userMessage: string;
  errorMessage?: string;
  auditMessages: string[];
};

type FetchLikeResponse = {
  ok: boolean;
  status: number;
  statusText: string;
  json: () => Promise<unknown>;
};

type FetchLike = (url: string, init: {
  method: "POST";
  headers: Record<string, string>;
  body: string;
}) => Promise<FetchLikeResponse>;

type OAuthTokenResponse = {
  access_token?: string;
  refresh_token?: string;
  scope?: string;
  expires_in?: number;
  token_type?: string;
  error?: string;
  error_description?: string;
};

const tokenEndpoints: Partial<Record<ModyProviderId, ModyProviderOAuthTokenEndpoint>> = {
  gmail: "https://oauth2.googleapis.com/token",
  google_calendar: "https://oauth2.googleapis.com/token",
  outlook: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
  outlook_calendar: "https://login.microsoftonline.com/common/oauth2/v2.0/token",
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

export class ModyProviderOAuthTokenExchange {
  private readonly fetchImpl: FetchLike;
  private readonly vaultPolicy = new ModyCredentialVaultPolicy();

  constructor(options: { fetch?: FetchLike } = {}) {
    const fetchImpl = options.fetch ?? (globalThis as unknown as { fetch?: FetchLike }).fetch;
    if (!fetchImpl) {
      throw new Error("fetch runtime is required for provider OAuth token exchange");
    }
    this.fetchImpl = fetchImpl as FetchLike;
  }

  async exchangeCodeForCredentialReference(
    input: ModyProviderOAuthTokenExchangeInput,
  ): Promise<ModyProviderOAuthTokenExchangeResult> {
    const tokenEndpoint = tokenEndpointFor(input.providerId);
    const storage = input.storage ?? "os_keychain";
    const secretsToRedact = [
      input.authorizationCode,
      input.codeVerifier,
      input.clientSecret ?? "",
    ].filter(Boolean);

    if (input.plan.providerId !== input.providerId || input.plan.connectorId !== input.connectorId) {
      return blockedResult(input, tokenEndpoint, "OAuth plan과 provider/connector가 일치하지 않습니다.");
    }

    if (!input.authorizationCode.trim() || !input.codeVerifier.trim()) {
      return blockedResult(input, tokenEndpoint, "authorization code와 PKCE verifier가 모두 필요합니다.");
    }

    try {
      const tokenResponse = await this.fetchToken(input, tokenEndpoint);
      const json = await tokenResponse.json().catch(() => ({})) as OAuthTokenResponse;
      if (!tokenResponse.ok || json.error) {
        return blockedResult(
          input,
          tokenEndpoint,
          "OAuth token endpoint 교환에 실패했습니다.",
          redactSecretText(json.error_description ?? json.error ?? tokenResponse.statusText, secretsToRedact),
        );
      }

      const grantedScopes = normalizeGrantedScopes(json.scope, input.grantedScopes, input.plan);
      if (!sanitizeTokenMaterial(json.access_token)) {
        return blockedResult(input, tokenEndpoint, "OAuth token 응답에 access token이 없습니다.");
      }
      const tokenMaterial: ModyProviderOAuthTokenMaterial = {
        accessToken: sanitizeTokenMaterial(json.access_token),
        tokenType: sanitizeTokenType(json.token_type),
        scope: grantedScopes.join(" "),
      };
      if (json.refresh_token) {
        tokenMaterial.refreshToken = String(json.refresh_token);
      }
      const expiresInSeconds = sanitizeExpiresIn(json.expires_in);
      if (expiresInSeconds !== undefined) {
        tokenMaterial.expiresInSeconds = expiresInSeconds;
      }
      await input.tokenMaterialSink?.(tokenMaterial);
      const credentialReferenceId =
        input.credentialReferenceId ??
        `${storage}:${input.connectorId}:${input.providerId}:oauth-read-live`;
      const vaultDecision = this.vaultPolicy.createReference({
        connectorId: input.connectorId,
        secretKind: "oauth_refresh_token",
        storage,
        referenceId: credentialReferenceId,
        displayLabel: `${providerLabels[input.providerId]} live read-only OAuth`,
        createdAt: input.exchangedAt,
        materialPresent: false,
        metadata: {
          providerId: input.providerId,
          scopeCount: grantedScopes.length,
          exchangeEndpoint: tokenEndpoint,
          credentialType: sanitizeTokenType(json.token_type),
          expiresInSeconds: sanitizeExpiresIn(json.expires_in),
        },
      });

      if (vaultDecision.status !== "reference_recorded" || !vaultDecision.reference) {
        return {
          status: "blocked",
          connectorId: input.connectorId,
          providerId: input.providerId,
          tokenEndpoint,
          grantedScopes,
          vaultDecision,
          externalMutation: false,
          appMayPersistSecret: false,
          rawSecretMaterialStored: false,
          rawSecretMaterialReturned: false,
          codeStoredInApp: false,
          tokenMaterialStoredInApp: false,
          tokenMaterialReturnedToRenderer: false,
          userMessage: vaultDecision.userMessage,
          auditMessages: [
            "OAuth token endpoint 응답을 앱 상태에 저장하지 않았습니다.",
            "credential reference 저장 정책에서 안전하지 않은 저장소 또는 secret-like metadata를 차단했습니다.",
          ],
        };
      }

      const credential = input.plan.providerId === input.providerId
        ? createCredentialFromPlan(input, grantedScopes, vaultDecision.reference.referenceId, storage)
        : undefined;

      const result: ModyProviderOAuthTokenExchangeResult = {
        status: "token_exchange_completed",
        connectorId: input.connectorId,
        providerId: input.providerId,
        tokenEndpoint,
        credentialReferenceId: vaultDecision.reference.referenceId,
        grantedScopes,
        vaultDecision,
        externalMutation: false,
        appMayPersistSecret: false,
        rawSecretMaterialStored: false,
        rawSecretMaterialReturned: false,
        codeStoredInApp: false,
        tokenMaterialStoredInApp: false,
        tokenMaterialReturnedToRenderer: false,
        userMessage: `${providerLabels[input.providerId]} OAuth code를 token endpoint에서 교환하고 보안 저장소 reference만 남겼습니다.`,
        auditMessages: [
          `tokenEndpoint=${tokenEndpoint}`,
          "authorization code, access token, refresh token 원문은 결과/renderer/report에 반환하지 않습니다.",
          "메일/캘린더 쓰기 scope 없이 읽기 credential reference만 생성했습니다.",
        ],
      };

      if (credential) {
        result.credential = credential;
      }

      return result;
    } catch (error) {
      return blockedResult(
        input,
        tokenEndpoint,
        "OAuth token endpoint 네트워크 호출에 실패했습니다.",
        redactSecretText(error instanceof Error ? error.message : String(error), secretsToRedact),
      );
    }
  }

  private async fetchToken(
    input: ModyProviderOAuthTokenExchangeInput,
    tokenEndpoint: ModyProviderOAuthTokenEndpoint,
  ): Promise<FetchLikeResponse> {
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code: input.authorizationCode,
      redirect_uri: input.redirectUri,
      client_id: input.clientId,
      code_verifier: input.codeVerifier,
    });

    if (input.clientSecret) {
      body.set("client_secret", input.clientSecret);
    }

    return this.fetchImpl(tokenEndpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Accept": "application/json",
      },
      body: body.toString(),
    });
  }
}

function tokenEndpointFor(providerId: ModyProviderId): ModyProviderOAuthTokenEndpoint {
  const endpoint = tokenEndpoints[providerId];
  if (!endpoint) {
    throw new Error(`${providerLabels[providerId]}는 OAuth token endpoint 교환 대상이 아닙니다.`);
  }
  return endpoint;
}

function createCredentialFromPlan(
  input: ModyProviderOAuthTokenExchangeInput,
  grantedScopes: string[],
  credentialReferenceId: string,
  storage: ModyConnectorSecretStorage,
): ModyProviderReadCredential | undefined {
  const permissions = [...new Set(
    input.plan.scopes
      .filter((scope) => Boolean(scope.permission) && grantedScopes.includes(scope.value))
      .map((scope) => scope.permission)
      .filter((permission): permission is NonNullable<typeof permission> => Boolean(permission)),
  )];

  if (permissions.length === 0) return undefined;

  return {
    connectorId: input.connectorId,
    providerId: input.providerId,
    referenceId: credentialReferenceId,
    status: "valid",
    grantedPermissions: permissions,
    storage: toProviderCredentialStorage(storage),
    appMayPersistSecret: false,
    rawSecretMaterialStored: false,
  };
}

function toProviderCredentialStorage(
  storage: ModyConnectorSecretStorage,
): ModyProviderReadCredential["storage"] {
  if (storage === "os_keychain") return "os_keychain";
  if (storage === "external_mcp_config") return "enterprise_vault";
  return "user_supplied_runtime";
}

function normalizeGrantedScopes(
  responseScope: string | undefined,
  fallbackScopes: string[] | undefined,
  plan: ModyProviderOAuthAuthorizationPlan,
): string[] {
  const scopes = responseScope?.trim()
    ? responseScope.split(/\s+/)
    : fallbackScopes?.length
      ? fallbackScopes
      : plan.scopes.map((scope) => scope.value);
  return [...new Set(scopes.map((scope) => scope.trim()).filter(Boolean))];
}

function blockedResult(
  input: Pick<ModyProviderOAuthTokenExchangeInput, "connectorId" | "providerId">,
  tokenEndpoint: ModyProviderOAuthTokenEndpoint,
  userMessage: string,
  errorMessage?: string,
): ModyProviderOAuthTokenExchangeResult {
  return {
    status: "blocked",
    connectorId: input.connectorId,
    providerId: input.providerId,
    tokenEndpoint,
    grantedScopes: [],
    externalMutation: false,
    appMayPersistSecret: false,
    rawSecretMaterialStored: false,
    rawSecretMaterialReturned: false,
    codeStoredInApp: false,
    tokenMaterialStoredInApp: false,
    tokenMaterialReturnedToRenderer: false,
    userMessage,
    ...(errorMessage ? { errorMessage } : {}),
    auditMessages: [
      "OAuth token exchange blocked before any app-side secret persistence.",
      "authorization code, access token, refresh token 원문은 결과/renderer/report에 반환하지 않습니다.",
    ],
  };
}

function sanitizeTokenType(value: unknown): string {
  const text = String(value ?? "").trim();
  return /^[A-Za-z0-9._ -]{1,40}$/.test(text) ? text : "Bearer";
}

function sanitizeTokenMaterial(value: unknown): string {
  const text = String(value ?? "").trim();
  return text.length >= 20 && text.length <= 4096 ? text : "";
}

function sanitizeExpiresIn(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.trunc(number)) : undefined;
}

export function redactProviderOAuthTokenExchangeSecret(value: string, secrets: string[] = []): string {
  return redactSecretText(value, secrets);
}

function redactSecretText(value: string, secrets: string[] = []): string {
  let redacted = String(value ?? "");
  for (const secret of secrets) {
    if (secret) redacted = redacted.split(secret).join("[provider-oauth-secret-redacted]");
  }
  return redacted
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/gi, "Bearer [provider-oauth-secret-redacted]")
    .replace(/\b(?:ya29|1\/\/|0\.A)[A-Za-z0-9._~+/=-]{12,}\b/g, "[provider-oauth-secret-redacted]")
    .replace(/\b[A-Za-z0-9._~+/=-]{48,}\b/g, "[provider-oauth-secret-redacted]");
}
