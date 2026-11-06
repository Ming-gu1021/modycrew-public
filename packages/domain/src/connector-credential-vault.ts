import type { ModyConnectorSecretStorage } from "./connector-setup.js";
import type { ISODateTimeString } from "./types.js";

export type ModyCredentialSecretKind =
  | "oauth_refresh_token"
  | "oauth_access_token"
  | "mail_account_username"
  | "mail_account_password"
  | "bot_token"
  | "bridge_pairing_secret"
  | "browser_session_reference"
  | "api_key"
  | "mcp_credential"
  | "cli_credential_reference";

export type ModyCredentialPersistenceLocation =
  | ModyConnectorSecretStorage
  | "app_memory"
  | "app_database"
  | "browser_local_storage"
  | "browser_session_storage"
  | "ui_state";

export type ModyCredentialVaultDecisionStatus =
  | "reference_recorded"
  | "not_required"
  | "reference_missing"
  | "unsafe_storage_rejected"
  | "secret_material_rejected";

export type ModyCredentialVaultReferenceInput = {
  connectorId: string;
  secretKind: ModyCredentialSecretKind;
  storage: ModyCredentialPersistenceLocation;
  referenceId?: string;
  displayLabel?: string;
  createdAt: ISODateTimeString;
  materialPresent?: boolean;
  metadata?: Record<string, unknown>;
};

export type ModyCredentialVaultReference = {
  connectorId: string;
  secretKind: ModyCredentialSecretKind;
  storage: ModyConnectorSecretStorage;
  referenceId: string;
  displayLabel?: string;
  createdAt: ISODateTimeString;
  appMayPersistSecret: false;
  rawSecretMaterialStored: false;
};

export type ModyCredentialVaultDecision = {
  status: ModyCredentialVaultDecisionStatus;
  reference?: ModyCredentialVaultReference;
  appMayPersistSecret: false;
  rawSecretMaterialStored: false;
  userMessage: string;
};

const safeCredentialStorage = new Set<ModyConnectorSecretStorage>([
  "os_keychain",
  "enterprise_vault",
  "external_mcp_config",
  "local_env_reference",
  "not_required",
]);

const unsafeCredentialStorage = new Set<ModyCredentialPersistenceLocation>([
  "app_memory",
  "app_database",
  "browser_local_storage",
  "browser_session_storage",
  "ui_state",
]);

const secretLikeKeyPattern = /token|password|jwt|refresh|authorization|botSecret|pairingSecret|apiKey|privateKey/i;

export class ModyCredentialVaultPolicy {
  createReference(input: ModyCredentialVaultReferenceInput): ModyCredentialVaultDecision {
    if (input.materialPresent || hasSecretLikeField(input.metadata)) {
      return decision(
        "secret_material_rejected",
        "credential 원문 또는 token-like 필드는 ModyCrew 앱 상태에 저장하지 않습니다. OS 보안 저장소나 외부 설정의 참조 ID만 기록해야 합니다.",
      );
    }

    if (unsafeCredentialStorage.has(input.storage) || !isSafeCredentialStorage(input.storage)) {
      return decision(
        "unsafe_storage_rejected",
        "credential은 app memory, app database, localStorage, sessionStorage, UI state에 저장할 수 없습니다.",
      );
    }

    if (input.storage === "not_required") {
      return decision(
        "not_required",
        "이 연결은 별도 credential 원문이 필요하지 않습니다.",
      );
    }

    if (!input.referenceId) {
      return decision(
        "reference_missing",
        "credential 원문 대신 OS 보안 저장소, MCP 설정, 로컬 환경 참조 ID가 필요합니다.",
      );
    }

    const referenceInput: ModyCredentialVaultReference = {
      connectorId: input.connectorId,
      secretKind: input.secretKind,
      storage: input.storage,
      referenceId: input.referenceId,
      createdAt: input.createdAt,
      appMayPersistSecret: false,
      rawSecretMaterialStored: false,
    };

    if (input.displayLabel) {
      referenceInput.displayLabel = input.displayLabel;
    }

    return {
      status: "reference_recorded",
      reference: referenceInput,
      appMayPersistSecret: false,
      rawSecretMaterialStored: false,
      userMessage: "credential 원문 없이 안전한 참조만 기록했습니다.",
    };
  }
}

function decision(status: ModyCredentialVaultDecisionStatus, userMessage: string): ModyCredentialVaultDecision {
  return {
    status,
    appMayPersistSecret: false,
    rawSecretMaterialStored: false,
    userMessage,
  };
}

function isSafeCredentialStorage(value: ModyCredentialPersistenceLocation): value is ModyConnectorSecretStorage {
  return safeCredentialStorage.has(value as ModyConnectorSecretStorage);
}

function hasSecretLikeField(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some(hasSecretLikeField);

  for (const [key, nestedValue] of Object.entries(value)) {
    if (secretLikeKeyPattern.test(key)) return true;
    if (hasSecretLikeField(nestedValue)) return true;
  }

  return false;
}
