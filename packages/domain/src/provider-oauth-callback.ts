import { ModyCredentialVaultPolicy } from "./connector-credential-vault.js";
import { ModyProviderOAuthPlanner } from "./provider-oauth.js";
import type {
  ModyCredentialPersistenceLocation,
  ModyCredentialVaultDecision,
} from "./connector-credential-vault.js";
import type {
  ModyProviderOAuthAuthorizationPlan,
  ModyProviderOAuthCallbackResult,
} from "./provider-oauth.js";
import type {
  ModyProviderId,
  ModyProviderReadCredential,
} from "./provider-read-adapter.js";

export type ModyProviderOAuthCallbackSessionStatus =
  | "waiting_for_callback"
  | "credential_ready"
  | "blocked"
  | "expired";

export type ModyProviderOAuthCallbackSession = {
  sessionId: string;
  connectorId: string;
  providerId: ModyProviderId;
  expectedState: string;
  plan: ModyProviderOAuthAuthorizationPlan;
  pkceVerifierFingerprint: string;
  pkceVerifierStorage: "runtime_memory_only";
  createdAt: string;
  expiresAt: string;
  status: ModyProviderOAuthCallbackSessionStatus;
  appMayPersistSecret: false;
  rawSecretMaterialStored: false;
  codeStoredInApp: false;
};

export type ModyProviderOAuthCallbackSessionInput = {
  sessionId: string;
  expectedState: string;
  plan: ModyProviderOAuthAuthorizationPlan;
  pkceVerifierFingerprint: string;
  createdAt: string;
  expiresAt: string;
};

export type ModyProviderOAuthSecureExchangeInput = {
  session: ModyProviderOAuthCallbackSession;
  authorizationCodePresent: true;
  grantedScopes: string[];
  exchangedAt: string;
  storage: ModyCredentialPersistenceLocation;
  credentialReferenceId?: string;
};

export type ModyProviderOAuthSecureExchangeResult = {
  status: "reference_recorded" | "blocked";
  connectorId: string;
  providerId: ModyProviderId;
  credentialReferenceId?: string;
  grantedScopes: string[];
  storage: ModyCredentialPersistenceLocation;
  appMayPersistSecret: false;
  rawSecretMaterialStored: false;
  codeStoredInApp: false;
  tokenMaterialStoredInApp: false;
  vaultDecision: ModyCredentialVaultDecision;
  userMessage: string;
};

export type ModyProviderOAuthRuntimeCallbackInput = {
  sessionId: string;
  returnedState?: string;
  authorizationCodePresent?: boolean;
  error?: string;
  errorDescription?: string;
  grantedScopes: string[];
  receivedAt: string;
  storage?: ModyCredentialPersistenceLocation;
  credentialReferenceId?: string;
};

export type ModyProviderOAuthCallbackRuntimeResult = {
  status: "credential_ready" | "blocked";
  sessionStatus: ModyProviderOAuthCallbackSessionStatus;
  callback: ModyProviderOAuthCallbackResult;
  credential?: ModyProviderReadCredential;
  exchange?: ModyProviderOAuthSecureExchangeResult;
  appMayPersistSecret: false;
  rawSecretMaterialStored: false;
  codeStoredInApp: false;
  tokenMaterialStoredInApp: false;
  userMessage: string;
};

export class ModyProviderOAuthMockSecureStore {
  private readonly vaultPolicy = new ModyCredentialVaultPolicy();

  exchangeAuthorizationCodeForReference(
    input: ModyProviderOAuthSecureExchangeInput,
  ): ModyProviderOAuthSecureExchangeResult {
    const credentialReferenceId =
      input.credentialReferenceId ??
      `${input.storage}:${input.session.connectorId}:${input.session.providerId}:oauth-read`;
    const vaultDecision = this.vaultPolicy.createReference({
      connectorId: input.session.connectorId,
      secretKind: "oauth_refresh_token",
      storage: input.storage,
      referenceId: credentialReferenceId,
      displayLabel: `${input.session.providerId} read-only OAuth`,
      createdAt: input.exchangedAt,
      materialPresent: false,
      metadata: {
        providerId: input.session.providerId,
        scopeCount: input.grantedScopes.length,
        callbackSessionId: input.session.sessionId,
      },
    });

    const unsafeStorageRejected = vaultDecision.status === "unsafe_storage_rejected";
    if (vaultDecision.status !== "reference_recorded" || !vaultDecision.reference) {
      return {
        status: "blocked",
        connectorId: input.session.connectorId,
        providerId: input.session.providerId,
        grantedScopes: [...input.grantedScopes],
        storage: input.storage,
        appMayPersistSecret: false,
        rawSecretMaterialStored: false,
        codeStoredInApp: false,
        tokenMaterialStoredInApp: false,
        vaultDecision,
        userMessage: unsafeStorageRejected
          ? "unsafe_storage_rejected: credential reference는 browser storage에 남기지 않습니다."
          : vaultDecision.userMessage,
      };
    }

    return {
      status: "reference_recorded",
      connectorId: input.session.connectorId,
      providerId: input.session.providerId,
      credentialReferenceId: vaultDecision.reference.referenceId,
      grantedScopes: [...input.grantedScopes],
      storage: input.storage,
      appMayPersistSecret: false,
      rawSecretMaterialStored: false,
      codeStoredInApp: false,
      tokenMaterialStoredInApp: false,
      vaultDecision,
      userMessage: "authorization code를 앱에 저장하지 않고 보안 저장소 credential reference로 교환했습니다.",
    };
  }
}

export class ModyProviderOAuthCallbackRuntime {
  private readonly sessions = new Map<string, ModyProviderOAuthCallbackSession>();

  constructor(
    private readonly planner = new ModyProviderOAuthPlanner(),
    private readonly secureStore = new ModyProviderOAuthMockSecureStore(),
  ) {}

  beginSession(
    input: ModyProviderOAuthCallbackSessionInput,
  ): ModyProviderOAuthCallbackSession {
    const session: ModyProviderOAuthCallbackSession = {
      sessionId: input.sessionId,
      connectorId: input.plan.connectorId,
      providerId: input.plan.providerId,
      expectedState: input.expectedState,
      plan: input.plan,
      pkceVerifierFingerprint: input.pkceVerifierFingerprint,
      pkceVerifierStorage: "runtime_memory_only",
      createdAt: input.createdAt,
      expiresAt: input.expiresAt,
      status: "waiting_for_callback",
      appMayPersistSecret: false,
      rawSecretMaterialStored: false,
      codeStoredInApp: false,
    };

    this.sessions.set(session.sessionId, session);
    return session;
  }

  handleCallback(
    input: ModyProviderOAuthRuntimeCallbackInput,
  ): ModyProviderOAuthCallbackRuntimeResult {
    const session = this.sessions.get(input.sessionId);
    if (!session) {
      return blockedRuntimeResult(
        "blocked",
        blockedCallback("OAuth callback session을 찾을 수 없습니다. 연결을 다시 시작해 주세요."),
        "OAuth callback session을 찾을 수 없습니다. 연결을 다시 시작해 주세요.",
      );
    }

    if (new Date(input.receivedAt).getTime() > new Date(session.expiresAt).getTime()) {
      session.status = "expired";
      return blockedRuntimeResult(
        "expired",
        blockedCallback("OAuth callback session이 만료되었습니다. 다시 연결을 시작해 주세요."),
        "OAuth callback session이 만료되었습니다. 다시 연결을 시작해 주세요.",
      );
    }

    const callbackInput: {
      expectedState: string;
      returnedState?: string;
      authorizationCodePresent?: boolean;
      error?: string;
      errorDescription?: string;
    } = {
      expectedState: session.expectedState,
    };

    if (input.returnedState !== undefined) {
      callbackInput.returnedState = input.returnedState;
    }

    if (input.authorizationCodePresent !== undefined) {
      callbackInput.authorizationCodePresent = input.authorizationCodePresent;
    }

    if (input.error !== undefined) {
      callbackInput.error = input.error;
    }

    if (input.errorDescription !== undefined) {
      callbackInput.errorDescription = input.errorDescription;
    }

    const callback = this.planner.verifyCallback(callbackInput);

    if (callback.status === "blocked") {
      session.status = "blocked";
      return blockedRuntimeResult("blocked", callback, callback.userMessage);
    }

    const exchangeInput: ModyProviderOAuthSecureExchangeInput = {
      session,
      authorizationCodePresent: true,
      grantedScopes: input.grantedScopes,
      exchangedAt: input.receivedAt,
      storage: input.storage ?? "os_keychain",
    };

    if (input.credentialReferenceId !== undefined) {
      exchangeInput.credentialReferenceId = input.credentialReferenceId;
    }

    const exchange = this.secureStore.exchangeAuthorizationCodeForReference(exchangeInput);

    if (exchange.status !== "reference_recorded" || !exchange.credentialReferenceId) {
      session.status = "blocked";
      return {
        status: "blocked",
        sessionStatus: session.status,
        callback,
        exchange,
        appMayPersistSecret: false,
        rawSecretMaterialStored: false,
        codeStoredInApp: false,
        tokenMaterialStoredInApp: false,
        userMessage: exchange.userMessage,
      };
    }

    const credentialResult = this.planner.createCredentialFromReference({
      connectorId: session.connectorId,
      providerId: session.providerId,
      credentialReferenceId: exchange.credentialReferenceId,
      credentialStatus: "valid",
      storage: "os_keychain",
      grantedScopes: exchange.grantedScopes,
      createdByPlan: session.plan,
    });

    if (credentialResult.status !== "credential_ready" || !credentialResult.credential) {
      session.status = "blocked";
      return {
        status: "blocked",
        sessionStatus: session.status,
        callback,
        exchange,
        appMayPersistSecret: false,
        rawSecretMaterialStored: false,
        codeStoredInApp: false,
        tokenMaterialStoredInApp: false,
        userMessage: credentialResult.userMessage,
      };
    }

    session.status = "credential_ready";
    return {
      status: "credential_ready",
      sessionStatus: session.status,
      callback,
      credential: credentialResult.credential,
      exchange,
      appMayPersistSecret: false,
      rawSecretMaterialStored: false,
      codeStoredInApp: false,
      tokenMaterialStoredInApp: false,
      userMessage: "OAuth callback을 검증하고 보안 저장소 reference 기반 읽기 credential을 만들었습니다.",
    };
  }

  getSession(sessionId: string): ModyProviderOAuthCallbackSession | undefined {
    return this.sessions.get(sessionId);
  }
}

function blockedRuntimeResult(
  sessionStatus: ModyProviderOAuthCallbackSessionStatus,
  callback: ModyProviderOAuthCallbackResult,
  userMessage: string,
): ModyProviderOAuthCallbackRuntimeResult {
  return {
    status: "blocked",
    sessionStatus,
    callback,
    appMayPersistSecret: false,
    rawSecretMaterialStored: false,
    codeStoredInApp: false,
    tokenMaterialStoredInApp: false,
    userMessage,
  };
}

function blockedCallback(userMessage: string): ModyProviderOAuthCallbackResult {
  return {
    status: "blocked",
    appMayPersistSecret: false,
    rawSecretMaterialStored: false,
    codeStoredInApp: false,
    userMessage,
  };
}
